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
      }),
    }).catch(() => {});
  }

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

  function startProgressStream(jobId) {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/export/progress/${jobId}`);

    // Add cancel button
    exportActions.innerHTML = `<button class="btn btn-danger" id="cancel-btn">Cancel</button>`;
    document.getElementById('cancel-btn').addEventListener('click', () => cancelExport(jobId));

    eventSource.onmessage = e => {
      const data = JSON.parse(e.data);
      setProgress(data.stage, data.percent || 0);

      if (data.stage === 'done') {
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
          const name = filenameInput.value.trim() || 'my-video';
          downloadBtn.setAttribute('download', `${name}.mp4`);
        }
        updateDownloadName();
        filenameInput.addEventListener('input', updateDownloadName);

        document.getElementById('new-export-btn').addEventListener('click', resetExport);
        exportBtn.disabled = false;
        showToast('Export complete! Name your file and download.');
      }

      if (data.stage === 'error') {
        eventSource.close();
        stageLabel.textContent = `Error: ${data.message}`;
        exportActions.innerHTML = `<button class="btn btn-secondary" id="new-export-btn">Try Again</button>`;
        document.getElementById('new-export-btn').addEventListener('click', resetExport);
        exportBtn.disabled = false;
        showToast(data.message || 'Export failed', true);
      }

      if (data.stage === 'cancelled') {
        eventSource.close();
        resetExport();
      }
    };

    eventSource.onerror = () => {
      // Try to reconnect if job is still running
      if (currentJobId) {
        setTimeout(() => startProgressStream(currentJobId), 1500);
      }
    };
  }

  async function cancelExport(jobId) {
    if (eventSource) eventSource.close();
    await fetch(`/api/export/${jobId}`, { method: 'DELETE' }).catch(() => {});
    resetExport();
  }

  function resetExport() {
    currentJobId = null;
    progressSection.className = 'progress-section';
    exportActions.innerHTML = '';
    exportBtn.disabled = !(appState.playlist.length > 0 && appState.video);
  }

  function setProgress(stage, pct) {
    stageLabel.textContent = STAGE_LABELS[stage] || stage;
    pctLabel.textContent = `${Math.round(pct)}%`;
    progressBar.style.width = `${pct}%`;
  }

  // Restore settings from session
  window.addEventListener('session-loaded', e => {
    const s = e.detail.settings || {};
    if (s.format && s.format === 'portrait') {
      currentFormat = 'portrait';
      document.querySelectorAll('.format-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.format === 'portrait');
      });
      updateResolutionOptions('portrait');
    }
    if (s.resolution) resolutionSel.value = s.resolution;
    if (s.fps) fpsSel.value = String(s.fps);
    if (s.videoBitrate) {
      const num = parseInt(s.videoBitrate);
      vbitrateRange.value = num;
      vbitrateLabel.textContent = `${num}k`;
    }
    if (s.audioBitrate) audioBitrateSel.value = s.audioBitrate;
    if (s.useHardwareAccel) hwAccelToggle.checked = true;
  });
})();
