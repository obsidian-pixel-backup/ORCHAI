import { useEffect, useState, useCallback } from 'react';
import './ModelLibraryPanel.css';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';

const API = 'http://127.0.0.1:8000/api/models';

interface InstalledModel {
  name: string;
  size_bytes: number;
  size_human: string;
  parameter_size: string;
  quantization: string;
  family: string;
  capabilities?: string[];
  can_chat?: boolean;
  supports_tools?: boolean;
  supports_vision?: boolean;
  supports_thinking?: boolean;
}

interface HFResult {
  repo: string;
  display_name: string;
  author: string;
  downloads: number;
  likes: number;
  pipeline_tag: string;
}

interface HFFile {
  filename: string;
  quant: string;
  size_bytes: number;
  size_human: string;
  pull_model: string;
}

interface PullState {
  model: string;
  status: string;
  percent: number;
  error?: string;
}

interface ModelLibraryPanelProps {
  onClose: () => void;
  onModelsChanged: () => void;
}

/**
 * Turn an Ollama/HF model string into a readable label for the download banner.
 * e.g. "hf.co/unsloth/SmolLM2-135M-Instruct-GGUF:F16" -> "SmolLM2 135M Instruct · F16"
 */
function friendlyModelLabel(model: string): string {
  let base = model;
  let quant = '';
  const colon = base.lastIndexOf(':');
  if (colon > -1) {
    quant = base.slice(colon + 1);
    base = base.slice(0, colon);
  }
  base = base.replace(/^hf\.co\//i, '');
  const last = base.includes('/') ? base.split('/').pop()! : base;
  const name = last
    .replace(/-?GGUF$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return quant ? `${name} · ${quant}` : name;
}

export function ModelLibraryPanel({ onClose, onModelsChanged }: ModelLibraryPanelProps) {
  const [tab, setTab] = useState<'installed' | 'discover'>('installed');

  // Installed models
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [totalHuman, setTotalHuman] = useState('');
  const [installedLoading, setInstalledLoading] = useState(true);
  const [installedError, setInstalledError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Discover (Hugging Face)
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HFResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<HFFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Active download
  const [pull, setPull] = useState<PullState | null>(null);

  const fetchInstalled = useCallback(async () => {
    setInstalledLoading(true);
    try {
      const res = await fetch(`${API}/installed`);
      const data = await res.json();
      setInstalled(data.models || []);
      setTotalHuman(data.total_human || '');
      setInstalledError(data.error || null);
    } catch (e: any) {
      setInstalledError(e.message || 'Failed to reach backend.');
      setInstalled([]);
    } finally {
      setInstalledLoading(false);
    }
  }, []);

  useEffect(() => { fetchInstalled(); }, [fetchInstalled]);

  const performDelete = async (name: string) => {
    setDeleting(name);
    try {
      const res = await fetch(`${API}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!data.success) {
        setInstalledError(data.error || 'Delete failed.');
      } else {
        await fetchInstalled();
        onModelsChanged();
      }
    } catch (e: any) {
      setInstalledError(e.message || 'Delete failed.');
    } finally {
      setDeleting(null);
      setPendingDelete(null);
    }
  };

  const runSearch = useCallback(async (rawTerm: string) => {
    const term = rawTerm.trim();
    if (!term) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setExpandedRepo(null);
    setFiles([]);
    try {
      const res = await fetch(`${API}/hf/search?query=${encodeURIComponent(term)}`);
      const data = await res.json();
      setResults(data.results || []);
      setSearchError(data.error || null);
    } catch (e: any) {
      setSearchError(e.message || 'Search failed.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    runSearch(query);
  };

  // Live search: debounce keystrokes so results refresh automatically without
  // needing to click Search again. Each keystroke cancels the previous timer.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(() => runSearch(term), 450);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const handleExpand = async (repo: string) => {
    if (expandedRepo === repo) { setExpandedRepo(null); return; }
    setExpandedRepo(repo);
    setFiles([]);
    setFilesError(null);
    setFilesLoading(true);
    try {
      const res = await fetch(`${API}/hf/files?repo=${encodeURIComponent(repo)}`);
      const data = await res.json();
      setFiles(data.files || []);
      setFilesError(data.error || null);
    } catch (e: any) {
      setFilesError(e.message || 'Could not list files.');
    } finally {
      setFilesLoading(false);
    }
  };

  const handlePull = async (model: string) => {
    if (pull && !pull.error && pull.percent < 100 && pull.status !== 'done') return;
    setPull({ model, status: 'starting', percent: 0 });
    try {
      const res = await fetch(`${API}/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        let detail = `The backend returned an error (HTTP ${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error || j?.detail) detail = j.error || j.detail;
        } catch { /* body wasn't JSON */ }
        setPull({ model, status: 'error', percent: 0, error: detail });
        return;
      }
      if (!res.body) {
        setPull({ model, status: 'error', percent: 0, error: 'The backend did not return a download progress stream.' });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: any;
          try { evt = JSON.parse(line); } catch { continue; }
          if (evt.error) {
            setPull({ model, status: 'error', percent: 0, error: evt.error });
            return;
          }
          setPull({
            model,
            status: evt.status || 'downloading',
            percent: typeof evt.percent === 'number' ? evt.percent : (evt.done ? 100 : 0),
          });
        }
      }
      setPull({ model, status: 'done', percent: 100 });
      await fetchInstalled();
      onModelsChanged();
    } catch (e: any) {
      // A raw "Failed to fetch" / TypeError means the request never reached the
      // backend (it was down, restarting, or the stream was interrupted).
      const raw = e?.message || '';
      const isNetwork = e?.name === 'TypeError' || /failed to fetch|network|load failed/i.test(raw);
      const msg = isNetwork
        ? 'Couldn’t reach the ORCHAI backend (it may be starting up or was interrupted). Wait a moment and try the download again.'
        : (raw || 'Download failed.');
      setPull({ model, status: 'error', percent: 0, error: msg });
    }
  };

  const isPulling = !!pull && !pull.error && pull.status !== 'done';

  return (
    <>
    <div className="model-library-overlay" onClick={onClose}>
      <div className="model-library-card" onClick={(e) => e.stopPropagation()}>
        <div className="ml-header">
          <h2>Model Library</h2>
          <button className="ml-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="ml-tabs">
          <button className={`ml-tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
            Installed{installed.length ? ` (${installed.length})` : ''}
          </button>
          <button className={`ml-tab ${tab === 'discover' ? 'active' : ''}`} onClick={() => setTab('discover')}>
            Discover · Hugging Face
          </button>
        </div>

        {/* Active download banner (persists across tab switches) */}
        {pull && (
          <div className={`ml-pull-banner ${pull.error ? 'error' : pull.status === 'done' ? 'done' : ''}`}>
            <div className="ml-pull-top">
              <span className="ml-pull-model" title={pull.model}>{friendlyModelLabel(pull.model)}</span>
              <span className="ml-pull-status">
                {pull.error ? 'Failed' : pull.status === 'done' ? 'Installed ✓' : `${pull.status} ${pull.percent}%`}
              </span>
              {(pull.error || pull.status === 'done') && (
                <button className="ml-pull-dismiss" onClick={() => setPull(null)}>✕</button>
              )}
            </div>
            {!pull.error && (
              <div className="ml-progress-track">
                <div className="ml-progress-fill" style={{ width: `${pull.percent}%` }} />
              </div>
            )}
            {pull.error && <div className="ml-pull-error">{pull.error}</div>}
          </div>
        )}

        <div className="ml-body">
          {tab === 'installed' && (
            <div className="ml-installed">
              <div className="ml-installed-summary">
                <span>{installed.length} model{installed.length === 1 ? '' : 's'} installed</span>
                {totalHuman && <span className="ml-total">{totalHuman} on disk</span>}
                <button className="ml-refresh" onClick={fetchInstalled} disabled={installedLoading}>Refresh</button>
              </div>

              {installedLoading && <div className="ml-msg">Loading installed models…</div>}
              {installedError && <div className="ml-msg error">{installedError}</div>}
              {!installedLoading && !installedError && installed.length === 0 && (
                <div className="ml-msg">No models installed yet. Use the Discover tab to download one.</div>
              )}

              {installed.map((m) => (
                <div key={m.name} className="ml-model-row">
                  <div className="ml-model-info">
                    <span className="ml-model-name">{friendlyModelLabel(m.name)}</span>
                    <span className="ml-model-id" title={m.name}>{m.name}</span>
                    {[m.parameter_size, m.family].filter(Boolean).length > 0 && (
                      <span className="ml-model-meta">
                        {[m.parameter_size, m.family].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <div className="ml-caps">
                      {m.can_chat === false ? (
                        <span
                          className="ml-cap nochat"
                          title="This is an embedding model — it can't generate replies, so it won't work in chat."
                        >
                          ⚠ Not chat-compatible
                        </span>
                      ) : (
                        <span className="ml-cap chat" title="Works in chat">💬 Chat</span>
                      )}
                      {m.supports_tools && <span className="ml-cap" title="Supports tool / function calling">🔧 Tools</span>}
                      {m.supports_vision && <span className="ml-cap" title="Can see images">👁 Vision</span>}
                      {m.supports_thinking && <span className="ml-cap" title="Chain-of-thought reasoning">🧠 Reasoning</span>}
                    </div>
                  </div>
                  <span className="ml-model-size">{m.size_human}</span>
                  <button
                    className="ml-delete-btn"
                    onClick={() => setPendingDelete(m.name)}
                    disabled={deleting === m.name}
                  >
                    {deleting === m.name ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'discover' && (
            <div className="ml-discover">
              <form className="ml-search-form" onSubmit={handleSearch}>
                <input
                  type="text"
                  placeholder="Search Hugging Face for GGUF models (e.g. llama 3.2, qwen coder)…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="submit" disabled={searching || !query.trim()}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>

              {searchError && <div className="ml-msg error">{searchError}</div>}
              {!searching && !searchError && results.length === 0 && (
                <div className="ml-msg">Search for a model to see downloadable GGUF quantizations.</div>
              )}

              {results.map((r) => (
                <div key={r.repo} className="ml-hf-repo">
                  <button className="ml-hf-repo-head" onClick={() => handleExpand(r.repo)}>
                    <div className="ml-hf-repo-title">
                      <span className="ml-hf-repo-name">{r.display_name || r.repo}</span>
                      <span className="ml-hf-repo-sub">
                        <span className="ml-hf-repo-id">{r.repo}</span>
                        <span className="ml-hf-repo-stats">
                          ↓ {r.downloads.toLocaleString()} · ♥ {r.likes.toLocaleString()}
                        </span>
                      </span>
                    </div>
                    <span className={`ml-chevron ${expandedRepo === r.repo ? 'open' : ''}`}>▾</span>
                  </button>

                  {expandedRepo === r.repo && (
                    <div className="ml-hf-files">
                      {filesLoading && <div className="ml-msg small">Loading quantizations…</div>}
                      {filesError && <div className="ml-msg error small">{filesError}</div>}
                      {!filesLoading && !filesError && files.length === 0 && (
                        <div className="ml-msg small">No single-file GGUF quantizations found in this repo.</div>
                      )}
                      {files.map((f) => (
                        <div key={f.filename} className="ml-hf-file-row">
                          <span className="ml-quant-badge">{f.quant}</span>
                          <span className="ml-file-name" title={f.filename}>{f.filename}</span>
                          <span className="ml-file-size">{f.size_human}</span>
                          <button
                            className="ml-download-btn"
                            onClick={() => handlePull(f.pull_model)}
                            disabled={isPulling}
                          >
                            {isPulling && pull?.model === f.pull_model ? 'Downloading…' : 'Download'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>

    <ConfirmDialog
      isOpen={!!pendingDelete}
      danger
      title="Delete model?"
      message={`"${pendingDelete ? friendlyModelLabel(pendingDelete) : ''}" will be removed and its disk space reclaimed. This can't be undone.`}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      busy={!!deleting}
      onConfirm={() => { if (pendingDelete) performDelete(pendingDelete); }}
      onCancel={() => setPendingDelete(null)}
    />
    </>
  );
}
