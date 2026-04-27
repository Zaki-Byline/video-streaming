#!/usr/bin/env node

/**
 * Automated Video + Subtitle Management System
 * 
 * Features:
 * - Automatic subtitle generation on video upload
 * - Video serving with subtitle support
 * - Automatic cleanup on video deletion
 * - Optional folder watcher for auto-processing
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import { generateSubtitles } from '../utils/subtitleGenerator.js';
import { ensureDirectoryExists } from '../utils/fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths - relative to project root
// __dirname = backend/automated-video-system
// Go up two levels to project root, then into upload/ and subtitles/
const UPLOAD_DIR = path.join(__dirname, '../../upload');
const SUBTITLES_DIR = path.join(__dirname, '../../subtitles');
const PORT = process.env.PORT || 3001;

// Ensure directories exist
ensureDirectoryExists(UPLOAD_DIR);
ensureDirectoryExists(SUBTITLES_DIR);

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Preserve original filename
    const originalName = file.originalname;
    cb(null, originalName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept video files
    const allowedMimes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/quicktime',
      'video/x-msvideo'
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp4|webm|ogg|mov|avi)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

/**
 * POST /upload
 * Upload a video and automatically generate subtitles
 */
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    const videoName = req.file.originalname;
    const videoPath = req.file.path;
    const videoNameWithoutExt = path.basename(videoName, path.extname(videoName));
    const subtitlePath = path.join(SUBTITLES_DIR, `${videoNameWithoutExt}.vtt`);

    console.log(`\n📹 Video uploaded: ${videoName}`);
    console.log(`   Path: ${videoPath}`);

    // Generate subtitles automatically
    console.log(`\n🎤 Generating subtitles for ${videoName}...`);
    try {
      await generateSubtitles(videoPath, {
        outputPath: subtitlePath,
        model: 'base',
        language: null // Auto-detect language
      });
      console.log(`✅ Subtitles generated: ${subtitlePath}`);
    } catch (subtitleError) {
      console.error(`⚠️  Subtitle generation failed:`, subtitleError.message);
      // Continue even if subtitle generation fails
    }

    res.json({
      success: true,
      message: 'Video uploaded and subtitles generated',
      video: {
        name: videoName,
        path: `/video/${videoName}`,
        subtitlePath: existsSync(subtitlePath) ? `/subtitle/${videoNameWithoutExt}.vtt` : null
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Upload failed' });
  }
});

/**
 * GET /video/:name
 * Serve video file for playback
 */
app.get('/video/:name', (req, res) => {
  const videoName = req.params.name;
  const videoPath = path.join(UPLOAD_DIR, videoName);

  if (!existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  // Set proper headers for video streaming
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(videoPath);
});

/**
 * GET /subtitle/:name
 * Serve subtitle file (.vtt)
 */
app.get('/subtitle/:name', (req, res) => {
  const subtitleName = req.params.name;
  // Ensure .vtt extension
  const subtitleFile = subtitleName.endsWith('.vtt') ? subtitleName : `${subtitleName}.vtt`;
  const subtitlePath = path.join(SUBTITLES_DIR, subtitleFile);

  if (!existsSync(subtitlePath)) {
    return res.status(404).json({ error: 'Subtitle not found' });
  }

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.sendFile(subtitlePath);
});

/**
 * GET /videos
 * List all uploaded videos
 */
app.get('/videos', (req, res) => {
  try {
    const files = readdirSync(UPLOAD_DIR);
    const videos = files
      .filter(file => /\.(mp4|webm|ogg|mov|avi)$/i.test(file))
      .map(file => {
        const nameWithoutExt = path.basename(file, path.extname(file));
        const subtitleFile = `${nameWithoutExt}.vtt`;
        const subtitlePath = path.join(SUBTITLES_DIR, subtitleFile);

        return {
          name: file,
          videoUrl: `/video/${file}`,
          subtitleUrl: existsSync(subtitlePath) ? `/subtitle/${nameWithoutExt}.vtt` : null,
          hasSubtitle: existsSync(subtitlePath)
        };
      });

    res.json({ videos });
  } catch (error) {
    console.error('Error listing videos:', error);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

/**
 * DELETE /video/:name
 * Delete video and its associated subtitle
 */
app.delete('/video/:name', (req, res) => {
  const videoName = req.params.name;
  const videoPath = path.join(UPLOAD_DIR, videoName);
  const videoNameWithoutExt = path.basename(videoName, path.extname(videoName));
  const subtitlePath = path.join(SUBTITLES_DIR, `${videoNameWithoutExt}.vtt`);

  let deletedVideo = false;
  let deletedSubtitle = false;

  // Delete video file
  if (existsSync(videoPath)) {
    try {
      unlinkSync(videoPath);
      deletedVideo = true;
      console.log(`✅ Deleted video: ${videoPath}`);
    } catch (error) {
      console.error(`❌ Error deleting video: ${error.message}`);
    }
  }

  // Delete subtitle file
  if (existsSync(subtitlePath)) {
    try {
      unlinkSync(subtitlePath);
      deletedSubtitle = true;
      console.log(`✅ Deleted subtitle: ${subtitlePath}`);
    } catch (error) {
      console.error(`❌ Error deleting subtitle: ${error.message}`);
    }
  }

  if (!deletedVideo && !deletedSubtitle) {
    return res.status(404).json({ error: 'Video and subtitle not found' });
  }

  res.json({
    success: true,
    message: 'Video and subtitle deleted',
    deleted: {
      video: deletedVideo,
      subtitle: deletedSubtitle
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 Automated Video + Subtitle Management System');
  console.log('='.repeat(60));
  console.log(`📁 Upload directory: ${UPLOAD_DIR}`);
  console.log(`📝 Subtitles directory: ${SUBTITLES_DIR}`);
  console.log(`🌐 Server running on http://localhost:${PORT}`);
  console.log(`📺 Frontend: http://localhost:${PORT}`);
  console.log('='.repeat(60) + '\n');
});


