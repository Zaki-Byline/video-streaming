import { useEffect, useState, Suspense, lazy } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import api from '../services/api';
import { getBackendBaseUrl } from '../utils/apiConfig';

const SimpleVideoPlayer = lazy(() => import('../components/SimpleVideoPlayer'));

function StreamPage() {
  const { videoId } = useParams();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerError, setPlayerError] = useState(null);

  useEffect(() => {
    if (!videoId) {
      setError('Video ID is required');
      setLoading(false);
      return;
    }

    const fetchVideo = async () => {
      try {
        let response;
        try {
          response = await api.get(`/videos/${videoId}`);
          if (response.data) {
            const videoData = response.data;

            if (!Array.isArray(videoData.captions)) {
              videoData.captions = [];
            }

            if ((!videoData.captions || videoData.captions.length === 0) && videoData.video_id) {
              try {
                const captionsResponse = await api.get(`/captions/${videoData.video_id}`);
                if (captionsResponse.data && Array.isArray(captionsResponse.data)) {
                  videoData.captions = captionsResponse.data;
                }
              } catch {
                videoData.captions = [];
              }
            }

            setVideo(videoData);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.log('Video not found by ID, checking if it\'s a short slug...');
        }

        try {
          const redirectResponse = await api.get(`/videos/redirect-info/${videoId}`);
          if (redirectResponse.data && redirectResponse.data.target_url) {
            const targetUrl = redirectResponse.data.target_url;
            const url = new URL(targetUrl);
            const pathParts = url.pathname.split('/');
            const actualVideoId = pathParts[pathParts.length - 1];
            
            response = await api.get(`/videos/${actualVideoId}`);
            if (response.data) {
              const videoData = response.data;

              if (!Array.isArray(videoData.captions)) {
                videoData.captions = [];
              }

              if ((!videoData.captions || videoData.captions.length === 0) && videoData.video_id) {
                try {
                  const captionsResponse = await api.get(`/captions/${videoData.video_id}`);
                  if (captionsResponse.data && Array.isArray(captionsResponse.data)) {
                    videoData.captions = captionsResponse.data;
                  }
                } catch {
                  videoData.captions = [];
                }
              }

              setVideo(videoData);
              setLoading(false);
              return;
            }
          }
        } catch (redirectErr) {
          console.log('Redirect lookup failed:', redirectErr);
        }

        setError('Video not found');
        setLoading(false);
      } catch (err) {
        console.error('Error fetching video:', err);
        setError(err.response?.data?.error || 'Failed to load video');
        setLoading(false);
      }
    };

    fetchVideo();
  }, [videoId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-600 border-t-transparent mx-auto mb-4"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-600 animate-pulse" />
            </div>
          </div>
          <p className="mt-6 text-slate-900 text-lg font-medium">Loading video...</p>
          <p className="mt-2 text-slate-600 text-sm">Please wait while we prepare your content</p>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-10 h-10 text-red-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-3">Video Not Found</h1>
          <p className="text-slate-600 mb-6">{error || 'The video you are looking for could not be found.'}</p>
          <p className="text-slate-500 text-sm">Please check the video link or contact support if the problem persists.</p>
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
  let urlError = null;
  
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {streamingUrl && video ? (
          <div className="space-y-6">
            {/* Video Title Section */}
            {video.title && (
              <div className="text-center mb-6">
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-3">
                  {video.title}
                </h1>
                {video.description && (
                  <p className="text-slate-600 text-lg max-w-3xl mx-auto leading-relaxed">
                    {video.description}
                  </p>
                )}
              </div>
            )}
            
            {/* Video Player Container */}
            <div className="bg-white rounded-2xl overflow-hidden shadow-xl border border-slate-200">
              <div className="aspect-video w-full">
                <Suspense fallback={
                  <div className="flex items-center justify-center h-full bg-slate-50">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
                      <p className="mt-3 text-gray-600 text-sm">Loading player...</p>
                    </div>
                  </div>
                }>
                  <SimpleVideoPlayer 
                    src={streamingUrl} 
                    captions={Array.isArray(video.captions) ? video.captions : []} 
                    autoplay={true}
                    videoId={video.video_id || videoId}
                  />
                </Suspense>
              </div>
            </div>
            
            {/* Error Messages */}
            {urlError && !isMock && (
              <div className="bg-yellow-50 border-l-4 border-yellow-500 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold text-yellow-800 mb-2">Streaming Notice</p>
                    <p className="text-yellow-700 text-sm">{urlError}</p>
                  </div>
                </div>
              </div>
            )}
            
            {playerError && (
              <div className="bg-red-50 border-l-4 border-red-500 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-bold text-red-800 mb-2">Error Loading Video</p>
                    <p className="text-red-700 text-sm mb-3">{playerError}</p>
                    <p className="text-red-600 text-xs">Please try refreshing the page or contact support if the problem persists.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 max-w-md mx-auto">
              <AlertCircle className="w-16 h-16 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-900 text-lg font-medium mb-2">Streaming URL Not Available</p>
              <p className="text-slate-600 text-sm">Please contact support if this issue persists.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default StreamPage;
