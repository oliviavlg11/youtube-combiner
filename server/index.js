const express = require('express');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { cleanUploadsOnStart, killOrphanedFfmpeg } = require('./utils/cleanup');

// Tell fluent-ffmpeg where to find the binaries on Linux (Railway/Nix)
const { execSync } = require('child_process');
try {
  const ffmpegPath = execSync('which ffmpeg').toString().trim();
  const ffprobePath = execSync('which ffprobe').toString().trim();
  if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);
  if (ffprobePath) ffmpeg.setFfprobePath(ffprobePath);
  console.log('ffmpeg:', ffmpegPath);
  console.log('ffprobe:', ffprobePath);
} catch (e) {
  console.warn('Could not auto-detect ffmpeg path:', e.message);
}

// Kill any ffmpeg processes left over from a previous crashed session
killOrphanedFfmpeg();
// Clean up any orphaned temp files
cleanUploadsOnStart();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files for preview
app.use('/uploads/video', express.static(path.join(__dirname, '../uploads/video')));
app.use('/uploads/audio', express.static(path.join(__dirname, '../uploads/audio')));

// API routes
app.use('/api/upload', require('./routes/upload'));
app.use('/api/session', require('./routes/session'));
app.use('/api/export', require('./routes/export'));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nYT Playloop running at http://localhost:${PORT}\n`);
});
