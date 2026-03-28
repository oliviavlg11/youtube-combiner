const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { audioUpload, videoUpload } = require('../middleware/multerConfig');
const { probe } = require('../services/ffprobeService');
const store = require('../utils/sessionStore');
const { unlinkSilent } = require('../utils/cleanup');

// POST /api/upload/audio — upload one or more audio files
router.post('/audio', audioUpload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  try {
    const results = [];
    for (const file of req.files) {
      const info = await probe(file.path);
      const track = {
        id: uuidv4(),
        originalName: file.originalname,
        path: file.path,
        filename: path.basename(file.path),
        duration: info.duration,
        size: info.size,
      };
      store.playlist.push(track);
      results.push(track);
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/upload/audio/:id — remove a track
router.delete('/audio/:id', (req, res) => {
  const idx = store.playlist.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Track not found' });
  const [removed] = store.playlist.splice(idx, 1);
  unlinkSilent(removed.path);
  res.json({ success: true });
});

// POST /api/upload/video — upload a video file
router.post('/video', videoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    // Remove previous video if any
    if (store.video) unlinkSilent(store.video.path);

    const info = await probe(req.file.path);
    store.video = {
      id: uuidv4(),
      originalName: req.file.originalname,
      path: req.file.path,
      filename: path.basename(req.file.path),
      duration: info.duration,
      fps: info.videoStream ? info.videoStream.fps : null,
      width: info.videoStream ? info.videoStream.width : null,
      height: info.videoStream ? info.videoStream.height : null,
      size: info.size,
    };
    res.json(store.video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/upload/video — remove current video
router.delete('/video', (req, res) => {
  if (store.video) {
    unlinkSilent(store.video.path);
    store.video = null;
  }
  res.json({ success: true });
});

module.exports = router;
