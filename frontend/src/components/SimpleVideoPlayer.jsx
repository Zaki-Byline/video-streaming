/**
 * Simple HTML5 Video Player
 * 
 * A lightweight video player using native HTML5 <video> element
 * with subtitle support via <track> elements.
 * 
 * This replaces the complex Video.js player with a simpler solution
 * that works reliably with subtitles.
 */

import { useEffect, useRef, useState } from 'react';
import { getBackendBaseUrl } from '../utils/apiConfig';

/**
 * Simple HTML5 Video Player Component
 * 
 * @param {string} src - Video source URL
 * @param {Array} captions - Array of caption objects: [{ language, file_path, label }]
 * @param {boolean} autoplay - Whether to autoplay video
 * @param {string} poster - Poster image URL
 * @param {string} videoId - Video ID for view tracking
 */
function SimpleVideoPlayer({ 
  src, 
  captions = [], 
  autoplay = false, 
  poster = null,
  videoId = null 
}) {
  const videoRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const backendUrl = getBackendBaseUrl();

  // Track view count (only once per video)
  useEffect(() => {
    if (!videoId || !videoRef.current) return;

    const hasViewed = () => {
      try {
        const viewed = localStorage.getItem(`video_viewed_${videoId}`);
        return viewed === 'true';
      } catch {
        return false;
      }
    };

    const markViewed = () => {
      try {
        localStorage.setItem(`video_viewed_${videoId}`, 'true');
      } catch {
        // Ignore storage errors
      }
    };

    const incrementView = async () => {
      if (hasViewed()) return;
      
      try {
        const api = (await import('../services/api')).default;
        await api.post(`/videos/${videoId}/increment-views`);
        markViewed();
      } catch (err) {
        console.warn('Could not increment view count:', err.message);
      }
    };

    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => {
      if (!hasViewed()) {
        incrementView();
      }
    };

    video.addEventListener('play', handlePlay);
    return () => video.removeEventListener('play', handlePlay);
  }, [videoId]);

  // Enable caption tracks when video metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !captions || captions.length === 0) return;

    const handleLoadedMetadata = () => {
      console.log('[SimpleVideoPlayer] Video metadata loaded, checking text tracks...');
      const textTracks = Array.from(video.textTracks || []);
      console.log(`[SimpleVideoPlayer] Found ${textTracks.length} text track(s)`);
      
      textTracks.forEach((track, idx) => {
        console.log(`[SimpleVideoPlayer] Track ${idx + 1}:`, {
          kind: track.kind,
          label: track.label,
          language: track.language,
          mode: track.mode,
          readyState: track.readyState
        });
      });

      if (textTracks.length > 0) {
        // Find the default track or first track
        const defaultTrack = textTracks.find(t => t.default) || textTracks[0];
        if (defaultTrack) {
          // Wait a bit for track to be ready
          const enableTrack = () => {
            if (defaultTrack.readyState >= 2) { // HAVE_CURRENT_DATA or higher
              defaultTrack.mode = 'showing';
              console.log(`[SimpleVideoPlayer] ✅ Enabled track: ${defaultTrack.label} (${defaultTrack.language})`);
            } else {
              // Wait for track to load
              defaultTrack.addEventListener('loadeddata', () => {
                defaultTrack.mode = 'showing';
                console.log(`[SimpleVideoPlayer] ✅ Enabled track after load: ${defaultTrack.label}`);
              }, { once: true });
            }
          };
          
          if (defaultTrack.readyState >= 2) {
            enableTrack();
          } else {
            defaultTrack.addEventListener('load', enableTrack, { once: true });
          }
        }
      } else {
        console.warn('[SimpleVideoPlayer] ⚠️ No text tracks found in video element');
      }
    };

    const handleTrackChange = () => {
      const textTracks = Array.from(video.textTracks || []);
      const activeTracks = textTracks.filter(t => t.mode === 'showing');
      console.log(`[SimpleVideoPlayer] Active tracks: ${activeTracks.length}`);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('loadstart', handleLoadedMetadata); // Also check on loadstart
    
    // Listen for track changes
    const textTracks = Array.from(video.textTracks || []);
    textTracks.forEach(track => {
      track.addEventListener('load', () => {
        console.log(`[SimpleVideoPlayer] Track loaded: ${track.label}`);
        if (track.default && track.mode === 'disabled') {
          track.mode = 'showing';
        }
      });
    });

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('loadstart', handleLoadedMetadata);
    };
  }, [captions, src]);

  // Handle video loading
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedData = () => {
      setLoading(false);
      setError(null);
      
      // Ensure captions are enabled after video loads
      const textTracks = Array.from(video.textTracks || []);
      if (textTracks.length > 0) {
        const defaultTrack = textTracks.find(t => t.default) || textTracks[0];
        if (defaultTrack && defaultTrack.mode === 'disabled') {
          defaultTrack.mode = 'showing';
        }
      }
    };

    const handleError = (e) => {
      setLoading(false);
      const error = video.error;
      if (error) {
        let errorMessage = 'Failed to load video';
        switch (error.code) {
          case error.MEDIA_ERR_ABORTED:
            errorMessage = 'Video loading aborted';
            break;
          case error.MEDIA_ERR_NETWORK:
            errorMessage = 'Network error while loading video';
            break;
          case error.MEDIA_ERR_DECODE:
            errorMessage = 'Video decoding error';
            break;
          case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
            errorMessage = 'Video format not supported';
            break;
        }
        setError(errorMessage);
        console.error('Video error:', errorMessage, error);
      }
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
    };
  }, [src]);

  // Build caption track URLs
  const buildCaptionUrl = (caption) => {
    if (!caption.file_path) {
      console.warn('[SimpleVideoPlayer] Caption missing file_path:', caption);
      return null;
    }
    
    let captionUrl = caption.file_path;
    console.log('[SimpleVideoPlayer] Building caption URL from:', captionUrl);
    
    // If it's a relative path, make it absolute
    if (!captionUrl.startsWith('http://') && !captionUrl.startsWith('https://')) {
      // Remove leading slash if present
      if (captionUrl.startsWith('/')) {
        captionUrl = captionUrl.substring(1);
      }
      
      // Handle different path formats
      if (captionUrl.startsWith('captions/')) {
        // Database format: captions/videoId_language.vtt
        captionUrl = `${backendUrl}/video-storage/${captionUrl}`;
      } else if (captionUrl.startsWith('subtitles/')) {
        // Subtitle format: subtitles/videoId.vtt
        captionUrl = `${backendUrl}/${captionUrl}`;
      } else {
        // Default: assume it's in video-storage/captions
        captionUrl = `${backendUrl}/video-storage/captions/${captionUrl}`;
      }
    }
    
    console.log('[SimpleVideoPlayer] Final caption URL:', captionUrl);
    return captionUrl;
  };
  
  // Debug: Log captions prop
  useEffect(() => {
    console.log('[SimpleVideoPlayer] Captions prop received:', captions);
    console.log('[SimpleVideoPlayer] Captions count:', captions?.length || 0);
    if (captions && captions.length > 0) {
      captions.forEach((cap, idx) => {
        console.log(`[SimpleVideoPlayer] Caption ${idx + 1}:`, {
          language: cap.language,
          file_path: cap.file_path,
          label: cap.label
        });
      });
    }
  }, [captions]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-black rounded-lg">
        <div className="text-center p-8">
          <div className="text-red-500 text-xl mb-2">⚠️</div>
          <p className="text-white text-lg font-semibold">{error}</p>
          <p className="text-gray-400 text-sm mt-2">Please check the video URL or try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-3"></div>
            <p className="text-white text-sm">Loading video...</p>
          </div>
        </div>
      )}
      
      <video
        ref={videoRef}
        className="w-full h-full"
        controls
        controlsList="nodownload"
        preload="auto"
        autoPlay={autoplay}
        playsInline
        poster={poster || undefined}
        crossOrigin="anonymous"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000'
        }}
      >
        <source src={src} type="video/mp4" />
        
        {/* Add subtitle tracks in JSX - browser will handle them */}
        {captions && captions.length > 0 && captions.map((caption, index) => {
          const captionUrl = buildCaptionUrl(caption);
          if (!captionUrl) {
            console.warn(`[SimpleVideoPlayer] Skipping caption ${index} - invalid URL`);
            return null;
          }
          
          return (
            <track
              key={`caption-${index}-${caption.language || 'en'}-${caption.file_path || ''}`}
              kind="captions"
              src={captionUrl}
              srcLang={caption.language || 'en'}
              label={caption.label || (caption.language ? caption.language.toUpperCase() : 'English')}
              default={index === 0 || caption.language === 'en'}
            />
          );
        })}
        
        Your browser does not support the video tag.
      </video>
    </div>
  );
}

export default SimpleVideoPlayer;


