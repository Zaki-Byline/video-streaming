import { useEffect, useState } from 'react';
import { Download, Copy, Check, Search, Filter, AlertCircle, Settings, CheckSquare, Square } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import api from '../services/api';
import QRCodeDiagnostic from '../components/QRCodeDiagnostic';
import QRCodeViewer from '../components/QRCodeViewer';

// Safe QR Code component wrapper
function SafeQRCode({ value, size = 160 }) {
  const [hasError, setHasError] = useState(false);
  
  if (hasError || !value) {
    return (
      <div className="w-40 h-40 flex items-center justify-center text-red-500 text-xs text-center p-4">
        <div>
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>QR Code Error</p>
        </div>
      </div>
    );
  }
  
  try {
    return (
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        onError={() => setHasError(true)}
      />
    );
  } catch (err) {
    console.error('QR Code rendering error:', err);
    return (
      <div className="w-40 h-40 flex items-center justify-center text-red-500 text-xs text-center p-4">
        <div>
          <AlertCircle className="w-8 h-8 mx-auto mb-2" />
          <p>Render Error</p>
        </div>
      </div>
    );
  }
}

function QRCodeStorage() {
  const [qrCodes, setQrCodes] = useState([]);
  const [filteredQrCodes, setFilteredQrCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  
  // Filter options (Subject, Grade, Unit, Lesson, Module, Version)
  const [filterOptions, setFilterOptions] = useState({
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
    version: 'all'
  });
  
  // Selection for bulk download
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [downloadingIds, setDownloadingIds] = useState(new Set());
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);

  useEffect(() => {
    loadQRCodes();
    loadFilterOptions();
  }, []);

  // Reload filter options when subject changes (including when reset to 'all')
  useEffect(() => {
    loadFilterOptions(selectedFilters.subject);
  }, [selectedFilters.subject]);

  useEffect(() => {
    filterQRCodes();
  }, [searchTerm, selectedFilter, selectedFilters, qrCodes]);

  const loadQRCodes = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/videos/qr-codes');
      
      // Validate response data
      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid response format from server');
      }
      
      // Validate each QR code has required fields
      const validQRCodes = response.data.filter(item => {
        return item && item.videoId && item.shortUrl;
      });
      
      if (validQRCodes.length < response.data.length) {
        console.warn(`Filtered out ${response.data.length - validQRCodes.length} invalid QR codes`);
      }
      
      setQrCodes(validQRCodes);
      setFilteredQrCodes(validQRCodes);
    } catch (err) {
      console.error('Failed to load QR codes:', err);
      const errorMessage = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to load QR codes';
      setError(errorMessage);
      
      // Provide helpful error messages
      if (err.response?.status === 401) {
        setError('Authentication required. Please log in again.');
      } else if (err.response?.status === 403) {
        setError('Access forbidden. You do not have permission to view QR codes.');
      } else if (err.response?.status === 404) {
        setError('QR codes endpoint not found. Please check backend configuration.');
      } else if (err.response?.status >= 500) {
        setError('Server error. Please try again later or contact support.');
      } else if (!err.response) {
        setError('Network error. Please check your connection and ensure the backend server is running.');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadFilterOptions = async (subject = null) => {
    try {
      // Pass subject filter to get filtered options
      // Use provided subject parameter or current state
      const currentSubject = subject !== null ? subject : selectedFilters.subject;
      const params = {};
      if (currentSubject && currentSubject !== 'all') {
        params.subject = currentSubject;
      }
      const response = await api.get('/videos/filters', { params });
      if (response.data) {
        setFilterOptions({
          subjects: response.data.subjects || [],
          grades: response.data.grades || [],
          units: response.data.units || [],
          lessons: response.data.lessons || [],
          modules: response.data.modules || [],
          versions: response.data.versions || []
        });
      }
    } catch (err) {
      console.error('Failed to load filter options:', err);
    }
  };

  const filterQRCodes = () => {
    let filtered = [...qrCodes];

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(item =>
        item.title?.toLowerCase().includes(term) ||
        item.videoId?.toLowerCase().includes(term) ||
        item.course?.toLowerCase().includes(term) ||
        item.grade?.toString().includes(term) ||
        item.lesson?.toLowerCase().includes(term) ||
        item.module?.toLowerCase().includes(term) ||
        item.version?.toString().includes(term) ||
        item.shortSlug?.toLowerCase().includes(term)
      );
    }

    // Apply Subject, Grade, Unit, Lesson, Module, Version filters
    if (selectedFilters.subject !== 'all') {
      filtered = filtered.filter(item => {
        const itemSubject = item.subject || item.course || '';
        return String(itemSubject).toLowerCase() === String(selectedFilters.subject).toLowerCase();
      });
    }
    if (selectedFilters.grade !== 'all') {
      filtered = filtered.filter(item => {
        return String(item.grade || '') === String(selectedFilters.grade);
      });
    }
    if (selectedFilters.unit !== 'all') {
      filtered = filtered.filter(item => {
        return String(item.unit || '') === String(selectedFilters.unit);
      });
    }
    if (selectedFilters.lesson !== 'all') {
      filtered = filtered.filter(item => {
        return String(item.lesson || '') === String(selectedFilters.lesson);
      });
    }
    if (selectedFilters.module !== 'all') {
      filtered = filtered.filter(item => {
        return String(item.module || '') === String(selectedFilters.module);
      });
    }
    if (selectedFilters.version !== 'all') {
      filtered = filtered.filter(item => {
        return String(item.version || '') === String(selectedFilters.version);
      });
    }

    // Apply category filter (legacy)
    if (selectedFilter !== 'all') {
      filtered = filtered.filter(item => {
        switch (selectedFilter) {
          case 'course':
            return item.course;
          case 'grade':
            return item.grade;
          case 'lesson':
            return item.lesson;
          default:
            return true;
        }
      });
    }

    setFilteredQrCodes(filtered);
  };

  const handleCopy = async (url, id) => {
    try {
      if (!navigator.clipboard) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
        return;
      }
      
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy URL to clipboard. Please copy manually: ' + url);
    }
  };

  const handleDownloadQR = async (videoId, videoData) => {
    try {
      console.log('Downloading QR code for video:', videoId);
      
      if (!videoId) {
        throw new Error('Video ID is required');
      }
      
      setDownloadingIds(prev => new Set(prev).add(videoId));
      
      // Find the SVG element in the displayed QR code
      // The QRCodeViewer component renders an SVG with QRCodeSVG
      const cardElement = document.querySelector(`[data-video-id="${videoId}"]`);
      if (!cardElement) {
        throw new Error('QR code element not found on page');
      }
      
      // Find the SVG element inside the card
      const svgElement = cardElement.querySelector('svg');
      if (!svgElement) {
        throw new Error('SVG QR code not found');
      }
      
      // Clone the SVG to avoid modifying the original
      const clonedSvg = svgElement.cloneNode(true);
      
      // Get the SVG as a string
      const svgString = new XMLSerializer().serializeToString(clonedSvg);
      
      // Generate filename using Video Title as primary identifier
      // Format: Video_Title_G1_U1_L1_M1_V1.svg
      const safeTitle = (videoData?.title || '')
        .trim()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_');

      const parts = [];
      if (safeTitle)          parts.push(safeTitle);
      if (videoData?.grade)   parts.push(`G${videoData.grade}`);
      if (videoData?.unit)    parts.push(`U${videoData.unit}`);
      if (videoData?.lesson)  parts.push(`L${videoData.lesson}`);
      if (videoData?.module)  parts.push(`M${videoData.module}`);
      if (videoData?.version) parts.push(`V${videoData.version}`);

      const filename = parts.length > 0
        ? parts.join('_') + '.svg'
        : `${videoId}_qr_code.svg`;
      
      // Create blob with SVG content
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = window.URL.createObjectURL(blob);
      
      // Create download link
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      console.log('QR code downloaded successfully as:', filename);
    } catch (err) {
      console.error('Failed to download QR code:', err);
      let errorMessage = 'Unknown error';
      
      if (err.message) {
        errorMessage = err.message;
      } else if (err.response?.data?.message) {
        errorMessage = err.response.data.message;
      } else if (err.response?.data?.error) {
        errorMessage = err.response.data.error;
      }
      
      alert(`Failed to download QR code: ${errorMessage}`);
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
    }
  };

  // Selection handlers
  const handleSelectAll = () => {
    if (selectedIds.size === filteredQrCodes.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredQrCodes.map(item => item.videoId)));
    }
  };

  const handleSelectItem = (videoId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(videoId)) {
        next.delete(videoId);
      } else {
        next.add(videoId);
      }
      return next;
    });
  };

  // Helper function to download a single QR code to a file handle
  const downloadQRToFile = async (videoId, videoData, fileHandle) => {
    try {
      // Find the SVG element in the displayed QR code
      const cardElement = document.querySelector(`[data-video-id="${videoId}"]`);
      if (!cardElement) {
        throw new Error('QR code element not found on page');
      }
      
      // Find the SVG element inside the card
      const svgElement = cardElement.querySelector('svg');
      if (!svgElement) {
        throw new Error('SVG QR code not found');
      }
      
      // Clone the SVG to avoid modifying the original
      const clonedSvg = svgElement.cloneNode(true);
      
      // Get the SVG as a string
      const svgString = new XMLSerializer().serializeToString(clonedSvg);
      
      // Generate filename using Video Title as primary identifier
      // Format: Video_Title_G1_U1_L1_M1_V1.svg
      const safeTitle = (videoData?.title || '')
        .trim()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_');

      const parts = [];
      if (safeTitle)          parts.push(safeTitle);
      if (videoData?.grade)   parts.push(`G${videoData.grade}`);
      if (videoData?.unit)    parts.push(`U${videoData.unit}`);
      if (videoData?.lesson)  parts.push(`L${videoData.lesson}`);
      if (videoData?.module)  parts.push(`M${videoData.module}`);
      if (videoData?.version) parts.push(`V${videoData.version}`);

      const filename = parts.length > 0
        ? parts.join('_') + '.svg'
        : `${videoId}_qr_code.svg`;
      
      // Create blob with SVG content
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      
      // Create file in the selected folder
      const file = await fileHandle.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
      
      return filename;
    } catch (err) {
      console.error(`Failed to download QR code for ${videoId}:`, err);
      throw err;
    }
  };

  // Smart bulk download handler - determines what to download and opens folder picker
  const handleSmartBulkDownload = async () => {
    let itemsToDownload = [];
    let downloadType = '';
    
    // Determine what to download based on selection and filters
    if (selectedIds.size > 0) {
      // If items are selected, download only selected
      itemsToDownload = filteredQrCodes.filter(item => selectedIds.has(item.videoId));
      downloadType = 'selected';
    } else {
      // Check if filters are applied
      const hasFilters = selectedFilters.subject !== 'all' || 
                        selectedFilters.grade !== 'all' || 
                        selectedFilters.unit !== 'all' ||
                        selectedFilters.lesson !== 'all' ||
                        selectedFilters.module !== 'all' ||
                        selectedFilters.version !== 'all' ||
                        searchTerm.trim() !== '';
      
      if (hasFilters) {
        // If filters are applied, download filtered items
        itemsToDownload = filteredQrCodes;
        downloadType = 'filtered';
      } else {
        // Otherwise, download all
        itemsToDownload = qrCodes;
        downloadType = 'all';
      }
    }

    if (itemsToDownload.length === 0) {
      alert('No QR codes to download');
      return;
    }

    // Check if File System Access API is supported
    if (!window.showDirectoryPicker) {
      // Fallback: Use traditional download method (downloads to default Downloads folder)
      const confirmMessage = `Download ${itemsToDownload.length} QR code${itemsToDownload.length > 1 ? 's' : ''}? They will be saved to your default Downloads folder.`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
      
      setIsBulkDownloading(true);
      try {
        for (let i = 0; i < itemsToDownload.length; i++) {
          const item = itemsToDownload[i];
          setDownloadingIds(prev => new Set(prev).add(item.videoId));
          try {
            await handleDownloadQR(item.videoId, item);
            if (i < itemsToDownload.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } catch (err) {
            console.error(`Failed to download QR code for ${item.videoId}:`, err);
          } finally {
            setDownloadingIds(prev => {
              const next = new Set(prev);
              next.delete(item.videoId);
              return next;
            });
          }
        }
        alert(`Successfully downloaded ${itemsToDownload.length} QR code${itemsToDownload.length > 1 ? 's' : ''}`);
      } finally {
        setIsBulkDownloading(false);
        if (downloadType === 'selected') {
          setSelectedIds(new Set());
        }
      }
      return;
    }

    // Use File System Access API to select folder
    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite'
      });
      
      const confirmMessage = `Download ${itemsToDownload.length} QR code${itemsToDownload.length > 1 ? 's' : ''} to the selected folder?`;
      if (!window.confirm(confirmMessage)) {
        return;
      }

      setIsBulkDownloading(true);
      let successCount = 0;
      let failCount = 0;

      // Download all QR codes to the selected folder
      for (let i = 0; i < itemsToDownload.length; i++) {
        const item = itemsToDownload[i];
        setDownloadingIds(prev => new Set(prev).add(item.videoId));
        try {
          await downloadQRToFile(item.videoId, item, directoryHandle);
          successCount++;
          console.log(`Downloaded QR code ${i + 1}/${itemsToDownload.length}: ${item.videoId}`);
        } catch (err) {
          failCount++;
          console.error(`Failed to download QR code for ${item.videoId}:`, err);
        } finally {
          setDownloadingIds(prev => {
            const next = new Set(prev);
            next.delete(item.videoId);
            return next;
          });
        }
        
        // Small delay between downloads
        if (i < itemsToDownload.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

      setIsBulkDownloading(false);
      
      if (successCount > 0) {
        alert(`Successfully downloaded ${successCount} QR code${successCount > 1 ? 's' : ''} to the selected folder${failCount > 0 ? ` (${failCount} failed)` : ''}`);
      } else {
        alert(`Failed to download QR codes. Please try again.`);
      }
      
      // Clear selection after bulk download
      if (downloadType === 'selected') {
        setSelectedIds(new Set());
      }
    } catch (err) {
      setIsBulkDownloading(false);
      if (err.name === 'AbortError' || err.name === 'NotAllowedError') {
        // User cancelled or denied permission
        console.log('Folder selection cancelled or permission denied');
      } else {
        console.error('Failed to select folder:', err);
        alert('Failed to select folder. Please try again.');
      }
    }
  };

  // Get download button text based on current state
  const getDownloadButtonText = () => {
    if (isBulkDownloading) {
      return 'Downloading...';
    }
    
    if (selectedIds.size > 0) {
      return `Download Selected (${selectedIds.size})`;
    }
    
    const hasFilters = selectedFilters.subject !== 'all' || 
                      selectedFilters.grade !== 'all' || 
                      selectedFilters.unit !== 'all' ||
                      selectedFilters.lesson !== 'all' ||
                      selectedFilters.module !== 'all' ||
                      selectedFilters.version !== 'all' ||
                      searchTerm.trim() !== '';
    
    if (hasFilters) {
      return `Download Filtered (${filteredQrCodes.length})`;
    }
    
    return `Download All (${qrCodes.length})`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading QR codes...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="mb-4">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto" />
          </div>
          <h1 className="text-2xl font-bold text-red-600 mb-2">Error Loading QR Codes</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={loadQRCodes}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-semibold transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => setShowDiagnostic(true)}
              className="px-4 py-2 bg-gray-600 text-white rounded-xl hover:bg-gray-700 font-semibold transition-colors flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Run Diagnostics
            </button>
          </div>
        </div>
        {showDiagnostic && <QRCodeDiagnostic onClose={() => setShowDiagnostic(false)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="w-full p-4 sm:p-6 lg:p-8 xl:p-10">
        {/* Header Container */}
        <div className="mb-8 lg:mb-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-2xl shadow-xl shadow-blue-500/20">
                <Filter className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2">QR Code Storage</h1>
                <p className="text-slate-600 text-base sm:text-lg">Manage and download QR codes with short links for all your videos</p>
              </div>
            </div>
            <button
              onClick={() => setShowDiagnostic(true)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold transition-colors flex items-center gap-2 shadow-sm"
              title="Run diagnostics to check for errors"
            >
              <Settings className="w-5 h-5" />
              <span className="hidden sm:inline">Diagnostics</span>
            </button>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-200 p-6 sm:p-8 mb-6 lg:mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Filter className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900">Filters</h2>
          </div>

          <div className="flex flex-col gap-4 mb-6">
            {/* Search */}
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 w-5 h-5 z-10" />
              <input
                type="text"
                placeholder="Search by title, video ID, course, grade, lesson..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px]"
              />
            </div>

            {/* Subject, Grade, Unit, Lesson, Module, Version Filters */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {/* Subject Filter */}
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">
                  Subject
                </label>
                <select
                  value={selectedFilters.subject}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedFilters(prev => {
                      const newFilters = { ...prev, subject: value };
                      // Reset dependent filters when subject changes
                      if (value === 'all' || prev.subject !== value) {
                        newFilters.grade = 'all';
                        newFilters.unit = 'all';
                        newFilters.lesson = 'all';
                        newFilters.module = 'all';
                        newFilters.version = 'all';
                      }
                      return newFilters;
                    });
                  }}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
                >
                  <option value="all">All Subjects</option>
                  {filterOptions.subjects
                    .filter(s => s && s.trim() !== '')
                    .map(subject => (
                      <option key={subject} value={subject}>{subject}</option>
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
                  onChange={(e) => setSelectedFilters(prev => ({ ...prev, grade: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
                >
                  <option value="all">All Grades</option>
                  {filterOptions.grades
                    .filter(g => g !== null && g !== undefined && String(g).trim() !== '')
                    .sort((a, b) => Number(a) - Number(b))
                    .map(grade => (
                      <option key={grade} value={grade}>Grade {grade}</option>
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
                  onChange={(e) => setSelectedFilters(prev => ({ ...prev, unit: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
                >
                  <option value="all">All Units</option>
                  {filterOptions.units
                    .filter(u => u !== null && u !== undefined && String(u).trim() !== '')
                    .sort((a, b) => {
                      // Try to sort numerically first, then alphabetically
                      const numA = Number(a);
                      const numB = Number(b);
                      if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                      }
                      return String(a).localeCompare(String(b));
                    })
                    .map(unit => (
                      <option key={unit} value={unit}>Unit {unit}</option>
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
                  onChange={(e) => setSelectedFilters(prev => ({ ...prev, lesson: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
                >
                  <option value="all">All Lessons</option>
                  {filterOptions.lessons
                    .filter(l => l !== null && l !== undefined && String(l).trim() !== '')
                    .sort((a, b) => Number(a) - Number(b))
                    .map(lesson => (
                      <option key={lesson} value={lesson}>Lesson {lesson}</option>
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
                  onChange={(e) => setSelectedFilters(prev => ({ ...prev, module: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
                >
                  <option value="all">All Modules</option>
                  {filterOptions.modules
                    .filter(m => m !== null && m !== undefined && String(m).trim() !== '')
                    .sort((a, b) => {
                      // Try to sort numerically first, then alphabetically
                      const numA = Number(a);
                      const numB = Number(b);
                      if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                      }
                      return String(a).localeCompare(String(b));
                    })
                    .map(module => (
                      <option key={module} value={module}>Module {module}</option>
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
                  onChange={(e) => setSelectedFilters(prev => ({ ...prev, version: e.target.value }))}
                  className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white hover:border-slate-300 transition-all text-[15px] font-medium cursor-pointer"
                >
                  <option value="all">All Versions</option>
                  {filterOptions.versions
                    .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
                    .sort((a, b) => {
                      // Sort versions numerically (handles floating point)
                      const numA = parseFloat(a);
                      const numB = parseFloat(b);
                      if (!isNaN(numA) && !isNaN(numB)) {
                        return numA - numB;
                      }
                      return String(a).localeCompare(String(b));
                    })
                    .map(version => (
                      <option key={version} value={version}>Version {version}</option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          {/* Bulk Download Actions */}
          <div className="flex flex-wrap items-center gap-4 pt-4 border-t-2 border-slate-200">
            {/* Selection Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleSelectAll}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold transition-colors"
              >
                {selectedIds.size === filteredQrCodes.length && filteredQrCodes.length > 0 ? (
                  <CheckSquare className="w-5 h-5" />
                ) : (
                  <Square className="w-5 h-5" />
                )}
                <span>Select All ({selectedIds.size}/{filteredQrCodes.length})</span>
              </button>
            </div>

            {/* Single Smart Download Button */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleSmartBulkDownload}
                disabled={isBulkDownloading || (qrCodes.length === 0 && filteredQrCodes.length === 0)}
                className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-bold transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBulkDownloading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Downloading...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-5 h-5" />
                    <span>{getDownloadButtonText()}</span>
                  </>
                )}
              </button>
            </div>

            {/* Count */}
            <div className="flex items-center px-5 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border-2 border-blue-200 shadow-sm ml-auto">
              <span className="text-sm font-bold text-blue-700">
                {filteredQrCodes.length} {filteredQrCodes.length === 1 ? 'QR Code' : 'QR Codes'}
              </span>
            </div>
          </div>
        </div>

        {/* QR Codes Container */}
        <div className="bg-white rounded-2xl shadow-xl border-2 border-slate-200 p-6 sm:p-8">
          {filteredQrCodes.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-10 h-10 text-blue-500" />
              </div>
              <p className="text-slate-600 text-lg sm:text-xl font-bold mb-2">No QR codes found</p>
              <p className="text-slate-500 text-sm mb-6">Try adjusting your search or filters</p>
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedFilter('all');
                    setSelectedFilters({
                      subject: 'all',
                      grade: 'all',
                      unit: 'all',
                      lesson: 'all',
                      module: 'all',
                      version: 'all'
                    });
                  }}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all font-semibold shadow-lg hover:shadow-xl"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 lg:gap-8">
            {filteredQrCodes.map((item) => (
              <div
                key={`${item.videoId}_${item.version || 'no-version'}_${item.shortSlug || ''}`}
                data-video-id={item.videoId}
                className="bg-white rounded-2xl shadow-lg border-2 border-slate-200 p-5 sm:p-6 hover:shadow-2xl transition-all duration-300 hover:border-blue-400 transform hover:-translate-y-1 group"
              >
                {/* Selection Checkbox */}
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.videoId)}
                      onChange={() => handleSelectItem(item.videoId)}
                      className="w-5 h-5 text-blue-600 border-2 border-slate-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-slate-600">Select</span>
                  </label>
                  {downloadingIds.has(item.videoId) && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  )}
                </div>

                {/* QR Code */}
                <div className="mb-4">
                  <QRCodeViewer url={item.shortUrl} videoId={item.videoId} />
                </div>

                {/* Video Info */}
                <div className="mb-5">
                  <h3 className="font-bold text-lg sm:text-xl text-slate-900 mb-3 line-clamp-2 min-h-[3rem] group-hover:text-blue-600 transition-colors leading-tight">
                    {item.title || 'Untitled Video'}
                  </h3>
                  
                  <div className="flex flex-wrap gap-2 mb-4">
                    {item.course && (
                      <span className="px-3 py-1.5 bg-gradient-to-r from-blue-50 to-blue-100 text-blue-700 rounded-lg text-xs font-bold border border-blue-300 shadow-sm">
                        {item.course}
                      </span>
                    )}
                    {item.grade && (
                      <span className="px-3 py-1.5 bg-gradient-to-r from-green-50 to-green-100 text-green-700 rounded-lg text-xs font-bold border border-green-300 shadow-sm">
                        Grade {item.grade}
                      </span>
                    )}
                    {item.lesson && (
                      <span className="px-3 py-1.5 bg-gradient-to-r from-purple-50 to-purple-100 text-purple-700 rounded-lg text-xs font-bold border border-purple-300 shadow-sm">
                        {item.lesson}
                      </span>
                    )}
                    {item.version && (
                      <span className="px-3 py-1.5 bg-gradient-to-r from-orange-50 to-orange-100 text-orange-700 rounded-lg text-xs font-bold border border-orange-300 shadow-sm">
                        V{item.version}
                      </span>
                    )}
                  </div>

                  {/* Short URL */}
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border-2 border-slate-200 mb-4">
                    <p className="text-xs text-slate-600 mb-2 font-bold uppercase tracking-wide">
                      Short Link
                    </p>
                    <div className="flex items-center gap-2 bg-white rounded-lg p-2 border border-slate-200">
                      <input
                        type="text"
                        value={item.shortUrl}
                        readOnly
                        className="flex-1 text-xs sm:text-sm font-mono text-slate-700 bg-transparent border-none focus:outline-none truncate"
                      />
                      <button
                        onClick={() => handleCopy(item.shortUrl, item.videoId)}
                        className="p-2 hover:bg-blue-50 rounded-lg transition-all hover:scale-110"
                        title="Copy URL"
                      >
                        {copiedId === item.videoId ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4 text-slate-600 hover:text-blue-600" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-2 font-medium">
                      Video ID: <span className="font-mono">{item.videoId}</span>
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2.5 pt-4 border-t-2 border-slate-200">
                  <button
                    onClick={() => handleDownloadQR(item.videoId, item)}
                    disabled={downloadingIds.has(item.videoId)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all font-bold text-sm shadow-lg hover:shadow-xl transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    {downloadingIds.has(item.videoId) ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span className="hidden sm:inline">Downloading...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Download</span>
                      </>
                    )}
                  </button>
                  <a
                    href={item.shortUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-3 bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 rounded-xl hover:from-slate-200 hover:to-slate-300 transition-all font-bold text-sm border-2 border-slate-300 shadow-sm hover:shadow-md transform hover:scale-105 flex items-center justify-center"
                  >
                    <span className="hidden sm:inline">View</span>
                    <span className="sm:hidden">→</span>
                  </a>
                </div>
              </div>
            ))}
            </div>
          )}
        </div>
      </div>
      {showDiagnostic && <QRCodeDiagnostic onClose={() => setShowDiagnostic(false)} />}
    </div>
  );
}

export default QRCodeStorage;

