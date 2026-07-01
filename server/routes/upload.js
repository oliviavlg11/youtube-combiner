const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { audioUpload, videoUpload, IMAGE_MIMES } = require('../middleware/multerConfig');
const { probe } = require('../services/ffprobeService');
const { unlinkSilent } = require('../utils/cleanup');

// POST /api/upload/audio — upload one or more audio files
router.post('/audio', audioUpload.array('files', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }
  try {
    const store = req.store;
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
  const store = req.store;
  const idx = store.playlist.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Track not found' });
  const [removed] = store.playlist.splice(idx, 1);
  unlinkSilent(removed.path);
  res.json({ success: true });
});

// POST /api/upload/video — upload a video file or still image
router.post('/video', videoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const store = req.store;
    // Remove previous media if any
    if (store.video) unlinkSilent(store.video.path);
    // New media → reset crop pan so it starts centered
    store.settings.mediaOffsetX = 0;
    store.settings.mediaOffsetY = 0;

    const isImage = IMAGE_MIMES.includes(req.file.mimetype);
    const info = await probe(req.file.path);
    store.video = {
      id: uuidv4(),
      originalName: req.file.originalname,
      path: req.file.path,
      filename: path.basename(req.file.path),
      mediaType: isImage ? 'image' : 'video',
      mimeType: req.file.mimetype,
      // Images have no intrinsic duration; the export pipeline stretches them
      // to match the audio playlist.
      duration: isImage ? 0 : info.duration,
      fps: !isImage && info.videoStream ? info.videoStream.fps : null,
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
  const store = req.store;
  if (store.video) {
    unlinkSilent(store.video.path);
    store.video = null;
  }
  res.json({ success: true });
});

module.exports = router;
