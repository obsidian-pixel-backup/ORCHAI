import { useEffect, useState } from 'react';
import './ContextOptimizerPanel.css';

interface ContextStats {
  active_tokens: number;
  archived_tokens: number;
  world_state_tokens: number;
  recalled_tokens: number;
  total_active_context: number;
  active_messages_count: number;
  archived_messages_count: number;
  is_consolidating: boolean;
}

interface ContextOptimizerPanelProps {
  stats: {
    tokens_per_second: number;
    tokens: number;
    elapsed: number;
  };
  wsState: string; // To listen to changes in websocket (e.g. stream_end triggers reload)
  chatId: string; // Active chat session ID
  onConfigChange?: () => void;
}

export function ContextOptimizerPanel({ stats, wsState, chatId }: ContextOptimizerPanelProps) {
  // Config state
  const [activeLimit, setActiveLimit] = useState<number>(2000);
  const [dynamicConsolidation, setDynamicConsolidation] = useState<boolean>(true);
  const [semanticRecall, setSemanticRecall] = useState<boolean>(true);

  // Backend sync state
  const [worldState, setWorldState] = useState<string>('');
  const [contextStats, setContextStats] = useState<ContextStats>({
    active_tokens: 0,
    archived_tokens: 0,
    world_state_tokens: 0,
    recalled_tokens: 0,
    total_active_context: 0,
    active_messages_count: 0,
    archived_messages_count: 0,
    is_consolidating: false,
  });

  // UI state
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editedState, setEditedState] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loadingSearch, setLoadingSearch] = useState<boolean>(false);

  // Fetch current state from backend
  const fetchWorldState = async (attempt = 1) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/chat/world-state?session_id=${chatId}`);
      if (res.ok) {
        const data = await res.json();
        setWorldState(data.world_state);
        setEditedState(data.world_state);
        if (data.stats) {
          setContextStats(data.stats);
        }
        if (data.config) {
          setActiveLimit(data.config.active_window_limit);
          setDynamicConsolidation(data.config.dynamic_consolidation);
          setSemanticRecall(data.config.semantic_recall);
        }
      }
    } catch (err) {
      console.error('Failed to fetch world state', err);
      if (attempt < 10) {
        setTimeout(() => fetchWorldState(attempt + 1), 2000);
      }
    }
  };

  // Sync state whenever active chat, websocket state or incoming message stats change
  useEffect(() => {
    fetchWorldState(1);
  }, [chatId, wsState, stats.tokens]);

  // Update backend config when states change
  const saveConfig = async (limit: number, consol: boolean, recall: boolean) => {
    try {
      await fetch('http://127.0.0.1:8000/api/chat/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatId,
          active_window_limit: limit,
          dynamic_consolidation: consol,
          semantic_recall: recall,
        }),
      });
      fetchWorldState();
    } catch (err) {
      console.error('Failed to save config', err);
    }
  };

  const handleLimitChange = (val: number) => {
    setActiveLimit(val);
    saveConfig(val, dynamicConsolidation, semanticRecall);
  };

  const handleToggleConsolidation = () => {
    const nextVal = !dynamicConsolidation;
    setDynamicConsolidation(nextVal);
    saveConfig(activeLimit, nextVal, semanticRecall);
  };

  const handleToggleRecall = () => {
    const nextVal = !semanticRecall;
    setSemanticRecall(nextVal);
    saveConfig(activeLimit, dynamicConsolidation, nextVal);
  };

  // Handle world state save
  const handleSaveWorldState = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat/world-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatId,
          world_state: editedState
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWorldState(data.world_state);
        setIsEditing(false);
      }
    } catch (err) {
      console.error('Failed to save edited world state', err);
    }
  };

  // Handle memory search
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoadingSearch(true);
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatId,
          query: searchQuery
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
      }
    } catch (err) {
      console.error('Failed to search memory', err);
    } finally {
      setLoadingSearch(false);
    }
  };

  // Get attention health attributes
  const getAttentionHealth = () => {
    const total = contextStats.total_active_context;
    if (total < 1800) {
      return { label: 'Optimal', className: 'health-optimal', text: '100% Retained Attention' };
    }
    if (total < 3500) {
      return { label: 'Dilution Warning', className: 'health-warning', text: 'Subtle Context Overhead' };
    }
    return { label: 'Attention Rot Risk', className: 'health-rot', text: 'Lost-in-Middle Probable' };
  };

  const health = getAttentionHealth();

  // Graph styling parameters
  const limitTokenBudget = 4096;
  const pctActive = Math.min(100, (contextStats.active_tokens / limitTokenBudget) * 100);
  const pctWorld = Math.min(100, (contextStats.world_state_tokens / limitTokenBudget) * 100);
  const pctRecall = Math.min(100, (contextStats.recalled_tokens / limitTokenBudget) * 100);
  const pctRemaining = Math.max(0, 100 - (pctActive + pctWorld + pctRecall));

  return (
    <div className="optimizer-panel-container">
      {/* ── Context Space & Attention Health (Combined Card) ── */}
      <div className="optimizer-section">
        <div className="section-header-row">
          <h3>Context Status & Health</h3>
          <span className={`health-badge ${health.className}`}>{health.label}</span>
        </div>
        
        <div className="health-detail-text">{health.text}</div>

        <div className="allocation-bar">
          <div className="bar-slice active-slice" style={{ width: `${pctActive}%` }} title={`Active Window: ${contextStats.active_tokens}t`} />
          <div className="bar-slice world-slice" style={{ width: `${pctWorld}%` }} title={`World State Memory: ${contextStats.world_state_tokens}t`} />
          <div className="bar-slice recall-slice" style={{ width: `${pctRecall}%` }} title={`Semantically Recalled: ${contextStats.recalled_tokens}t`} />
          <div className="bar-slice remaining-slice" style={{ width: `${pctRemaining}%` }} title={`Headroom: ${Math.max(0, limitTokenBudget - contextStats.total_active_context)}t`} />
        </div>
        
        <div className="legend-grid">
          <div className="legend-item"><span className="legend-dot active-dot" /><span>Active ({contextStats.active_tokens}t)</span></div>
          <div className="legend-item"><span className="legend-dot world-dot" /><span>World State ({contextStats.world_state_tokens}t)</span></div>
          <div className="legend-item"><span className="legend-dot recall-dot" /><span>Recalled ({contextStats.recalled_tokens}t)</span></div>
          <div className="legend-item"><span className="legend-dot remaining-dot" /><span>Headroom ({Math.max(0, limitTokenBudget - contextStats.total_active_context)}t)</span></div>
        </div>

        {contextStats.is_consolidating && (
          <div className="consolidation-glowing-indicator">
            <span className="spinning-dots" />
            <span>Consolidating background context...</span>
          </div>
        )}
      </div>

      {/* ── Throughput Controllers ── */}
      <div className="optimizer-section config-controls">
        <h3>Memory Parameters</h3>
        <div className="slider-control">
          <label>
            <span>Active Trigger Limit</span>
            <span>{activeLimit} t</span>
          </label>
          <input
            type="range"
            min="1000"
            max="4000"
            step="200"
            value={activeLimit}
            onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
            style={{
              background: `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${((activeLimit - 1000) / 3000) * 100}%, rgba(255, 255, 255, 0.1) ${((activeLimit - 1000) / 3000) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
            }}
            className="premium-slider"
          />
        </div>

        <div className="toggle-control" onClick={handleToggleConsolidation}>
          <div className="toggle-info">
            <div className="toggle-label">Dynamic Memory State</div>
            <div className="toggle-desc">Asynchronously fold old turns into World State</div>
          </div>
          <button className={`toggle-switch ${dynamicConsolidation ? 'on' : 'off'}`} aria-label="Toggle Dynamic Memory State" />
        </div>

        <div className="toggle-control" onClick={handleToggleRecall}>
          <div className="toggle-info">
            <div className="toggle-label">Semantic Episodic Recall</div>
            <div className="toggle-desc">Auto-retrieve past turns via local index (RAG)</div>
          </div>
          <button className={`toggle-switch ${semanticRecall ? 'on' : 'off'}`} aria-label="Toggle Semantic Episodic Recall" />
        </div>
      </div>

      {/* ── Live Cognitive World State Workspace ── */}
      <div className="optimizer-section world-state-workspace">
        <div className="workspace-header">
          <h3>Cognitive Memory Summary</h3>
          {!isEditing ? (
            <button className="edit-btn" onClick={() => setIsEditing(true)}>Refine</button>
          ) : (
            <div className="edit-actions">
              <button className="cancel-btn" onClick={() => setIsEditing(false)}>Cancel</button>
              <button className="save-btn" onClick={handleSaveWorldState}>Save</button>
            </div>
          )}
        </div>

        {!isEditing ? (
          <div className="world-state-card">
            {worldState ? (
              <pre className="world-state-content">{worldState}</pre>
            ) : (
              <div className="world-state-empty">
                Memory is currently empty. Start chatting to build consolidated context!
              </div>
            )}
          </div>
        ) : (
          <textarea
            className="world-state-editor"
            value={editedState}
            onChange={(e) => setEditedState(e.target.value)}
            placeholder="Edit what the model remembers about your project or tasks..."
          />
        )}
      </div>

      {/* ── Episodic Search Hub ── */}
      <div className="optimizer-section episodic-search">
        <h3>Episodic Memory Retrieval</h3>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search older conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="search-btn" onClick={handleSearch} disabled={loadingSearch}>
            {loadingSearch ? '...' : 'Search'}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div className="search-results-list">
            {searchResults.map((res: any, i: number) => (
              <div key={i} className="search-result-item">
                <div className="result-role">{res.role === 'user' ? 'USER' : 'ASSISTANT'}</div>
                <div className="result-content">{res.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
