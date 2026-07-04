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

function parseParamSize(sizeStr?: string): number {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/([\d.]+)([A-Za-z]+)/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'B') return val * 1e9;
  if (unit === 'M') return val * 1e6;
  if (unit === 'T') return val * 1e12;
  if (unit === 'K') return val * 1e3;
  return val;
}

function inferHFCapabilities(repo: string, pipeline_tag: string) {
  const lower = repo.toLowerCase();
  return {
    chat: lower.includes('chat') || lower.includes('instruct') || lower.includes('hermes'),
    tools: lower.includes('tool') || lower.includes('function') || lower.includes('coder'),
    vision: lower.includes('vl') || lower.includes('vision') || pipeline_tag === 'image-text-to-text',
    reasoning: lower.includes('reason') || lower.includes('think') || lower.includes('math') || lower.includes('r1')
  };
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

  // Filters & Sorting for Installed
  const [installedSearch, setInstalledSearch] = useState('');
  const [installedSort, setInstalledSort] = useState<'name' | 'size_desc' | 'size_asc' | 'params_desc'>('size_desc');
  const [capFilters, setCapFilters] = useState({
    chat: false,
    tools: false,
    vision: false,
    reasoning: false
  });
  const [sizeFilter, setSizeFilter] = useState<'all' | 'small' | 'medium' | 'large'>('all');

  // Discover (Hugging Face)
  const [discoverSort, setDiscoverSort] = useState<'downloads' | 'likes' | 'params_desc' | 'name'>('downloads');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HFResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [files, setFiles] = useState<HFFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Active downloads
  const [pulls, setPulls] = useState<Record<string, PullState>>({});

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
  // When tab is 'discover', we also fetch top models if query is empty.
  useEffect(() => {
    if (tab !== 'discover') return;
    const term = query.trim();
    const timer = setTimeout(() => runSearch(term), term ? 450 : 0);
    return () => clearTimeout(timer);
  }, [query, tab, runSearch]);

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
    const p = pulls[model];
    if (p && !p.error && p.percent < 100 && p.status !== 'done') return;
    
    setPulls(prev => ({ ...prev, [model]: { model, status: 'starting', percent: 0 } }));
    
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
        setPulls(prev => ({ ...prev, [model]: { model, status: 'error', percent: 0, error: detail } }));
        return;
      }
      if (!res.body) {
        setPulls(prev => ({ ...prev, [model]: { model, status: 'error', percent: 0, error: 'The backend did not return a download progress stream.' } }));
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
            setPulls(prev => ({ ...prev, [model]: { model, status: 'error', percent: 0, error: evt.error } }));
            return;
          }
          setPulls(prev => ({
            ...prev,
            [model]: {
              model,
              status: evt.status || 'downloading',
              percent: typeof evt.percent === 'number' ? evt.percent : (evt.done ? 100 : 0),
            }
          }));
        }
      }
      setPulls(prev => ({ ...prev, [model]: { model, status: 'done', percent: 100 } }));
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
      setPulls(prev => ({ ...prev, [model]: { model, status: 'error', percent: 0, error: msg } }));
    }
  };

  const isPulling = (model: string) => {
    const p = pulls[model];
    return !!p && !p.error && p.status !== 'done';
  };

  const getFilteredAndSortedInstalled = () => {
    let list = [...installed];
    
    if (capFilters.chat) list = list.filter(m => m.can_chat !== false);
    if (capFilters.tools) list = list.filter(m => m.supports_tools);
    if (capFilters.vision) list = list.filter(m => m.supports_vision);
    if (capFilters.reasoning) list = list.filter(m => m.supports_thinking);
    
    if (sizeFilter !== 'all') {
      list = list.filter(m => {
        const p = parseParamSize(m.parameter_size);
        if (!p) return true;
        if (sizeFilter === 'small') return p < 7e9;
        if (sizeFilter === 'medium') return p >= 7e9 && p <= 14e9;
        return p > 14e9;
      });
    }

    if (installedSearch.trim()) {
      const q = installedSearch.toLowerCase();
      list = list.filter(m => 
        m.name.toLowerCase().includes(q) || 
        (m.family && m.family.toLowerCase().includes(q))
      );
    }
    
    list.sort((a, b) => {
      if (installedSort === 'name') {
        return a.name.localeCompare(b.name);
      } else if (installedSort === 'size_desc') {
        return (b.size_bytes || 0) - (a.size_bytes || 0);
      } else if (installedSort === 'size_asc') {
        return (a.size_bytes || 0) - (b.size_bytes || 0);
      } else if (installedSort === 'params_desc') {
        return parseParamSize(b.parameter_size) - parseParamSize(a.parameter_size);
      }
      return 0;
    });
    
    return list;
  };

  const getFilteredAndSortedDiscover = () => {
    let list = [...results];
    
    if (capFilters.chat) list = list.filter(m => inferHFCapabilities(m.repo, m.pipeline_tag).chat);
    if (capFilters.tools) list = list.filter(m => inferHFCapabilities(m.repo, m.pipeline_tag).tools);
    if (capFilters.vision) list = list.filter(m => inferHFCapabilities(m.repo, m.pipeline_tag).vision);
    if (capFilters.reasoning) list = list.filter(m => inferHFCapabilities(m.repo, m.pipeline_tag).reasoning);
    
    if (sizeFilter !== 'all') {
      list = list.filter(m => {
        const p = parseParamSize(m.repo);
        if (!p) return true;
        if (sizeFilter === 'small') return p < 7e9;
        if (sizeFilter === 'medium') return p >= 7e9 && p <= 14e9;
        return p > 14e9;
      });
    }
    
    list.sort((a, b) => {
      if (discoverSort === 'name') {
        return a.repo.localeCompare(b.repo);
      } else if (discoverSort === 'params_desc') {
        return parseParamSize(b.repo) - parseParamSize(a.repo);
      } else if (discoverSort === 'likes') {
        return b.likes - a.likes;
      }
      return b.downloads - a.downloads;
    });
    
    return list;
  };

  const processedInstalled = getFilteredAndSortedInstalled();
  const processedDiscover = getFilteredAndSortedDiscover();

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

        {/* Active download banners (persists across tab switches) */}
        {Object.values(pulls).map((p) => (
          <div key={p.model} className={`ml-pull-banner ${p.error ? 'error' : p.status === 'done' ? 'done' : ''}`}>
            <div className="ml-pull-top">
              <span className="ml-pull-model" title={p.model}>{friendlyModelLabel(p.model)}</span>
              <span className="ml-pull-status">
                {p.error ? 'Failed' : p.status === 'done' ? 'Installed ✓' : `${p.status} ${p.percent}%`}
              </span>
              {(p.error || p.status === 'done') && (
                <button className="ml-pull-dismiss" onClick={() => setPulls(prev => {
                  const next = { ...prev };
                  delete next[p.model];
                  return next;
                })}>✕</button>
              )}
            </div>
            {!p.error && (
              <div className="ml-progress-track">
                <div className="ml-progress-fill" style={{ width: `${p.percent}%` }} />
              </div>
            )}
            {p.error && <div className="ml-pull-error">{p.error}</div>}
          </div>
        ))}

        <div className="ml-body">
          {tab === 'installed' && (
            <div className="ml-installed">
              <div className="ml-installed-summary">
                <span>{installed.length} model{installed.length === 1 ? '' : 's'} installed</span>
                {totalHuman && <span className="ml-total">{totalHuman} on disk</span>}
                <button className="ml-refresh" onClick={fetchInstalled} disabled={installedLoading}>Refresh</button>
              </div>

              {!installedLoading && !installedError && installed.length > 0 && (
                <div className="ml-installed-controls">
                  <input
                    type="text"
                    className="ml-installed-search"
                    placeholder="Filter models..."
                    value={installedSearch}
                    onChange={(e) => setInstalledSearch(e.target.value)}
                  />
                  <select
                    className="ml-installed-sort"
                    value={installedSort}
                    onChange={(e) => setInstalledSort(e.target.value as any)}
                  >
                    <option value="size_desc">Largest First</option>
                    <option value="size_asc">Smallest First</option>
                    <option value="params_desc">Most Params</option>
                    <option value="name">Name (A-Z)</option>
                  </select>
                  <select
                    className="ml-installed-sort"
                    value={sizeFilter}
                    onChange={(e) => setSizeFilter(e.target.value as any)}
                  >
                    <option value="all">All Sizes</option>
                    <option value="small">&lt; 7B Params</option>
                    <option value="medium">7B - 14B Params</option>
                    <option value="large">&gt; 14B Params</option>
                  </select>
                  <div className="ml-installed-caps-filter">
                    <label>
                      <input type="checkbox" checked={capFilters.chat} onChange={(e) => setCapFilters(prev => ({ ...prev, chat: e.target.checked }))} />
                      💬 Chat
                    </label>
                    <label>
                      <input type="checkbox" checked={capFilters.tools} onChange={(e) => setCapFilters(prev => ({ ...prev, tools: e.target.checked }))} />
                      🔧 Tools
                    </label>
                    <label>
                      <input type="checkbox" checked={capFilters.vision} onChange={(e) => setCapFilters(prev => ({ ...prev, vision: e.target.checked }))} />
                      👁 Vision
                    </label>
                    <label>
                      <input type="checkbox" checked={capFilters.reasoning} onChange={(e) => setCapFilters(prev => ({ ...prev, reasoning: e.target.checked }))} />
                      🧠 Reasoning
                    </label>
                  </div>
                </div>
              )}

              {installedLoading && <div className="ml-msg">Loading installed models…</div>}
              {installedError && <div className="ml-msg error">{installedError}</div>}
              {!installedLoading && !installedError && installed.length === 0 && (
                <div className="ml-msg">No models installed yet. Use the Discover tab to download one.</div>
              )}
              {!installedLoading && !installedError && installed.length > 0 && processedInstalled.length === 0 && (
                <div className="ml-msg">No models match your filters.</div>
              )}

              {processedInstalled.map((m) => (
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
                <button type="submit" disabled={searching}>
                  {searching ? 'Searching…' : 'Search'}
                </button>
              </form>

              {!searching && !searchError && (
                <div className="ml-installed-controls" style={{ marginTop: '-4px' }}>
                  <select
                    className="ml-installed-sort"
                    value={discoverSort}
                    onChange={(e) => setDiscoverSort(e.target.value as any)}
                  >
                    <option value="downloads">Most Downloaded</option>
                    <option value="likes">Most Liked</option>
                    <option value="params_desc">Most Params</option>
                    <option value="name">Name (A-Z)</option>
                  </select>
                  <select
                    className="ml-installed-sort"
                    value={sizeFilter}
                    onChange={(e) => setSizeFilter(e.target.value as any)}
                  >
                    <option value="all">All Sizes</option>
                    <option value="small">&lt; 7B Params</option>
                    <option value="medium">7B - 14B Params</option>
                    <option value="large">&gt; 14B Params</option>
                  </select>
                  <div className="ml-installed-caps-filter">
                    <label>
                      <input type="checkbox" checked={capFilters.chat} onChange={(e) => setCapFilters(prev => ({ ...prev, chat: e.target.checked }))} />
                      💬 Chat
                    </label>
                    <label>
                      <input type="checkbox" checked={capFilters.tools} onChange={(e) => setCapFilters(prev => ({ ...prev, tools: e.target.checked }))} />
                      🔧 Tools
                    </label>
                    <label>
                      <input type="checkbox" checked={capFilters.vision} onChange={(e) => setCapFilters(prev => ({ ...prev, vision: e.target.checked }))} />
                      👁 Vision
                    </label>
                    <label>
                      <input type="checkbox" checked={capFilters.reasoning} onChange={(e) => setCapFilters(prev => ({ ...prev, reasoning: e.target.checked }))} />
                      🧠 Reasoning
                    </label>
                  </div>
                </div>
              )}

              {searchError && <div className="ml-msg error">{searchError}</div>}
              {!searching && !searchError && results.length === 0 && (
                <div className="ml-msg">No models found.</div>
              )}
              {!searching && !searchError && results.length > 0 && processedDiscover.length === 0 && (
                <div className="ml-msg">No models match your filters.</div>
              )}

              {processedDiscover.map((r) => (
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
                            disabled={isPulling(f.pull_model)}
                          >
                            {isPulling(f.pull_model) ? 'Downloading…' : 'Download'}
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
