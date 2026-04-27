import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import pool from '../config/database.js';
import config from '../config/config.js';
import * as videoService from '../services/videoService.js';
import * as redirectService from '../services/redirectService.js';
import * as qrCodeService from '../services/qrCodeService.js';
import { ensureDirectoryExists, getFileSize, getVideoDuration } from '../utils/fileUtils.js';
import { getBaseUrl } from '../utils/urlHelper.js';

// Utility: check if a column exists in the videos table
async function columnExists(columnName) {
  try {
    const [rows] = await pool.execute(
      `SELECT COUNT(*) as count
       FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = 'videos'
         AND column_name = ?`,
      [columnName]
    );
    return rows[0]?.count > 0;
  } catch (err) {
    console.warn(`[columnExists] Failed to check column ${columnName}:`, err.message);
    return false;
  }
}

// Ensure required columns exist for QR code listing
async function ensureQrColumns() {
  // NOTE: 'course' and 'activity' columns are removed from the new schema
  const columns = [
    { name: 'subject', definition: "ALTER TABLE videos ADD COLUMN subject VARCHAR(255) NULL AFTER id" },
    { name: 'grade', definition: "ALTER TABLE videos ADD COLUMN grade VARCHAR(255) NULL" },
    { name: 'lesson', definition: "ALTER TABLE videos ADD COLUMN lesson VARCHAR(255) NULL" },
    { name: 'module', definition: "ALTER TABLE videos ADD COLUMN module VARCHAR(255) NULL" },
    { name: 'topic', definition: "ALTER TABLE videos ADD COLUMN topic VARCHAR(255) NULL" },
    { name: 'qr_url', definition: "ALTER TABLE videos ADD COLUMN qr_url VARCHAR(500) NULL" },
    { name: 'redirect_slug', definition: "ALTER TABLE videos ADD COLUMN redirect_slug VARCHAR(100) NULL" },
    { name: 'streaming_url', definition: "ALTER TABLE videos ADD COLUMN streaming_url VARCHAR(500) NULL" }
  ];

  for (const col of columns) {
    const exists = await columnExists(col.name);
    if (!exists) {
      try {
        await pool.execute(col.definition);
        console.log(`[ensureQrColumns] Added missing column: ${col.name}`);
      } catch (err) {
        // Ignore duplicate/exists errors; rethrow others
        if (err.code !== 'ER_DUP_FIELDNAME' && err.code !== 'ER_TOO_MANY_KEY_PARTS') {
          console.warn(`[ensureQrColumns] Could not add column ${col.name}:`, err.message);
        }
      }
    }
  }
}

// Ensure core video metadata columns exist (subject/course/grade/unit/lesson/module/activity/topic)
async function ensureVideoColumns() {
  // NOTE: 'course' and 'activity' columns are removed from the new schema
  const columns = [
    { name: 'subject', definition: "ALTER TABLE videos ADD COLUMN subject VARCHAR(255) NULL AFTER id" },
    { name: 'grade', definition: "ALTER TABLE videos ADD COLUMN grade VARCHAR(255) NULL" },
    { name: 'unit', definition: "ALTER TABLE videos ADD COLUMN unit VARCHAR(255) NULL" },
    { name: 'lesson', definition: "ALTER TABLE videos ADD COLUMN lesson VARCHAR(255) NULL" },
    { name: 'module', definition: "ALTER TABLE videos ADD COLUMN module VARCHAR(255) NULL" },
    { name: 'topic', definition: "ALTER TABLE videos ADD COLUMN topic VARCHAR(255) NULL" }
  ];

  for (const col of columns) {
    const exists = await columnExists(col.name);
    if (!exists) {
      try {
        await pool.execute(col.definition);
        console.log(`[ensureVideoColumns] Added missing column: ${col.name}`);
      } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') {
          console.warn(`[ensureVideoColumns] Could not add column ${col.name}:`, err.message);
        }
      }
    }
  }
}

// Self-contained generateUniqueShortId function - no external module imports needed
// This completely avoids any module loading issues
async function generateUniqueShortId(maxRetries = 10) {
  // Helper to generate a short ID
  const generateShortId = () => {
    const randomBytes = crypto.randomBytes(6);
    const base36 = randomBytes.toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .substring(0, 6)
      .toLowerCase();
    const timestamp = Date.now().toString(36).slice(-4);
    return (base36 + timestamp).substring(0, 10);
  };
  
  // Try to generate a unique ID by checking database
  for (let i = 0; i < maxRetries; i++) {
    const shortId = generateShortId();
    
    try {
      // Check if this ID already exists in redirects table
      const [existing] = await pool.execute(
        'SELECT id FROM redirects WHERE slug = ?',
        [shortId]
      );
      
      if (existing.length === 0) {
        // Also check videos table for video_id
        const [videoExists] = await pool.execute(
          'SELECT id FROM videos WHERE video_id = ?',
          [shortId]
        );
        
        if (videoExists.length === 0) {
          return shortId;
        }
      }
    } catch (error) {
      // If database error, try again
      console.warn('[VideoController] Error checking short ID uniqueness:', error.message);
    }
  }
  
  // If all retries failed, use timestamp-based ID with random suffix
  const timestamp = Date.now().toString(36).slice(-6);
  const random = crypto.randomBytes(2).toString('hex').substring(0, 4);
  return (timestamp + random).substring(0, 10);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Placeholder functions - these need to be restored from backup or recreated
// For now, adding the diagnostic function and we'll need to restore the rest

/**
 * Get video replacement diagnostic information
 * Checks if a video can be replaced and identifies potential issues
 */
export async function getVideoReplacementDiagnostic(req, res) {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    console.log(`[Replace Diagnostic] Checking video ID: ${id}`);

    const diagnostic = {
      videoId: id,
      canReplace: false,
      checks: [],
      errors: [],
      warnings: [],
      videoInfo: null,
      fileInfo: null,
      databaseInfo: null
    };

    // Check 1: Video exists in database
    try {
      const video = await videoService.getVideoById(id);
      if (!video) {
        diagnostic.checks.push({
          name: 'Video Exists',
          status: 'error',
          message: 'Video not found in database',
          details: { videoId: id }
        });
        diagnostic.errors.push('Video not found in database');
        return res.json(diagnostic);
      }

      diagnostic.videoInfo = {
        id: video.id,
        video_id: video.video_id,
        redirect_slug: video.redirect_slug,
        file_path: video.file_path,
        qr_url: video.qr_url,
        status: video.status,
        size: video.size
      };

      diagnostic.checks.push({
        name: 'Video Exists',
        status: 'success',
        message: 'Video found in database',
        details: {
          video_id: video.video_id,
          redirect_slug: video.redirect_slug,
          status: video.status
        }
      });
    } catch (err) {
      diagnostic.checks.push({
        name: 'Video Exists',
        status: 'error',
        message: 'Error checking video',
        details: { error: err.message }
      });
      diagnostic.errors.push(`Error checking video: ${err.message}`);
      return res.json(diagnostic);
    }

    // Check 2: Video has redirect_slug
    const video = await videoService.getVideoById(id);
    if (!video.redirect_slug) {
      diagnostic.checks.push({
        name: 'Redirect Slug',
        status: 'error',
        message: 'Video does not have redirect_slug',
        details: { videoId: video.video_id }
      });
      diagnostic.errors.push('Video does not have redirect_slug - cannot preserve URL/QR');
      diagnostic.canReplace = false;
    } else {
      diagnostic.checks.push({
        name: 'Redirect Slug',
        status: 'success',
        message: 'Video has redirect_slug',
        details: { redirect_slug: video.redirect_slug }
      });
    }

    // Check 3: File path resolution
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    const myStoragePath = path.join(uploadPath, 'my-storage');

    // Check if my-storage directory exists and is writable
    try {
      if (!fsSync.existsSync(myStoragePath)) {
        diagnostic.checks.push({
          name: 'Storage Directory',
          status: 'warning',
          message: 'my-storage directory does not exist',
          details: { path: myStoragePath }
        });
        diagnostic.warnings.push('my-storage directory does not exist - will be created');
      } else {
        // Check if writable
        try {
          fsSync.accessSync(myStoragePath, fsSync.constants.W_OK);
          diagnostic.checks.push({
            name: 'Storage Directory',
            status: 'success',
            message: 'my-storage directory exists and is writable',
            details: { path: myStoragePath }
          });
        } catch (accessError) {
          diagnostic.checks.push({
            name: 'Storage Directory',
            status: 'error',
            message: 'my-storage directory is not writable',
            details: { path: myStoragePath, error: accessError.message }
          });
          diagnostic.errors.push('my-storage directory is not writable');
        }
      }
    } catch (dirError) {
      diagnostic.checks.push({
        name: 'Storage Directory',
        status: 'error',
        message: 'Error checking storage directory',
        details: { error: dirError.message }
      });
      diagnostic.errors.push(`Error checking storage directory: ${dirError.message}`);
    }

    // Check 4: Expected file path
    const expectedPath = `my-storage/${video.redirect_slug}.mp4`;
    const expectedFullPath = path.join(myStoragePath, `${video.redirect_slug}.mp4`);
    
    diagnostic.fileInfo = {
      expectedPath: expectedPath,
      expectedFullPath: expectedFullPath,
      currentPath: video.file_path,
      pathWillChange: video.file_path !== expectedPath
    };

    diagnostic.checks.push({
      name: 'File Path',
      status: 'info',
      message: 'Expected file path for replacement',
      details: {
        expected: expectedPath,
        current: video.file_path,
        willChange: video.file_path !== expectedPath
      }
    });

    // Check 5: Check for duplicate videos with same redirect_slug
    try {
      const [duplicates] = await pool.execute(
        'SELECT id, video_id, title, file_path, status FROM videos WHERE redirect_slug = ? AND id != ?',
        [video.redirect_slug, id]
      );

      if (duplicates.length > 0) {
        diagnostic.checks.push({
          name: 'Duplicate Videos',
          status: 'warning',
          message: `Found ${duplicates.length} other video(s) with same redirect_slug`,
          details: {
            count: duplicates.length,
            videos: duplicates.map(v => ({
              id: v.id,
              video_id: v.video_id,
              title: v.title,
              status: v.status
            }))
          }
        });
        diagnostic.warnings.push(`${duplicates.length} other video(s) will be deleted during replacement`);
      } else {
        diagnostic.checks.push({
          name: 'Duplicate Videos',
          status: 'success',
          message: 'No duplicate videos found',
          details: {}
        });
      }
    } catch (dupError) {
      diagnostic.checks.push({
        name: 'Duplicate Videos',
        status: 'error',
        message: 'Error checking for duplicates',
        details: { error: dupError.message }
      });
      diagnostic.errors.push(`Error checking duplicates: ${dupError.message}`);
    }

    // Check 6: Database update capability
    try {
      // Test if we can update the video (dry run - just check if video exists)
      const testVideo = await videoService.getVideoById(id);
      if (testVideo) {
        diagnostic.checks.push({
          name: 'Database Update',
          status: 'success',
          message: 'Video can be updated in database',
          details: { videoId: testVideo.video_id }
        });
      }
    } catch (updateError) {
      diagnostic.checks.push({
        name: 'Database Update',
        status: 'error',
        message: 'Cannot update video in database',
        details: { error: updateError.message }
      });
      diagnostic.errors.push(`Database update error: ${updateError.message}`);
    }

    // Final assessment
    diagnostic.canReplace = diagnostic.errors.length === 0;

    if (diagnostic.canReplace) {
      diagnostic.checks.push({
        name: 'Replacement Ready',
        status: 'success',
        message: 'Video can be replaced successfully',
        details: {
          redirect_slug: video.redirect_slug,
          expectedPath: expectedPath,
          warnings: diagnostic.warnings.length
        }
      });
    } else {
      diagnostic.checks.push({
        name: 'Replacement Ready',
        status: 'error',
        message: 'Video cannot be replaced - errors found',
        details: {
          errors: diagnostic.errors,
          errorCount: diagnostic.errors.length
        }
      });
    }

    res.json(diagnostic);
  } catch (error) {
    console.error('Replace diagnostic error:', error);
    res.status(500).json({
      error: 'Diagnostic failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Stub functions - these need to be restored from backup
// Adding minimal stubs so the module loads correctly
export async function getAllVideos(req, res) {
  try {
    const result = await videoService.getAllVideos(req.query);
    const videos = result.videos || [];
    const pagination = result.pagination || {};
    
    // Log to verify subject information is being returned
    if (videos.length > 0) {
      const sampleVideo = videos[0];
      console.log('[getAllVideos Controller] Sample video subject info:', {
        id: sampleVideo.id,
        video_id: sampleVideo.video_id,
        title: sampleVideo.title,
        subject: sampleVideo.subject,
        course: sampleVideo.course,
        grade: sampleVideo.grade,
        unit: sampleVideo.unit,
        lesson: sampleVideo.lesson,
        module: sampleVideo.module,
        subjectType: typeof sampleVideo.subject,
        unitType: typeof sampleVideo.unit,
        moduleType: typeof sampleVideo.module,
        allKeys: Object.keys(sampleVideo)
      });
    }
    
    // Ensure all videos have subject and module fields explicitly set
    // CRITICAL: Preserve actual values including "0", "1", etc.
    const videosWithSubject = videos.map(video => {
      // Determine subject value (course column removed, only use subject)
      // Preserve actual values including "0", "1", etc.
      const subjectValue = (video.subject !== undefined && video.subject !== null && String(video.subject).trim() !== '') 
        ? String(video.subject).trim() 
        : null;
      
      // Preserve module value
      const moduleValue = (video.module !== undefined && video.module !== null && String(video.module).trim() !== '') 
        ? String(video.module).trim() 
        : null;
      
      return {
        ...video,
        subject: subjectValue,
        course: subjectValue, // Backward compatibility - map to subject (course column removed)
        module: moduleValue, // Explicitly set module to ensure it's included
        unit: video.unit !== undefined && video.unit !== null && String(video.unit).trim() !== '' ? String(video.unit).trim() : null,
        grade: video.grade !== undefined && video.grade !== null && String(video.grade).trim() !== '' ? String(video.grade).trim() : null,
        lesson: video.lesson !== undefined && video.lesson !== null && String(video.lesson).trim() !== '' ? String(video.lesson).trim() : null
      };
    });
    
    // Log a sample to verify mapping
    if (videosWithSubject.length > 0) {
      const sample = videosWithSubject[0];
      console.log('[getAllVideos Controller] ===== FINAL RESPONSE TO FRONTEND =====');
      console.log('[getAllVideos Controller] After mapping - sample video:', {
        id: sample.id,
        video_id: sample.video_id,
        subject: sample.subject,
        course: sample.course,
        grade: sample.grade,
        unit: sample.unit,
        lesson: sample.lesson,
        module: sample.module,
        subjectType: typeof sample.subject,
        moduleType: typeof sample.module
      });
      console.log('[getAllVideos Controller] =====================================');
    }
    
    // Return videos with pagination metadata
    res.json({
      videos: videosWithSubject,
      pagination
    });
  } catch (error) {
    console.error('Get all videos error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function getVideo(req, res) {
  try {
    const { videoId } = req.params;
    
    // Try to get video by video_id first (most common case)
    let video = await videoService.getVideoByVideoId(videoId);
    
    // If not found and videoId is numeric, try getting by database ID (for backward compatibility)
    if (!video && /^\d+$/.test(videoId)) {
      video = await videoService.getVideoById(parseInt(videoId, 10));
      // Only return if video is active (public endpoint should not return inactive videos)
      if (video && video.status !== 'active') {
        video = null;
      }
    }
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Fetch captions for this video
    let captions = [];
    try {
      const captionService = await import('../services/captionService.js');
      const videoIdForCaptions = video.video_id || videoId;
      console.log(`[Get Video] 🔍 Fetching captions for video_id: ${videoIdForCaptions}`);
      captions = await captionService.getCaptionsByVideoId(videoIdForCaptions);
      console.log(`[Get Video] ✅ Found ${captions.length} caption(s) for video ${videoIdForCaptions}`);
      if (captions.length > 0) {
        captions.forEach((cap, idx) => {
          console.log(`[Get Video]   Caption ${idx + 1}:`, {
            id: cap.id,
            video_id: cap.video_id,
            language: cap.language,
            file_path: cap.file_path
          });
        });
      }
    } catch (captionError) {
      console.warn('[Get Video] ⚠️ Could not fetch captions:', captionError.message);
      console.error('[Get Video] Caption error details:', captionError);
      captions = [];
    }
    
    // Ensure all fields are properly returned, including module
    // Log to verify module is in the response
    console.log(`[Get Video] Video ID: ${videoId}`);
    console.log(`[Get Video] Module field value:`, video.module);
    console.log(`[Get Video] Module field type:`, typeof video.module);
    console.log(`[Get Video] Module field truthy:`, !!video.module);
    console.log(`[Get Video] All video fields:`, Object.keys(video));
    console.log(`[Get Video] Raw video object:`, JSON.stringify(video, null, 2));
    
    // Explicitly ensure module is included in response (preserve all values including empty strings and 0)
    const response = {
      ...video,
      // Preserve module value exactly as it is (including empty strings, 0, etc.)
      module: video.hasOwnProperty('module') ? video.module : null,
      activity: video.hasOwnProperty('activity') ? video.activity : null,
      subject: video.hasOwnProperty('subject') ? video.subject : null,
      captions: captions, // Include captions in response
      course: video.hasOwnProperty('subject') ? video.subject : null, // Backward compatibility
      grade: video.hasOwnProperty('grade') ? video.grade : null,
      lesson: video.hasOwnProperty('lesson') ? video.lesson : null
    };
    
    console.log(`[Get Video] 📤 Sending response with ${captions.length} caption(s)`);
    console.log(`[Get Video] Response module field:`, response.module);
    res.json(response);
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function uploadVideo(req, res) {
  try {
    // Handle multer fields (video only - no thumbnail)
    const videoFile = req.files?.video?.[0] || req.files?.video || req.file || null;

    if (!videoFile) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    console.log(`[Upload Video] ===== STARTING VIDEO UPLOAD =====`);
    console.log(`[Upload Video] File: ${videoFile.originalname}, size: ${videoFile.size} bytes`);

    // Log the entire req.body to see what multer parsed
    console.log('[Upload Video] Full req.body:', JSON.stringify(req.body, null, 2));
    console.log('[Upload Video] req.body keys:', Object.keys(req.body));
    console.log('[Upload Video] Content-Type:', req.headers['content-type']);

    // Get form data
    const {
      course,
      subject,
      grade,
      unit,
      lesson,
      module,
      activity,
      topic,
      title,
      description,
      language = 'en',
      status = 'active',
      version,
      videoId: requestedVideoId,
      plannedPath
    } = req.body;

    // Use subject if provided, otherwise fall back to course (for backward compatibility)
    // IMPORTANT: Preserve values even if they're empty strings - they might be valid inputs
    const subjectValue = (subject !== undefined && subject !== null && subject !== '') 
      ? String(subject).trim() 
      : ((course !== undefined && course !== null && course !== '') 
          ? String(course).trim() 
          : null);

    // Log received form data to verify all values are being received
    console.log('[Upload Video] ===== RAW FORM DATA RECEIVED =====');
    console.log('[Upload Video] Extracted form data (RAW):', {
      course: course,
      subject: subject,
      subjectValue: subjectValue,
      grade: grade,
      unit: unit,
      lesson: lesson,
      module: module,
      title: title,
      description: description,
      status: status,
      subjectType: typeof subject,
      courseType: typeof course,
      gradeType: typeof grade,
      unitType: typeof unit,
      moduleType: typeof module,
      allBodyKeys: Object.keys(req.body),
      bodyValues: {
        subject: req.body.subject,
        module: req.body.module,
        grade: req.body.grade,
        unit: req.body.unit,
        lesson: req.body.lesson
      }
    });
    console.log('[Upload Video] ====================================');

    // Check for duplicate title - prevent upload if title already exists
    if (title && title.trim() !== '') {
      const existingVideoByTitle = await videoService.getVideoByTitle(title.trim());
      if (existingVideoByTitle) {
        console.log(`[Upload Video] Duplicate title detected: "${title}"`);
        return res.status(409).json({ 
          error: 'Duplicate video title',
          message: `A video with the title "${title}" already exists. Please use a different title.`,
          existingVideoId: existingVideoByTitle.video_id
        });
      }
    }

    // Generate video ID (ONLY from provided ID or random; do not derive from grade/lesson)
    const makeFallbackId = () => {
      // Strong and short ID: timestamp (5 chars) + random (5 chars) = 10 chars total
      const timestamp = Date.now().toString(36).slice(-5).toUpperCase();
      const random = Math.random().toString(36).slice(2, 7).toUpperCase();
      return `VID_${timestamp}${random}`;
    };
    
    // Use provided Draft ID if available (it's strong and unique)
    let baseVideoId = (requestedVideoId && requestedVideoId.trim()) || makeFallbackId();
    let videoId = baseVideoId;

    // Check if the provided ID is strong (format: VID_XXXXXXXXXX where X is 10 alphanumeric chars)
    const isStrongId = /^VID_[A-Z0-9]{10}$/.test(baseVideoId);
    
    // Ensure video ID is unique
    let existingVideo = await videoService.getVideoByVideoId(videoId);
    let counter = 1;
    let maxRetries = isStrongId ? 20 : 10; // More retries for strong IDs since they should be unique
    
    while (existingVideo && counter <= maxRetries) {
      // Add minimal suffix only if duplicate (very rare for strong IDs)
      const suffix = `${counter}_${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
      videoId = `${baseVideoId}_${suffix}`;
      existingVideo = await videoService.getVideoByVideoId(videoId);
      counter++;
    }
    
    // If still duplicate after retries, log warning but continue
    if (existingVideo) {
      console.warn(`[Upload Video] Warning: Could not generate unique ID after ${maxRetries} retries. Using: ${videoId}`);
    }

    console.log(`[Upload Video] Generated video ID: ${videoId}`);

    // Generate redirect slug (short URL)
    let redirectSlug;
    try {
      redirectSlug = await generateUniqueShortId();
      console.log(`[Upload Video] Generated redirect slug: ${redirectSlug}`);
    } catch (slugError) {
      console.error('[Upload Video] Error generating redirect slug:', slugError);
      // Fallback: use videoId as slug if generateUniqueShortId fails
      redirectSlug = videoId.substring(0, 10);
      console.warn(`[Upload Video] Using fallback redirect slug: ${redirectSlug}`);
    }

    // Create upload directory (backend/upload)
    const uploadDir = path.join(__dirname, '../upload');
    await ensureDirectoryExists(uploadDir);

    // Generate unique filename to avoid conflicts
    const fileExt = path.extname(videoFile.originalname) || '.mp4';
    const fileName = `${videoId}${fileExt}`;
    const filePath = path.join(uploadDir, fileName);
    
    // Relative path from backend folder (for database)
    const relativePath = `upload/${fileName}`;

    console.log(`[Upload Video] Saving file to: ${filePath}`);
    console.log(`[Upload Video] Relative path: ${relativePath}`);

    // Move uploaded file to upload directory
    try {
      if (videoFile.path) {
        // File is on disk (from multer)
        await fs.rename(videoFile.path, filePath);
      } else if (videoFile.buffer) {
        // File is in memory
        await fs.writeFile(filePath, videoFile.buffer);
      } else {
        throw new Error('Video file has no path or buffer');
      }
      console.log(`[Upload Video] ✓ File saved successfully`);
    } catch (fileError) {
      console.error(`[Upload Video] ✗ Error saving file:`, fileError.message);
      throw new Error(`Failed to save video file: ${fileError.message}`);
    }

    // Verify file exists and get size
    if (!fsSync.existsSync(filePath)) {
      throw new Error(`File was not saved correctly to: ${filePath}`);
    }
    
    const fileSize = fsSync.statSync(filePath).size;
    console.log(`[Upload Video] ✓ File verified, size: ${fileSize} bytes`);
    
    // Extract video duration from file
    let videoDuration = 0;
    try {
      videoDuration = await getVideoDuration(filePath);
      console.log(`[Upload Video] ✓ Video duration extracted: ${videoDuration} seconds`);
    } catch (durationError) {
      console.warn(`[Upload Video] ⚠ Could not extract video duration:`, durationError.message);
      // Continue with duration = 0 if extraction fails
    }

    // Generate QR code - must point to the public short link (frontend domain)
    const shortUrl = `${config.urls.frontend}/${redirectSlug}`;
    let qrUrl = null;
    try {
      qrUrl = await qrCodeService.generateQRCode(videoId, shortUrl);
      console.log(`[Upload Video] ✓ QR code generated: ${qrUrl}`);
    } catch (qrError) {
      console.warn(`[Upload Video] ⚠ Could not generate QR code:`, qrError.message);
      // Continue without QR code
    }

    // No thumbnail handling - removed per user request

    // Build streaming URL - detect protocol from request if behind proxy
    const baseUrl = getBaseUrl(req);
    const streamingUrl = `${baseUrl}/api/s/${redirectSlug}`;
    console.log(`[Upload Video] Base URL: ${baseUrl}`);
    console.log(`[Upload Video] Streaming URL: ${streamingUrl}`);

    // Create video record in database (with retry on duplicate video_id)
    // CRITICAL: Preserve actual values - convert empty strings to null, but keep real values
    // Helper function to safely convert to string and preserve non-empty values
    const safeStringValue = (val) => {
      // If value is undefined or null, return null
      if (val === undefined || val === null) return null;
      // Convert to string and trim
      const str = String(val).trim();
      // Empty strings become null, but actual values like "1", "Math", etc. are preserved
      return str !== '' ? str : null;
    };
    
    // Log raw received values BEFORE any processing
    console.log('[Upload Video] ===== RAW VALUES FROM FORM =====');
    console.log('[Upload Video] RAW received values from form:', {
      subject: subjectValue,
      grade: grade,
      unit: unit,
      lesson: lesson,
      module: module,
      status: status,
      description: description,
      subjectType: typeof subjectValue,
      moduleType: typeof module,
      gradeType: typeof grade,
      unitType: typeof unit,
      subjectIsEmpty: subjectValue === '' || subjectValue === null || subjectValue === undefined,
      moduleIsEmpty: module === '' || module === null || module === undefined
    });
    console.log('[Upload Video] =================================');
    
    // Preserve version exactly as provided (e.g., "1.00" stays "1.00", not converted to number)
    // Convert to string to preserve decimal places and trailing zeros
    const versionValue = (version !== undefined && version !== null && String(version).trim() !== '')
      ? String(version).trim() // Preserve exact string value (e.g., "1.00", "1.1", "1.2")
      : null; // Don't default to 1 - let database handle default if needed
    
    let videoData = {
      videoId,
      title: title || videoId,
      description: description !== undefined && description !== null ? String(description) : '',
      language,
      subject: safeStringValue(subjectValue),
      grade: safeStringValue(grade),
      unit: safeStringValue(unit),
      lesson: safeStringValue(lesson),
      module: safeStringValue(module),
      activity: safeStringValue(activity),
      topic: safeStringValue(topic),
      version: versionValue, // Preserve exact version string (e.g., "1.00")
      filePath: relativePath, // Relative path: upload/filename.mp4
      streamingUrl,
      qrUrl,
      redirectSlug,
      size: fileSize,
      duration: videoDuration, // Use extracted duration from video file
      status: status || 'active'
    };
    
    console.log('[Upload Video] ===== PROCESSED DATA FOR DATABASE =====');
    console.log('[Upload Video] Processed video data before saving to createVideo:', {
      subject: videoData.subject,
      module: videoData.module,
      unit: videoData.unit,
      grade: videoData.grade,
      lesson: videoData.lesson,
      status: videoData.status,
      description: videoData.description,
      rawSubject: subjectValue,
      rawModule: module,
      rawUnit: unit,
      rawGrade: grade,
      willSaveSubject: videoData.subject !== null,
      willSaveModule: videoData.module !== null
    });
    console.log('[Upload Video] ======================================');
    
    console.log('[Upload Video] Video data to save:', {
      videoId,
      subject: videoData.subject,
      grade: videoData.grade,
      unit: videoData.unit,
      lesson: videoData.lesson,
      module: videoData.module,
      status: videoData.status,
      description: videoData.description,
      rawFormData: { subject: subjectValue, course, grade, unit, lesson, module, description }
    });

    // Create video record and redirect in parallel (faster)
    console.log(`[Upload Video] Creating video record in database...`);
    // Get user ID from auth token if available
    // JWT token contains userId which could be a number or string
    const userId = req.user?.userId ? (parseInt(req.user.userId) || req.user.userId) : null;
    if (userId) {
      videoData.createdBy = userId;
      console.log(`[Upload Video] Tracking upload by user ID: ${userId}`);
    } else {
      console.warn(`[Upload Video] No user ID found in token - upload will not be tracked to a specific user`);
    }
    const [insertId, redirectResult] = await Promise.allSettled([
      videoService.createVideo(videoData),
      (async () => {
        try {
          const targetUrl = `${config.urls.frontend}/stream/${videoId}`;
          await redirectService.createRedirect(redirectSlug, targetUrl, false);
          console.log(`[Upload Video] ✓ Redirect created: ${redirectSlug} -> ${targetUrl}`);
          return true;
        } catch (redirectError) {
          console.warn(`[Upload Video] ⚠ Could not create redirect:`, redirectError.message);
          return false;
        }
      })()
    ]);
    
    if (insertId.status === 'rejected') {
      throw new Error(`Failed to create video record: ${insertId.reason.message}`);
    }
    
    console.log(`[Upload Video] ✓ Video record created: ID ${insertId.value}`);
    
    // Automatically generate subtitles for the uploaded video (async, non-blocking)
    console.log(`[Upload Video] 🎤 Starting automatic subtitle generation for ${videoId}...`);
    (async () => {
      try {
        const { generateSubtitles } = await import('../utils/subtitleGenerator.js');
        const { ensureDirectoryExists } = await import('../utils/fileUtils.js');
        const fs = await import('fs/promises');
        const captionService = await import('../services/captionService.js');
        
        const videoNameWithoutExt = path.basename(fileName, path.extname(fileName));
        
        // Generate subtitle to temp location first
        const subtitlesDir = path.join(path.dirname(__dirname), '../../subtitles');
        await ensureDirectoryExists(subtitlesDir);
        const tempSubtitlePath = path.join(subtitlesDir, `${videoNameWithoutExt}.vtt`);
        
        console.log(`[Upload Video] 🎤 Generating subtitles for: ${filePath}`);
        console.log(`[Upload Video] 📝 Output path: ${tempSubtitlePath}`);
        
        // Generate subtitles
        await generateSubtitles(filePath, {
          outputPath: tempSubtitlePath,
          model: 'base',
          language: null // Auto-detect
        });
        
        console.log(`[Upload Video] ✅ Subtitles generated: ${tempSubtitlePath}`);
        
        // Read subtitle file and save to caption system (video-storage/captions/)
        try {
          const subtitleBuffer = await fs.readFile(tempSubtitlePath);
          await captionService.uploadCaption(videoId, 'en', subtitleBuffer, `${videoNameWithoutExt}.vtt`);
          console.log(`[Upload Video] ✅ Caption saved to video-storage/captions/ and added to database for video ${videoId}`);
        } catch (captionError) {
          console.error(`[Upload Video] ❌ Could not add caption to database:`, captionError.message);
          console.error(`[Upload Video] Caption error stack:`, captionError.stack);
        }
      } catch (subtitleError) {
        console.error(`[Upload Video] ❌ Subtitle generation failed (non-critical):`, subtitleError.message);
        console.error(`[Upload Video] Subtitle error stack:`, subtitleError.stack);
        console.error(`[Upload Video] ⚠️ Video uploaded successfully, but subtitles will need to be generated manually.`);
        console.error(`[Upload Video] 💡 Run: npm run generate-and-import-all`);
      }
    })();
    
    // Fetch the created video to get all fields
    const video = await videoService.getVideoById(insertId.value);
    if (!video) {
      throw new Error('Video was created but could not be retrieved from database');
    }
    console.log(`[Upload Video] ✓ Video retrieved: ID ${video.id}, Video ID: ${video.video_id}`);
    console.log('[Upload Video] Retrieved video subject info from database:', {
      subject: video.subject,
      grade: video.grade,
      unit: video.unit,
      lesson: video.lesson,
      module: video.module,
      description: video.description
    });

    console.log(`[Upload Video] ===== UPLOAD COMPLETE =====`);
    console.log(`[Upload Video] ✓ Video uploaded successfully`);
    console.log(`[Upload Video] ✓ File path: ${relativePath}`);
    console.log(`[Upload Video] ✓ Accessible at: ${config.urls.base}/upload/${fileName}`);
    console.log(`[Upload Video] ✓ Streaming URL: ${streamingUrl}`);
    console.log(`[Upload Video] =================================`);

    // Construct response - preserve null values, don't convert to undefined
    const responseVideo = {
      id: video.id,
      video_id: video.video_id,
      title: video.title,
      file_path: video.file_path,
      streaming_url: video.streaming_url,
      redirect_slug: video.redirect_slug,
      qr_url: video.qr_url,
      subject: video.subject !== undefined && video.subject !== null ? video.subject : null,
      course: video.subject !== undefined && video.subject !== null ? video.subject : null, // Backward compatibility
      grade: video.grade !== undefined && video.grade !== null ? video.grade : null,
      unit: video.unit !== undefined && video.unit !== null ? video.unit : null,
      lesson: video.lesson !== undefined && video.lesson !== null ? video.lesson : null,
      module: video.module !== undefined && video.module !== null ? video.module : null,
      status: video.status || 'active',
      description: video.description !== undefined && video.description !== null ? video.description : ''
    };
    
    console.log('[Upload Video] Response video object:', JSON.stringify(responseVideo, null, 2));
    
    res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      video: responseVideo,
      file_path: relativePath,
      file_size: fileSize,
      upload_url: `${config.urls.base}/upload/${fileName}`,
      streaming_url: streamingUrl,
      redirect_slug: redirectSlug
    });
  } catch (error) {
    console.error('[Upload Video] ===== ERROR =====');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    if (error.sqlMessage) {
      console.error('SQL Message:', error.sqlMessage);
      console.error('SQL State:', error.sqlState);
      console.error('SQL Code:', error.sqlCode);
    }
    console.error('==============================');
    
    res.status(500).json({ 
      error: 'Failed to upload video', 
      message: error.message,
      code: error.code,
      sqlMessage: error.sqlMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export async function replaceVideoFile(req, res) {
  let tempFilePath = null;
  
  try {
    const { id } = req.params;
    const videoFile = req.file;

    if (!videoFile) {
      return res.status(400).json({ error: 'Video file is required' });
    }

    console.log(`[Replace Video] ===== STARTING VIDEO REPLACEMENT =====`);
    console.log(`[Replace Video] Video ID: ${id}`);
    console.log(`[Replace Video] Uploaded file: ${videoFile.originalname}, size: ${videoFile.size} bytes`);

    // Get existing video
    const existingVideo = await videoService.getVideoById(id);
    if (!existingVideo) {
      // Cleanup temp file
      if (videoFile.path && fsSync.existsSync(videoFile.path)) {
        await fs.unlink(videoFile.path).catch(() => {});
      }
      return res.status(404).json({ error: 'Video not found', videoId: id });
    }

    const videoId = existingVideo.video_id;
    const redirectSlug = existingVideo.redirect_slug;
    const qrUrl = existingVideo.qr_url;

    if (!redirectSlug) {
      console.error(`[Replace Video] ✗ Video does not have redirect_slug`);
      // Cleanup temp file
      if (videoFile.path && fsSync.existsSync(videoFile.path)) {
        await fs.unlink(videoFile.path).catch(() => {});
      }
      return res.status(400).json({ error: 'Video does not have a redirect slug. Cannot preserve link.', videoId: videoId });
    }

    console.log(`[Replace Video] Replacing video file for ID: ${id}, Video ID: ${videoId}`);
    console.log(`[Replace Video] Preserving redirect_slug: ${redirectSlug}, QR URL: ${qrUrl}`);

    // Get file size from temp file
    const tempFileSize = await getFileSize(videoFile.path);
    console.log(`[Replace Video] New file size: ${tempFileSize} bytes`);

    // Resolve paths
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    // Determine where to save the file based on existing file_path
    // If existing file is in upload/, save to upload/; otherwise save to my-storage/
    let targetDir, relativePath;
    const existingFilePath = existingVideo.file_path || '';
    
    if (existingFilePath.startsWith('upload/')) {
      // Save to backend/upload/ folder
      targetDir = path.join(backendDir, 'upload');
      await ensureDirectoryExists(targetDir);
      const fileExt = path.extname(videoFile.originalname) || '.mp4';
      const fileName = `${videoId}${fileExt}`;
      relativePath = `upload/${fileName}`;
    } else {
      // Save to my-storage/ folder (default/legacy)
      const myStoragePath = path.join(uploadPath, 'my-storage');
      await ensureDirectoryExists(myStoragePath);
      const fileExt = path.extname(videoFile.originalname) || '.mp4';
      const fileName = `${redirectSlug}${fileExt}`;
      relativePath = `my-storage/${fileName}`;
      targetDir = myStoragePath;
    }
    
    const targetFilePath = path.join(targetDir, path.basename(relativePath));
    tempFilePath = videoFile.path;

    console.log(`[Replace Video] Target file path: ${targetFilePath}`);
    console.log(`[Replace Video] Relative path: ${relativePath}`);

    // Move uploaded file to target location (this will overwrite existing file)
    try {
      await fs.rename(videoFile.path, targetFilePath);
      tempFilePath = null; // File moved, no need to cleanup
      console.log(`[Replace Video] ✓ New file saved to: ${targetFilePath}`);
    } catch (renameError) {
      console.error(`[Replace Video] ✗ Error moving file:`, renameError.message);
      // Try copy as fallback (in case rename fails due to cross-device issues)
      try {
        await fs.copyFile(videoFile.path, targetFilePath);
        await fs.unlink(videoFile.path).catch(() => {}); // Delete temp file after copy
        tempFilePath = null;
        console.log(`[Replace Video] ✓ New file copied to: ${targetFilePath} (used copy as fallback)`);
      } catch (copyError) {
        console.error(`[Replace Video] ✗✗✗ CRITICAL: Could not save new file:`, copyError.message);
        throw new Error(`Failed to save new video file: ${copyError.message}`);
      }
    }
    
    // Verify the new file exists
    if (!fsSync.existsSync(targetFilePath)) {
      throw new Error(`New file was not saved correctly to: ${targetFilePath}`);
    }
    
    const newFileSize = fsSync.statSync(targetFilePath).size;
    console.log(`[Replace Video] ✓ Verified new file exists, size: ${newFileSize} bytes`);

    // Build streaming URL (keep same format - use redirect slug)
    const streamingUrl = `${getBaseUrl(req)}/api/s/${redirectSlug}`;

    // SIMPLE: Just update the file_path and size in the database
    // No deletions, no complex logic - just update the path
    const updateData = {
      file_path: relativePath, // my-storage/<redirect_slug>.mp4
      streaming_url: streamingUrl,
      size: newFileSize,
      status: 'active'
    };
    
    console.log(`[Replace Video] ===== UPDATING VIDEO FILE PATH =====`);
    console.log(`[Replace Video] Updating video ID ${id} with new file path`);
    console.log(`[Replace Video] Update data:`, updateData);
    
    // Update the video record
    const success = await videoService.updateVideo(id, updateData);
    
    if (!success) {
      console.error(`[Replace Video] ✗✗✗ FAILED to update video record with ID ${id}`);
      return res.status(500).json({ 
        error: 'Failed to update video record',
        videoId: videoId,
        redirectSlug: redirectSlug
      });
    }
    
    console.log(`[Replace Video] ✓✓✓ Video record updated successfully`);
    
    // Verify the database was updated correctly
    const updatedVideo = await videoService.getVideoById(id);
    if (!updatedVideo) {
      console.error(`[Replace Video] ✗✗✗ CRITICAL: Video with ID ${id} does not exist after update!`);
      return res.status(500).json({ 
        error: 'Video was deleted after update. This is a critical error.',
        videoId: videoId,
        redirectSlug: redirectSlug
      });
    }
    
    // Verify the size was actually updated in the database
    const actualFileSize = fsSync.statSync(targetFilePath).size;
    const dbSize = updatedVideo.size || 0;
    const sizeMatch = actualFileSize === dbSize;
    
    if (!sizeMatch) {
      console.error(`[Replace Video] ⚠️ WARNING: Size mismatch! File size: ${actualFileSize} bytes, DB size: ${dbSize} bytes`);
      // Try to update size again
      try {
        await videoService.updateVideo(id, { size: actualFileSize });
        console.log(`[Replace Video] ✓ Size corrected in database: ${actualFileSize} bytes`);
      } catch (sizeUpdateError) {
        console.error(`[Replace Video] ✗ Failed to correct size:`, sizeUpdateError.message);
      }
    }
    
    console.log(`[Replace Video] ✓✓✓ Video successfully updated: ID ${updatedVideo.id}, Path: ${updatedVideo.file_path}, Size: ${updatedVideo.size} bytes (${(updatedVideo.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`[Replace Video] ===== REPLACEMENT COMPLETE =====`);
    console.log(`[Replace Video] ✓ Video file replaced successfully`);
    console.log(`[Replace Video] ✓ File path updated: ${updatedVideo.file_path}`);
    console.log(`[Replace Video] ✓ File size updated: ${updatedVideo.size} bytes (${(updatedVideo.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`[Replace Video] ✓ Actual file size: ${actualFileSize} bytes (${(actualFileSize / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`[Replace Video] ✓ Size match: ${sizeMatch ? 'YES' : 'NO'}`);
    console.log(`[Replace Video] ✓ Redirect slug preserved: ${redirectSlug}`);
    console.log(`[Replace Video] ✓ QR code preserved: ${qrUrl}`);
    console.log(`[Replace Video] ✓ Streaming URL: ${streamingUrl}`);
    console.log(`[Replace Video] =================================`);
    
    // Force database refresh by updating updated_at timestamp
    await pool.execute(
      'UPDATE videos SET updated_at = NOW() WHERE id = ?',
      [id]
    );
    
    res.json({
      success: true,
      message: 'Video file replaced successfully. Link and QR code remain the same.',
      video: updatedVideo,
      redirect_slug: redirectSlug,
      qr_url: qrUrl,
      file_path: relativePath,
      file_size: updatedVideo.size,
      video_id: videoId,
      streaming_url: streamingUrl,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Replace video file error:', error);
    
    // Cleanup temp file if it still exists
    if (tempFilePath && fsSync.existsSync(tempFilePath)) {
      try {
        await fs.unlink(tempFilePath);
        console.log(`[Replace Video] Cleaned up temp file: ${tempFilePath}`);
      } catch (cleanupError) {
        console.warn(`[Replace Video] Could not cleanup temp file:`, cleanupError.message);
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to replace video file', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export async function getVideoById(req, res) {
  try {
    const { id } = req.params;
    const video = await videoService.getVideoById(id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Log raw database values for debugging
    console.log('[getVideoById] Raw video data from database:', {
      id: video.id,
      video_id: video.video_id,
      subject: video.subject,
      grade: video.grade,
      unit: video.unit,
      lesson: video.lesson,
      module: video.module,
      allKeys: Object.keys(video)
    });
    
    // Determine subject value (course column removed, only use subject)
    const subjectValue = (video.subject !== undefined && video.subject !== null && video.subject !== '') 
      ? video.subject 
      : null;
    
    // Ensure all fields are properly returned with backward compatibility
    const response = {
      ...video,
      subject: subjectValue,
      course: subjectValue, // Backward compatibility - always set course to same as subject
      grade: video.grade !== undefined ? video.grade : null,
      unit: video.unit !== undefined ? video.unit : null,
      lesson: video.lesson !== undefined ? video.lesson : null,
      module: video.module !== undefined ? video.module : null,
      activity: video.activity !== undefined ? video.activity : null
    };
    
    console.log('[getVideoById] Response data:', {
      id: response.id,
      video_id: response.video_id,
      subject: response.subject,
      course: response.course,
      grade: response.grade,
      unit: response.unit,
      lesson: response.lesson,
      module: response.module
    });
    
    res.json(response);
  } catch (error) {
    console.error('Get video by ID error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Diagnostic endpoint to check why subject, course, and module values are not being fetched
 * GET /api/videos/diagnostic/:id
 */
export async function getVideoMetadataDiagnostic(req, res) {
  try {
    const { id } = req.params; // Can be database ID or video_id
    
    const diagnostic = {
      videoId: id,
      timestamp: new Date().toISOString(),
      checks: [],
      errors: [],
      warnings: [],
      databaseSchema: {},
      rawDatabaseValues: null,
      serviceLayerValues: null,
      controllerLayerValues: null,
      recommendations: []
    };
    
    // Declare missingColumns outside try block so it's accessible throughout the function
    let missingColumns = [];
    
    // Check 1: Database Schema - Check which columns exist
    // First, ensure columns are created
    try {
      await ensureVideoColumns();
      console.log('[Diagnostic] Ensured video columns exist');
    } catch (ensureError) {
      console.warn('[Diagnostic] Error ensuring columns:', ensureError.message);
    }
    
    try {
      // Get database name first
      const [dbRows] = await pool.execute('SELECT DATABASE() as dbName');
      const dbName = dbRows[0]?.dbName;
      
      const [schemaRows] = await pool.execute(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = ?
        AND table_name = 'videos'
        AND column_name IN ('subject', 'course', 'module', 'unit', 'grade', 'lesson', 'activity', 'topic')
        ORDER BY column_name
      `, [dbName]);
      
      // Handle both lowercase and uppercase column names (MySQL can return either)
      const validRows = schemaRows.filter(row => {
        const colName = row.column_name || row.COLUMN_NAME;
        return colName && colName !== 'null' && colName !== null;
      });
      
      // Extract column names handling both cases
      const columnsFound = validRows.map(row => {
        return (row.column_name || row.COLUMN_NAME || '').toLowerCase();
      }).filter(Boolean);
      
      // Build column details
      const columnDetails = validRows.reduce((acc, row) => {
        const colName = (row.column_name || row.COLUMN_NAME || '').toLowerCase();
        if (colName) {
          acc[colName] = {
            type: (row.data_type || row.DATA_TYPE || 'unknown'),
            nullable: (row.is_nullable || row.IS_NULLABLE) === 'YES',
            default: row.column_default || row.COLUMN_DEFAULT
          };
        }
        return acc;
      }, {});
      
      diagnostic.databaseSchema = {
        columnsFound: columnsFound,
        columnDetails: columnDetails,
        rawQueryResult: schemaRows // For debugging
      };
      
      const requiredColumns = ['subject', 'course', 'module'];
      missingColumns = requiredColumns.filter(col => 
        !diagnostic.databaseSchema.columnsFound.includes(col)
      );
      
      if (missingColumns.length > 0) {
        diagnostic.warnings.push(`Missing columns in database: ${missingColumns.join(', ')}`);
        diagnostic.recommendations.push(`Add missing columns: ${missingColumns.join(', ')}`);
        
        // Try to create missing columns immediately
        try {
          console.log('[Diagnostic] Attempting to create missing columns:', missingColumns);
          for (const col of missingColumns) {
            try {
              if (col === 'subject') {
                await pool.execute("ALTER TABLE videos ADD COLUMN subject VARCHAR(255) NULL AFTER id");
                await pool.execute("ALTER TABLE videos ADD INDEX idx_subject (subject)");
              } else if (col === 'course') {
                await pool.execute("ALTER TABLE videos ADD COLUMN course VARCHAR(255) NULL AFTER subject");
              } else if (col === 'module') {
                await pool.execute("ALTER TABLE videos ADD COLUMN module VARCHAR(255) NULL AFTER lesson");
              }
              console.log(`[Diagnostic] Successfully created column: ${col}`);
            } catch (colError) {
              if (colError.code !== 'ER_DUP_FIELDNAME') {
                console.warn(`[Diagnostic] Failed to create column ${col}:`, colError.message);
              }
            }
          }
          
          // Re-check after creation
          const [newSchemaRows] = await pool.execute(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = ?
            AND table_name = 'videos'
            AND column_name IN ('subject', 'course', 'module', 'unit', 'grade', 'lesson', 'activity', 'topic')
            ORDER BY column_name
          `, [dbName]);
          
          const newValidRows = newSchemaRows.filter(row => {
            const colName = row.column_name || row.COLUMN_NAME;
            return colName && colName !== 'null' && colName !== null;
          });
          
          diagnostic.databaseSchema.columnsFound = newValidRows.map(row => {
            return (row.column_name || row.COLUMN_NAME || '').toLowerCase();
          }).filter(Boolean);
          missingColumns = requiredColumns.filter(col => 
            !diagnostic.databaseSchema.columnsFound.includes(col)
          );
        } catch (createError) {
          console.error('[Diagnostic] Error creating columns:', createError.message);
        }
      }
      
      diagnostic.checks.push({
        name: 'Database Schema Check',
        status: missingColumns.length === 0 ? 'pass' : 'warning',
        message: missingColumns.length === 0 
          ? 'All required columns exist'
          : `Missing columns: ${missingColumns.join(', ')}`,
        details: diagnostic.databaseSchema
      });
    } catch (schemaError) {
      diagnostic.errors.push(`Schema check failed: ${schemaError.message}`);
      diagnostic.checks.push({
        name: 'Database Schema Check',
        status: 'error',
        message: schemaError.message
      });
      // If schema check failed, we don't know which columns are missing
      // So we'll set missingColumns to an empty array to avoid errors later
      missingColumns = [];
    }
    
    // Check 2: Find video by ID (try both database ID and video_id)
    let videoRecord = null;
    let isDatabaseId = false;
    
    try {
      // Try as database ID first
      const [idRows] = await pool.execute('SELECT * FROM videos WHERE id = ?', [id]);
      if (idRows.length > 0) {
        videoRecord = idRows[0];
        isDatabaseId = true;
        diagnostic.checks.push({
          name: 'Video Lookup',
          status: 'pass',
          message: `Video found by database ID: ${id}`,
          details: { lookupType: 'database_id', videoId: videoRecord.video_id }
        });
      } else {
        // Try as video_id
        const [videoIdRows] = await pool.execute('SELECT * FROM videos WHERE video_id = ?', [id]);
        if (videoIdRows.length > 0) {
          videoRecord = videoIdRows[0];
          diagnostic.checks.push({
            name: 'Video Lookup',
            status: 'pass',
            message: `Video found by video_id: ${id}`,
            details: { lookupType: 'video_id', databaseId: videoRecord.id }
          });
        } else {
          diagnostic.errors.push(`Video not found with ID: ${id}`);
          diagnostic.checks.push({
            name: 'Video Lookup',
            status: 'error',
            message: `Video not found with ID: ${id}`
          });
          return res.status(404).json(diagnostic);
        }
      }
    } catch (lookupError) {
      diagnostic.errors.push(`Video lookup failed: ${lookupError.message}`);
      diagnostic.checks.push({
        name: 'Video Lookup',
        status: 'error',
        message: lookupError.message
      });
      return res.status(500).json(diagnostic);
    }
    
    // Check 3: Raw Database Values - What's actually stored
    diagnostic.rawDatabaseValues = {
      id: videoRecord.id,
      video_id: videoRecord.video_id,
      title: videoRecord.title,
      subject: videoRecord.subject,
      course: videoRecord.course,
      grade: videoRecord.grade,
      unit: videoRecord.unit,
      lesson: videoRecord.lesson,
      module: videoRecord.module,
      activity: videoRecord.activity,
      topic: videoRecord.topic,
      // Show raw types and values
      subjectType: typeof videoRecord.subject,
      courseType: typeof videoRecord.course,
      moduleType: typeof videoRecord.module,
      subjectIsNull: videoRecord.subject === null,
      courseIsNull: videoRecord.course === null,
      moduleIsNull: videoRecord.module === null,
      subjectIsUndefined: videoRecord.subject === undefined,
      courseIsUndefined: videoRecord.course === undefined,
      moduleIsUndefined: videoRecord.module === undefined,
      subjectIsEmpty: videoRecord.subject === '',
      courseIsEmpty: videoRecord.course === '',
      moduleIsEmpty: videoRecord.module === ''
    };
    
    // Check 4: Service Layer Processing
    try {
      const serviceVideo = await videoService.getVideoById(videoRecord.id);
      diagnostic.serviceLayerValues = {
        subject: serviceVideo?.subject,
        course: serviceVideo?.course,
        module: serviceVideo?.module,
        unit: serviceVideo?.unit,
        grade: serviceVideo?.grade,
        lesson: serviceVideo?.lesson,
        subjectType: typeof serviceVideo?.subject,
        courseType: typeof serviceVideo?.course,
        moduleType: typeof serviceVideo?.module
      };
      
      diagnostic.checks.push({
        name: 'Service Layer Processing',
        status: 'pass',
        message: 'Service layer processed video successfully',
        details: diagnostic.serviceLayerValues
      });
    } catch (serviceError) {
      diagnostic.errors.push(`Service layer processing failed: ${serviceError.message}`);
      diagnostic.checks.push({
        name: 'Service Layer Processing',
        status: 'error',
        message: serviceError.message
      });
    }
    
    // Check 5: Controller Layer Processing (via getAllVideos)
    try {
      const result = await videoService.getAllVideos({});
      const allVideos = result.videos || [];
      const controllerVideo = allVideos.find(v => 
        v.id === videoRecord.id || v.video_id === videoRecord.video_id
      );
      
      if (controllerVideo) {
        diagnostic.controllerLayerValues = {
          subject: controllerVideo.subject,
          course: controllerVideo.course,
          module: controllerVideo.module,
          unit: controllerVideo.unit,
          grade: controllerVideo.grade,
          lesson: controllerVideo.lesson,
          subjectType: typeof controllerVideo.subject,
          courseType: typeof controllerVideo.course,
          moduleType: typeof controllerVideo.module
        };
        
        diagnostic.checks.push({
          name: 'Controller Layer Processing',
          status: 'pass',
          message: 'Controller layer processed video successfully',
          details: diagnostic.controllerLayerValues
        });
      } else {
        diagnostic.warnings.push('Video not found in getAllVideos result');
      }
    } catch (controllerError) {
      diagnostic.errors.push(`Controller layer processing failed: ${controllerError.message}`);
    }
    
    // Analysis: Compare values at each layer with detailed test cases
    const analysis = {
      subjectValueLost: false,
      courseValueLost: false,
      moduleValueLost: false,
      issues: [],
      testCases: [],
      rootCause: null,
      solution: null
    };
    
    // Test Case 1: Check if values exist in database
    const testCase1 = {
      name: 'Database Storage Test',
      description: 'Check if subject and module values are stored in the database',
      status: 'unknown',
      details: {},
      passed: false,
      failureReason: null
    };
    
    if (diagnostic.rawDatabaseValues.subjectIsNull && diagnostic.rawDatabaseValues.courseIsNull) {
      analysis.subjectValueLost = true;
      testCase1.status = 'failed';
      testCase1.passed = false;
      testCase1.failureReason = 'Subject value is NULL in database';
      testCase1.details = {
        databaseValue: diagnostic.rawDatabaseValues.subject,
        isNull: diagnostic.rawDatabaseValues.subjectIsNull,
        isUndefined: diagnostic.rawDatabaseValues.subjectIsUndefined,
        isEmpty: diagnostic.rawDatabaseValues.subjectIsEmpty
      };
      analysis.issues.push('❌ TEST FAILED: Subject value is NULL in database - value was never saved during upload or update');
      analysis.rootCause = 'Values were never saved to database. This happens when: 1) Video was uploaded before columns existed, 2) Upload form did not include subject/module values, 3) Update function failed to save values';
      analysis.solution = 'SOLUTION: Edit the video and manually enter subject and module values, then save. For new uploads, ensure the upload form includes subject and module fields.';
    } else {
      testCase1.status = 'passed';
      testCase1.passed = true;
      testCase1.details = {
        databaseValue: diagnostic.rawDatabaseValues.subject || diagnostic.rawDatabaseValues.course,
        stored: true
      };
    }
    
    if (diagnostic.rawDatabaseValues.moduleIsNull) {
      analysis.moduleValueLost = true;
      const testCase1b = {
        name: 'Module Database Storage Test',
        description: 'Check if module value is stored in the database',
        status: 'failed',
        passed: false,
        failureReason: 'Module value is NULL in database',
        details: {
          databaseValue: diagnostic.rawDatabaseValues.module,
          isNull: diagnostic.rawDatabaseValues.moduleIsNull,
          isUndefined: diagnostic.rawDatabaseValues.moduleIsUndefined,
          isEmpty: diagnostic.rawDatabaseValues.moduleIsEmpty
        }
      };
      analysis.testCases.push(testCase1b);
      analysis.issues.push('❌ TEST FAILED: Module value is NULL in database - value was never saved during upload or update');
    } else {
      const testCase1b = {
        name: 'Module Database Storage Test',
        description: 'Check if module value is stored in the database',
        status: 'passed',
        passed: true,
        details: {
          databaseValue: diagnostic.rawDatabaseValues.module,
          stored: true
        }
      };
      analysis.testCases.push(testCase1b);
    }
    
    analysis.testCases.push(testCase1);
    
    // Test Case 2: Check if service layer retrieves values correctly
    const testCase2 = {
      name: 'Service Layer Retrieval Test',
      description: 'Check if service layer (getVideoById) correctly retrieves subject and module from database',
      status: 'unknown',
      details: {},
      passed: false,
      failureReason: null
    };
    
    if (diagnostic.serviceLayerValues) {
      const dbHasSubject = !diagnostic.rawDatabaseValues.subjectIsNull;
      const serviceHasSubject = diagnostic.serviceLayerValues.subject !== null && diagnostic.serviceLayerValues.subject !== undefined;
      
      if (dbHasSubject && !serviceHasSubject) {
        testCase2.status = 'failed';
        testCase2.passed = false;
        testCase2.failureReason = 'Service layer lost subject value during retrieval';
        testCase2.details = {
          databaseValue: diagnostic.rawDatabaseValues.subject,
          serviceValue: diagnostic.serviceLayerValues.subject,
          mismatch: true
        };
        analysis.issues.push('❌ TEST FAILED: Subject value exists in database but service layer returned NULL');
        analysis.rootCause = 'Service layer (getVideoById) is not correctly retrieving subject value from database';
        analysis.solution = 'SOLUTION: Check getVideoById function in videoService.js - ensure it selects subject column and maps it correctly';
      } else if (!dbHasSubject) {
        testCase2.status = 'skipped';
        testCase2.passed = true;
        testCase2.details = {
          reason: 'Cannot test - value does not exist in database',
          databaseValue: null
        };
      } else {
        testCase2.status = 'passed';
        testCase2.passed = true;
        testCase2.details = {
          databaseValue: diagnostic.rawDatabaseValues.subject,
          serviceValue: diagnostic.serviceLayerValues.subject,
          match: true
        };
      }
      
      const dbHasModule = !diagnostic.rawDatabaseValues.moduleIsNull;
      const serviceHasModule = diagnostic.serviceLayerValues.module !== null && diagnostic.serviceLayerValues.module !== undefined;
      
      if (dbHasModule && !serviceHasModule) {
        const testCase2b = {
          name: 'Module Service Layer Retrieval Test',
          description: 'Check if service layer correctly retrieves module from database',
          status: 'failed',
          passed: false,
          failureReason: 'Service layer lost module value during retrieval',
          details: {
            databaseValue: diagnostic.rawDatabaseValues.module,
            serviceValue: diagnostic.serviceLayerValues.module,
            mismatch: true
          }
        };
        analysis.testCases.push(testCase2b);
        analysis.issues.push('❌ TEST FAILED: Module value exists in database but service layer returned NULL');
      } else if (!dbHasModule) {
        const testCase2b = {
          name: 'Module Service Layer Retrieval Test',
          description: 'Check if service layer correctly retrieves module from database',
          status: 'skipped',
          passed: true,
          details: {
            reason: 'Cannot test - value does not exist in database',
            databaseValue: null
          }
        };
        analysis.testCases.push(testCase2b);
      } else {
        const testCase2b = {
          name: 'Module Service Layer Retrieval Test',
          description: 'Check if service layer correctly retrieves module from database',
          status: 'passed',
          passed: true,
          details: {
            databaseValue: diagnostic.rawDatabaseValues.module,
            serviceValue: diagnostic.serviceLayerValues.module,
            match: true
          }
        };
        analysis.testCases.push(testCase2b);
      }
    }
    
    analysis.testCases.push(testCase2);
    
    // Test Case 3: Check if controller layer retrieves values correctly
    const testCase3 = {
      name: 'Controller Layer Retrieval Test',
      description: 'Check if controller layer (getAllVideos) correctly retrieves and maps subject and module',
      status: 'unknown',
      details: {},
      passed: false,
      failureReason: null
    };
    
    if (diagnostic.controllerLayerValues) {
      const serviceHasSubject = diagnostic.serviceLayerValues?.subject !== null && diagnostic.serviceLayerValues?.subject !== undefined;
      const controllerHasSubject = diagnostic.controllerLayerValues.subject !== null && diagnostic.controllerLayerValues.subject !== undefined;
      
      if (serviceHasSubject && !controllerHasSubject) {
        testCase3.status = 'failed';
        testCase3.passed = false;
        testCase3.failureReason = 'Controller layer lost subject value during mapping';
        testCase3.details = {
          serviceValue: diagnostic.serviceLayerValues.subject,
          controllerValue: diagnostic.controllerLayerValues.subject,
          mismatch: true
        };
        analysis.issues.push('❌ TEST FAILED: Subject value exists in service layer but controller layer returned NULL');
        analysis.rootCause = 'Controller layer (getAllVideos) is not correctly mapping subject value';
        analysis.solution = 'SOLUTION: Check getAllVideos function in videoController.js - ensure it maps subject correctly from service layer response';
      } else if (!serviceHasSubject) {
        testCase3.status = 'skipped';
        testCase3.passed = true;
        testCase3.details = {
          reason: 'Cannot test - value does not exist in service layer',
          serviceValue: null
        };
      } else {
        testCase3.status = 'passed';
        testCase3.passed = true;
        testCase3.details = {
          serviceValue: diagnostic.serviceLayerValues.subject,
          controllerValue: diagnostic.controllerLayerValues.subject,
          match: true
        };
      }
      
      const serviceHasModule = diagnostic.serviceLayerValues?.module !== null && diagnostic.serviceLayerValues?.module !== undefined;
      const controllerHasModule = diagnostic.controllerLayerValues.module !== null && diagnostic.controllerLayerValues.module !== undefined;
      
      if (serviceHasModule && !controllerHasModule) {
        const testCase3b = {
          name: 'Module Controller Layer Retrieval Test',
          description: 'Check if controller layer correctly retrieves and maps module',
          status: 'failed',
          passed: false,
          failureReason: 'Controller layer lost module value during mapping',
          details: {
            serviceValue: diagnostic.serviceLayerValues.module,
            controllerValue: diagnostic.controllerLayerValues.module,
            mismatch: true
          }
        };
        analysis.testCases.push(testCase3b);
        analysis.issues.push('❌ TEST FAILED: Module value exists in service layer but controller layer returned NULL');
      } else if (!serviceHasModule) {
        const testCase3b = {
          name: 'Module Controller Layer Retrieval Test',
          description: 'Check if controller layer correctly retrieves and maps module',
          status: 'skipped',
          passed: true,
          details: {
            reason: 'Cannot test - value does not exist in service layer',
            serviceValue: null
          }
        };
        analysis.testCases.push(testCase3b);
      } else {
        const testCase3b = {
          name: 'Module Controller Layer Retrieval Test',
          description: 'Check if controller layer correctly retrieves and maps module',
          status: 'passed',
          passed: true,
          details: {
            serviceValue: diagnostic.serviceLayerValues.module,
            controllerValue: diagnostic.controllerLayerValues.module,
            match: true
          }
        };
        analysis.testCases.push(testCase3b);
      }
    }
    
    analysis.testCases.push(testCase3);
    
    // Test Case 4: Check column existence
    const testCase4 = {
      name: 'Column Existence Test',
      description: 'Verify that subject and module columns exist in database schema',
      status: missingColumns.length === 0 ? 'passed' : 'failed',
      passed: missingColumns.length === 0,
      failureReason: missingColumns.length > 0 ? `Missing columns: ${missingColumns.join(', ')}` : null,
      details: {
        requiredColumns: ['subject', 'module'],
        existingColumns: diagnostic.databaseSchema.columnsFound,
        missingColumns: missingColumns
      }
    };
    
    if (missingColumns.length > 0) {
      analysis.issues.push(`❌ TEST FAILED: Required columns missing: ${missingColumns.join(', ')}`);
      analysis.rootCause = `Database columns ${missingColumns.join(', ')} do not exist. Values cannot be stored without these columns.`;
      analysis.solution = `SOLUTION: Run database migration to add missing columns. The diagnostic will attempt to create them automatically.`;
    }
    
    analysis.testCases.push(testCase4);
    
    // Test Case 5: Check data type consistency
    const testCase5 = {
      name: 'Data Type Consistency Test',
      description: 'Verify that subject and module values have consistent data types across layers',
      status: 'unknown',
      details: {},
      passed: false,
      failureReason: null
    };
    
    if (diagnostic.rawDatabaseValues && diagnostic.serviceLayerValues && diagnostic.controllerLayerValues) {
      const dbSubjectType = diagnostic.rawDatabaseValues.subjectType;
      const serviceSubjectType = diagnostic.serviceLayerValues.subjectType;
      const controllerSubjectType = diagnostic.controllerLayerValues.subjectType;
      
      if (dbSubjectType === serviceSubjectType && serviceSubjectType === controllerSubjectType) {
        testCase5.status = 'passed';
        testCase5.passed = true;
        testCase5.details = {
          consistent: true,
          type: dbSubjectType
        };
      } else {
        testCase5.status = 'warning';
        testCase5.passed = true;
        testCase5.details = {
          consistent: false,
          databaseType: dbSubjectType,
          serviceType: serviceSubjectType,
          controllerType: controllerSubjectType
        };
        analysis.issues.push('⚠️ WARNING: Data types are inconsistent across layers - this may cause display issues');
      }
    } else {
      testCase5.status = 'skipped';
      testCase5.passed = true;
      testCase5.details = { reason: 'Cannot test - values are NULL' };
    }
    
    analysis.testCases.push(testCase5);
    
    // Summary of test results
    const passedTests = analysis.testCases.filter(t => t.passed).length;
    const totalTests = analysis.testCases.length;
    analysis.testSummary = {
      total: totalTests,
      passed: passedTests,
      failed: totalTests - passedTests,
      passRate: `${Math.round((passedTests / totalTests) * 100)}%`
    };
    
    diagnostic.analysis = analysis;
    
    // Generate recommendations
    if (analysis.subjectValueLost) {
      diagnostic.recommendations.push('Update the video to set subject and course values');
      diagnostic.recommendations.push('Check upload/creation process to ensure subject is being saved');
    }
    
    if (analysis.moduleValueLost) {
      diagnostic.recommendations.push('Update the video to set module value');
      diagnostic.recommendations.push('Check upload/creation process to ensure module is being saved');
    }
    
    if (missingColumns.length > 0) {
      diagnostic.recommendations.push('Run database migration to add missing columns');
    }
    
    // Overall status
    const hasErrors = diagnostic.errors.length > 0;
    const hasWarnings = diagnostic.warnings.length > 0 || analysis.issues.length > 0;
    
    diagnostic.status = hasErrors ? 'error' : (hasWarnings ? 'warning' : 'healthy');
    diagnostic.summary = {
      videoFound: true,
      columnsExist: missingColumns.length === 0,
      valuesPresent: !analysis.subjectValueLost && !analysis.moduleValueLost,
      issuesFound: analysis.issues.length
    };
    
    res.json(diagnostic);
  } catch (error) {
    console.error('[Video Metadata Diagnostic] Error:', error);
    res.status(500).json({
      error: 'Diagnostic failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

/**
 * Quick fix endpoint to set test values for subject and module
 * POST /api/videos/diagnostic/:id/quick-fix
 */
export async function quickFixVideoMetadata(req, res) {
  try {
    const { id } = req.params;
    const { subject, module } = req.body;
    
    // Ensure columns exist
    await ensureVideoColumns();
    
    // Update the video with provided values
    const updates = {};
    if (subject !== undefined) {
      updates.subject = subject;
    }
    if (module !== undefined) {
      updates.module = module;
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No values provided to update' });
    }
    
    console.log('[Quick Fix] Updating video ID:', id, 'with values:', updates);
    
    const success = await videoService.updateVideo(id, updates);
    
    if (success) {
      // Fetch updated video to verify
      const updatedVideo = await videoService.getVideoById(id);
      
      res.json({
        success: true,
        message: 'Video metadata updated successfully',
        video: {
          id: updatedVideo.id,
          video_id: updatedVideo.video_id,
          subject: updatedVideo.subject,
          module: updatedVideo.module,
          grade: updatedVideo.grade,
          unit: updatedVideo.unit,
          lesson: updatedVideo.lesson
        }
      });
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  } catch (error) {
    console.error('[Quick Fix] Error:', error);
    res.status(500).json({
      error: 'Quick fix failed',
      message: error.message
    });
  }
}

export async function updateVideo(req, res) {
  try {
    const { id } = req.params;
    await ensureVideoColumns();
    const success = await videoService.updateVideo(id, req.body);
    if (success) {
      const video = await videoService.getVideoById(id);
      res.json(video);
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function deleteVideo(req, res) {
  try {
    const { id } = req.params;
    const success = await videoService.deleteVideo(id);
    if (success) {
      res.json({ message: 'Video deleted successfully' });
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function getDeletedVideos(req, res) {
  try {
    console.log('[Get Deleted Videos] Fetching all deleted videos');
    
    // Use SELECT * to get all columns, then map them in code
    // This avoids issues with missing columns in the database
    const query = `
      SELECT * 
      FROM videos 
      WHERE status = 'deleted'
      ORDER BY updated_at DESC
    `;
    
    console.log('[Get Deleted Videos] Executing query');
    const [deletedVideos] = await pool.execute(query);
    
    // Build response with QR code data
    // Use redirect slug format: http://localhost:5173/{redirect_slug} (same as QR Code Storage)
    const frontendUrl = config.urls?.frontend || 'http://localhost:5173';
    const videos = deletedVideos.map(video => {
      // Use redirect slug format: {frontendUrl}/{redirect_slug}
      // If no redirect_slug, fallback to video page link
      const shortUrl = video.redirect_slug 
        ? `${frontendUrl}/${video.redirect_slug}`
        : `${frontendUrl}/stream/${video.video_id}`;
      
      return {
        id: video.id,
        videoId: video.video_id,
        title: video.title || video.video_id,
        subject: video.subject || video.course || null,
        course: video.subject || video.course || null,
        grade: video.grade || null,
        unit: video.unit || null,
        lesson: video.lesson || null,
        module: video.module || null,
        topic: video.topic || null,
        shortSlug: video.redirect_slug || null,
        shortUrl: shortUrl, // Redirect slug format: {frontendUrl}/{redirect_slug}
        qrUrl: video.qr_url || null,
        streamingUrl: video.streaming_url || null,
        createdAt: video.created_at,
        updatedAt: video.updated_at,
        deletedAt: video.updated_at // When status was changed to deleted
      };
    });
    
    console.log(`[Get Deleted Videos] Found ${videos.length} deleted videos`);
    res.json(videos);
  } catch (error) {
    console.error('[Get Deleted Videos] Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      errno: error.errno,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    
    // Provide more helpful error messages
    let errorMessage = error.message;
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      errorMessage = 'Database schema mismatch. Some columns may be missing.';
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Database connection failed. Please check database server.';
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      errorMessage = 'Database access denied. Please check credentials.';
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch deleted videos', 
      message: errorMessage,
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? {
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        errno: error.errno
      } : undefined
    });
  }
}

export async function permanentDeleteVideo(req, res) {
  try {
    const { id } = req.params;
    console.log(`[Permanent Delete] Permanently deleting video with ID: ${id}`);
    
    const success = await videoService.permanentDeleteVideo(id);
    if (success) {
      console.log(`[Permanent Delete] Video ${id} permanently deleted successfully`);
      res.json({ 
        success: true,
        message: 'Video permanently deleted successfully' 
      });
    } else {
      res.status(404).json({ 
        success: false,
        error: 'Video not found or already deleted' 
      });
    }
  } catch (error) {
    console.error('[Permanent Delete] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to permanently delete video',
      message: error.message 
    });
  }
}

export async function permanentDeleteVideos(req, res) {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No video IDs provided' 
      });
    }

    console.log(`[Bulk Permanent Delete] Permanently deleting ${ids.length} videos`);
    const results = await videoService.permanentDeleteVideos(ids);
    
    console.log(`[Bulk Permanent Delete] Deleted ${results.deleted} out of ${ids.length} videos`);
    res.json({
      success: results.success,
      deleted: results.deleted,
      total: ids.length,
      errors: results.errors,
      message: `Successfully deleted ${results.deleted} out of ${ids.length} videos`
    });
  } catch (error) {
    console.error('[Bulk Permanent Delete] Error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to permanently delete videos',
      message: error.message 
    });
  }
}

export async function restoreVideo(req, res) {
  try {
    const { id } = req.params;
    console.log(`[Restore Video] Restoring video with ID: ${id}`);
    
    const success = await videoService.restoreVideo(id);
    if (success) {
      console.log(`[Restore Video] Video ${id} restored successfully`);
      res.json({ message: 'Video restored successfully' });
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  } catch (error) {
    console.error('[Restore Video] Error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function getAllQRCodes(req, res) {
  try {
    // Ensure required columns exist to avoid ER_BAD_FIELD_ERROR
    await ensureQrColumns();

    console.log('[Get All QR Codes] Fetching videos with short link QR codes only');
    
    // Use SELECT * to get all columns, then map them in code
    // This avoids issues with missing columns in the database
    // Only return videos that have redirect_slug (short link format)
    // This ensures we only show QR codes for videos with short links (not backend-generated ones)
    const query = `
      SELECT * 
      FROM videos 
      WHERE status = 'active' 
        AND redirect_slug IS NOT NULL
        AND redirect_slug != ''
      ORDER BY created_at DESC
    `;
    
    console.log('[Get All QR Codes] Executing query - only videos with redirect_slug');
    const [videos] = await pool.execute(query);
    
    // Build QR code data with short URLs
    // Use redirect slug format: http://localhost:5173/{redirect_slug} (e.g., http://localhost:5173/h13cidw56d)
    const frontendUrl = config.urls?.frontend || 'http://localhost:5173';
    const qrCodes = videos.map(video => {
      // Use redirect slug format: {frontendUrl}/{redirect_slug}
      // Only videos with redirect_slug are included, so this will always be the short link format
      const shortUrl = `${frontendUrl}/${video.redirect_slug}`;
      
      return {
        id: video.id, // Database ID - unique for each version
        videoId: video.video_id,
        title: video.title || video.video_id,
        subject: video.subject || video.course || null,
        course: video.subject || video.course || null, // Backward compatibility
        grade: video.grade || null,
        unit: video.unit || null,
        lesson: video.lesson || null,
        module: video.module || null,
        version: video.version !== null && video.version !== undefined ? String(video.version) : null,
        topic: video.topic || null,
        shortSlug: video.redirect_slug || null,
        shortUrl: shortUrl, // Redirect slug format: {frontendUrl}/{redirect_slug}
        qrUrl: video.qr_url || null,
        streamingUrl: video.streaming_url || null,
        createdAt: video.created_at,
        updatedAt: video.updated_at
      };
    });
    
    console.log(`[Get All QR Codes] Found ${qrCodes.length} videos with QR codes`);
    
    res.json(qrCodes);
  } catch (error) {
    console.error('[Get All QR Codes] Error details:', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      errno: error.errno,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    
    // Provide more helpful error messages
    let errorMessage = error.message;
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      errorMessage = 'Database schema mismatch. Some columns may be missing.';
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      errorMessage = 'Database connection failed. Please check database server.';
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      errorMessage = 'Database access denied. Please check credentials.';
    }
    
    res.status(500).json({ 
      error: 'Failed to fetch QR codes', 
      message: errorMessage,
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? {
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        errno: error.errno
      } : undefined
    });
  }
}

export async function downloadQRCode(req, res) {
  try {
    const { videoId } = req.params;
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }
    
    console.log(`[Download QR Code] Requested for video: ${videoId}`);
    
    // Try to get video by videoId first, then by redirect_slug (since redirect_slug is unique per version)
    let video = await videoService.getVideoByVideoId(videoId, true);
    
    // If not found by videoId, try by redirect_slug (for version-specific downloads)
    if (!video) {
      video = await videoService.getVideoByRedirectSlug(videoId, true);
    }
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Only allow download for videos with redirect_slug (short link format)
    if (!video.redirect_slug) {
      return res.status(400).json({ 
        error: 'Video does not have a short link', 
        message: 'Only videos with short links can have QR codes downloaded' 
      });
    }
    
    // Generate filename in format G{grade}_U{unit}_L{lesson}_M{module}_V{version}.png
    // Order: Grade, Unit, Lesson, Module, Version (G_U_L_M_V)
    // Version is critical to differentiate between videos with same metadata but different versions
    const parts = [];
    if (video.grade !== null && video.grade !== undefined && String(video.grade).trim() !== '') {
      parts.push(`G${video.grade}`);
    }
    if (video.unit !== null && video.unit !== undefined && String(video.unit).trim() !== '') {
      parts.push(`U${video.unit}`);
    }
    if (video.lesson !== null && video.lesson !== undefined && String(video.lesson).trim() !== '') {
      parts.push(`L${video.lesson}`);
    }
    if (video.module !== null && video.module !== undefined && String(video.module).trim() !== '') {
      parts.push(`M${video.module}`);
    }
    if (video.version !== null && video.version !== undefined && String(video.version).trim() !== '') {
      parts.push(`V${video.version}`); // Add version to differentiate between versions
    }
    
    const filename = parts.length > 0 
      ? parts.join('_') + '.png'
      : `${videoId}_qr_code.png`;
    
    // Always (re)generate QR code with the public short link so the downloaded QR matches UI
    // Build short URL using redirect_slug format: {frontend}/{redirect_slug}
    // Use redirect_slug as the QR code identifier to ensure each version has a unique QR code
    const frontendUrl = config.urls?.frontend || 'http://localhost:5173';
    const shortUrl = `${frontendUrl}/${video.redirect_slug || videoId}`;
    const qrCodeIdentifier = video.redirect_slug || videoId; // Use redirect_slug for unique QR codes per version
    try {
      await qrCodeService.generateQRCode(qrCodeIdentifier, shortUrl);
      const qrBuffer = await qrCodeService.downloadQRCode(qrCodeIdentifier);
      
      // Set headers for file download
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', qrBuffer.length);
      
      console.log(`[Download QR Code] ✓ Sending QR code file for video: ${videoId} as ${filename}`);
      res.send(qrBuffer);
    } catch (qrError) {
      // If QR code file doesn't exist, try to generate it
      if (qrError.message.includes('not found') || qrError.code === 'ENOENT') {
        console.log(`[Download QR Code] QR code file not found, generating new one for: ${qrCodeIdentifier}`);
        
        // Generate QR code with the public short link using redirect_slug as identifier
        const qrUrl = await qrCodeService.generateQRCode(qrCodeIdentifier, shortUrl);
        
        // Download the newly generated QR code
        const qrBuffer = await qrCodeService.downloadQRCode(qrCodeIdentifier);
        
        // Set headers for file download
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', qrBuffer.length);
        
        console.log(`[Download QR Code] ✓ Generated and sent QR code for video: ${videoId} as ${filename}`);
        res.send(qrBuffer);
      } else {
        throw qrError;
      }
    }
  } catch (error) {
    console.error('Download QR code error:', error);
    res.status(500).json({ 
      error: 'Failed to download QR code', 
      message: error.message 
    });
  }
}

export async function getVideoVersions(req, res) {
  try {
    const { videoId } = req.params;
    const versions = await videoService.getVideoVersions(videoId);
    res.json(versions);
  } catch (error) {
    console.error('Get video versions error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function getVideoDiagnostic(req, res) {
  try {
    const { videoId } = req.params;
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }

    console.log(`[Video Diagnostic] Checking video: ${videoId}`);

    const diagnostic = {
      videoId: videoId,
      fileExists: false,
      resolvedPath: null,
      fileSize: null,
      fileModified: null,
      possiblePaths: [],
      errors: []
    };

    // Get video from database (try both videoId and redirect_slug)
    let video = null;
    try {
      video = await videoService.getVideoByVideoId(videoId, true);
      if (!video) {
        video = await videoService.getVideoByRedirectSlug(videoId, true);
      }
    } catch (err) {
      diagnostic.errors.push(`Error fetching video: ${err.message}`);
      return res.json(diagnostic);
    }

    if (!video) {
      diagnostic.errors.push('Video not found in database');
      return res.json(diagnostic);
    }

    // Resolve file paths
    const backendDir = path.dirname(__dirname);
    const basePath = path.dirname(backendDir);
    let uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    
    const myStoragePath = path.join(uploadPath, 'my-storage');

    // Strategy 1: Try fixed format path (block storage): my-storage/<redirect_slug>.mp4
    if (video.redirect_slug) {
      const fixedPath = path.join(myStoragePath, `${video.redirect_slug}.mp4`);
      diagnostic.possiblePaths.push({
        path: fixedPath,
        strategy: 'Fixed format (block storage)',
        relative: `my-storage/${video.redirect_slug}.mp4`
      });
      
      if (fsSync.existsSync(fixedPath)) {
        const stats = fsSync.statSync(fixedPath);
        diagnostic.fileExists = true;
        diagnostic.resolvedPath = fixedPath;
        diagnostic.fileSize = stats.size;
        diagnostic.fileModified = stats.mtime.toISOString();
        return res.json(diagnostic);
      }
    }

    // Strategy 2: Try my-storage/<video_id>.mp4
    const videoIdPath = path.join(myStoragePath, `${video.video_id}.mp4`);
    diagnostic.possiblePaths.push({
      path: videoIdPath,
      strategy: 'Video ID format',
      relative: `my-storage/${video.video_id}.mp4`
    });
    
    if (fsSync.existsSync(videoIdPath)) {
      const stats = fsSync.statSync(videoIdPath);
      diagnostic.fileExists = true;
      diagnostic.resolvedPath = videoIdPath;
      diagnostic.fileSize = stats.size;
      diagnostic.fileModified = stats.mtime.toISOString();
      return res.json(diagnostic);
    }

    // Strategy 3: Try database file_path
    if (video.file_path) {
      let dbPath;
      if (path.isAbsolute(video.file_path)) {
        dbPath = video.file_path;
      } else {
        dbPath = path.join(uploadPath, video.file_path);
      }
      diagnostic.possiblePaths.push({
        path: dbPath,
        strategy: 'Database file_path',
        relative: video.file_path
      });
      
      if (fsSync.existsSync(dbPath)) {
        const stats = fsSync.statSync(dbPath);
        diagnostic.fileExists = true;
        diagnostic.resolvedPath = dbPath;
        diagnostic.fileSize = stats.size;
        diagnostic.fileModified = stats.mtime.toISOString();
        return res.json(diagnostic);
      }
    }

    // Strategy 4: Try misc folder
    const miscPath = path.join(uploadPath, 'misc', video.video_id + '.mp4');
    diagnostic.possiblePaths.push({
      path: miscPath,
      strategy: 'Misc folder',
      relative: `misc/${video.video_id}.mp4`
    });
    
    if (fsSync.existsSync(miscPath)) {
      const stats = fsSync.statSync(miscPath);
      diagnostic.fileExists = true;
      diagnostic.resolvedPath = miscPath;
      diagnostic.fileSize = stats.size;
      diagnostic.fileModified = stats.mtime.toISOString();
      return res.json(diagnostic);
    }

    // Strategy 5: Try nested folder structure (G{grade}/U{unit}/L{lesson}/)
    if (video.grade && video.unit && video.lesson) {
      const nestedPath = path.join(
        uploadPath,
        `G${String(video.grade).padStart(2, '0')}`,
        `U${String(video.unit).padStart(2, '0')}`,
        `L${String(video.lesson).padStart(2, '0')}`,
        `${video.video_id}.mp4`
      );
      diagnostic.possiblePaths.push({
        path: nestedPath,
        strategy: 'Nested folder structure',
        relative: `G${String(video.grade).padStart(2, '0')}/U${String(video.unit).padStart(2, '0')}/L${String(video.lesson).padStart(2, '0')}/${video.video_id}.mp4`
      });
      
      if (fsSync.existsSync(nestedPath)) {
        const stats = fsSync.statSync(nestedPath);
        diagnostic.fileExists = true;
        diagnostic.resolvedPath = nestedPath;
        diagnostic.fileSize = stats.size;
        diagnostic.fileModified = stats.mtime.toISOString();
        return res.json(diagnostic);
      }
    }

    // Strategy 6: Try to find file by VID pattern in my-storage
    try {
      if (fsSync.existsSync(myStoragePath)) {
        const files = fsSync.readdirSync(myStoragePath);
        const videoIdPattern = new RegExp(video.video_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        for (const file of files) {
          if (videoIdPattern.test(file) && file.endsWith('.mp4')) {
            const foundPath = path.join(myStoragePath, file);
            diagnostic.possiblePaths.push({
              path: foundPath,
              strategy: 'VID pattern match',
              relative: `my-storage/${file}`
            });
            
            const stats = fsSync.statSync(foundPath);
            diagnostic.fileExists = true;
            diagnostic.resolvedPath = foundPath;
            diagnostic.fileSize = stats.size;
            diagnostic.fileModified = stats.mtime.toISOString();
            return res.json(diagnostic);
          }
        }
      }
    } catch (searchError) {
      diagnostic.errors.push(`Error searching my-storage: ${searchError.message}`);
    }

    // File not found
    diagnostic.errors.push('Video file not found in any expected location');
    res.json(diagnostic);
  } catch (error) {
    console.error('Video diagnostic error:', error);
    res.status(500).json({
      error: 'Diagnostic failed',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

export async function getFilterValues(req, res) {
  try {
    // Get subject filter from query parameter
    const subjectFilter = req.query.subject || null;
    const values = await videoService.getFilterValues(subjectFilter);
    res.json(values);
  } catch (error) {
    console.error('Get filter values error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Generate CSV from all videos in database
 * Format: ID, Title, Link/Path, Grade, Lesson, Module, Activity
 * No thumbnail column
 */
/**
 * Increment view count for a video
 */
/**
 * Backfill video durations for videos that have duration = 0
 * This extracts duration from video files and updates the database
 */
export async function backfillVideoDurations(req, res) {
  try {
    console.log('[Backfill Durations] Starting duration backfill process...');
    
    // Get all videos with duration = 0 or NULL
    const [videos] = await pool.execute(
      `SELECT id, video_id, file_path, duration 
       FROM videos 
       WHERE (duration IS NULL OR duration = 0) 
       AND file_path IS NOT NULL 
       AND file_path != ''
       AND status != 'deleted'
       ORDER BY created_at DESC`
    );
    
    console.log(`[Backfill Durations] Found ${videos.length} videos without duration`);
    
    if (videos.length === 0) {
      return res.json({
        success: true,
        message: 'All videos already have duration values',
        processed: 0,
        updated: 0,
        failed: 0
      });
    }
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const videoStoragePath = path.join(__dirname, '../../video-storage');
    
    let updated = 0;
    let failed = 0;
    const results = [];
    
    // Process videos in batches to avoid overwhelming the system
    const batchSize = 10;
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      
      for (const video of batch) {
        try {
          // Construct full file path
          let fullPath;
          if (video.file_path.startsWith('/') || video.file_path.match(/^[A-Za-z]:/)) {
            // Absolute path
            fullPath = video.file_path;
          } else {
            // Relative path - try video-storage first, then upload directory
            fullPath = path.join(videoStoragePath, video.file_path);
            if (!fsSync.existsSync(fullPath)) {
              // Try upload directory
              const uploadPath = path.join(__dirname, '../../upload', video.file_path);
              if (fsSync.existsSync(uploadPath)) {
                fullPath = uploadPath;
              }
            }
          }
          
          // Check if file exists
          if (!fsSync.existsSync(fullPath)) {
            console.warn(`[Backfill Durations] File not found for video ${video.video_id}: ${fullPath}`);
            failed++;
            results.push({
              video_id: video.video_id,
              status: 'failed',
              reason: 'File not found'
            });
            continue;
          }
          
          // Extract duration
          const duration = await getVideoDuration(fullPath);
          
          if (duration > 0) {
            // Update database
            await pool.execute(
              'UPDATE videos SET duration = ? WHERE id = ?',
              [duration, video.id]
            );
            updated++;
            results.push({
              video_id: video.video_id,
              status: 'updated',
              duration: duration
            });
            console.log(`[Backfill Durations] ✓ Updated video ${video.video_id}: ${duration}s`);
          } else {
            failed++;
            results.push({
              video_id: video.video_id,
              status: 'failed',
              reason: 'Could not extract duration'
            });
            console.warn(`[Backfill Durations] ⚠ Could not extract duration for video ${video.video_id}`);
          }
        } catch (error) {
          failed++;
          results.push({
            video_id: video.video_id,
            status: 'failed',
            reason: error.message
          });
          console.error(`[Backfill Durations] Error processing video ${video.video_id}:`, error.message);
        }
      }
      
      // Small delay between batches
      if (i + batchSize < videos.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`[Backfill Durations] Completed: ${updated} updated, ${failed} failed`);
    
    res.json({
      success: true,
      message: `Processed ${videos.length} videos`,
      processed: videos.length,
      updated: updated,
      failed: failed,
      results: results.slice(0, 50) // Return first 50 results to avoid huge response
    });
  } catch (error) {
    console.error('[Backfill Durations] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

export async function incrementVideoViews(req, res) {
  try {
    const { videoId } = req.params;
    
    if (!videoId) {
      return res.status(400).json({ error: 'Video ID is required' });
    }
    
    const newViews = await videoService.incrementVideoViews(videoId);
    
    if (newViews !== null) {
      res.json({ 
        success: true, 
        views: newViews,
        videoId: videoId 
      });
    } else {
      res.status(404).json({ error: 'Video not found' });
    }
  } catch (error) {
    console.error('Increment video views error:', error);
    res.status(500).json({ error: error.message });
  }
}

export async function generateVideosCSV(req, res) {
  try {
    // Get all active videos
    const result = await videoService.getAllVideos({ status: 'active' });
    
    // Extract videos array from result (getAllVideos returns { videos: [], pagination: {} })
    const videos = result.videos || [];
    
    if (videos.length === 0) {
      return res.status(400).json({ error: 'No videos found to generate CSV' });
    }

    // CSV headers: ID, Title, Link/Path, Grade, Lesson, Module, Activity
    const headers = ['ID', 'Title', 'Link/Path', 'Grade', 'Lesson', 'Module', 'Activity'];
    
    // Build rows from videos
    const rows = videos.map(video => {
      // ID - use video_id
      const videoId = video.video_id || '';
      
      // Title
      const title = video.title || video.video_id || 'Untitled';
      
      // Link/Path - use file_path (should be upload/filename.mp4)
      let linkPath = video.file_path || '';
      // If file_path is relative, keep it as-is; if absolute, extract relative part
      if (linkPath && !linkPath.startsWith('upload/') && !linkPath.startsWith('my-storage/')) {
        // Try to extract from absolute path
        if (linkPath.includes('upload/')) {
          linkPath = linkPath.substring(linkPath.indexOf('upload/'));
        } else if (linkPath.includes('my-storage/')) {
          linkPath = linkPath.substring(linkPath.indexOf('my-storage/'));
        }
      }
      // If still no path, use streaming URL as fallback
      if (!linkPath && video.streaming_url) {
        linkPath = video.streaming_url;
      }
      
      // Grade, Lesson, Module, Activity - get from video record
      const grade = video.grade || '';
      const lesson = video.lesson || '';
      const module = video.module || '';
      const activity = video.activity || '';
      
      return [
        videoId,
        title,
        linkPath,
        grade,
        lesson,
        module,
        activity
      ];
    });

    // Escape CSV values
    const escapeCSV = (value) => {
      const cellStr = String(value || '').trim();
      if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n') || cellStr.includes('\r')) {
        return `"${cellStr.replace(/"/g, '""')}"`;
      }
      return cellStr;
    };

    // Build CSV content
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\r\n');

    // Set response headers for CSV download
    res.setHeader('Content-Type', 'text/csv;charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="videos_export_${Date.now()}.csv"`);
    
    // Send CSV with BOM for Excel compatibility
    res.send('\ufeff' + csvContent);
  } catch (error) {
    console.error('Generate videos CSV error:', error);
    res.status(500).json({ 
      error: 'Failed to generate CSV', 
      message: error.message 
    });
  }
}

export async function generateFilteredVideosCSV(req, res) {
  try {
    const { subject, grade, unit, lesson, module, version } = req.query;
    
    console.log('[Generate Filtered CSV] Starting CSV generation with filters:', { subject, grade, unit, lesson, module, version });
    
    // Build filters object
    // Note: getAllVideos has a max limit of 200 per page, so we'll fetch all pages
    const filters = { 
      status: 'active',
      limit: 200, // Max allowed per page (getAllVideos caps at 200)
      page: 1
    };
    if (subject && subject !== 'all') {
      filters.subject = subject;
    }
    if (grade && grade !== 'all') {
      filters.grade = grade;
    }
    if (unit && unit !== 'all') {
      filters.unit = unit;
    }
    if (lesson && lesson !== 'all') {
      filters.lesson = lesson;
    }
    if (module && module !== 'all') {
      filters.module = module;
    }
    if (version && version !== 'all') {
      filters.version = version;
    }
    
    // Get filtered videos - handle paginated response format
    // Use high limit to fetch all videos at once (or as many as possible)
    let allVideosResponse;
    try {
      allVideosResponse = await videoService.getAllVideos(filters);
      console.log('[Generate Filtered CSV] Initial response received:', {
        isArray: Array.isArray(allVideosResponse),
        hasVideos: !!(allVideosResponse && allVideosResponse.videos),
        videoCount: Array.isArray(allVideosResponse) ? allVideosResponse.length : (allVideosResponse?.videos?.length || 0),
        totalPages: allVideosResponse?.pagination?.totalPages || 1
      });
    } catch (fetchError) {
      console.error('[Generate Filtered CSV] Error fetching videos:', fetchError);
      return res.status(500).json({ 
        error: 'Failed to fetch videos', 
        message: fetchError.message 
      });
    }
    
    // Extract videos array from response (handle both old array format and new paginated format)
    let allVideos = [];
    if (Array.isArray(allVideosResponse)) {
      // Old format - direct array
      allVideos = allVideosResponse;
    } else if (allVideosResponse && allVideosResponse.videos) {
      // New format - object with videos and pagination
      allVideos = Array.isArray(allVideosResponse.videos) ? allVideosResponse.videos : [];
      
      // Always fetch all pages to get complete data (since limit is capped at 200 per page)
      const totalPages = allVideosResponse.pagination?.totalPages || 1;
      const totalVideos = allVideosResponse.pagination?.total || allVideos.length;
      
      console.log(`[Generate Filtered CSV] Total videos: ${totalVideos}, Total pages: ${totalPages}, Current videos: ${allVideos.length}`);
      
      // Fetch all remaining pages - use both pagination info and fallback method
      if (totalPages > 1) {
        console.log(`[Generate Filtered CSV] Fetching all ${totalPages} pages of videos (limit: 200 per page)...`);
        
        for (let page = 2; page <= totalPages; page++) {
          try {
            const pageFilters = { ...filters, page, limit: 200 }; // Use 200 (max allowed)
            const pageResponse = await videoService.getAllVideos(pageFilters);
            
            let pageVideos = [];
            if (pageResponse && pageResponse.videos && Array.isArray(pageResponse.videos)) {
              pageVideos = pageResponse.videos;
            } else if (Array.isArray(pageResponse)) {
              pageVideos = pageResponse;
            }
            
            if (pageVideos.length > 0) {
              allVideos.push(...pageVideos);
              console.log(`[Generate Filtered CSV] ✓ Fetched page ${page}/${totalPages}: ${pageVideos.length} videos (total so far: ${allVideos.length})`);
            } else {
              console.log(`[Generate Filtered CSV] Page ${page} returned no videos, stopping pagination`);
              break; // Stop if we get an empty page
            }
          } catch (pageError) {
            console.error(`[Generate Filtered CSV] Error fetching page ${page}:`, pageError.message);
            // Continue with other pages even if one fails
          }
        }
      } else {
        // Fallback: if pagination info says 1 page but we got less than expected, keep fetching
        if (totalVideos > allVideos.length && allVideos.length === 200) {
          console.log(`[Generate Filtered CSV] Got 200 videos but total is ${totalVideos}, fetching additional pages...`);
          let page = 2;
          let hasMore = true;
          
          while (hasMore && page <= 20) { // Safety limit of 20 pages
            try {
              const pageFilters = { ...filters, page, limit: 200 };
              const pageResponse = await videoService.getAllVideos(pageFilters);
              
              let pageVideos = [];
              if (pageResponse && pageResponse.videos && Array.isArray(pageResponse.videos)) {
                pageVideos = pageResponse.videos;
              } else if (Array.isArray(pageResponse)) {
                pageVideos = pageResponse;
              }
              
              if (pageVideos.length > 0) {
                allVideos.push(...pageVideos);
                console.log(`[Generate Filtered CSV] ✓ Fetched additional page ${page}: ${pageVideos.length} videos (total so far: ${allVideos.length})`);
                page++;
              } else {
                hasMore = false;
                console.log(`[Generate Filtered CSV] No more videos found, stopping at page ${page}`);
              }
            } catch (pageError) {
              console.error(`[Generate Filtered CSV] Error fetching page ${page}:`, pageError.message);
              hasMore = false;
            }
          }
        }
      }
    } else {
      console.warn('[Generate Filtered CSV] Unexpected response format from getAllVideos:', typeof allVideosResponse);
    }
    
    console.log(`[Generate Filtered CSV] ===== FETCH SUMMARY =====`);
    console.log(`[Generate Filtered CSV] Total videos fetched: ${allVideos.length}`);
    
    // Verify we got all videos (compare with expected total)
    if (allVideosResponse?.pagination?.total) {
      const expectedTotal = allVideosResponse.pagination.total;
      console.log(`[Generate Filtered CSV] Expected total: ${expectedTotal}`);
      if (allVideos.length < expectedTotal) {
        console.warn(`[Generate Filtered CSV] ⚠️ WARNING: Fetched ${allVideos.length} videos but expected ${expectedTotal}. Some videos may be missing in CSV.`);
      } else {
        console.log(`[Generate Filtered CSV] ✓ Successfully fetched all ${allVideos.length} videos (matches expected ${expectedTotal})`);
      }
    } else {
      console.log(`[Generate Filtered CSV] No pagination info available, using ${allVideos.length} fetched videos`);
    }
    console.log(`[Generate Filtered CSV] ==========================`);
    
    // Ensure allVideos is an array before filtering
    if (!Array.isArray(allVideos)) {
      console.error('[Generate Filtered CSV] allVideos is not an array:', typeof allVideos);
      allVideos = [];
    }
    
    // Filter to only videos with redirect_slug (QR codes) - same as QR Code Storage
    const videos = allVideos.filter(video => {
      if (!video || typeof video !== 'object') {
        return false;
      }
      return video.redirect_slug && String(video.redirect_slug).trim() !== '';
    });
    
    console.log(`[Generate Filtered CSV] ===== FILTERING SUMMARY =====`);
    console.log(`[Generate Filtered CSV] Total videos fetched: ${allVideos.length}`);
    console.log(`[Generate Filtered CSV] Videos with redirect_slug: ${videos.length}`);
    console.log(`[Generate Filtered CSV] Videos without redirect_slug (excluded): ${allVideos.length - videos.length}`);
    console.log(`[Generate Filtered CSV] =============================`);
    
    if (videos.length === 0) {
      return res.status(400).json({ error: 'No videos found matching the selected filters' });
    }

    // CSV headers as requested: Subject, Grade, Unit, Lesson, QR code name, Playlist ID, PlaylistTitle, Description, Short URL
    const headers = ['Subject', 'Grade', 'Unit', 'Lesson', 'QR code name', 'Video ID', 'VideoTitle', 'Description', 'Short URL'];
    
    // Build base URL - use frontend URL (same as video page)
    const frontendUrl = config.urls?.frontend || config.urls?.base || 'http://localhost:5173';
    
    // Build rows from videos with error handling
    const rows = videos.map((video, index) => {
      try {
        if (!video || typeof video !== 'object') {
          console.warn(`[Generate Filtered CSV] Invalid video at index ${index}`);
          return null;
        }
        
        // Subject
        const subjectValue = video.subject || video.course || '';
        
        // Grade
        const gradeValue = video.grade != null ? String(video.grade) : '';
        
        // Unit
        const unitValue = video.unit != null ? String(video.unit) : '';
        
        // Lesson
        const lessonValue = video.lesson != null ? String(video.lesson) : '';
        
        // QR code name - generate filename in format G{grade}_U{unit}_L{lesson}_M{module}_V{version}.svg (same as download)
        // This matches the exact filename format used when downloading QR codes from QR Code Storage
        // Format: G1_U1_L1_M1_V1.1.svg - this is the QR code download filename with .svg extension
        // Order: Grade, Unit, Lesson, Module, Version (G_U_L_M_V)
        // Version is critical to differentiate between videos with same metadata but different versions
        const parts = [];
        if (video.grade !== null && video.grade !== undefined && String(video.grade).trim() !== '') {
          parts.push(`G${String(video.grade).trim()}`);
        }
        // Use unit field for U part (not course/subject)
        if (video.unit !== null && video.unit !== undefined && String(video.unit).trim() !== '') {
          parts.push(`U${String(video.unit).trim()}`);
        }
        if (video.lesson !== null && video.lesson !== undefined && String(video.lesson).trim() !== '') {
          parts.push(`L${String(video.lesson).trim()}`);
        }
        if (video.module !== null && video.module !== undefined && String(video.module).trim() !== '') {
          parts.push(`M${String(video.module).trim()}`);
        }
        if (video.version !== null && video.version !== undefined && String(video.version).trim() !== '') {
          parts.push(`V${String(video.version).trim()}`); // Add version to differentiate between versions
        }
        
        // Always use the format with .svg extension (matches QR code download filename exactly)
        // This is the actual QR code download filename format, NOT video_id
        // Format: G{grade}_U{unit}_L{lesson}_M{module}_V{version}.svg (Order: G_U_L_M_V)
        const qrCodeName = parts.length > 0 
          ? parts.join('_') + '.svg'
          : ''; // Empty if no parts (don't use video_id - user wants QR code download name format only)
        
        // Playlist ID - use redirect_slug or video_id
        const playlistId = video.redirect_slug || video.video_id || '';
        
        // PlaylistTitle - use title
        const playlistTitle = video.title || video.video_id || 'Untitled';
        
        // Description
        const description = video.description || '';
        
        // Short URL - use the format from video edit page: {frontendUrl}/{redirect_slug}
        // This matches the "SHORT URL" shown in the video edit page (e.g., http://localhost:5173/gpg2i6w6fj)
        const shortUrl = video.redirect_slug 
          ? `${frontendUrl}/${String(video.redirect_slug).trim()}`
          : (video.video_id ? `${frontendUrl}/stream/${video.video_id}` : '');
        
        return [
          subjectValue,
          gradeValue,
          unitValue,
          lessonValue,
          qrCodeName,
          playlistId,
          playlistTitle,
          description,
          shortUrl
        ];
      } catch (rowError) {
        console.error(`[Generate Filtered CSV] Error processing video at index ${index}:`, rowError.message);
        // Return a row with error indicator instead of crashing
        return [
          'ERROR',
          video?.video_id || 'UNKNOWN',
          'Error processing video',
          '',
          '',
          '',
          '',
          '',
          ''
        ];
      }
    }).filter(row => row !== null); // Remove any null rows

    // Validate rows before generating CSV
    if (!rows || rows.length === 0) {
      console.error('[Generate Filtered CSV] No rows to generate CSV');
      return res.status(400).json({ error: 'No data available to generate CSV' });
    }
    
    // Escape CSV values
    const escapeCSV = (value) => {
      try {
        const cellStr = String(value != null ? value : '').trim();
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n') || cellStr.includes('\r')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      } catch (escapeError) {
        console.warn('[Generate Filtered CSV] Error escaping CSV value:', escapeError);
        return '';
      }
    };

    // Build CSV content with error handling
    let csvContent;
    try {
      const headerRow = headers.map(escapeCSV).join(',');
      const dataRows = rows.map(row => {
        if (!Array.isArray(row) || row.length !== headers.length) {
          console.warn('[Generate Filtered CSV] Invalid row format:', row);
          // Return a row with empty values matching header count
          return headers.map(() => '').map(escapeCSV).join(',');
        }
        return row.map(escapeCSV).join(',');
      });
      
      csvContent = [headerRow, ...dataRows].join('\r\n');
    } catch (csvError) {
      console.error('[Generate Filtered CSV] Error building CSV content:', csvError);
      return res.status(500).json({ 
        error: 'Failed to generate CSV content', 
        message: csvError.message 
      });
    }

    // Generate filename with filters
    let filename = 'videos_export';
    if (subject && subject !== 'all') filename += `_subject_${String(subject).replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (grade && grade !== 'all') filename += `_grade_${String(grade).replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (unit && unit !== 'all') filename += `_unit_${String(unit).replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (lesson && lesson !== 'all') filename += `_lesson_${String(lesson).replace(/[^a-zA-Z0-9]/g, '_')}`;
    filename += `_${Date.now()}.csv`;

    try {
      // Set response headers for CSV download
      res.setHeader('Content-Type', 'text/csv;charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Send CSV with BOM for Excel compatibility
      res.send('\ufeff' + csvContent);
      
      console.log(`[Generate Filtered CSV] ===== CSV GENERATION COMPLETE =====`);
      console.log(`[Generate Filtered CSV] ✓ Successfully generated CSV`);
      console.log(`[Generate Filtered CSV] Total rows in CSV: ${rows.length}`);
      console.log(`[Generate Filtered CSV] Headers: ${headers.length}`);
      console.log(`[Generate Filtered CSV] Filename: ${filename}`);
      console.log(`[Generate Filtered CSV] ====================================`);
    } catch (sendError) {
      console.error('[Generate Filtered CSV] Error sending CSV response:', sendError);
      // If headers already sent, we can't send error response
      if (!res.headersSent) {
        return res.status(500).json({ 
          error: 'Failed to send CSV file', 
          message: sendError.message 
        });
      }
    }
  } catch (error) {
    console.error('[Generate Filtered CSV] Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate CSV', 
      message: error.message 
    });
  }
}

/**
 * Generate HTML embed files for filtered videos
 * Returns a ZIP file containing HTML files for each video
 */
export async function generateHTMLEmbeds(req, res) {
  try {
    const { subject, grade, unit, lesson, module, version, search, video_id } = req.query;
    
    console.log('[Generate HTML Embeds] Starting HTML embed generation with filters:', { subject, grade, unit, lesson, module, version, search, video_id });
    
    // If video_id is provided, fetch only that specific video
    if (video_id) {
      try {
        const video = await videoService.getVideoByVideoId(video_id, true);
        if (!video || !video.redirect_slug || String(video.redirect_slug).trim() === '') {
          return res.status(404).json({ error: 'Video not found or does not have a redirect slug' });
        }
        
        // Build frontend URL
        let frontendUrl = config.urls?.frontend || 'http://localhost:5173';
        if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim()) {
          frontendUrl = process.env.FRONTEND_URL.trim();
        } else if (req) {
          const origin = req.get('Origin') || req.get('Referer');
          if (origin) {
            try {
              const originUrl = new URL(origin);
              frontendUrl = `${originUrl.protocol}//${originUrl.host}`;
            } catch (e) {
              const protocol = req.get('X-Forwarded-Proto') || req.protocol || 'https';
              const host = req.get('X-Forwarded-Host') || req.get('host') || '';
              if (host && !host.includes('localhost')) {
                frontendUrl = `${protocol}://${host}`;
              }
            }
          }
        }
        
        const videoTitle = video.title || video.video_id || 'Untitled Video';
        const videoUrl = video.redirect_slug 
          ? `${frontendUrl}/${video.redirect_slug}`
          : `${frontendUrl}/stream/${video.video_id}`;
        
        const filename = videoTitle
          .replace(/\s+/g, '-')
          .replace(/[<>:"/\\|?*]/g, '')
          + '.html';
        
        const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${videoTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <style>
        html, body {
            margin: 0;
            padding: 0;
            height: 100%;
            background-color: #000;
            overflow: hidden;
            font-family: Arial, sans-serif;
        }

        .video-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        }

        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background-color: #000;
        }
    </style>
</head>
<body>

    <div class="video-container">
        <iframe 
            src="${videoUrl}"
            allow="autoplay; fullscreen; encrypted-media"
            allowfullscreen
            loading="eager">
        </iframe>
    </div>

</body>
</html>`;
        
        return res.json({
          success: true,
          files: [{
            filename,
            content: htmlContent,
            title: videoTitle
          }],
          count: 1,
          message: 'Generated HTML embed file'
        });
      } catch (error) {
        console.error('[Generate HTML Embeds] Error fetching single video:', error);
        return res.status(500).json({ 
          error: 'Failed to fetch video', 
          message: error.message 
        });
      }
    }
    
    // Build filters object - same as CSV export
    const filters = { 
      status: 'active',
      limit: 200,
      page: 1
    };
    if (subject && subject !== 'all') {
      filters.subject = subject;
    }
    if (grade && grade !== 'all') {
      filters.grade = grade;
    }
    if (unit && unit !== 'all') {
      filters.unit = unit;
    }
    if (lesson && lesson !== 'all') {
      filters.lesson = lesson;
    }
    if (module && module !== 'all') {
      filters.module = module;
    }
    if (version && version !== 'all') {
      filters.version = version;
    }
    if (search && search.trim() !== '') {
      filters.search = search.trim();
    }
    
    // Get filtered videos - handle paginated response format
    let allVideosResponse;
    try {
      allVideosResponse = await videoService.getAllVideos(filters);
      console.log('[Generate HTML Embeds] Initial response received:', {
        isArray: Array.isArray(allVideosResponse),
        hasVideos: !!(allVideosResponse && allVideosResponse.videos),
        videoCount: Array.isArray(allVideosResponse) ? allVideosResponse.length : (allVideosResponse?.videos?.length || 0),
        totalPages: allVideosResponse?.pagination?.totalPages || 1
      });
    } catch (fetchError) {
      console.error('[Generate HTML Embeds] Error fetching videos:', fetchError);
      return res.status(500).json({ 
        error: 'Failed to fetch videos', 
        message: fetchError.message 
      });
    }
    
    // Extract videos array from response
    let allVideos = [];
    if (Array.isArray(allVideosResponse)) {
      allVideos = allVideosResponse;
    } else if (allVideosResponse && allVideosResponse.videos) {
      allVideos = Array.isArray(allVideosResponse.videos) ? allVideosResponse.videos : [];
      
      // Fetch all pages
      const totalPages = allVideosResponse.pagination?.totalPages || 1;
      if (totalPages > 1) {
        for (let page = 2; page <= totalPages; page++) {
          try {
            const pageFilters = { ...filters, page, limit: 200 };
            const pageResponse = await videoService.getAllVideos(pageFilters);
            
            let pageVideos = [];
            if (pageResponse && pageResponse.videos && Array.isArray(pageResponse.videos)) {
              pageVideos = pageResponse.videos;
            } else if (Array.isArray(pageResponse)) {
              pageVideos = pageResponse;
            }
            
            if (pageVideos.length > 0) {
              allVideos.push(...pageVideos);
            }
          } catch (pageError) {
            console.error(`[Generate HTML Embeds] Error fetching page ${page}:`, pageError.message);
          }
        }
      }
    }
    
    // Filter to only videos with redirect_slug
    const videos = allVideos.filter(video => {
      if (!video || typeof video !== 'object') {
        return false;
      }
      return video.redirect_slug && String(video.redirect_slug).trim() !== '';
    });
    
    if (videos.length === 0) {
      return res.status(400).json({ error: 'No videos found matching the selected filters' });
    }
    
    console.log(`[Generate HTML Embeds] Generating HTML files for ${videos.length} videos`);
    
    // Build frontend URL - prioritize environment variable for production
    // Priority: 1) FRONTEND_URL env var, 2) Detect from request origin, 3) Config default
    let frontendUrl = config.urls?.frontend || 'http://localhost:5173';
    
    // Check environment variable first (should be set in production)
    if (process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim()) {
      frontendUrl = process.env.FRONTEND_URL.trim();
      console.log(`[Generate HTML Embeds] Using FRONTEND_URL from environment: ${frontendUrl}`);
    } else if (req) {
      // Try to detect from request (for hosted environments)
      // Check Origin or Referer header first
      const origin = req.get('Origin') || req.get('Referer');
      if (origin) {
        try {
          const originUrl = new URL(origin);
          // Use the origin's protocol and host for frontend URL
          frontendUrl = `${originUrl.protocol}//${originUrl.host}`;
          console.log(`[Generate HTML Embeds] Detected frontend URL from request Origin/Referer: ${frontendUrl}`);
        } catch (e) {
          // If URL parsing fails, try to construct from headers
          const protocol = req.get('X-Forwarded-Proto') || req.protocol || 'https';
          const host = req.get('X-Forwarded-Host') || req.get('host') || '';
          if (host && !host.includes('localhost')) {
            frontendUrl = `${protocol}://${host}`;
            console.log(`[Generate HTML Embeds] Detected frontend URL from request headers: ${frontendUrl}`);
          }
        }
      }
    }
    
    // Final validation: ensure we're not using localhost in production
    if (frontendUrl.includes('localhost') && process.env.NODE_ENV === 'production') {
      console.warn(`[Generate HTML Embeds] WARNING: Frontend URL is localhost in production!`);
      console.warn(`[Generate HTML Embeds] Please set FRONTEND_URL environment variable.`);
    }
    
    console.log(`[Generate HTML Embeds] Final frontend URL for HTML files: ${frontendUrl}`);
    
    // Generate HTML content for each video
    const htmlFiles = videos.map(video => {
      const videoTitle = video.title || video.video_id || 'Untitled Video';
      const videoUrl = video.redirect_slug 
        ? `${frontendUrl}/${video.redirect_slug}`
        : `${frontendUrl}/stream/${video.video_id}`;
      
      // Generate filename: use title as-is, replace spaces with hyphens
      const filename = videoTitle
        .replace(/\s+/g, '-')
        .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
        + '.html';
      
      // Generate HTML content
      const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${videoTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <style>
        html, body {
            margin: 0;
            padding: 0;
            height: 100%;
            background-color: #000;
            overflow: hidden;
            font-family: Arial, sans-serif;
        }

        .video-container {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        }

        iframe {
            width: 100%;
            height: 100%;
            border: none;
            background-color: #000;
        }
    </style>
</head>
<body>

    <div class="video-container">
        <iframe 
            src="${videoUrl}"
            allow="autoplay; fullscreen; encrypted-media"
            allowfullscreen
            loading="eager">
        </iframe>
    </div>

</body>
</html>`;
      
      return {
        filename,
        content: htmlContent,
        title: videoTitle
      };
    });
    
    // Return HTML files as JSON - frontend will create ZIP
    // This avoids needing ZIP library on backend
    console.log(`[Generate HTML Embeds] ✓ Generated ${htmlFiles.length} HTML files`);
    
    res.json({
      success: true,
      files: htmlFiles,
      count: htmlFiles.length,
      message: `Generated ${htmlFiles.length} HTML embed files`
    });
    
  } catch (error) {
    console.error('[Generate HTML Embeds] Error:', error);
    res.status(500).json({ 
      error: 'Failed to generate HTML embed files', 
      message: error.message 
    });
  }
}
