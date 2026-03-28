const express = require('express');
const path = require('path');
const { cleanUploadsOnStart, killOrphanedFfmpeg } = require('./utils/cleanup');

// Kill any ffmpeg processes left over from a previous crashed session
killOrphanedFfmpeg();
// Clean up any orphaned temp files
cleanUploadsOnStart();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded videos for preview (audio files not needed in browser)
app.use('/uploads/video', express.static(path.join(__dirname, '../uploads/video')));

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
  console.log(`\nYouTube Combiner running at http://localhost:${PORT}\n`);
});
