import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  X, Copy, Check, Loader2, Sparkles, Eye, Trash2, Save,
  AlertTriangle, History, RotateCcw, Search, FileText, Info,
} from 'lucide-react';
import api from '../services/api';
import './EditDescriptionModal.css';

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_DESC_CHARS = 2000;

// ─── Small reusable components ────────────────────────────────────────────────

function SourceBadge({ source }) {
  if (!source) return <span className="edm-src-badge edm-src-empty">EMPTY</span>;
  const s = source.toUpperCase();
  if (s === 'GEMINI') return <span className="edm-src-badge edm-src-gemini">GEMINI</span>;
  if (s === 'OPENAI') return <span className="edm-src-badge edm-src-openai">OPENAI</span>;
  if (s === 'MANUAL') return <span className="edm-src-badge edm-src-manual">MANUAL</span>;
  return <span className="edm-src-badge edm-src-other">{s}</span>;
}

function InfoRow({ label, value, mono = false, tag = false }) {
  if (!value) return null;
  return (
    <div className="edm-info-row">
      <span className="edm-info-label">{label}</span>
      {tag
        ? <SourceBadge source={value} />
        : <span className={`edm-info-value${mono ? ' mono' : ''}`}>{value}</span>}
    </div>
  );
}

function TabButton({ id, active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`edm-tab${active ? ' active' : ''}`}
      onClick={() => onClick(id)}
    >
      {children}
    </button>
  );
}

// ─── Transcript panel with inline search ─────────────────────────────────────
function TranscriptPanel({ transcript }) {
  const [search, setSearch]   = useState('');
  const [copied, setCopied]   = useState(false);

  const highlighted = useMemo(() => {
    if (!search.trim() || !transcript) return null;
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = transcript.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === search.toLowerCase()
        ? <mark key={i} className="edm-hl">{part}</mark>
        : part
    );
  }, [transcript, search]);

  const copyTranscript = async () => {
    if (!transcript) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <section className="edm-section">
      <div className="edm-section-header">
        <h3 className="edm-section-title">Transcript</h3>
        {transcript && (
          <button type="button" className="edm-icon-btn" onClick={copyTranscript}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {transcript && (
        <div className="edm-transcript-search">
          <Search size={13} className="edm-ts-icon" />
          <input
            type="text"
            className="edm-ts-input"
            placeholder="Search transcript…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search transcript"
          />
          {search && (
            <button type="button" className="edm-ts-clear" onClick={() => setSearch('')} aria-label="Clear">
              <X size={11} />
            </button>
          )}
        </div>
      )}

      <div className="edm-transcript-box">
        {transcript
          ? <pre className="edm-transcript-text">
              {highlighted || transcript}
            </pre>
          : <p className="edm-empty-note">No transcript available for this video.</p>
        }
      </div>
    </section>
  );
}

// ─── History tab panel ────────────────────────────────────────────────────────
function HistoryPanel({ videoId, currentDesc, onRestore }) {
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [restoring, setRestoring] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/video-descriptions/${videoId}/history`);
      setHistory(res.data.history || []);
    } catch { setHistory([]); }
    finally { setLoading(false); }
  }, [videoId]);

  useEffect(() => { load(); }, [load]);

  const handleRestore = async (entry) => {
    if (!confirm(`Restore this version from ${new Date(entry.changed_at).toLocaleString()}?`)) return;
    setRestoring(entry.id);
    try {
      const res = await api.post(`/admin/video-descriptions/${videoId}/restore/${entry.id}`, { restoredBy: 'admin' });
      onRestore?.(res.data.description, res.data.source);
      await load();
    } catch (err) {
      alert(err?.response?.data?.error || 'Restore failed');
    } finally { setRestoring(null); }
  };

  if (loading) return (
    <div className="edm-hist-loading">
      <Loader2 size={22} className="edm-spin" />
      <span>Loading history…</span>
    </div>
  );

  if (history.length === 0) return (
    <div className="edm-hist-empty">
      <History size={28} />
      <span>No history yet. Changes are saved here after each edit.</span>
    </div>
  );

  return (
    <div className="edm-hist-list">
      {history.map((entry) => {
        const isOpen = expanded === entry.id;
        const isSame = entry.description?.trim() === currentDesc?.trim();
        return (
          <div key={entry.id} className={`edm-hist-entry${isSame ? ' is-current' : ''}`}>
            <div className="edm-hist-header" onClick={() => setExpanded(isOpen ? null : entry.id)}>
              <div className="edm-hist-meta">
                <span className="edm-hist-time">{new Date(entry.changed_at).toLocaleString()}</span>
                <span className="edm-hist-by">by {entry.changed_by || 'system'}</span>
                <SourceBadge source={entry.source} />
                {isSame && <span className="edm-hist-current-tag">current</span>}
              </div>
              <div className="edm-hist-actions">
                <button
                  type="button"
                  className="vd-btn vd-btn-secondary vd-btn-sm"
                  onClick={(e) => { e.stopPropagation(); handleRestore(entry); }}
                  disabled={!!restoring || isSame}
                  title={isSame ? 'Already the current version' : 'Restore this version'}
                >
                  {restoring === entry.id
                    ? <Loader2 size={12} className="edm-spin" />
                    : <RotateCcw size={12} />}
                  Restore
                </button>
              </div>
            </div>
            {isOpen && (
              <div className="edm-hist-body">
                <pre className="edm-hist-text">{entry.description || <em className="edm-empty-note">Empty</em>}</pre>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Info / Audit tab panel ───────────────────────────────────────────────────
function AuditPanel({ detail }) {
  const fmt = (d) => d ? new Date(d).toLocaleString() : '—';
  return (
    <div className="edm-audit">
      <section className="edm-section">
        <h3 className="edm-section-title">Video Metadata</h3>
        <div className="edm-info-grid">
          <InfoRow label="Video ID"    value={detail.videoId}  mono />
          <InfoRow label="Internal ID" value={`#${detail.id}`} mono />
          <InfoRow label="Title"       value={detail.title} />
          <InfoRow label="Subject"     value={detail.subject} />
          <InfoRow label="Grade"       value={detail.grade} />
          <InfoRow label="Unit"        value={detail.unit} />
          <InfoRow label="Lesson"      value={detail.lesson} />
          <InfoRow label="Module"      value={detail.module} />
          <InfoRow label="Version"     value={detail.version} />
        </div>
      </section>
      <section className="edm-section">
        <h3 className="edm-section-title">Audit Metadata</h3>
        <div className="edm-info-grid">
          <InfoRow label="Source"      value={detail.descriptionSource} tag />
          <InfoRow label="Created"     value={fmt(detail.createdAt)} />
          <InfoRow label="Last Updated" value={fmt(detail.updatedAt)} />
        </div>
      </section>
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
function EditDescriptionModal({ videoRow, onClose, onSaved, onCleared }) {
  const [detail, setDetail]         = useState(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [regenerating, setRegen]    = useState(false);
  const [loadError, setLoadError]   = useState(null);
  const [description, setDesc]      = useState('');
  const [showPreview, setPreview]   = useState(false);
  const [dirty, setDirty]           = useState(false);
  const [activeTab, setActiveTab]   = useState('edit');

  const originalDescRef = useRef('');
  const modalRef        = useRef(null);
  const textareaRef     = useRef(null);

  // ── Load detail ─────────────────────────────────────────────────────────────
  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get(`/admin/video-descriptions/${videoRow.id}`);
      const d = res.data;
      setDetail(d);
      setDesc(d.description || '');
      originalDescRef.current = d.description || '';
      setDirty(false);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Unknown error';
      setDetail(null);
      setLoadError(msg);
    } finally { setLoading(false); }
  }, [videoRow.id]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // ── Dirty tracking ───────────────────────────────────────────────────────────
  useEffect(() => { setDirty(description !== originalDescRef.current); }, [description]);

  // ── ESC key ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  // ── Auto-focus ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && modalRef.current) modalRef.current.focus();
  }, [loading]);

  const handleClose = () => {
    if (dirty && !confirm('You have unsaved changes. Discard and close?')) return;
    onClose();
  };

  const handleBackdropClick = (e) => { if (e.target === e.currentTarget) handleClose(); };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/video-descriptions/${videoRow.id}`, { description, updatedBy: 'admin' });
      originalDescRef.current = description;
      setDirty(false);
      onSaved?.({ id: videoRow.id, description });
    } catch (err) {
      onSaved?.({ error: err?.response?.data?.error || 'Failed to save changes.' });
    } finally { setSaving(false); }
  };

  // ── Regenerate AI ────────────────────────────────────────────────────────────
  const handleRegenerate = async () => {
    if (!confirm('Regenerate AI description? This will overwrite the current text.')) return;
    setRegen(true);
    try {
      await api.post(`/videos/${videoRow.id}/generate-description`);
      await loadDetail();
      onSaved?.({ id: videoRow.id, regenerated: true, keepOpen: true });
    } catch (err) {
      onSaved?.({ error: err?.response?.data?.error || 'Failed to regenerate.', keepOpen: true });
    } finally { setRegen(false); }
  };

  // ── Clear description ────────────────────────────────────────────────────────
  const handleClear = async () => {
    if (!confirm('Clear the AI-generated description? You can regenerate it later.')) return;
    try {
      await api.delete(`/admin/video/${videoRow.id}/description`);
      setDesc('');
      originalDescRef.current = '';
      setDirty(false);
      onCleared?.(videoRow.id);
    } catch (err) {
      onSaved?.({ error: err?.response?.data?.error || 'Failed to clear.', keepOpen: true });
    }
  };

  // ── Restore from history ─────────────────────────────────────────────────────
  const handleRestore = (restoredDesc, restoredSource) => {
    setDesc(restoredDesc || '');
    originalDescRef.current = restoredDesc || '';
    setDirty(false);
    if (detail) setDetail((d) => ({ ...d, description: restoredDesc || '', descriptionSource: restoredSource }));
    setActiveTab('edit');
    onSaved?.({ id: videoRow.id, regenerated: false, keepOpen: true });
  };

  const charCount = description.length;

  return (
    <div
      className="edm-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Video Description"
      onClick={handleBackdropClick}
    >
      <div className="edm-modal" ref={modalRef} tabIndex={-1}>

        {/* ── Header ── */}
        <div className="edm-header">
          <div className="edm-header-left">
            <h2 className="edm-title">Edit Video Description</h2>
            {detail && (
              <span className="edm-subtitle">
                {detail.videoId}{detail.title && ` · ${detail.title}`}
              </span>
            )}
          </div>
          <div className="edm-header-right">
            {detail && <SourceBadge source={detail.descriptionSource} />}
            <button type="button" className="edm-close-btn" onClick={handleClose} aria-label="Close modal">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Loading / Error states ── */}
        {loading ? (
          <div className="edm-loading">
            <Loader2 size={32} className="edm-spin" />
            <span>Loading video details…</span>
          </div>
        ) : !detail ? (
          <div className="edm-loading">
            <AlertTriangle size={28} />
            <span>Failed to load video details.</span>
            {loadError && <span className="edm-error-detail">{loadError}</span>}
            <button type="button" className="vd-btn vd-btn-secondary vd-btn-sm" onClick={loadDetail}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* ── Two-column body ── */}
            <div className="edm-body">

              {/* LEFT: Video info + Transcript */}
              <div className="edm-col edm-col-left">
                <section className="edm-section">
                  <h3 className="edm-section-title">Video Information</h3>
                  <div className="edm-info-grid">
                    <InfoRow label="Video ID"    value={detail.videoId}  mono />
                    <InfoRow label="Internal ID" value={`#${detail.id}`} mono />
                    <InfoRow label="Title"       value={detail.title} />
                    <InfoRow label="Subject"     value={detail.subject} />
                    <InfoRow label="Grade"       value={detail.grade} />
                    <InfoRow label="Unit"        value={detail.unit} />
                    <InfoRow label="Lesson"      value={detail.lesson} />
                    <InfoRow label="Module"      value={detail.module} />
                    <InfoRow label="Version"     value={detail.version} />
                  </div>
                </section>
                <TranscriptPanel transcript={detail.transcript} />
              </div>

              {/* RIGHT: Tabbed panel */}
              <div className="edm-col edm-col-right">

                {/* Tab bar */}
                <div className="edm-tabs" role="tablist">
                  <TabButton id="edit"    active={activeTab === 'edit'}    onClick={setActiveTab}>
                    <FileText size={13} /> Edit
                  </TabButton>
                  <TabButton id="history" active={activeTab === 'history'} onClick={setActiveTab}>
                    <History size={13} /> History
                  </TabButton>
                  <TabButton id="info"    active={activeTab === 'info'}    onClick={setActiveTab}>
                    <Info size={13} /> Info
                  </TabButton>
                </div>

                {/* ── EDIT TAB ── */}
                {activeTab === 'edit' && (
                  <div className="edm-tab-panel" role="tabpanel">

                    {/* Inline preview */}
                    {showPreview && (
                      <section className="edm-preview-card">
                        <div className="edm-preview-header">
                          <Eye size={13} /> <span>Preview</span>
                          <button type="button" className="edm-close-preview" onClick={() => setPreview(false)} aria-label="Close preview">
                            <X size={13} />
                          </button>
                        </div>
                        <div className="edm-preview-title">{detail.title || 'Untitled Video'}</div>
                        {description.trim()
                          ? <p className="edm-preview-desc">{description}</p>
                          : <p className="edm-preview-empty">No description to preview.</p>
                        }
                        <SourceBadge source={detail.descriptionSource} />
                      </section>
                    )}

                    {/* Description textarea */}
                    <section className="edm-section">
                      <div className="edm-section-header">
                        <h3 className="edm-section-title">Description</h3>
                        <span className={`edm-char-count${charCount > MAX_DESC_CHARS ? ' over-limit' : ''}`}>
                          {charCount} / {MAX_DESC_CHARS}
                        </span>
                      </div>
                      <textarea
                        ref={textareaRef}
                        className="edm-textarea edm-textarea-main"
                        value={description}
                        onChange={(e) => setDesc(e.target.value)}
                        placeholder="AI description will appear here after generation…"
                        rows={10}
                        maxLength={MAX_DESC_CHARS + 200}
                        aria-label="Video description"
                      />
                    </section>

                    {/* Meta row */}
                    <div className="edm-meta-row">
                      {detail.descriptionSource && (
                        <span className="edm-meta-badge">
                          Source: <strong>{detail.descriptionSource}</strong>
                        </span>
                      )}
                      {detail.updatedAt && (
                        <span className="edm-meta-date">
                          Updated: {new Date(detail.updatedAt).toLocaleString()}
                        </span>
                      )}
                    </div>

                    {/* Secondary actions */}
                    <div className="edm-secondary-actions">
                      <button
                        type="button"
                        className="vd-btn vd-btn-primary vd-btn-sm"
                        onClick={handleRegenerate}
                        disabled={regenerating || saving || !detail.transcript}
                        title={!detail.transcript ? 'Transcript required to regenerate' : undefined}
                      >
                        {regenerating ? <Loader2 size={13} className="edm-spin" /> : <Sparkles size={13} />}
                        {regenerating ? 'Regenerating…' : 'Regenerate AI'}
                      </button>
                      <button
                        type="button"
                        className="vd-btn vd-btn-danger-ghost vd-btn-sm"
                        onClick={handleClear}
                        disabled={saving || regenerating || !description}
                      >
                        <Trash2 size={13} /> Clear
                      </button>
                    </div>
                  </div>
                )}

                {/* ── HISTORY TAB ── */}
                {activeTab === 'history' && (
                  <div className="edm-tab-panel" role="tabpanel">
                    <HistoryPanel
                      videoId={videoRow.id}
                      currentDesc={description}
                      onRestore={handleRestore}
                    />
                  </div>
                )}

                {/* ── INFO TAB ── */}
                {activeTab === 'info' && (
                  <div className="edm-tab-panel" role="tabpanel">
                    <AuditPanel detail={detail} />
                  </div>
                )}
              </div>
            </div>

            {/* ── Sticky Footer ── */}
            <div className="edm-footer">
              {dirty && (
                <span className="edm-unsaved-notice">
                  <AlertTriangle size={13} /> Unsaved changes
                </span>
              )}
              <div className="edm-footer-actions">
                <button type="button" className="vd-btn vd-btn-secondary" onClick={handleClose} disabled={saving}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="vd-btn vd-btn-secondary"
                  onClick={() => setPreview((p) => !p)}
                  disabled={saving || activeTab !== 'edit'}
                >
                  <Eye size={13} /> {showPreview ? 'Hide Preview' : 'Preview'}
                </button>
                <button
                  type="button"
                  className="vd-btn vd-btn-primary"
                  onClick={handleSave}
                  disabled={saving || !dirty}
                >
                  {saving ? <Loader2 size={13} className="edm-spin" /> : <Save size={13} />}
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default EditDescriptionModal;
