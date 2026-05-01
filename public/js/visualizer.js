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
  // Returns the band rectangle (y, height) based on position setting.
  // For 'fullscreen', the band fills the whole canvas.
  function getBand() {
    if (vizPosition === 'fullscreen') {
      return { y: 0, h: canvas.height };
    }
    const h = Math.round(canvas.height * vizHeight);
    if (vizPosition === 'top')      return { y: 0,                              h };
    if (vizPosition === 'centered') return { y: Math.round((canvas.height - h) / 2), h };
    return { y: canvas.height - h, h }; // 'bottom'
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

  // Resize the bitmap to match the canvas's actual rendered CSS box.
  // The canvas is pinned to inset:0 in CSS, so this is the full .video-preview.
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
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

    const { y: y0, h } = getBand();
    const centerY = y0 + h / 2;
    const amp = h * 0.42;

    // Subtle dark wash behind the band — fades away from the wave for a cinematic
    // edge. Skipped in fullscreen so the video shows through.
    if (vizPosition !== 'fullscreen') {
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
      const dark = `rgba(0,0,0,${(vizOpacity * 0.55).toFixed(3)})`;
      const transparent = 'rgba(0,0,0,0)';
      if (vizPosition === 'top') {
        grad.addColorStop(0, dark);
        grad.addColorStop(1, transparent);
      } else if (vizPosition === 'centered') {
        grad.addColorStop(0, transparent);
        grad.addColorStop(0.5, dark);
        grad.addColorStop(1, transparent);
      } else {
        grad.addColorStop(0, transparent);
        grad.addColorStop(1, dark);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, y0, canvas.width, h);
    }

    // Glowing line. shadowBlur approximates the FFmpeg gblur halo we use on export.
    const glowRadius = Math.max(8, Math.min(canvas.width, h) * 0.04);
    ctx.lineWidth = 2;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.shadowBlur  = glowRadius;
    ctx.shadowColor = rgba(vizColor, 0.95);
    ctx.strokeStyle = rgba(vizColor, vizOpacity);

    ctx.beginPath();
    const sliceW = canvas.width / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128.0;   // -1 .. 1
      const x = i * sliceW;
      const y = centerY + v * amp;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.shadowBlur = 0; // reset so other draws don't inherit
  }

  function drawBars() {
    const bufLen = analyser.frequencyBinCount;  // fftSize / 2 = 1024
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    const { y: y0, h } = getBand();

    // Edge-to-edge: bars span the full canvas width with no container.
    // Frequency bins are sampled on a LOG scale so bass doesn't pile up on
    // the left and treble doesn't get squashed into invisibility on the right.
    const numBars = 80;
    const barW    = Math.max(2, Math.floor((canvas.width / numBars) * 0.6));
    // Stride so the first bar starts at x=0 and the last bar's right edge
    // lands exactly on canvas.width — no trailing gap.
    const stride = (canvas.width - barW) / (numBars - 1);

    const minBin = 2;                   // skip DC + 1st bin (rumble)
    const maxBin = bufLen - 1;
    const logMin = Math.log(minBin);
    const logMax = Math.log(maxBin);

    ctx.fillStyle = rgba(vizColor, vizOpacity);
    for (let i = 0; i < numBars; i++) {
      const tA = i       / numBars;
      const tB = (i + 1) / numBars;
      const lo = Math.max(minBin, Math.floor(Math.exp(logMin + tA * (logMax - logMin))));
      const hi = Math.max(lo + 1, Math.floor(Math.exp(logMin + tB * (logMax - logMin))));
      let sum = 0;
      for (let j = lo; j < hi && j < bufLen; j++) sum += data[j];
      const avg = sum / (hi - lo);
      // Cube-root amplitude scale = perceptually softer compression than linear,
      // makes quieter highs visible without crushing the loud lows.
      const norm = Math.cbrt(avg / 255);
      const barH = Math.max(2, norm * h);
      const barY = vizPosition === 'top' ? y0 : y0 + h - barH;
      ctx.fillRect(Math.round(i * stride), barY, barW, barH);
    }
  }

  function drawSpectrum() {
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    const { y: y0, h } = getBand();

    // Smooth spectrum: many tightly-packed bars across the full width.
    // Log-frequency mapping spreads bass/mids/treble evenly. Cube-root
    // amplitude so quiet highs still register.
    const numBars = 200;
    const slotW   = canvas.width / numBars;        // bars touch — no visible gaps
    const minBin  = 2;
    const maxBin  = bufLen - 1;
    const logMin  = Math.log(minBin);
    const logMax  = Math.log(maxBin);

    // Horizontal gradient: edge color → user color → edge color.
    const grad = ctx.createLinearGradient(0, y0, canvas.width, y0);
    const [r,g,b] = hexToRgb(vizColor);
    grad.addColorStop(0,   `rgba(79,195,247,${vizOpacity})`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${vizOpacity})`);
    grad.addColorStop(1,   `rgba(171,71,188,${vizOpacity})`);
    ctx.fillStyle = grad;

    for (let i = 0; i < numBars; i++) {
      const tA = i       / numBars;
      const tB = (i + 1) / numBars;
      const lo = Math.max(minBin, Math.floor(Math.exp(logMin + tA * (logMax - logMin))));
      const hi = Math.max(lo + 1, Math.floor(Math.exp(logMin + tB * (logMax - logMin))));
      let sum = 0;
      for (let j = lo; j < hi && j < bufLen; j++) sum += data[j];
      const avg = sum / (hi - lo);
      const norm = Math.cbrt(avg / 255);
      const barH = Math.max(1, norm * h);
      const barY = vizPosition === 'top' ? y0 : y0 + h - barH;
      // Width math: span the canvas exactly, no trailing gap.
      const x  = i * slotW;
      const xN = (i + 1) * slotW;
      ctx.fillRect(Math.round(x), barY, Math.round(xN) - Math.round(x), barH);
    }
  }
})();
