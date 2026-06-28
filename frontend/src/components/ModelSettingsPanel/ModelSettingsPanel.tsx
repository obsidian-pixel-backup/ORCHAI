import { useEffect, useState, useRef } from 'react';
import './ModelSettingsPanel.css';
import { ContextOptimizerPanel } from './ContextOptimizerPanel';

interface ModelSettingsPanelProps {
  selectedModel: string;
  onModelChange: (model: string) => void;
  temperature: number;
  onTemperatureChange: (temp: number) => void;
  maxTokens: number;
  onMaxTokensChange: (tokens: number) => void;
  stats: {
    tokens_per_second: number;
    tokens: number;
    elapsed: number;
  };
  chatId: string;
}

export function ModelSettingsPanel({
  selectedModel,
  onModelChange,
  temperature,
  onTemperatureChange,
  maxTokens,
  onMaxTokensChange,
  stats,
  chatId,
}: ModelSettingsPanelProps) {
  const [models, setModels] = useState<{name: string, supports_reasoning: boolean, supports_vision?: boolean}[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visionInstalled, setVisionInstalled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const isUnlimited = true;

  const isReasoningModel = (modelName: string) => {
    if (!modelName) return false;
    const modelObj = models.find(m => m.name === modelName);
    return modelObj ? modelObj.supports_reasoning : false;
  };

  const isVisionModel = (modelName: string) => {
    if (!modelName) return false;
    const modelObj = models.find(m => m.name === modelName);
    return modelObj ? !!modelObj.supports_vision : false;
  };

  useEffect(() => {
    async function fetchVisionStatus() {
      try {
        const res = await fetch('http://127.0.0.1:8000/api/vision/status');
        if (res.ok) {
          const data = await res.json();
          setVisionEnabled(data.enabled);
          setVisionInstalled(data.installed);
        }
      } catch (e) {
        console.error("Failed to fetch vision status:", e);
      }
    }
    fetchVisionStatus();
    
    const interval = setInterval(fetchVisionStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleToggleVision = async () => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/vision/toggle', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setVisionEnabled(data.enabled);
        setVisionInstalled(data.installed);
      }
    } catch (e) {
      console.error("Failed to toggle vision status:", e);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function fetchModels(attempt = 1) {
      try {
        const res = await fetch('http://127.0.0.1:8000/api/chat/models');
        if (!res.ok) throw new Error('Failed to fetch models');
        const data = await res.json();
        if (cancelled) return;

        const rawModels = Array.isArray(data)
          ? data
          : Array.isArray(data.models)
            ? data.models
            : [];

        // Gracefully handle strings if backend hasn't restarted yet
        const formattedModels = rawModels.map((m: any) => 
          typeof m === 'string' ? { name: m, supports_reasoning: false, supports_vision: false } : m
        );

        setModels(formattedModels);
        setFetchError(formattedModels.length === 0);

        const hasSelectedModel = formattedModels.some((m: {name: string, supports_reasoning: boolean, supports_vision?: boolean}) => m.name === selectedModel);
        if (formattedModels.length > 0 && (!selectedModel || !hasSelectedModel)) {
          const qwenModels = formattedModels.filter((m: any) => m.name.toLowerCase().includes('qwen'));
          if (qwenModels.length > 0) {
            const getParamCount = (name: string) => {
              const matchB = name.match(/(\d+(?:\.\d+)?)b/i);
              if (matchB) return parseFloat(matchB[1]);
              const matchM = name.match(/(\d+(?:\.\d+)?)m/i);
              if (matchM) return parseFloat(matchM[1]) / 1000;
              return 0;
            };
            qwenModels.sort((a: any, b: any) => getParamCount(b.name) - getParamCount(a.name));
            onModelChange(qwenModels[0].name);
          } else {
            onModelChange(formattedModels[0].name);
          }
        }
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          if (attempt < 10) {
            setTimeout(() => fetchModels(attempt + 1), 1000);
          } else {
            setModels([]);
            setFetchError(true);
            setLoading(false);
          }
        }
      }
    }

    fetchModels();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="model-settings-container">
      <div className="panel-header">
        <h2>Model & Memory Hub</h2>
      </div>

      <div className="settings-content">
        {/* ── Model Selection ── */}
        <div className="settings-section" style={{ zIndex: 10 }}>
          <h3>Model Selection</h3>
          {loading && <div className="model-loading">Loading models…</div>}
          {!loading && fetchError && (
            <div className="no-models-msg">No models found. Is Ollama running?</div>
          )}
          {!loading && !fetchError && (
            <div className="custom-model-select-container" ref={dropdownRef}>
              <div 
                className={`custom-model-select ${isDropdownOpen ? 'open' : ''}`}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <span className="selected-model-text">{selectedModel}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`dropdown-chevron ${isDropdownOpen ? 'open' : ''}`}>
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              {isDropdownOpen && (
                <div className="custom-model-dropdown">
                  {models.map((m) => (
                    <div 
                      key={m.name} 
                      className={`custom-model-option ${m.name === selectedModel ? 'selected' : ''}`}
                      onClick={() => {
                        onModelChange(m.name);
                        setIsDropdownOpen(false);
                      }}
                    >
                      {m.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Parameters ── */}
        <div className="settings-section">
          <h3>Parameters</h3>
          <div className="param-slider">
            <label>
              <span>Temperature</span>
              <span>{temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
              style={{
                background: `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${(temperature / 2.0) * 100}%, rgba(255, 255, 255, 0.1) ${(temperature / 2.0) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
              }}
              className="premium-slider"
            />
          </div>
          <div className="param-slider">
            <label>
              <span>Max Tokens</span>
              <span className={isUnlimited ? 'unlimited-badge' : ''}>
                {isUnlimited ? 'Unlimited' : maxTokens}
              </span>
            </label>
            <input
              type="range"
              min="100"
              max="8192"
              step="100"
              value={isUnlimited ? 8192 : maxTokens}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                onMaxTokensChange(val);
              }}
              disabled={isUnlimited}
              className={`premium-slider ${isUnlimited ? 'disabled-slider' : ''}`}
              style={{
                background: isUnlimited
                  ? 'rgba(255, 255, 255, 0.05)'
                  : `linear-gradient(to right, var(--accent-color) 0%, var(--accent-color) ${((maxTokens - 100) / 8092) * 100}%, rgba(255, 255, 255, 0.1) ${((maxTokens - 100) / 8092) * 100}%, rgba(255, 255, 255, 0.1) 100%)`
              }}
            />
            <label className="checkbox-container">
              <input
                type="checkbox"
                className="checkbox-input"
                checked={true}
                disabled={true}
                onChange={() => {}}
              />
              <span className="checkbox-label">Unlimited response length</span>
            </label>
          </div>
        </div>

        {/* ── Reasoning Engine Indicator ── */}
        {isReasoningModel(selectedModel) ? (
          <div className="thinking-mode-card">
            <div className="thinking-icon-wrapper">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"></path>
              </svg>
            </div>
            <div className="thinking-info">
              <span className="thinking-title">Deep Thinking Engine</span>
              <span className="thinking-subtitle">CoT reasoning permanently active</span>
            </div>
            <div className="thinking-pulse-dot" title="Active"></div>
          </div>
        ) : (
          <div className="thinking-mode-card disabled">
            <div className="thinking-icon-wrapper disabled">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
            </div>
            <div className="thinking-info">
              <span className="thinking-title disabled">Deep Thinking Engine</span>
              <span className="thinking-subtitle disabled">Reasoning not supported by this model</span>
            </div>
          </div>
        )}

        {/* ── Modular Context/Memory Hub inline ── */}
        <ContextOptimizerPanel stats={stats} wsState={selectedModel} chatId={chatId} />

        {/* ── Sensory Input Telemetry ── */}
        <div className="settings-section">
          <h3>Sensory Vision Feed</h3>
          
          <div className="vision-status-container" style={{ marginBottom: '12px', fontSize: '0.85rem', color: 'var(--text-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span>Selected Model Vision:</span>
              <span style={{ color: isVisionModel(selectedModel) ? 'var(--accent-color)' : 'var(--text-muted)', fontWeight: isVisionModel(selectedModel) ? 500 : 400 }}>
                {isVisionModel(selectedModel) ? 'Supported' : 'Not Supported'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Background Feed System:</span>
              <span style={{ color: !visionInstalled ? '#ff4a4a' : (visionEnabled ? 'var(--accent-color)' : 'var(--text-muted)'), fontWeight: (!visionInstalled || visionEnabled) ? 500 : 400 }}>
                {!visionInstalled ? 'Missing llava model' : (visionEnabled ? 'Active' : 'Disabled')}
              </span>
            </div>
          </div>

          <div className="agent-status-list">
            <button 
              className={`vision-toggle-btn ${visionEnabled ? 'active' : ''}`}
              onClick={handleToggleVision}
              disabled={!visionInstalled}
              style={visionEnabled ? { borderColor: 'var(--accent-color)', color: 'var(--accent-color)' } : {}}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {visionEnabled ? (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </>
                ) : (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </>
                )}
              </svg>
              {visionEnabled ? 'Disable Vision Feed' : 'Enable Vision Feed'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
