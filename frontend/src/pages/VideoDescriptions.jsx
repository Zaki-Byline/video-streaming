import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Trash2, Save, Search, Subtitles } from 'lucide-react';
import api from '../services/api';

function VideoDescriptions() {
  const [videos, setVideos] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [subtitleId, setSubtitleId] = useState(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');

  useEffect(() => {
    fetchVideos();
  }, []);

  const fetchVideos = async (searchTerm = search) => {
    try {
      setLoading(true);
      const params = searchTerm.trim() ? { search: searchTerm.trim() } : {};
      const response = await api.get('/admin/videos', { params });
      setVideos(response.data);
      const nextDrafts = {};
      response.data.forEach((video) => {
        nextDrafts[video.id] = video.description || '';
      });
      setDrafts(nextDrafts);
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to load videos');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    fetchVideos(search);
  };

  const generateSubtitles = async (id) => {
    if (!confirm('Generate subtitles from video? This may take 1–2 minutes.')) return;
    try {
      setSubtitleId(id);
      setMessage('Generating subtitles…');
      setMessageType('info');
      await api.post(`/admin/video/${id}/generate-subtitles`);
      await fetchVideos();
      setMessage(`Subtitles generated for video #${id}`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.response?.data?.error || `Subtitle generation failed for #${id}`);
      setMessageType('error');
    } finally {
      setSubtitleId(null);
    }
  };

  const deleteDesc = async (id) => {
    if (!confirm('Clear description?')) return;
    try {
      await api.delete(`/admin/video/${id}/description`);
      await fetchVideos();
      setMessage(`Cleared video #${id}`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to delete');
      setMessageType('error');
    }
  };

  const saveDesc = async (id) => {
    try {
      setSavingId(id);
      await api.put(`/admin/video/${id}/description`, {
        description: drafts[id] || ''
      });
      await fetchVideos();
      setMessage(`Saved #${id}`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to save');
      setMessageType('error');
    } finally {
      setSavingId(null);
    }
  };

  const missingVttCount = useMemo(() => videos.filter((v) => !v.has_vtt).length, [videos]);

  if (loading && videos.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6 bg-white min-h-screen">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Video Descriptions</h1>
          <p className="text-gray-600 mt-1">
            Edit descriptions manually. Subtitles (.vtt) are created automatically when a video is uploaded.
          </p>
        </div>
        <button onClick={() => fetchVideos()} className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <form onSubmit={handleSearch} className="mb-4 flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, video ID, description…"
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <button type="submit" className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">Search</button>
      </form>

      {missingVttCount > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          <strong>{missingVttCount}</strong> video(s) have no subtitle file yet. Click <strong>Generate subtitles</strong> on that row.
        </div>
      )}

      {message && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm ${
          messageType === 'error' ? 'bg-red-50 text-red-800 border-red-200'
            : messageType === 'success' ? 'bg-green-50 text-green-800 border-green-200'
              : 'bg-blue-50 text-blue-800 border-blue-200'
        }`}>{message}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-blue-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Video ID</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Title</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase min-w-[280px]">Description</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Subtitles</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {videos.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No videos found</td></tr>
              ) : (
                videos.map((video) => (
                  <tr key={video.id} className="hover:bg-gray-50 align-top">
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs text-gray-600">{video.video_id}</div>
                      <div className="text-xs text-gray-400">#{video.id}</div>
                    </td>
                    <td className="px-3 py-3 max-w-[200px]">
                      <div className="font-medium truncate" title={video.title}>{video.title}</div>
                    </td>
                    <td className="px-3 py-3">
                      <textarea
                        rows={3}
                        value={drafts[video.id] ?? ''}
                        onChange={(e) => setDrafts((p) => ({ ...p, [video.id]: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        placeholder="Enter description…"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${video.has_vtt ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {video.has_vtt ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1.5">
                        <button onClick={() => saveDesc(video.id)} disabled={savingId === video.id} className="inline-flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-50">
                          <Save className="w-3 h-3" /> {savingId === video.id ? '…' : 'Save'}
                        </button>
                        {!video.has_vtt && (
                          <button onClick={() => generateSubtitles(video.id)} disabled={subtitleId === video.id} className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                            <Subtitles className="w-3 h-3" /> {subtitleId === video.id ? 'Working…' : 'Generate subtitles'}
                          </button>
                        )}
                        <button onClick={() => deleteDesc(video.id)} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-700 border border-red-200 rounded hover:bg-red-50">
                          <Trash2 className="w-3 h-3" /> Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default VideoDescriptions;
