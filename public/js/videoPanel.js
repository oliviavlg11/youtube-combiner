(function() {
  const dropZone = document.getElementById('video-drop-zone');
  const fileInput = document.getElementById('video-input');
  const previewEl = document.getElementById('video-preview');
  const playerEl = document.getElementById('video-player');
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
        // Sync video to same relative position within its loop
        if (playerEl.duration) {
          playerEl.currentTime = targetTime % playerEl.duration;
        }
        updateSeekbar(targetTime);
      }
    } else if (playerEl.duration) {
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
      playerEl.pause();
      if (audioEl) audioEl.pause();
      setPlaying(false);
    } else {
      playerEl.play().catch(() => {});
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

    dropZone.style.display = 'none';
    const portrait = previewEl.classList.contains('portrait');
    previewEl.className = 'video-preview visible' + (portrait ? ' portrait' : '');
    playerEl.src = `/uploads/video/${info.filename}`;
    playerEl.pause();
    playerEl.currentTime = 0;
    updateSeekbar(0);

    metaEl.innerHTML = [
      info.width ? `<div class="meta-item">Resolution: <span>${info.width}x${info.height}</span></div>` : '',
      info.fps ? `<div class="meta-item">FPS: <span>${Math.round(info.fps)}</span></div>` : '',
      `<div class="meta-item">Duration: <span>${formatDuration(info.duration)}</span></div>`,
      `<div class="meta-item">Size: <span>${(info.size / 1024 / 1024).toFixed(1)} MB</span></div>`,
    ].join('');

    const warnings = [];
    if (info.duration < 60) warnings.push('Video is under 1 minute — it will loop many times for long exports.');
    if (info.height && info.height < 720) warnings.push('Video resolution is below 720p. Output quality may be limited.');
    warningEl.style.display = warnings.length ? 'block' : 'none';
    warningEl.textContent = warnings.join(' ');

    checkExportReady();
  }

  function clearVideo() {
    stopAudio();
    setPlaying(false);
    trackIndex = 0;
    trackStartTime = 0;
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
    if (file && (file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name))) {
      uploadVideo(file);
    }
  });

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.addEventListener('session-loaded', e => {
    if (e.detail.video) showVideo(e.detail.video);
    if (e.detail.settings && e.detail.settings.format === 'portrait') {
      previewEl.classList.add('portrait');
    }
  });

  window.addEventListener('format-changed', e => {
    previewEl.classList.toggle('portrait', e.detail.format === 'portrait');
  });

  // visualizer.js asks for the current audio element when viz is enabled mid-playback
  window.addEventListener('request-audio-element', () => {
    if (audioEl) {
      window.dispatchEvent(new CustomEvent('audio-element-created', { detail: { audioEl } }));
    }
  });
})();
