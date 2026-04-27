import { useEffect, useState } from 'react';
import { Download, Filter, FileCode, AlertCircle, Loader, Search } from 'lucide-react';
import api from '../services/api';

function HTMLEmbedExport() {
  const [filterValues, setFilterValues] = useState({
    subjects: [],
    grades: [],
    units: [],
    lessons: [],
    modules: [],
    versions: []
  });
  const [selectedFilters, setSelectedFilters] = useState({
    subject: 'all',
    grade: 'all',
    unit: 'all',
    lesson: 'all',
    module: 'all',
    version: 'all',
    title: ''
  });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadingSingle, setDownloadingSingle] = useState(null);
  const [error, setError] = useState(null);
  const [videoCount, setVideoCount] = useState(0);
  const [counting, setCounting] = useState(false);
  const [filteredVideos, setFilteredVideos] = useState([]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  useEffect(() => {
    loadFilterValues();
  }, []);

  // Reload filter options when subject changes (including when reset to 'all')
  useEffect(() => {
    loadFilterValues(selectedFilters.subject);
  }, [selectedFilters.subject]);

  useEffect(() => {
    if (filterValues.subjects.length > 0) {
      countVideos();
      loadFilteredVideos();
    }
  }, [selectedFilters, filterValues]);

  const loadFilterValues = async (subject = null) => {
    try {
      setLoading(true);
      setError(null);
      // Pass subject filter to get filtered options
      // Use provided subject parameter or current state
      const currentSubject = subject !== null ? subject : selectedFilters.subject;
      const params = {};
      if (currentSubject && currentSubject !== 'all') {
        params.subject = currentSubject;
      }
      const response = await api.get('/videos/filters', { params });
      
      if (response.data) {
        setFilterValues({
          subjects: response.data.subjects || [],
          grades: response.data.grades || [],
          units: response.data.units || [],
          lessons: response.data.lessons || [],
          modules: response.data.modules || [],
          versions: response.data.versions || []
        });
      }
    } catch (err) {
      console.error('Failed to load filter values:', err);
      setError('Failed to load filter options');
    } finally {
      setLoading(false);
    }
  };

  const countVideos = async () => {
    try {
      setCounting(true);
      const params = buildFilterParams();

      const response = await api.get('/videos', { 
        params: {
          ...params,
          status: 'active',
          limit: 10000
        }
      });
      
      let videos = [];
      if (Array.isArray(response.data)) {
        videos = response.data;
      } else if (response.data && response.data.videos) {
        videos = response.data.videos || [];
        
        const pagination = response.data.pagination;
        if (pagination && pagination.totalPages > 1) {
          const allVideos = [...videos];
          
          for (let page = 2; page <= pagination.totalPages; page++) {
            const pageResponse = await api.get('/videos', {
              params: {
                ...params,
                status: 'active',
                limit: 10000,
                page: page
              }
            });
            
            if (pageResponse.data && pageResponse.data.videos) {
              allVideos.push(...pageResponse.data.videos);
            } else if (Array.isArray(pageResponse.data)) {
              allVideos.push(...pageResponse.data);
            }
          }
          
          videos = allVideos;
        }
      }
      
      const videosWithQR = videos.filter(video => 
        video.redirect_slug && video.redirect_slug.trim() !== ''
      );
      
      setVideoCount(videosWithQR.length);
    } catch (err) {
      console.error('Failed to count videos:', err);
      setVideoCount(0);
    } finally {
      setCounting(false);
    }
  };

  const buildFilterParams = () => {
    const params = {};
    if (selectedFilters.subject !== 'all') {
      params.subject = selectedFilters.subject;
    }
    if (selectedFilters.grade !== 'all') {
      params.grade = selectedFilters.grade;
    }
    if (selectedFilters.unit !== 'all') {
      params.unit = selectedFilters.unit;
    }
    if (selectedFilters.lesson !== 'all') {
      params.lesson = selectedFilters.lesson;
    }
    if (selectedFilters.module !== 'all') {
      params.module = selectedFilters.module;
    }
    if (selectedFilters.version !== 'all') {
      params.version = selectedFilters.version;
    }
    if (selectedFilters.title && selectedFilters.title.trim() !== '') {
      params.search = selectedFilters.title.trim();
    }
    return params;
  };

  const loadFilteredVideos = async () => {
    try {
      setLoadingVideos(true);
      const params = buildFilterParams();

      const response = await api.get('/videos', { 
        params: {
          ...params,
          status: 'active',
          limit: 10000
        }
      });
      
      let videos = [];
      if (Array.isArray(response.data)) {
        videos = response.data;
      } else if (response.data && response.data.videos) {
        videos = response.data.videos || [];
        
        const pagination = response.data.pagination;
        if (pagination && pagination.totalPages > 1) {
          const allVideos = [...videos];
          
          for (let page = 2; page <= pagination.totalPages; page++) {
            const pageResponse = await api.get('/videos', {
              params: {
                ...params,
                status: 'active',
                limit: 10000,
                page: page
              }
            });
            
            if (pageResponse.data && pageResponse.data.videos) {
              allVideos.push(...pageResponse.data.videos);
            } else if (Array.isArray(pageResponse.data)) {
              allVideos.push(...pageResponse.data);
            }
          }
          
          videos = allVideos;
        }
      }
      
      const videosWithQR = videos.filter(video => 
        video.redirect_slug && video.redirect_slug.trim() !== ''
      );
      
      // Generate filename for each video
      const videosWithFilenames = videosWithQR.map(video => {
        const videoTitle = video.title || video.video_id || 'Untitled Video';
        const filename = videoTitle
          .replace(/\s+/g, '-')
          .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
          + '.html';
        return {
          ...video,
          htmlFilename: filename
        };
      });
      
      setFilteredVideos(videosWithFilenames);
    } catch (err) {
      console.error('Failed to load filtered videos:', err);
      setFilteredVideos([]);
    } finally {
      setLoadingVideos(false);
    }
  };

  const handleDownloadSingle = async (video) => {
    try {
      setDownloadingSingle(video.video_id);
      setError(null);

      // Build query parameters for single video
      const params = {
        video_id: video.video_id
      };

      // Fetch HTML file from backend
      const response = await api.get('/videos/export-html-embeds', {
        params: params
      });

      if (!response.data.success || !response.data.files || response.data.files.length === 0) {
        throw new Error('No HTML file generated');
      }

      // Download the single HTML file
      const file = response.data.files[0];
      const blob = new Blob([file.content], { type: 'text/html' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', file.filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download HTML file:', err);
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to download HTML file';
      alert(`Failed to download: ${errorMessage}`);
    } finally {
      setDownloadingSingle(null);
    }
  };

  const handleDownloadHTML = async () => {
    try {
      setDownloading(true);
      setError(null);

      // Build query parameters
      const params = buildFilterParams();

      // Fetch HTML files from backend
      const response = await api.get('/videos/export-html-embeds', {
        params: params
      });

      if (!response.data.success || !response.data.files || response.data.files.length === 0) {
        throw new Error('No HTML files generated');
      }

      // Check if browser supports File System Access API (for folder selection)
      if ('showDirectoryPicker' in window) {
        // Modern browsers: Allow user to select folder
        try {
          const directoryHandle = await window.showDirectoryPicker({
            mode: 'readwrite'
          });
          
          // Save all HTML files to selected folder
          for (const file of response.data.files) {
            const fileHandle = await directoryHandle.getFileHandle(file.filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(file.content);
            await writable.close();
          }
          
          alert(`Successfully saved ${response.data.files.length} HTML files to the selected folder!`);
          return;
        } catch (folderError) {
          if (folderError.name === 'AbortError') {
            // User cancelled folder selection
            return;
          }
          console.warn('Folder selection failed, falling back to individual downloads:', folderError);
          // Fall through to individual file downloads
        }
      }

      // Fallback: Download individual HTML files
      // Download files one by one with a small delay to avoid browser blocking
      for (let i = 0; i < response.data.files.length; i++) {
        const file = response.data.files[i];
        const blob = new Blob([file.content], { type: 'text/html' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', file.filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        
        // Small delay between downloads to avoid browser blocking
        if (i < response.data.files.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      alert(`Downloaded ${response.data.files.length} HTML files!`);
    } catch (err) {
      console.error('Failed to download HTML embeds:', err);
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to download HTML embed files';
      setError(errorMessage);
    } finally {
      setDownloading(false);
    }
  };

  const handleFilterChange = (filterType, value) => {
    setSelectedFilters(prev => {
      const newFilters = { ...prev, [filterType]: value };
      
      // When subject changes, reset dependent filters
      if (filterType === 'subject') {
        newFilters.grade = 'all';
        newFilters.unit = 'all';
        newFilters.lesson = 'all';
        newFilters.module = 'all';
        newFilters.version = 'all';
      }
      
      return newFilters;
    });
  };

  const resetFilters = () => {
    setSelectedFilters({
      subject: 'all',
      grade: 'all',
      unit: 'all',
      lesson: 'all',
      module: 'all',
      version: 'all',
      title: ''
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading filter options...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="w-full p-4 sm:p-6 lg:p-8 xl:p-10">
        {/* Header Container */}
        <div className="mb-8 lg:mb-10">
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 bg-gradient-to-br from-purple-500 via-indigo-500 to-blue-600 rounded-2xl shadow-xl shadow-purple-500/20">
              <FileCode className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">HTML Embed Export</h1>
              
            </div>
          </div>
        </div>

        {/* Filters Container */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-200 p-6 sm:p-8 mb-6 lg:mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Filter className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Filter Videos</h2>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border-2 border-red-200 rounded-xl">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" />
                <p className="text-red-700 font-semibold">{error}</p>
              </div>
            </div>
          )}

          {/* Title Filter - Full Width */}
          <div className="mb-6">
            <label className="block text-sm font-bold text-slate-700 mb-2">
              <Search className="w-4 h-4 inline mr-2" />
              Filter by Title
            </label>
            <input
              type="text"
              value={selectedFilters.title}
              onChange={(e) => handleFilterChange('title', e.target.value)}
              placeholder="Search videos by title..."
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-6">
            {/* Subject Filter */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Subject
              </label>
              <select
                value={selectedFilters.subject}
                onChange={(e) => handleFilterChange('subject', e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
              >
                <option value="all">All Subjects</option>
                {filterValues.subjects
                  .filter(s => s && s.trim() !== '')
                  .sort()
                  .map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
              </select>
            </div>

            {/* Grade Filter */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Grade
              </label>
              <select
                value={selectedFilters.grade}
                onChange={(e) => handleFilterChange('grade', e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
              >
                <option value="all">All Grades</option>
                {filterValues.grades
                  .filter(g => g !== null && g !== undefined && String(g).trim() !== '')
                  .sort((a, b) => {
                    const numA = parseInt(a) || 0;
                    const numB = parseInt(b) || 0;
                    return numA - numB;
                  })
                  .map((grade) => (
                    <option key={grade} value={grade}>
                      Grade {grade}
                    </option>
                  ))}
              </select>
            </div>

            {/* Unit Filter */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Unit
              </label>
              <select
                value={selectedFilters.unit}
                onChange={(e) => handleFilterChange('unit', e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
              >
                <option value="all">All Units</option>
                {filterValues.units
                  .filter(u => u !== null && u !== undefined && String(u).trim() !== '')
                  .sort((a, b) => {
                    const numA = parseInt(a) || 0;
                    const numB = parseInt(b) || 0;
                    return numA - numB;
                  })
                  .map((unit) => (
                    <option key={unit} value={unit}>
                      Unit {unit}
                    </option>
                  ))}
              </select>
            </div>

            {/* Lesson Filter */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Lesson
              </label>
              <select
                value={selectedFilters.lesson}
                onChange={(e) => handleFilterChange('lesson', e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
              >
                <option value="all">All Lessons</option>
                {filterValues.lessons
                  .filter(l => l !== null && l !== undefined && String(l).trim() !== '')
                  .sort((a, b) => {
                    const numA = parseInt(a) || 0;
                    const numB = parseInt(b) || 0;
                    return numA - numB;
                  })
                  .map((lesson) => (
                    <option key={lesson} value={lesson}>
                      Lesson {lesson}
                    </option>
                  ))}
              </select>
            </div>

            {/* Module Filter */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Module
              </label>
              <select
                value={selectedFilters.module}
                onChange={(e) => handleFilterChange('module', e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
              >
                <option value="all">All Modules</option>
                {filterValues.modules
                  .filter(m => m !== null && m !== undefined && String(m).trim() !== '')
                  .sort((a, b) => {
                    const numA = Number(a);
                    const numB = Number(b);
                    if (!isNaN(numA) && !isNaN(numB)) {
                      return numA - numB;
                    }
                    return String(a).localeCompare(String(b));
                  })
                  .map((module) => (
                    <option key={module} value={module}>
                      Module {module}
                    </option>
                  ))}
              </select>
            </div>

            {/* Version Filter */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                Version
              </label>
              <select
                value={selectedFilters.version}
                onChange={(e) => handleFilterChange('version', e.target.value)}
                className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
              >
                <option value="all">All Versions</option>
                {filterValues.versions
                  .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
                  .sort((a, b) => {
                    const numA = parseFloat(a);
                    const numB = parseFloat(b);
                    if (!isNaN(numA) && !isNaN(numB)) {
                      return numA - numB;
                    }
                    return String(a).localeCompare(String(b));
                  })
                  .map((version) => (
                    <option key={version} value={version}>
                      Version {version}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Filter Summary and Actions */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-6 border-t-2 border-slate-200">
            <div className="flex items-center gap-4">
              <div className="px-5 py-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border-2 border-purple-200 shadow-sm">
                {counting ? (
                  <div className="flex items-center gap-2">
                    <Loader className="w-4 h-4 animate-spin text-purple-600" />
                    <span className="text-sm font-bold text-purple-700">Counting...</span>
                  </div>
                ) : (
                  <span className="text-sm font-bold text-purple-700">
                    {videoCount} {videoCount === 1 ? 'Video' : 'Videos'} Found
                  </span>
                )}
              </div>
              {(selectedFilters.subject !== 'all' || selectedFilters.grade !== 'all' || selectedFilters.unit !== 'all' || selectedFilters.lesson !== 'all' || selectedFilters.module !== 'all' || selectedFilters.version !== 'all' || selectedFilters.title.trim() !== '') && (
                <button
                  onClick={resetFilters}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-colors font-semibold text-sm"
                >
                  Reset Filters
                </button>
              )}
            </div>
            <button
              onClick={handleDownloadHTML}
              disabled={downloading || videoCount === 0}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all font-bold text-sm shadow-lg hover:shadow-xl transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              {downloading ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  <span>Downloading HTML Files...</span>
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  <span>Download HTML Files</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Filtered Videos List */}
        {filteredVideos.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-200 p-6 sm:p-8 mb-6 lg:mb-8">
            <div className="flex items-center gap-3 mb-6">
              <FileCode className="w-6 h-6 text-indigo-600" />
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                Filtered Videos ({filteredVideos.length})
              </h2>
            </div>

            {loadingVideos ? (
              <div className="flex items-center justify-center py-12">
                <Loader className="w-6 h-6 animate-spin text-indigo-600 mr-3" />
                <span className="text-slate-600">Loading videos...</span>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {filteredVideos.map((video) => (
                  <div
                    key={video.video_id}
                    className="flex items-center justify-between p-4 bg-gradient-to-r from-slate-50 to-blue-50 rounded-xl border-2 border-slate-200 hover:border-indigo-300 transition-all"
                  >
                    <div className="flex-1 min-w-0 mr-4">
                      <div className="flex items-center gap-3">
                        <FileCode className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate">
                            {video.title || video.video_id || 'Untitled Video'}
                          </h3>
                          <p className="text-xs sm:text-sm text-slate-600 mt-1 truncate">
                            File: <span className="font-mono font-semibold">{video.htmlFilename}</span>
                          </p>
                          {video.video_id && (
                            <p className="text-xs text-slate-500 mt-1">
                              ID: <span className="font-mono">{video.video_id}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownloadSingle(video)}
                      disabled={downloadingSingle === video.video_id}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all font-semibold text-sm shadow-md hover:shadow-lg transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex-shrink-0"
                    >
                      {downloadingSingle === video.video_id ? (
                        <>
                          <Loader className="w-4 h-4 animate-spin" />
                          <span className="hidden sm:inline">Downloading...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span className="hidden sm:inline">Download</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info Section */}
        {filteredVideos.length === 0 && !loadingVideos && filterValues.subjects.length > 0 && (
          <div className="bg-blue-50 rounded-2xl border-2 border-blue-200 p-6 text-center">
            <p className="text-blue-700 font-semibold">
              No videos found matching the current filters. Try adjusting your search criteria.
            </p>
          </div>
        )}
        
      </div>
    </div>
  );
}

export default HTMLEmbedExport;





