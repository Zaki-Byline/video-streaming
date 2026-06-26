import { useEffect, useState, useRef, Suspense, lazy } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Download, Printer, Eye } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import QRCodeViewer from '../components/QRCodeViewer';
import api from '../services/api';
import { getBackendBaseUrl } from '../utils/apiConfig';

const SimpleVideoPlayer = lazy(() => import('../components/SimpleVideoPlayer'));

function PublicVideoPage() {
  const { videoId } = useParams();
  const [searchParams] = useSearchParams();
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isEmbed = searchParams.get('embed') === 'true';
  const printRef = useRef(null);

  useEffect(() => {
    if (!videoId) {
      setError('Video ID is required');
      setLoading(false);
      return;
    }

    const fetchVideo = async () => {
      try {
        const response = await api.get(`/videos/${videoId}`);
        const videoData = response.data;

        // Debug: Log module field to verify it's being received
        console.log('[PublicVideoPage] Video data received:', {
          videoId: videoData.video_id,
          title: videoData.title,
          module: videoData.module,
          moduleType: typeof videoData.module,
          moduleValue: videoData.module,
          moduleTruthy: !!videoData.module,
          activity: videoData.activity,
          grade: videoData.grade,
          lesson: videoData.lesson,
          course: videoData.course,
          allFields: Object.keys(videoData)
        });

        // Ensure module is properly set (handle null, undefined, empty string)
        if (videoData.module === null || videoData.module === undefined || videoData.module === '') {
          console.warn('[PublicVideoPage] Module field is empty:', videoData.module);
        } else {
          console.log('[PublicVideoPage] Module field has value:', videoData.module);
        }

        // Ensure captions array exists (even if empty)
        if (!Array.isArray(videoData.captions)) {
          videoData.captions = [];
        }

        // Fetch captions if not already included or if array is empty
        if ((!videoData.captions || videoData.captions.length === 0) && videoData.video_id) {
          try {
            console.log(`[PublicVideoPage] 🔍 Fetching captions for video_id: ${videoData.video_id}`);
            const captionsResponse = await api.get(`/captions/${videoData.video_id}`);
            if (captionsResponse.data && Array.isArray(captionsResponse.data)) {
              videoData.captions = captionsResponse.data;
              console.log(`[PublicVideoPage] ✅ Loaded ${captionsResponse.data.length} caption(s) for video ${videoData.video_id}`);
            } else {
              console.log(`[PublicVideoPage] ⚠️ Captions response is not an array:`, captionsResponse.data);
              videoData.captions = [];
            }
          } catch (captionErr) {
            console.warn('[PublicVideoPage] ⚠️ Could not fetch captions:', captionErr);
            videoData.captions = [];
          }
        } else {
          console.log(`[PublicVideoPage] ✅ Video already has ${videoData.captions.length} caption(s)`);
        }

        console.log(`[PublicVideoPage] 📤 Setting video state with ${videoData.captions.length} caption(s)`);
        setVideo(videoData);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load video');
      } finally {
        setLoading(false);
      }
    };

    fetchVideo();
  }, [videoId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading video...</p>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error</h1>
          <p className="text-gray-600">{error || 'Video not found'}</p>
        </div>
      </div>
    );
  }

  // Use short URL if available, otherwise use video_id
  const redirectUrl = `${window.location.origin}/${video.redirect_slug || video.video_id}`;

  // Helper function to detect mock URLs - MUST match StreamPage's detection
  const isMockUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const urlLower = url.toLowerCase();
    // Check for all known mock URL patterns - MUST match StreamPage
    return urlLower.includes('your-account.r2.cloudflarestorage.com') ||
      urlLower.includes('r2.cloudflarestorage.com') ||
      urlLower.includes('mock-cloudflare.example.com') ||
      (urlLower.includes('example.com') && !urlLower.includes('pub-')) ||
      urlLower.includes('test.cloudflare') ||
      (urlLower.includes('cloudflare.com/') && !urlLower.includes('pub-')) ||
      urlLower.includes('cloudflarestorage.com'); // Catch all cloudflarestorage.com URLs
  };

  // Determine streaming URL - handle Cloudflare URLs and mock URLs
  const backendUrl = getBackendBaseUrl();
  const cloudflareUrl = video.streaming_url || video.file_path;
  const isCloudflareUrl = cloudflareUrl && (cloudflareUrl.startsWith('http://') || cloudflareUrl.startsWith('https://'));

  // ALWAYS check for mock URLs first, regardless of isCloudflareUrl
  const isMock = cloudflareUrl ? isMockUrl(cloudflareUrl) : false;

  // Check if streaming_url is the old format (/api/videos/.../stream)
  const isOldFormat = cloudflareUrl && cloudflareUrl.includes('/api/videos/') && cloudflareUrl.includes('/stream');

  let streamUrl;
  // ALWAYS convert mock URLs to local streaming URLs - never pass mock URLs to VideoPlayer
  if (isMock) {
    // Mock URL detected - ALWAYS use local streaming endpoint
    console.log('[PublicVideoPage] Mock Cloudflare URL detected, converting to local streaming:', cloudflareUrl);
    const streamIdentifier = video.redirect_slug || video.video_id;
    streamUrl = `${backendUrl}/s/${streamIdentifier}`;
    console.log('[PublicVideoPage] Converted to local streaming endpoint:', streamUrl);
  } else if (isCloudflareUrl && !isMock && !isOldFormat) {
    // Use real Cloudflare URL directly - but double-check it's not a mock URL
    if (isMockUrl(cloudflareUrl)) {
      // Safety check: if somehow we got here but it's still a mock URL, use local
      console.warn('[PublicVideoPage] Safety check: Detected mock URL in real Cloudflare branch, using local fallback');
      const streamIdentifier = video.redirect_slug || video.video_id;
      streamUrl = `${backendUrl}/s/${streamIdentifier}`;
    } else {
      streamUrl = cloudflareUrl;
      console.log('[PublicVideoPage] Using real Cloudflare URL directly:', streamUrl);
    }
  } else {
    // Use ultra-short stream URL: /s/shortSlug (e.g., /s/kdn4adsn4e)
    const streamIdentifier = video.redirect_slug || video.video_id;
    streamUrl = `${backendUrl}/s/${streamIdentifier}`;
    console.log('[PublicVideoPage] Using local streaming endpoint:', streamUrl);
  }

  // Final safety check: NEVER pass a mock URL to VideoPlayer
  if (streamUrl && isMockUrl(streamUrl)) {
    console.error('[PublicVideoPage] CRITICAL: Attempted to pass mock URL to VideoPlayer! Converting to local URL.');
    const streamIdentifier = video.redirect_slug || video.video_id;
    streamUrl = `${backendUrl}/s/${streamIdentifier}`;
    console.log('[PublicVideoPage] Final conversion to local URL:', streamUrl);
  }

  console.log('[PublicVideoPage] Final streaming URL that will be passed to VideoPlayer:', streamUrl);

  // Generate filename using Video Title as primary identifier
  // Format: Video_Title_G12_U1_L6_V1.0.png
  const generateQRCodeFilename = () => {
    // Sanitize title: replace spaces/special chars with underscores
    const safeTitle = (video.title || '')
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '_');

    const parts = [];
    if (safeTitle) parts.push(safeTitle);
    if (video.grade) parts.push(`G${video.grade}`);
    if (video.unit) parts.push(`U${video.unit}`);
    if (video.lesson) parts.push(`L${video.lesson}`);
    if (video.version) parts.push(`V${video.version}`);

    if (parts.length > 0) {
      return parts.join('_') + '.png';
    }
    // Fallback to video_id if no metadata
    return `${video.video_id}_qr_code.png`;
  };

  // Handle QR code download
  const handleDownloadQRCode = async () => {
    try {
      console.log('Downloading QR code for video:', video.video_id);
      const response = await api.get(`/videos/${video.video_id}/qr-download`, {
        responseType: 'blob'
      });

      if (!response.data || response.data.size === 0) {
        throw new Error('Empty response from server');
      }

      const filename = generateQRCodeFilename();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      console.log('QR code downloaded successfully as:', filename);
    } catch (error) {
      console.error('Error downloading QR code:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      alert(`Failed to download QR code: ${errorMessage}`);
    }
  };

  const handleDownloadPDF = async () => {
    try {
      // Dynamic import of html2canvas and jspdf
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).default;

      const element = printRef.current;
      if (!element) {
        alert('Print content not found');
        return;
      }

      // Show the element temporarily for capture
      element.style.display = 'block';
      element.style.position = 'absolute';
      element.style.left = '-9999px';
      element.style.top = '0';

      // Wait a bit for rendering
      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        allowTaint: true,
        foreignObjectRendering: true,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });

      // Hide element again
      element.style.display = 'none';
      element.style.position = '';

      const imgData = canvas.toDataURL('image/png', 1.0);

      if (!imgData || imgData === 'data:,') {
        throw new Error('Failed to capture image');
      }

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 width in mm
      const pageHeight = 297; // A4 height in mm
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Generate PDF filename from Grade + Lesson + Unit in format G1_L1_U1_M1.pdf
      const pdfParts = [];
      if (video.grade) pdfParts.push(`G${video.grade}`);
      if (video.lesson) pdfParts.push(`L${video.lesson}`);
      if (video.course) pdfParts.push(`U${video.course}`); // Using course as unit
      if (video.module) pdfParts.push(`M${video.module}`);

      const pdfFilename = pdfParts.length > 0
        ? pdfParts.join('_') + '.pdf'
        : `${video.video_id}_qr_code.pdf`;

      pdf.save(pdfFilename);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert(`Failed to generate PDF: ${error.message}`);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={`w-full px-4 sm:px-6 lg:px-8 py-8 ${isEmbed ? '' : 'min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50'}`}>
      <div className="w-full grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-blue-100 max-w-4xl mx-auto">
            <Suspense fallback={
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="mt-3 text-gray-600">Loading player...</p>
                </div>
              </div>
            }>
              <SimpleVideoPlayer
                src={streamUrl}
                captions={Array.isArray(video.captions) ? video.captions : []}
                videoId={video.video_id || videoId}
              />
            </Suspense>
          </div>

          {/* Video Title Section */}
          <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
            <h1 className="text-3xl font-bold mb-4 text-slate-900">
              {video.title || 'Untitled Video'}
            </h1>

            <div className="flex items-center gap-3 mb-4">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-800 text-sm font-semibold border border-slate-200">
                <Eye className="w-4 h-4 text-slate-600" />
                <span>{video.views ?? 0} views</span>
              </div>
              <span className="text-xs text-slate-500">
                {video.status ? video.status.charAt(0).toUpperCase() + video.status.slice(1) : ''}
              </span>
            </div>

            {/* Description */}
            {video.description && (
              <div className="mb-6 bg-slate-50 rounded-xl p-4 border border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">Description</h3>
                <p className="text-slate-800 text-base leading-relaxed">{video.description}</p>
              </div>
            )}
          </div>

          {/* Subject Information Section - Horizontal Layout */}
          <div className="mt-6 bg-white rounded-2xl shadow-lg p-6 border border-slate-200 w-full">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-blue-600 rounded"></div>
              <h2 className="text-base font-bold text-slate-900">Subject Information</h2>
            </div>

            <div className="grid grid-cols-5 gap-3">
              {/* Subject */}
              <div>
                <div className="text-xs uppercase text-slate-500 mb-1.5">SUBJECT</div>
                <div className="w-full px-3 py-2.5 text-sm font-bold text-slate-900 bg-blue-50 border border-blue-200 rounded-lg text-center">
                  {(() => {
                    const subjectValue = video.subject || video.course || '';
                    return subjectValue !== null && subjectValue !== undefined && subjectValue !== '' ? String(subjectValue) : '-';
                  })()}
                </div>
              </div>

              {/* Grade */}
              <div>
                <div className="text-xs uppercase text-green-700 mb-1.5">GRADE</div>
                <div className="w-full px-3 py-2.5 text-sm font-bold text-green-900 bg-green-50 border border-green-200 rounded-lg text-center">
                  {video.grade !== null && video.grade !== undefined && video.grade !== '' ? String(video.grade) : '-'}
                </div>
              </div>

              {/* Unit */}
              <div>
                <div className="text-xs uppercase text-indigo-700 mb-1.5">UNIT</div>
                <div className="w-full px-3 py-2.5 text-sm font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                  {(() => {
                    const unitValue = video.unit;
                    return unitValue !== null && unitValue !== undefined && unitValue !== '' && unitValue !== 0 && unitValue !== '0' ? String(unitValue) : '-';
                  })()}
                </div>
              </div>

              {/* Lesson */}
              <div>
                <div className="text-xs uppercase text-teal-700 mb-1.5">LESSON</div>
                <div className="w-full px-3 py-2.5 text-sm font-bold text-teal-900 bg-teal-50 border border-teal-200 rounded-lg text-center">
                  {video.lesson !== null && video.lesson !== undefined && video.lesson !== '' ? String(video.lesson) : '-'}
                </div>
              </div>

              {/* Module */}
              <div>
                <div className="text-xs uppercase text-amber-700 mb-1.5">MODULE</div>
                <div className="w-full px-3 py-2.5 text-sm font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg text-center">
                  {(() => {
                    const moduleValue = video.module;
                    return moduleValue !== null && moduleValue !== undefined && moduleValue !== '' && moduleValue !== 0 && moduleValue !== '0' ? String(moduleValue) : '-';
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Video Details Section - YouTube Format */}
          <div className="mt-4 border-t border-gray-200 pt-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              {video.size > 0 && (
                <>
                  <span className="font-semibold text-gray-700">Size:</span>
                  <span className="text-gray-800">{(video.size / 1024 / 1024).toFixed(2)} MB</span>
                  <span className="text-gray-400">•</span>
                </>
              )}
              {video.duration > 0 && (
                <>
                  <span className="font-semibold text-gray-700">Duration:</span>
                  <span className="text-gray-800">{Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}</span>
                  <span className="text-gray-400">•</span>
                </>
              )}
              <span className="font-semibold text-gray-700">Version:</span>
              <span className="text-gray-800">v{video.version}</span>
              {video.created_at && (
                <>
                  <span className="text-gray-400">•</span>
                  <span className="text-gray-600">
                    {new Date(video.created_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </>
              )}
            </div>
          </div>

          {video.relatedVideos && video.relatedVideos.length > 0 && (
            <div className="mt-6 bg-white rounded-2xl shadow-lg p-6 border border-slate-200">
              <h2 className="text-2xl font-bold mb-6 text-slate-900 flex items-center gap-2">
                <span className="w-1 h-8 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></span>
                Related Videos
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {video.relatedVideos.map((related) => (
                  <a
                    key={related.id}
                    href={`/video/${related.video_id}`}
                    className="p-4 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl border border-blue-200 hover:shadow-lg hover:border-blue-300 transition-all duration-300"
                  >
                    <h3 className="font-bold text-base text-slate-900 mb-2">{related.title}</h3>
                    <div className="flex flex-wrap gap-2 text-sm">
                      {related.grade && (
                        <span className="px-2 py-1 bg-green-100 text-green-700 rounded-lg font-medium">
                          {related.grade}
                        </span>
                      )}
                      {related.lesson && (
                        <span className="px-2 py-1 bg-teal-100 text-teal-700 rounded-lg font-medium">
                          {related.lesson}
                        </span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1 flex flex-col gap-6">
          {!isEmbed && (
            <>
              {/* QR Code - Compact container */}
              <div className="bg-white p-4 rounded-2xl shadow-lg border border-slate-200 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-1 h-6 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></span>
                    QR Code
                  </h3>

                </div>
                <QRCodeViewer url={redirectUrl} videoId={video.video_id} />
              </div>

              {/* Streaming URL - Match header/description block height */}
              <div className="bg-white rounded-2xl shadow-lg p-6 border border-slate-200 h-fit">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                    <span className="w-1 h-6 bg-gradient-to-b from-blue-500 to-indigo-500 rounded-full"></span>
                    Short URL
                  </h3>
                  <div className="flex gap-2">

                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-blue-700 mb-2 uppercase tracking-wide">Short URL (QR Code):</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={redirectUrl}
                        className="flex-1 px-3 py-2 border border-blue-200 rounded-lg bg-blue-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(redirectUrl);
                          alert('Short URL copied to clipboard!');
                        }}
                        className="px-4 py-2 bg-blue-200 text-blue-800 rounded-lg hover:bg-blue-300 font-medium text-sm whitespace-nowrap shadow-sm transition-colors"
                      >
                        Copy
                      </button>
                    </div>

                  </div>

                  <a
                    href={redirectUrl || `/stream/${video.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 font-semibold text-sm text-center shadow-lg transition-all duration-300"
                  >
                    Open Short Link
                  </a>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Printable Content - Hidden from screen, visible when printing */}
        <div
          ref={printRef}
          className="bg-white p-8"
          style={{
            display: 'none',
            position: 'absolute',
            left: '-9999px',
            top: '0',
            width: '210mm',
            minHeight: '297mm'
          }}
        >
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="text-center mb-6 border-b-2 border-gray-400 pb-4">
              <h1 className="text-4xl font-bold mb-3 text-gray-900">{video.title || 'Untitled Video'}</h1>
              {video.description && (
                <p className="text-base text-gray-700 leading-relaxed">{video.description}</p>
              )}
            </div>

            {/* Main Content - Two Columns */}
            <div className="grid grid-cols-2 gap-6 mb-6">
              {/* Left Column - QR Code */}
              <div className="border-2 border-gray-300 p-5 rounded-lg bg-gray-50">
                <h2 className="text-xl font-bold mb-3 text-gray-800 text-center border-b border-gray-300 pb-2">QR Code</h2>
                <div className="flex justify-center mb-4 p-3 bg-white border-2 border-gray-400 rounded-lg">
                  <QRCodeSVG
                    value={redirectUrl}
                    size={220}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  <div className="bg-white p-2 rounded border border-gray-300">
                    <p className="text-xs font-bold mb-1 text-gray-700 uppercase">Redirect URL:</p>
                    <p className="text-xs font-mono break-all text-gray-800 leading-tight">{redirectUrl}</p>
                  </div>
                  <div className="bg-white p-2 rounded border border-gray-300">
                    <p className="text-xs font-bold mb-1 text-gray-700 uppercase">Streaming URL:</p>
                    <p className="text-xs font-mono break-all text-gray-800 leading-tight">{streamUrl}</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Video Information */}
              <div className="border-2 border-gray-300 p-5 rounded-lg bg-gray-50">
                <h2 className="text-xl font-bold mb-3 text-gray-800 text-center border-b border-gray-300 pb-2">Video Details</h2>
                <div className="space-y-2 text-sm">
                  <div className="bg-white p-2 rounded border border-gray-200">
                    <span className="font-bold text-gray-700 block mb-1">Video ID:</span>
                    <span className="text-gray-900 font-mono text-xs">{video.video_id}</span>
                  </div>
                  {video.course && (
                    <div className="bg-white p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-1">Course:</span>
                      <span className="text-gray-900">{video.course}</span>
                    </div>
                  )}
                  {video.grade && (
                    <div className="bg-white p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-1">Grade:</span>
                      <span className="text-gray-900">{video.grade}</span>
                    </div>
                  )}
                  {video.lesson && (
                    <div className="bg-white p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-1">Lesson:</span>
                      <span className="text-gray-900">{video.lesson}</span>
                    </div>
                  )}
                  {video.module && (
                    <div className="bg-white p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-1">Module:</span>
                      <span className="text-gray-900">{video.module}</span>
                    </div>
                  )}
                  {video.activity && (
                    <div className="bg-white p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-1">Activity:</span>
                      <span className="text-gray-900">{video.activity}</span>
                    </div>
                  )}
                  {video.topic && (
                    <div className="bg-white p-2 rounded border border-gray-200">
                      <span className="font-bold text-gray-700 block mb-1">Topic:</span>
                      <span className="text-gray-900">{video.topic}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Additional Information Section */}
            <div className="border-2 border-gray-300 p-5 rounded-lg bg-gray-50 mb-6">
              <h2 className="text-xl font-bold mb-3 text-gray-800 text-center border-b border-gray-300 pb-2">Technical Information</h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {video.size > 0 && (
                  <div className="bg-white p-2 rounded border border-gray-200">
                    <span className="font-bold text-gray-700 block mb-1">File Size:</span>
                    <span className="text-gray-900">{(video.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                )}
                {video.duration > 0 && (
                  <div className="bg-white p-2 rounded border border-gray-200">
                    <span className="font-bold text-gray-700 block mb-1">Duration:</span>
                    <span className="text-gray-900">{Math.floor(video.duration / 60)}:{(video.duration % 60).toString().padStart(2, '0')}</span>
                  </div>
                )}
                <div className="bg-white p-2 rounded border border-gray-200">
                  <span className="font-bold text-gray-700 block mb-1">Version:</span>
                  <span className="text-gray-900">v{video.version}</span>
                </div>
                {video.language && (
                  <div className="bg-white p-2 rounded border border-gray-200">
                    <span className="font-bold text-gray-700 block mb-1">Language:</span>
                    <span className="text-gray-900 uppercase">{video.language}</span>
                  </div>
                )}
                {video.created_at && (
                  <div className="bg-white p-2 rounded border border-gray-200 col-span-2">
                    <span className="font-bold text-gray-700 block mb-1">Created Date:</span>
                    <span className="text-gray-900">
                      {new Date(video.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* URLs Section - Full Width */}
            <div className="border-2 border-gray-300 p-5 rounded-lg bg-gray-50 mb-6">
              <h2 className="text-xl font-bold mb-3 text-gray-800 text-center border-b border-gray-300 pb-2">Access Links</h2>
              <div className="space-y-3">
                <div className="bg-white p-3 rounded border border-gray-200">
                  <p className="text-xs font-bold mb-1 text-gray-700 uppercase">QR Code Redirect URL:</p>
                  <p className="text-xs font-mono break-all text-gray-800 bg-gray-50 p-2 rounded border border-gray-300">{redirectUrl}</p>
                </div>
                <div className="bg-white p-3 rounded border border-gray-200">
                  <p className="text-xs font-bold mb-1 text-gray-700 uppercase">Direct Streaming URL:</p>
                  <p className="text-xs font-mono break-all text-gray-800 bg-gray-50 p-2 rounded border border-gray-300">{streamUrl}</p>
                </div>
                {video.qr_url && (
                  <div className="bg-white p-3 rounded border border-gray-200">
                    <p className="text-xs font-bold mb-1 text-gray-700 uppercase">QR Code Image URL:</p>
                    <p className="text-xs font-mono break-all text-gray-800 bg-gray-50 p-2 rounded border border-gray-300">{video.qr_url}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="mt-6 pt-4 border-t-2 border-gray-400 text-center">
              <p className="text-xs text-gray-600 font-semibold">Video Delivery System</p>
              <p className="text-xs text-gray-500 mt-1">Generated on {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PublicVideoPage;

