import { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
// Initialize plugins once globally (prevents re-registration warnings)
import '../utils/videojs-plugins';
import { AlertCircle, Pause } from 'lucide-react';
import VideoDiagnostic from './VideoDiagnostic';
import api from '../services/api';
import { getBackendBaseUrl } from '../utils/apiConfig';

const VIEW_KEY = 'video_viewed_ids';

const hasViewed = (videoId) => {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return !!data[videoId];
  } catch {
    return false;
  }
};

const markViewed = (videoId) => {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data[videoId] = Date.now();
    localStorage.setItem(VIEW_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
};

// Function to increment view count
const incrementViewCount = async (videoId) => {
  try {
    if (!videoId) return;
    
    // Prevent multiple counts for the same user/browser
    if (hasViewed(videoId)) {
      return;
    }
    
    // Try by video_id first, then by database ID or redirect_slug
    await api.post(`/videos/${videoId}/increment-views`);
    console.log(`[VideoPlayer] View count incremented for video: ${videoId}`);
    markViewed(videoId);
  } catch (error) {
    // Silent fail - don't interrupt video playback
    console.warn('[VideoPlayer] Could not increment view count:', error.message);
  }
};

// Custom styles for Video.js player - Professional YouTube-like appearance
const videoPlayerStyles = `
  .video-js {
    width: 100% !important;
    height: 100% !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: #000;
    border-radius: 12px;
    overflow: hidden;
  }
  .video-js .vjs-tech {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  /* Professional control bar - always visible with smooth gradient */
  .video-js .vjs-control-bar {
    background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, transparent 100%);
    height: 52px;
    display: flex;
    align-items: center;
    padding: 0 16px;
    opacity: 1 !important;
    visibility: visible !important;
    backdrop-filter: blur(8px);
    border-top: 1px solid rgba(255,255,255,0.1);
  }
  .video-js.vjs-user-inactive .vjs-control-bar {
    opacity: 1 !important;
    visibility: visible !important;
  }
  /* Better button styling */
  .video-js .vjs-button {
    color: #fff;
    transition: opacity 0.2s;
  }
  .video-js .vjs-button:hover {
    opacity: 0.8;
  }
  /* Play/Pause button - ensure it toggles correctly */
  .video-js .vjs-play-control {
    cursor: pointer;
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  /* Hide play control completely */
  .video-js .vjs-play-control {
    display: none !important;
  }
  /* Use default Video.js icons for play/pause */
  /* Progress bar styling - positioned at top */
  .video-js .vjs-progress-control {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    width: 100%;
    margin: 0;
    z-index: 10;
    cursor: pointer;
    order: 0 !important;
  }
  .video-js .vjs-progress-control:hover {
    height: 6px;
  }
  .video-js .vjs-progress-control:hover .vjs-progress-holder {
    height: 6px;
  }
  .video-js .vjs-progress-holder {
    height: 4px;
    background: rgba(255,255,255,0.2);
    border-radius: 2px;
  }
  .video-js .vjs-play-progress {
    background: #ff0000;
    border-radius: 2px;
  }
  .video-js .vjs-load-progress {
    background: rgba(255,255,255,0.4);
    border-radius: 2px;
  }
  /* Volume control */
  .video-js .vjs-volume-control {
    margin: 0 8px;
  }
  /* Fullscreen button */
  .video-js .vjs-fullscreen-control {
    margin-left: auto;
  }
  /* Picture-in-Picture button - hidden */
  .video-js .vjs-picture-in-picture-control {
    display: none !important;
    visibility: hidden !important;
  }
  /* Closed Captions button - right side */
  .video-js .vjs-subs-caps-button {
    order: 6;
    margin-left: 8px;
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    cursor: pointer !important;
  }
  /* Fullscreen button - right side */
  .video-js .vjs-fullscreen-control {
    order: 3;
    margin-left: 4px;
  }
  /* Control bar layout - properly arranged controls */
  .video-js .vjs-control-bar {
    display: flex !important;
    align-items: center !important;
    padding: 0 16px !important;
    height: 52px !important;
  }
  /* Play/Pause button - first on left */
  .video-js .vjs-control-bar > .vjs-play-control {
    order: 1;
    margin-right: 12px;
    min-width: 40px;
    height: 40px;
    display: flex !important;
    visibility: visible !important;
  }
  /* Volume panel - second */
  .video-js .vjs-control-bar > .vjs-volume-panel {
    order: 2;
    margin-right: 12px;
    display: flex !important;
    visibility: visible !important;
  }
  /* Progress bar is positioned absolutely at top, not in flex order */
  .video-js .vjs-control-bar > .vjs-progress-control {
    order: 0;
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    margin: 0;
    height: 4px;
  }
  /* Spacer to push controls to right */
  .video-js .vjs-control-bar > .vjs-spacer {
    order: 2;
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Closed Captions button - show and style */
  .video-js .vjs-control-bar > .vjs-subs-caps-button {
    order: 6;
    margin-left: 8px;
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    cursor: pointer !important;
  }
  /* Hide direct playback rate and quality buttons - they're in settings now */
  .video-js .vjs-control-bar > .vjs-playback-rate {
    display: none !important;
    visibility: hidden !important;
  }
  .video-js .vjs-control-bar > .vjs-hls-quality-selector {
    display: none !important;
    visibility: hidden !important;
  }
  
  /* Closed Captions button styling */
  .video-js .vjs-subs-caps-button {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  .video-js .vjs-subs-caps-button .vjs-menu {
    background: rgba(20, 20, 20, 0.98);
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    padding: 8px 0;
  }
  .video-js .vjs-subs-caps-button .vjs-menu li {
    padding: 12px 20px;
    font-size: 14px;
    color: #fff;
    cursor: pointer;
  }
  .video-js .vjs-subs-caps-button .vjs-menu li:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .video-js .vjs-subs-caps-button .vjs-menu li.vjs-selected {
    background: rgba(255, 255, 255, 0.15);
  }
  
  /* Picture-in-Picture button - hidden */
  .video-js .vjs-control-bar > .vjs-picture-in-picture-control {
    display: none !important;
    visibility: hidden !important;
  }
  .video-js .vjs-control-bar > .vjs-fullscreen-control {
    order: 8;
    margin-left: 4px;
  }
  /* Ensure all buttons are visible and properly sized */
  .video-js .vjs-control-bar .vjs-button {
    width: auto;
    min-width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    border-radius: 2px;
    transition: background-color 0.2s;
  }
  .video-js .vjs-control-bar .vjs-button:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
  /* Hide chapters and descriptions if not available */
  .video-js .vjs-chapters-button:not(.vjs-hidden),
  .video-js .vjs-descriptions-button:not(.vjs-hidden) {
    display: none;
  }
  /* Hide audio track button if not needed */
  .video-js .vjs-audio-button:not(.vjs-hidden) {
    display: none;
  }
  /* Control bar positioning */
  .video-js .vjs-control-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 5;
  }
  /* Better volume control styling */
  .video-js .vjs-volume-panel {
    order: 1;
    margin-right: 8px;
  }
  .video-js .vjs-volume-panel .vjs-volume-control {
    width: 80px;
    margin-right: 8px;
  }
  /* Hide scrollbar in all Video.js menus */
  .video-js .vjs-menu {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }
  .video-js .vjs-menu::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
  .video-js .vjs-menu-content {
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
  }
  .video-js .vjs-menu-content::-webkit-scrollbar {
    display: none; /* Chrome, Safari, Opera */
  }
  /* Fade in animation for pause button */
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  /* Professional big play button - Modern circular style */
  .video-js .vjs-big-play-button {
    width: 80px;
    height: 80px;
    line-height: 80px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    border: 3px solid rgba(255, 255, 255, 0.9);
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    transform: translate(-50%, -50%) !important;
    margin: 0 !important;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    backdrop-filter: blur(10px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    cursor: pointer !important;
    pointer-events: auto !important;
    display: block !important;
    visibility: visible !important;
    z-index: 100 !important;
  }
  .video-js .vjs-big-play-button:hover {
    background: rgba(0, 0, 0, 0.85);
    border-color: #fff;
    transform: translate(-50%, -50%) scale(1.1);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  }
  .video-js .vjs-big-play-button:active {
    transform: translate(-50%, -50%) scale(0.95);
  }
  /* Hide big play button when playing */
  .video-js.vjs-playing .vjs-big-play-button {
    display: none !important;
  }
  /* Show big play button when paused */
  .video-js.vjs-paused .vjs-big-play-button {
    display: block !important;
  }
  .video-js .vjs-big-play-button .vjs-icon-placeholder:before {
    font-size: 32px;
    color: #fff;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  /* Always show controls - YouTube style */
  .video-js.vjs-user-inactive .vjs-control-bar {
    opacity: 1 !important; /* Always visible */
    transition: none;
  }
  .video-js.vjs-user-active .vjs-control-bar {
    opacity: 1 !important;
    transition: none;
  }
  /* Quality selector styling */
  .video-js .vjs-menu-button-popup .vjs-menu {
    background: rgba(0, 0, 0, 0.95);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: 4px 0;
    min-width: 140px;
  }
  .video-js .vjs-menu li {
    color: #fff;
    padding: 10px 20px;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 0.2s;
    text-align: center;
  }
  .video-js .vjs-menu li:hover,
  .video-js .vjs-menu li.vjs-selected {
    background: rgba(255, 255, 255, 0.15);
  }
  
  /* Playback Rate Menu Button Styling */
  .video-js .vjs-playback-rate {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    cursor: pointer !important;
    margin-left: 8px !important;
  }
  .video-js .vjs-playback-rate .vjs-menu-button {
    width: auto;
    min-width: 60px;
  }
  .video-js .vjs-playback-rate .vjs-menu-button .vjs-menu-button-popup {
    background: rgba(0, 0, 0, 0.95);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: 4px 0;
    min-width: 120px;
  }
  .video-js .vjs-playback-rate .vjs-menu li {
    padding: 10px 20px;
    color: #fff;
    font-size: 14px;
    text-align: center;
  }
  .video-js .vjs-playback-rate .vjs-menu li:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  
  /* Quality Level Selector Styling */
  .video-js .vjs-hls-quality-selector {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    cursor: pointer !important;
    margin-left: 8px !important;
  }
  .video-js .vjs-hls-quality-selector .vjs-menu-button {
    width: auto;
    min-width: 80px;
  }
  .video-js .vjs-hls-quality-selector .vjs-menu-button .vjs-menu-button-popup {
    background: rgba(0, 0, 0, 0.95);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: 4px 0;
    min-width: 140px;
  }
  .video-js .vjs-hls-quality-selector .vjs-menu li {
    padding: 10px 20px;
    color: #fff;
    font-size: 14px;
    text-align: center;
  }
  .video-js .vjs-hls-quality-selector .vjs-menu li:hover {
    background: rgba(255, 255, 255, 0.15);
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.textContent = videoPlayerStyles;
  document.head.appendChild(styleSheet);
}

/**
 * Video.js Player Component
 * 
 * Features:
 * - Video.js player with professional controls
 * - HLS streaming support (.m3u8)
 * - Quality selector for HLS streams (if available)
 * - Captions/subtitles support (.vtt)
 * - Download disabled
 * - Right-click disabled
 * - Picture-in-picture disabled
 * - Responsive 16:9 design
 * - Clean and minimal UI
 * 
 * @param {string} src - Video URL to stream
 * @param {Array} captions - Array of caption objects (optional)
 * @param {boolean} autoplay - Whether to autoplay video (default: false)
 * @param {string} poster - Poster image URL (optional)
 * @param {string} videoId - Video ID for diagnostics (optional)
 */
function VideoPlayer({ src, captions = [], autoplay = false, poster = null, videoId = null }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const containerRef = useRef(null);
  
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showPauseButton, setShowPauseButton] = useState(false);
  const pauseButtonTimeoutRef = useRef(null);

  // Check if URL is a mock Cloudflare URL - MUST match StreamPage's detection exactly
  const isMockUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const urlLower = url.toLowerCase();
    return urlLower.includes('your-account.r2.cloudflarestorage.com') ||
           urlLower.includes('r2.cloudflarestorage.com') ||
           urlLower.includes('mock-cloudflare.example.com') ||
           (urlLower.includes('example.com') && !urlLower.includes('pub-')) ||
           urlLower.includes('test.cloudflare') ||
           (urlLower.includes('cloudflare.com/') && !urlLower.includes('pub-')) ||
           urlLower.includes('cloudflarestorage.com');
  };

  // NEVER use mock URLs - StreamPage should have converted them
  const safeSrc = src && isMockUrl(src) ? null : src;

  // Detect if URL is HLS stream
  const isHLSStream = (url) => {
    return url && (url.includes('.m3u8') || url.includes('application/vnd.apple.mpegurl'));
  };

  // Extract video ID from URL (e.g., /s/videoId or /stream/videoId)
  const extractVideoIdFromUrl = (url) => {
    if (!url) return null;
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      // Check for /s/:slug or /stream/:videoId patterns
      if (pathParts[0] === 's' && pathParts[1]) {
        return pathParts[1];
      }
      if (pathParts[0] === 'stream' && pathParts[1]) {
        return pathParts[1];
      }
      // Try to extract from any path segment
      return pathParts[pathParts.length - 1] || null;
    } catch {
      // If URL parsing fails, try regex
      const match = url.match(/\/(?:s|stream)\/([^\/\?]+)/);
      return match ? match[1] : null;
    }
  };

  useEffect(() => {
    // Safety check: don't initialize if no valid source
    if (!src || !safeSrc) {
      setLoading(false);
      if (!src) {
        setError({ message: 'No video source provided' });
      } else if (isMockUrl(src)) {
        setError({ message: 'Invalid video URL. Please contact support.' });
      }
      return;
    }

    // Don't initialize if container ref is not ready
    if (!containerRef.current) {
      return;
    }

    // Initialize Video.js player
    const videoElement = document.createElement('video');
    videoElement.className = 'video-js vjs-default-skin vjs-big-play-centered';
    videoElement.setAttribute('controls', '');
    videoElement.setAttribute('preload', 'auto');
    videoElement.setAttribute('playsinline', '');
    videoElement.setAttribute('controlsList', 'nodownload');
    videoElement.disablePictureInPicture = true;
    
    if (poster) {
      videoElement.setAttribute('poster', poster);
    }

    // Clear container and add video element
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(videoElement);

    // Initialize Video.js with YouTube-like features
    const player = videojs(videoElement, {
      fluid: false,
      responsive: false,
      controls: true,
      preload: 'auto',
      autoplay: autoplay,
      liveui: true, // Enable live UI for live streams
      controlBar: {
        children: [
          // Removed: playToggle (play/pause button)
          'volumePanel', // Volume control
          'progressControl', // Progress bar
          'liveDisplay',
          'remainingTimeDisplay',
          'spacer', // Flexible spacer to push controls to right
          'subsCapsButton', // Closed Captions/Subtitles button
          'fullscreenToggle' // Fullscreen
          // Removed: 'currentTimeDisplay', 'timeDivider', 'durationDisplay' (Time display)
          // Removed: 'playbackRateMenuButton' (now in settings menu)
          // Removed: 'pictureInPictureToggle' (not needed)
        ]
      },
      html5: {
        vhs: {
          overrideNative: true,
          enableLowInitialPlaylist: true,
          smoothQualityChange: true,
          handleManifestRedirects: true
        },
        nativeVideoTracks: false,
        nativeAudioTracks: false,
        nativeTextTracks: false
      },
      // YouTube-like settings - keep controls visible
      inactivityTimeout: 0, // Never hide controls (0 = always visible)
      userActions: {
        hotkeys: true // Enable hotkeys
      }
    }, () => {
      // Callback after player is ready
      console.log('Video.js initialized');
    });

    playerRef.current = player;
    setLoading(true);
    setError(null);

    // Set video source with cache-busting to ensure new videos load after replacement
    // Always add timestamp to URL to force browser to fetch new version
    let videoSrc = safeSrc;
    if (videoSrc) {
      try {
        // Parse URL and add/update cache-busting parameter
        const url = new URL(videoSrc);
        url.searchParams.set('t', Date.now().toString()); // Always update timestamp
        videoSrc = url.toString();
      } catch (e) {
        // If URL parsing fails (relative URL), append query parameter
        const separator = videoSrc.includes('?') ? '&' : '?';
        videoSrc = `${videoSrc}${separator}t=${Date.now()}`;
      }
    }
    
    const sourceType = isHLSStream(safeSrc) ? 'application/x-mpegURL' : 'video/mp4';
    
    // Always set source and load to ensure new videos play after replacement
    console.log('[VideoPlayer] Setting video source:', videoSrc);
    player.src({
      src: videoSrc,
      type: sourceType
    });
    
    // Force reload to ensure new video is loaded (important after replacement)
    player.load();

    // Event handlers
    player.ready(() => {
      console.log('Video.js player ready');
      setLoading(false);

      // Make sure player fills container
      const playerEl = player.el();
      if (playerEl) {
        playerEl.style.position = 'absolute';
        playerEl.style.top = '0';
        playerEl.style.left = '0';
        playerEl.style.width = '100%';
        playerEl.style.height = '100%';
        playerEl.style.objectFit = 'contain';
      }

      // Fix Big Play Button - ensure it works
     

      // Ensure video element also fills and configure security
      const videoEl = player.el().querySelector('video');
      if (videoEl) {
        videoEl.style.width = '100%';
        videoEl.style.height = '100%';
        videoEl.style.objectFit = 'contain';
        
        // Disable right-click on video element
        videoEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          return false;
        });

        // Note: We keep PiP button visible but disable the actual PiP functionality
        // This matches YouTube's behavior where the button is visible but may be disabled
        if (videoEl.disablePictureInPicture !== undefined) {
          videoEl.disablePictureInPicture = true;
        }

        // Remove download attribute
        videoEl.removeAttribute('download');
        videoEl.setAttribute('controlsList', 'nodownload noplaybackrate');
      }

      // Ensure all control buttons are visible and properly styled
      const controlBar = player.controlBar;
      if (controlBar) {
        // Show captions button if captions are available
        const captionsBtn = controlBar.getChild('subsCapsButton');
        if (captionsBtn) {
          if (captions && captions.length > 0) {
            captionsBtn.show();
            console.log(`[VideoPlayer] Showing CC button - ${captions.length} caption(s) available`);
          } else {
            captionsBtn.hide();
            console.log('[VideoPlayer] Hiding CC button - no captions available');
          }
        } else {
          console.warn('[VideoPlayer] CC button not found in control bar');
        }

        // Hide Picture-in-Picture button (removed)
        const pipBtn = controlBar.getChild('pictureInPictureToggle');
        if (pipBtn) {
          pipBtn.hide();
        }

        // Show fullscreen button
        const fullscreenBtn = controlBar.getChild('fullscreenToggle');
        if (fullscreenBtn) {
          fullscreenBtn.show();
        }

        // Ensure volume panel is visible and working
        const volumePanel = controlBar.getChild('volumePanel');
        if (volumePanel) {
          volumePanel.show();
          
          // Ensure volume controls are clickable
          const volumeEl = volumePanel.el();
          if (volumeEl) {
            volumeEl.style.pointerEvents = 'auto';
            volumeEl.style.cursor = 'pointer';
            
            // Get volume button and slider
            const volumeButton = volumePanel.getChild('volumeControl');
            if (volumeButton) {
              const volumeBtnEl = volumeButton.el();
              if (volumeBtnEl) {
                volumeBtnEl.style.pointerEvents = 'auto';
                volumeBtnEl.style.cursor = 'pointer';
              }
            }
          }
        }
      }

      // YouTube-like keyboard shortcuts
      const handleKeyDown = (e) => {
        // Prevent download shortcuts
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
          e.preventDefault();
          return;
        }

        // Only handle shortcuts when video player is focused or video is playing
        const isPlayerFocused = document.activeElement === player.el() || 
                               player.el().contains(document.activeElement) ||
                               !document.activeElement || 
                               document.activeElement.tagName === 'BODY';

        if (!isPlayerFocused && !player.paused()) {
          // Allow shortcuts even if not focused when video is playing
        } else if (!isPlayerFocused) {
          return; // Don't handle shortcuts if player is not focused
        }

        // Space bar: Play/Pause
        if (e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          if (player.paused()) {
            player.play();
          } else {
            player.pause();
          }
        }
        // Arrow Left: Rewind 10 seconds
        else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          player.currentTime(Math.max(0, player.currentTime() - 10));
        }
        // Arrow Right: Forward 10 seconds
        else if (e.key === 'ArrowRight') {
          e.preventDefault();
          player.currentTime(Math.min(player.duration(), player.currentTime() + 10));
        }
        // Arrow Up: Increase volume
        else if (e.key === 'ArrowUp') {
          e.preventDefault();
          player.volume(Math.min(1, player.volume() + 0.1));
        }
        // Arrow Down: Decrease volume
        else if (e.key === 'ArrowDown') {
          e.preventDefault();
          player.volume(Math.max(0, player.volume() - 0.1));
        }
        // M key: Mute/Unmute
        else if (e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          player.muted(!player.muted());
        }
        // F key: Fullscreen
        else if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          if (player.isFullscreen()) {
            player.exitFullscreen();
          } else {
            player.requestFullscreen();
          }
        }
        // K key: Play/Pause (YouTube style)
        else if (e.key === 'k' || e.key === 'K') {
          e.preventDefault();
          if (player.paused()) {
            player.play();
          } else {
            player.pause();
          }
        }
        // Number keys 0-9: Jump to percentage (0=0%, 1=10%, ..., 9=90%)
        else if (e.key >= '0' && e.key <= '9') {
          e.preventDefault();
          const percentage = parseInt(e.key) / 10;
          if (player.duration()) {
            player.currentTime(player.duration() * percentage);
          }
        }
      };
      document.addEventListener('keydown', handleKeyDown);

      // Store handler for cleanup
      player._keydownHandler = handleKeyDown;

      // Handle video click to show pause button
      const handleVideoClick = () => {
        if (player.paused()) {
          player.play();
        } else {
          player.pause();
        }
        
        // Show pause button when clicking (if playing)
        if (!player.paused()) {
          showPauseButtonWithTimeout();
        }
      };

      // Add click handler to video element (reuse videoEl from above)
      if (videoEl) {
        videoEl.addEventListener('click', handleVideoClick);
        player._videoClickHandler = handleVideoClick;
      }

      // Handle mouse enter/leave on video container to show/hide pause button (reuse playerEl from above)
      if (playerEl) {
        const handleMouseEnter = () => {
          // Show pause button when mouse enters (only if playing)
          if (!player.paused()) {
            showPauseButtonWithTimeout();
          }
        };

        const handleMouseLeave = () => {
          // Hide pause button after 2 seconds when mouse leaves
          if (pauseButtonTimeoutRef.current) {
            clearTimeout(pauseButtonTimeoutRef.current);
          }
          pauseButtonTimeoutRef.current = setTimeout(() => {
            setShowPauseButton(false);
          }, 2000);
        };

        playerEl.addEventListener('mouseenter', handleMouseEnter);
        playerEl.addEventListener('mouseleave', handleMouseLeave);
        
        player._mouseEnterHandler = handleMouseEnter;
        player._mouseLeaveHandler = handleMouseLeave;
      }
    });

    // Quality levels are now handled in the settings menu
    // No need to create separate quality selector button
    
    // Load captions/subtitles if available
    const loadCaptions = () => {
      console.log('[VideoPlayer] loadCaptions called, captions:', captions);
      
      if (captions && captions.length > 0) {
        const backendUrl = getBackendBaseUrl();
        
        console.log(`[VideoPlayer] Loading ${captions.length} caption track(s)...`);
        console.log(`[VideoPlayer] Backend URL: ${backendUrl}`);
        
        // Clear existing text tracks first
        const existingTracks = player.textTracks();
        for (let i = existingTracks.length - 1; i >= 0; i--) {
          const track = existingTracks[i];
          if (track.kind === 'captions' || track.kind === 'subtitles') {
            player.removeRemoteTextTrack(track);
          }
        }
        
        captions.forEach((caption, index) => {
          if (caption.file_path) {
            // Construct full URL for caption file
            let captionUrl = caption.file_path;
            
            console.log(`[VideoPlayer] Processing caption ${index + 1}:`, {
              file_path: caption.file_path,
              language: caption.language,
              originalUrl: captionUrl
            });
            
            // If it's a relative path, make it absolute
            if (!captionUrl.startsWith('http://') && !captionUrl.startsWith('https://')) {
              // Remove leading slash if present
              if (captionUrl.startsWith('/')) {
                captionUrl = captionUrl.substring(1);
              }
              if (captionUrl.startsWith('captions/')) {
                captionUrl = `${backendUrl}/video-storage/${captionUrl}`;
              } else if (captionUrl.startsWith('upload/')) {
                captionUrl = `${backendUrl}/${captionUrl}`;
              } else if (captionUrl.startsWith('my-storage/') || captionUrl.startsWith('misc/')) {
                captionUrl = `${backendUrl}/video-storage/${captionUrl}`;
              } else {
                captionUrl = `${backendUrl}/video-storage/${captionUrl}`;
              }
            }
            
            console.log(`[VideoPlayer] Final caption URL: ${captionUrl}`);
            
            // Add text track to player
            try {
              const textTrack = player.addRemoteTextTrack({
                kind: 'captions',
                src: captionUrl,
                srclang: caption.language || 'en',
                label: caption.language ? `${caption.language.toUpperCase()}` : 'English',
                default: caption.language === 'en' || index === 0
              }, false); // false = don't add to DOM immediately
              
              console.log(`[VideoPlayer] ✓ Added caption track: ${caption.language} from ${captionUrl}`);
            } catch (error) {
              console.error(`[VideoPlayer] ✗ Failed to add caption track:`, error);
            }
          } else {
            console.warn(`[VideoPlayer] Caption ${index + 1} has no file_path:`, caption);
          }
        });
        
        // Enable the first caption track by default if available
        setTimeout(() => {
          const textTracks = player.textTracks();
          console.log(`[VideoPlayer] Text tracks available: ${textTracks.length}`);
          
          if (textTracks && textTracks.length > 0) {
            Array.from(textTracks).forEach((track, idx) => {
              console.log(`[VideoPlayer] Track ${idx + 1}:`, {
                kind: track.kind,
                language: track.language,
                label: track.label,
                mode: track.mode,
                default: track.default,
                src: track.src || 'N/A'
              });
            });
            
            const defaultTrack = Array.from(textTracks).find(track => track.default) || textTracks[0];
            if (defaultTrack) {
              defaultTrack.mode = 'showing';
              console.log(`[VideoPlayer] ✓ Enabled default caption track: ${defaultTrack.language}`);
            }
          } else {
            console.warn('[VideoPlayer] No text tracks found after loading captions');
          }
        }, 1500);
      } else {
        console.log('[VideoPlayer] No captions available for this video');
      }
    };
    
    // Load captions when player is ready and after source is set
    const readyHandler = () => {
      console.log('[VideoPlayer] Player ready, loading captions...');
      // Wait a bit for the video source to be set
      setTimeout(() => {
        loadCaptions();
      }, 500);
    };
    
    player.ready(readyHandler);
    
    // Also load captions when video metadata is loaded (in case ready fires too early)
    player.on('loadedmetadata', () => {
      console.log('[VideoPlayer] Metadata loaded, loading captions...');
      loadCaptions();
    });
    
    // Reload captions if captions prop changes
    if (playerRef.current && captions) {
      console.log('[VideoPlayer] Captions prop changed, reloading...');
      setTimeout(() => {
        loadCaptions();
      }, 1000);
    }

    player.on('loadstart', () => {
      console.log('Video: Load started');
      setLoading(true);
    });

    player.on('loadedmetadata', () => {
      console.log('Video: Metadata loaded');
      setLoading(false);
    });

    player.on('canplay', () => {
      console.log('Video: Can start playing');
      setLoading(false);
    });

    player.on('waiting', () => {
      console.log('Video: Buffering...');
      setLoading(true);
    });

    // Helper function to show pause button and auto-hide after 2 seconds
    const showPauseButtonWithTimeout = () => {
      // Only show if video is playing (check player state directly)
      if (player.paused()) return;
      
      setShowPauseButton(true);
      
      // Clear existing timeout
      if (pauseButtonTimeoutRef.current) {
        clearTimeout(pauseButtonTimeoutRef.current);
      }
      
      // Hide after 2 seconds
      pauseButtonTimeoutRef.current = setTimeout(() => {
        setShowPauseButton(false);
      }, 2000);
    };

    player.on('playing', () => {
      console.log('Video: Playing');
      setLoading(false);
      setIsPlaying(true);
      
      // Show pause button when video starts playing, then auto-hide after 2 seconds
      showPauseButtonWithTimeout();
      
      // Increment view count when video starts playing (only once per session)
      if (videoId && !player._viewCounted) {
        player._viewCounted = true; // Prevent multiple counts in same session
        incrementViewCount(videoId).catch(err => {
          console.warn('Failed to increment view count:', err);
        });
      }
    });

    player.on('pause', () => {
      console.log('Video: Paused');
      setIsPlaying(false);
      setShowPauseButton(false);
      // Clear timeout when paused
      if (pauseButtonTimeoutRef.current) {
        clearTimeout(pauseButtonTimeoutRef.current);
      }
    });

    player.on('play', () => {
      console.log('Video: Play');
      setIsPlaying(true);
      // Show pause button when play is triggered, then auto-hide after 2 seconds
      showPauseButtonWithTimeout();
    });

    // YouTube-like features: Show time on hover over progress bar
    player.on('loadedmetadata', () => {
      const progressControl = player.controlBar.getChild('progressControl');
      if (progressControl) {
        const seekBar = progressControl.getChild('seekBar');
        if (seekBar) {
          const seekBarEl = seekBar.el();
          if (seekBarEl) {
            // Add tooltip for time preview
            seekBarEl.addEventListener('mousemove', (e) => {
              const rect = seekBarEl.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              const time = percent * player.duration();
              
              // Create or update tooltip
              let tooltip = seekBarEl.querySelector('.vjs-time-tooltip');
              if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'vjs-time-tooltip';
                tooltip.style.cssText = `
                  position: absolute;
                  bottom: 100%;
                  left: 50%;
                  transform: translateX(-50%);
                  background: rgba(0, 0, 0, 0.8);
                  color: white;
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 12px;
                  white-space: nowrap;
                  pointer-events: none;
                  margin-bottom: 8px;
                  z-index: 1000;
                `;
                seekBarEl.style.position = 'relative';
                seekBarEl.appendChild(tooltip);
              }
              
              const minutes = Math.floor(time / 60);
              const seconds = Math.floor(time % 60);
              tooltip.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
              tooltip.style.left = `${percent * 100}%`;
              tooltip.style.display = 'block';
            });
            
            seekBarEl.addEventListener('mouseleave', () => {
              const tooltip = seekBarEl.querySelector('.vjs-time-tooltip');
              if (tooltip) {
                tooltip.style.display = 'none';
              }
            });
          }
        }
      }
    });

    player.on('error', () => {
      const playerError = player.error();
      console.error('Video.js error:', playerError);
      
      let errorMessage = 'Failed to load video';
      if (playerError) {
        switch (playerError.code) {
          case 1: // MEDIA_ERR_ABORTED
            errorMessage = 'Video loading aborted';
            break;
          case 2: // MEDIA_ERR_NETWORK
            errorMessage = 'Network error while loading video. The video URL may be inaccessible or the server may be down.';
            break;
          case 3: // MEDIA_ERR_DECODE
            errorMessage = 'Video decoding error. The video file may be corrupted.';
            break;
          case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
            if (safeSrc && (safeSrc.includes('localhost') || safeSrc.includes('127.0.0.1'))) {
              errorMessage = 'Video format not supported or file may be missing. Please check if the video file exists on the server.';
            } else {
              errorMessage = 'Video format not supported. The video file may be missing or corrupted.';
            }
            break;
          default:
            errorMessage = `Video error (code: ${playerError.code})`;
        }
      }
      
      setError({ message: errorMessage });
      setLoading(false);
    });

    // Cleanup function
    return () => {
      // Clear pause button timeout
      if (pauseButtonTimeoutRef.current) {
        clearTimeout(pauseButtonTimeoutRef.current);
      }
      
      if (playerRef.current) {
        // Remove video click handler
        if (playerRef.current._videoClickHandler) {
          const videoEl = playerRef.current.el()?.querySelector('video');
          if (videoEl) {
            videoEl.removeEventListener('click', playerRef.current._videoClickHandler);
          }
        }
        
        // Remove mouse enter/leave handlers
        const playerEl = playerRef.current.el();
        if (playerEl) {
          if (playerRef.current._mouseEnterHandler) {
            playerEl.removeEventListener('mouseenter', playerRef.current._mouseEnterHandler);
          }
          if (playerRef.current._mouseLeaveHandler) {
            playerEl.removeEventListener('mouseleave', playerRef.current._mouseLeaveHandler);
          }
        }
        
        // Remove keydown handler
        if (playerRef.current._keydownHandler) {
          document.removeEventListener('keydown', playerRef.current._keydownHandler);
        }
        
        // Dispose Video.js player
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [src, safeSrc, captions, autoplay, poster]);

  if (!src) {
    return (
      <div className="w-full h-96 bg-gray-900 flex items-center justify-center text-white rounded-lg">
        <p>No video source provided</p>
      </div>
    );
  }

  return (
    <div className="w-full relative bg-black rounded-lg overflow-hidden">
      {/* Loading indicator */}
      {loading && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white">Loading video...</p>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && !(src && isMockUrl(src)) && (
        <div className="absolute inset-0 bg-red-900 bg-opacity-90 flex items-center justify-center z-10">
          <div className="text-center max-w-md p-4">
            <p className="font-bold mb-2 text-lg text-white">Video Error</p>
            <p className="text-sm text-white mb-4">{error.message}</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  if (playerRef.current) {
                    playerRef.current.load();
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm text-white transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => setShowDiagnostic(true)}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded text-sm text-white transition-colors flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4" />
                Diagnose
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostic Modal */}
      {showDiagnostic && (
        <VideoDiagnostic
          videoId={videoId || (src ? extractVideoIdFromUrl(src) : null)}
          streamUrl={src}
          onClose={() => setShowDiagnostic(false)}
        />
      )}

      {/* Video.js container with 16:9 aspect ratio - compact size */}
      <div 
        ref={containerRef}
        className="w-full relative"
        style={{ 
          paddingTop: '56.25%',
          maxWidth: '900px',
          maxHeight: '400px',
          margin: '0 auto'
        }}
      />

      {/* Custom Pause Button - Shows when playing, auto-hides after 2 seconds, shows on mouseover/click */}
      {isPlaying && showPauseButton && (
        <div 
          className="absolute inset-0 flex items-center justify-center z-20"
          style={{ 
            pointerEvents: 'none',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (playerRef.current) {
                playerRef.current.pause();
              }
            }}
            className="pause-button-overlay"
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(0, 0, 0, 0.7)',
              border: '3px solid rgba(255, 255, 255, 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
              transition: 'opacity 0.3s ease-in-out, transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              cursor: 'pointer',
              pointerEvents: 'auto',
              opacity: 1,
              animation: 'fadeIn 0.2s ease-in',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.85)';
              // Cancel auto-hide on hover
              if (pauseButtonTimeoutRef.current) {
                clearTimeout(pauseButtonTimeoutRef.current);
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)';
              // Restart auto-hide timer when mouse leaves
              if (pauseButtonTimeoutRef.current) {
                clearTimeout(pauseButtonTimeoutRef.current);
              }
              pauseButtonTimeoutRef.current = setTimeout(() => {
                setShowPauseButton(false);
              }, 2000);
            }}
          >
            <Pause className="w-8 h-8 text-white" fill="white" />
          </button>
        </div>
      )}
    </div>
  );
}

export default VideoPlayer;
