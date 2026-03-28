// Simple in-memory session store (single-user local app)
const store = {
  playlist: [],     // [{ id, originalName, path, duration, size }]
  video: null,      // { id, originalName, path, duration, fps, width, height, size }
  settings: {
    resolution: '1920x1080',
    fps: 30,
    videoBitrate: '8000k',
    audioBitrate: '192k',
    useHardwareAccel: false,
    loop: false,
    loopCount: 1, // how many times to play through the playlist (1-10)
    format: 'landscape', // 'landscape' (YouTube 16:9) | 'portrait' (TikTok/Instagram 9:16)
  },
  activeJob: null,  // { id, process, stage, percent }
};

module.exports = store;
