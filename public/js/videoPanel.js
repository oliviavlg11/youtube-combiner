(function() {
  const dropZone = document.getElementById('video-drop-zone');
  const fileInput = document.getElementById('video-input');
  const previewEl = document.getElementById('video-preview');
  const playerEl = document.getElementById('video-player');
  const metaEl = document.getElementById('video-meta');
  const removeBtn = document.getElementById('video-remove-btn');
  const warningEl = document.getElementById('video-warning');

  function showVideo(info) {
    appState.video = info;
    dropZone.style.display = 'none';
    previewEl.className = 'video-preview visible';
    playerEl.src = `/uploads/video/${info.filename}`;
    playerEl.play().catch(() => {});

    metaEl.innerHTML = [
      `<div class="meta-item">File: <span>${escHtml(info.originalName)}</span></div>`,
      info.width ? `<div class="meta-item">Resolution: <span>${info.width}x${info.height}</span></div>` : '',
      info.fps ? `<div class="meta-item">FPS: <span>${Math.round(info.fps)}</span></div>` : '',
      `<div class="meta-item">Duration: <span>${formatDuration(info.duration)}</span></div>`,
      `<div class="meta-item">Size: <span>${(info.size / 1024 / 1024).toFixed(1)} MB</span></div>`,
    ].join('');

    // Warnings
    const warnings = [];
    if (info.duration < 60) warnings.push('Video is under 1 minute — it will loop many times for long exports.');
    if (info.height && info.height < 720) warnings.push('Video resolution is below 720p. Output quality may be limited.');
    warningEl.style.display = warnings.length ? 'block' : 'none';
    warningEl.textContent = warnings.join(' ');

    checkExportReady();
  }

  function clearVideo() {
    appState.video = null;
    dropZone.style.display = '';
    previewEl.className = 'video-preview';
    playerEl.src = '';
    metaEl.innerHTML = '';
    warningEl.style.display = 'none';
    checkExportReady();
  }

  async function uploadVideo(file) {
    const formData = new FormData();
    formData.append('file', file);
    dropZone.querySelector('strong').textContent = 'Uploading...';
    try {
      const res = await fetch('/api/upload/video', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      showVideo(data);
      showToast('Video loaded');
    } catch (err) {
      showToast(err.message, true);
      dropZone.querySelector('strong').textContent = 'Drop video file here';
    }
  }

  removeBtn.addEventListener('click', async () => {
    await fetch('/api/upload/video', { method: 'DELETE' }).catch(() => {});
    clearVideo();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadVideo(fileInput.files[0]);
    fileInput.value = '';
  });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name))) {
      uploadVideo(file);
    }
  });

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Restore from session
  window.addEventListener('session-loaded', e => {
    if (e.detail.video) showVideo(e.detail.video);
  });
})();
