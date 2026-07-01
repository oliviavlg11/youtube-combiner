const path = require('path');
const fs = require('fs');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { concatAudio } = require('./audioService');
const { unlinkSilent } = require('../utils/cleanup');

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');
const FONTS_DIR = path.join(__dirname, '../../public/fonts');
const FONT_FILES = {
  Inter: path.join(FONTS_DIR, 'Inter-Regular.ttf'),
  PlayfairDisplay: path.join(FONTS_DIR, 'PlayfairDisplay-Regular.ttf'),
  BebasNeue: path.join(FONTS_DIR, 'BebasNeue-Regular.ttf'),
  Montserrat: path.join(FONTS_DIR, 'Montserrat-Regular.ttf'),
};

// Active jobs: jobId -> { stage, percent, outputPath, sseClients, ffmpegProc, cancelled }
const jobs = new Map();

function getJob(jobId) { return jobs.get(jobId); }

function emit(job, data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of job.sseClients) {
    try { res.write(msg); } catch (_) {}
  }
}

async function startExport(jobId, playlist, video, settings) {
  const job = {
    stage: 'starting',
    percent: 0,
    outputPath: null,
    tempAudio: null,
    sseClients: new Set(),
    ffmpegProc: null,
    cancelled: false,
  };
  jobs.set(jobId, job);

  let tempAudioPath = null;

  try {
    // --- Stage 1: Concatenate & encode audio ---
    job.stage = 'concat_audio';
    emit(job, { stage: job.stage, percent: 0 });

    const { outputPath: audioPath, duration: audioDuration } = await concatAudio(
      playlist,
      settings,
      (pct) => {
        if (job.cancelled) return;
        // Clamp to 0-100 (fluent-ffmpeg can return >100 on concat inputs)
        job.percent = Math.min(40, Math.round(Math.max(0, pct) * 0.4));
        emit(job, { stage: job.stage, percent: job.percent });
      }
    );
    tempAudioPath = audioPath;
    job.tempAudio = audioPath;
    if (job.cancelled) { unlinkSilent(tempAudioPath); return; }

    // --- Stage 2: Single-pass loop video + mux with audio ---
    // Skip separate video encoding — loop and mux in one FFmpeg pass.
    // This is dramatically faster than encoding a full intermediate video file.
    job.stage = 'loop_video';
    emit(job, { stage: job.stage, percent: 40 });

    const finalPath = path.join(EXPORTS_DIR, `export_${jobId}.mp4`);
    await loopAndMux(job, video, audioPath, audioDuration, settings, finalPath);
    if (job.cancelled) { unlinkSilent(tempAudioPath); unlinkSilent(finalPath); return; }

    unlinkSilent(tempAudioPath);
    (job.tempTextFiles || []).forEach(unlinkSilent);

    job.stage = 'done';
    job.percent = 100;
    job.outputPath = finalPath;
    emit(job, { stage: 'done', percent: 100 });
    for (const res of job.sseClients) { try { res.end(); } catch (_) {} }

  } catch (err) {
    unlinkSilent(tempAudioPath);
    (job.tempTextFiles || []).forEach(unlinkSilent);
    console.error('[export error]', err.message);
    emit(job, { stage: 'error', message: err.message });
    for (const res of job.sseClients) { try { res.end(); } catch (_) {} }
  }
}

/**
 * Loop the video and mux with audio in a single FFmpeg pass.
 * Supports optional audio visualizer overlay via filter_complex.
 */
function loopAndMux(job, video, audioPath, audioDuration, settings, outputPath) {
  return new Promise((resolve, reject) => {
    const {
      resolution = '1920x1080',
      fps = 30,
      videoBitrate = '8000k',
      useHardwareAccel = false,
      visualizer = 'none',
      vizColor = '#e5e7eb',
      vizOpacity = 0.85,
      vizPosition = 'bottom',
      vizHeight = 20,
      showSongTitle = false,
      showArtistName = false,
      songTitle = '',
      artistName = '',
      textFont = 'Inter',
      textSize = 5,
      textColor = '#ffffff',
      textPosition = 'bottom',
      textGlow = 'soft',
      mediaOffsetX = 0,
      mediaOffsetY = 0,
    } = settings;

    const [targetW, targetH] = resolution.split('x').map(Number);

    // Cover the canvas (scale so the shorter side fills target), then crop to
    // the exact target rect with a user-controlled pan offset.
    const offX = Math.max(-1, Math.min(1, Number(mediaOffsetX) || 0));
    const offY = Math.max(-1, Math.min(1, Number(mediaOffsetY) || 0));
    const baseVf = [
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
      `crop=${targetW}:${targetH}:(iw-${targetW})/2*(1-(${offX})):(ih-${targetH})/2*(1-(${offY}))`,
      `fps=${fps}`,
      'setsar=1',
    ].join(',');

    const codec = useHardwareAccel ? 'h264_videotoolbox' : 'libx264';
    const codecOpts = useHardwareAccel
      ? ['-b:v', videoBitrate]
      : ['-preset ultrafast', '-crf 23', '-threads 2'];

    const trimmedTitle  = String(songTitle  || '').trim().slice(0, 80);
    const trimmedArtist = String(artistName || '').trim().slice(0, 60);
    const hasTitle  = showSongTitle  && trimmedTitle.length  > 0;
    const hasArtist = showArtistName && trimmedArtist.length > 0;
    const hasAnyText = hasTitle || hasArtist;
    const hasViz = visualizer !== 'none';

    // Write text payloads to temp files so we can use drawtext's `textfile=`
    // parameter — sidesteps every escaping headache (colons, quotes, %, etc.).
    job.tempTextFiles = job.tempTextFiles || [];
    function writeTextFile(s) {
      const p = path.join(os.tmpdir(), `loopvibe_${uuidv4()}.txt`);
      fs.writeFileSync(p, s, 'utf8');
      job.tempTextFiles.push(p);
      return p;
    }
    const titleFile  = hasTitle  ? writeTextFile(trimmedTitle)  : null;
    const artistFile = hasArtist ? writeTextFile(trimmedArtist) : null;

    let filterAndMapOpts;
    if (hasViz || hasAnyText) {
      const filterGraph = buildFilterComplex({
        baseVf, targetW, targetH,
        visualizer, vizColor, vizOpacity, vizPosition, vizHeight,
        hasTitle, hasArtist, titleFile, artistFile,
        textFont, textSize, textColor, textPosition, textGlow,
      });
      filterAndMapOpts = ['-filter_complex', filterGraph, '-map', '[vout]', '-map', '1:a:0'];
    } else {
      filterAndMapOpts = ['-vf', baseVf, '-map', '0:v:0', '-map', '1:a:0'];
    }

    // Image inputs use `-loop 1 -framerate <fps>` so FFmpeg generates a CFR
    // stream from a single frame; the existing -shortest flag will trim to
    // the audio duration. Videos use demuxer-level looping (unlimited frames).
    const isImage = video.mediaType === 'image';
    const mediaInputOptions = isImage
      ? ['-loop 1', `-framerate ${fps}`]
      : ['-stream_loop -1'];

    const proc = ffmpeg()
      // Input 0: image or video
      .input(video.path)
      .inputOptions(mediaInputOptions)
      // Input 1: pre-encoded audio
      .input(audioPath)
      .videoCodec(codec)
      .audioCodec('copy')
      .outputOptions([
        ...filterAndMapOpts,
        ...codecOpts,
        '-pix_fmt yuv420p',
        '-shortest',            // stop at end of audio
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('start', () => { job.ffmpegProc = proc; })
      .on('progress', p => {
        if (job.cancelled) return;
        // Calculate progress from timemark vs total audio duration
        const secs = timemarkToSeconds(p.timemark);
        const pct = audioDuration > 0 ? Math.min(99, Math.round((secs / audioDuration) * 60)) : 0;
        job.percent = 40 + pct;
        emit(job, { stage: 'loop_video', percent: job.percent });
      })
      .on('end', resolve)
      .on('error', reject);

    proc.run();
  });
}

/**
 * Build the -filter_complex graph that overlays a visualizer + optional song
 * title / artist text on top of the base scaled video.
 *
 * Pipeline:
 *   [0:v]baseVf → [scaled]
 *   (optional) [1:a]visualizer-filter → [viz]; [scaled][viz]overlay → [v0]
 *   (otherwise) [scaled] → [v0]
 *   (optional) [v0]drawtext title → [v1]
 *   (optional) [v1]drawtext artist → [v2]
 *   final node renamed to [vout]
 */
function buildFilterComplex(opts) {
  const {
    baseVf, targetW, targetH,
    visualizer, vizColor, vizOpacity, vizPosition, vizHeight,
    hasTitle, hasArtist, titleFile, artistFile,
    textFont, textSize, textColor, textPosition, textGlow,
  } = opts;

  const parts = [];
  parts.push(`[0:v]${baseVf}[scaled]`);

  let cursor = '[scaled]';

  if (visualizer !== 'none') {
    const hex = String(vizColor || '#e5e7eb').replace('#', '').slice(0, 6);
    const alpha = Math.min(1, Math.max(0, Number(vizOpacity) || 0.85)).toFixed(2);
    const isFullscreen = vizPosition === 'fullscreen';
    const vizW = targetW;
    const vizH = isFullscreen
      ? targetH
      : Math.max(20, Math.round(targetH * (Math.min(50, Math.max(10, Number(vizHeight))) / 100)));

    let yPos;
    if (isFullscreen)                    yPos = '0';
    else if (vizPosition === 'top')      yPos = '0';
    else if (vizPosition === 'centered') yPos = `(H-h)/2`;
    else                                  yPos = `${targetH - vizH}`; // bottom

    if (visualizer === 'waveform') {
      // Elegant waveform: smooth thin centered line + gblur bloom.
      // n=900 ≈ one sample every ~2px at 1920 wide → smooth, not jagged.
      const bloomSigma = Math.max(8, Math.round(Math.min(vizH, vizW) * 0.045));
      parts.push(
        `[1:a]showwaves=s=${vizW}x${vizH}:mode=cline:rate=30:n=900:colors=0x${hex}:scale=lin,` +
        `format=rgba,colorkey=color=0x000000:similarity=0.02:blend=0[wave_raw]`
      );
      parts.push(`[wave_raw]split[wave_sharp][wave_for_bloom]`);
      parts.push(`[wave_for_bloom]gblur=sigma=${bloomSigma}[wave_bloom]`);
      parts.push(`[wave_bloom][wave_sharp]overlay=0:0[wave_glow]`);
      parts.push(`[wave_glow]colorchannelmixer=aa=${alpha}[viz]`);
    } else if (visualizer === 'bars') {
      // Thin bars: render showfreqs at 1/2 width, then upscale with bilinear
      // smoothing to soften the bar edges into elegant glowing pillars.
      // averaging=4 smooths frame-to-frame jitter so bars breathe rather than
      // twitch. A gblur halo turns rectangles into glowing tubes.
      const halfW = Math.max(160, Math.round(vizW / 2));
      const bloomSigma = Math.max(5, Math.round(vizH * 0.06));
      parts.push(
        `[1:a]showfreqs=s=${halfW}x${vizH}:mode=bar:fscale=log:ascale=cbrt:` +
        `win_size=2048:win_func=hann:averaging=4:colors=0x${hex},` +
        `scale=${vizW}:${vizH}:flags=bilinear,` +
        `format=rgba,colorkey=color=0x000000:similarity=0.05:blend=0[bars_raw]`
      );
      parts.push(`[bars_raw]split[bars_sharp][bars_for_bloom]`);
      parts.push(`[bars_for_bloom]gblur=sigma=${bloomSigma}[bars_bloom]`);
      parts.push(`[bars_bloom][bars_sharp]overlay=0:0[bars_glow]`);
      parts.push(`[bars_glow]colorchannelmixer=aa=${alpha}[viz]`);
    } else {
      // spectrum (smooth). Cap the frequency range to ~C1..8kHz so the content
      // fills the full width — showcqt's default range runs to ~20kHz where music
      // has no energy, which leaves the right ~30% of the band permanently empty.
      parts.push(
        `[1:a]showcqt=size=${vizW}x${vizH}:axis=0:text=0:basefreq=32.70:endfreq=8000,` +
        `format=rgba,colorkey=color=0x000000:similarity=0.05:blend=0,` +
        `colorchannelmixer=aa=${alpha}[viz]`
      );
    }
    parts.push(`${cursor}[viz]overlay=0:${yPos}[v_with_viz]`);
    cursor = '[v_with_viz]';
  }

  // ── Text overlay ────────────────────────────────────────────────────
  if (hasTitle || hasArtist) {
    const fontFile = FONT_FILES[textFont] || FONT_FILES.Inter;
    const titleSizePx  = Math.max(14, Math.round(targetH * (Number(textSize) / 100)));
    const artistSizePx = Math.round(titleSizePx * 0.62);
    const gapPx        = Math.round(titleSizePx * 0.18);
    const blockH =
      (hasTitle ? titleSizePx : 0) +
      (hasTitle && hasArtist ? gapPx : 0) +
      (hasArtist ? artistSizePx : 0);
    const marginPx = Math.max(20, Math.round(targetH * 0.06));

    // Top of the text block in canvas coords
    let blockTopY;
    if (textPosition === 'top')         blockTopY = marginPx;
    else if (textPosition === 'center') blockTopY = Math.round((targetH - blockH) / 2);
    else                                 blockTopY = targetH - marginPx - blockH; // bottom

    const fontHex = String(textColor || '#ffffff').replace('#', '').slice(0, 6).toUpperCase();
    const fontColorExpr = `0x${fontHex}`;

    // Glow style → drawtext border/shadow params. Single drawtext-per-line
    // keeps the filter graph readable; "strong" uses a heavier colored
    // border to fake a halo without a separate blur pass.
    function glowParams() {
      if (textGlow === 'off') return '';
      if (textGlow === 'strong') {
        return [
          `borderw=3`,
          `bordercolor=${fontColorExpr}@0.6`,
          `shadowcolor=${fontColorExpr}@0.55`,
          `shadowx=0`,
          `shadowy=4`,
        ].join(':');
      }
      // soft (default)
      return [
        `borderw=1`,
        `bordercolor=0x000000@0.35`,
        `shadowcolor=0x000000@0.5`,
        `shadowx=0`,
        `shadowy=2`,
      ].join(':');
    }
    const glow = glowParams();

    function drawTextStep(textfile, sizePx, topY, inLabel, outLabel) {
      const base = [
        `drawtext=textfile=${textfile}`,
        `fontfile=${fontFile}`,
        `fontsize=${sizePx}`,
        `fontcolor=${fontColorExpr}`,
        `x=(w-text_w)/2`,
        // y is the top of the text glyph box; topY is where we want it.
        `y=${topY}`,
        `expansion=none`,
        `fix_bounds=1`,
      ];
      if (glow) base.push(glow);
      parts.push(`${inLabel}${base.join(':')}${outLabel}`);
    }

    if (hasTitle) {
      drawTextStep(titleFile, titleSizePx, blockTopY, cursor, '[v_with_title]');
      cursor = '[v_with_title]';
    }
    if (hasArtist) {
      const artistY = hasTitle ? blockTopY + titleSizePx + gapPx : blockTopY;
      drawTextStep(artistFile, artistSizePx, artistY, cursor, '[v_with_artist]');
      cursor = '[v_with_artist]';
    }
  }

  // Final rename to [vout] so -map [vout] always works
  parts.push(`${cursor}null[vout]`);
  return parts.join(';');
}

function timemarkToSeconds(timemark) {
  if (!timemark) return 0;
  const parts = timemark.split(':').map(parseFloat);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.cancelled = true;
  if (job.ffmpegProc) {
    try { job.ffmpegProc.kill('SIGKILL'); } catch (_) {}
  }
  if (job.outputPath) unlinkSilent(job.outputPath);
  if (job.tempAudio) unlinkSilent(job.tempAudio);
  (job.tempTextFiles || []).forEach(unlinkSilent);
  emit(job, { stage: 'cancelled' });
  for (const res of job.sseClients) { try { res.end(); } catch (_) {} }
  jobs.delete(jobId);
}

module.exports = { startExport, getJob, cancelJob };
