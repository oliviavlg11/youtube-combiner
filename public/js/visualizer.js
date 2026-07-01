(function() {
  const canvas = document.getElementById('viz-canvas');
  const ctx = canvas.getContext('2d');

  let audioCtx = null;
  let analyser = null;
  let currentSource = null;
  let animFrame = null;
  let vizType     = 'waveform';
  let vizColor    = '#e5e7eb';
  let vizOpacity  = 0.85;
  let vizPosition = 'bottom';
  let vizHeight   = 0.20;
  let vizGradient = null;
  let isPlaying   = false;

  // Text overlay state — driven by viz-text-changed events from exportPanel
  let textCfg = {
    showSongTitle: false,
    showArtistName: false,
    songTitle: '',
    artistName: '',
    textFont: 'Inter',
    textSize: 5,            // % of canvas height
    textColor: '#ffffff',
    textPosition: 'bottom', // 'top' | 'center' | 'bottom'
    textGlow: 'soft',       // 'off' | 'soft' | 'strong'
  };

  const FONT_FAMILY_MAP = {
    Inter: '"Inter", system-ui, sans-serif',
    PlayfairDisplay: '"Playfair Display", Georgia, serif',
    BebasNeue: '"Bebas Neue", Impact, sans-serif',
    Montserrat: '"Montserrat", "Helvetica Neue", sans-serif',
  };

  // ── Helpers ──────────────────────────────────────────────────────────

  // Music almost never has usable energy above ~8 kHz, yet the FFT runs to
  // Nyquist (~22–24 kHz). Mapping the full range leaves the right ~30% of the
  // band permanently empty. Cap the displayed spectrum here so bars/spectrum
  // fill edge-to-edge. Purely cosmetic — does not touch the audio.
  const VIZ_MAX_FREQ = 8000;
  function maxFreqBin(bufLen) {
    if (!audioCtx || !audioCtx.sampleRate) return bufLen - 1;
    const nyquist = audioCtx.sampleRate / 2;
    const bin = Math.round((VIZ_MAX_FREQ / nyquist) * bufLen);
    return Math.max(16, Math.min(bufLen - 1, bin));
  }

  function hexToRgb(hex) {
    const h = String(hex || '#ffffff').replace('#', '');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function rgba(hex, alpha) {
    const [r,g,b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Visualizer band rectangle. Fullscreen fills the canvas; otherwise we
  // anchor a band of `vizHeight` to the chosen edge.
  function getBand() {
    if (vizPosition === 'fullscreen') {
      return { y: 0, h: canvas.height };
    }
    const h = Math.round(canvas.height * vizHeight);
    if (vizPosition === 'top')      return { y: 0, h };
    if (vizPosition === 'centered') return { y: Math.round((canvas.height - h) / 2), h };
    return { y: canvas.height - h, h }; // 'bottom'
  }

  function ensureContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.88;
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function connectAudioEl(audioEl) {
    ensureContext();
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

  window.addEventListener('audio-element-created', ({ detail: { audioEl } }) => {
    connectAudioEl(audioEl);
    if (isPlaying) startDrawing();
  });

  window.addEventListener('viz-settings-changed', ({ detail }) => {
    vizType     = detail.type     || 'none';
    vizColor    = detail.color    || vizColor;
    vizOpacity  = detail.opacity  !== undefined ? detail.opacity  : vizOpacity;
    vizPosition = detail.position || vizPosition;
    vizHeight   = detail.height   !== undefined ? detail.height   : vizHeight;

    const show = vizType !== 'none' || hasAnyText();
    canvas.classList.toggle('active', show);

    if (!analyser) {
      window.dispatchEvent(new CustomEvent('request-audio-element'));
    }

    if (isPlaying || hasAnyText()) startDrawing();
    else if (!show) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  window.addEventListener('viz-gradient-changed', ({ detail }) => {
    vizGradient = (detail && Array.isArray(detail.stops) && detail.stops.length >= 2) ? detail.stops : null;
  });

  window.addEventListener('viz-text-changed', ({ detail }) => {
    Object.assign(textCfg, detail || {});
    const show = vizType !== 'none' || hasAnyText();
    canvas.classList.toggle('active', show);
    // Text needs to repaint even when paused (it doesn't need analyser data)
    startDrawing();
  });

  window.addEventListener('viz-playback', ({ detail: { playing } }) => {
    isPlaying = playing;
    if (playing || hasAnyText()) {
      startDrawing();
    } else {
      cancelAnimationFrame(animFrame);
      animFrame = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  // ── Drawing loop ───────────────────────────────────────────────────────

  function hasAnyText() {
    return (textCfg.showSongTitle && textCfg.songTitle.trim()) ||
           (textCfg.showArtistName && textCfg.artistName.trim());
  }

  function startDrawing() {
    cancelAnimationFrame(animFrame);
    function draw() {
      animFrame = requestAnimationFrame(draw);
      resizeCanvas();
      if (canvas.width === 0 || canvas.height === 0) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (analyser && vizType !== 'none') {
        if      (vizType === 'waveform') drawWaveform();
        else if (vizType === 'bars')     drawBars();
        else if (vizType === 'spectrum') drawSpectrum();
      }

      // Text overlay always renders on top, with or without audio
      if (hasAnyText()) drawTextOverlay();
    }
    draw();
  }

  // ── Elegant Waveform ───────────────────────────────────────────────────
  // Smooth, centered line that traces the time-domain signal. We downsample
  // the 2048-point buffer to ~140 control points and connect them with
  // quadratic Bézier midpoints — this gives a soft, hand-drawn feel instead
  // of the jagged 1-pixel zigzag a raw polyline would produce. A subtle
  // shadowBlur halo approximates the FFmpeg gblur bloom we use on export.
  function drawWaveform() {
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    const { y: y0, h } = getBand();
    const centerY = y0 + h / 2;
    const amp = h * 0.40;

    // Soft dark wash behind the band so the line reads on bright video.
    // Skipped in fullscreen so the video stays clean.
    if (vizPosition !== 'fullscreen') {
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
      const dark = `rgba(0,0,0,${(vizOpacity * 0.42).toFixed(3)})`;
      const clear = 'rgba(0,0,0,0)';
      if (vizPosition === 'top') {
        grad.addColorStop(0, dark); grad.addColorStop(1, clear);
      } else if (vizPosition === 'centered') {
        grad.addColorStop(0, clear); grad.addColorStop(0.5, dark); grad.addColorStop(1, clear);
      } else {
        grad.addColorStop(0, clear); grad.addColorStop(1, dark);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, y0, canvas.width, h);
    }

    // Downsample to ~140 points for a smooth curve
    const POINTS = 140;
    const stride = Math.max(1, Math.floor(data.length / POINTS));
    const points = [];
    for (let i = 0; i < POINTS; i++) {
      const idx = i * stride;
      const v = (data[idx] - 128) / 128.0;
      const x = (i / (POINTS - 1)) * canvas.width;
      const y = centerY + v * amp;
      points.push({ x, y });
    }

    // Build smooth path: quadratic curve through midpoints between consecutive
    // sample points. This is the classic "smoothing by midpoint" technique and
    // looks substantially more elegant than connecting points with lines.
    ctx.save();
    ctx.lineWidth = 1.6;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';
    ctx.shadowBlur  = Math.max(6, Math.min(canvas.width, h) * 0.035);
    ctx.shadowColor = rgba(vizColor, 0.9);
    ctx.strokeStyle = rgba(vizColor, vizOpacity);

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length - 1; i++) {
      const mx = (points[i].x + points[i + 1].x) / 2;
      const my = (points[i].y + points[i + 1].y) / 2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  // ── Thin Bars ─────────────────────────────────────────────────────────
  // Pixel-perfect 2px bars with 4px stride, log-frequency mapping, cube-root
  // amplitude scale, peak-smoothed across frames, and rounded top caps.
  let barPeaks = null; // sticky per-bar peak values for soft motion
  function drawBars() {
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    const { y: y0, h } = getBand();

    const stride  = 4;           // gap-friendly stride
    const barW    = 2;
    const numBars = Math.max(40, Math.floor(canvas.width / stride));
    const startX  = Math.floor((canvas.width - numBars * stride) / 2);

    const minBin = 2;
    const maxBin = maxFreqBin(bufLen);
    const logMin = Math.log(minBin);
    const logMax = Math.log(maxBin);

    if (!barPeaks || barPeaks.length !== numBars) barPeaks = new Float32Array(numBars);

    // Vertical gradient fill if user picked one; otherwise solid color.
    let fillStyle;
    if (vizGradient && vizGradient.length >= 2) {
      const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
      vizGradient.forEach((color, i) => {
        const t = i / (vizGradient.length - 1);
        grad.addColorStop(t, rgba(color, vizOpacity));
      });
      fillStyle = grad;
    } else {
      fillStyle = rgba(vizColor, vizOpacity);
    }

    ctx.save();
    ctx.fillStyle = fillStyle;
    // Soft halo so bars feel like glowing tubes rather than rectangles
    ctx.shadowBlur  = Math.max(4, h * 0.05);
    ctx.shadowColor = rgba(vizColor, 0.6);

    for (let i = 0; i < numBars; i++) {
      const tA = i       / numBars;
      const tB = (i + 1) / numBars;
      const lo = Math.max(minBin, Math.floor(Math.exp(logMin + tA * (logMax - logMin))));
      const hi = Math.max(lo + 1, Math.floor(Math.exp(logMin + tB * (logMax - logMin))));
      let sum = 0;
      for (let j = lo; j < hi && j < bufLen; j++) sum += data[j];
      const avg = sum / (hi - lo);
      const norm = Math.cbrt(avg / 255);

      // Smooth attack/decay so adjacent frames don't pop
      const target = norm;
      const prev = barPeaks[i];
      const next = target > prev ? prev * 0.5 + target * 0.5 : prev * 0.82 + target * 0.18;
      barPeaks[i] = next;

      const barH = Math.max(2, next * h);
      const barY = vizPosition === 'top' ? y0 : y0 + h - barH;
      const x = startX + i * stride;

      // Rounded top cap on bottom-anchored bars; rounded bottom on top-anchored
      const r = Math.min(barW / 2, barH / 2);
      ctx.beginPath();
      if (vizPosition === 'top') {
        ctx.moveTo(x, barY);
        ctx.lineTo(x + barW, barY);
        ctx.lineTo(x + barW, barY + barH - r);
        ctx.quadraticCurveTo(x + barW, barY + barH, x + barW - r, barY + barH);
        ctx.lineTo(x + r, barY + barH);
        ctx.quadraticCurveTo(x, barY + barH, x, barY + barH - r);
        ctx.closePath();
      } else {
        ctx.moveTo(x, barY + r);
        ctx.quadraticCurveTo(x, barY, x + r, barY);
        ctx.lineTo(x + barW - r, barY);
        ctx.quadraticCurveTo(x + barW, barY, x + barW, barY + r);
        ctx.lineTo(x + barW, barY + barH);
        ctx.lineTo(x, barY + barH);
        ctx.closePath();
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Smooth Spectrum ───────────────────────────────────────────────────
  function drawSpectrum() {
    const bufLen = analyser.frequencyBinCount;
    const data   = new Uint8Array(bufLen);
    analyser.getByteFrequencyData(data);

    const { y: y0, h } = getBand();

    const numBars = 200;
    const slotW   = canvas.width / numBars;
    const minBin  = 2;
    const maxBin  = maxFreqBin(bufLen);
    const logMin  = Math.log(minBin);
    const logMax  = Math.log(maxBin);

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
      const x  = i * slotW;
      const xN = (i + 1) * slotW;
      ctx.fillRect(Math.round(x), barY, Math.round(xN) - Math.round(x), barH);
    }
  }

  // ── Song title / artist text overlay ──────────────────────────────────
  function drawTextOverlay() {
    const titleOn = textCfg.showSongTitle && textCfg.songTitle.trim();
    const artistOn = textCfg.showArtistName && textCfg.artistName.trim();
    if (!titleOn && !artistOn) return;

    const fontStack = FONT_FAMILY_MAP[textCfg.textFont] || FONT_FAMILY_MAP.Inter;
    const titleSize = Math.max(14, Math.round(canvas.height * (textCfg.textSize / 100)));
    const artistSize = Math.round(titleSize * 0.62);
    const gap = Math.round(titleSize * 0.18);

    // Block height = sum of lines + gap when both shown
    const blockH =
      (titleOn ? titleSize : 0) +
      (titleOn && artistOn ? gap : 0) +
      (artistOn ? artistSize : 0);

    const margin = Math.max(20, Math.round(canvas.height * 0.06));
    // First-line size sets where the baseline of the top line sits.
    const firstLineSize = titleOn ? titleSize : artistSize;
    let firstBaselineY;
    if (textCfg.textPosition === 'top')         firstBaselineY = margin + firstLineSize * 0.85;
    else if (textCfg.textPosition === 'center') firstBaselineY = (canvas.height - blockH) / 2 + firstLineSize * 0.85;
    else                                         firstBaselineY = canvas.height - margin - blockH + firstLineSize * 0.85;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const cx = canvas.width / 2;

    function paintText(str, sizePx, y) {
      ctx.font = `600 ${sizePx}px ${fontStack}`;
      const fill = textCfg.textColor || '#ffffff';

      if (textCfg.textGlow === 'soft') {
        ctx.shadowColor = rgba(fill, 0.65);
        ctx.shadowBlur  = sizePx * 0.45;
        ctx.shadowOffsetY = 0;
      } else if (textCfg.textGlow === 'strong') {
        // Two-pass glow: render a wider, more diffuse halo first, then sharp on top
        ctx.shadowColor = rgba(fill, 0.85);
        ctx.shadowBlur  = sizePx * 0.95;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = rgba(fill, 0.55);
        ctx.fillText(str, cx, y);
        ctx.shadowBlur  = sizePx * 0.55;
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur  = 0;
        ctx.shadowOffsetY = Math.max(1, sizePx * 0.04);
      }
      ctx.fillStyle = fill;
      ctx.fillText(str, cx, y);
      ctx.shadowOffsetY = 0;
    }

    let y = firstBaselineY;
    if (titleOn) {
      paintText(textCfg.songTitle.trim(), titleSize, y);
      // Move baseline to the artist line: descend by remaining title height +
      // gap + ascender of artist (~0.85 × artistSize).
      y += (titleSize - titleSize * 0.85) + gap + artistSize * 0.85;
    }
    if (artistOn) {
      ctx.globalAlpha = 0.88;
      paintText(textCfg.artistName.trim(), artistSize, y);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
})();
