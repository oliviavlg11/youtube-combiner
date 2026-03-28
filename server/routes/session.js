const express = require('express');
const router = express.Router();
const store = require('../utils/sessionStore');

// GET /api/session — get current state
router.get('/', (req, res) => {
  const totalDuration = store.playlist.reduce((s, t) => s + t.duration, 0);
  res.json({
    playlist: store.playlist,
    video: store.video,
    settings: store.settings,
    totalDuration,
  });
});

// PUT /api/session/playlist — reorder and set loop
router.put('/playlist', (req, res) => {
  const { order, loop, loopCount } = req.body;

  if (Array.isArray(order)) {
    const map = new Map(store.playlist.map(t => [t.id, t]));
    const reordered = order.map(id => map.get(id)).filter(Boolean);
    const inOrder = new Set(order);
    store.playlist.forEach(t => { if (!inOrder.has(t.id)) reordered.push(t); });
    store.playlist.length = 0;
    store.playlist.push(...reordered);
  }

  if (typeof loop === 'boolean') store.settings.loop = loop;
  if (loopCount !== undefined) {
    store.settings.loopCount = Math.min(10, Math.max(1, parseInt(loopCount) || 1));
  }

  const singlePass = store.playlist.reduce((s, t) => s + t.duration, 0);
  const multiplier = store.settings.loop ? store.settings.loopCount : 1;
  const totalDuration = singlePass * multiplier;

  res.json({ totalDuration });
});

// PUT /api/session/settings — update export settings
router.put('/settings', (req, res) => {
  const allowed = ['resolution', 'fps', 'videoBitrate', 'audioBitrate', 'useHardwareAccel'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) store.settings[key] = req.body[key];
  }
  res.json({ success: true, settings: store.settings });
});

module.exports = router;
