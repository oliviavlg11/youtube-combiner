const ffmpeg = require('fluent-ffmpeg');

function probe(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const format = data.format || {};
      const streams = data.streams || [];
      const videoStream = streams.find(s => s.codec_type === 'video');
      const audioStream = streams.find(s => s.codec_type === 'audio');

      resolve({
        duration: parseFloat(format.duration) || 0,
        size: parseInt(format.size) || 0,
        videoStream: videoStream ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          fps: evalFraction(videoStream.r_frame_rate),
          pixFmt: videoStream.pix_fmt,
        } : null,
        audioStream: audioStream ? {
          codec: audioStream.codec_name,
          sampleRate: parseInt(audioStream.sample_rate),
          channels: audioStream.channels,
          bitrate: parseInt(audioStream.bit_rate),
        } : null,
      });
    });
  });
}

function evalFraction(str) {
  if (!str) return 0;
  const [num, den] = str.split('/').map(Number);
  return den ? num / den : num;
}

module.exports = { probe };
