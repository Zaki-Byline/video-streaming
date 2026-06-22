import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileVideo, Trash2, RefreshCw, CheckCircle, XCircle, AlertCircle, HardDrive, Edit2, Plus, FileText, Download, Upload, Link as LinkIcon, Hash, Search, Filter } from 'lucide-react';
import api from '../services/api';
import { getBackendBaseUrl } from '../utils/apiConfig';

function MyStorageManager() {
  const navigate = useNavigate();
  
  // State
  const [videos, setVideos] = useState([]);
  const [filteredVideos, setFilteredVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [success, setSuccess] = useState('');
  const [selectedVideos, setSelectedVideos] = useState([]);
  const [editingVideo, setEditingVideo] = useState(null);
  const [editFormData, setEditFormData] = useState({});
  const [stagedFiles, setStagedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // Overall progress
  const [individualProgress, setIndividualProgress] = useState({}); // Progress per video ID
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' or 'table'
  const [uploadedVideos, setUploadedVideos] = useState([]); // Store successfully uploaded videos

  // Load videos from database
  useEffect(() => {
    loadVideos();
    // Restore staged files from localStorage
    restoreStagedFiles();
  }, []);

  // Save staged files to localStorage whenever they change
  useEffect(() => {
    if (stagedFiles.length > 0) {
      // Convert File objects to serializable format
      const serializableStagedFiles = stagedFiles.map(item => ({
        id: item.id,
        videoId: item.videoId,
        plannedPath: item.plannedPath,
        title: item.title || '',
        subject: item.subject || '',
        course: item.course || '',
        grade: item.grade || '',
        unit: item.unit || '',
        lesson: item.lesson || '',
        module: item.module || '',
        version: item.version || '',
        description: item.description || '',
        status: item.status || 'active',
        // Store file metadata (File objects can't be serialized)
        fileMetadata: {
          name: item.file?.name || '',
          size: item.file?.size || 0,
          type: item.file?.type || '',
          lastModified: item.file?.lastModified || Date.now()
        }
      }));
      localStorage.setItem('cloudflare_staged_files', JSON.stringify(serializableStagedFiles));
      localStorage.setItem('cloudflare_upload_progress', uploadProgress.toString());
      localStorage.setItem('cloudflare_uploading', uploading.toString());
    } else {
      // Clear localStorage when staged files are empty
      localStorage.removeItem('cloudflare_staged_files');
      localStorage.removeItem('cloudflare_upload_progress');
      localStorage.removeItem('cloudflare_uploading');
    }
  }, [stagedFiles, uploadProgress, uploading]);

  // Restore staged files from localStorage
  const restoreStagedFiles = () => {
    try {
      const saved = localStorage.getItem('cloudflare_staged_files');
      const savedProgress = localStorage.getItem('cloudflare_upload_progress');
      const savedUploading = localStorage.getItem('cloudflare_uploading');
      
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Restore staged files (without File objects - user will need to re-select files)
          setStagedFiles(parsed.map(item => ({
            ...item,
            file: null, // File object cannot be restored, will be null
            hasFile: false // Flag to indicate file needs to be re-selected
          })));
          
          if (savedProgress) {
            setUploadProgress(parseFloat(savedProgress));
          }
          if (savedUploading === 'true') {
            setUploading(false); // Reset uploading state on restore
          }
        }
      }
    } catch (error) {
      console.error('Failed to restore staged files:', error);
    }
  };

  const loadVideos = async () => {
    setLoading(true);
    setError('');
    setErrorDetails(null);
    try {
      const response = await api.get('/videos?status=active&limit=10000'); // High limit to get all videos
      
      // Handle both old format (array) and new format (object with videos and pagination)
      let videosData = [];
      if (Array.isArray(response.data)) {
        // Old format - just an array
        videosData = response.data;
      } else if (response.data && response.data.videos) {
        // New format - object with videos and pagination
        videosData = response.data.videos || [];
        
        // If pagination exists and there are more pages, fetch all pages
        const pagination = response.data.pagination;
        if (pagination && pagination.totalPages > 1) {
          const allVideos = [...videosData];
          
          // Fetch remaining pages
          for (let page = 2; page <= pagination.totalPages; page++) {
            const pageResponse = await api.get(`/videos?status=active&limit=10000&page=${page}`);
            
            if (pageResponse.data && pageResponse.data.videos) {
              allVideos.push(...pageResponse.data.videos);
            } else if (Array.isArray(pageResponse.data)) {
              allVideos.push(...pageResponse.data);
            }
          }
          
          videosData = allVideos;
        }
      } else {
        videosData = [];
      }
      
      // Filter out old videos with empty course, unit, and module (old structure)
      videosData = videosData.filter(video => {
        // Keep videos that have at least course, unit, or module, OR have a strong ID format
        const hasStrongId = /^VID_[A-Z0-9]{10}$/.test(video.video_id);
        const hasMetadata = video.course || video.unit || video.module || video.grade || video.lesson;
        return hasStrongId || hasMetadata;
      });
      
      // Detect duplicate titles
      const titleCounts = {};
      videosData.forEach(video => {
        const title = (video.title || '').trim();
        if (title) {
          titleCounts[title] = (titleCounts[title] || 0) + 1;
        }
      });
      
      // Add duplicate status to videos
      videosData = videosData.map(video => {
        const title = (video.title || '').trim();
        const isDuplicate = title && titleCounts[title] > 1;
        return {
          ...video,
          isDuplicate,
          duplicateCount: title ? titleCounts[title] : 0
        };
      });
      
      setVideos(videosData);
      setFilteredVideos(videosData);
      if (videosData.length === 0) {
        setError('No videos found. Upload some videos first.');
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
      setError(err.response?.data?.error || 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  };

  // Filter videos based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredVideos(videos);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = videos.filter(video => {
      const course = (video.course || '').toLowerCase();
      const grade = (video.grade || '').toLowerCase();
      const unit = (video.unit || '').toLowerCase();
      const lesson = (video.lesson || '').toLowerCase();
      const module = (video.module || '').toLowerCase();
      const status = (video.status || '').toLowerCase();
      const title = (video.title || '').toLowerCase();
      const videoId = (video.video_id || '').toLowerCase();

      // Check if query matches any field
      return course.includes(query) ||
             grade.includes(query) ||
             unit.includes(query) ||
             lesson.includes(query) ||
             module.includes(query) ||
             status.includes(query) ||
             title.includes(query) ||
             videoId.includes(query) ||
             // Support multi-word queries like "course faith"
             (query.includes('course') && course.includes(query.replace('course', '').trim())) ||
             (query.includes('grade') && grade.includes(query.replace('grade', '').trim())) ||
             (query.includes('unit') && unit.includes(query.replace('unit', '').trim())) ||
             (query.includes('lesson') && lesson.includes(query.replace('lesson', '').trim())) ||
             (query.includes('module') && module.includes(query.replace('module', '').trim()));
    });

    setFilteredVideos(filtered);
  }, [searchQuery, videos]);

  // Handle multi-file select from PC
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const backendBase = getBackendBaseUrl();

    const existingIds = new Set(stagedFiles.map((f) => f.videoId));
    const makeDraftId = () => {
      let draft;
      do {
        // Strong and short ID: timestamp (base36, 5 chars) + random (base36, 5 chars) = 10 chars total
        // Format: VID_XXXXXXXXXX (short but strong)
        const timestamp = Date.now().toString(36).slice(-5).toUpperCase();
        const random = Math.random().toString(36).slice(2, 7).toUpperCase();
        draft = `VID_${timestamp}${random}`;
      } while (existingIds.has(draft));
      existingIds.add(draft);
      return draft;
    };

    const newStaged = files.map((file) => {
      const extMatch = file.name.match(/\.[^/.]+$/);
      const ext = extMatch ? extMatch[0] : '.mp4';
      const videoId = makeDraftId();
      return {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        videoId,
        plannedPath: `upload/${videoId}${ext}`,
        previewUrl: `${backendBase}/api/s/${videoId}`,
        title: file.name.replace(/\.[^/.]+$/, ''),
        subject: '',
        course: '', // Keep for backward compatibility
        grade: '',
        unit: '',
        lesson: '',
        module: '',
        version: '',
        status: 'active',
        description: ''
      };
    });

    setStagedFiles((prev) => [...prev, ...newStaged]);
    e.target.value = '';
  };

  const updateStagedField = (id, field, value) => {
    setStagedFiles((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const removeStaged = (id) => {
    setStagedFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const clearStaged = () => {
    if (stagedFiles.length > 0 && !window.confirm('Are you sure you want to clear all staged files? This will remove all upload progress and form data.')) {
      return;
    }
    setStagedFiles([]);
    setUploadProgress(0);
    setIndividualProgress({});
    setUploading(false);
    // Clear localStorage
    localStorage.removeItem('cloudflare_staged_files');
    localStorage.removeItem('cloudflare_upload_progress');
    localStorage.removeItem('cloudflare_uploading');
  };

  const uploadStaged = async () => {
    if (stagedFiles.length === 0) {
      setError('Please add at least one video file.');
      return;
    }

    // Validate required fields for each staged file
    const validationErrors = [];
    stagedFiles.forEach((item, index) => {
      if (!item.subject && !item.course || (!item.subject?.trim() && !item.course?.trim())) {
        validationErrors.push(`File ${index + 1} (${item.file.name}): Subject is required`);
      }
      if (!item.grade || !item.grade.trim()) {
        validationErrors.push(`File ${index + 1} (${item.file.name}): Grade is required`);
      }
      if (!item.unit || !item.unit.trim()) {
        validationErrors.push(`File ${index + 1} (${item.file.name}): Unit is required`);
      }
      if (!item.lesson || !item.lesson.trim()) {
        validationErrors.push(`File ${index + 1} (${item.file.name}): Lesson is required`);
      }
      // Module field is now optional - removed validation
    });

    if (validationErrors.length > 0) {
      setError('Please fill in all required fields:\n' + validationErrors.join('\n'));
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    // Initialize progress for all videos at once
    const initialProgress = {};
    stagedFiles.forEach(item => {
      initialProgress[item.id] = 0;
    });
    setIndividualProgress(initialProgress);
    setError('');
    setErrorDetails(null);
    setSuccess('');
    setUploadedVideos([]); // Clear previous uploaded videos

    let successfullyUploaded = []; // Declare outside try block so it's accessible

    try {
      for (let i = 0; i < stagedFiles.length; i++) {
        const item = stagedFiles[i];
        
        const formData = new FormData();
        formData.append('video', item.file);
        formData.append('title', item.title || item.file.name);
        formData.append('videoId', item.videoId || '');
        formData.append('plannedPath', item.plannedPath || '');
        
        // CRITICAL: Ensure all fields are sent with actual values
        // Convert empty strings to null for database consistency, but preserve actual values
        const normalizeValue = (val) => {
          if (!val || (typeof val === 'string' && val.trim() === '')) return null;
          return String(val).trim();
        };
        
        // Get subject value - prefer subject over course
        const subjectValue = normalizeValue(item.subject || item.course);
        const gradeValue = normalizeValue(item.grade);
        const unitValue = normalizeValue(item.unit);
        const lessonValue = normalizeValue(item.lesson);
        const moduleValue = normalizeValue(item.module);
        const versionValue = normalizeValue(item.version);
        const descriptionValue = normalizeValue(item.description);
        const statusValue = item.status && item.status.trim() !== '' ? item.status.trim() : 'active';
        
        // CRITICAL: Always send these fields, even if null (so backend knows to set them)
        // Use null instead of empty string for database consistency
        formData.append('subject', subjectValue || '');
        formData.append('course', subjectValue || ''); // Keep for backward compatibility
        formData.append('grade', gradeValue || '');
        formData.append('unit', unitValue || '');
        formData.append('lesson', lessonValue || '');
        formData.append('module', moduleValue || '');
        formData.append('version', versionValue || '');
        formData.append('description', descriptionValue || '');
        formData.append('status', statusValue);
        
        // Log what we're sending - show both raw and processed values
        console.log('[CloudflareResourceManager] ===== SENDING FORM DATA =====');
        console.log('[CloudflareResourceManager] Raw item values:', {
          subject: item.subject,
          course: item.course,
          grade: item.grade,
          unit: item.unit,
          lesson: item.lesson,
          module: item.module,
          version: item.version,
          description: item.description,
          status: item.status
        });
        console.log('[CloudflareResourceManager] Processed values being sent:', {
          subject: subjectValue,
          course: subjectValue, // Backward compatibility
          grade: gradeValue,
          unit: unitValue,
          lesson: lessonValue,
          module: moduleValue,
          version: versionValue,
          description: descriptionValue,
          status: statusValue,
          title: item.title || item.file.name
        });
        console.log('[CloudflareResourceManager] =============================');

        try {
          const response = await api.post('/videos/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                // Update individual progress for this video and calculate overall progress
                setIndividualProgress(prev => {
                  const updated = { ...prev, [item.id]: percentCompleted };
                  // Calculate overall progress
                  const totalProgress = Object.values(updated).reduce((sum, p) => sum + p, 0);
                  const overallPercent = Math.round(totalProgress / stagedFiles.length);
                  setUploadProgress(overallPercent);
                  return updated;
                });
              }
            }
          });

          // Log the response to verify subject information is being returned
          console.log('[CloudflareResourceManager] Upload response:', {
            video_id: response.data?.video?.video_id,
            subject: response.data?.video?.subject,
            course: response.data?.video?.course || response.data?.video?.subject, // Backward compatibility
            grade: response.data?.video?.grade,
            unit: response.data?.video?.unit,
            lesson: response.data?.video?.lesson,
            module: response.data?.video?.module,
            version: response.data?.video?.version,
            description: response.data?.video?.description
          });

          // Store successfully uploaded video data with all subject information from backend response
          // Use backend response data first (has actual saved values from database), fallback to item data
          const videoResponse = response.data?.video || {};
          successfullyUploaded.push({
            ...item,
            video_id: videoResponse.video_id || item.videoId,
            id: videoResponse.id || null,
            // Use backend response data (from database) - this ensures we get the actual saved values
            // Use null/undefined check to preserve empty strings if that's what was saved
            subject: videoResponse.subject !== null && videoResponse.subject !== undefined ? videoResponse.subject : (item.subject || item.course || ''),
            course: videoResponse.subject !== null && videoResponse.subject !== undefined ? videoResponse.subject : (videoResponse.course !== null && videoResponse.course !== undefined ? videoResponse.course : (item.subject || item.course || '')), // Backward compatibility
            grade: videoResponse.grade !== null && videoResponse.grade !== undefined ? videoResponse.grade : (item.grade || ''),
            unit: videoResponse.unit !== null && videoResponse.unit !== undefined ? videoResponse.unit : (item.unit || ''),
            lesson: videoResponse.lesson !== null && videoResponse.lesson !== undefined ? videoResponse.lesson : (item.lesson || ''),
            module: videoResponse.module !== null && videoResponse.module !== undefined ? videoResponse.module : (item.module || ''),
            version: videoResponse.version !== null && videoResponse.version !== undefined ? videoResponse.version : (item.version || ''),
            status: videoResponse.status || item.status || 'active',
            description: videoResponse.description !== null && videoResponse.description !== undefined ? videoResponse.description : (item.description || ''),
            title: videoResponse.title || item.title || item.file?.name?.replace(/\.[^/.]+$/, '') || 'Screen Recording'
          });

          // Mark this video as 100% complete and calculate overall progress
          setIndividualProgress(prev => {
            const updated = { ...prev, [item.id]: 100 };
            const totalProgress = Object.values(updated).reduce((sum, p) => sum + p, 0);
            const overallPercent = Math.round(totalProgress / stagedFiles.length);
            setUploadProgress(overallPercent);
            return updated;
          });
        } catch (uploadErr) {
          // Detailed diagnostics for this specific file upload
          const diagnostics = {
            fileName: item.file?.name || 'Unknown',
            fileSize: item.file?.size || 0,
            fileType: item.file?.type || 'Unknown',
            videoId: item.videoId || 'Not provided',
            plannedPath: item.plannedPath || 'Not provided',
            title: item.title || item.file?.name || 'Not provided',
            grade: item.grade || '',
            lesson: item.lesson || '',
            module: item.module || '',
            unit: item.unit || '',
            subject: item.subject || item.course || '',
            course: item.subject || item.course || '', // Backward compatibility
            description: item.description || '',
            error: {
              message: uploadErr.message || 'Unknown error',
              code: uploadErr.code || 'NO_CODE',
              status: uploadErr.response?.status || 'NO_STATUS',
              statusText: uploadErr.response?.statusText || 'NO_STATUS_TEXT',
              responseData: uploadErr.response?.data || null,
              requestUrl: uploadErr.config?.url || 'Unknown',
              requestMethod: uploadErr.config?.method?.toUpperCase() || 'UNKNOWN',
            },
            timestamp: new Date().toISOString()
          };

          console.error('===== UPLOAD DIAGNOSTICS =====');
          console.error('Failed File:', diagnostics.fileName);
          console.error('File Size:', diagnostics.fileSize, 'bytes');
          console.error('Video ID:', diagnostics.videoId);
          console.error('Error Status:', diagnostics.error.status);
          console.error('Error Message:', diagnostics.error.message);
          console.error('Response Data:', diagnostics.error.responseData);
          console.error('Full Error Object:', uploadErr);
          console.error('==============================');

          setErrorDetails({ ...diagnostics, expanded: false });
          
          const apiMessage = uploadErr.response?.data?.message || uploadErr.response?.data?.error || uploadErr.message;
          const status = uploadErr.response?.status;
          const sqlMessage = uploadErr.response?.data?.sqlMessage;
          
          let errorMsg = `Failed to upload "${item.file?.name || 'video'}"`;
          if (status) errorMsg += ` (HTTP ${status})`;
          if (apiMessage) errorMsg += `: ${apiMessage}`;
          if (sqlMessage) errorMsg += ` [SQL: ${sqlMessage}]`;
          
          setError(errorMsg);
          throw uploadErr; // Re-throw to stop the loop
        }
      }

      // Only show success if we have successfully uploaded videos
      if (successfullyUploaded.length > 0) {
        setSuccess(`Uploaded ${successfullyUploaded.length} video(s) successfully`);
        setUploadedVideos(successfullyUploaded); // Store uploaded videos to display
        // Clear staged files and localStorage on successful upload
    setStagedFiles([]);
    setUploadProgress(0);
    setIndividualProgress({});
    localStorage.removeItem('cloudflare_staged_files');
    localStorage.removeItem('cloudflare_upload_progress');
    localStorage.removeItem('cloudflare_uploading');
        loadVideos();
      } else {
        // If no videos were successfully uploaded, show error
        setError('No videos were uploaded successfully. Please check the error details above.');
      }
    } catch (err) {
      // This catch handles any other errors
      if (!errorDetails) {
        console.error('Upload error (general):', err);
        const apiMessage = err.response?.data?.message || err.response?.data?.error;
        const status = err.response?.status;
        const detail = apiMessage
          ? `${apiMessage}${status ? ` (status ${status})` : ''}`
          : 'Failed to upload videos';
        setError(detail);
      }
    } finally {
      setUploading(false);
    }
  };

  const generateCSV = async () => {
    if (videos.length === 0) {
      setError('No videos available to generate CSV');
      return;
    }

    try {
    setLoading(true);
    setError('');
      
      const response = await api.get('/videos/export-csv', {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `videos_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setSuccess(`CSV generated successfully with ${videos.length} video(s)!`);
    } catch (err) {
      console.error('CSV generation error:', err);
      setError(err.response?.data?.error || 'Failed to generate CSV');
    } finally {
      setLoading(false);
    }
  };

  // Delete video
  const handleDeleteVideo = async (id) => {
    if (!window.confirm('Are you sure you want to delete this video?')) {
      return;
    }

    try {
      await api.delete(`/videos/${id}`);
      setSuccess('Video deleted successfully');
      loadVideos();
    } catch (err) {
      console.error('Delete error:', err);
      setError(err.response?.data?.error || 'Failed to delete video');
    }
  };

  // Delete selected videos
  const handleDeleteSelected = async () => {
    if (selectedVideos.length === 0) {
      setError('Please select at least one video to delete');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete ${selectedVideos.length} video(s)?`)) {
      return;
    }

    setLoading(true);
    try {
      const deletePromises = selectedVideos.map(id => api.delete(`/videos/${id}`));
      await Promise.all(deletePromises);
      setSuccess(`${selectedVideos.length} video(s) deleted successfully`);
      setSelectedVideos([]);
      loadVideos();
    } catch (err) {
      console.error('Delete error:', err);
      setError(err.response?.data?.error || 'Failed to delete videos');
    } finally {
      setLoading(false);
    }
  };

  // Select/deselect video
  const handleSelectVideo = (id) => {
    if (selectedVideos.includes(id)) {
      setSelectedVideos(selectedVideos.filter(vid => vid !== id));
    } else {
      setSelectedVideos([...selectedVideos, id]);
    }
  };

  // Select all/deselect all
  const handleSelectAll = () => {
    if (selectedVideos.length === videos.length) {
      setSelectedVideos([]);
    } else {
      setSelectedVideos(videos.map(v => v.id));
    }
  };

  // Start editing video
  const handleEditVideo = (video) => {
    setEditingVideo(video.id);
    setEditFormData({
      grade: video.grade || '',
      lesson: video.lesson || '',
      course: video.course || '',
      unit: video.unit || '',
      module: video.module || '',
      title: video.title || '',
      description: video.description || '',
      status: video.status || 'active'
    });
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setEditingVideo(null);
    setEditFormData({});
  };

  // Save edited video
  const handleSaveEdit = async (id) => {
    try {
      await api.put(`/videos/${id}`, editFormData);
      setSuccess('Video updated successfully');
      setEditingVideo(null);
      setEditFormData({});
      loadVideos();
    } catch (err) {
      console.error('Update error:', err);
      setError(err.response?.data?.error || 'Failed to update video');
    }
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-6 lg:p-8">
      <div className="max-w-[1800px] mx-auto">
        {/* Header Section */}
        <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-8 mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="p-4 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-2xl shadow-lg">
                <HardDrive className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900 mb-2">
                  My Storage
                </h1>
                <p className="text-slate-600 text-lg">Manage your videos stored locally in backend/upload/</p>
              </div>
            </div>
              <div className="flex gap-3 flex-wrap">
                <label className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] cursor-pointer">
                  <Upload className="w-5 h-5" />
                  <span>Upload from PC (multiple)</span>
                  <input
                    type="file"
                    multiple
                    accept="video/*"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                </label>
            
            <button
                  onClick={loadVideos}
                  disabled={loading}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-lg hover:shadow-xl hover:scale-[1.02] font-semibold"
            >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
            </button>
              </div>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 space-y-4">
            <div className="p-5 bg-red-50 border-l-4 border-red-500 rounded-xl text-red-700 flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
                <div className="font-medium mb-2">{error}</div>
                {errorDetails && (
                  <button
                    onClick={() => setErrorDetails(prev => ({ ...prev, expanded: !prev.expanded }))}
                    className="text-sm text-red-600 hover:text-red-800 underline"
                  >
                    {errorDetails.expanded ? 'Hide' : 'Show'} Diagnostics
                  </button>
                )}
              </div>
              <button onClick={() => { setError(''); setErrorDetails(null); }} className="text-red-500 hover:text-red-700 transition-colors">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
            
            {/* Detailed Diagnostics */}
            {errorDetails && errorDetails.expanded && (
              <div className="bg-slate-900 text-slate-100 rounded-xl p-6 shadow-lg border border-slate-700 font-mono text-sm overflow-auto max-h-96">
                <div className="mb-4 pb-3 border-b border-slate-700">
                  <h4 className="text-lg font-bold text-red-400 mb-2">🔍 Upload Diagnostics</h4>
                  <div className="text-xs text-slate-400">Timestamp: {errorDetails.timestamp}</div>
          </div>
                
                <div className="space-y-4">
                  {/* File Information */}
                  <div>
                    <div className="text-yellow-400 font-semibold mb-2">📁 File Information</div>
                    <div className="pl-4 space-y-1 text-slate-300">
                      <div>Name: <span className="text-white">{errorDetails.fileName}</span></div>
                      <div>Size: <span className="text-white">{formatFileSize(errorDetails.fileSize)} ({errorDetails.fileSize} bytes)</span></div>
                      <div>Type: <span className="text-white">{errorDetails.fileType}</span></div>
              </div>
            </div>

                  {/* Metadata Information */}
                  <div>
                    <div className="text-yellow-400 font-semibold mb-2">📋 Metadata</div>
                    <div className="pl-4 space-y-1 text-slate-300">
                      <div>Video ID: <span className="text-white">{errorDetails.videoId || 'Not provided'}</span></div>
                      <div>Planned Path: <span className="text-white">{errorDetails.plannedPath || 'Not provided'}</span></div>
                      <div>Title: <span className="text-white">{errorDetails.title || 'Not provided'}</span></div>
                      <div>Grade: <span className="text-white">{errorDetails.grade || 'Not provided'}</span></div>
                      <div>Lesson: <span className="text-white">{errorDetails.lesson || 'Not provided'}</span></div>
                      <div>Module: <span className="text-white">{errorDetails.module || 'Not provided'}</span></div>
                      <div>Unit: <span className="text-white">{errorDetails.unit || 'Not provided'}</span></div>
                      <div>Description: <span className="text-white">{errorDetails.description || 'Not provided'}</span></div>
                    </div>
                  </div>

                  {/* Error Information */}
                  <div>
                    <div className="text-red-400 font-semibold mb-2">❌ Error Details</div>
                    <div className="pl-4 space-y-1 text-slate-300">
                      <div>Message: <span className="text-red-300">{errorDetails.error.message}</span></div>
                      <div>Code: <span className="text-white">{errorDetails.error.code}</span></div>
                      <div>HTTP Status: <span className="text-red-300">{errorDetails.error.status} {errorDetails.error.statusText}</span></div>
                      <div>Request: <span className="text-white">{errorDetails.error.requestMethod} {errorDetails.error.requestUrl}</span></div>
                      {errorDetails.error.responseData && (
                        <div className="mt-2">
                          <div className="text-yellow-400 mb-1">Response Data:</div>
                          <pre className="bg-slate-800 p-3 rounded text-xs overflow-auto max-h-48 text-slate-200">
                            {JSON.stringify(errorDetails.error.responseData, null, 2)}
                          </pre>
                        </div>
                      )}
                      {errorDetails.error.responseData?.sqlMessage && (
                        <div className="mt-2">
                          <div className="text-red-400 mb-1">SQL Error:</div>
                          <div className="bg-red-900/30 p-2 rounded text-red-200">
                            {errorDetails.error.responseData.sqlMessage}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Staged uploads from PC */}
        {stagedFiles.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 mb-6">
            {/* Notice for restored files without file objects */}
            {stagedFiles.some(item => !item.file || item.hasFile === false) && (
              <div className="mb-4 p-4 bg-yellow-50 border-l-4 border-yellow-500 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-yellow-800 mb-1">Files Need to be Re-selected</div>
                  <div className="text-sm text-yellow-700">
                    Your upload progress and form data have been restored, but the video files need to be re-selected. 
                    Please re-select the files using the "Upload from PC" button, or clear this section to start fresh.
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-xl">
                  <Upload className="w-5 h-5 text-emerald-600" />
                  </div>
                Staged Videos ({stagedFiles.length})
                {uploadProgress > 0 && uploadProgress < 100 && (
                  <span className="text-sm font-normal text-slate-500">
                    - {uploadProgress}% complete
                  </span>
                )}
              </h3>
                <div className="flex gap-2 flex-wrap">
                    <button
                  onClick={uploadStaged}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all duration-200 font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] disabled:bg-gray-400"
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Uploading... {uploadProgress}%
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload {stagedFiles.length} file(s)
                    </>
                  )}
                </button>
                  <button
                  onClick={() => clearStaged()}
                  disabled={uploading}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all duration-200 font-semibold"
                >
                  <XCircle className="w-4 h-4" />
                  Clear
                  </button>
                  <button
                  onClick={() => {
                    // Generate CSV from staged files client-side
                    const headers = ['ID', 'Title', 'Planned Path', 'Preview URL', 'Subject', 'Grade', 'Unit', 'Lesson', 'Module', 'Version', 'Description'];
                    const rows = stagedFiles.map((f) => [
                      f.videoId || '',
                      f.title || f.file.name.replace(/\.[^/.]+$/, ''),
                      f.plannedPath || '',
                      f.previewUrl || '',
                      f.course || '',
                      f.grade || '',
                      f.unit || '',
                      f.lesson || '',
                      f.module || '',
                      f.version || '',
                      f.description || ''
                    ]);
                    const escapeCSV = (value) => {
                      const cell = String(value || '').trim();
                      return cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')
                        ? `"${cell.replace(/"/g, '""')}"`
                        : cell;
                    };
                    const csvContent = [
                      headers.join(','),
                      ...rows.map((row) => row.map(escapeCSV).join(',')),
                    ].join('\\r\\n');
                    const blob = new Blob(['\\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `staged_videos_${Date.now()}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all duration-200 font-semibold shadow-md hover:shadow-lg hover:scale-[1.02]"
                >
                  <FileText className="w-4 h-4" />
                  CSV (staged)
                  </button>
              </div>
            </div>

            {uploading && (
              <div className="mb-4">
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-green-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                            </div>
                <div className="text-sm text-slate-600 mt-2">Uploading... {uploadProgress}%</div>
                              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gradient-to-r from-slate-50 to-emerald-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider min-w-[480px]">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Subject</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider min-w-[160px]">Grade</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider min-w-[180px]">Unit</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider min-w-[180px]">Lesson</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Module</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Version</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider">Upload Progress</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-700 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {stagedFiles.map((item, idx) => (
                    <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => updateStagedField(item.id, 'title', e.target.value)}
                          className="w-full min-w-[480px] px-3 py-2.5 text-sm font-medium border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Enter full title..."
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.subject || item.course || ''}
                          onChange={(e) => {
                            updateStagedField(item.id, 'subject', e.target.value);
                            updateStagedField(item.id, 'course', e.target.value); // Keep for backward compatibility
                          }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Subject name"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.grade}
                          onChange={(e) => updateStagedField(item.id, 'grade', e.target.value)}
                          className="w-full min-w-[160px] px-3 py-2.5 text-sm font-medium border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Grade"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateStagedField(item.id, 'unit', e.target.value)}
                          className="w-full min-w-[180px] px-3 py-2.5 text-sm font-medium border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Unit"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.lesson}
                          onChange={(e) => updateStagedField(item.id, 'lesson', e.target.value)}
                          className="w-full min-w-[180px] px-3 py-2.5 text-sm font-medium border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Lesson"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.module || ''}
                          onChange={(e) => updateStagedField(item.id, 'module', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white border-2 border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 text-slate-900 placeholder:text-slate-400"
                          placeholder="Module"
                          style={{ color: item.module ? '#1e293b' : '#64748b' }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={item.version || ''}
                          onChange={(e) => updateStagedField(item.id, 'version', e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-white border-2 border-blue-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-400 text-slate-900 placeholder:text-slate-400"
                          placeholder="Version"
                          style={{ color: item.version ? '#1e293b' : '#64748b' }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        {uploading && individualProgress[item.id] !== undefined ? (
                          <div className="w-full">
                            <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden mb-1">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  individualProgress[item.id] === 100
                                    ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                                    : 'bg-gradient-to-r from-blue-500 to-indigo-500'
                                }`}
                                style={{ width: `${individualProgress[item.id]}%` }}
                              />
                            </div>
                            <div className="text-xs text-slate-600 text-center">
                              {individualProgress[item.id]}%
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400 text-center">-</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                            <button
                          onClick={() => removeStaged(item.id)}
                          disabled={uploading}
                          className="text-red-500 hover:text-red-600 transition-all duration-200 p-2 hover:bg-red-50 rounded-xl hover:scale-110 disabled:text-red-300"
                          title="Remove"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
                          </div>
                </div>
              )}

        {success && (
          <>
            <div className="mb-6 p-5 bg-green-50 border-l-4 border-green-500 rounded-xl text-green-700 flex items-start gap-3 shadow-sm">
              <CheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div className="flex-1 font-medium">{success}</div>
              <button onClick={() => { setSuccess(''); setUploadedVideos([]); }} className="text-green-500 hover:text-green-700 transition-colors">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Uploaded Videos - Course Information Horizontal Container */}
            {uploadedVideos.length > 0 && (
              <div className="mb-6 bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-3 mb-4">
                  <div className="p-2 bg-green-100 rounded-xl">
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                  Uploaded Videos - Course Information
                </h3>
                
                <div className="space-y-4">
                  {uploadedVideos.map((item) => (
                    <div key={item.id || item.videoId} className="bg-white rounded-xl border-2 border-slate-200 shadow-sm p-5">
                      {/* Screen Recording Title */}
                      <div className="mb-4">
                        <h4 className="text-lg font-bold text-slate-900 mb-3">
                          {item.title || item.file?.name?.replace(/\.[^/.]+$/, '') || 'Screen Recording'}
                        </h4>
                        <div className="mb-4">
                          <div className="text-xs uppercase text-slate-500 mb-2">DESCRIPTION</div>
                          <div className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg min-h-[2.5rem]">
                            {item.description || '-'}
                          </div>
                        </div>
                      </div>

                      {/* Course Information - Horizontal Layout */}
                      <div>
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-1 h-6 bg-blue-600 rounded"></div>
                          <h5 className="text-base font-bold text-slate-900">Course Information</h5>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                          {/* Subject */}
                          <div>
                            <div className="text-xs uppercase text-slate-500 mb-1.5">SUBJECT</div>
                            <div className="w-full px-3 py-2.5 text-sm font-bold text-slate-900 bg-blue-50 border border-blue-200 rounded-lg text-center">
                              {(() => {
                                const subjectValue = item.subject || item.course || '';
                                return subjectValue !== null && subjectValue !== undefined && subjectValue !== '' ? String(subjectValue) : '-';
                              })()}
                            </div>
                          </div>

                          {/* Grade */}
                          <div>
                            <div className="text-xs uppercase text-green-700 mb-1.5">GRADE</div>
                            <div className="w-full px-3 py-2.5 text-sm font-bold text-green-900 bg-green-50 border border-green-200 rounded-lg text-center">
                              {item.grade !== null && item.grade !== undefined && item.grade !== '' ? String(item.grade) : '-'}
                            </div>
                          </div>

                          {/* Unit */}
                          <div>
                            <div className="text-xs uppercase text-indigo-700 mb-1.5">UNIT</div>
                            <div className="w-full px-3 py-2.5 text-sm font-bold text-indigo-900 bg-indigo-50 border border-indigo-200 rounded-lg text-center">
                              {(() => {
                                const unitValue = item.unit;
                                return unitValue !== null && unitValue !== undefined && unitValue !== '' && unitValue !== 0 && unitValue !== '0' ? String(unitValue) : '-';
                              })()}
                            </div>
                          </div>

                          {/* Lesson */}
                          <div>
                            <div className="text-xs uppercase text-teal-700 mb-1.5">LESSON</div>
                            <div className="w-full px-3 py-2.5 text-sm font-bold text-teal-900 bg-teal-50 border border-teal-200 rounded-lg text-center">
                              {item.lesson !== null && item.lesson !== undefined && item.lesson !== '' ? String(item.lesson) : '-'}
                            </div>
                          </div>

                          {/* Module */}
                          <div>
                            <div className="text-xs uppercase text-amber-700 mb-1.5">MODULE</div>
                            <div className="w-full px-3 py-2.5 text-sm font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg text-center">
                              {(() => {
                                const moduleValue = item.module;
                                return moduleValue !== null && moduleValue !== undefined && moduleValue !== '' && moduleValue !== 0 && moduleValue !== '0' ? String(moduleValue) : '-';
                              })()}
                            </div>
                          </div>

                          {/* Version */}
                          <div>
                            <div className="text-xs uppercase text-purple-700 mb-1.5">VERSION</div>
                            <div className="w-full px-3 py-2.5 text-sm font-bold text-purple-900 bg-purple-50 border border-purple-200 rounded-lg text-center">
                              {(() => {
                                const versionValue = item.version;
                                return versionValue !== null && versionValue !== undefined && versionValue !== '' && versionValue !== 0 && versionValue !== '0' ? String(versionValue) : '-';
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default MyStorageManager;
