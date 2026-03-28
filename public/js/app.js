// Theme toggle
(function() {
  const btn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  const saved = localStorage.getItem('theme') || 'dark';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
    icon.textContent = theme === 'light' ? '\u263D' : '\u2600';
    label.textContent = theme === 'light' ? 'Dark' : 'Light';
    localStorage.setItem('theme', theme);
  }

  applyTheme(saved);

  btn.addEventListener('click', () => {
    const current = localStorage.getItem('theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
})();

// Global state (mirrors server session)
window.appState = {
  playlist: [],  // { id, originalName, duration }
  video: null,
  settings: {},
};

// Toast utility
let toastTimer;
window.showToast = function(msg, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 2800);
};

// Format seconds to H:MM:SS or M:SS
window.formatDuration = function(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
};

// Parse HH:MM:SS to seconds
window.parseDuration = function(str) {
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
  if (parts.length === 2) return parts[0]*60 + parts[1];
  return parts[0] || 0;
};

// Check if export button should be enabled
window.checkExportReady = function() {
  const btn = document.getElementById('export-btn');
  btn.disabled = !(appState.playlist.length > 0 && appState.video);
};

// Load initial session state
fetch('/api/session')
  .then(r => r.json())
  .then(data => {
    appState.playlist = data.playlist || [];
    appState.video = data.video || null;
    appState.settings = data.settings || {};
    window.dispatchEvent(new CustomEvent('session-loaded', { detail: data }));
  })
  .catch(() => {});
