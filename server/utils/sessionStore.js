// Per-session in-memory stores, keyed by session id (browser cookie).
const stores = new Map();

function defaultStore() {
  return {
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
      visualizer: 'waveform', // 'none' | 'waveform' | 'bars' | 'spectrum'
      vizColor: '#e5e7eb',
      vizOpacity: 0.85,      // 0.1–1.0
      vizPosition: 'bottom', // 'bottom' | 'centered' | 'top' | 'fullscreen'
      vizHeight: 20,         // % of video height (10-50)
      // Song title / artist overlay (global, applied across whole export)
      showSongTitle: false,
      showArtistName: false,
      songTitle: '',
      artistName: '',
      textFont: 'Inter',          // 'Inter' | 'PlayfairDisplay' | 'BebasNeue' | 'Montserrat'
      textSize: 5,                // % of video height (3-10)
      textColor: '#ffffff',
      textPosition: 'bottom',     // 'top' | 'center' | 'bottom'
      textGlow: 'soft',           // 'off' | 'soft' | 'strong'
      // Cover-mode pan offsets in [-1, +1]. 0 = centered crop.
      // Sign convention: +X = image shifted right (shows left side);
      //                  +Y = image shifted down (shows top side).
      mediaOffsetX: 0,
      mediaOffsetY: 0,
    },
    activeJob: null,  // { id, process, stage, percent }
  };
}

function getStore(sid) {
  let s = stores.get(sid);
  if (!s) {
    s = defaultStore();
    stores.set(sid, s);
  }
  return s;
}

module.exports = { getStore };
