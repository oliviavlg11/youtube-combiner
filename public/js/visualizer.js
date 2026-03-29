(function() {
  const canvas = document.getElementById('viz-canvas');
  const ctx = canvas.getContext('2d');
  const videoEl = document.getElementById('video-player');

  let audioCtx = null;
  let analyser = null;
  let currentSource = null;   // always keep a ref so we can disconnect it
  let animFrame = null;
  let vizType     = 'none';
  let vizColor    = '#e53935';
  let vizOpacity  = 0.6;
  let vizPosition = 'bottom'; // 'bottom' | 'top'
  let vizHeight   = 0.20;     // fraction of canvas height (0.10–0.50)
  let isPlaying   = false;

  // ── Helpers ──────────────────────────────────────────────────────────

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgba(hex, alpha) {
    const [r,g,b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  // Returns the y offset for the viz band based on position setting
  function bandY(bandH) {
    return vizPosition === 'top' ? 0 : canvas.height - bandH;
  }

  function ensureContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.85;
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function connectAudioEl(audioEl) {
    ensureContext();
    // Disconnect the previous source to avoid stale nodes piling up
    if (currentSource) {
      try { currentSource.disconnect(); } catch (_) {}
      currentSource = null;
    }
    try {
      currentSource = audioCtx.createMediaElementSource(audioEl);
      currentSource.connect(analyser);
    } catch (_) {
      // createMediaElementSource throws if the element was already used in
      // another AudioContext — nothing we can do, just leave analyser sourceless
    }
  }

  // Resize canvas pixels to match the video element's rendered size
  function resizeCanvas() {
    const rect = videoEl.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // ── Event listeners ───────────────────────────────────────────────────

  // Called every time a new Audio() element is created in videoPanel.js
  window.addEventListener('audio-element-created', ({ detail: { audioEl } }) => {
    connectAudioEl(audioEl);
    // If viz is already active and playing, (re)start drawing for new track
    if (vizType !== 'none' && isPlaying) startDrawing();
  });

  // videoPanel.js responds to this by re-firing audio-element-created
  // Used when the user enables the viz while audio is already playing
  window.addEventListener('viz-settings-changed', ({ detail }) => {
    vizType     = detail.type     || 'none';
    vizColor    = detail.color    || '#e53935';
    vizOpacity  = detail.opacity  !== undefined ? detail.opacity  : vizOpacity;
    vizPosition = detail.position || vizPosition;
    vizHeight   = detail.height   !== undefined ? detail.height   : vizHeight;

    const show = vizType !== 'none';
    canvas.classList.toggle('active', show);

    if (!show) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    // If we don't have an analyser yet, ask videoPanel for the current element
    if (!analyser) {
      window.dispatchEvent(new CustomEvent('request-audio-element'));
    }

    // Start (or restart) the loop if already playing
    if (isPlaying) startDrawing();
  });

  window.addEventListener('viz-playback', ({ detail: { playing } }) => {
    isPlaying = playing;
    if (playing && vizType !== 'none') {
      startDrawing();
    } else {
      cancelAnimationFrame(animFrame);
      animFrame = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  // ── Drawing loop ───────────────────────────────────────────────────────

  function startDrawing() {
    cancelAnimationFrame(animFrame);
    function draw() {
      animFrame = requestAnimationFrame(draw);
      if (!analyser || vizType === 'none') return;
      resizeCanvas();
      if (canvas.width === 0 || canvas.height === 0) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if      (vizType === 'waveform') drawWaveform();
      else if (vizType === 'bars')     drawBars();
      else if (vizType === 'spectrum') drawSpectrum();
    }
    draw();
  }

  function drawWaveform() {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    const h  = Math.round(canvas.height * vizHeight);
    const y0 = bandY(h);

    ctx.fillStyle = `rgba(0,0,0,${vizOpacity * 0.45})`;
    ctx.fillRect(0, y0, canvas.width, h);

    ctx.lineWidth   = 1.5;
    ctx.strokeStyle = rgba(vizColor, vizOpacity);
    ctx.beginPath();

    const sliceW = canvas.width / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;        // 0–2, centre = 1.0
      const x = i * sliceW;
      const y = y0 + (v / 2) * h;       // maps to y0 … y0+h
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function drawBars() {
    const bufLen = analyser.frequencyBinCount;  // fftSize / 2 = 1024
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    const h  = Math.round(canvas.height * vizHeight);
    const y0 = bandY(h);

    ctx.fillStyle = `rgba(0,0,0,${vizOpacity * 0.45})`;
    ctx.fillRect(0, y0, canvas.width, h);

    const numBars = 80;
    const barW    = Math.max(2, Math.floor((canvas.width / numBars) * 0.6));
    const gap     = canvas.width / numBars;
    const step    = Math.max(1, Math.floor(bufLen / numBars));

    ctx.fillStyle = rgba(vizColor, vizOpacity);
    for (let i = 0; i < numBars; i++) {
      const barH  = ((data[i * step] || 0) / 255) * h;
      const barY  = vizPosition === 'top' ? y0 : y0 + h - barH;
      ctx.fillRect(Math.round(i * gap), barY, barW, barH);
    }
  }

  function drawSpectrum() {
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    const h  = Math.round(canvas.height * vizHeight);
    const y0 = bandY(h);

    ctx.fillStyle = `rgba(0,0,0,${vizOpacity * 0.45})`;
    ctx.fillRect(0, y0, canvas.width, h);

    const grad = ctx.createLinearGradient(0, y0, canvas.width, y0);
    const [r,g,b] = hexToRgb(vizColor);
    grad.addColorStop(0,   `rgba(79,195,247,${vizOpacity})`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${vizOpacity})`);
    grad.addColorStop(1,   `rgba(171,71,188,${vizOpacity})`);
    ctx.fillStyle = grad;

    const barW = canvas.width / bufLen;
    for (let i = 0; i < bufLen; i++) {
      const barH = (data[i] / 255) * h;
      const barY = vizPosition === 'top' ? y0 : y0 + h - barH;
      ctx.fillRect(i * barW, barY, barW, barH);
    }
  }
})();
