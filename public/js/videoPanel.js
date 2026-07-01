(function() {
  const dropZone = document.getElementById('video-drop-zone');
  const fileInput = document.getElementById('video-input');
  const previewEl = document.getElementById('video-preview');
  const stageEl = document.querySelector('.preview-stage');
  const playerEl = document.getElementById('video-player');
  const imageEl = document.getElementById('image-player');
  const metaEl = document.getElementById('video-meta');
  const removeBtn = document.getElementById('video-remove-btn');
  const warningEl = document.getElementById('video-warning');
  const playBtn = document.getElementById('preview-play-btn');
  const playIcon = document.getElementById('preview-play-icon');
  const trackLabel = document.getElementById('preview-track-label');
  const seekbarTrack = document.getElementById('seekbar-track');
  const seekbarFill = document.getElementById('seekbar-fill');
  const seekbarThumb = document.getElementById('seekbar-thumb');
  const timeCurrent = document.getElementById('preview-time-current');
  const timeTotal = document.getElementById('preview-time-total');

  // Audio preview state
  let audioEl = null;
  let trackIndex = 0;
  let trackStartTime = 0; // elapsed audio time before the current track
  let isPlaying = false;
  let isSeeking = false;
  let playlistTotalDuration = 0; // kept in sync via playlist-duration-changed

  // True when the loaded media is a still image (no video to play/loop).
  // When true, the seekbar and play state are driven purely by the audio.
  function isImageMedia() {
    return !!(appState.video && appState.video.mediaType === 'image');
  }

  // ── Format-driven aspect + cover-mode pan ────────────────────────────
  // Preview stage matches the selected export format. The media inside is
  // rendered with object-fit:cover so what you see is what gets exported.

  const FORMAT_ASPECT = { landscape: 16 / 9, portrait: 9 / 16, square: 1 };

  let currentFormat = (appState.settings && appState.settings.format) || 'landscape';
  let offsetX = Number(appState.settings && appState.settings.mediaOffsetX) || 0;
  let offsetY = Number(appState.settings && appState.settings.mediaOffsetY) || 0;

  function applyStageAspect() {
    if (!stageEl) return;
    const aspect = FORMAT_ASPECT[currentFormat] || FORMAT_ASPECT.landscape;
    stageEl.style.aspectRatio = `${aspect}`;
  }

  function applyOffset() {
    // CSS variables consumed by .video-preview video/img object-position
    previewEl.style.setProperty('--offset-x', String(offsetX));
    previewEl.style.setProperty('--offset-y', String(offsetY));
    refreshDraggable();
  }

  // How much of the source overflows the canvas (in canvas pixels) when
  // scaled to cover. Returns { x, y } both >= 0. Either may be 0 when the
  // media already fills that axis exactly.
  function overflowPx() {
    if (!appState.video || !stageEl) return { x: 0, y: 0 };
    const { width: mediaW, height: mediaH } = appState.video;
    if (!mediaW || !mediaH) return { x: 0, y: 0 };
    const rect = stageEl.getBoundingClientRect();
    const stageW = rect.width;
    const stageH = rect.height;
    if (!stageW || !stageH) return { x: 0, y: 0 };
    const mediaAspect = mediaW / mediaH;
    const stageAspect = stageW / stageH;
    if (mediaAspect > stageAspect) {
      // Wider than canvas → fills height, overflows horizontally
      const scaledW = stageH * mediaAspect;
      return { x: Math.max(0, scaledW - stageW), y: 0 };
    }
    // Taller (or equal) → fills width, overflows vertically
    const scaledH = stageW / mediaAspect;
    return { x: 0, y: Math.max(0, scaledH - stageH) };
  }

  function refreshDraggable() {
    const { x, y } = overflowPx();
    // Threshold of 1px to avoid flicker from sub-pixel rounding
    previewEl.classList.toggle('draggable', x > 1 || y > 1);
  }

  // Persist the offset to the server (debounced).
  let saveOffsetTimer = null;
  function saveOffset() {
    clearTimeout(saveOffsetTimer);
    saveOffsetTimer = setTimeout(() => {
      fetch('/api/session/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaOffsetX: offsetX, mediaOffsetY: offsetY }),
      }).catch(() => {});
    }, 200);
  }

  function resetOffset() {
    offsetX = 0;
    offsetY = 0;
    applyOffset();
  }

  window.addEventListener('format-changed', ({ detail }) => {
    if (detail && detail.format) currentFormat = detail.format;
    applyStageAspect();
    requestAnimationFrame(refreshDraggable);
  });

  window.addEventListener('session-loaded', e => {
    const s = (e.detail && e.detail.settings) || {};
    if (s.format) currentFormat = s.format;
    if (typeof s.mediaOffsetX === 'number') offsetX = s.mediaOffsetX;
    if (typeof s.mediaOffsetY === 'number') offsetY = s.mediaOffsetY;
    applyStageAspect();
    applyOffset();
  });

  window.addEventListener('resize', refreshDraggable);

  // ── Drag-to-pan ──────────────────────────────────────────────────────
  // Mousedown on the play overlay (which covers the media). Treat as a click
  // unless the pointer moves past DRAG_THRESHOLD, then suppress the play
  // toggle and pan instead.

  const DRAG_THRESHOLD = 5;
  let dragState = null;

  function onPointerDown(e) {
    if (!appState.video) return;
    // Don't hijack the seekbar, remove button, or other controls
    if (e.target.closest('.preview-seekbar, .video-remove')) return;
    const { x: overX, y: overY } = overflowPx();
    if (overX <= 1 && overY <= 1) return; // nothing to pan

    const point = e.touches ? e.touches[0] : e;
    dragState = {
      startX: point.clientX,
      startY: point.clientY,
      baseOffsetX: offsetX,
      baseOffsetY: offsetY,
      overX,
      overY,
      moved: false,
      pointerId: e.pointerId,
    };
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragState.startX;
    const dy = point.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragState.moved) {
      dragState.moved = true;
      previewEl.classList.add('dragging');
    }
    // 1px of pointer movement = 1px of image movement; total range is overflow
    // (drag from one extreme to the other), which maps to offset delta of 2.
    if (dragState.overX > 1) {
      offsetX = Math.max(-1, Math.min(1, dragState.baseOffsetX + (2 * dx) / dragState.overX));
    }
    if (dragState.overY > 1) {
      offsetY = Math.max(-1, Math.min(1, dragState.baseOffsetY + (2 * dy) / dragState.overY));
    }
    applyOffset();
    if (e.cancelable) e.preventDefault();
  }

  function onPointerUp() {
    if (!dragState) return;
    const wasDrag = dragState.moved;
    dragState = null;
    previewEl.classList.remove('dragging');
    if (wasDrag) {
      saveOffset();
      // Swallow the synthetic click that follows on touch/mouse so the play
      // button doesn't toggle when we were actually dragging.
      const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
      previewEl.addEventListener('click', swallow, { capture: true, once: true });
    }
  }

  previewEl.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  previewEl.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
  window.addEventListener('touchcancel', onPointerUp);

  window.addEventListener('playlist-duration-changed', ({ detail: { total } }) => {
    playlistTotalDuration = total;
    // Refresh the seekbar total label immediately
    if (!isPlaying) updateSeekbar(audioPosition());
    timeTotal.textContent = formatDuration(playlistTotalDuration || (playerEl.duration || 0));
  });

  // ── Helpers ──────────────────────────────────────────

  function totalAudioDuration() {
    return playlistTotalDuration || appState.playlist.reduce((s, t) => s + t.duration, 0);
  }

  // Current elapsed position in the full audio timeline
  function audioPosition() {
    return trackStartTime + (audioEl ? (audioEl.currentTime || 0) : 0);
  }

  // Given a time T in the audio timeline, find which track + offset
  function resolveAudioPosition(t) {
    const tracks = appState.playlist;
    if (!tracks.length) return null;
    let elapsed = 0;
    for (let i = 0; i < tracks.length; i++) {
      if (t < elapsed + tracks[i].duration) {
        return { index: i, offset: t - elapsed, startTime: elapsed };
      }
      elapsed += tracks[i].duration;
    }
    // Past the end — clamp to last track's end
    const last = tracks.length - 1;
    return { index: last, offset: tracks[last].duration, startTime: elapsed - tracks[last].duration };
  }

  // ── Playback ─────────────────────────────────────────

  function setPlaying(val) {
    isPlaying = val;
    previewEl.classList.toggle('playing', val);
    playIcon.textContent = val ? '\u23F8' : '\u25B6';
    if (!val) trackLabel.textContent = '';
    window.dispatchEvent(new CustomEvent('viz-playback', { detail: { playing: val } }));
  }

  function stopAudio() {
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
      audioEl.onended = null;
      audioEl = null;
    }
  }

  function playTrackAt(index, offset) {
    const tracks = appState.playlist;
    if (!tracks.length) return;
    trackIndex = Math.min(index, tracks.length - 1);
    const track = tracks[trackIndex];
    if (!track || !track.filename) return;

    // Calculate how much time has elapsed before this track
    trackStartTime = tracks.slice(0, trackIndex).reduce((s, t) => s + t.duration, 0);

    stopAudio();
    audioEl = new Audio(`/uploads/audio/${track.filename}`);
    audioEl.currentTime = offset || 0;
    audioEl.volume = 1;
    trackLabel.textContent = track.originalName;
    // For an image (no looping video), the audio element is the only source
    // of timeupdate events, so the seekbar listens directly to it.
    audioEl.addEventListener('timeupdate', () => {
      if (isSeeking) return;
      updateSeekbar(audioPosition());
    });
    window.dispatchEvent(new CustomEvent('audio-element-created', { detail: { audioEl } }));
    if (isPlaying) audioEl.play().catch(() => {});

    audioEl.onended = () => {
      if (trackIndex + 1 < tracks.length) {
        playTrackAt(trackIndex + 1, 0);
      } else {
        // Playlist ended — stop
        stopAudio();
        setPlaying(false);
        playerEl.pause();
        updateSeekbar(0);
      }
    };
  }

  // ── Seek bar ─────────────────────────────────────────

  function updateSeekbar(audioPos) {
    const total = totalAudioDuration();
    const pct = total > 0 ? Math.min(100, (audioPos / total) * 100) : 0;
    seekbarFill.style.width = `${pct}%`;
    seekbarThumb.style.left = `${pct}%`;
    timeCurrent.textContent = formatDuration(audioPos);
    timeTotal.textContent = formatDuration(total || (playerEl.duration || 0));
  }

  // Update seekbar on every video frame (smoother than timeupdate)
  playerEl.addEventListener('timeupdate', () => {
    if (isSeeking) return;
    const pos = appState.playlist.length ? audioPosition() : (playerEl.currentTime || 0);
    updateSeekbar(pos);
  });

  playerEl.addEventListener('loadedmetadata', () => {
    timeTotal.textContent = formatDuration(totalAudioDuration() || playerEl.duration || 0);
  });

  function seekToPercent(pct) {
    const total = totalAudioDuration();
    if (total > 0 && appState.playlist.length) {
      // Seek in audio timeline
      const targetTime = pct * total;
      const resolved = resolveAudioPosition(targetTime);
      if (resolved) {
        playTrackAt(resolved.index, resolved.offset);
        // Sync video to same relative position within its loop (no-op for images)
        if (!isImageMedia() && playerEl.duration) {
          playerEl.currentTime = targetTime % playerEl.duration;
        }
        updateSeekbar(targetTime);
      }
    } else if (!isImageMedia() && playerEl.duration) {
      // No audio — just seek video
      playerEl.currentTime = pct * playerEl.duration;
      updateSeekbar(playerEl.currentTime);
    }
  }

  function getSeekPct(clientX) {
    const rect = seekbarTrack.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  seekbarTrack.addEventListener('mousedown', e => {
    isSeeking = true;
    seekToPercent(getSeekPct(e.clientX));
    e.stopPropagation();
  });
  window.addEventListener('mousemove', e => { if (isSeeking) seekToPercent(getSeekPct(e.clientX)); });
  window.addEventListener('mouseup', () => { isSeeking = false; });

  seekbarTrack.addEventListener('touchstart', e => {
    isSeeking = true;
    seekToPercent(getSeekPct(e.touches[0].clientX));
    e.stopPropagation();
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    if (isSeeking) seekToPercent(getSeekPct(e.touches[0].clientX));
  }, { passive: true });
  window.addEventListener('touchend', () => { isSeeking = false; });

  // ── Play / Pause ──────────────────────────────────────

  playBtn.addEventListener('click', () => {
    if (!appState.video) return;

    if (isPlaying) {
      if (!isImageMedia()) playerEl.pause();
      if (audioEl) audioEl.pause();
      setPlaying(false);
    } else {
      if (!isImageMedia()) playerEl.play().catch(() => {});
      setPlaying(true);
      if (appState.playlist.length) {
        if (audioEl) {
          audioEl.play().catch(() => {});
        } else {
          playTrackAt(trackIndex, 0);
        }
      }
    }
  });

  // ── Video load / clear ────────────────────────────────

  function showVideo(info) {
    appState.video = info;
    stopAudio();
    setPlaying(false);
    trackIndex = 0;
    trackStartTime = 0;
    // New media starts centered; the server reset is mirrored client-side so
    // the preview matches without waiting on the session round-trip.
    resetOffset();

    dropZone.style.display = 'none';
    const isImage = info.mediaType === 'image';
    previewEl.className = 'video-preview visible' + (isImage ? ' is-image' : '');
    applyStageAspect();

    if (isImage) {
      imageEl.src = `/uploads/video/${info.filename}`;
      playerEl.removeAttribute('src');
      playerEl.load();
    } else {
      imageEl.removeAttribute('src');
      playerEl.src = `/uploads/video/${info.filename}`;
      playerEl.pause();
      playerEl.currentTime = 0;
    }
    updateSeekbar(0);

    metaEl.innerHTML = [
      info.width ? `<div class="meta-item">Resolution: <span>${info.width}x${info.height}</span></div>` : '',
      !isImage && info.fps ? `<div class="meta-item">FPS: <span>${Math.round(info.fps)}</span></div>` : '',
      isImage
        ? `<div class="meta-item">Type: <span>Image</span></div>`
        : `<div class="meta-item">Duration: <span>${formatDuration(info.duration)}</span></div>`,
      `<div class="meta-item">Size: <span>${(info.size / 1024 / 1024).toFixed(1)} MB</span></div>`,
    ].join('');

    const warnings = [];
    if (!isImage && info.duration < 60) warnings.push('Video is under 1 minute — it will loop many times for long exports.');
    if (info.height && info.height < 720) {
      warnings.push(isImage
        ? 'Image resolution is below 720p. Output quality may be limited.'
        : 'Video resolution is below 720p. Output quality may be limited.');
    }
    warningEl.style.display = warnings.length ? 'block' : 'none';
    warningEl.textContent = warnings.join(' ');

    // Stage aspect ratio resolves on the next layout pass, after which we can
    // tell whether there's overflow to drag through.
    requestAnimationFrame(refreshDraggable);

    checkExportReady();
  }

  function clearVideo() {
    stopAudio();
    setPlaying(false);
    trackIndex = 0;
    trackStartTime = 0;
    appState.video = null;
    resetOffset();
    dropZone.style.display = '';
    previewEl.className = 'video-preview';
    // Keep the format-driven aspect — empty placeholder uses it too
    applyStageAspect();
    playerEl.removeAttribute('src');
    playerEl.load();
    imageEl.removeAttribute('src');
    metaEl.innerHTML = '';
    warningEl.style.display = 'none';
    checkExportReady();
  }

  async function uploadVideo(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload/video', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      showVideo(data);
      showToast('Video loaded');
    } catch (err) {
      showToast(err.message, true);
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
    if (!file) return;
    const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name);
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
    if (isVideo || isImage) uploadVideo(file);
  });

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.addEventListener('session-loaded', e => {
    if (e.detail.video) showVideo(e.detail.video);
  });

  // visualizer.js asks for the current audio element when viz is enabled mid-playback
  window.addEventListener('request-audio-element', () => {
    if (audioEl) {
      window.dispatchEvent(new CustomEvent('audio-element-created', { detail: { audioEl } }));
    }
  });
})();
