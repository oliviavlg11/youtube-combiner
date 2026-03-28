const fs = require('fs');
const path = require('path');

function unlinkSilent(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

function cleanUploadsOnStart() {
  const dirs = [
    path.join(__dirname, '../../uploads/audio'),
    path.join(__dirname, '../../uploads/video'),
    path.join(__dirname, '../../uploads/exports'),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true }); // create if missing (e.g. on Railway)
    for (const file of fs.readdirSync(dir)) {
      unlinkSilent(path.join(dir, file));
    }
  }
}

function killOrphanedFfmpeg() {
  try {
    const { execSync } = require('child_process');
    // Find ffmpeg processes started by this app (uploading from our uploads dir)
    execSync('pkill -f "uploads/exports" 2>/dev/null || true', { shell: true });
  } catch (_) {}
}

module.exports = { unlinkSilent, cleanUploadsOnStart, killOrphanedFfmpeg };
