/**
 * VTT lifecycle: 1:1 video ↔ subtitle file co-located in storage.
 * VID_123.mp4 → VID_123.vtt (same folder, same basename).
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import pool from '../config/database.js';
import { generateSubtitles } from './subtitleGenerator.js';
import { ensureDirectoryExists } from './fileUtils.js';
import { resolveLocalVideoPath } from './videoPathResolver.js';
import { tryGenerateDescriptionAfterCaption } from './afterCaptionSaved.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CAPTIONS_LEGACY_DIR = path.join(__dirname, '../../video-storage/captions');
const SUBTITLES_TEMP_DIR = path.join(__dirname, '../../subtitles');
const BACKEND_SUBTITLES_DIR = path.join(__dirname, '../subtitles');

function getStorageRoots() {
  const basePath = path.join(__dirname, '..');
  const uploadPath = path.isAbsolute(config.upload.uploadPath)
    ? config.upload.uploadPath
    : path.resolve(basePath, config.upload.uploadPath);

  return {
    basePath,
    uploadPath,
    backendUploadPath: path.join(basePath, 'upload'),
    videoStorageRoot: path.join(__dirname, '../../video-storage')
  };
}

export function vttPathForVideoPath(videoFilePath) {
  if (!videoFilePath) return null;
  const ext = path.extname(videoFilePath);
  return videoFilePath.slice(0, videoFilePath.length - ext.length) + '.vtt';
}

export function relativeVttPathForVideo(relativeVideoPath) {
  if (!relativeVideoPath) return null;
  const ext = path.extname(relativeVideoPath);
  return relativeVideoPath.slice(0, relativeVideoPath.length - ext.length) + '.vtt';
}

export function resolveCoLocatedVttAbsolute(video) {
  if (!video?.file_path) return null;

  const { uploadPath, backendUploadPath, videoStorageRoot } = getStorageRoots();
  const rel = relativeVttPathForVideo(video.file_path);

  const candidates = [];
  if (video.file_path.startsWith('upload/')) {
    candidates.push(path.join(backendUploadPath, path.basename(rel)));
  }
  candidates.push(path.join(uploadPath, rel));
  candidates.push(path.join(videoStorageRoot, rel));
  if (path.isAbsolute(video.file_path)) {
    candidates.push(vttPathForVideoPath(video.file_path));
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

export async function registerVttInDb(videoId, relativeVttPath, language = 'en') {
  await pool.execute(
    `INSERT INTO captions (video_id, language, file_path)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE file_path = ?`,
    [videoId, language, relativeVttPath, relativeVttPath]
  );
}

export function relativePathForCoLocatedVtt(videoAbsolutePath) {
  const { uploadPath, backendUploadPath, videoStorageRoot } = getStorageRoots();
  const vttAbsolute = vttPathForVideoPath(videoAbsolutePath);

  if (videoAbsolutePath.startsWith(backendUploadPath)) {
    return `upload/${path.basename(vttAbsolute)}`;
  }
  if (videoAbsolutePath.startsWith(uploadPath)) {
    return path.relative(uploadPath, vttAbsolute).replace(/\\/g, '/');
  }
  if (videoAbsolutePath.startsWith(videoStorageRoot)) {
    return path.relative(videoStorageRoot, vttAbsolute).replace(/\\/g, '/');
  }
  return path.basename(vttAbsolute);
}

export async function saveVttBesideVideo(videoId, videoAbsolutePath, vttContent) {
  const vttAbsolute = vttPathForVideoPath(videoAbsolutePath);
  await ensureDirectoryExists(path.dirname(vttAbsolute));
  await fsPromises.writeFile(vttAbsolute, vttContent);

  const relativeVtt = relativePathForCoLocatedVtt(videoAbsolutePath);

  try {
    await registerVttInDb(videoId, relativeVtt);
  } catch (err) {
    console.warn(`[vttLifecycle] Could not register VTT in DB for ${videoId}:`, err.message);
  }

  console.log(`[vttLifecycle] Saved ${vttAbsolute} (db: ${relativeVtt})`);
  return { absolutePath: vttAbsolute, relativePath: relativeVtt };
}

export async function deleteVttForVideo(video) {
  if (!video?.video_id) return { filesDeleted: 0 };

  let filesDeleted = 0;
  const videoId = video.video_id;

  const mp4Path = resolveLocalVideoPath(video);
  if (mp4Path) {
    const paired = vttPathForVideoPath(mp4Path);
    if (fs.existsSync(paired)) {
      await fsPromises.unlink(paired);
      filesDeleted++;
      console.log(`[vttLifecycle] Deleted co-located VTT: ${paired}`);
    }
  }

  const legacyPaths = [
    path.join(CAPTIONS_LEGACY_DIR, `${videoId}_en.vtt`),
    path.join(CAPTIONS_LEGACY_DIR, `${videoId}.vtt`),
    path.join(SUBTITLES_TEMP_DIR, `${videoId}.vtt`),
    path.join(BACKEND_SUBTITLES_DIR, `${videoId}.vtt`)
  ];

  for (const p of legacyPaths) {
    if (fs.existsSync(p)) {
      await fsPromises.unlink(p);
      filesDeleted++;
    }
  }

  await pool.execute('DELETE FROM captions WHERE video_id = ?', [videoId]);
  return { filesDeleted, captionsDeleted: 1 };
}

export async function isVttValid(vttPath) {
  if (!vttPath || !fs.existsSync(vttPath)) return false;
  try {
    const content = await fsPromises.readFile(vttPath, 'utf8');
    return content.includes('WEBVTT') && content.trim().length > 20;
  } catch {
    return false;
  }
}

export async function generateVttFromVideo(video, videoAbsolutePath, options = {}) {
  const { replace = false, generateDescription = true, forceDescription = false } = options;

  if (!videoAbsolutePath || !fs.existsSync(videoAbsolutePath)) {
    throw new Error(`Video file not found: ${videoAbsolutePath}`);
  }

  if (replace) {
    await deleteVttForVideo(video);
  }

  const pairedVtt = vttPathForVideoPath(videoAbsolutePath);
  if (!replace && (await isVttValid(pairedVtt))) {
    return pairedVtt;
  }

  await ensureDirectoryExists(SUBTITLES_TEMP_DIR);
  const tempVtt = path.join(SUBTITLES_TEMP_DIR, `_gen_${video.video_id}_${Date.now()}.vtt`);

  await generateSubtitles(videoAbsolutePath, {
    outputPath: tempVtt,
    model: 'base',
    language: null
  });

  const vttBuffer = await fsPromises.readFile(tempVtt);
  const saved = await saveVttBesideVideo(video.video_id, videoAbsolutePath, vttBuffer);
  await fsPromises.unlink(tempVtt).catch(() => {});

  if (generateDescription) {
    try {
      const [rows] = await pool.execute('SELECT * FROM videos WHERE video_id = ? LIMIT 1', [video.video_id]);
      const fullVideo = rows[0] || video;
      await tryGenerateDescriptionAfterCaption(fullVideo, { force: forceDescription || replace });
    } catch (err) {
      console.warn(`[vttLifecycle] Description skipped: ${err.message}`);
    }
  }

  return saved.absolutePath;
}

export async function ensureVttFromVideo(video) {
  const mp4 = resolveLocalVideoPath(video);
  if (!mp4) throw new Error(`No video file for ${video.video_id}`);

  const vtt = vttPathForVideoPath(mp4);
  if (await isVttValid(vtt)) return vtt;

  return generateVttFromVideo(video, mp4, { replace: true });
}

export function scheduleVttGeneration(video, videoAbsolutePath, options = {}) {
  (async () => {
    try {
      await generateVttFromVideo(video, videoAbsolutePath, options);
    } catch (err) {
      console.error(`[vttLifecycle] Failed for ${video.video_id}:`, err.message);
    }
  })();
}

export async function deleteVttBesideVideoFile(videoAbsolutePath) {
  const vtt = vttPathForVideoPath(videoAbsolutePath);
  if (vtt && fs.existsSync(vtt)) {
    await fsPromises.unlink(vtt);
    return true;
  }
  return false;
}

/** Delete paired VTT and video file from disk (used on permanent video delete). */
export async function deleteAllMediaForVideo(video) {
  const vttResult = await deleteVttForVideo(video);

  let videoDeleted = false;
  const mp4 = resolveLocalVideoPath(video);
  if (mp4 && fs.existsSync(mp4)) {
    await fsPromises.unlink(mp4);
    videoDeleted = true;
    console.log(`[vttLifecycle] Deleted video file: ${mp4}`);
  }

  return { ...vttResult, videoDeleted };
}
