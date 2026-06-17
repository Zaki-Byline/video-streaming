import { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Play, Edit, Trash2, ExternalLink, Eye, Calendar, Search, MessageCircle, Bug, X, AlertCircle, CheckCircle, Info, Grid3x3, List, Sparkles, Loader2 } from 'lucide-react';
import api from '../services/api';
import { getBackendBaseUrl } from '../utils/apiConfig';

// Extract frame from video and use as thumbnail image
function VideoFrameThumbnail({ videoId }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const capturedRef = useRef(false);

  useEffect(() => {
    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;
    if (!videoEl || !canvasEl || !videoId || capturedRef.current) return;

    // Function to capture frame from video
    const captureFrame = () => {
      if (capturedRef.current) return;
      
      try {
        const video = videoEl;
        const canvas = canvasEl;
        
        // Check if video has valid dimensions
        if (video.videoWidth === 0 || video.videoHeight === 0) {
          // Wait a bit and try again
          setTimeout(() => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              captureFrame();
            } else {
              setHasError(true);
              setIsLoading(false);
            }
          }, 500);
          return;
        }
        
        // Set canvas dimensions to match video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw current video frame to canvas
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert canvas to image data URL
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setThumbnailUrl(dataUrl);
        setIsLoading(false);
        setHasError(false);
        capturedRef.current = true;
        
        // Hide placeholder
        const placeholder = document.getElementById(`placeholder-${videoId}`);
        if (placeholder) {
          placeholder.style.display = 'none';
        }
      } catch (err) {
        console.error('Error capturing frame:', err);
        setHasError(true);
        setIsLoading(false);
        capturedRef.current = true;
      }
    };

    // When video metadata is loaded, seek to 1 second
    const handleLoadedMetadata = () => {
      if (videoEl.readyState >= 1) {
        videoEl.currentTime = 1; // Seek to 1 second
      }
    };

    // When video time updates to 1 second, capture the frame
    const handleSeeked = () => {
      if (videoEl.currentTime >= 0.9 && !capturedRef.current) {
        captureFrame();
      }
    };

    // When video can play, try to capture frame
    const handleCanPlay = () => {
      if (videoEl.readyState >= 2 && videoEl.currentTime >= 0.9 && !capturedRef.current) {
        captureFrame();
      }
    };

    // Error handler
    const handleError = () => {
      setHasError(true);
      setIsLoading(false);
      capturedRef.current = true;
    };

    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoEl.addEventListener('seeked', handleSeeked);
    videoEl.addEventListener('canplay', handleCanPlay);
    videoEl.addEventListener('error', handleError);

    // Load video (muted, no autoplay needed)
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';
    videoEl.crossOrigin = 'anonymous'; // Required for canvas extraction
    videoEl.load();

    // Set timeout to show error if frame not captured within 5 seconds
    const timeout = setTimeout(() => {
      if (!capturedRef.current && isLoading) {
        setHasError(true);
        setIsLoading(false);
        capturedRef.current = true;
      }
    }, 5000);

    return () => {
      clearTimeout(timeout);
      videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoEl.removeEventListener('seeked', handleSeeked);
      videoEl.removeEventListener('canplay', handleCanPlay);
      videoEl.removeEventListener('error', handleError);
    };
  }, [videoId, isLoading]);

  if (!videoId) return null;

  return (
    <>
      {/* Hidden video element for frame extraction */}
      <video
        ref={videoRef}
        src={`${getBackendBaseUrl()}/api/videos/${videoId}/stream`}
        className="hidden"
        muted
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
      />
      
      {/* Hidden canvas for frame extraction */}
      <canvas ref={canvasRef} className="hidden" />
      
      {/* Display extracted frame as thumbnail */}
      {thumbnailUrl && !hasError && (
        <div className="absolute inset-2 rounded-xl overflow-hidden border border-white shadow-md z-10">
          <img
            src={thumbnailUrl}
            alt="Video thumbnail"
            className="w-full h-full object-cover"
            onError={() => {
              setHasError(true);
              const placeholder = document.getElementById(`placeholder-${videoId}`);
              if (placeholder) {
                placeholder.style.display = 'flex';
              }
            }}
          />
        </div>
      )}
    </>
  );
}

// Video Preview Component for Hover
function VideoPreview({ videoId, isHovered }) {
  const videoRef = useRef(null);
  const timeUpdateHandlerRef = useRef(null);
  
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    
    if (isHovered) {
      // Start playing when hovered
      videoEl.currentTime = 0;
      videoEl.play().catch(err => {
        console.log('Auto-play prevented:', err);
      });
      
      // Loop the first 10 seconds
      timeUpdateHandlerRef.current = () => {
        if (videoEl.currentTime >= 10) {
          videoEl.currentTime = 0;
          videoEl.play().catch(() => {});
        }
      };
      videoEl.addEventListener('timeupdate', timeUpdateHandlerRef.current);
    } else {
      // Stop and reset when not hovered
      videoEl.pause();
      videoEl.currentTime = 0;
      if (timeUpdateHandlerRef.current) {
        videoEl.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
        timeUpdateHandlerRef.current = null;
      }
    }
    
    return () => {
      if (videoEl && timeUpdateHandlerRef.current) {
        videoEl.removeEventListener('timeupdate', timeUpdateHandlerRef.current);
      }
    };
  }, [isHovered]);
  
  if (!isHovered) return null;
  
  return (
    <div className="absolute inset-2 rounded-xl overflow-hidden border-2 border-white shadow-2xl bg-black z-30">
      <video
        ref={videoRef}
        src={`${getBackendBaseUrl()}/api/videos/${videoId}/stream`}
        className="w-full h-full object-cover"
        muted
        playsInline
        onError={(e) => {
          console.error('Video preview error:', e);
        }}
      />
    </div>
  );
}

function VideoList() {
  const location = useLocation();
  const isInactiveRoute = location.pathname === '/admin/videos/inactive';
  const FILTERS_STORAGE_KEY = 'video_list_filters_v1';

  const [videos, setVideos] = useState([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const fetchRequestIdRef = useRef(0);
  const searchDebounceRef = useRef(null);
  const hasLoadedOnceRef = useRef(false);
  const [viewMode, setViewMode] = useState('card'); // 'card' or 'list'
  const [pagination, setPagination] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterOptions, setFilterOptions] = useState({
    subjects: [],
    courses: [], // Keep for backward compatibility
    grades: [],
    units: [],
    lessons: [],
    modules: [],
    versions: []
  });

  const defaultFilters = {
    search: '',
    subject: '',
    course: '', // Keep for backward compatibility
    grade: '',
    unit: '',
    lesson: '',
    module: '',
    moduleNumber: '',
    version: '',
    status: isInactiveRoute ? 'inactive' : 'active'
  };

  const [filters, setFilters] = useState(() => {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        return { ...defaultFilters, ...saved, status: defaultFilters.status };
      }
    } catch {
      // ignore parse errors and fall back to defaults
    }
    return defaultFilters;
  });

  // Keep search input in sync when filters are restored from storage
  useEffect(() => {
    setSearchInput(filters.search || '');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [diagnosticData, setDiagnosticData] = useState(null);
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(false);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [hoveredVideoId, setHoveredVideoId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [generatingDescIds, setGeneratingDescIds] = useState(new Set());

  // Persist filters so they survive navigation/back
  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // ignore storage errors
    }
  }, [filters]);

  // Derive initials and a consistent gradient from the title for thumbnail fallbacks
  const getTitleInitials = (title) => {
    if (!title) return 'NA';
    const parts = title.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || '';
    const second = parts[1]?.[0] || '';
    return (first + second).toUpperCase() || 'NA';
  };

  const getTitleGradient = (title) => {
    const safe = title || 'video';
    let hash = 0;
    for (let i = 0; i < safe.length; i += 1) {
      hash = safe.charCodeAt(i) + ((hash << 5) - hash);
      hash &= hash; // keep 32bit
    }
    const hue1 = Math.abs(hash) % 360;
    const hue2 = (hue1 + 50) % 360;
    return `linear-gradient(135deg, hsl(${hue1}, 70%, 80%), hsl(${hue2}, 70%, 70%))`;
  };

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  // Reload filter options when subject changes (including when reset to empty)
  useEffect(() => {
    fetchFilterOptions(filters.subject || '');
  }, [filters.subject]);

  // Refresh videos when navigating back from edit page (location key changes)
  useEffect(() => {
    // Refresh videos when location changes (e.g., coming back from edit page)
    const shouldRefresh = location.state?.refresh || false;
    if (shouldRefresh) {
      console.log('[VideoList] Refreshing videos after navigation to get updated file sizes');
      fetchVideos();
      // Clear the refresh flag
      window.history.replaceState({ ...location.state, refresh: false }, '');
    }
  }, [location.key, location.state]);

  // Update status filter when route changes
  useEffect(() => {
    if (isInactiveRoute && filters.status !== 'inactive') {
      setFilters(prev => ({ ...prev, status: 'inactive' }));
    } else if (!isInactiveRoute && filters.status === 'inactive') {
      setFilters(prev => ({ ...prev, status: 'active' }));
    }
  }, [isInactiveRoute]);

  // Debounce search input before updating filters / triggering API
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      setFilters((prev) => {
        const nextSearch = searchInput;
        if (prev.search === nextSearch) return prev;
        return { ...prev, search: nextSearch };
      });
    }, 350);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchInput]);

  // Reset page when non-search filters change immediately
  const prevNonSearchFiltersRef = useRef({
    subject: filters.subject,
    course: filters.course,
    grade: filters.grade,
    unit: filters.unit,
    lesson: filters.lesson,
    module: filters.module,
    moduleNumber: filters.moduleNumber,
    version: filters.version,
    status: filters.status
  });

  useEffect(() => {
    const current = {
      subject: filters.subject,
      course: filters.course,
      grade: filters.grade,
      unit: filters.unit,
      lesson: filters.lesson,
      module: filters.module,
      moduleNumber: filters.moduleNumber,
      version: filters.version,
      status: filters.status
    };

    if (JSON.stringify(prevNonSearchFiltersRef.current) !== JSON.stringify(current)) {
      setCurrentPage(1);
      prevNonSearchFiltersRef.current = current;
    }
  }, [
    filters.subject,
    filters.course,
    filters.grade,
    filters.unit,
    filters.lesson,
    filters.module,
    filters.moduleNumber,
    filters.version,
    filters.status
  ]);

  // Track previous search to reset page when debounced search changes
  const prevSearchRef = useRef(filters.search);

  useEffect(() => {
    if (prevSearchRef.current !== filters.search) {
      setCurrentPage(1);
      prevSearchRef.current = filters.search;
    }
  }, [filters.search]);

  useEffect(() => {
    fetchVideos(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentPage,
    filters.search,
    filters.subject,
    filters.course,
    filters.grade,
    filters.unit,
    filters.lesson,
    filters.module,
    filters.moduleNumber,
    filters.version,
    filters.status
  ]);

  const fetchFilterOptions = async (subject = null) => {
    try {
      // Pass subject filter to get filtered options
      // Use provided subject parameter or current state
      const currentSubject = subject !== null ? subject : (filters.subject || '');
      const params = {};
      if (currentSubject && currentSubject.trim()) {
        params.subject = currentSubject.trim();
      }
      const response = await api.get('/videos/filters', { params });
      setFilterOptions(response.data);
    } catch (error) {
      console.error('Failed to fetch filter options:', error);
    }
  };

  const fetchVideos = useCallback(async (page = currentPage) => {
    const requestId = ++fetchRequestIdRef.current;
    const showInitialLoader = !hasLoadedOnceRef.current;

    try {
      if (showInitialLoader) {
        setInitialLoading(true);
      } else {
        setIsRefreshing(true);
      }

      const params = new URLSearchParams();
      if (filters.search && filters.search.trim()) params.append('search', filters.search.trim());
      if (filters.subject && filters.subject.trim()) params.append('subject', filters.subject.trim());
      // Backward compatibility: send course separately (backend maps course -> subject)
      if (filters.course && filters.course.trim()) params.append('course', filters.course.trim());
      if (filters.grade && filters.grade.toString().trim()) params.append('grade', filters.grade.toString().trim());
      if (filters.unit && filters.unit.toString().trim()) params.append('unit', filters.unit.toString().trim());
      if (filters.lesson && filters.lesson.toString().trim()) params.append('lesson', filters.lesson.toString().trim());
      if (filters.module && filters.module.toString().trim()) params.append('module', filters.module.toString().trim());
      if (filters.moduleNumber && filters.moduleNumber.toString().trim()) params.append('moduleNumber', filters.moduleNumber.toString().trim());
      if (filters.version && filters.version.toString().trim()) params.append('version', filters.version.toString().trim());
      if (filters.status && filters.status.trim()) params.append('status', filters.status.trim());
      
      // Add pagination params
      params.append('page', page.toString());
      params.append('limit', '50');

      console.log('[VideoList] Fetching videos with filters:', Object.fromEntries(params));
      const response = await api.get(`/videos?${params.toString()}`);

      if (requestId !== fetchRequestIdRef.current) {
        return;
      }
      
      // Handle both old format (array) and new format (object with pagination)
      let videosData = [];
      let paginationData = null;
      
      if (Array.isArray(response.data)) {
        // Old format - just an array
        videosData = response.data;
      } else if (response.data && response.data.videos) {
        // New format - object with videos and pagination
        videosData = response.data.videos || [];
        paginationData = response.data.pagination || null;
      } else {
        videosData = [];
      }
      
      // Log to verify subject information is being fetched from database - show all fields including nulls
      if (videosData.length > 0) {
        console.log('[VideoList] Fetched videos from database:', videosData.length);
        const sampleVideo = videosData[0];
        console.log('[VideoList] Sample video with ALL subject info (including nulls):', {
          id: sampleVideo.id,
          video_id: sampleVideo.video_id,
          title: sampleVideo.title,
          subject: sampleVideo.subject,
          course: sampleVideo.course, // Backward compatibility
          grade: sampleVideo.grade,
          unit: sampleVideo.unit,
          lesson: sampleVideo.lesson,
          module: sampleVideo.module,
          description: sampleVideo.description,
          status: sampleVideo.status,
          // Show types to verify data
          subjectType: typeof sampleVideo.subject,
          courseType: typeof sampleVideo.course,
          gradeType: typeof sampleVideo.grade,
          unitType: typeof sampleVideo.unit,
          lessonType: typeof sampleVideo.lesson,
          moduleType: typeof sampleVideo.module,
          version: sampleVideo.version,
          versionType: typeof sampleVideo.version,
          // Show all available keys
          allKeys: Object.keys(sampleVideo),
          // Show raw values for debugging
          rawSubject: sampleVideo.subject,
          rawCourse: sampleVideo.course,
          rawGrade: sampleVideo.grade,
          rawUnit: sampleVideo.unit,
          rawLesson: sampleVideo.lesson,
          rawModule: sampleVideo.module,
          rawVersion: sampleVideo.version
        });
      }
      
      setVideos(videosData);
      hasLoadedOnceRef.current = true;
      if (paginationData) {
        setPagination(paginationData);
        if (paginationData.page && paginationData.page !== page) {
          setCurrentPage(paginationData.page);
        }
        console.log('[VideoList] Pagination:', paginationData);
      } else {
        setPagination(null);
      }
      console.log('[VideoList] Successfully fetched', videosData.length, 'videos');
    } catch (error) {
      if (requestId !== fetchRequestIdRef.current) {
        return;
      }
      console.error('[VideoList] Failed to fetch videos:', error);
      console.error('[VideoList] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      setVideos([]);
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setInitialLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [
    currentPage,
    filters.search,
    filters.subject,
    filters.course,
    filters.grade,
    filters.unit,
    filters.lesson,
    filters.module,
    filters.moduleNumber,
    filters.version,
    filters.status
  ]);

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this video?')) return;

    try {
      await api.delete(`/videos/${id}`);
      fetchVideos();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (error) {
      alert('Failed to delete video');
    }
  };

  const handleActivate = async (id) => {
    if (!confirm('Are you sure you want to activate this video? It will appear in the video library.')) return;

    try {
      await api.put(`/videos/${id}`, { status: 'active' });
      fetchVideos();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (error) {
      alert('Failed to activate video');
      console.error('Activate error:', error);
    }
  };

  const handleGenerateDescription = async (id) => {
    setGeneratingDescIds((prev) => new Set(prev).add(id));
    try {
      const response = await api.post(`/videos/${id}/generate-description`);
      const newDescription = response.data?.description ?? '';
      setVideos((prev) =>
        prev.map((v) => (v.id === id ? { ...v, description: newDescription } : v))
      );
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to generate description');
      console.error('[VideoList] Generate description error:', error);
    } finally {
      setGeneratingDescIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const renderDescriptionContent = (video) => {
    if (generatingDescIds.has(video.id)) {
      return (
        <div className="animate-pulse space-y-1.5" aria-busy="true" aria-label="Generating description">
          <div className="h-2.5 bg-slate-200 rounded w-full" />
          <div className="h-2.5 bg-slate-200 rounded w-5/6" />
          <div className="h-2.5 bg-slate-200 rounded w-2/3" />
        </div>
      );
    }
    return truncateDescription(video.description);
  };

  const truncateDescription = (text, maxWords = 10) => {
    if (!text || !text.trim()) return 'No description';
    const words = text.trim().split(/\s+/);
    if (words.length <= maxWords) return text;
    return words.slice(0, maxWords).join(' ') + '...';
  };

  const handleToggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === videos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(videos.map((v) => v.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) {
      alert('Please select at least one video to delete.');
      return;
    }
    if (!confirm(`Delete ${selectedIds.size} selected video(s)? This cannot be undone.`)) return;
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => api.delete(`/videos/${id}`).catch((err) => ({ err, id }))));
      setSelectedIds(new Set());
      fetchVideos();
    } catch (error) {
      alert('Some videos could not be deleted. Check console for details.');
      console.error('Bulk delete error:', error);
    }
  };

  const handleBulkActivate = async () => {
    if (selectedIds.size === 0) {
      alert('Please select at least one video to activate.');
      return;
    }
    if (!confirm(`Activate ${selectedIds.size} selected video(s)? They will appear in the video library.`)) return;
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map((id) => api.put(`/videos/${id}`, { status: 'active' }).catch((err) => ({ err, id }))));
      setSelectedIds(new Set());
      fetchVideos();
    } catch (error) {
      alert('Some videos could not be activated. Check console for details.');
      console.error('Bulk activate error:', error);
    }
  };

  const handleDiagnostic = async (video) => {
    setDiagnosticLoading(true);
    setShowDiagnosticModal(true);
    setDiagnosticData(null);

    try {
      // Try using database ID first, then video_id
      const videoId = video.id || video.video_id;
      const response = await api.get(`/videos/diagnostic/${videoId}`);
      setDiagnosticData(response.data);
    } catch (error) {
      console.error('Diagnostic error:', error);
      setDiagnosticData({
        error: true,
        message: error.response?.data?.message || error.message || 'Failed to fetch diagnostic information'
      });
    } finally {
      setDiagnosticLoading(false);
    }
  };

  if (initialLoading && videos.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading videos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="p-6 lg:p-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 mb-2">
                {isInactiveRoute ? 'Inactive Videos' : 'Video Library'}
              </h1>
              <p className="text-slate-600 text-lg">
                {isInactiveRoute ? 'View and manage all inactive videos' : 'Manage and view all your videos'}
              </p>
            </div>
            {/* View Toggle */}
            <div className="flex items-center gap-2 bg-white rounded-xl p-1 shadow-md border border-slate-200">
              <button
                onClick={() => setViewMode('card')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all duration-200 ${
                  viewMode === 'card'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                title="Card View"
              >
                <Grid3x3 className="w-4 h-4" />
                <span className="hidden sm:inline">Card</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all duration-200 ${
                  viewMode === 'list'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                title="List View"
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">List</span>
              </button>
            </div>
          </div>
        </div>

        {/* Filters Section */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Search className="w-5 h-5 text-slate-600" />
            Filters
          </h2>
          <button
            type="button"
            onClick={() => {
              setFilters(defaultFilters);
              setSearchInput('');
              setSelectedIds(new Set());
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-full border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Clear filters
          </button>
        </div>
        {/* Bulk actions */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            onClick={handleSelectAll}
            className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors text-sm font-semibold"
          >
            {selectedIds.size === videos.length ? 'Deselect All' : 'Select All'}
          </button>
          {isInactiveRoute ? (
            <button
              onClick={handleBulkActivate}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg border border-green-700 hover:bg-green-700 transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Activate Selected ({selectedIds.size})
            </button>
          ) : (
            <button
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0}
              className="px-4 py-2 bg-red-600 text-white rounded-lg border border-red-700 hover:bg-red-700 transition-colors text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Delete Selected ({selectedIds.size})
            </button>
          )}
        </div>
        
        {/* Search Bar */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Search
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by title, description, or video ID..."
              className="w-full pl-10 pr-3 py-3 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Subject
            </label>
            <select
              value={filters.subject || filters.course || ''}
              onChange={(e) => {
                const value = e.target.value;
                setFilters(prev => {
                  const newFilters = { ...prev, subject: value, course: value };
                  // Reset dependent filters when subject changes
                  if (value === '' || prev.subject !== value) {
                    newFilters.grade = '';
                    newFilters.unit = '';
                    newFilters.lesson = '';
                    newFilters.module = '';
                    newFilters.moduleNumber = '';
                    newFilters.version = '';
                  }
                  return newFilters;
                });
              }}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
            >
              <option value="">All Subjects</option>
              {(filterOptions.subjects || filterOptions.courses || []).map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Grade
            </label>
            <select
              value={filters.grade || ''}
              onChange={(e) => {
                const value = e.target.value;
                setFilters(prev => ({ ...prev, grade: value }));
              }}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
            >
              <option value="">All Grades</option>
              {filterOptions.grades && filterOptions.grades.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Unit
            </label>
            <select
              value={filters.unit || ''}
              onChange={(e) => {
                const value = e.target.value;
                setFilters(prev => ({ ...prev, unit: value }));
              }}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
            >
              <option value="">All Units</option>
              {filterOptions.units && filterOptions.units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Lesson
            </label>
            <select
              value={filters.lesson || ''}
              onChange={(e) => {
                const value = e.target.value;
                setFilters(prev => ({ ...prev, lesson: value }));
              }}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
            >
              <option value="">All Lessons</option>
              {filterOptions.lessons && filterOptions.lessons.map((lesson) => (
                <option key={lesson} value={lesson}>
                  {lesson}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Module
            </label>
            <select
              value={filters.module || ''}
              onChange={(e) => {
                const value = e.target.value;
                setFilters(prev => ({ ...prev, module: value }));
              }}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
            >
              <option value="">All Modules</option>
              {filterOptions.modules && filterOptions.modules.map((module) => (
                <option key={module} value={module}>
                  {module}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">
              Version
            </label>
            <select
              value={filters.version || ''}
              onChange={(e) => {
                const value = e.target.value;
                setFilters(prev => ({ ...prev, version: value }));
              }}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
            >
              <option value="">All Versions</option>
              {filterOptions.versions && filterOptions.versions.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </select>
          </div>
          {!isInactiveRoute && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Status
              </label>
              <select
                value={filters.status || 'active'}
                onChange={(e) => {
                  const value = e.target.value;
                  setFilters(prev => ({ ...prev, status: value }));
                }}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none bg-white cursor-pointer"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
        </div>
        {/* Clear Filters Button */}
        {(filters.search || searchInput || filters.subject || filters.course || filters.grade || filters.unit || filters.lesson || filters.module || filters.moduleNumber || filters.version || filters.status !== 'active') && (
          <div className="mt-6">
            <button
              onClick={() => {
                setFilters({
                  search: '',
                  subject: '',
                  course: '',
                  grade: '',
                  unit: '',
                  lesson: '',
                  module: '',
                  moduleNumber: '',
                  version: '',
                  status: isInactiveRoute ? 'inactive' : 'active'
                });
                setSearchInput('');
              }}
              className="px-4 py-2 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {videos.length === 0 && !isRefreshing ? (
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-12 text-center">
          <p className="text-slate-500 text-lg font-semibold">No videos found</p>
          <p className="text-slate-400 text-sm mt-2">Try adjusting your filters or upload a new video</p>
        </div>
      ) : (
        <div className="relative">
          {isRefreshing && (
            <div className="absolute inset-0 z-20 flex items-start justify-center pt-24 bg-white/60 backdrop-blur-[1px] rounded-2xl pointer-events-none">
              <div className="flex items-center gap-3 px-4 py-2 bg-white rounded-full shadow-md border border-slate-200">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                <span className="text-sm font-medium text-slate-600">Updating results…</span>
              </div>
            </div>
          )}
      {viewMode === 'list' ? (
        // List View
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-slate-50 to-blue-50 border-b-2 border-slate-200">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Thumbnail</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Title</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Subject</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Grade</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Unit</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Lesson</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Module</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Views</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-200">
                {videos.map((video) => {
                  const formatDate = (dateString) => {
                    if (!dateString) return 'Recently';
                    const date = new Date(dateString);
                    const now = new Date();
                    const diffTime = Math.abs(now - date);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays === 0) return 'Today';
                    if (diffDays === 1) return '1 day ago';
                    if (diffDays < 7) return `${diffDays} days ago`;
                    if (diffDays < 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
                    if (diffDays < 365) return `${Math.ceil(diffDays / 30)} months ago`;
                    return `${Math.ceil(diffDays / 365)} years ago`;
                  };

                  const backendUrl = getBackendBaseUrl();
                  const buildThumbnailUrl = (pathOrUrl, videoId) => {
                    if (pathOrUrl && pathOrUrl.trim() !== '') {
                      let thumbnailPath = pathOrUrl.trim();
                      if (thumbnailPath.startsWith('http://') || thumbnailPath.startsWith('https://')) {
                        return thumbnailPath;
                      }
                      if (!thumbnailPath.startsWith('/')) {
                        thumbnailPath = `/${thumbnailPath}`;
                      }
                      if (!thumbnailPath.toLowerCase().startsWith('/thumbnails/')) {
                        if (!thumbnailPath.includes('/')) {
                          thumbnailPath = `/thumbnails/${thumbnailPath}`;
                        } else {
                          const filename = thumbnailPath.split('/').pop();
                          thumbnailPath = `/thumbnails/${filename}`;
                        }
                      }
                      return `${backendUrl}${thumbnailPath}`;
                    }
                    if (videoId) {
                      return `${backendUrl}/thumbnails/${videoId}.jpg`;
                    }
                    return null;
                  };
                  
                  const thumbnailUrl = buildThumbnailUrl(video.thumbnail_url, video.video_id);

                  return (
                    <tr key={`video-${video.id ?? video.video_id}`} className="hover:bg-blue-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="w-20 h-12 rounded-lg overflow-hidden flex items-center justify-center relative">
                          {thumbnailUrl && (
                            <img
                              src={thumbnailUrl}
                              alt={video.title}
                              loading="lazy"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                const fallback = e.target.parentElement?.querySelector('.thumb-fallback');
                                if (fallback) fallback.classList.remove('hidden');
                              }}
                            />
                          )}
                          <div
                            className={`thumb-fallback absolute inset-0 flex items-center justify-center font-bold text-sm text-slate-800 ${thumbnailUrl ? 'hidden' : 'flex'}`}
                            style={{ background: getTitleGradient(video.title) }}
                          >
                            <span className="px-2 py-1 bg-white/70 rounded-md shadow-sm">
                              {getTitleInitials(video.title)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-900">{video.title || 'Untitled Video'}</div>
                        <div className="text-xs text-slate-500 mt-1 truncate max-w-xs">
                          {renderDescriptionContent(video)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-semibold bg-blue-50 text-blue-700 rounded">
                          {video.subject || video.course || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-semibold bg-green-50 text-green-700 rounded">
                          {video.grade || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded">
                          {video.unit || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-semibold bg-teal-50 text-teal-700 rounded">
                          {video.lesson || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-semibold bg-amber-50 text-amber-700 rounded">
                          {video.module || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-sm text-slate-700">
                          <Eye className="w-4 h-4" />
                          <span className="font-semibold">{video.views || 0}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {video.status === 'active' ? (
                          <span className="px-2 py-1 text-xs font-bold bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-full">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-bold bg-slate-300 text-slate-700 rounded-full">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 text-blue-600"
                            checked={selectedIds.has(video.id)}
                            onChange={() => handleToggleSelect(video.id)}
                          />
                          {isInactiveRoute ? (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleActivate(video.id);
                                }}
                                className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                                title="Activate Video"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <Link
                                to={`/video/${video.video_id}`}
                                className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                                title="View"
                              >
                                <Eye className="w-4 h-4" />
                              </Link>
                              <Link
                                to={`/stream/${video.video_id}`}
                                className="p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors"
                                title="Stream"
                              >
                                <Play className="w-4 h-4" />
                              </Link>
                              <Link
                                to={`/admin/videos/${video.id}/edit`}
                                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </Link>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGenerateDescription(video.id);
                                }}
                                disabled={generatingDescIds.has(video.id)}
                                className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors disabled:opacity-50"
                                title="Generate description from subtitles (AI)"
                              >
                                {generatingDescIds.has(video.id) ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Sparkles className="w-4 h-4" />
                                )}
                              </button>
                            </>
                          ) : (
                            <>
                              <Link
                                to={`/stream/${video.video_id}`}
                                className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                                title="Stream"
                              >
                                <Play className="w-4 h-4" />
                              </Link>
                              <Link
                                to={`/admin/videos/${video.id}/edit`}
                                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                                title="Edit"
                              >
                                <Edit className="w-4 h-4" />
                              </Link>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleGenerateDescription(video.id);
                                }}
                                disabled={generatingDescIds.has(video.id)}
                                className="p-2 bg-violet-100 text-violet-700 rounded-lg hover:bg-violet-200 transition-colors disabled:opacity-50"
                                title="Generate description from subtitles (AI)"
                              >
                                {generatingDescIds.has(video.id) ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Sparkles className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(video.id);
                                }}
                                className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        // Card View
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8">
          {videos.map((video) => {
            const formatDate = (dateString) => {
              if (!dateString) return 'Recently';
              const date = new Date(dateString);
              const now = new Date();
              const diffTime = Math.abs(now - date);
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
              if (diffDays === 0) return 'Today';
              if (diffDays === 1) return '1 day ago';
              if (diffDays < 7) return `${diffDays} days ago`;
              if (diffDays < 30) return `${Math.ceil(diffDays / 7)} weeks ago`;
              if (diffDays < 365) return `${Math.ceil(diffDays / 30)} months ago`;
              return `${Math.ceil(diffDays / 365)} years ago`;
            };

            const formatSize = (bytes) => {
              if (!bytes) return '0 MB';
              return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
            };

            // Get thumbnail URL - use video thumbnail or try to fetch by videoId
            const backendUrl = getBackendBaseUrl();
            
            // Function to build thumbnail URL
            const buildThumbnailUrl = (pathOrUrl, videoId) => {
              // If we have a thumbnail_url from database
              if (pathOrUrl && pathOrUrl.trim() !== '') {
                let thumbnailPath = pathOrUrl.trim();
                
                // If it's already a full URL, return it
                if (thumbnailPath.startsWith('http://') || thumbnailPath.startsWith('https://')) {
                  return thumbnailPath;
                }
                
                // If it doesn't start with /, add it
                if (!thumbnailPath.startsWith('/')) {
                  thumbnailPath = `/${thumbnailPath}`;
                }
                
                // Ensure it starts with /thumbnails/
                if (!thumbnailPath.toLowerCase().startsWith('/thumbnails/')) {
                  // If it's just a filename, add /thumbnails/ prefix
                  if (!thumbnailPath.includes('/')) {
                    thumbnailPath = `/thumbnails/${thumbnailPath}`;
                  } else {
                    // Extract filename and add /thumbnails/ prefix
                    const filename = thumbnailPath.split('/').pop();
                    thumbnailPath = `/thumbnails/${filename}`;
                  }
                }
                
                return `${backendUrl}${thumbnailPath}`;
              }
              
              // If no thumbnail_url, try common thumbnail paths by videoId
              if (videoId) {
                // Try different extensions - start with .jpg as it's most common
                const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
                // Return the first one - the image will load if it exists, otherwise show placeholder
                return `${backendUrl}/thumbnails/${videoId}${extensions[0]}`;
              }
              
              // Fallback to null (will show placeholder)
              return null;
            };
            
            // Get thumbnail URL - prioritize database thumbnail_url, then try by videoId
            let thumbnailUrl = buildThumbnailUrl(video.thumbnail_url, video.video_id);
            
            // If no thumbnail_url in database, try to construct from videoId
            if (!thumbnailUrl && video.video_id) {
              thumbnailUrl = `${backendUrl}/thumbnails/${video.video_id}.jpg`;
            }

            return (
              <div
                key={`video-${video.id ?? video.video_id}`}
                className="bg-white rounded-2xl shadow-lg border-2 border-slate-200 overflow-hidden hover:shadow-2xl hover:border-blue-400 transition-all duration-300 group transform hover:-translate-y-2"
              >
                {/* Thumbnail Section */}
                <div 
                  className="relative w-full aspect-video bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-50 overflow-hidden p-2"
                  onMouseEnter={() => {
                    setHoveredVideoId(video.video_id);
                  }}
                  onMouseLeave={() => {
                    setHoveredVideoId(null);
                  }}
                >
                  {/* Video Frame Thumbnail - DISABLED for performance (causes 2-3GB cache) */}
                  {/* <VideoFrameThumbnail videoId={video.video_id} /> */}

                  {/* Thumbnail Image - Show if available, overlay on top of video preview */}
                  {/* Using loading="lazy" to improve performance */}
                  {thumbnailUrl && (
                    <div className="relative w-full h-full rounded-lg overflow-hidden border border-white shadow-md z-10">
                      <img
                        src={thumbnailUrl}
                        alt={video.title}
                        loading="lazy"
                        className={`w-full h-full object-cover transition-opacity duration-300 ${
                          hoveredVideoId === video.video_id ? 'opacity-30' : 'opacity-100'
                        }`}
                        onError={(e) => {
                          // Try alternative extensions if first one fails
                          const currentSrc = e.target.src;
                          const videoId = video.video_id;
                          const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
                          const currentExt = extensions.find(ext => currentSrc.includes(ext)) || extensions[0];
                          const currentIndex = extensions.indexOf(currentExt);
                          
                          if (currentIndex < extensions.length - 1) {
                            // Try next extension
                            const nextExt = extensions[currentIndex + 1];
                            e.target.src = `${backendUrl}/thumbnails/${videoId}${nextExt}`;
                          } else {
                            // All extensions failed, hide image and let video preview show
                            e.target.style.display = 'none';
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* Default Placeholder - Show if video frame extraction fails or while loading */}
                  <div
                    className="thumbnail-placeholder absolute inset-2 flex flex-col items-center justify-center rounded-xl border-2 border-slate-300 shadow-inner z-5 pointer-events-none"
                    style={{ background: getTitleGradient(video.title) }}
                    id={`placeholder-${video.video_id}`}
                  >
                    <div className="w-16 h-16 bg-white/70 rounded-full flex items-center justify-center mb-2 shadow-md">
                      <span className="text-xl font-bold text-slate-800">{getTitleInitials(video.title)}</span>
                    </div>
                    <p className="text-xs text-slate-700 font-semibold">Loading...</p>
                  </div>
                  
                  {/* Video Preview on Hover - Overlay on top - Only load when actually hovered for 500ms+ */}
                  {hoveredVideoId === video.video_id && (
                    <VideoPreview 
                      videoId={video.video_id} 
                      isHovered={true} 
                    />
                  )}

                  {/* Play Button Overlay (only on hover, but not when video preview is showing) */}
                  {hoveredVideoId !== video.video_id && (
                    <Link
                      to={`/stream/${video.video_id}`}
                      className="absolute inset-2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-black/40 backdrop-blur-sm rounded-lg z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center shadow-xl transform group-hover:scale-110 transition-transform duration-300 border-3 border-white/80">
                        <Play className="w-10 h-10 text-white ml-1" fill="currentColor" />
                      </div>
                    </Link>
                  )}
            
                  {/* Status Badge */}
                  {video.status === 'active' && (
                    <div className="absolute top-2 right-2 z-30">
                      <span className="px-2 py-1 text-xs rounded-full font-bold bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg border border-white/80 backdrop-blur-sm">
                        Active
                      </span>
                    </div>
                  )}
                </div>
             
                {/* Content Section */}
                <div className="p-3 sm:p-4 bg-white">
                  {/* Screen Recording Title with Views in Top Right */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="text-base font-bold text-slate-900 flex-1 line-clamp-2">
                      {video.title || 'Untitled Video'}
                    </h3>
                    {/* Views Count - Top Right */}
                    <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 rounded-lg border border-slate-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition-all duration-200 cursor-default flex-shrink-0">
                      <Eye className="w-3.5 h-3.5" />
                      <span className="font-semibold text-xs">{video.views || 0}</span>
                    </div>
                  </div>

                  {/* Description - always show */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-xs uppercase text-slate-500">DESCRIPTION</div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleGenerateDescription(video.id);
                        }}
                        disabled={generatingDescIds.has(video.id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100 disabled:opacity-50 transition-colors"
                        title="Generate description from subtitles using OpenAI"
                      >
                        {generatingDescIds.has(video.id) ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Sparkles className="w-3 h-3" />
                        )}
                        Generate
                      </button>
                    </div>
                    <div className={`w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg min-h-[2rem] text-slate-700 ${generatingDescIds.has(video.id) ? 'opacity-80' : ''}`}>
                      {renderDescriptionContent(video)}
                    </div>
                  </div>

                  {/* Subject Information - Two Row Layout */}
                  <div className="mb-2">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-1 h-4 bg-blue-600 rounded"></div>
                      <h5 className="text-sm font-bold text-slate-900">Subject Information</h5>
                    </div>
                    
                    {/* Subject - Full Width Single Line */}
                    <div className="mb-1.5">
                      <div className="text-xs uppercase text-slate-500 mb-0.5">SUBJECT</div>
                      <div className="w-full px-2 py-1.5 text-xs font-bold text-slate-900 bg-blue-50 border border-blue-200 rounded-lg text-center whitespace-nowrap overflow-hidden text-ellipsis" title={(() => {
                        const subjectValue = video.subject || video.course || '';
                        return subjectValue !== null && subjectValue !== undefined && subjectValue !== '' ? String(subjectValue) : '-';
                      })()}>
                        {(() => {
                          const subjectValue = video.subject || video.course || '';
                          return subjectValue !== null && subjectValue !== undefined && subjectValue !== '' ? String(subjectValue) : '-';
                        })()}
                      </div>
                    </div>

                    {/* Grade, Unit, Lesson, Module - Four Column Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                      {/* Grade */}
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-green-700 mb-0.5">GRADE</div>
                        <div className="w-full px-1.5 py-1.5 text-xs font-bold text-green-900 bg-green-50 border border-green-200 rounded-lg text-center break-words min-h-[2rem] flex items-center justify-center">
                          {video.grade !== null && video.grade !== undefined && video.grade !== '' ? video.grade : '-'}
                        </div>
                      </div>

                      {/* Unit */}
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-indigo-700 mb-0.5">UNIT</div>
                        <div className="w-full px-1.5 py-1.5 text-xs font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg text-center break-words min-h-[2rem] flex items-center justify-center">
                          {(() => {
                            const unitValue = video.unit;
                            return unitValue !== null && unitValue !== undefined && unitValue !== '' && unitValue !== 0 && unitValue !== '0' ? String(unitValue) : '-';
                          })()}
                        </div>
                      </div>

                      {/* Lesson */}
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-teal-700 mb-0.5">LESSON</div>
                        <div className="w-full px-1.5 py-1.5 text-xs font-bold text-teal-900 bg-teal-50 border border-teal-200 rounded-lg text-center break-words min-h-[2rem] flex items-center justify-center">
                          {video.lesson !== null && video.lesson !== undefined && video.lesson !== '' ? video.lesson : '-'}
                        </div>
                      </div>

                      {/* Module */}
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-amber-700 mb-0.5">MODULE</div>
                        <div className="w-full px-1.5 py-1.5 text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg text-center break-words min-h-[2rem] flex items-center justify-center">
                          {(() => {
                            const moduleValue = video.module;
                            return moduleValue !== null && moduleValue !== undefined && moduleValue !== '' && moduleValue !== 0 && moduleValue !== '0' ? String(moduleValue) : '-';
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Version + File Size and Date */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mb-2 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg">
                      <span className="font-semibold text-slate-700">Version:</span>
                      <span className="font-bold text-slate-900">
                        {video.version !== null && video.version !== undefined && video.version !== '' ? String(video.version) : '-'}
                      </span>
                    </div>
                    <span className="text-slate-400">•</span>
                    <span className="font-semibold text-slate-700">{formatSize(video.size)}</span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-500">{formatDate(video.created_at)}</span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                    {isInactiveRoute ? (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivate(video.id);
                          }}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-gradient-to-r from-green-50 to-green-100 text-green-700 rounded-lg text-xs font-bold hover:from-green-100 hover:to-green-200 hover:text-green-800 hover:shadow-md transition-all duration-200 border border-green-300"
                          title="Activate Video"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Activate</span>
                        </button>
                        <Link
                          to={`/video/${video.video_id}`}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:from-blue-100 hover:to-blue-200 hover:text-blue-800 hover:shadow-md transition-all duration-200 border border-blue-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">View</span>
                        </Link>
                        <Link
                          to={`/stream/${video.video_id}`}
                          target="_blank"
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 rounded-lg text-xs font-bold hover:from-emerald-100 hover:to-emerald-200 hover:text-emerald-800 hover:shadow-md transition-all duration-200 border border-emerald-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Stream</span>
                        </Link>
                        <Link
                          to={`/admin/videos/${video.id}/edit`}
                          className="px-2.5 py-2 bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 rounded-lg hover:from-slate-200 hover:to-slate-300 hover:text-slate-900 hover:shadow-md transition-all duration-200 border border-slate-300"
                          onClick={(e) => e.stopPropagation()}
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGenerateDescription(video.id);
                          }}
                          disabled={generatingDescIds.has(video.id)}
                          className="px-2.5 py-2 bg-gradient-to-r from-violet-50 to-violet-100 text-violet-700 rounded-lg hover:from-violet-100 hover:to-violet-200 hover:shadow-md transition-all duration-200 border border-violet-300 disabled:opacity-50"
                          title="Generate description from subtitles (AI)"
                        >
                          {generatingDescIds.has(video.id) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          to={`/video/${video.video_id}`}
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:from-blue-100 hover:to-blue-200 hover:text-blue-800 hover:shadow-md transition-all duration-200 border border-blue-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">View</span>
                        </Link>
                        <Link
                          to={`/stream/${video.video_id}`}
                          target="_blank"
                          className="flex-1 flex items-center justify-center gap-1 px-2.5 py-2 bg-gradient-to-r from-green-50 to-green-100 text-green-700 rounded-lg text-xs font-bold hover:from-green-100 hover:to-green-200 hover:text-green-800 hover:shadow-md transition-all duration-200 border border-green-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Stream</span>
                        </Link>
                        <Link
                          to={`/admin/videos/${video.id}/edit`}
                          className="px-2.5 py-2 bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 rounded-lg hover:from-slate-200 hover:to-slate-300 hover:text-slate-900 hover:shadow-md transition-all duration-200 border border-slate-300"
                          onClick={(e) => e.stopPropagation()}
                          title="Edit"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGenerateDescription(video.id);
                          }}
                          disabled={generatingDescIds.has(video.id)}
                          className="px-2.5 py-2 bg-gradient-to-r from-violet-50 to-violet-100 text-violet-700 rounded-lg hover:from-violet-100 hover:to-violet-200 hover:shadow-md transition-all duration-200 border border-violet-300 disabled:opacity-50"
                          title="Generate description from subtitles (AI)"
                        >
                          {generatingDescIds.has(video.id) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(video.id);
                          }}
                          className="px-2.5 py-2 bg-gradient-to-r from-red-50 to-red-100 text-red-700 rounded-lg hover:from-red-100 hover:to-red-200 hover:text-red-800 hover:shadow-md transition-all duration-200 border border-red-300"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
        </div>
      )}

      {/* Diagnostic Modal */}
      {showDiagnosticModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-indigo-600 text-white p-6 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Bug className="w-6 h-6" />
                <h2 className="text-2xl font-bold">Video Metadata Diagnostic</h2>
              </div>
              <button
                onClick={() => {
                  setShowDiagnosticModal(false);
                  setDiagnosticData(null);
                }}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {diagnosticLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
                    <p className="text-slate-600">Running diagnostic...</p>
                  </div>
                </div>
              ) : diagnosticData?.error ? (
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                    <h3 className="text-xl font-bold text-red-900">Error</h3>
                  </div>
                  <p className="text-red-700">{diagnosticData.message}</p>
                </div>
              ) : diagnosticData ? (
                <div className="space-y-6">
                  {/* Status Summary */}
                  <div className={`rounded-xl p-6 border-2 ${
                    diagnosticData.status === 'healthy' 
                      ? 'bg-green-50 border-green-200' 
                      : diagnosticData.status === 'warning'
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center gap-3 mb-4">
                      {diagnosticData.status === 'healthy' ? (
                        <CheckCircle className="w-6 h-6 text-green-600" />
                      ) : diagnosticData.status === 'warning' ? (
                        <AlertCircle className="w-6 h-6 text-yellow-600" />
                      ) : (
                        <X className="w-6 h-6 text-red-600" />
                      )}
                      <h3 className="text-xl font-bold">Status: {diagnosticData.status?.toUpperCase() || 'UNKNOWN'}</h3>
                    </div>
                    {diagnosticData.summary && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <div className="text-sm text-slate-600">Video Found</div>
                          <div className={`font-bold ${diagnosticData.summary.videoFound ? 'text-green-700' : 'text-red-700'}`}>
                            {diagnosticData.summary.videoFound ? 'Yes' : 'No'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">Columns Exist</div>
                          <div className={`font-bold ${diagnosticData.summary.columnsExist ? 'text-green-700' : 'text-red-700'}`}>
                            {diagnosticData.summary.columnsExist ? 'Yes' : 'No'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">Values Present</div>
                          <div className={`font-bold ${diagnosticData.summary.valuesPresent ? 'text-green-700' : 'text-red-700'}`}>
                            {diagnosticData.summary.valuesPresent ? 'Yes' : 'No'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600">Issues Found</div>
                          <div className="font-bold text-slate-700">{diagnosticData.summary.issuesFound || 0}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Database Schema */}
                  {diagnosticData.databaseSchema && (
                    <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Info className="w-5 h-5" />
                        Database Schema
                      </h3>
                      <div className="space-y-2">
                        <div>
                          <span className="font-semibold text-slate-700">Columns Found: </span>
                          <span className="text-slate-600">
                            {diagnosticData.databaseSchema.columnsFound?.length > 0
                              ? diagnosticData.databaseSchema.columnsFound.join(', ')
                              : 'None'}
                          </span>
                        </div>
                        {diagnosticData.databaseSchema.columnDetails && Object.keys(diagnosticData.databaseSchema.columnDetails).length > 0 && (
                          <div className="mt-4">
                            <div className="font-semibold text-slate-700 mb-2">Column Details:</div>
                            <div className="bg-white rounded-lg p-4 space-y-2">
                              {Object.entries(diagnosticData.databaseSchema.columnDetails).map(([name, details]) => (
                                <div key={name} className="flex items-center justify-between border-b pb-2">
                                  <span className="font-mono text-sm font-bold text-slate-800">{name}</span>
                                  <span className="text-xs text-slate-600">
                                    {details.type} {details.nullable ? '(nullable)' : '(not null)'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Raw Database Values */}
                  {diagnosticData.rawDatabaseValues && (
                    <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4">Raw Database Values</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <div className="text-sm text-slate-600 mb-1">Subject</div>
                          <div className={`font-bold ${diagnosticData.rawDatabaseValues.subjectIsNull ? 'text-red-700' : 'text-green-700'}`}>
                            {diagnosticData.rawDatabaseValues.subject !== null && diagnosticData.rawDatabaseValues.subject !== undefined
                              ? String(diagnosticData.rawDatabaseValues.subject)
                              : 'NULL'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600 mb-1">Module</div>
                          <div className={`font-bold ${diagnosticData.rawDatabaseValues.moduleIsNull ? 'text-red-700' : 'text-green-700'}`}>
                            {diagnosticData.rawDatabaseValues.module !== null && diagnosticData.rawDatabaseValues.module !== undefined
                              ? String(diagnosticData.rawDatabaseValues.module)
                              : 'NULL'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600 mb-1">Grade</div>
                          <div className="font-bold text-slate-700">
                            {diagnosticData.rawDatabaseValues.grade || 'NULL'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600 mb-1">Unit</div>
                          <div className="font-bold text-slate-700">
                            {diagnosticData.rawDatabaseValues.unit || 'NULL'}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-slate-600 mb-1">Lesson</div>
                          <div className="font-bold text-slate-700">
                            {diagnosticData.rawDatabaseValues.lesson || 'NULL'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Test Cases */}
                  {diagnosticData.analysis && diagnosticData.analysis.testCases && diagnosticData.analysis.testCases.length > 0 && (
                    <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                        <Info className="w-5 h-5" />
                        Test Cases - Why Values Are Not Fetched
                      </h3>
                      {diagnosticData.analysis.testSummary && (
                        <div className="mb-4 p-3 bg-white rounded-lg">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-700">Test Results:</span>
                            <span className={`font-bold ${
                              diagnosticData.analysis.testSummary.passed === diagnosticData.analysis.testSummary.total
                                ? 'text-green-700'
                                : 'text-red-700'
                            }`}>
                              {diagnosticData.analysis.testSummary.passed}/{diagnosticData.analysis.testSummary.total} Passed ({diagnosticData.analysis.testSummary.passRate})
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="space-y-3">
                        {diagnosticData.analysis.testCases.map((testCase, index) => (
                          <div key={index} className={`p-4 rounded-lg border-2 ${
                            testCase.status === 'passed'
                              ? 'bg-green-50 border-green-200'
                              : testCase.status === 'failed'
                              ? 'bg-red-50 border-red-200'
                              : testCase.status === 'skipped'
                              ? 'bg-slate-100 border-slate-300'
                              : 'bg-yellow-50 border-yellow-200'
                          }`}>
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {testCase.status === 'passed' ? (
                                  <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                                ) : testCase.status === 'failed' ? (
                                  <X className="w-5 h-5 text-red-600 flex-shrink-0" />
                                ) : (
                                  <Info className="w-5 h-5 text-slate-600 flex-shrink-0" />
                                )}
                                <span className="font-bold text-slate-900">{testCase.name}</span>
                                <span className={`px-2 py-1 rounded text-xs font-bold ${
                                  testCase.status === 'passed'
                                    ? 'bg-green-200 text-green-800'
                                    : testCase.status === 'failed'
                                    ? 'bg-red-200 text-red-800'
                                    : 'bg-slate-200 text-slate-800'
                                }`}>
                                  {testCase.status.toUpperCase()}
                                </span>
                              </div>
                            </div>
                            <p className="text-sm text-slate-600 mb-2">{testCase.description}</p>
                            {testCase.failureReason && (
                              <div className="mt-2 p-2 bg-red-100 rounded border border-red-300">
                                <p className="text-sm font-semibold text-red-800">❌ Failure Reason:</p>
                                <p className="text-sm text-red-700">{testCase.failureReason}</p>
                              </div>
                            )}
                            {testCase.details && Object.keys(testCase.details).length > 0 && (
                              <details className="mt-2">
                                <summary className="text-sm font-semibold text-slate-700 cursor-pointer hover:text-slate-900">
                                  View Details
                                </summary>
                                <pre className="mt-2 p-3 bg-white rounded text-xs overflow-x-auto border border-slate-200">
                                  {JSON.stringify(testCase.details, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Root Cause & Solution */}
                  {diagnosticData.analysis && (diagnosticData.analysis.rootCause || diagnosticData.analysis.solution) && (
                    <div className="bg-indigo-50 rounded-xl p-6 border border-indigo-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4">Root Cause & Solution</h3>
                      {diagnosticData.analysis.rootCause && (
                        <div className="mb-4 p-4 bg-white rounded-lg border border-indigo-300">
                          <p className="text-sm font-semibold text-indigo-900 mb-2">🔍 Root Cause:</p>
                          <p className="text-slate-700">{diagnosticData.analysis.rootCause}</p>
                        </div>
                      )}
                      {diagnosticData.analysis.solution && (
                        <div className="mb-4 p-4 bg-white rounded-lg border border-indigo-300">
                          <p className="text-sm font-semibold text-indigo-900 mb-2">✅ Solution:</p>
                          <p className="text-slate-700">{diagnosticData.analysis.solution}</p>
                        </div>
                      )}
                      
                      {/* Quick Fix Button */}
                      {diagnosticData.analysis && diagnosticData.analysis.subjectValueLost && (
                        <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border-2 border-green-300">
                          <p className="text-sm font-semibold text-green-900 mb-3">🚀 Quick Fix - Test Update Function:</p>
                          <p className="text-sm text-slate-700 mb-4">Click the button below to set test values (Subject: "1", Module: "1") and verify the update process works:</p>
                          <button
                            onClick={async () => {
                              try {
                                const videoId = diagnosticData.videoId;
                                const response = await api.post(`/videos/diagnostic/${videoId}/quick-fix`, {
                                  subject: '1',
                                  module: '1'
                                });
                                
                                if (response.data.success) {
                                  alert('✅ Quick fix successful! Values have been saved. Please refresh the page and run the diagnostic again to verify.');
                                  // Refresh the video list
                                  window.location.reload();
                                }
                              } catch (error) {
                                alert(`❌ Quick fix failed: ${error.response?.data?.message || error.message}`);
                              }
                            }}
                            className="w-full px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl font-bold hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
                          >
                            🔧 Set Test Values (Subject: "1", Module: "1")
                          </button>
                          <p className="text-xs text-slate-600 mt-2">This will update the video with test values to verify the update function works correctly.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Analysis */}
                  {diagnosticData.analysis && (
                    <div className="bg-yellow-50 rounded-xl p-6 border border-yellow-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4">Issues Found</h3>
                      {diagnosticData.analysis.issues && diagnosticData.analysis.issues.length > 0 ? (
                        <ul className="space-y-2">
                          {diagnosticData.analysis.issues.map((issue, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                              <span className="text-slate-700">{issue}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-green-700 font-semibold">✅ No issues detected! All values are being fetched correctly.</p>
                      )}
                    </div>
                  )}

                  {/* Recommendations */}
                  {diagnosticData.recommendations && diagnosticData.recommendations.length > 0 && (
                    <div className="bg-indigo-50 rounded-xl p-6 border border-indigo-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4">Recommendations</h3>
                      <ul className="space-y-2">
                        {diagnosticData.recommendations.map((rec, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <CheckCircle className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" />
                            <span className="text-slate-700">{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Checks */}
                  {diagnosticData.checks && diagnosticData.checks.length > 0 && (
                    <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
                      <h3 className="text-lg font-bold text-slate-900 mb-4">Detailed Checks</h3>
                      <div className="space-y-3">
                        {diagnosticData.checks.map((check, index) => (
                          <div key={index} className={`p-4 rounded-lg border-2 ${
                            check.status === 'pass' 
                              ? 'bg-green-50 border-green-200' 
                              : check.status === 'warning'
                              ? 'bg-yellow-50 border-yellow-200'
                              : 'bg-red-50 border-red-200'
                          }`}>
                            <div className="flex items-center gap-2 mb-2">
                              {check.status === 'pass' ? (
                                <CheckCircle className="w-5 h-5 text-green-600" />
                              ) : check.status === 'warning' ? (
                                <AlertCircle className="w-5 h-5 text-yellow-600" />
                              ) : (
                                <X className="w-5 h-5 text-red-600" />
                              )}
                              <span className="font-bold text-slate-900">{check.name}</span>
                              <span className={`px-2 py-1 rounded text-xs font-bold ${
                                check.status === 'pass'
                                  ? 'bg-green-200 text-green-800'
                                  : check.status === 'warning'
                                  ? 'bg-yellow-200 text-yellow-800'
                                  : 'bg-red-200 text-red-800'
                              }`}>
                                {check.status?.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-slate-700">{check.message}</p>
                            {check.details && (
                              <pre className="mt-2 p-3 bg-white rounded text-xs overflow-x-auto">
                                {JSON.stringify(check.details, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      
      {/* Pagination Controls */}
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1 || isRefreshing}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              currentPage === 1 || isRefreshing
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-700 border border-slate-300 shadow-sm'
            }`}
          >
            Previous
          </button>
          
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
              let pageNum;
              if (pagination.totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= pagination.totalPages - 2) {
                pageNum = pagination.totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              
              return (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  disabled={isRefreshing}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    currentPage === pageNum
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-700 border border-slate-300'
                  } ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>
          
          <button
            onClick={() => setCurrentPage(prev => Math.min(pagination.totalPages, prev + 1))}
            disabled={currentPage === pagination.totalPages || isRefreshing}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              currentPage === pagination.totalPages || isRefreshing
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-white text-slate-700 hover:bg-blue-50 hover:text-blue-700 border border-slate-300 shadow-sm'
            }`}
          >
            Next
          </button>
          
          <div className="ml-4 text-sm text-slate-600">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total videos)
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

export default VideoList;

