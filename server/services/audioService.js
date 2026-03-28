const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

const EXPORTS_DIR = path.join(__dirname, '../../uploads/exports');

/**
 * Concatenate audio files into a single AAC file.
 * @param {Array<{path: string, duration: number}>} tracks
 * @param {object} settings - { audioBitrate, loop, loopCount }
 * @param {function} onProgress - (percent) => void
 * @returns {Promise<{outputPath: string, duration: number}>}
 */
function concatAudio(tracks, settings, onProgress) {
  return new Promise((resolve, reject) => {
    const { audioBitrate = '192k', loop = false, loopCount = 1 } = settings;

    // Repeat the track list loopCount times if looping
    const repetitions = loop ? Math.min(10, Math.max(1, loopCount)) : 1;
    const trackList = [];
    for (let i = 0; i < repetitions; i++) trackList.push(...tracks);

    const singleDuration = tracks.reduce((s, t) => s + t.duration, 0);
    const totalDuration = singleDuration * repetitions;

    // Write concat list file
    const listPath = path.join(EXPORTS_DIR, `concat_${uuidv4()}.txt`);
    const listContent = trackList.map(t => `file '${t.path.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listPath, listContent);

    const outputPath = path.join(EXPORTS_DIR, `audio_${uuidv4()}.aac`);

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .audioCodec('aac')
      .audioBitrate(audioBitrate)
      .audioFrequency(44100)
      .audioChannels(2)
      .output(outputPath)
      .on('progress', p => onProgress && onProgress(p.percent || 0))
      .on('end', () => {
        fs.unlinkSync(listPath);
        resolve({ outputPath, duration: totalDuration });
      })
      .on('error', err => {
        try { fs.unlinkSync(listPath); } catch (_) {}
        reject(err);
      })
      .run();
  });
}

module.exports = { concatAudio };
