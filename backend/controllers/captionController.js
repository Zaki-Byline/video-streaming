import multer from 'multer';
import fs from 'fs/promises';
import * as captionService from '../services/captionService.js';
import * as videoService from '../services/videoService.js';
import { resolveVttPath } from '../utils/vttUtils.js';
import { normalizeVttToLines } from '../utils/vttLineFormat.js';

async function assertActiveVideo(videoId) {
  const video = await videoService.getVideoByVideoId(videoId, true);
  if (!video || video.status === 'deleted') {
    return null;
  }
  return video;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/vtt' || file.originalname.endsWith('.vtt')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only VTT files are allowed.'));
    }
  }
});

/**
 * Upload caption
 */
export const uploadCaption = [
  upload.single('caption'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Caption file required' });
      }
      
      const { videoId, language } = req.body;
      
      if (!videoId || !language) {
        return res.status(400).json({ error: 'Video ID and language required' });
      }
      
      const captionPath = await captionService.uploadCaption(
        videoId,
        language,
        req.file.buffer,
        req.file.originalname
      );
      
      res.status(201).json({
        message: 'Caption uploaded successfully',
        path: captionPath
      });
    } catch (error) {
      console.error('Upload caption error:', error);
      res.status(500).json({ error: error.message || 'Upload failed' });
    }
  }
];

/**
 * Serve VTT caption file for a video (used by HTML5 video <track> elements).
 */
export async function serveCaptionFile(req, res) {
  try {
    const { videoId } = req.params;
    const video = await assertActiveVideo(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const vttPath = await resolveVttPath(videoId);

    if (!vttPath) {
      return res.status(404).json({ error: 'Caption file not found' });
    }

    const rawVtt = await fs.readFile(vttPath, 'utf8');
    const lineVtt = normalizeVttToLines(rawVtt);

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(lineVtt);
  } catch (error) {
    console.error('Serve caption file error:', error);
    res.status(500).json({ error: 'Failed to serve caption file' });
  }
}

/**
 * Get captions for video
 */
export async function getCaptions(req, res) {
  try {
    const { videoId } = req.params;
    const video = await assertActiveVideo(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const captions = await captionService.getCaptionsByVideoId(videoId);
    res.json(captions);
  } catch (error) {
    console.error('Get captions error:', error);
    res.status(500).json({ error: 'Failed to fetch captions' });
  }
}

/**
 * Delete caption
 */
export async function deleteCaption(req, res) {
  try {
    const { id } = req.params;
    const success = await captionService.deleteCaption(id);
    
    if (!success) {
      return res.status(404).json({ error: 'Caption not found' });
    }
    
    res.json({ message: 'Caption deleted successfully' });
  } catch (error) {
    console.error('Delete caption error:', error);
    res.status(500).json({ error: 'Failed to delete caption' });
  }
}





