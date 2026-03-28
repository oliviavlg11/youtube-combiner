const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');

/**
 * Loop a video file to match a target duration, normalizing to target resolution/fps.
 * Uses -stream_loop -1 at the demuxer level (no frame count limit unlike the loop filter).
 *
 * @param {string} videoPath
 * @param {number} targetDuration - seconds
 * @param {object} settings - { resolution, fps, videoBitrate, useHardwareAccel }
 * @param {function} onProgress
 * @returns {Promise<string>} outputPath
 */
function loopVideo(videoPath, targetDuration, settings, onProgress) {
  return new Promise((resolve, reject) => {
    const {
      resolution = '1920x1080',
      fps = 30,
      videoBitrate = '8000k',
      useHardwareAccel = false,
    } = settings;

    const [targetW, targetH] = resolution.split('x').map(Number);
    const outputPath = path.join(EXPORTS_DIR, `video_${uuidv4()}.mp4`);

    // Add 1s padding to target duration to account for rounding drift;
    // the -shortest flag in the mux stage will trim to exact audio length.
    const loopDuration = targetDuration + 1;

    // Scale to target resolution while preserving aspect ratio, then pad with black,
    // normalize to CFR (required for YouTube and predictable looping).
    const vf = [
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
      `fps=${fps}`,
      'setsar=1',
    ].join(',');

    const codec = useHardwareAccel ? 'h264_videotoolbox' : 'libx264';
    const codecOpts = useHardwareAccel
      ? ['-b:v', videoBitrate]
      : ['-preset fast', '-crf 23'];

    // .input() must come before .inputOptions() in fluent-ffmpeg
    const cmd = ffmpeg()
      .input(videoPath)
      .inputOptions(['-stream_loop -1'])  // loop at demuxer level, unlimited frames
      .videoCodec(codec)
      .outputOptions([
        ...codecOpts,
        '-pix_fmt yuv420p',  // required for YouTube + broad player compatibility
        '-an',               // no audio in this intermediate file
        `-t ${loopDuration}`,
        '-movflags +faststart',
      ])
      .videoFilter(vf)
      .output(outputPath)
      .on('progress', p => onProgress && onProgress(p.percent || 0))
      .on('end', () => resolve(outputPath))
      .on('error', reject);

    cmd.run();
  });
}

module.exports = { loopVideo };
