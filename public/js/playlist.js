(function() {
  const dropZone = document.getElementById('audio-drop-zone');
  const fileInput = document.getElementById('audio-input');
  const listEl = document.getElementById('playlist');
  const totalEl = document.getElementById('playlist-total');
  const totalDurEl = document.getElementById('total-duration');
  const trackCountEl = document.getElementById('track-count');
  const loopToggle = document.getElementById('loop-toggle');
  const loopCountRow = document.getElementById('loop-count-row');
  const loopCountInput = document.getElementById('loop-count');
  const loopCountDisplay = document.getElementById('loop-count-display');
  const loopCountDec = document.getElementById('loop-count-dec');
  const loopCountInc = document.getElementById('loop-count-inc');

  let dragSrcId = null;

  function getLoopCount() {
    return parseInt(loopCountInput.value) || 1;
  }

  function updateTotal() {
    const tracks = appState.playlist;
    const singlePass = tracks.reduce((s, t) => s + t.duration, 0);
    const multiplier = loopToggle.checked ? getLoopCount() : 1;
    const total = singlePass * multiplier;
    if (tracks.length) {
      totalDurEl.textContent = formatDuration(total);
      totalEl.style.display = 'flex';
    } else {
      totalEl.style.display = 'none';
    }
    window.dispatchEvent(new CustomEvent('playlist-duration-changed', { detail: { total } }));
  }

  function render() {
    const tracks = appState.playlist;
    listEl.innerHTML = '';
    tracks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = 'playlist-item';
      li.draggable = true;
      li.dataset.id = t.id;
      li.innerHTML = `
        <span class="drag-handle">&#8801;</span>
        <span class="track-num">${i + 1}</span>
        <span class="track-name" title="${escHtml(t.originalName)}">${escHtml(t.originalName)}</span>
        <span class="track-duration">${formatDuration(t.duration)}</span>
        <button class="remove-btn" data-id="${t.id}" title="Remove">&#x2715;</button>
      `;
      listEl.appendChild(li);
    });
    trackCountEl.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
    updateTotal();
    checkExportReady();
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Upload files
  async function uploadFiles(files) {
    const formData = new FormData();
    for (const f of files) formData.append('files', f);
    try {
      const res = await fetch('/api/upload/audio', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      appState.playlist.push(...data);
      render();
      savePlaylistOrder();
      showToast(`Added ${data.length} track${data.length !== 1 ? 's' : ''}`);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // Remove track
  listEl.addEventListener('click', async e => {
    const btn = e.target.closest('.remove-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      await fetch(`/api/upload/audio/${id}`, { method: 'DELETE' });
      appState.playlist = appState.playlist.filter(t => t.id !== id);
      render();
      savePlaylistOrder();
    } catch (err) {
      showToast('Failed to remove track', true);
    }
  });

  // Drag and drop reorder
  listEl.addEventListener('dragstart', e => {
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    dragSrcId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  listEl.addEventListener('dragover', e => {
    e.preventDefault();
    const li = e.target.closest('.playlist-item');
    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('drag-target'));
    if (li && li.dataset.id !== dragSrcId) li.classList.add('drag-target');
    e.dataTransfer.dropEffect = 'move';
  });

  listEl.addEventListener('dragleave', () => {
    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('drag-target'));
  });

  listEl.addEventListener('drop', e => {
    e.preventDefault();
    document.querySelectorAll('.playlist-item').forEach(el => {
      el.classList.remove('drag-target', 'dragging');
    });
    const li = e.target.closest('.playlist-item');
    if (!li || !dragSrcId || li.dataset.id === dragSrcId) return;
    const srcIdx = appState.playlist.findIndex(t => t.id === dragSrcId);
    const tgtIdx = appState.playlist.findIndex(t => t.id === li.dataset.id);
    const [item] = appState.playlist.splice(srcIdx, 1);
    appState.playlist.splice(tgtIdx, 0, item);
    render();
    savePlaylistOrder();
    dragSrcId = null;
  });

  listEl.addEventListener('dragend', () => {
    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('dragging', 'drag-target'));
    dragSrcId = null;
  });

  // Touch drag-and-drop for mobile
  let touchDragId = null;
  let touchClone = null;

  listEl.addEventListener('touchstart', e => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const li = handle.closest('.playlist-item');
    if (!li) return;
    touchDragId = li.dataset.id;
    li.classList.add('dragging');

    // Create a floating clone
    const rect = li.getBoundingClientRect();
    touchClone = li.cloneNode(true);
    touchClone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:0.85;pointer-events:none;z-index:999;border-radius:6px;`;
    document.body.appendChild(touchClone);
  }, { passive: true });

  listEl.addEventListener('touchmove', e => {
    if (!touchDragId || !touchClone) return;
    e.preventDefault();
    const touch = e.touches[0];
    touchClone.style.top = `${touch.clientY - 20}px`;

    // Highlight item under finger
    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('drag-target'));
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const target = el && el.closest('.playlist-item');
    if (target && target.dataset.id !== touchDragId) target.classList.add('drag-target');
  }, { passive: false });

  listEl.addEventListener('touchend', e => {
    if (!touchDragId) return;
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const target = el && el.closest('.playlist-item');

    if (target && target.dataset.id !== touchDragId) {
      const srcIdx = appState.playlist.findIndex(t => t.id === touchDragId);
      const tgtIdx = appState.playlist.findIndex(t => t.id === target.dataset.id);
      const [item] = appState.playlist.splice(srcIdx, 1);
      appState.playlist.splice(tgtIdx, 0, item);
      render();
      savePlaylistOrder();
    }

    document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('dragging', 'drag-target'));
    if (touchClone) { touchClone.remove(); touchClone = null; }
    touchDragId = null;
  });

  // File input
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) uploadFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  // Drop zone drag events
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|aac|m4a|ogg)$/i.test(f.name));
    if (files.length) uploadFiles(files);
  });

  // Loop toggle
  loopToggle.addEventListener('change', () => {
    loopCountRow.className = loopToggle.checked ? 'loop-count-row visible' : 'loop-count-row';
    updateTotal();
    savePlaylistOrder();
  });

  // +/- buttons
  loopCountDec.addEventListener('click', () => {
    const val = Math.max(1, getLoopCount() - 1);
    loopCountInput.value = val;
    loopCountDisplay.textContent = val;
    loopCountDec.disabled = val <= 1;
    loopCountInc.disabled = val >= 10;
    updateTotal();
    savePlaylistOrder();
  });

  loopCountInc.addEventListener('click', () => {
    const val = Math.min(10, getLoopCount() + 1);
    loopCountInput.value = val;
    loopCountDisplay.textContent = val;
    loopCountDec.disabled = val <= 1;
    loopCountInc.disabled = val >= 10;
    updateTotal();
    savePlaylistOrder();
  });

  function savePlaylistOrder() {
    const order = appState.playlist.map(t => t.id);
    const loop = loopToggle.checked;
    const loopCount = loop ? getLoopCount() : 1;
    fetch('/api/session/playlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order, loop, loopCount }),
    }).catch(() => {});
  }

  // Restore session state
  window.addEventListener('session-loaded', e => {
    const { settings } = e.detail;
    if (settings.loop) {
      loopToggle.checked = true;
      loopCountRow.className = 'loop-count-row visible';
    }
    if (settings.loopCount && settings.loopCount >= 1) {
      const val = Math.min(10, Math.max(1, settings.loopCount));
      loopCountInput.value = val;
      loopCountDisplay.textContent = val;
      loopCountDec.disabled = val <= 1;
      loopCountInc.disabled = val >= 10;
    }
    render();
  });
})();
