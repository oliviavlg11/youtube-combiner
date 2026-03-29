(function() {
  const exportBtn = document.getElementById('export-btn');
  const progressSection = document.getElementById('progress-section');
  const stageLabel = document.getElementById('stage-label');
  const pctLabel = document.getElementById('pct-label');
  const progressBar = document.getElementById('progress-bar');
  const exportActions = document.getElementById('export-actions');
  const resolutionSel = document.getElementById('resolution');
  const fpsSel = document.getElementById('fps');
  const vbitrateRange = document.getElementById('video-bitrate');
  const vbitrateLabel = document.getElementById('vbitrate-label');
  const audioBitrateSel = document.getElementById('audio-bitrate');
  const hwAccelToggle = document.getElementById('hw-accel');
  const vizTypeSel = document.getElementById('viz-type');
  const vizOptions = document.getElementById('viz-options');
  const vizColorInput = document.getElementById('viz-color');
  const vizPositionSel = document.getElementById('viz-position');
  const vizHeightRange = document.getElementById('viz-height');
  const vizHeightLabel = document.getElementById('viz-height-label');
  const vizOpacityRange = document.getElementById('viz-opacity');
  const vizOpacityLabel = document.getElementById('viz-opacity-label');

  const STAGE_LABELS = {
    starting: 'Starting...',
    concat_audio: 'Encoding audio...',
    loop_video: 'Encoding video...',
    done: 'Done!',
    error: 'Export failed',
    cancelled: 'Cancelled',
  };

  const PORTRAIT_RESOLUTIONS = [
    { value: '1080x1920', label: '1080p (1080x1920)' },
    { value: '720x1280',  label: '720p (720x1280)'   },
  ];
  const LANDSCAPE_RESOLUTIONS = [
    { value: '1920x1080', label: '1080p (1920x1080)' },
    { value: '1280x720',  label: '720p (1280x720)'   },
    { value: '3840x2160', label: '4K (3840x2160)'    },
  ];

  let currentFormat = 'landscape';
  let currentJobId = null;
  let eventSource = null;

  // Format tabs
  document.querySelectorAll('.format-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.format-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFormat = tab.dataset.format;
      updateResolutionOptions(currentFormat);
      saveSettings();
    });
  });

  function updateResolutionOptions(format) {
    const options = format === 'portrait' ? PORTRAIT_RESOLUTIONS : LANDSCAPE_RESOLUTIONS;
    resolutionSel.innerHTML = options.map((o, i) =>
      `<option value="${o.value}"${i === 0 ? ' selected' : ''}>${o.label}</option>`
    ).join('');
    window.dispatchEvent(new CustomEvent('format-changed', { detail: { format } }));
  }

  // Update bitrate label
  vbitrateRange.addEventListener('input', () => {
    vbitrateLabel.textContent = `${vbitrateRange.value}k`;
    saveSettings();
  });

  // Save settings on any change
  [resolutionSel, fpsSel, audioBitrateSel].forEach(el => el.addEventListener('change', saveSettings));
  hwAccelToggle.addEventListener('change', saveSettings);

  // Viz controls
  vizTypeSel.addEventListener('change', () => {
    const hasViz = vizTypeSel.value !== 'none';
    vizOptions.classList.toggle('visible', hasViz);
    dispatchVizChanged();
    saveSettings();
  });
  vizColorInput.addEventListener('input', () => {
    dispatchVizChanged();
    saveSettings();
  });

  function dispatchVizChanged() {
    window.dispatchEvent(new CustomEvent('viz-settings-changed', {
      detail: {
        type:     vizTypeSel.value,
        color:    vizColorInput.value,
        opacity:  vizOpacityRange.value / 100,
        position: vizPositionSel.value,
        height:   vizHeightRange.value / 100,
      },
    }));
  }
  vizHeightRange.addEventListener('input', () => {
    vizHeightLabel.textContent = `${vizHeightRange.value}%`;
    dispatchVizChanged();
    saveSettings();
  });
  vizOpacityRange.addEventListener('input', () => {
    vizOpacityLabel.textContent = `${vizOpacityRange.value}%`;
    window.dispatchEvent(new CustomEvent('viz-settings-changed', {
      detail: { type: vizTypeSel.value, color: vizColorInput.value, opacity: vizOpacityRange.value / 100 },
    }));
    saveSettings();
  });
  vizPositionSel.addEventListener('change', () => { dispatchVizChanged(); saveSettings(); });

  function saveSettings() {
    fetch('/api/session/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolution: resolutionSel.value,
        fps: Number(fpsSel.value),
        videoBitrate: `${vbitrateRange.value}k`,
        audioBitrate: audioBitrateSel.value,
        useHardwareAccel: hwAccelToggle.checked,
        format: currentFormat,
        visualizer: vizTypeSel.value,
        vizColor: vizColorInput.value,
        vizOpacity: vizOpacityRange.value / 100,
        vizPosition: vizPositionSel.value,
        vizHeight: Number(vizHeightRange.value),
      }),
    }).catch(() => {});
  }

  // Expose current settings for preset saving
  appState.getSettings = function() {
    return {
      resolution: resolutionSel.value,
      fps: Number(fpsSel.value),
      videoBitrate: `${vbitrateRange.value}k`,
      audioBitrate: audioBitrateSel.value,
      useHardwareAccel: hwAccelToggle.checked,
      format: currentFormat,
      visualizer: vizTypeSel.value,
      vizColor: vizColorInput.value,
      vizOpacity: vizOpacityRange.value / 100,
      vizPosition: vizPositionSel.value,
      vizHeight: Number(vizHeightRange.value),
    };
  };

  // Start export
  exportBtn.addEventListener('click', async () => {
    exportBtn.disabled = true;
    progressSection.className = 'progress-section visible';
    exportActions.innerHTML = '';
    setProgress('starting', 0);

    try {
      const res = await fetch('/api/export', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');
      currentJobId = data.jobId;
      startProgressStream(data.jobId);
    } catch (err) {
      setProgress('error', 0);
      stageLabel.textContent = err.message;
      exportBtn.disabled = false;
      showToast(err.message, true);
    }
  });

  let stallTimer = null;
  let lastPercent = -1;
  let reconnectAttempts = 0;

  function startProgressStream(jobId) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/export/progress/${jobId}`);

    reconnectAttempts = 0;
    clearStallTimer();

    // Add cancel button
    exportActions.innerHTML = `<button class="btn btn-danger" id="cancel-btn">Cancel</button>`;
    document.getElementById('cancel-btn').addEventListener('click', () => cancelExport(jobId));

    eventSource.onmessage = e => {
      const data = JSON.parse(e.data);
      setProgress(data.stage, data.percent || 0);

      // Reset stall detector whenever progress changes
      if (data.percent !== lastPercent) {
        lastPercent = data.percent;
        clearStallTimer();
        startStallTimer(jobId);
      }

      if (data.stage === 'done') {
        clearStallTimer();
        eventSource.close();
        exportActions.innerHTML = `
          <div class="filename-row">
            <input type="text" id="filename-input" class="filename-input" value="my-video" placeholder="File name" spellcheck="false">
            <span class="filename-ext">.mp4</span>
          </div>
          <div class="filename-btns">
            <a class="btn btn-success" id="download-btn" href="/api/export/download/${jobId}">
              Download MP4
            </a>
            <button class="btn btn-secondary" id="new-export-btn">New Export</button>
          </div>
        `;
        const downloadBtn = document.getElementById('download-btn');
        const filenameInput = document.getElementById('filename-input');

        function updateDownloadName() {
          const name = encodeURIComponent(filenameInput.value.trim() || 'my-video');
          downloadBtn.href = `/api/export/download/${jobId}?filename=${name}`;
        }
        updateDownloadName();
        filenameInput.addEventListener('input', updateDownloadName);

        document.getElementById('new-export-btn').addEventListener('click', resetExport);
        exportBtn.disabled = false;
        showToast('Export complete! Name your file and download.');
      }

      if (data.stage === 'error') {
        clearStallTimer();
        eventSource.close();
        stageLabel.textContent = `Error: ${data.message}`;
        exportActions.innerHTML = `<button class="btn btn-secondary" id="new-export-btn">Try Again</button>`;
        document.getElementById('new-export-btn').addEventListener('click', resetExport);
        exportBtn.disabled = false;
        showToast(data.message || 'Export failed', true);
      }

      if (data.stage === 'cancelled') {
        clearStallTimer();
        eventSource.close();
        resetExport();
      }
    };

    eventSource.onerror = () => {
      if (!currentJobId) return;
      reconnectAttempts++;
      if (reconnectAttempts > 5) {
        // Job likely gone — stop looping and offer a reset
        eventSource.close();
        showForceResetButton();
        return;
      }
      setTimeout(() => {
        if (currentJobId) startProgressStream(currentJobId);
      }, 2000);
    };
  }

  function startStallTimer(jobId) {
    stallTimer = setTimeout(() => {
      // No progress for 90 seconds — warn and offer force-cancel
      showForceResetButton();
    }, 90_000);
  }

  function clearStallTimer() {
    clearTimeout(stallTimer);
    stallTimer = null;
  }

  function showForceResetButton() {
    // Only add if not already there
    if (document.getElementById('force-reset-btn')) return;
    exportActions.innerHTML = `
      <p class="stall-warning">Export appears stuck.</p>
      <button class="btn btn-danger" id="force-reset-btn">Force Cancel &amp; Reset</button>
    `;
    document.getElementById('force-reset-btn').addEventListener('click', async () => {
      if (eventSource) eventSource.close();
      await fetch('/api/export/active', { method: 'DELETE' }).catch(() => {});
      resetExport();
    });
  }

  async function cancelExport(jobId) {
    clearStallTimer();
    if (eventSource) eventSource.close();
    await fetch(`/api/export/${jobId}`, { method: 'DELETE' }).catch(() => {});
    resetExport();
  }

  function resetExport() {
    clearStallTimer();
    currentJobId = null;
    lastPercent = -1;
    reconnectAttempts = 0;
    if (eventSource) { eventSource.close(); eventSource = null; }
    progressSection.className = 'progress-section';
    exportActions.innerHTML = '';
    exportBtn.disabled = !(appState.playlist.length > 0 && appState.video);
  }

  function setProgress(stage, pct) {
    stageLabel.textContent = STAGE_LABELS[stage] || stage;
    pctLabel.textContent = `${Math.round(pct)}%`;
    progressBar.style.width = `${pct}%`;
  }

  // Restore settings from session; surface any in-progress export
  window.addEventListener('session-loaded', e => {
    applySettings(e.detail.settings || {});
    if (e.detail.activeExport) {
      showResumeModal(e.detail.activeExport);
    }
  });

  function showResumeModal({ jobId, stage, percent }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">Export In Progress</div>
        <div class="modal-body">
          An export is still running in the background.
          <span class="modal-stage">${STAGE_LABELS[stage] || stage} &mdash; ${Math.round(percent)}%</span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel-export-btn">Cancel Export</button>
          <button class="btn btn-primary" id="modal-continue-btn">Continue</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('modal-continue-btn').addEventListener('click', () => {
      overlay.remove();
      currentJobId = jobId;
      exportBtn.disabled = true;
      progressSection.className = 'progress-section visible';
      exportActions.innerHTML = '';
      setProgress(stage, percent);
      startProgressStream(jobId);
    });

    document.getElementById('modal-cancel-export-btn').addEventListener('click', async () => {
      overlay.remove();
      await fetch(`/api/export/${jobId}`, { method: 'DELETE' }).catch(() => {});
    });
  }

  // Apply a settings object to all controls (used by session restore + preset load)
  function applySettings(s) {
    if (s.format && s.format === 'portrait') {
      currentFormat = 'portrait';
      document.querySelectorAll('.format-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.format === 'portrait');
      });
      updateResolutionOptions('portrait');
    } else if (s.format === 'landscape') {
      currentFormat = 'landscape';
      document.querySelectorAll('.format-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.format === 'landscape');
      });
      updateResolutionOptions('landscape');
    }
    if (s.resolution) resolutionSel.value = s.resolution;
    if (s.fps) fpsSel.value = String(s.fps);
    if (s.videoBitrate) {
      const num = parseInt(s.videoBitrate);
      vbitrateRange.value = num;
      vbitrateLabel.textContent = `${num}k`;
    }
    if (s.audioBitrate) audioBitrateSel.value = s.audioBitrate;
    if (s.useHardwareAccel !== undefined) hwAccelToggle.checked = !!s.useHardwareAccel;
    if (s.visualizer) {
      vizTypeSel.value = s.visualizer;
      vizOptions.classList.toggle('visible', s.visualizer !== 'none');
    }
    if (s.vizColor) vizColorInput.value = s.vizColor;
    if (s.vizOpacity !== undefined) {
      const pct = Math.round(s.vizOpacity * 100);
      vizOpacityRange.value = pct;
      vizOpacityLabel.textContent = `${pct}%`;
    }
    if (s.vizPosition) vizPositionSel.value = s.vizPosition;
    if (s.vizHeight) {
      vizHeightRange.value = s.vizHeight;
      vizHeightLabel.textContent = `${s.vizHeight}%`;
    }
    dispatchVizChanged();
  }

  // Load preset
  window.addEventListener('preset-load', e => {
    applySettings(e.detail);
    saveSettings();
  });
})();
