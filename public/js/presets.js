(function() {
  const STORAGE_KEY = 'ytPlayloop_presets';
  const presetSelect = document.getElementById('preset-select');
  const loadBtn = document.getElementById('preset-load-btn');
  const deleteBtn = document.getElementById('preset-delete-btn');
  const saveBtn = document.getElementById('preset-save-btn');

  function getPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch (_) { return []; }
  }

  function savePresets(presets) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function render(selectName) {
    const presets = getPresets();
    presetSelect.innerHTML = '<option value="">— Saved presets —</option>' +
      presets.map(p => `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`).join('');
    if (selectName) presetSelect.value = selectName;
    updateButtons();
  }

  function updateButtons() {
    const has = !!presetSelect.value;
    loadBtn.disabled = !has;
    deleteBtn.disabled = !has;
  }

  presetSelect.addEventListener('change', updateButtons);

  loadBtn.addEventListener('click', () => {
    const name = presetSelect.value;
    if (!name) return;
    const preset = getPresets().find(p => p.name === name);
    if (!preset) return;
    window.dispatchEvent(new CustomEvent('preset-load', { detail: preset.settings }));
    showToast(`Preset "${name}" loaded`);
  });

  saveBtn.addEventListener('click', () => {
    const suggested = presetSelect.value || '';
    const name = window.prompt('Save preset as:', suggested);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (!appState.getSettings) { showToast('Settings not ready', true); return; }
    const settings = appState.getSettings();
    const presets = getPresets().filter(p => p.name !== trimmed);
    presets.push({ name: trimmed, settings });
    savePresets(presets);
    render(trimmed);
    showToast(`Preset "${trimmed}" saved`);
  });

  deleteBtn.addEventListener('click', () => {
    const name = presetSelect.value;
    if (!name) return;
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    const presets = getPresets().filter(p => p.name !== name);
    savePresets(presets);
    render('');
    showToast(`Preset "${name}" deleted`);
  });

  render('');
})();
