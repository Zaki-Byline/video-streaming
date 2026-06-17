import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getStoragePaths() {
  const basePath = path.join(__dirname, '..');
  const uploadPath = path.isAbsolute(config.upload.uploadPath)
    ? config.upload.uploadPath
    : path.resolve(basePath, config.upload.uploadPath);

  return {
    uploadPath,
    myStoragePath: path.join(uploadPath, 'my-storage'),
    miscPath: path.join(uploadPath, 'misc'),
    backendUploadPath: path.join(basePath, 'upload')
  };
}

/**
 * Resolve a local video file path for subtitle generation.
 * Mirrors the highest-priority paths used by the streaming controller.
 */
export function resolveLocalVideoPath(video) {
  if (!video) return null;

  const { uploadPath, myStoragePath, backendUploadPath } = getStoragePaths();
  const candidates = [];

  if (video.redirect_slug) {
    candidates.push(path.join(myStoragePath, `${video.redirect_slug}.mp4`));
    candidates.push(path.join(backendUploadPath, `${video.redirect_slug}.mp4`));
  }

  if (video.video_id) {
    candidates.push(path.join(myStoragePath, `${video.video_id}.mp4`));
    candidates.push(path.join(backendUploadPath, `${video.video_id}.mp4`));
  }

  if (video.file_path) {
    const fileName = path.basename(video.file_path);
    candidates.push(path.join(backendUploadPath, fileName));

    if (path.isAbsolute(video.file_path)) {
      candidates.push(path.normalize(video.file_path));
    } else {
      candidates.push(path.join(uploadPath, video.file_path));
      candidates.push(path.join(backendUploadPath, video.file_path));
    }
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function hasLocalVideoFile(video) {
  return Boolean(resolveLocalVideoPath(video));
}
