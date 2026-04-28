const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { startExport, getJob, cancelJob } = require('../services/exportService');

// POST /api/export — start export
router.post('/', (req, res) => {
  const store = req.store;
  if (!store.video) return res.status(400).json({ error: 'No video file uploaded' });
  if (store.playlist.length === 0) return res.status(400).json({ error: 'Playlist is empty' });
  if (store.activeJob) return res.status(409).json({ error: 'An export is already in progress' });

  const jobId = uuidv4();
  store.activeJob = jobId;

  // Fire off async, don't await
  startExport(jobId, [...store.playlist], { ...store.video }, { ...store.settings })
    .catch(() => {})
    .finally(() => { store.activeJob = null; });

  res.json({ jobId });
});

// GET /api/export/progress/:jobId — SSE progress stream
router.get('/progress/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify({ stage: job.stage, percent: job.percent })}\n\n`);

  if (job.stage === 'done') { res.end(); return; }

  job.sseClients.add(res);
  req.on('close', () => job.sseClients.delete(res));
});

// GET /api/export/download/:jobId — download finished file
router.get('/download/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.stage !== 'done' || !job.outputPath) {
    return res.status(404).json({ error: 'Export not ready or not found' });
  }
  if (!fs.existsSync(job.outputPath)) {
    return res.status(404).json({ error: 'Output file missing' });
  }
  const stat = fs.statSync(job.outputPath);
  const rawName = (req.query.filename || 'my-video').replace(/[^a-zA-Z0-9_\- ]/g, '');
  const filename = `${rawName || 'my-video'}.mp4`;
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const stream = fs.createReadStream(job.outputPath);
  stream.pipe(res);
  stream.on('close', () => {
    // Clean up after download
    try { fs.unlinkSync(job.outputPath); } catch (_) {}
  });
});

// DELETE /api/export/active — force-cancel whatever is currently running for this user
router.delete('/active', (req, res) => {
  const store = req.store;
  if (store.activeJob) cancelJob(store.activeJob);
  store.activeJob = null;
  res.json({ success: true });
});

// DELETE /api/export/:jobId — cancel in-progress export
router.delete('/:jobId', (req, res) => {
  cancelJob(req.params.jobId);
  req.store.activeJob = null;
  res.json({ success: true });
});

module.exports = router;
