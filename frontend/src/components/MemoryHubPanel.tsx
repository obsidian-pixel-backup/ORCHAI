import { useEffect, useState } from 'react';
import './MemoryHubPanel.css';
import { useDialog } from './ConfirmDialog/DialogContext';
import { MarkdownRenderer } from './ChatInterfacePanel/ChatMessage/MarkdownRenderer';

interface ContextStats {
  active_tokens: number;
  archived_tokens: number;
  world_state_tokens: number;
  recalled_tokens: number;
  total_active_context: number;
  active_messages_count: number;
  archived_messages_count: number;
  is_consolidating: boolean;
  emotional_state?: {
    valence: number;
    arousal: number;
    dominance: number;
    label: string;
  };
  rules_state?: string;
  goals?: string[];
  curiosities?: { topic: string; interest: number }[];
  self_model?: { key: string; value: string }[];
  diary?: { entry: string; timestamp: number }[];
  observations?: { trait: string; frequency: number }[];
}

interface MemoryHubPanelProps {
  stats: {
    tokens_per_second: number;
    tokens: number;
    elapsed: number;
  };
  wsState: string; // To listen to changes in websocket (e.g. stream_end triggers reload)
  chatId: string; // Active chat session ID
  onConfigChange?: () => void;
}

export function MemoryHubPanel({ stats, wsState, chatId }: MemoryHubPanelProps) {
  const dialog = useDialog();
  // Config state
  const [activeLimit, setActiveLimit] = useState<number>(2000);
  const [dynamicConsolidation, setDynamicConsolidation] = useState<boolean>(true);
  const [semanticRecall, setSemanticRecall] = useState<boolean>(true);
  const [dynamicPersona, setDynamicPersona] = useState<boolean>(true);

  // Backend sync state
  const [worldState, setWorldState] = useState<string>('');
  const [personaState, setPersonaState] = useState<string>('');
  const [emotionalState, setEmotionalState] = useState<string>('');
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
  const [isEditingPersona, setIsEditingPersona] = useState<boolean>(false);
  const [editedPersonaState, setEditedPersonaState] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loadingSearch, setLoadingSearch] = useState<boolean>(false);
  const [expandedResults, setExpandedResults] = useState<Record<number, boolean>>({});

  const toggleResultExpand = (idx: number) => {
    setExpandedResults(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  // Helper to format timestamps nicely
  const formatTimestamp = (ts: number) => {
    const dateObj = new Date(ts * 1000);
    const now = new Date();
    const isToday = dateObj.toDateString() === now.toDateString();
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    if (isToday) {
      return `Today, ${timeStr}`;
    } else {
      const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${dateStr}, ${timeStr}`;
    }
  };

  // Fetch current state from backend
  const fetchWorldState = async (attempt = 1) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/chat/world-state?session_id=${chatId}`);
      if (res.ok) {
        const data = await res.json();
        setWorldState(data.world_state);
        setEditedState(data.world_state);
        setPersonaState(data.persona_state || '');
        setEditedPersonaState(data.persona_state || '');
        setEmotionalState(data.emotional_state || '');
        if (data.stats) {
          setContextStats(data.stats);
        }
        if (data.config) {
          setActiveLimit(data.config.active_window_limit);
          setDynamicConsolidation(data.config.dynamic_consolidation);
          setSemanticRecall(data.config.semantic_recall);
          setDynamicPersona(data.config.dynamic_persona !== undefined ? data.config.dynamic_persona : true);
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
  }, [chatId, wsState, stats?.tokens]);

  useEffect(() => {
    const handleConfigUpdated = () => {
      fetchWorldState(1);
    };
    window.addEventListener('klydis-config-updated', handleConfigUpdated);
    return () => {
      window.removeEventListener('klydis-config-updated', handleConfigUpdated);
    };
  }, [chatId]);

  // Update backend config when states change
  const saveConfig = async (limit: number, consol: boolean, recall: boolean, persona: boolean) => {
    try {
      await fetch('http://127.0.0.1:8000/api/chat/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatId,
          active_window_limit: limit,
          dynamic_consolidation: consol,
          semantic_recall: recall,
          dynamic_persona: persona,
        }),
      });
      window.dispatchEvent(new CustomEvent('klydis-config-updated'));
      fetchWorldState();
    } catch (err) {
      console.error('Failed to save config', err);
    }
  };


  const handleLimitChange = (val: number) => {
    setActiveLimit(val);
    saveConfig(val, dynamicConsolidation, semanticRecall, dynamicPersona);
  };

  const handleToggleConsolidation = () => {
    const nextVal = !dynamicConsolidation;
    setDynamicConsolidation(nextVal);
    saveConfig(activeLimit, nextVal, semanticRecall, dynamicPersona);
  };

  const handleToggleRecall = () => {
    const nextVal = !semanticRecall;
    setSemanticRecall(nextVal);
    saveConfig(activeLimit, dynamicConsolidation, nextVal, dynamicPersona);
  };

  const handleTogglePersona = () => {
    const nextVal = !dynamicPersona;
    setDynamicPersona(nextVal);
    saveConfig(activeLimit, dynamicConsolidation, semanticRecall, nextVal);
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

  // Handle persona state save
  const handleSavePersonaState = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatId,
          persona_state: editedPersonaState
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPersonaState(data.persona_state);
        setIsEditingPersona(false);
      }
    } catch (err) {
      console.error('Failed to save edited persona state', err);
    }
  };

  // Handle persona rollback
  const handleRollbackPersona = async () => {
    const confirmed = await dialog.confirm(
      "Rollback Persona?",
      "Are you sure you want to rollback to the previous persona state? This will discard the latest evolution steps.",
      { confirmLabel: "Rollback", danger: true }
    );
    if (!confirmed) {
      return;
    }
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: chatId,
          persona_state: personaState,
          feedback: "this drift doesn't feel right"
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPersonaState(data.persona_state);
        setEditedPersonaState(data.persona_state);
        fetchWorldState(1);
      }
    } catch (err) {
      console.error('Failed to rollback persona state', err);
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
        setExpandedResults({});
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
          {contextStats.active_tokens > 0 && (
            <div 
              className="bar-slice active-slice" 
              style={{ flex: contextStats.active_tokens }} 
              title={`Active Window: ${contextStats.active_tokens}t`} 
            />
          )}
          {contextStats.world_state_tokens > 0 && (
            <div 
              className="bar-slice world-slice" 
              style={{ flex: contextStats.world_state_tokens }} 
              title={`World State Memory: ${contextStats.world_state_tokens}t`} 
            />
          )}
          {contextStats.recalled_tokens > 0 && (
            <div 
              className="bar-slice recall-slice" 
              style={{ flex: contextStats.recalled_tokens }} 
              title={`Semantically Recalled: ${contextStats.recalled_tokens}t`} 
            />
          )}
          {Math.max(0, limitTokenBudget - contextStats.total_active_context) > 0 && (
            <div 
              className="bar-slice remaining-slice" 
              style={{ flex: Math.max(0, limitTokenBudget - contextStats.total_active_context) }} 
              title={`Headroom: ${Math.max(0, limitTokenBudget - contextStats.total_active_context)}t`} 
            />
          )}
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
            max="100000"
            step="1000"
            value={activeLimit}
            onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
            style={{
              background: `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${Math.max(0, Math.min(100, ((activeLimit - 1000) / 99000) * 100))}%, rgba(255, 255, 255, 0.1) ${Math.max(0, Math.min(100, ((activeLimit - 1000) / 99000) * 100))}%, rgba(255, 255, 255, 0.1) 100%)`
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

        <div className="toggle-control" onClick={handleTogglePersona}>
          <div className="toggle-info">
            <div className="toggle-label">Dynamic Persona Evolution</div>
            <div className="toggle-desc">Asynchronously refine character and style traits</div>
          </div>
          <button className={`toggle-switch ${dynamicPersona ? 'on' : 'off'}`} aria-label="Toggle Dynamic Persona Evolution" />
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
              <MarkdownRenderer content={worldState} />
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

      {/* ── Live Evolving Agent Persona Workspace ── */}
      <div className="optimizer-section world-state-workspace">
        <div className="workspace-header">
          <h3>Evolving Agent Persona</h3>
          {!isEditingPersona ? (
            <div className="edit-actions">
              <button className="edit-btn rollback-btn" onClick={handleRollbackPersona} title="Rollback last evolution step" style={{ marginRight: '8px' }}>Rollback</button>
              <button className="edit-btn" onClick={() => setIsEditingPersona(true)}>Refine</button>
            </div>
          ) : (
            <div className="edit-actions">
              <button className="cancel-btn" onClick={() => setIsEditingPersona(false)}>Cancel</button>
              <button className="save-btn" onClick={handleSavePersonaState}>Save</button>
            </div>
          )}
        </div>

        {!isEditingPersona ? (
          <div className="world-state-card">
            {personaState ? (
              <MarkdownRenderer content={personaState} />
            ) : (
              <div className="world-state-empty">
                Persona is currently empty. Start chatting to build evolved context!
              </div>
            )}
          </div>
        ) : (
          <textarea
            className="world-state-editor"
            value={editedPersonaState}
            onChange={(e) => setEditedPersonaState(e.target.value)}
            placeholder="Edit character traits, voice styles, or direct instructions for the agent..."
          />
        )}
      </div>

      {/* ── Live Evolving Agent Emotional State Workspace ── */}
      {contextStats.emotional_state && (
        <div className="optimizer-section world-state-workspace emotional-state-workspace">
          <div className="workspace-header">
            <h3>Cognitive Diagnostics & Mood</h3>
          </div>
          {emotionalState && (
            <div className="world-state-card emotional-narrative-card" style={{ marginBottom: '12px' }}>
              <MarkdownRenderer content={emotionalState} />
            </div>
          )}
          <div className="world-state-card emotional-state-card">
            <div className="diagnostics-summary-row">
              <div className="diag-badge-item">
                <span className="diag-badge-label">Active State:</span>
                <span className={`diag-state-badge ${contextStats.rules_state?.toLowerCase() || 'conversing'}`}>
                  {contextStats.rules_state || 'CONVERSING'}
                </span>
              </div>
              <div className="diag-badge-item">
                <span className="diag-badge-label">Subjective Mood:</span>
                <span className="diag-mood-text">{contextStats.emotional_state.label}</span>
              </div>
            </div>

            <div className="vad-bars-grid">
              <div className="vad-bar-item">
                <div className="vad-bar-label-row">
                  <span>Valence (Positivity)</span>
                  <span>{contextStats.emotional_state.valence > 0 ? '+' : ''}{contextStats.emotional_state.valence.toFixed(2)}</span>
                </div>
                <div className="vad-progress-bg">
                  <div 
                    className="vad-progress-fill fill-valence" 
                    style={{ 
                      width: `${((contextStats.emotional_state.valence + 1) / 2) * 100}%`,
                      background: contextStats.emotional_state.valence >= 0 ? 'var(--success-color, #10b981)' : '#ef4444'
                    }} 
                  />
                </div>
              </div>

              <div className="vad-bar-item">
                <div className="vad-bar-label-row">
                  <span>Arousal (Stimulation)</span>
                  <span>{contextStats.emotional_state.arousal.toFixed(2)}</span>
                </div>
                <div className="vad-progress-bg">
                  <div 
                    className="vad-progress-fill fill-arousal" 
                    style={{ 
                      width: `${contextStats.emotional_state.arousal * 100}%`,
                      background: 'var(--accent-color, #a855f7)'
                    }} 
                  />
                </div>
              </div>

              <div className="vad-bar-item">
                <div className="vad-bar-label-row">
                  <span>Dominance (Control)</span>
                  <span>{contextStats.emotional_state.dominance > 0 ? '+' : ''}{contextStats.emotional_state.dominance.toFixed(2)}</span>
                </div>
                <div className="vad-progress-bg">
                  <div 
                    className="vad-progress-fill fill-dominance" 
                    style={{ 
                      width: `${((contextStats.emotional_state.dominance + 1) / 2) * 100}%`,
                      background: '#3b82f6'
                    }} 
                  />
                </div>
              </div>
            </div>

            {/* Sub-rows for Active Goals and Curiosities */}
            <div className="diagnostics-meta-grid">
              <div className="meta-column">
                <h4 className="meta-col-title">🎯 Session Goals</h4>
                {contextStats.goals && contextStats.goals.length > 0 ? (
                  <ul className="meta-goals-list">
                    {contextStats.goals.map((g, idx) => (
                      <li key={idx} className="meta-goal-item">{g}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="meta-empty">No active session goals registered.</div>
                )}
              </div>

              <div className="meta-column">
                <h4 className="meta-col-title">✨ Curiosity Fields</h4>
                {contextStats.curiosities && contextStats.curiosities.length > 0 ? (
                  <div className="meta-curiosity-chips">
                    {contextStats.curiosities.map((c, idx) => (
                      <div key={idx} className="meta-curiosity-chip" title={`Interest level: ${c.interest}`}>
                        <span className="curi-topic">{c.topic}</span>
                        <span className="curi-level">Lv.{c.interest}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="meta-empty">No dynamic curiosities tracked.</div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* ── First-Person Self-Model Workspace ── */}
      {contextStats.self_model && contextStats.self_model.length > 0 && (
        <div className="optimizer-section world-state-workspace self-model-workspace">
          <div className="workspace-header">
            <h3>Cognitive Self-Model Layer</h3>
          </div>
          <div className="world-state-card self-model-card">
            <div className="self-model-grid">
              {contextStats.self_model.map((entry, idx) => (
                <div key={idx} className="self-model-row-item">
                  <span className="self-model-key">{entry.key}</span>
                  <span className="self-model-val">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Trait Observations Buffer ── */}
      {contextStats.observations && contextStats.observations.length > 0 && (
        <div className="optimizer-section world-state-workspace observations-workspace">
          <div className="workspace-header">
            <h3>Persona Observation Buffer</h3>
          </div>
          <div className="world-state-card observations-card">
            <div className="observations-grid">
              {contextStats.observations.map((obs, idx) => (
                <div key={idx} className="obs-item-row">
                  <div className="obs-meta-row">
                    <span className="obs-trait">✨ {obs.trait}</span>
                    <span className="obs-freq">{obs.frequency}/3</span>
                  </div>
                  <div className="obs-bar-bg">
                    <div 
                      className="obs-bar-fill" 
                      style={{ 
                        width: `${Math.min(100, (obs.frequency / 3) * 100)}%`,
                        background: obs.frequency >= 3 ? 'var(--success-color, #10b981)' : 'var(--accent-color, #a855f7)'
                      }} 
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Narrative Diary Logs Feed ── */}
      {contextStats.diary && contextStats.diary.length > 0 && (
        <div className="optimizer-section world-state-workspace diary-workspace">
          <div className="workspace-header">
            <h3>Chronological Narrative Logs (Diary)</h3>
          </div>
          <div className="world-state-card diary-card">
            <div className="diary-timeline">
              {contextStats.diary.map((log, idx) => {
                return (
                  <div key={idx} className="diary-timeline-item">
                    <div className="diary-timeline-time">{formatTimestamp(log.timestamp)}</div>
                    <div className="diary-timeline-body">"{log.entry}"</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
            {searchResults.map((res: any, i: number) => {
              const isExpanded = !!expandedResults[i];
              return (
                <div 
                  key={i} 
                  className={`search-result-item clickable ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => toggleResultExpand(i)}
                >
                  <div className="result-header-row">
                    <div className="result-role">{res.role === 'user' ? 'USER' : 'ASSISTANT'}</div>
                    <span className="result-expand-toggle">
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </span>
                  </div>
                  <div className={`result-content ${isExpanded ? 'expanded' : ''}`}>
                    {isExpanded ? (
                      <MarkdownRenderer content={res.content} />
                    ) : (
                      res.content
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
