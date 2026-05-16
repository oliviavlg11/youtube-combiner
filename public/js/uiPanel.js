(function() {
  // ── Visualizer card grid → hidden select ────────────────────────────
  const vizCards = document.querySelectorAll('.viz-card');
  const vizSelect = document.getElementById('viz-type');

  vizCards.forEach(card => {
    card.addEventListener('click', () => {
      const val = card.dataset.viz;
      vizCards.forEach(c => {
        const on = c === card;
        c.classList.toggle('active', on);
        c.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      if (vizSelect.value !== val) {
        vizSelect.value = val;
        vizSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      updateSummary();
    });
  });

  // Keep cards in sync if select is set programmatically (preset / session load)
  vizSelect.addEventListener('change', () => {
    vizCards.forEach(c => {
      const on = c.dataset.viz === vizSelect.value;
      c.classList.toggle('active', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    updateSummary();
  });

  // ── Position segmented control → hidden select ──────────────────────
  const segBtns = document.querySelectorAll('.seg-btn[data-pos]');
  const posSelect = document.getElementById('viz-position');
  segBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      segBtns.forEach(b => b.classList.toggle('active', b === btn));
      if (posSelect.value !== btn.dataset.pos) {
        posSelect.value = btn.dataset.pos;
        posSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      updateSummary();
    });
  });
  posSelect.addEventListener('change', () => {
    segBtns.forEach(b => b.classList.toggle('active', b.dataset.pos === posSelect.value));
    updateSummary();
  });

  // ── Color style swatches → #viz-color ────────────────────────────────
  const swatches = document.querySelectorAll('.swatch');
  const vizColor = document.getElementById('viz-color');
  const gradientPanel = document.getElementById('gradient-pickers');
  const gradientStops = Array.from(document.querySelectorAll('#gradient-pickers input[type="color"]'));
  const gradientSwatch = document.getElementById('swatch-gradient');
  const gradientCircle = document.getElementById('swatch-gradient-circle');

  function setActiveSwatch(el) {
    swatches.forEach(s => s.classList.remove('active'));
    el.classList.add('active');
  }

  function emitGradient(stops) {
    window.dispatchEvent(new CustomEvent('viz-gradient-changed', { detail: { stops } }));
  }

  function readGradientStops() {
    return gradientStops.map(i => i.value);
  }

  function refreshGradientCircle() {
    const [a, b, c] = readGradientStops();
    gradientCircle.style.background = `linear-gradient(180deg, ${a} 0%, ${b} 50%, ${c} 100%)`;
    gradientStops.forEach(input => {
      const dot = input.parentElement.querySelector('.grad-stop-circle');
      if (dot) dot.style.background = input.value;
    });
  }

  swatches.forEach(sw => {
    sw.addEventListener('click', e => {
      if (sw === gradientSwatch) {
        e.preventDefault();
        setActiveSwatch(sw);
        gradientPanel.hidden = false;
        emitGradient(readGradientStops());
        return;
      }
      if (sw.classList.contains('swatch-custom')) {
        gradientPanel.hidden = true;
        emitGradient(null);
        setActiveSwatch(sw);
        return;
      }
      const input = sw.querySelector('input[type="radio"]');
      if (!input) return;
      e.preventDefault();
      setActiveSwatch(sw);
      gradientPanel.hidden = true;
      emitGradient(null);
      vizColor.value = input.value;
      vizColor.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  gradientStops.forEach(input => {
    input.addEventListener('input', () => {
      refreshGradientCircle();
      if (!gradientPanel.hidden) emitGradient(readGradientStops());
    });
  });

  // Custom color picker — match a preset swatch or fall back to custom
  vizColor.addEventListener('input', () => {
    if (!gradientPanel.hidden) return; // ignore while gradient mode is active
    const matchingSwatch = Array.from(swatches).find(s => {
      const r = s.querySelector('input[type="radio"]');
      return r && r.value.toLowerCase() === vizColor.value.toLowerCase();
    });
    setActiveSwatch(matchingSwatch || document.querySelector('.swatch-custom'));
  });

  refreshGradientCircle();

  // ── Format tab labels for summary ────────────────────────────────────
  document.querySelectorAll('.format-tab[data-format]').forEach(t => {
    t.addEventListener('click', updateSummary);
  });

  // ── Header export button mirrors the main one ───────────────────────
  const headerBtn = document.getElementById('header-export-btn');
  const mainBtn = document.getElementById('export-btn');
  function syncHeaderBtn() {
    headerBtn.disabled = mainBtn.disabled;
    headerBtn.style.opacity = mainBtn.disabled ? '0.55' : '1';
    headerBtn.style.cursor = mainBtn.disabled ? 'not-allowed' : 'pointer';
  }
  headerBtn.addEventListener('click', () => {
    if (!mainBtn.disabled) mainBtn.click();
  });
  // Observe disabled changes on the main button
  new MutationObserver(syncHeaderBtn).observe(mainBtn, { attributes: true, attributeFilter: ['disabled'] });
  syncHeaderBtn();

  // ── Settings button: open the Advanced section in step 4 ────────────
  document.getElementById('settings-btn').addEventListener('click', () => {
    const det = document.querySelector('.advanced-section');
    if (det) {
      det.open = true;
      det.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  // ── Step 1 thumbnail mirrors the main player ─────────────────────────
  const thumbRow = document.getElementById('thumb-row');
  const thumbVideo = document.getElementById('thumb-video');
  const thumbRemoveBtn = document.getElementById('thumb-remove-btn');
  const videoDropZone = document.getElementById('video-drop-zone');
  const previewEmpty = document.getElementById('preview-empty');
  const mainRemoveBtn = document.getElementById('video-remove-btn');

  function refreshVideoUi() {
    if (appState.video && appState.video.filename) {
      thumbRow.classList.add('visible');
      videoDropZone.style.display = 'none';
      thumbVideo.src = `/uploads/video/${appState.video.filename}`;
      previewEmpty.classList.add('hidden');
    } else {
      thumbRow.classList.remove('visible');
      videoDropZone.style.display = '';
      thumbVideo.src = '';
      previewEmpty.classList.remove('hidden');
    }
  }
  thumbRemoveBtn.addEventListener('click', () => mainRemoveBtn.click());

  window.addEventListener('session-loaded', () => { refreshVideoUi(); updateSummary(); });
  // Poll appState.video after upload events
  const origCheck = window.checkExportReady;
  window.checkExportReady = function() {
    if (origCheck) origCheck();
    refreshVideoUi();
    updateSummary();
  };

  // ── Project Summary ──────────────────────────────────────────────────
  const sVid = document.getElementById('summary-video');
  const sSongs = document.getElementById('summary-songs');
  const sLoops = document.getElementById('summary-loops');
  const sViz = document.getElementById('summary-viz');
  const sFmt = document.getElementById('summary-format');
  const sDur = document.getElementById('summary-duration');

  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

  function updateSummary() {
    if (!sVid) return;
    sVid.textContent = appState.video ? appState.video.originalName : 'No video';
    const n = appState.playlist.length;
    sSongs.textContent = `${n} song${n === 1 ? '' : 's'}`;

    const loopToggle = document.getElementById('loop-toggle');
    const loopCount = parseInt(document.getElementById('loop-count').value, 10) || 1;
    const loops = loopToggle && loopToggle.checked ? loopCount : 1;
    sLoops.textContent = `${loops} time${loops === 1 ? '' : 's'}`;

    const vizName = capitalize(vizSelect.value || 'none');
    const posName = capitalize(posSelect.value || 'bottom');
    sViz.textContent = vizSelect.value === 'none' ? 'None' : `${vizName} (${posName})`;

    const activeFmt = document.querySelector('.format-tab.active');
    if (activeFmt) {
      const label = activeFmt.querySelector('.format-label')?.textContent || 'Landscape';
      const small = activeFmt.querySelector('small')?.textContent || '16:9';
      sFmt.textContent = `${label} (${small})`;
    }
  }

  window.addEventListener('playlist-duration-changed', e => {
    if (sDur) sDur.textContent = formatDuration(e.detail.total || 0);
    updateSummary();
  });

  document.getElementById('loop-toggle').addEventListener('change', updateSummary);
  document.getElementById('loop-count-inc').addEventListener('click', () => setTimeout(updateSummary, 0));
  document.getElementById('loop-count-dec').addEventListener('click', () => setTimeout(updateSummary, 0));

  // Initial paint
  setTimeout(() => { refreshVideoUi(); updateSummary(); }, 0);
})();
