import { useEffect, useState, useCallback, useRef, useMemo, Fragment } from 'react';
import { RefreshCw, Trash2, Search, Sparkles, Loader2, ChevronRight, X } from 'lucide-react';
import api from '../services/api';
import './VideoDescriptions.css';

const FILTERS_STORAGE_KEY = 'video_descriptions_filters_v1';
const PAGE_SIZE_OPTIONS = [25, 50, 100];

const defaultFilters = {
  search: '',
  subject: '',
  grade: '',
  unit: '',
  lesson: '',
  module: '',
  version: '',
  descriptionStatus: 'all'
};

const FILTER_LABELS = {
  search: 'Search',
  subject: 'Subject',
  grade: 'Grade',
  unit: 'Unit',
  lesson: 'Lesson',
  module: 'Module',
  version: 'Version',
  descriptionStatus: 'Description'
};

function buildFilterParams(filters, page = 1, limit = 25) {
  const params = { page, limit };
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.subject?.trim()) params.subject = filters.subject.trim();
  if (filters.grade?.trim()) params.grade = filters.grade.trim();
  if (filters.unit?.trim()) params.unit = filters.unit.trim();
  if (filters.lesson?.trim()) params.lesson = filters.lesson.trim();
  if (filters.module?.trim()) params.module = filters.module.trim();
  if (filters.version?.trim()) params.version = filters.version.trim();
  if (filters.descriptionStatus && filters.descriptionStatus !== 'all') {
    params.descriptionStatus = filters.descriptionStatus;
  }
  return params;
}

function isBulkEligible(video) {
  return !video.has_ai_description && video.has_vtt;
}

function badgeState(status) {
  if (status === 'Yes') return 'yes';
  if (status === 'Processing') return 'processing';
  if (status === 'Failed') return 'failed';
  return 'no';
}

function StatusBadge({ status }) {
  const state = badgeState(status);
  return (
    <span className="vd-badge" data-state={state}>
      <span className="vd-badge-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

function VideoDescriptions() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generatingDescId, setGeneratingDescId] = useState(null);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagination, setPagination] = useState(null);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('info');
  const [expandedTranscripts, setExpandedTranscripts] = useState(new Set());
  const [filterOptions, setFilterOptions] = useState({
    subjects: [],
    grades: [],
    units: [],
    lessons: [],
    modules: [],
    versions: []
  });
  const [filters, setFilters] = useState(() => {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (raw) return { ...defaultFilters, ...JSON.parse(raw) };
    } catch {
      // ignore
    }
    return defaultFilters;
  });
  const [searchInput, setSearchInput] = useState(() => filters.search);
  const searchDebounceRef = useRef(null);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setFilters((prev) => (prev.search === searchInput ? prev : { ...prev, search: searchInput }));
    }, 350);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => setMessage(''), 7000);
    return () => clearTimeout(t);
  }, [message]);

  const fetchFilterOptions = async (subject = '') => {
    try {
      const params = {};
      if (subject?.trim()) params.subject = subject.trim();
      const response = await api.get('/videos/filters', { params });
      setFilterOptions(response.data);
    } catch (error) {
      console.error('Failed to fetch filter options:', error);
    }
  };

  const fetchVideos = useCallback(async (silent = false, page = currentPage) => {
    try {
      if (!silent) setLoading(true);
      const response = await api.get('/admin/videos', {
        params: buildFilterParams(filters, page, pageSize)
      });
      const data = response.data;
      if (Array.isArray(data)) {
        setVideos(data);
        setPagination(null);
      } else {
        setVideos(data.videos || []);
        setPagination(data.pagination || null);
        if (data.pagination?.page && data.pagination.page !== page) {
          setCurrentPage(data.pagination.page);
        }
      }
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to load videos');
      setMessageType('error');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters, currentPage, pageSize]);

  useEffect(() => {
    fetchFilterOptions();
  }, []);

  useEffect(() => {
    fetchFilterOptions(filters.subject);
  }, [filters.subject]);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
    } catch {
      // ignore
    }
  }, [filters]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    filters.subject,
    filters.grade,
    filters.unit,
    filters.lesson,
    filters.module,
    filters.version,
    filters.descriptionStatus,
    filters.search,
    pageSize
  ]);

  useEffect(() => {
    fetchVideos(false, currentPage);
  }, [fetchVideos, currentPage]);

  useEffect(() => {
    const hasActive = videos.some(
      (v) => v.subtitle_status === 'Processing' || v.ai_status === 'processing'
    );
    if (!hasActive) return undefined;
    const interval = setInterval(() => fetchVideos(true, currentPage), 5000);
    return () => clearInterval(interval);
  }, [videos, fetchVideos, currentPage]);

  const clearDesc = async (id) => {
    if (!confirm('Clear this AI-generated description? You can regenerate it later.')) return;
    try {
      await api.delete(`/admin/video/${id}/description`);
      await fetchVideos(true, currentPage);
      setMessage(`Cleared AI description for video #${id}`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.response?.data?.error || 'Failed to clear');
      setMessageType('error');
    }
  };

  const generateDesc = async (id) => {
    try {
      setGeneratingDescId(id);
      setMessage('Generating description with AI…');
      setMessageType('info');
      await api.post(`/videos/${id}/generate-description`);
      await fetchVideos(true, currentPage);
      setMessage(`AI description generated for video #${id}`);
      setMessageType('success');
    } catch (error) {
      setMessage(error.response?.data?.error || 'AI description generation failed');
      setMessageType('error');
    } finally {
      setGeneratingDescId(null);
    }
  };

  const runBulkGenerate = async ({ videoIds = null, missingOnly = true } = {}) => {
    const eligible = videoIds
      ? videos.filter((v) => videoIds.includes(v.id) && v.has_vtt)
      : videos.filter((v) => v.has_vtt && (!missingOnly || !v.has_ai_description));

    if (eligible.length === 0) {
      setMessage(
        missingOnly
          ? 'No videos with subtitles and missing AI descriptions match your selection.'
          : 'No eligible videos with subtitles match your selection.'
      );
      setMessageType('error');
      return;
    }

    const label = videoIds ? `${eligible.length} selected` : 'all filtered matching';
    const mode = missingOnly ? 'missing descriptions only' : 'all matching videos';
    if (!confirm(`Generate AI descriptions for ${label} (${mode})? Processing runs in the background.`)) {
      return;
    }

    try {
      setBulkGenerating(true);
      const body = { missingOnly };
      if (videoIds) {
        body.videoIds = videoIds;
      } else {
        body.filters = buildFilterParams(filters, 1, pageSize);
      }

      const response = await api.post('/admin/videos/bulk-generate-descriptions', body, {
        params: videoIds ? {} : buildFilterParams(filters, 1, pageSize)
      });

      const { queued, message: serverMessage } = response.data;
      await fetchVideos(true, currentPage);
      setMessage(serverMessage || `Started generating descriptions for ${queued} video(s) in the background.`);
      setMessageType('info');
      setSelectedIds(new Set());
    } catch (error) {
      setMessage(error.response?.data?.error || 'Bulk generation failed');
      setMessageType('error');
    } finally {
      setBulkGenerating(false);
    }
  };

  const handleToggleSelect = (id) => {
    const video = videos.find((v) => v.id === id);
    if (!video || !isBulkEligible(video)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    const eligibleIds = bulkEligibleVideos.map((v) => v.id);
    const allSelected =
      eligibleIds.length > 0 && eligibleIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(eligibleIds));
    }
  };

  const clearFilters = () => {
    setFilters(defaultFilters);
    setSearchInput('');
    setSelectedIds(new Set());
    setCurrentPage(1);
  };

  const removeFilter = (key) => {
    if (key === 'search') {
      setSearchInput('');
      setFilters((prev) => ({ ...prev, search: '' }));
    } else if (key === 'descriptionStatus') {
      setFilters((prev) => ({ ...prev, descriptionStatus: 'all' }));
    } else {
      setFilters((prev) => ({ ...prev, [key]: '' }));
    }
  };

  const toggleTranscript = (id) => {
    setExpandedTranscripts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkEligibleVideos = useMemo(() => videos.filter(isBulkEligible), [videos]);

  const activeChips = useMemo(() => {
    const chips = [];
    if (searchInput?.trim()) chips.push({ key: 'search', label: `${FILTER_LABELS.search}: ${searchInput.trim()}` });
    Object.entries(filters).forEach(([key, val]) => {
      if (key === 'search' || !val || val === 'all') return;
      chips.push({ key, label: `${FILTER_LABELS[key]}: ${val}` });
    });
    return chips;
  }, [filters, searchInput]);

  const processingCount = videos.filter((v) => v.subtitle_status === 'Processing').length;
  const aiProcessingCount = videos.filter((v) => v.ai_status === 'processing').length;
  const missingDescCount = videos.filter((v) => v.has_vtt && !v.has_ai_description).length;
  const isLive = processingCount > 0 || aiProcessingCount > 0 || loading;

  const footerSummary = pagination
    ? `Showing ${videos.length} of ${pagination.total} videos`
    : loading
      ? 'Loading…'
      : `${videos.length} video${videos.length === 1 ? '' : 's'}`;

  const pageNumbers = useMemo(() => {
    if (!pagination) return [];
    const { totalPages } = pagination;
    const count = Math.min(5, totalPages);
    return Array.from({ length: count }, (_, i) => {
      if (totalPages <= 5) return i + 1;
      if (currentPage <= 3) return i + 1;
      if (currentPage >= totalPages - 2) return totalPages - 4 + i;
      return currentPage - 2 + i;
    });
  }, [pagination, currentPage]);

  return (
    <div className="vd-page">
      <header className="vd-page-header">
        <div>
          <h1>Video descriptions</h1>
          <p>
            Review AI-generated descriptions sourced from subtitle transcripts. Descriptions are
            written by Gemini or OpenAI only — manual edits aren&apos;t supported here.
          </p>
        </div>
        <div className={`vd-live-pulse${isLive ? ' is-active' : ''}`} aria-live="polite">
          <span className="vd-dot" aria-hidden="true" />
          <span>
            {loading && videos.length === 0
              ? 'Loading…'
              : aiProcessingCount > 0
                ? `${aiProcessingCount} generating`
                : processingCount > 0
                  ? `${processingCount} subtitling`
                  : 'Up to date'}
          </span>
        </div>
      </header>

      <main>
        <section className="vd-filter-bar" aria-label="Filter videos">
          <div className="vd-filter-row">
            <div className="vd-field vd-field-search">
              <label htmlFor="vd-search">Search</label>
              <div className="vd-search-wrap">
                <Search className="vd-search-icon" aria-hidden="true" />
                <input
                  id="vd-search"
                  type="text"
                  className="vd-input"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Title, video ID, description…"
                  autoComplete="off"
                />
                {searchInput && (
                  <button
                    type="button"
                    className="vd-search-clear"
                    onClick={() => setSearchInput('')}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {[
              { id: 'subject', label: 'Subject', options: filterOptions.subjects, all: 'All subjects' },
              { id: 'grade', label: 'Grade', options: filterOptions.grades, all: 'All grades' },
              { id: 'unit', label: 'Unit', options: filterOptions.units, all: 'All units' },
              { id: 'lesson', label: 'Lesson', options: filterOptions.lessons, all: 'All lessons' },
              { id: 'module', label: 'Module', options: filterOptions.modules, all: 'All modules' },
              { id: 'version', label: 'Version', options: filterOptions.versions, all: 'All versions' }
            ].map(({ id, label, options, all }) => (
              <div key={id} className="vd-field vd-field-select">
                <label htmlFor={`vd-${id}`}>{label}</label>
                <select
                  id={`vd-${id}`}
                  className="vd-select"
                  value={filters[id]}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFilters((prev) => {
                      const next = { ...prev, [id]: value };
                      if (id === 'subject' && value !== prev.subject) {
                        next.grade = '';
                        next.unit = '';
                        next.lesson = '';
                        next.module = '';
                        next.version = '';
                      }
                      return next;
                    });
                  }}
                >
                  <option value="">{all}</option>
                  {(options || []).map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            ))}

            <div className="vd-field vd-field-select">
              <label htmlFor="vd-desc">Description</label>
              <select
                id="vd-desc"
                className="vd-select"
                value={filters.descriptionStatus}
                onChange={(e) => setFilters((prev) => ({ ...prev, descriptionStatus: e.target.value }))}
              >
                <option value="all">All</option>
                <option value="missing">Missing</option>
                <option value="has">Has description</option>
              </select>
            </div>

            <div className="vd-filter-actions">
              <button
                type="button"
                className="vd-btn vd-btn-secondary"
                onClick={() => fetchVideos(false, currentPage)}
                disabled={bulkGenerating}
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>
          </div>

          {activeChips.length > 0 && (
            <div className="vd-active-filters" aria-live="polite">
              {activeChips.map(({ key, label }) => (
                <span key={key} className="vd-chip">
                  {label}
                  <button type="button" onClick={() => removeFilter(key)} aria-label={`Remove ${label}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
              <button type="button" className="vd-chip-reset" onClick={clearFilters}>
                Clear all
              </button>
            </div>
          )}
        </section>

        {selectedIds.size > 0 && (
          <div className="vd-bulk-bar" role="region" aria-label="Bulk actions">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13 }}>
              <span><strong>{selectedIds.size}</strong> selected</span>
              <button type="button" className="vd-btn vd-btn-ghost vd-btn-sm" onClick={() => setSelectedIds(new Set())}>
                Deselect all
              </button>
            </div>
            <button
              type="button"
              className="vd-btn vd-btn-primary vd-btn-sm"
              onClick={() => runBulkGenerate({ videoIds: Array.from(selectedIds), missingOnly: true })}
              disabled={bulkGenerating}
            >
              {bulkGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Generate selected
            </button>
          </div>
        )}

        <div className="vd-gen-all-row">
          {missingDescCount > 0 && (
            <span className="vd-footer-summary">
              <strong>{missingDescCount}</strong> on this page ready for AI description
            </span>
          )}
          <button
            type="button"
            className="vd-btn vd-btn-primary"
            onClick={() => runBulkGenerate({ missingOnly: true })}
            disabled={bulkGenerating || missingDescCount === 0}
          >
            {bulkGenerating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate all filtered missing
          </button>
        </div>

        <section className="vd-table-wrap" aria-label="Videos">
          <div className="vd-table-scroll">
            <table className="vd-table">
              <caption className="vd-sr-only">
                Videos with subtitle and AI description status. Use checkboxes for bulk actions.
              </caption>
              <thead>
                <tr>
                  <th className="col-checkbox">
                    <input
                      type="checkbox"
                      className="vd-checkbox"
                      checked={
                        bulkEligibleVideos.length > 0
                        && bulkEligibleVideos.every((v) => selectedIds.has(v.id))
                      }
                      onChange={handleSelectAll}
                      disabled={bulkGenerating || bulkEligibleVideos.length === 0}
                      aria-label="Select all videos missing AI descriptions on this page"
                    />
                  </th>
                  <th>Video</th>
                  <th>Title</th>
                  <th>Subject</th>
                  <th>Subtitles</th>
                  <th>Description (AI)</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && videos.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skel-${i}`} className="data-row">
                      <td colSpan={7} style={{ padding: 14 }}>
                        <div className="vd-skel" style={{ width: `${60 + i * 8}%` }} />
                      </td>
                    </tr>
                  ))
                ) : videos.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="vd-empty-state">
                        <h3>No videos found</h3>
                        <p>Try adjusting your filters or search terms.</p>
                        {activeChips.length > 0 && (
                          <button type="button" className="vd-btn vd-btn-secondary" onClick={clearFilters}>
                            Clear filters
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  videos.map((video) => {
                    const status = video.subtitle_status || (video.has_vtt ? 'Yes' : 'No');
                    const aiDescription = video.has_ai_description ? (video.description || '') : '';
                    const isGenerating = generatingDescId === video.id || video.ai_status === 'processing';
                    const isBusy = bulkGenerating || isGenerating;
                    const hasTranscript = Boolean(video.subtitle_text?.trim());
                    const expanded = expandedTranscripts.has(video.id);

                    return (
                      <Fragment key={video.id}>
                        <tr
                          className={`data-row${selectedIds.has(video.id) ? ' is-selected' : ''}`}
                        >
                          <td className="col-checkbox">
                            <input
                              type="checkbox"
                              className="vd-checkbox"
                              checked={selectedIds.has(video.id)}
                              onChange={() => handleToggleSelect(video.id)}
                              disabled={bulkGenerating || !isBulkEligible(video)}
                              aria-label={
                                isBulkEligible(video)
                                  ? `Select ${video.title} for bulk generate`
                                  : `Already has AI description — ${video.title}`
                              }
                            />
                          </td>
                          <td className="vd-cell-video-id">
                            {video.video_id}
                            <span className="db-id">#{video.id}</span>
                          </td>
                          <td className="vd-cell-title">
                            <span className="title-text" title={video.title}>{video.title}</span>
                          </td>
                          <td className="vd-cell-subject">
                            <span className="subject-name">{video.subject || '—'}</span>
                            {(video.grade || video.unit) && (
                              <span>
                                {[video.grade && `Grade ${video.grade}`, video.unit && `Unit ${video.unit}`]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={status} />
                            {hasTranscript && (
                              <button
                                type="button"
                                className="vd-transcript-toggle"
                                onClick={() => toggleTranscript(video.id)}
                                aria-expanded={expanded}
                              >
                                <ChevronRight
                                  size={11}
                                  style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
                                />
                                {expanded ? 'Hide transcript' : 'View transcript'}
                              </button>
                            )}
                            {!hasTranscript && status === 'No' && (
                              <button type="button" className="vd-transcript-toggle" disabled>
                                No transcript yet
                              </button>
                            )}
                          </td>
                          <td className="desc-cell">
                            {isGenerating ? (
                              <div className="vd-generating-lines" aria-busy="true">
                                <span />
                                <span />
                                <span />
                              </div>
                            ) : aiDescription ? (
                              <>
                                <div className="vd-desc-text">{aiDescription}</div>
                                {video.description_source && (
                                  <span className="vd-desc-source" data-provider={video.description_source}>
                                    <span className="provider-dot" aria-hidden="true" />
                                    {video.description_source}
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="vd-desc-empty">Empty — generate from transcript</span>
                            )}
                          </td>
                          <td className="col-actions">
                            <div className="vd-row-actions">
                              {!video.has_ai_description && (
                                <button
                                  type="button"
                                  className="vd-btn vd-btn-primary vd-btn-sm"
                                  onClick={() => generateDesc(video.id)}
                                  disabled={isBusy || status === 'Processing' || !video.has_vtt}
                                  title={!video.has_vtt ? 'Subtitles required first' : undefined}
                                >
                                  {isGenerating ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <Sparkles size={14} />
                                  )}
                                  {isGenerating ? 'Generating…' : 'Generate'}
                                </button>
                              )}
                              {video.has_ai_description && (
                                <button
                                  type="button"
                                  className="vd-btn vd-btn-danger-ghost vd-btn-sm"
                                  onClick={() => clearDesc(video.id)}
                                  disabled={bulkGenerating}
                                >
                                  <Trash2 size={14} />
                                  Clear
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && hasTranscript && (
                          <tr className="vd-transcript-row">
                            <td colSpan={7}>
                              <div className="vd-transcript-panel">
                                <span className="panel-label">Subtitle transcript</span>
                                <div className="vtt-text">{video.subtitle_text}</div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="vd-table-footer">
            <div className="vd-footer-summary" aria-live="polite">{footerSummary}</div>

            <div className="vd-page-size-select">
              <label htmlFor="vd-page-size">Rows per page</label>
              <select
                id="vd-page-size"
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                disabled={bulkGenerating}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {pagination && pagination.totalPages > 1 && (
              <nav className="vd-pagination" aria-label="Pagination">
                <button
                  type="button"
                  className="vd-page-btn"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1 || loading || bulkGenerating}
                >
                  ‹
                </button>
                {pageNumbers.map((pageNum) => (
                  <button
                    key={pageNum}
                    type="button"
                    className="vd-page-btn"
                    aria-current={currentPage === pageNum ? 'true' : undefined}
                    onClick={() => setCurrentPage(pageNum)}
                    disabled={loading || bulkGenerating}
                  >
                    {pageNum}
                  </button>
                ))}
                <button
                  type="button"
                  className="vd-page-btn"
                  onClick={() => setCurrentPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={currentPage === pagination.totalPages || loading || bulkGenerating}
                >
                  ›
                </button>
              </nav>
            )}
          </div>
        </section>
      </main>

      {message && (
        <div className="vd-toast-region" aria-live="polite">
          <div className="vd-toast" data-kind={messageType}>
            <span>{message}</span>
            <button type="button" onClick={() => setMessage('')} aria-label="Dismiss">
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default VideoDescriptions;
