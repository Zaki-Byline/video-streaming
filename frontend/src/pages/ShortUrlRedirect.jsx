import { useEffect, useState, Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import api from '../services/api';
import { getBackendBaseUrl } from '../utils/apiConfig';

const SimpleVideoPlayer = lazy(() => import('../components/SimpleVideoPlayer'));

function ShortUrlRedirect() {
  const { slug } = useParams();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerError, setPlayerError] = useState(null);

  // Security: Disable right-click, developer tools, and keyboard shortcuts
  useEffect(() => {
    // Disable right-click
    const handleContextMenu = (e) => {
      e.preventDefault();
      return false;
    };

    // Disable developer tools shortcuts
    const handleKeyDown = (e) => {
      // Disable F12 (Developer Tools)
      if (e.key === 'F12') {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+Shift+I (Developer Tools)
      if (e.ctrlKey && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+Shift+J (Console)
      if (e.ctrlKey && e.shiftKey && e.key === 'J') {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+Shift+C (Inspect Element)
      if (e.ctrlKey && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+U (View Source)
      if (e.ctrlKey && e.key === 'U') {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+S (Save Page)
      if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+P (Print)
      if (e.ctrlKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        return false;
      }
      // Disable Ctrl+Shift+P (Command Palette in DevTools)
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        return false;
      }
    };

    // Disable text selection
    const handleSelectStart = (e) => {
      e.preventDefault();
      return false;
    };

    // Disable drag
    const handleDragStart = (e) => {
      e.preventDefault();
      return false;
    };

    // Add event listeners
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('selectstart', handleSelectStart);
    document.addEventListener('dragstart', handleDragStart);

    // Disable developer tools detection
    const devtools = {
      open: false,
      orientation: null
    };
    const threshold = 160;
    setInterval(() => {
      if (window.outerHeight - window.innerHeight > threshold || 
          window.outerWidth - window.innerWidth > threshold) {
        if (!devtools.open) {
          devtools.open = true;
          // Optionally redirect or show warning
          console.clear();
        }
      } else {
        devtools.open = false;
      }
    }, 500);

    // Cleanup
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('selectstart', handleSelectStart);
      document.removeEventListener('dragstart', handleDragStart);
    };
  }, []);

  useEffect(() => {
    if (!slug) {
      setError('Invalid URL');
      setLoading(false);
      return;
    }

    const fetchVideo = async () => {
      try {
        let videoData = null;
        
        try {
          const redirectResponse = await api.get(`/videos/redirect-info/${slug}`);
          if (redirectResponse.data && redirectResponse.data.video) {
            videoData = redirectResponse.data.video;
          } else if (redirectResponse.data && redirectResponse.data.target_url) {
            const targetUrl = redirectResponse.data.target_url;
            const url = new URL(targetUrl);
            const pathParts = url.pathname.split('/');
            const videoId = pathParts[pathParts.length - 1];
            
            const videoResponse = await api.get(`/videos/${videoId}`);
            if (videoResponse.data) {
              videoData = videoResponse.data;
            }
          }
        } catch (redirectErr) {
          console.log('Redirect info lookup failed, trying direct video lookup...', redirectErr);
        }

        if (!videoData) {
          try {
            const videoResponse = await api.get(`/videos/${slug}`);
            if (videoResponse.data) {
              videoData = videoResponse.data;
            }
          } catch (videoErr) {
            console.log('Direct video lookup failed:', videoErr);
          }
        }

        if (!videoData) {
          setError('Video not found');
          setLoading(false);
          return;
        }

        if (videoData.status === 'deleted') {
          setError('Video not found');
          setLoading(false);
          return;
        }

        // Ensure captions array exists (even if empty)
        if (!Array.isArray(videoData.captions)) {
          videoData.captions = [];
        }
        
        // Fetch captions if not already included or if array is empty
        if ((!videoData.captions || videoData.captions.length === 0) && videoData.video_id) {
          try {
            console.log(`[ShortUrlRedirect] 🔍 Fetching captions for video_id: ${videoData.video_id}`);
            const captionsResponse = await api.get(`/captions/${videoData.video_id}`);
            if (captionsResponse.data && Array.isArray(captionsResponse.data)) {
              videoData.captions = captionsResponse.data;
              console.log(`[ShortUrlRedirect] ✅ Loaded ${captionsResponse.data.length} caption(s) for video ${videoData.video_id}`);
              captionsResponse.data.forEach((cap, idx) => {
                console.log(`[ShortUrlRedirect]   Caption ${idx + 1}:`, {
                  language: cap.language,
                  file_path: cap.file_path
                });
              });
            } else {
              console.log(`[ShortUrlRedirect] ⚠️ Captions response is not an array:`, captionsResponse.data);
              videoData.captions = [];
            }
          } catch (captionErr) {
            console.warn('[ShortUrlRedirect] ⚠️ Could not fetch captions:', captionErr);
            videoData.captions = [];
          }
        } else {
          console.log(`[ShortUrlRedirect] ✅ Video already has ${videoData.captions.length} caption(s)`);
        }

        console.log(`[ShortUrlRedirect] 📤 Setting video state with ${videoData.captions.length} caption(s)`);
        setVideo(videoData);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching video:', err);
        setError(err.response?.data?.error || 'Failed to load video');
        setLoading(false);
      }
    };

    fetchVideo();
  }, [slug]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center" style={{ userSelect: 'none' }}>
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-pulse" />
            </div>
          </div>
          <p className="mt-6 text-white text-lg font-medium">Loading video...</p>
          <p className="mt-2 text-gray-400 text-sm">Please wait while we prepare your content</p>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center p-4" style={{ userSelect: 'none' }}>
        <div className="bg-gray-900 rounded-2xl shadow-xl border border-gray-700 p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-900 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-red-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3">Video Not Found</h1>
          <p className="text-gray-300 mb-6">{error || 'The video you are looking for could not be found.'}</p>
          <p className="text-gray-500 text-sm">Please check the video link or contact support if the problem persists.</p>
        </div>
      </div>
    );
  }

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
  
  const cloudflareUrl = video.streaming_url || video.file_path;
  const isCloudflareUrl = cloudflareUrl && (cloudflareUrl.startsWith('http://') || cloudflareUrl.startsWith('https://'));
  const isMock = cloudflareUrl ? isMockUrl(cloudflareUrl) : false;
  
  let streamingUrl;
  
  const backendUrl = getBackendBaseUrl();
  const streamIdentifier = video.redirect_slug || video.video_id;
  
  if (isMock) {
    streamingUrl = `${backendUrl}/s/${streamIdentifier}`;
  } else if (isCloudflareUrl && !isMock) {
    if (isMockUrl(cloudflareUrl)) {
      streamingUrl = `${backendUrl}/s/${streamIdentifier}`;
    } else {
      streamingUrl = cloudflareUrl;
    }
  } else {
    streamingUrl = `${backendUrl}/s/${streamIdentifier}`;
  }
  
  if (streamingUrl && isMockUrl(streamingUrl)) {
    streamingUrl = `${backendUrl}/s/${streamIdentifier}`;
  }

  return (
    <>
      <style>{`
        /* Fullscreen styles */
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: #000;
          user-select: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
        }
        
        /* Hide scrollbars */
        ::-webkit-scrollbar {
          display: none;
        }
        
        html {
          overflow: hidden;
          height: 100%;
        }
        
        #root {
          height: 100vh;
          overflow: hidden;
        }
        
        /* Ensure video player controls are visible in fullscreen */
        .video-js {
          width: 100% !important;
          height: 100% !important;
          background: #000 !important;
        }
        
        /* Custom scrollbar for subject information panel */
        .subject-info-panel::-webkit-scrollbar {
          width: 6px;
        }
        .subject-info-panel::-webkit-scrollbar-track {
          background: #1a1a1a;
        }
        .subject-info-panel::-webkit-scrollbar-thumb {
          background: #4a4a4a;
          border-radius: 3px;
        }
        .subject-info-panel::-webkit-scrollbar-thumb:hover {
          background: #5a5a5a;
        }
        
        .video-js .vjs-control-bar {
          opacity: 1 !important;
          visibility: visible !important;
          display: flex !important;
          z-index: 1000 !important;
          position: absolute !important;
          bottom: 0 !important;
          left: 0 !important;
          right: 0 !important;
          background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 50%, transparent 100%) !important;
          height: 52px !important;
          padding: 0 16px !important;
          align-items: center !important;
        }
        
        .video-js.vjs-user-inactive .vjs-control-bar {
          opacity: 1 !important;
          visibility: visible !important;
          display: flex !important;
        }
        
        /* Progress bar at top */
        .video-js .vjs-progress-control {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          width: 100% !important;
          height: 4px !important;
          z-index: 10 !important;
          display: flex !important;
          visibility: visible !important;
          margin: 0 !important;
        }
        
        /* Play/Pause button - properly arranged and working */
        .video-js .vjs-play-control {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          cursor: pointer !important;
          min-width: 40px !important;
          height: 40px !important;
          margin-right: 12px !important;
          order: 1 !important;
        }
        
        /* Volume panel */
        .video-js .vjs-volume-panel {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          margin-right: 12px !important;
          order: 2 !important;
        }
        
        /* Time displays */
        .video-js .vjs-current-time {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          margin-right: 4px !important;
          order: 3 !important;
        }
        .video-js .vjs-time-divider {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          margin: 0 4px !important;
          order: 4 !important;
        }
        .video-js .vjs-duration {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          margin-left: 4px !important;
          order: 5 !important;
        }
        
        /* Right side controls */
        .video-js .vjs-spacer {
          flex: 1 1 auto !important;
          order: 6 !important;
        }
        /* Show playback rate button - make it visible and functional */
        .video-js .vjs-playback-rate {
          display: flex !important; /* Always visible */
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          cursor: pointer !important;
          margin-left: 8px !important;
          order: 6 !important;
        }
        /* Show captions button when captions are available */
        .video-js .vjs-subs-caps-button {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          order: 6 !important;
          margin-left: 8px !important;
        }
        /* Ensure big play button works */
        .video-js .vjs-big-play-button {
          cursor: pointer !important;
          pointer-events: auto !important;
          display: block !important;
          visibility: visible !important;
          z-index: 100 !important;
        }
        /* Hide big play button when playing */
        .video-js.vjs-playing .vjs-big-play-button {
          display: none !important;
        }
        /* Show big play button when paused */
        .video-js.vjs-paused .vjs-big-play-button {
          display: block !important;
        }
        /* Ensure play/pause button works */
        .video-js .vjs-play-control {
          cursor: pointer !important;
          pointer-events: auto !important;
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        /* Ensure volume controls work */
        .video-js .vjs-volume-panel,
        .video-js .vjs-volume-control,
        .video-js .vjs-mute-control {
          cursor: pointer !important;
          pointer-events: auto !important;
          display: flex !important;
          visibility: visible !important;
        }
        .video-js .vjs-picture-in-picture-control {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          margin-left: 4px !important;
          order: 7 !important;
        }
        .video-js .vjs-fullscreen-control {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
          pointer-events: auto !important;
          margin-left: 4px !important;
          order: 8 !important;
        }
        
        /* Ensure playback rate menu is visible */
        .video-js .vjs-playback-rate .vjs-menu {
          display: block !important;
          visibility: visible !important;
        }
        
        /* Ensure buttons are clickable */
        .video-js .vjs-button {
          cursor: pointer !important;
          pointer-events: auto !important;
        }
        
        /* Big play button visibility */
        .video-js .vjs-big-play-button {
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
        }
        
        /* Play/Pause button icon toggle - show pause when playing, play when paused */
        .video-js .vjs-play-control.vjs-playing .vjs-icon-placeholder::before {
          content: "\\f101" !important; /* Pause icon when playing */
        }
        .video-js .vjs-play-control.vjs-paused .vjs-icon-placeholder::before {
          content: "\\f101" !important; /* Play icon when paused */
        }
      `}</style>
      <div 
        className="fixed inset-0 bg-black flex items-center justify-center"
        style={{ 
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden'
        }}
      >
        {streamingUrl && video ? (
          <div className="w-full h-full flex items-center justify-center px-4">
            <div className="w-full max-w-6xl flex flex-col items-center gap-6" style={{ position: 'relative', zIndex: 1 }}>
              {/* Centered video player with 16:9 ratio */}
              <div className="w-full max-w-5xl aspect-video">
                <Suspense fallback={
                  <div className="flex items-center justify-center h-full bg-black">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mx-auto"></div>
                      <p className="mt-3 text-gray-200 text-sm">Loading player...</p>
                    </div>
                  </div>
                }>
                  <SimpleVideoPlayer 
                    src={streamingUrl} 
                    captions={video.captions || []} 
                    autoplay={true}
                    videoId={video.video_id || slug}
                  />
                </Suspense>
              </div>

              {/* Description */}
              <div className="w-full max-w-5xl">
                <div className="text-xs uppercase text-gray-400 mb-2">DESCRIPTION</div>
                <div className="w-full px-3 py-2.5 text-sm text-gray-300 bg-gray-900 border border-gray-700 rounded-lg min-h-[100px]">
                  {video.description && video.description.trim() !== '' ? (
                    <div className="whitespace-pre-wrap break-words">{video.description}</div>
                  ) : (
                    <div className="text-gray-500 italic">No description available</div>
                  )}
                </div>
              </div>

              {/* Error Messages */}
              {playerError && (
                <div className="w-full max-w-5xl bg-red-900 border-l-4 border-red-500 rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-bold text-red-200 mb-2">Error Loading Video</p>
                      <p className="text-red-300 text-sm mb-3">{playerError}</p>
                      <p className="text-red-400 text-xs">Please try refreshing the page or contact support if the problem persists.</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div className="bg-gray-900 rounded-2xl shadow-lg border border-gray-700 p-8 max-w-md mx-auto">
              <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <p className="text-white text-lg font-medium mb-2">Streaming URL Not Available</p>
              <p className="text-gray-400 text-sm">Please contact support if this issue persists.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default ShortUrlRedirect;
