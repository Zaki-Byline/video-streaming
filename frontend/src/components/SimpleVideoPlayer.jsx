/**
 * Simple HTML5 Video Player
 *
 * Native HTML5 <video> with line-by-line subtitles via <track> elements.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { getApiBaseUrl, getBackendBaseUrl } from '../utils/apiConfig';

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

  useEffect(() => {
    if (!videoId || !videoRef.current) return;

    const hasViewed = () => {
      try {
        return localStorage.getItem(`video_viewed_${videoId}`) === 'true';
      } catch {
        return false;
      }
    };

    const markViewed = () => {
      try {
        localStorage.setItem(`video_viewed_${videoId}`, 'true');
      } catch {
        // ignore
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
    const handlePlay = () => {
      if (!hasViewed()) incrementView();
    };

    video.addEventListener('play', handlePlay);
    return () => video.removeEventListener('play', handlePlay);
  }, [videoId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedData = () => {
      setLoading(false);
      setError(null);
    };

    const handleVideoError = () => {
      setLoading(false);
      const mediaError = video.error;
      if (!mediaError) return;

      let errorMessage = 'Failed to load video';
      switch (mediaError.code) {
        case mediaError.MEDIA_ERR_ABORTED:
          errorMessage = 'Video loading aborted';
          break;
        case mediaError.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error while loading video';
          break;
        case mediaError.MEDIA_ERR_DECODE:
          errorMessage = 'Video decoding error';
          break;
        case mediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Video format not supported';
          break;
        default:
          break;
      }
      setError(errorMessage);
    };

    video.addEventListener('loadeddata', handleLoadedData);
    video.addEventListener('error', handleVideoError);

    return () => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleVideoError);
    };
  }, [src]);

  const buildCaptionUrl = (caption) => {
    const captionVideoId = caption.video_id || videoId;
    if (captionVideoId) {
      const lang = encodeURIComponent(caption.language || 'en');
      return `${getApiBaseUrl()}/captions/${captionVideoId}/file?lang=${lang}&format=lines`;
    }

    if (!caption.file_path) return null;

    let captionUrl = caption.file_path;
    if (!captionUrl.startsWith('http://') && !captionUrl.startsWith('https://')) {
      if (captionUrl.startsWith('/')) {
        captionUrl = captionUrl.substring(1);
      }
      if (captionUrl.startsWith('captions/') || captionUrl.startsWith('my-storage/') || captionUrl.startsWith('misc/')) {
        captionUrl = `${backendUrl}/video-storage/${captionUrl}`;
      } else if (captionUrl.startsWith('upload/') || captionUrl.startsWith('subtitles/')) {
        captionUrl = `${backendUrl}/${captionUrl}`;
      } else {
        captionUrl = `${backendUrl}/video-storage/captions/${captionUrl}`;
      }
    }

    return captionUrl;
  };

  const effectiveCaptions = useMemo(() => {
    if (captions?.length > 0) return captions;
    if (videoId) {
      return [{ video_id: videoId, language: 'en', label: 'English' }];
    }
    return [];
  }, [captions, videoId]);

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
        key={`${src}-${effectiveCaptions.map((c) => c.file_path || c.language).join('|')}`}
        ref={videoRef}
        className="w-full h-full"
        crossOrigin="anonymous"
        controls
        controlsList="nodownload"
        preload="auto"
        autoPlay={autoplay}
        playsInline
        poster={poster || undefined}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000'
        }}
      >
        <source src={src} type="video/mp4" />

        {effectiveCaptions.map((caption, index) => {
          const captionUrl = buildCaptionUrl(caption);
          if (!captionUrl) return null;

          return (
            <track
              key={`caption-${index}-${caption.language || 'en'}-${caption.file_path || caption.video_id || ''}`}
              kind="subtitles"
              src={captionUrl}
              srcLang={caption.language || 'en'}
              label={caption.label || (caption.language ? caption.language.toUpperCase() : 'English')}
            />
          );
        })}

        Your browser does not support the video tag.
      </video>
    </div>
  );
}

export default SimpleVideoPlayer;
