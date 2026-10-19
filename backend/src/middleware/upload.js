import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const maxMb = Number(process.env.MAX_UPLOAD_MB || 5);
const allowed = new Set(['image/jpeg','image/png','image/webp']);

function makeStorage(folder) {
  fs.mkdirSync(folder, { recursive: true });
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, folder),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
    }
  });
}

function fileFilter(_req, file, cb) {
  if (!allowed.has(file.mimetype)) return cb(new Error('Only JPG, PNG and WEBP images are allowed.'));
  cb(null, true);
}

export const itemUpload = multer({
  storage: makeStorage(path.resolve('uploads/items')),
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter
});

export const avatarUpload = multer({
  storage: makeStorage(path.resolve('uploads/avatars')),
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter
});

export const idCardUpload = multer({
  storage: makeStorage(path.resolve('uploads/id-cards')),
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter
});
