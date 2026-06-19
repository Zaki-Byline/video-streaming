import express from 'express';
import * as videoController from '../controllers/videoController.js';
import * as streamController from '../controllers/streamController.js';
import * as bulkUploadController from '../controllers/bulkUploadController.js';
import * as thumbnailController from '../controllers/thumbnailController.js';
import * as videoDescriptionController from '../controllers/videoDescriptionController.js';
import * as redirectService from '../services/redirectService.js';
import * as videoService from '../services/videoService.js';
import config from '../config/config.js';
import { authenticateToken } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDirectoryExists } from '../utils/fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure temp-uploads directory exists
const tempUploadsDir = path.join(__dirname, '../../temp-uploads');
ensureDirectoryExists(tempUploadsDir).catch(() => {});

const router = express.Router();

// Log all requests to this router
router.use((req, res, next) => {
  console.log('[VideoRouter] Request received:', {
    method: req.method,
    path: req.path,
    url: req.url,
    originalUrl: req.originalUrl,
    params: req.params
  });
  next();
});

// Public routes
router.get('/', videoController.getAllVideos);
router.get('/filters', videoController.getFilterValues);

// Backfill durations route (must be before ALL parameterized routes like /:id or /:videoId)
router.post('/backfill-durations', authenticateToken, videoController.backfillVideoDurations);

// Get video by database ID (protected route) - MUST be before /:videoId routes
router.get('/by-id/:id', (req, res, next) => {
  console.log('[VideoRouter] /by-id/:id route matched!', {
    id: req.params.id,
    method: req.method,
    path: req.path,
    url: req.url,
    hasAuth: !!req.headers.authorization
  });
  next();
}, authenticateToken, videoController.getVideoById);

// Increment video views (public endpoint - no auth required)
router.post('/:videoId/increment-views', videoController.incrementVideoViews);

// Public API to get redirect info by slug (for frontend short URL handling)
router.get('/redirect-info/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    // First, try to get video by redirect_slug (most common case for direct streaming)
    let video = await videoService.getVideoByRedirectSlug(slug, true);
    if (video?.status === 'deleted') {
      video = null;
    }
    
    // If not found, try to get redirect from redirects table
    let redirect = null;
    if (!video) {
      redirect = await redirectService.getRedirectBySlug(slug);
      
      // If redirect found, try to extract videoId from target URL
      if (redirect && redirect.target_url) {
        try {
          const url = new URL(redirect.target_url);
          const pathParts = url.pathname.split('/');
          const videoId = pathParts[pathParts.length - 1];
          video = await videoService.getVideoByVideoId(videoId, true);
          if (video?.status === 'deleted') {
            video = null;
          }
        } catch (urlError) {
          console.log('Could not parse target URL:', urlError);
        }
      }
    }
    
    // If video found, return video data directly (for direct streaming)
    if (video) {
      return res.json({
        slug: slug,
        video: video,
        target_url: redirect?.target_url || `${config.urls.frontend}/stream/${video.video_id}`,
        created_at: video.created_at,
        updated_at: video.updated_at
      });
    }
    
    // If redirect found but no video, return redirect info
    if (redirect) {
      return res.json(redirect);
    }
    
    return res.status(404).json({ error: 'Redirect not found' });
  } catch (error) {
    console.error('Get redirect info error:', error);
    res.status(500).json({ error: 'Failed to fetch redirect info' });
  }
});

// Protected admin routes - MUST be before /:videoId route to avoid route conflicts
// IMPORTANT: Specific routes like /misc-videos must come BEFORE parameterized routes
router.get('/misc-videos', (req, res, next) => {
  console.log('[Route] /misc-videos route hit');
  console.log('[Route] Auth header:', req.headers.authorization ? 'Present' : 'Missing');
  next();
}, authenticateToken, bulkUploadController.getMiscVideos);
router.get('/qr-codes', (req, res, next) => {
  console.log('[Route] /qr-codes route hit');
  console.log('[Route] Auth header:', req.headers.authorization ? 'Present' : 'Missing');
  next();
}, authenticateToken, videoController.getAllQRCodes);
router.get('/thumbnails', authenticateToken, thumbnailController.getThumbnails);
router.get('/thumbnails/diagnostic', authenticateToken, thumbnailController.getThumbnailDiagnostic);

// Test endpoint to verify backfill route exists (for debugging)
router.get('/backfill-durations-test', (req, res) => {
  res.json({ 
    message: 'Backfill durations route is registered',
    method: 'POST /api/videos/backfill-durations',
    requiresAuth: true
  });
});
router.get('/export-csv', authenticateToken, videoController.generateVideosCSV);
router.get('/export-filtered-csv', (req, res, next) => {
  console.log('[Route] /export-filtered-csv route hit');
  console.log('[Route] Query params:', req.query);
  console.log('[Route] Auth header:', req.headers.authorization ? 'Present' : 'Missing');
  next();
}, authenticateToken, videoController.generateFilteredVideosCSV);

router.get('/export-html-embeds', authenticateToken, videoController.generateHTMLEmbeds);

// Deleted videos route - MUST be before any /:id or /:videoId routes
router.get('/deleted', (req, res, next) => {
  console.log('[Route] ===== /deleted route hit =====');
  console.log('[Route] Method:', req.method);
  console.log('[Route] Path:', req.path);
  console.log('[Route] URL:', req.url);
  console.log('[Route] Original URL:', req.originalUrl);
  console.log('[Route] Auth header:', req.headers.authorization ? 'Present' : 'Missing');
  if (req.headers.authorization) {
    console.log('[Route] Auth token present');
  }
  next();
}, authenticateToken, videoController.getDeletedVideos);

// Permanently delete multiple videos (bulk delete) - MUST be before dynamic routes
router.post('/permanent-delete', authenticateToken, videoController.permanentDeleteVideos);

// QR code download route - MUST be before other /:videoId/* routes
router.get('/:videoId/qr-download', (req, res, next) => {
  console.log('[Route] /qr-download route hit for videoId:', req.params.videoId);
  next();
}, authenticateToken, videoController.downloadQRCode);

// Video upload route - store directly in backend/upload folder (no temp file)
const uploadDir = path.join(__dirname, '../upload');
ensureDirectoryExists(uploadDir).catch(() => {});

router.post('/upload', authenticateToken, multer({ 
  dest: uploadDir, // Save directly to final location (no temp file)
  limits: { 
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
    fieldSize: 10 * 1024 * 1024 // 10MB for form fields
  }
}).fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), videoController.uploadVideo);
router.post('/bulk-upload', authenticateToken, multer({ dest: 'uploads/temp' }).single('csv'), bulkUploadController.bulkUploadFromCSV);
router.get('/upload-history', authenticateToken, bulkUploadController.getUploadHistory);
router.delete('/upload-history/:id', authenticateToken, bulkUploadController.deleteUploadHistory);
router.delete('/upload-history', authenticateToken, bulkUploadController.bulkDeleteUploadHistory);

// Video file replacement (with file upload) - MUST be before other /:id or /:videoId routes
router.post('/:id/generate-description', authenticateToken, videoDescriptionController.generateAiDescription);
router.post('/:id/replace-video', authenticateToken, multer({ 
  dest: tempUploadsDir,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } // 5GB limit
}).single('video'), videoController.replaceVideoFile);

// Get video replacement diagnostic (check if video can be replaced)
// MUST be before other /:id or /:videoId routes to avoid route conflicts
router.get('/:id/replace-diagnostic', authenticateToken, async (req, res, next) => {
  try {
    console.log('[Route] ===== REPLACE DIAGNOSTIC ROUTE HIT =====');
    console.log('[Route] ID:', req.params.id);
    console.log('[Route] Method:', req.method);
    console.log('[Route] Path:', req.path);
    console.log('[Route] URL:', req.url);
    
    if (!videoController.getVideoReplacementDiagnostic) {
      console.error('[Route] getVideoReplacementDiagnostic function not found in videoController');
      return res.status(500).json({ error: 'Diagnostic function not available' });
    }
    
    await videoController.getVideoReplacementDiagnostic(req, res, next);
  } catch (error) {
    console.error('[Route] Error in replace diagnostic route:', error);
    console.error('[Route] Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Diagnostic failed', message: error.message });
    }
  }
});

// Test endpoint for replace diagnostic (no auth required for testing)
router.get('/test-replace-diagnostic/:id', (req, res) => {
  res.json({ 
    message: 'Replace diagnostic route is accessible', 
    id: req.params.id,
    timestamp: new Date().toISOString(),
    note: 'This is a test endpoint. The actual route requires authentication.'
  });
});

// Test endpoint to verify routing
router.get('/test-stream', (req, res) => {
  res.json({ message: 'Streaming route is accessible', timestamp: new Date().toISOString() });
});

// Test endpoint for QR codes route
router.get('/test-qr-codes', (req, res) => {
  res.json({ 
    message: 'QR codes route is accessible', 
    timestamp: new Date().toISOString(),
    route: '/api/videos/qr-codes',
    note: 'This is a test endpoint. The actual route is /qr-codes'
  });
});

// Test endpoint for deleted videos route
router.get('/test-deleted', (req, res) => {
  res.json({ 
    message: 'Deleted videos route is accessible', 
    timestamp: new Date().toISOString(),
    route: '/api/videos/deleted',
    note: 'This is a test endpoint. The actual route is /deleted'
  });
});

// Test endpoint for filtered CSV export route
router.get('/test-export-filtered-csv', (req, res) => {
  res.json({ 
    message: 'Filtered CSV export route is accessible', 
    timestamp: new Date().toISOString(),
    route: '/api/videos/export-filtered-csv',
    query: req.query,
    note: 'This is a test endpoint. The actual route requires authentication.'
  });
});

// Simple streaming test endpoint
router.get('/test/:videoId/stream', async (req, res) => {
  console.log('[Test Route] Streaming test endpoint hit:', req.params.videoId);
  res.json({ 
    message: 'Streaming route is accessible',
    videoId: req.params.videoId,
    timestamp: new Date().toISOString(),
    path: req.path,
    url: req.url
  });
});

// Debug endpoint to list all routes
router.get('/debug/routes', (req, res) => {
  res.json({
    message: 'Video routes debug',
    routes: [
      'GET /api/videos/',
      'GET /api/videos/filters',
      'GET /api/videos/deleted (protected)',
      'GET /api/videos/misc-videos (protected)',
      'GET /api/videos/qr-codes (protected)',
      'GET /api/videos/export-csv (protected)',
      'GET /api/videos/export-filtered-csv (protected)',
      'GET /api/videos/test-stream',
      'GET /api/videos/:videoId/stream',
      'GET /api/videos/:videoId',
      'POST /api/videos/upload (protected)',
      'POST /api/videos/bulk-upload (protected)',
      'PUT /api/videos/:id (protected)',
      'DELETE /api/videos/:id (protected)',
      'POST /api/videos/:id/restore (protected)',
      'GET /api/videos/:videoId/versions (protected)',
      'GET /api/videos/:videoId/qr-download (protected)'
    ]
  });
});

// Simple test endpoint that always works (to verify routing)
router.get('/:videoId/stream-test', (req, res) => {
  console.log('[Route] Stream test endpoint hit:', req.params.videoId);
  res.json({
    success: true,
    message: 'Streaming route is accessible',
    videoId: req.params.videoId,
    timestamp: new Date().toISOString()
  });
});

// Streaming route - MUST be before /:videoId to avoid route conflict
router.options('/:videoId/stream', (req, res) => {
  console.log('[Route] OPTIONS request for stream:', req.params.videoId);
  console.log('[Route] OPTIONS headers:', {
    origin: req.headers.origin,
    'access-control-request-method': req.headers['access-control-request-method'],
    'access-control-request-headers': req.headers['access-control-request-headers']
  });
  
  // Set CORS headers for preflight
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// HEAD handler for streaming endpoint (for CORS preflight and metadata)
router.head('/:videoId/stream', async (req, res, next) => {
  console.log('[Route] HEAD request for stream:', req.params.videoId);
  
  // Set CORS headers
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  try {
    await streamController.streamVideo(req, res, next);
  } catch (error) {
    console.error('[Route] Error in HEAD stream controller:', error);
    if (!res.headersSent) {
      res.status(500).end();
    }
  }
});

router.get('/:videoId/stream', async (req, res, next) => {
  console.log('[Route] ===== STREAMING REQUEST RECEIVED =====');
  console.log('[Route] GET request for stream:', {
    videoId: req.params.videoId,
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    path: req.path,
    baseUrl: req.baseUrl
  });
  console.log('[Route] Headers:', {
    range: req.headers.range,
    origin: req.headers.origin,
    'user-agent': req.headers['user-agent']
  });
  
  try {
    await streamController.streamVideo(req, res, next);
  } catch (error) {
    console.error('[Route] Error in stream controller:', error);
    console.error('[Route] Error stack:', error.stack);
    if (!res.headersSent) {
      // Set CORS headers even for errors
      const origin = req.headers.origin;
      if (origin) {
        res.header('Access-Control-Allow-Origin', origin);
      } else {
        res.header('Access-Control-Allow-Origin', '*');
      }
      res.status(500).json({ 
        error: 'Streaming error', 
        message: error.message,
        videoId: req.params.videoId
      });
    }
  }
});

router.get('/diagnostic/:id', authenticateToken, videoController.getVideoMetadataDiagnostic);
router.post('/diagnostic/:id/quick-fix', authenticateToken, videoController.quickFixVideoMetadata);
router.put('/:id', authenticateToken, videoController.updateVideo);
router.delete('/:id', authenticateToken, videoController.deleteVideo);

// Restore deleted video
router.post('/:id/restore', authenticateToken, videoController.restoreVideo);

// Permanently delete video (hard delete)
router.delete('/:id/permanent', authenticateToken, videoController.permanentDeleteVideo);

router.get('/:videoId/versions', authenticateToken, videoController.getVideoVersions);

// Get video diagnostic information (must be before /:videoId route)
router.get('/:videoId/diagnostic', videoController.getVideoDiagnostic);

// Public routes - must be after specific routes
router.get('/:videoId', videoController.getVideo);

export default router;

