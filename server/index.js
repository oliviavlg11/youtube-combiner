const express = require('express');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { cleanUploadsOnStart, killOrphanedFfmpeg } = require('./utils/cleanup');
const { sessionMiddleware } = require('./middleware/session');

// Use bundled binaries — works on any platform including Railway
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeInstaller.path);
console.log('ffmpeg:', ffmpegStatic);
console.log('ffprobe:', ffprobeInstaller.path);

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

// API routes — gated by per-browser session cookie so each user has isolated state
app.use('/api', sessionMiddleware);
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
