const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const { concatAudio } = require('./audioService');
const { unlinkSilent } = require('../utils/cleanup');

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');

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

    job.stage = 'done';
    job.percent = 100;
    job.outputPath = finalPath;
    emit(job, { stage: 'done', percent: 100 });
    for (const res of job.sseClients) { try { res.end(); } catch (_) {} }

  } catch (err) {
    unlinkSilent(tempAudioPath);
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
      vizColor = '#e53935',
      vizOpacity = 0.6,
      vizPosition = 'bottom',
      vizHeight = 20,
    } = settings;

    const [targetW, targetH] = resolution.split('x').map(Number);

    // Scale/pad to target resolution, normalize to CFR
    const baseVf = [
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
      `fps=${fps}`,
      'setsar=1',
    ].join(',');

    const codec = useHardwareAccel ? 'h264_videotoolbox' : 'libx264';
    const codecOpts = useHardwareAccel
      ? ['-b:v', videoBitrate]
      // ultrafast preset + threads limit = much lower memory usage on constrained servers
      : ['-preset ultrafast', '-crf 23', '-threads 2'];

    // Build filter + map args: simple -vf or -filter_complex when viz is enabled
    let filterAndMapOpts;
    if (visualizer !== 'none') {
      const vizPx = Math.max(20, Math.round(targetH * (Math.min(50, Math.max(10, Number(vizHeight))) / 100)));
      const hex = String(vizColor || '#e53935').replace('#', '').slice(0, 6);
      const yPos = vizPosition === 'top' ? '0' : `${targetH - vizPx}`;
      const alpha = Math.min(1, Math.max(0, Number(vizOpacity) || 0.6)).toFixed(2);
      const bgAlpha = (Math.min(1, Math.max(0, Number(vizOpacity) || 0.6)) * 0.45).toFixed(2);

      let vizFilter;
      if (visualizer === 'waveform') {
        // mode=line draws sparse vertical bars; n=4096 spreads them out with bigger gaps
        vizFilter = `[1:a]showwaves=s=${targetW}x${vizPx}:mode=line:rate=15:n=4096:colors=0x${hex}@${alpha}:bgcolor=black@${bgAlpha}[viz]`;
      } else if (visualizer === 'bars') {
        vizFilter = `[1:a]showfreqs=s=${targetW}x${vizPx}:mode=bar:colors=0x${hex}@${alpha}:bgcolor=black@${bgAlpha}[viz]`;
      } else {
        // spectrum
        vizFilter = `[1:a]showcqt=size=${targetW}x${vizPx}:bgcolor=black@${bgAlpha}[viz]`;
      }

      const fc = `[0:v]${baseVf}[scaled];${vizFilter};[scaled][viz]overlay=0:${yPos}[vout]`;
      filterAndMapOpts = ['-filter_complex', fc, '-map', '[vout]', '-map', '1:a:0'];
    } else {
      filterAndMapOpts = ['-vf', baseVf, '-map', '0:v:0', '-map', '1:a:0'];
    }

    const proc = ffmpeg()
      // Input 0: video (looped at demuxer level — no frame count limit)
      .input(video.path)
      .inputOptions(['-stream_loop -1'])
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
  emit(job, { stage: 'cancelled' });
  for (const res of job.sseClients) { try { res.end(); } catch (_) {} }
  jobs.delete(jobId);
}

module.exports = { startExport, getJob, cancelJob };
