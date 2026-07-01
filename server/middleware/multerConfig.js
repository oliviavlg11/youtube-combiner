const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const AUDIO_MIMES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo'];
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const MEDIA_MIMES = [...VIDEO_MIMES, ...IMAGE_MIMES];

function makeStorage(subdir) {
  return multer.diskStorage({
    destination: path.join(__dirname, '../../uploads', subdir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, uuidv4() + ext);
    },
  });
}

const audioUpload = multer({
  storage: makeStorage('audio'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
  fileFilter: (req, file, cb) => {
    if (AUDIO_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported audio type: ${file.mimetype}`));
  },
});

// "videoUpload" historically only accepted videos; it now also accepts still
// images, which the export pipeline will -loop for the playlist duration.
const videoUpload = multer({
  storage: makeStorage('video'),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
  fileFilter: (req, file, cb) => {
    if (MEDIA_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Unsupported media type: ${file.mimetype}`));
  },
});

module.exports = { audioUpload, videoUpload, IMAGE_MIMES, VIDEO_MIMES };
