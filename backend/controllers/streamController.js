import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/config.js';
import * as videoService from '../services/videoService.js';
import * as redirectService from '../services/redirectService.js';
import * as captionService from '../services/captionService.js';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Set CORS headers for streaming responses
 */
function setCORSHeaders(req, res) {
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
  res.header('Access-Control-Max-Age', '86400');
}

/**
 * Get MIME type based on file extension
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.m4v': 'video/x-m4v',
    '.flv': 'video/x-flv',
    '.wmv': 'video/x-ms-wmv',
  };
  return mimeTypes[ext] || 'video/mp4'; // Default to mp4 if unknown
}

/**
 * Build a public URL for a caption file from its stored path.
 */
function buildCaptionPublicUrl(baseUrl, caption) {
  if (!caption) return null;

  if (caption.video_id) {
    return `${baseUrl}/api/captions/${caption.video_id}/file?lang=${encodeURIComponent(caption.language || 'en')}`;
  }

  if (!caption.file_path) return null;

  let filePath = caption.file_path;
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath;
  }

  if (filePath.startsWith('/')) {
    filePath = filePath.substring(1);
  }

  if (filePath.startsWith('captions/') || filePath.startsWith('my-storage/') || filePath.startsWith('misc/')) {
    return `${baseUrl}/video-storage/${filePath}`;
  }
  if (filePath.startsWith('upload/') || filePath.startsWith('subtitles/')) {
    return `${baseUrl}/${filePath}`;
  }

  return `${baseUrl}/video-storage/captions/${filePath}`;
}

/**
 * Generate HTML page with Video.js player
 */
function generateVideoPlayerHTML(streamUrl, captions, videoTitle, baseUrl) {
  const captionPayload = (Array.isArray(captions) ? captions : [])
    .map((caption, index) => {
      const captionUrl = buildCaptionPublicUrl(baseUrl, caption);
      if (!captionUrl) return null;

      const lang = caption.language || 'en';
      return {
        src: captionUrl,
        srclang: lang,
        label: caption.label || lang.toUpperCase(),
        default: index === 0 || lang === 'en'
      };
    })
    .filter(Boolean);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${videoTitle}</title>
    
    <!-- Video.js CSS -->
    <link href="https://vjs.zencdn.net/8.6.1/video-js.css" rel="stylesheet" />
    
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(to bottom right, #f5f5f5, #e0e0e0);
            min-height: 100vh;
        }
        
        .video-container {
            max-width: 1200px;
            margin: 0 auto;
            background: #000;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        }
        
        .video-title {
            text-align: center;
            padding: 20px;
            background: white;
            margin-bottom: 0;
            border-bottom: 1px solid #e0e0e0;
        }
        
        .video-title h1 {
            margin: 0;
            font-size: 24px;
            color: #333;
            font-weight: 600;
        }
        
        /* 16:9 Aspect Ratio */
        .video-wrapper {
            position: relative;
            width: 100%;
            padding-bottom: 56.25%;
            height: 0;
            overflow: hidden;
        }
        
        .video-wrapper video {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
        }
        
        .video-js {
            width: 100%;
            height: 100%;
        }
        
        /* Hide download controls */
        .video-js video::-webkit-media-controls-enclosure {
            overflow: hidden;
        }
        
        .video-js .vjs-control-bar {
            background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, transparent 100%);
        }
        
        .video-js .vjs-big-play-button {
            border-radius: 50%;
            width: 80px;
            height: 80px;
            line-height: 80px;
            margin-left: -40px;
            margin-top: -40px;
            background: rgba(0, 0, 0, 0.6);
            border: 3px solid white;
        }
        
        .video-js .vjs-big-play-button:hover {
            background: rgba(0, 0, 0, 0.8);
        }
    </style>
</head>
<body>
    <div class="video-container">
        ${videoTitle ? `<div class="video-title"><h1>${videoTitle}</h1></div>` : ''}
        <div class="video-wrapper">
            <video
                id="video-player"
                class="video-js vjs-default-skin vjs-big-play-centered"
                controls
                preload="auto"
                controlsList="nodownload noplaybackrate"
                disablePictureInPicture
                data-setup='{}'
            >
                <source src="${streamUrl}" type="video/mp4" />
            </video>
        </div>
    </div>

    <!-- Video.js Core -->
    <script src="https://vjs.zencdn.net/8.6.1/video.min.js"></script>
    
    <!-- Video.js HTTP Streaming (HLS) -->
    <script src="https://unpkg.com/@videojs/http-streaming@3.0.2/dist/videojs-http-streaming.min.js"></script>
    
    <!-- Quality Levels & Selector -->
    <script src="https://cdn.jsdelivr.net/npm/videojs-contrib-quality-levels@3.0.0/dist/videojs-contrib-quality-levels.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/videojs-hls-quality-selector@1.1.4/dist/videojs-hls-quality-selector.min.js"></script>

    <script>
        const STREAM_URL = "${streamUrl}";
        const CAPTIONS = ${JSON.stringify(captionPayload)};

        const player = videojs('video-player', {
            fluid: true,
            responsive: true,
            aspectRatio: '16:9',
            controls: true,
            preload: 'auto',
            controlBar: {
                children: [
                    'playToggle',
                    'volumePanel',
                    'progressControl',
                    'remainingTimeDisplay',
                    'spacer',
                    'subsCapsButton',
                    'fullscreenToggle'
                ]
            },
            html5: {
                vhs: {
                    overrideNative: true,
                    enableLowInitialPlaylist: true,
                    smoothQualityChange: true
                },
                nativeTextTracks: false
            }
        });

        // Set video source
        player.src(STREAM_URL);

        // Add caption tracks when available
        CAPTIONS.forEach(function(caption) {
            player.addRemoteTextTrack({
                kind: 'captions',
                src: caption.src,
                srclang: caption.srclang,
                label: caption.label,
                default: caption.default
            }, false);
        });

        // Initialize when ready
        player.ready(function() {
            // Show CC button when subtitles are available
            const subsBtn = player.controlBar.getChild('subsCapsButton');
            if (subsBtn) {
                if (CAPTIONS.length > 0) {
                    subsBtn.show();
                } else {
                    subsBtn.hide();
                }
            }

            // Enable quality selector if available
            if (player.qualityLevels && player.hlsQualitySelector) {
                try {
                    player.hlsQualitySelector({
                        displayCurrentQuality: true
                    });
                } catch (e) {
                    console.log('Quality selector not available for this video format');
                }
            }

            // Disable right-click
            const videoEl = player.el().querySelector('video');
            if (videoEl) {
                videoEl.addEventListener('contextmenu', function(e) {
                    e.preventDefault();
                });
                videoEl.disablePictureInPicture = true;
                videoEl.setAttribute('controlsList', 'nodownload noplaybackrate');
            }

            // Prevent download shortcuts
            document.addEventListener('keydown', function(e) {
                if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                    e.preventDefault();
                }
            });
        });

        // Error handling
        player.on('error', function() {
            console.error('Player error:', player.error());
        });
    </script>
</body>
</html>`;
}

/**
 * Stream video with HTTP range request support
 * This allows seeking, partial downloads, and efficient streaming
 */
export async function streamVideo(req, res) {
  try {
    const { videoId } = req.params;
    // Check if this is a short slug route using the flag set by the route handler
    const isShortSlugRoute = req.isShortSlugRoute === true;
    
    // Check if this is a browser request (not a video player request)
    // Browser requests typically have Accept: text/html
    // Video player requests have Range header for seeking or specific video MIME types
    const acceptHeader = req.headers.accept || '';
    const hasRangeHeader = !!req.headers.range;
    const userAgent = req.headers['user-agent'] || '';
    
    // Video player requests ALWAYS have Range header or specific video MIME types
    // If Range header is present, it's definitely a video player request (highest priority)
    const isVideoPlayerRequest = hasRangeHeader || 
                                 acceptHeader.includes('video/') || 
                                 acceptHeader.includes('application/octet-stream') ||
                                 acceptHeader.includes('application/vnd.apple.mpegurl'); // HLS
    
    // Browser requests are ONLY those that explicitly request HTML and have NO Range header
    // If Range header exists, it's NEVER a browser request
    // Empty accept header without Range is treated as browser request only for initial page loads
    const isBrowserRequest = !hasRangeHeader && // Must not have Range header
                            !isVideoPlayerRequest && // Must not be a video player request
                            (acceptHeader.includes('text/html') || 
                             acceptHeader === '' || 
                             acceptHeader.includes('*/*'));
    
    // Handle URL-encoded video IDs (e.g., "AllAboutMyFamily2_Prek2_Lesson3_M3_Emotions")
    // Decode the videoId in case it's URL-encoded
    let decodedVideoId;
    try {
      decodedVideoId = decodeURIComponent(videoId);
      if (decodedVideoId !== videoId) {
        console.log('Video ID was URL-encoded, decoded to:', decodedVideoId);
      }
    } catch (e) {
      // If decoding fails, use original
      decodedVideoId = videoId;
    }
    
    // Use decoded video ID for lookups
    const lookupId = decodedVideoId || videoId;
    
    console.log('===== STREAM CONTROLLER CALLED =====');
    console.log('Stream request received for videoId:', videoId);
    console.log('Decoded videoId:', lookupId);
    console.log('Is short slug route:', isShortSlugRoute);
    console.log('Is browser request:', isBrowserRequest);
    console.log('Is video player request:', isVideoPlayerRequest);
    console.log('Request details:', {
      method: req.method,
      url: req.url,
      originalUrl: req.originalUrl,
      path: req.path,
      params: req.params,
      query: req.query,
      isShortSlugRoute: req.isShortSlugRoute,
      accept: acceptHeader,
      hasRange: !!hasRangeHeader,
      userAgent: userAgent.substring(0, 50) // Log first 50 chars of user agent
    });
    
    // If this is a browser request (not a video player), serve HTML page with Video.js player
    // This ensures the Video.js player is used instead of browser's default player
    if (isBrowserRequest && isShortSlugRoute) {
      console.log('🌐 Browser request detected, serving HTML page with Video.js player');
      
      // First, get video information to display title and get stream URL
      let video;
      try {
        video = await videoService.getVideoByRedirectSlug(lookupId, true);
        if (!video) {
          video = await videoService.getVideoByVideoId(lookupId, true);
        }
      } catch (videoError) {
        console.error('Error fetching video for HTML player:', videoError);
        video = null;
      }

      if (video?.status === 'deleted') {
        video = null;
      }
      
      if (!video) {
        setCORSHeaders(req, res);
        return res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Video Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              h1 { color: #e74c3c; }
            </style>
          </head>
          <body>
            <h1>Video Not Found</h1>
            <p>The video you are looking for could not be found.</p>
          </body>
          </html>
        `);
      }
      
      // Build stream URL - use /api/s/ to avoid redirect loops with .htaccess
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const streamUrl = `${baseUrl}/api/s/${lookupId}`;
      const videoTitle = video.title || 'Video Player';
      
      // Load captions for CC / subtitles in the HTML player
      let captions = [];
      try {
        captions = await captionService.getCaptionsByVideoId(video.video_id);
        console.log(`[Stream HTML] Loaded ${captions.length} caption(s) for ${video.video_id}`);
      } catch (captionError) {
        console.warn('[Stream HTML] Could not load captions:', captionError.message);
      }
      
      // Generate HTML with Video.js player
      const html = generateVideoPlayerHTML(streamUrl, captions, videoTitle, baseUrl);
      
      setCORSHeaders(req, res);
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }
    
    // Continue with video streaming for video player requests (has Range header or video MIME type)
    console.log('📹 Video player request detected, serving video file directly');
    
    // If this is a short slug route (/s/:slug), check redirect_slug first
    // Otherwise, check videoId first (for /api/videos/:videoId/stream)
    let video;
    if (isShortSlugRoute) {
      // For short slug routes, check redirect_slug first
      console.log(`[Stream] Checking for video by redirect_slug: "${lookupId}"`);
      video = await videoService.getVideoByRedirectSlug(lookupId, false);
      if (video) {
        console.log(`[Stream] ✓ Found video by redirect_slug: ${lookupId} -> ${video.video_id} (ID: ${video.id})`);
      } else {
        // Fallback to videoId lookup
        console.log(`[Stream] Not found by redirect_slug, trying videoId: "${lookupId}"`);
        video = await videoService.getVideoByVideoId(lookupId, false);
        if (video) {
          console.log(`[Stream] ✓ Found video by videoId: ${lookupId} -> ${video.video_id} (ID: ${video.id})`);
        }
      }
    } else {
      // For regular routes, check videoId first
      video = await videoService.getVideoByVideoId(lookupId, false);
      if (!video) {
        console.log(`[Stream] Video not found by videoId, checking redirect_slug: "${lookupId}"`);
        // Try to find video by redirect_slug (short link)
        video = await videoService.getVideoByRedirectSlug(lookupId, false);
        if (video) {
          console.log(`[Stream] ✓ Found video by redirect_slug: ${lookupId} -> ${video.video_id} (ID: ${video.id})`);
        }
      } else {
        console.log(`[Stream] ✓ Found video by videoId: ${lookupId} -> ${video.video_id} (ID: ${video.id})`);
      }
    }
    
    if (!video) {
      console.log(`[Stream] Video not found with active status, trying to include inactive videos for: "${lookupId}"`);
      if (isShortSlugRoute) {
        video = await videoService.getVideoByRedirectSlug(lookupId, true);
        if (video) {
          console.log(`[Stream] Found video by redirect_slug (including inactive): ${lookupId} -> ${video.video_id}, status: ${video.status}`);
        } else {
          video = await videoService.getVideoByVideoId(lookupId, true);
          if (video) {
            console.log(`[Stream] Found video by videoId (including inactive): ${lookupId} -> ${video.video_id}, status: ${video.status}`);
          }
        }
      } else {
        video = await videoService.getVideoByVideoId(lookupId, true);
        if (video) {
          console.log(`[Stream] Found video by videoId (including inactive): ${lookupId} -> ${video.video_id}, status: ${video.status}`);
        } else {
          // Try redirect slug with inactive videos
          video = await videoService.getVideoByRedirectSlug(lookupId, true);
          if (video) {
            console.log(`[Stream] Found video by redirect_slug (including inactive): ${lookupId} -> ${video.video_id}, status: ${video.status}`);
          }
        }
      }
    }
    
    if (video?.status === 'deleted') {
      console.log(`[Stream] Refusing to stream deleted video: ${video.video_id}`);
      video = null;
    }
    
    if (!video) {
      console.error('===== VIDEO NOT FOUND =====');
      console.error('Video not found in database for videoId:', videoId);
      console.error('Decoded videoId:', lookupId);
      console.error('Lookup details:', {
        isShortSlugRoute,
        triedRedirectSlug: isShortSlugRoute,
        triedVideoId: true,
        originalVideoId: videoId,
        decodedVideoId: lookupId
      });
      
      // Debug: Check if redirect_slug exists in database
      if (isShortSlugRoute) {
        try {
          const [slugCheck] = await pool.execute(
            'SELECT id, video_id, redirect_slug, status FROM videos WHERE redirect_slug = ?',
            [lookupId]
          );
          console.error('Debug: Videos with redirect_slug:', lookupId, ':', slugCheck);
          
          if (slugCheck.length > 0) {
            console.error('Found videos with this redirect_slug but status might be inactive:');
            slugCheck.forEach(v => {
              console.error(`  - ID: ${v.id}, Video ID: ${v.video_id}, Status: ${v.status}, Redirect Slug: ${v.redirect_slug}`);
            });
          }
        } catch (debugError) {
          console.error('Error checking redirect_slug:', debugError.message);
        }
      }
      
      // Set CORS headers for error response
      setCORSHeaders(req, res);
      return res.status(404).json({ 
        error: 'Video not found',
        videoId: videoId,
        isShortSlugRoute: isShortSlugRoute,
        suggestion: isShortSlugRoute 
          ? 'Check if video exists with this redirect_slug and has status "active"'
          : 'Check if video exists and has status "active"'
      });
    }
    
    console.log('Video found:', {
      videoId: video.video_id,
      filePath: video.file_path,
      streamingUrl: video.streaming_url,
      uploadPath: config.upload.uploadPath,
      size: video.size,
      updatedAt: video.updated_at,
      id: video.id
    });
    
    // Check if video has a Cloudflare URL (remote URL)
    const cloudflareUrl = video.streaming_url || video.file_path;
    const isCloudflareUrl = cloudflareUrl && (cloudflareUrl.startsWith('http://') || cloudflareUrl.startsWith('https://'));
    
    // Check if it's a mock/test Cloudflare URL
    // Real Cloudflare R2 URLs typically look like: https://[account-id].r2.cloudflarestorage.com/[bucket]/[file]
    // or custom domains like: https://[custom-domain]/[file]
    const isMockUrl = isCloudflareUrl && (
      cloudflareUrl.includes('your-account.r2.cloudflarestorage.com') ||
      cloudflareUrl.includes('mock-cloudflare.example.com') ||
      (cloudflareUrl.includes('example.com') && !cloudflareUrl.includes('pub-')) || // Allow real example.com URLs
      cloudflareUrl.includes('test.cloudflare')
    );
    
    if (isCloudflareUrl && !isMockUrl) {
      // Check if the Cloudflare URL points back to our own server (would cause redirect loop)
      try {
        const urlObj = new URL(cloudflareUrl);
        const currentHost = req.get('host') || req.hostname || 'localhost:5000';
        const cloudflareHost = urlObj.hostname + (urlObj.port ? `:${urlObj.port}` : '');
        
        // Check if it's pointing to our own server (prevent redirect loops)
        const currentHostname = req.get('host') || req.hostname || 'localhost:5000';
        const isOwnServer = cloudflareHost.includes('localhost') || 
                           cloudflareHost.includes('127.0.0.1') ||
                           cloudflareHost === currentHostname ||
                           cloudflareHost.includes(currentHostname.split(':')[0]) || // Match hostname without port
                           (urlObj.pathname && (urlObj.pathname.includes('/api/videos/') || urlObj.pathname.includes('/api/s/') || urlObj.pathname.includes('/s/')));
        
        if (isOwnServer) {
          console.warn('Cloudflare URL points to our own server, preventing redirect loop:', cloudflareUrl);
          console.warn('Attempting to find local file instead...');
          // Don't redirect, continue to local file search below
        } else {
          // Only redirect to real external Cloudflare URLs
          console.log('Video has Cloudflare URL, redirecting to:', cloudflareUrl);
          // For Cloudflare URLs, redirect directly to the URL
          // Set CORS headers
          setCORSHeaders(req, res);
          
          // Redirect to Cloudflare URL
          return res.redirect(302, cloudflareUrl);
        }
      } catch (urlError) {
        console.warn('Error parsing Cloudflare URL, treating as invalid:', urlError.message);
        // Don't redirect if URL is invalid, continue to local file search
      }
    } else if (isMockUrl) {
      console.warn('Mock Cloudflare URL detected, attempting to find local file instead:', cloudflareUrl);
      // Don't redirect to mock URL, continue to local file search below
    }
    
    // Build base paths
    const basePath = path.dirname(__dirname);
    const uploadPath = path.isAbsolute(config.upload.uploadPath) 
      ? config.upload.uploadPath 
      : path.resolve(basePath, config.upload.uploadPath);
    const myStoragePath = path.join(uploadPath, 'my-storage');
    const miscPath = path.join(uploadPath, 'misc');
    const backendUploadPath = path.join(basePath, 'upload'); // Check backend/upload directory
    
    let filePath = null;
    
    // PRIORITY 0: Check block storage path FIRST: my-storage/<redirect_slug>.mp4 (HIGHEST PRIORITY)
    // This is the new format - path stays same when replacing videos (block storage)
    if (video.redirect_slug) {
      const blockStoragePath = path.join(myStoragePath, `${video.redirect_slug}.mp4`);
      if (fs.existsSync(blockStoragePath)) {
        filePath = blockStoragePath;
        console.log('✓✓✓✓ FOUND USING BLOCK STORAGE (HIGHEST PRIORITY - redirect_slug):', filePath);
        const stats = fs.statSync(filePath);
        console.log('✓ File stats:', {
          size: stats.size,
          modified: stats.mtime,
          isFile: stats.isFile()
        });
      } else {
        console.log('⚠ Block storage path does not exist:', blockStoragePath);
      }
    }
    
    // PRIORITY 0.5: Check fixed format with video_id (fallback for old videos): my-storage/<video_id>.mp4
    if (!filePath && video.video_id) {
      const fixedFormatPath = path.join(myStoragePath, `${video.video_id}.mp4`);
      if (fs.existsSync(fixedFormatPath)) {
        filePath = fixedFormatPath;
        console.log('✓✓✓✓ FOUND USING FIXED FORMAT (video_id - fallback):', filePath);
        const stats = fs.statSync(filePath);
        console.log('✓ File stats:', {
          size: stats.size,
          modified: stats.mtime,
          isFile: stats.isFile()
        });
      } else {
        console.log('⚠ Fixed format path does not exist:', fixedFormatPath);
        console.log('⚠ Will try database file_path and other paths...');
      }
    }
    
    // PRIORITY 0.75: Check backend/upload directory (for files uploaded directly to backend/upload)
    if (!filePath && video.redirect_slug) {
      const backendUploadSlugPath = path.join(backendUploadPath, `${video.redirect_slug}.mp4`);
      if (fs.existsSync(backendUploadSlugPath)) {
        filePath = backendUploadSlugPath;
        console.log('✓✓✓✓ FOUND IN BACKEND/UPLOAD (redirect_slug):', filePath);
      }
    }
    if (!filePath && video.video_id) {
      const backendUploadVideoIdPath = path.join(backendUploadPath, `${video.video_id}.mp4`);
      if (fs.existsSync(backendUploadVideoIdPath)) {
        filePath = backendUploadVideoIdPath;
        console.log('✓✓✓✓ FOUND IN BACKEND/UPLOAD (video_id):', filePath);
      }
    }
    // Also check by filename from database
    if (!filePath && video.file_path) {
      const fileName = path.basename(video.file_path);
      const backendUploadFileNamePath = path.join(backendUploadPath, fileName);
      if (fs.existsSync(backendUploadFileNamePath)) {
        filePath = backendUploadFileNamePath;
        console.log('✓✓✓✓ FOUND IN BACKEND/UPLOAD (filename):', filePath);
      }
    }
    
    // PRIORITY 1: Check if the exact file_path from database exists (if fixed format not found)
    if (!filePath && video.file_path) {
      let dbFilePath;
      if (path.isAbsolute(video.file_path)) {
        dbFilePath = video.file_path;
      } else {
        dbFilePath = path.join(uploadPath, video.file_path);
      }
      dbFilePath = path.normalize(dbFilePath);
      
      if (fs.existsSync(dbFilePath)) {
        filePath = dbFilePath;
        console.log('✓✓✓ Using EXACT file_path from database:', filePath);
        const stats = fs.statSync(filePath);
        console.log('✓ File stats:', {
          size: stats.size,
          modified: stats.mtime,
          isFile: stats.isFile()
        });
      } else {
        console.log('⚠ Exact file_path from database does not exist:', dbFilePath);
      }
    }
    
    // Declare uniquePaths at function scope level (before the if/else block)
    let uniquePaths = [];
    
    // If file already found via fixed format or database path, skip other strategies
    if (filePath && fs.existsSync(filePath)) {
      // File found, continue to streaming
      console.log('✓✓✓ File found, proceeding to stream');
    } else {
      // Try multiple path resolution strategies if file doesn't exist
      const possiblePaths = [];
      
      // Strategy 1: Fixed format (already tried above, but add to possiblePaths for logging)
      if (video.video_id) {
        const fixedPath = path.join(myStoragePath, `${video.video_id}.mp4`);
        possiblePaths.unshift(fixedPath);
      }
      
      // Strategy 2: Direct path from database (already tried above)
      if (video.file_path) {
        const dbPath = path.isAbsolute(video.file_path)
          ? video.file_path
          : path.join(uploadPath, video.file_path);
        possiblePaths.push(dbPath);
      }
      
      // Strategy 3: If file_path includes my-storage, try direct join
      if (video.file_path && (video.file_path.includes('my-storage') || video.file_path.includes('MY-STORAGE'))) {
        possiblePaths.push(path.join(uploadPath, video.file_path));
      }
      
      console.log('Path resolution:', {
        basePath,
        configUploadPath: config.upload.uploadPath,
        resolvedUploadPath: uploadPath,
        resolvedMyStoragePath: myStoragePath,
        resolvedMiscPath: miscPath,
        myStoragePathExists: fs.existsSync(myStoragePath),
        miscPathExists: fs.existsSync(miscPath),
        videoId: video.video_id,
        filePathFromDb: video.file_path
      });
      
      // If file_path is just a filename, try backend/upload first, then my-storage, then misc
      const fileName = path.basename(video.file_path);
      if (fileName) {
        // Try backend/upload first
        const backendUploadFile = path.join(backendUploadPath, fileName);
        if (fs.existsSync(backendUploadFile)) {
          possiblePaths.unshift(backendUploadFile);
        }
        if (video.video_id) {
          // Try fixed format first
          possiblePaths.unshift(path.join(myStoragePath, `${video.video_id}.mp4`));
        }
        possiblePaths.push(path.join(myStoragePath, fileName));
        possiblePaths.push(path.join(miscPath, fileName));
      }
      
      // If file_path includes misc, try direct join
      if (video.file_path && (video.file_path.includes('misc') || video.file_path.includes('MISC'))) {
        possiblePaths.push(path.join(uploadPath, video.file_path));
        // Also try with just the filename in misc
        possiblePaths.push(path.join(miscPath, fileName));
      }
      
      // Strategy 3: Try with upload path structure (normalize separators)
      const normalizedFilePath = video.file_path.replace(/\\/g, '/');
      possiblePaths.push(path.join(uploadPath, normalizedFilePath));
      
      // Strategy 4: Try with Windows-style separators
      if (normalizedFilePath.includes('/')) {
        possiblePaths.push(path.join(uploadPath, ...normalizedFilePath.split('/')));
      }
      
      // Strategy 5: If file_path doesn't include folder, try adding misc (most common case)
      if (!video.file_path.includes('/') && !video.file_path.includes('\\')) {
        possiblePaths.push(path.join(miscPath, video.file_path));
      }
      
      // Strategy 5.5: Try backend/upload directory (for files uploaded directly to backend/upload)
      if (fs.existsSync(backendUploadPath)) {
        possiblePaths.push(path.join(backendUploadPath, normalizedFilePath));
        possiblePaths.push(path.join(backendUploadPath, fileName));
        // Also try with redirect_slug and video_id
        if (video.redirect_slug) {
          possiblePaths.push(path.join(backendUploadPath, `${video.redirect_slug}.mp4`));
        }
        if (video.video_id) {
          possiblePaths.push(path.join(backendUploadPath, `${video.video_id}.mp4`));
        }
      }
      
      // Strategy 6: Try original upload path structure (relative to backend)
      possiblePaths.push(path.resolve(basePath, '..', 'video-storage', normalizedFilePath));
      
      // Strategy 7: Try with each folder level separately
      if (normalizedFilePath.includes('/')) {
        const parts = normalizedFilePath.split('/');
        possiblePaths.push(path.resolve(uploadPath, ...parts));
      }
      
      // Strategy 8: Try absolute path if it looks like a Windows path
      if (video.file_path.includes('\\') || video.file_path.includes('/')) {
        possiblePaths.push(path.resolve(video.file_path));
      }
      
      // Remove duplicates and update uniquePaths for logging/error reporting
      uniquePaths = [...new Set(possiblePaths)];
      
      // PRIORITY: Check misc folder first since files are often stored there
      // Use the fileName already extracted above
      if (fs.existsSync(miscPath) && !filePath) {
      try {
        const miscFiles = fs.readdirSync(miscPath).filter(f => 
          f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')
        );
        
        // Try exact filename match first
        const exactMatch = miscFiles.find(f => f === fileName);
        if (exactMatch) {
          const foundPath = path.join(miscPath, exactMatch);
          if (fs.existsSync(foundPath)) {
            filePath = foundPath;
            console.log('✓✓✓ FOUND IN MISC (exact match):', filePath);
          }
        } else {
          // Extract VID number and search
          const vidMatch = fileName.match(/VID_(\d+)/);
          if (vidMatch) {
            const vidNumber = vidMatch[1];
            const vidMatchFile = miscFiles.find(f => f.includes(`VID_${vidNumber}`));
            if (vidMatchFile) {
              const foundPath = path.join(miscPath, vidMatchFile);
              if (fs.existsSync(foundPath)) {
                filePath = foundPath;
                console.log('✓✓✓ FOUND IN MISC (by VID number):', filePath);
              }
            }
          }
        }
      } catch (err) {
        console.warn('Error checking misc folder first:', err.message);
      }
      }
      
      // If not found in misc, try structured paths
      if (!filePath) {
        console.log('All possible structured paths to try:', uniquePaths);
        
        // Find the first path that exists
        filePath = uniquePaths.find(p => {
          try {
            const exists = fs.existsSync(p);
            if (exists) {
              console.log('✓ Found file at structured path:', p);
            }
            return exists;
          } catch {
            return false;
          }
        });
      }
      
      // If still not found, search backend/upload folder first, then misc folder (fallback)
      if (!filePath) {
        // First try backend/upload folder
        if (fs.existsSync(backendUploadPath)) {
          try {
            const fileName = path.basename(video.file_path);
            const backendUploadFiles = fs.readdirSync(backendUploadPath).filter(f => 
              f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')
            );
            console.log('Searching backend/upload folder for:', fileName);
            console.log('Total video files in backend/upload:', backendUploadFiles.length);
            
            // Try exact match first
            const exactMatch = backendUploadFiles.find(f => f === fileName || f.toLowerCase() === fileName.toLowerCase());
            if (exactMatch) {
              filePath = path.join(backendUploadPath, exactMatch);
              console.log('✓✓✓ FOUND IN BACKEND/UPLOAD (exact match):', filePath);
            } else {
              // Try by redirect_slug or video_id
              if (video.redirect_slug) {
                const slugMatch = backendUploadFiles.find(f => f.includes(video.redirect_slug) || f.toLowerCase().includes(video.redirect_slug.toLowerCase()));
                if (slugMatch) {
                  filePath = path.join(backendUploadPath, slugMatch);
                  console.log('✓✓✓ FOUND IN BACKEND/UPLOAD (by slug):', filePath);
                }
              }
              if (!filePath && video.video_id) {
                const videoIdMatch = backendUploadFiles.find(f => f.includes(video.video_id) || f.toLowerCase().includes(video.video_id.toLowerCase()));
                if (videoIdMatch) {
                  filePath = path.join(backendUploadPath, videoIdMatch);
                  console.log('✓✓✓ FOUND IN BACKEND/UPLOAD (by video_id):', filePath);
                }
              }
            }
          } catch (err) {
            console.warn('Error checking backend/upload folder:', err.message);
          }
        }
        
        // If still not found, try misc folder
        if (!filePath && fs.existsSync(miscPath)) {
          try {
            const fileName = path.basename(video.file_path); // e.g., VID_1764745515981_master.mp4
            const miscFiles = fs.readdirSync(miscPath).filter(f => 
              f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')
            );
            console.log('Searching misc folder for:', fileName);
            console.log('Total video files in misc:', miscFiles.length);
            console.log('Sample files:', miscFiles.slice(0, 5));
            
            // Try exact match first
            const exactMatch = miscFiles.find(f => f === fileName);
            if (exactMatch) {
              filePath = path.join(miscPath, exactMatch);
              console.log('✓ Found exact match in misc folder:', filePath);
            } else {
              // Extract VID number from filename (e.g., "VID_1764745515981" from "VID_1764745515981_master.mp4")
              const vidMatch = fileName.match(/VID_(\d+)/);
              if (vidMatch) {
                const vidNumber = vidMatch[1]; // e.g., "1764745515981"
                console.log('Searching for VID number:', vidNumber);
                
                // Try to find file with this VID number
                const vidMatchFile = miscFiles.find(f => f.includes(`VID_${vidNumber}`));
                if (vidMatchFile) {
                  filePath = path.join(miscPath, vidMatchFile);
                  console.log('✓ Found file by VID number in misc folder:', filePath);
                }
              }
              
              // If still not found, try partial match (match by video ID prefix)
              if (!filePath) {
                const videoIdPrefix = fileName.split('_')[0]; // e.g., "VID"
                const partialMatch = miscFiles.find(f => f.startsWith(videoIdPrefix));
                if (partialMatch) {
                  filePath = path.join(miscPath, partialMatch);
                  console.log('✓ Found partial match in misc folder:', filePath);
                }
              }
              
              // If still not found, try matching by any part of the filename
              if (!filePath) {
                const nameParts = fileName.split('_');
                const anyMatch = miscFiles.find(f => {
                  return nameParts.some(part => part.length > 3 && f.includes(part));
                });
                if (anyMatch) {
                  filePath = path.join(miscPath, anyMatch);
                  console.log('✓ Found filename match in misc folder:', filePath);
                }
              }
            }
          } catch (err) {
            console.error('Error searching misc folder:', err.message);
            console.error('Error stack:', err.stack);
          }
        } else {
          console.error('Misc folder does not exist:', miscPath);
        }
      }
      
      // Verify the file actually exists at the resolved path
      if (filePath) {
        const normalizedPath = path.normalize(filePath);
        const fileExists = fs.existsSync(normalizedPath);
        
        if (fileExists) {
          filePath = normalizedPath;
          console.log('✓✓✓ FINAL: File verified and ready to stream at:', filePath);
        } else {
          console.error('WARNING: File path was set but file does not exist at:', normalizedPath);
          console.error('Attempting to find file in misc folder as fallback...');
          
          // Last resort: search misc folder by VID number
          if (fs.existsSync(miscPath)) {
            try {
              const miscFiles = fs.readdirSync(miscPath).filter(f => 
                f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')
              );
              
              const vidMatch = fileName.match(/VID_(\d+)/);
              if (vidMatch) {
                const vidNumber = vidMatch[1];
                const vidMatchFile = miscFiles.find(f => f.includes(`VID_${vidNumber}`));
                if (vidMatchFile) {
                  const miscFilePath = path.join(miscPath, vidMatchFile);
                  if (fs.existsSync(miscFilePath)) {
                    filePath = miscFilePath;
                    console.log('✓✓✓ FOUND IN MISC (fallback search):', filePath);
                  }
                }
              }
            } catch (err) {
              console.error('Error in fallback misc search:', err.message);
            }
          }
          
          // If still not found, reset filePath
          if (!filePath || !fs.existsSync(filePath)) {
            filePath = null;
          }
        }
      }
    } // End of else block that started at line 266
    
    // If still no file found, use first path for error reporting
    if (!filePath && uniquePaths.length > 0) {
      console.error('None of the attempted paths exist. Tried:', uniquePaths);
    }
    
    // Final check if file exists
    if (!filePath || !fs.existsSync(filePath)) {
      console.error('Video file not found at any attempted path');
      console.error('Video ID:', video.video_id);
      console.error('File path from database:', video.file_path);
      console.error('Fixed format path (should exist):', video.video_id ? path.join(myStoragePath, `${video.video_id}.mp4`) : 'N/A');
      console.error('All attempted paths:', uniquePaths);
      
      // Check if any of the parent directories exist
      const checkDirs = [
        path.resolve(basePath, '..', 'video-storage'),
        uploadPath,
        miscPath
      ];
      
      const dirInfo = checkDirs.map(dir => {
        const exists = fs.existsSync(dir);
        let files = [];
        if (exists) {
          try {
            files = fs.readdirSync(dir).slice(0, 10);
          } catch (err) {
            files = ['Cannot read directory'];
          }
        }
        return { path: dir, exists, files };
      });
      
      console.error('Directory check:', dirInfo);
      
      // If misc folder exists, try to find the file by filename (LAST RESORT)
      if (fs.existsSync(miscPath)) {
        try {
          const fileName = path.basename(video.file_path); // e.g., VID_1764675366468_master.mp4
          const miscFiles = fs.readdirSync(miscPath).filter(f => 
            f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')
          );
          console.error('Video files in misc folder:', miscFiles);
          console.error('Looking for file matching:', fileName);
          
          // Try to find exact match or partial match
          const exactMatch = miscFiles.find(f => f === fileName);
          const partialMatch = miscFiles.find(f => f.includes(fileName.split('_')[0]) || fileName.includes(f.split('_')[0]));
          
          if (exactMatch) {
            const foundPath = path.join(miscPath, exactMatch);
            console.error('✓ Found exact match in misc folder:', foundPath);
            if (fs.existsSync(foundPath)) {
              filePath = foundPath;
              console.log('✅✅✅ FILE FOUND IN MISC FOLDER:', filePath);
              // Don't return 404, continue to streaming
            } else {
              console.error('✗ Found match but file does not exist:', foundPath);
            }
          } else if (partialMatch) {
            const foundPath = path.join(miscPath, partialMatch);
            console.error('✓ Found partial match in misc folder:', foundPath);
            if (fs.existsSync(foundPath)) {
              filePath = foundPath;
              console.log('✅✅✅ FILE FOUND IN MISC FOLDER (partial match):', filePath);
              // Don't return 404, continue to streaming
            } else {
              console.error('✗ Found match but file does not exist:', foundPath);
            }
          } else {
            console.error('✗ No matching file found in misc folder');
            console.error('Available files:', miscFiles);
          }
        } catch (err) {
          console.error('Cannot read misc folder:', err.message);
        }
      }
      
      // Only return 404 if file still not found after all attempts
      if (!filePath || !fs.existsSync(filePath)) {
        // Check if this was a mock Cloudflare URL
        const cloudflareUrl = video.streaming_url || video.file_path;
        const isMockUrl = cloudflareUrl && (
          cloudflareUrl.includes('your-account.r2.cloudflarestorage.com') ||
          cloudflareUrl.includes('mock-cloudflare.example.com') ||
          cloudflareUrl.includes('example.com') ||
          cloudflareUrl.includes('test.cloudflare')
        );
        
        // Set CORS headers for error response
        setCORSHeaders(req, res);
        
        const errorMessage = isMockUrl 
          ? 'Video file not found. This video uses a mock Cloudflare URL and no local file is available. Please update the video with a real Cloudflare URL or upload a local file.'
          : 'Video file not found';
        
        return res.status(404).json({ 
          error: errorMessage,
          isMockUrl: isMockUrl,
          cloudflareUrl: isMockUrl ? cloudflareUrl : undefined,
          attemptedPaths: uniquePaths,
          videoId: videoId,
          filePathFromDb: video.file_path,
          uploadPath: config.upload.uploadPath,
          backendDir: path.dirname(__dirname),
          directoryCheck: dirInfo
        });
      }
    }
    
    // Verify file exists before proceeding
    if (!fs.existsSync(filePath)) {
      // Set CORS headers for error response
      setCORSHeaders(req, res);
      return res.status(404).json({ 
        error: 'Video file not found after all search attempts',
        videoId: videoId,
        filePathFromDb: video.file_path,
        lastAttemptedPath: filePath
      });
    }
    
    console.log('✅✅✅ FILE EXISTS AND READY TO STREAM:', filePath);
    console.log('File stats check:', {
      exists: fs.existsSync(filePath),
      path: filePath,
      normalized: path.normalize(filePath)
    });
    
    // Check if file is readable
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      console.log('✓ File is readable');
    } catch (err) {
      console.error('Video file not readable:', filePath, err);
      // Set CORS headers for error response
      setCORSHeaders(req, res);
      return res.status(403).json({ 
        error: 'Video file not accessible',
        filePath: filePath,
        details: err.message
      });
    }
    
    // Get file stats (including modification time for cache-busting)
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const lastModified = stat.mtime;
    const range = req.headers.range;
    
    console.log('✓ File ready to stream:', {
      path: filePath,
      size: fileSize,
      lastModified: lastModified,
      dbSize: video.size,
      dbUpdated: video.updated_at
    });
    
    // Generate ETag based on file size and modification time (changes when file is replaced)
    const etag = `"${fileSize}-${lastModified.getTime()}"`;
    
    console.log('File stats:', {
      size: fileSize,
      sizeMB: (fileSize / (1024 * 1024)).toFixed(2),
      range: range || 'none',
      method: req.method
    });
    
    // Detect content type from file extension
    const contentType = getContentType(filePath);
    console.log('Streaming video:', {
      videoId,
      filePath,
      fileSize,
      contentType,
      extension: path.extname(filePath)
    });
    
    // Handle HEAD requests - send headers only, no body
    if (req.method === 'HEAD') {
      const origin = req.headers.origin;
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Last-Modified': lastModified.toUTCString(),
        'ETag': etag,
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin, X-Requested-With',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Access-Control-Allow-Credentials': 'true',
      };
      
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        
        if (start < fileSize && end < fileSize) {
          head['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
          head['Content-Length'] = chunksize;
          res.writeHead(206, head);
        } else {
          res.writeHead(416, head);
        }
      } else {
        res.writeHead(200, head);
      }
      
      res.end();
      return;
    }
    
    // If range header is present, handle partial content
    if (range) {
      // Parse range header
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      // Validate range
      if (start >= fileSize || end >= fileSize) {
        // Set CORS headers for error response
        setCORSHeaders(req, res);
        res.status(416).json({ error: 'Range Not Satisfiable' });
        return;
      }
      
      // Create read stream for the requested range
      const file = fs.createReadStream(filePath, { start, end });
      
      // Set headers for partial content
      const origin = req.headers.origin;
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Last-Modified': lastModified.toUTCString(),
        'ETag': etag,
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin, X-Requested-With',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Access-Control-Allow-Credentials': 'true',
      };
      
      console.log('Streaming range:', { start, end, chunksize, contentType });
      res.writeHead(206, head);
      
      // Handle stream errors
      file.on('error', (err) => {
        console.error('File stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error', details: err.message });
        }
      });
      
      file.pipe(res);
    } else {
      // No range header - send full file (but this shouldn't happen for video streaming)
      // Videos should always use range requests for efficient streaming
      console.log('No range header - sending full file (not recommended for large files)');
      const origin = req.headers.origin;
      const head = {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Last-Modified': lastModified.toUTCString(),
        'ETag': etag,
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin, X-Requested-With',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Access-Control-Allow-Credentials': 'true',
      };
      
      res.writeHead(200, head);
      const file = fs.createReadStream(filePath);
      
      // Handle stream errors
      file.on('error', (err) => {
        console.error('File stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error', details: err.message });
        }
      });
      
      file.pipe(res);
    }
  } catch (error) {
    console.error('Stream video error:', error);
    // Set CORS headers for error response
    if (!res.headersSent) {
      setCORSHeaders(req, res);
      res.status(500).json({ error: 'Failed to stream video' });
    }
  }
}

