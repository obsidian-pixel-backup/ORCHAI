import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import './App.css';
import { ChatManagementPanel } from './components/ChatManagementPanel/ChatManagementPanel';
import type { Message } from './components/ChatInterfacePanel/ChatInterfacePanel';
import { ChatInterfacePanel } from './components/ChatInterfacePanel/ChatInterfacePanel';
import { ActivityBar } from './components/ActivityBar';
import { ContentDrawer } from './components/ContentDrawer';
import { ModelSettingsPanel } from './components/ModelSettingsPanel/ModelSettingsPanel';
import { MemoryHubPanel } from './components/MemoryHubPanel';
import { SkillsManagementPanel } from './components/SkillsManagementPanel/SkillsManagementPanel';
import { AuxiliaryPane } from './components/AuxiliaryPane/AuxiliaryPane';
import { ModelLibraryPanel } from './components/ModelLibraryPanel/ModelLibraryPanel';
import { DialogProvider } from './components/ConfirmDialog/DialogContext';
import { CustomSelect } from './components/CustomSelect/CustomSelect';

export interface PullState {
  model: string;
  status: string;
  percent: number;
  error?: string;
}

interface Toast {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

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


export interface Stats {
  tokens_per_second: number;
  tokens: number;
  elapsed: number;
  prompt_eval_count?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  stats: Stats;
}

const DEFAULT_WELCOME_MSG: Message = {
  id: 'initial-msg',
  role: 'model',
  content: 'Hello. I am the ORCHAI orchestration wrapper. How can I assist you with your tasks today?'
};

const INITIAL_CHAT: ChatSession = {
  id: 'default',
  title: 'OrchAI Conversation',
  messages: [DEFAULT_WELCOME_MSG],
  stats: {
    tokens_per_second: 0,
    tokens: 0,
    elapsed: 0,
    prompt_eval_count: 0,
  }
};

type NavTab = 'chats' | 'memory' | 'skills';

function AppContent() {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [repeatPenalty, setRepeatPenalty] = useState<number>(1.1);
  const [topP, setTopP] = useState<number>(0.9);
  const [minP, setMinP] = useState<number>(0.05);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isAuxiliaryPaneOpen, setIsAuxiliaryPaneOpen] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<NavTab>('chats');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showModelLibrary, setShowModelLibrary] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    return localStorage.getItem('orchai_theme') !== 'light';
  });
  const [sendOnEnter, setSendOnEnter] = useState<boolean>(() => localStorage.getItem('orchai_send_enter') !== 'false');
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => localStorage.getItem('orchai_notifications') === 'true');
  const [compactMode, setCompactMode] = useState<boolean>(() => localStorage.getItem('orchai_compact') === 'true');
  const [language, setLanguage] = useState<string>(() => localStorage.getItem('orchai_lang') || 'en');
  const [models, setModels] = useState<{name: string, supports_reasoning: boolean, supports_vision?: boolean, can_chat?: boolean}[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [inferenceProvider, setInferenceProvider] = useState<string>(() => localStorage.getItem('orchai_provider') || 'ollama');

  // Toasts for background events (like downloads)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = useCallback((title: string, message: string, type: 'info' | 'success' | 'error' = 'info') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);

  const [pulls, setPulls] = useState<Record<string, PullState>>({});
  const pullsRef = useRef(pulls);
  useEffect(() => {
    pullsRef.current = pulls;
  }, [pulls]);

  // Fetch the model list once and apply it (also picks a sensible default model).
  // Returns true on success so the mount effect can retry while the backend boots,
  // and so the Model Library can refresh the list after an install/delete.
  const refreshModels = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('http://127.0.0.1:8000/api/chat/models');
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();

      const rawModels = Array.isArray(data) ? data : Array.isArray(data.models) ? data.models : [];
      const formattedModels = rawModels.map((m: any) =>
        typeof m === 'string' ? { name: m, supports_reasoning: false, supports_vision: false, can_chat: true } : m
      );

      setModels(formattedModels);
      setModelsLoading(false);

      setSelectedModel(current => {
        const hasSelectedModel = formattedModels.some((m: {name: string}) => m.name === current);
        if (formattedModels.length > 0 && (!current || !hasSelectedModel)) {
          // Only auto-select models that can actually chat (skip embedding models).
          const chatCapable = formattedModels.filter((m: any) => m.can_chat !== false);
          const pool = chatCapable.length > 0 ? chatCapable : formattedModels;
          const qwenModels = pool.filter((m: any) => m.name.toLowerCase().includes('qwen'));
          if (qwenModels.length > 0) {
            const getParamCount = (name: string) => {
              const matchB = name.match(/(\d+(?:\.\d+)?)b/i);
              if (matchB) return parseFloat(matchB[1]);
              const matchM = name.match(/(\d+(?:\.\d+)?)m/i);
              if (matchM) return parseFloat(matchM[1]) / 1000;
              return 0;
            };
            qwenModels.sort((a: any, b: any) => getParamCount(b.name) - getParamCount(a.name));
            return qwenModels[0].name;
          } else {
            return pool[0].name;
          }
        }
        return current;
      });
      return true;
    } catch (e) {
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempt = 1;
    const run = async () => {
      if (cancelled) return;
      const ok = await refreshModels();
      if (!ok && !cancelled) {
        if (attempt < 10) { attempt += 1; setTimeout(run, 1000); }
        else { setModels([]); setModelsLoading(false); }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [refreshModels]);

  const handlePull = useCallback(async (model: string) => {
    const p = pullsRef.current[model];
    if (p && !p.error && p.percent < 100 && p.status !== 'done') return;

    setPulls(prev => ({ ...prev, [model]: { model, status: 'starting', percent: 0 } }));
    addToast('Download Started', `Downloading ${friendlyModelLabel(model)}...`, 'info');

    try {
      const res = await fetch('http://127.0.0.1:8000/api/models/pull', {
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
        addToast('Download Failed', `Could not download ${friendlyModelLabel(model)}: ${detail}`, 'error');
        return;
      }
      if (!res.body) {
        const detail = 'The backend did not return a download progress stream.';
        setPulls(prev => ({ ...prev, [model]: { model, status: 'error', percent: 0, error: detail } }));
        addToast('Download Failed', `Could not download ${friendlyModelLabel(model)}: ${detail}`, 'error');
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      
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
            addToast('Download Failed', `Could not download ${friendlyModelLabel(model)}: ${evt.error}`, 'error');
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
      addToast('Download Complete', `${friendlyModelLabel(model)} has been successfully installed.`, 'success');
      
      // Desktop notification
      if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Model Download Complete', {
          body: `${friendlyModelLabel(model)} is ready to use.`,
        });
      }
      
      refreshModels();
    } catch (e: any) {
      const raw = e?.message || '';
      const isNetwork = e?.name === 'TypeError' || /failed to fetch|network|load failed/i.test(raw);
      const msg = isNetwork
        ? 'Couldn’t reach the ORCHAI backend (it may be starting up or was interrupted). Wait a moment and try the download again.'
        : (raw || 'Download failed.');
      setPulls(prev => ({ ...prev, [model]: { model, status: 'error', percent: 0, error: msg } }));
      addToast('Download Failed', `Could not download ${friendlyModelLabel(model)}: ${msg}`, 'error');
    }
  }, [addToast, refreshModels, notificationsEnabled]);

  const handleDismissPull = useCallback((model: string) => {
    setPulls(prev => {
      const next = { ...prev };
      delete next[model];
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkTheme ? 'dark' : 'light');
    document.documentElement.setAttribute('data-compact', compactMode ? 'true' : 'false');
    document.documentElement.lang = language;
  }, [isDarkTheme, compactMode, language]);

  useEffect(() => {
    localStorage.setItem('orchai_theme', isDarkTheme ? 'dark' : 'light');
  }, [isDarkTheme]);

  useEffect(() => {
    localStorage.setItem('orchai_send_enter', String(sendOnEnter));
  }, [sendOnEnter]);

  useEffect(() => {
    localStorage.setItem('orchai_provider', inferenceProvider);
  }, [inferenceProvider]);

  useEffect(() => {
    localStorage.setItem('orchai_notifications', String(notificationsEnabled));
    if (notificationsEnabled && 'Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission();
    }
  }, [notificationsEnabled]);

  useEffect(() => {
    localStorage.setItem('orchai_compact', String(compactMode));
  }, [compactMode]);

  useEffect(() => {
    localStorage.setItem('orchai_lang', language);
  }, [language]);

  const handleToggleTheme = () => setIsDarkTheme(prev => !prev);

  // Load chat sessions from localStorage or use default initial chat
  const [chats, setChats] = useState<ChatSession[]>(() => {
    const saved = localStorage.getItem('orchai_chats');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse chats from localStorage', e);
      }
    }
    return [INITIAL_CHAT];
  });

  const [activeChatId, setActiveChatId] = useState<string>(() => {
    const saved = localStorage.getItem('orchai_active_chat_id');
    if (saved) {
      return saved;
    }
    return 'default';
  });

  // Save state to localStorage whenever chats list or active ID changes
  useEffect(() => {
    localStorage.setItem('orchai_chats', JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    localStorage.setItem('orchai_active_chat_id', activeChatId);
  }, [activeChatId]);

  // Fetch messages from backend for active chat to sync dynamic/offline messages (like autonomous thoughts)
  useEffect(() => {
    let active = true;
    const syncMessages = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/chat/session/${activeChatId}/messages`);
        if (res.ok && active) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            setChats((prev) =>
              prev.map((c) =>
                c.id === activeChatId ? { ...c, messages: data.messages } : c
              )
            );
          }
        }
      } catch (err) {
        console.error('Failed to sync messages with backend:', err);
      }
    };
    syncMessages();
    return () => { active = false; };
  }, [activeChatId]);

  // Find active chat details
  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0] || INITIAL_CHAT;

  const activeMessages = activeChat.messages;
  const activeStats = activeChat.stats;

  const handleUpdateMessages = (newMessagesOrFn: Message[] | ((prev: Message[]) => Message[])) => {
    setChats((prevChats) =>
      prevChats.map((c) => {
        if (c.id === activeChatId) {
          const updatedMessages = typeof newMessagesOrFn === 'function'
            ? newMessagesOrFn(c.messages)
            : newMessagesOrFn;

          return { ...c, messages: updatedMessages };
        }
        return c;
      })
    );
  };

  // Asynchronous model-driven chat renaming on first user message
  useEffect(() => {
    const defaultTitles = ['New Chat', 'OrchAI Conversation'];
    if (activeChat && defaultTitles.includes(activeChat.title)) {
      const userMessages = activeChat.messages.filter((m) => m.role === 'user');
      const lastMessage = activeChat.messages[activeChat.messages.length - 1];

      if (userMessages.length === 1 && lastMessage.role === 'model' && lastMessage.stats?.model) {
        const firstMsgContent = userMessages[0].content;

        setChats((prevChats) =>
          prevChats.map((c) =>
            c.id === activeChatId ? { ...c, title: 'Renaming...' } : c
          )
        );

        const generateModelTitle = async () => {
          try {
            const res = await fetch('http://127.0.0.1:8000/api/chat/generate-title', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: activeChatId,
                model: selectedModel,
                first_message: firstMsgContent,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.title) {
                setChats((prevChats) =>
                  prevChats.map((c) =>
                    c.id === activeChatId ? { ...c, title: data.title } : c
                  )
                );
                return;
              }
            }
            const sliced = firstMsgContent.trim().slice(0, 20) + '...';
            setChats((prevChats) =>
              prevChats.map((c) =>
                c.id === activeChatId ? { ...c, title: sliced } : c
              )
            );
          } catch (err) {
            console.error('Failed to generate chat title', err);
            const sliced = firstMsgContent.trim().slice(0, 20) + '...';
            setChats((prevChats) =>
              prevChats.map((c) =>
                c.id === activeChatId ? { ...c, title: sliced } : c
              )
            );
          }
        };

        generateModelTitle();
      }
    }
  }, [activeChatId, activeChat?.messages, selectedModel]);

  const handleUpdateStats = (newStats: Stats) => {
    setChats((prevChats) =>
      prevChats.map((c) =>
        c.id === activeChatId ? { ...c, stats: newStats } : c
      )
    );
  };

  const handleNewChat = () => {
    const newId = `chat-${Date.now()}`;
    const newChat: ChatSession = {
      id: newId,
      title: 'New Chat',
      messages: [DEFAULT_WELCOME_MSG],
      stats: {
        tokens_per_second: 0,
        tokens: 0,
        elapsed: 0,
        prompt_eval_count: 0,
      }
    };
    setChats((prev) => [...prev, newChat]);
    setActiveChatId(newId);
  };

  const handleDeleteChat = async (id: string) => {
    try {
      await fetch('http://127.0.0.1:8000/api/chat/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: id })
      });
    } catch (e) {
      console.error('Failed to notify backend of chat clear', e);
    }

    setChats((prevChats) => {
      const filtered = prevChats.filter((c) => c.id !== id);
      const result = filtered.length === 0 ? [INITIAL_CHAT] : filtered;
      if (activeChatId === id) {
        setActiveChatId(result[0].id);
      }
      return result;
    });
  };

  const handleBranchChat = async (chatId: string, messageId: string) => {
    const sourceChat = chats.find(c => c.id === chatId);
    if (!sourceChat) return;

    const msgIndex = sourceChat.messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const newId = `chat-${Date.now()}`;
    const newChat: ChatSession = {
      id: newId,
      title: `${sourceChat.title} (Branch)`,
      messages: sourceChat.messages.slice(0, msgIndex + 1),
      stats: { ...sourceChat.stats }
    };

    setChats(prev => [...prev, newChat]);
    setActiveChatId(newId);
  };

  const handleRenameChat = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    setChats((prevChats) =>
      prevChats.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
    );
  };

  // Shared panel content — rendered in both the drawer and modal
  const chatManagementPanel = (
    <ChatManagementPanel
      chats={chats.map(c => ({ id: c.id, title: c.title }))}
      activeChatId={activeChatId}
      onSelectChat={(id) => setActiveChatId(id)}
      onDeleteChat={handleDeleteChat}
      onRenameChat={handleRenameChat}
    />
  );

  const memoryHubPanel = (
    <MemoryHubPanel 
      stats={activeStats}
      wsState={selectedModel}
      chatId={activeChatId} 
    />
  );

  const skillsManagementPanel = (
    <SkillsManagementPanel />
  );

  const activeDownloads = Object.values(pulls).filter(
    p => p.status !== 'done' && p.status !== 'error' && p.percent < 100
  );
  const activeDownloadsCount = activeDownloads.length;
  const downloadProgress = activeDownloadsCount > 0
    ? activeDownloads.reduce((sum, p) => sum + p.percent, 0) / activeDownloadsCount
    : 0;

  return (
    <div className="app-container">
      {/* 1. Persistent Icon-Only Activity Bar (~56px) */}
      <ActivityBar
        activeTab={activeNavTab}
        onTabChange={(tab) => { setActiveNavTab(tab); if (!isDrawerOpen) setIsDrawerOpen(true); }}
        onSettingsClick={() => setShowSettingsModal(true)}
        onModelLibraryClick={() => setShowModelLibrary(true)}
        activeDownloadsCount={activeDownloadsCount}
        downloadProgress={downloadProgress}
      />

      {/* 2. Collapsible Content Drawer (~240px → 0) */}
      <ContentDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeTab={activeNavTab}
        onNewChat={handleNewChat}
        onAddSkill={() => window.dispatchEvent(new CustomEvent('trigger-add-skill'))}
      >
        {activeNavTab === 'chats' ? chatManagementPanel : activeNavTab === 'memory' ? memoryHubPanel : skillsManagementPanel}
      </ContentDrawer>

      {/* 3. Chat Interface (fills remaining space) */}
      <main className="chat-main">
        <ChatInterfacePanel
          chatId={activeChatId}
          messages={activeMessages}
          setMessages={handleUpdateMessages}
          selectedModel={selectedModel}
          temperature={temperature}
          repeatPenalty={repeatPenalty}
          topP={topP}
          minP={minP}
          onStatsUpdate={handleUpdateStats}
          isNavCollapsed={!isDrawerOpen}
          onBranchChat={(messageId) => handleBranchChat(activeChatId, messageId)}
          isDarkTheme={isDarkTheme}
          onToggleTheme={handleToggleTheme}
          sendOnEnter={sendOnEnter}
          models={models}
          onModelChange={setSelectedModel}
          isAuxiliaryPaneOpen={isAuxiliaryPaneOpen}
          onToggleAuxiliaryPane={() => setIsAuxiliaryPaneOpen(prev => !prev)}
          inferenceProvider={inferenceProvider}
        />
      </main>

      {/* 4. Auxiliary Pane (Right side) */}
      <AuxiliaryPane 
        isOpen={isAuxiliaryPaneOpen} 
        onClose={() => setIsAuxiliaryPaneOpen(false)} 
        activeMessages={activeMessages} 
      />

      {/* Model Library (download from Hugging Face / manage disk) */}
      {showModelLibrary && (
        <ModelLibraryPanel
          onClose={() => {
            setShowModelLibrary(false);
            const activeCount = Object.values(pulls).filter(p => p.status !== 'done' && p.status !== 'error' && p.percent < 100).length;
            if (activeCount > 0) {
              addToast('Download Continuing', 'Your model downloads will continue in the background.', 'info');
            }
          }}
          onModelsChanged={refreshModels}
          pulls={pulls}
          onPull={handlePull}
          onDismissPull={handleDismissPull}
        />
      )}

      {/* Settings Modal Overlay (2-column layout) */}
      {showSettingsModal && (
        <div className="settings-modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="settings-modal-card settings-modal-2col" onClick={(e) => e.stopPropagation()}>
            <button
              className="settings-modal-close"
              onClick={() => setShowSettingsModal(false)}
              title="Close"
            >
              ✕
            </button>

            {/* Left Column: Model & Parameters */}
            <div className="settings-col settings-col-left">
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px' }}>Model Settings</h2>
              <ModelSettingsPanel
                selectedModel={selectedModel}
                onModelChange={(model) => { setSelectedModel(model); }}
                temperature={temperature}
                onTemperatureChange={setTemperature}
                repeatPenalty={repeatPenalty}
                onRepeatPenaltyChange={setRepeatPenalty}
                topP={topP}
                onTopPChange={setTopP}
                minP={minP}
                onMinPChange={setMinP}
                stats={activeStats}
                chatId={activeChatId}
                models={models}
                loadingModels={modelsLoading}
                inferenceProvider={inferenceProvider}
                onProviderChange={setInferenceProvider}
              />
            </div>

            {/* Right Column: App Settings & Sensory */}
            <div className="settings-col settings-col-right">
              <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '24px' }}>App Settings</h2>
              
              <div className="settings-section">
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>Theme & Layout</h3>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                  <button onClick={handleToggleTheme} className="theme-toggle-btn">
                    {isDarkTheme ? '☀️ Light Mode' : '🌙 Dark Mode'}
                  </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={compactMode} onChange={(e) => setCompactMode(e.target.checked)} style={{ cursor: 'pointer' }} />
                  Compact Layout (denser UI)
                </label>
              </div>

              <div className="settings-section" style={{ marginTop: '28px' }}>
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>Chat Behavior</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '12px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendOnEnter} onChange={(e) => setSendOnEnter(e.target.checked)} style={{ cursor: 'pointer' }} />
                  Send message with Enter (Use Shift+Enter for new line)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={notificationsEnabled} onChange={(e) => setNotificationsEnabled(e.target.checked)} style={{ cursor: 'pointer' }} />
                  Enable Desktop Notifications
                </label>
              </div>

              <div className="settings-section" style={{ marginTop: '28px' }}>
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>Language & Localization</h3>
                <CustomSelect
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: 'en', label: 'English (US)' },
                    { value: 'es', label: 'Español' },
                    { value: 'fr', label: 'Français' },
                    { value: 'de', label: 'Deutsch' },
                    { value: 'zh', label: '中文 (Simplified)' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="settings-section" style={{ marginTop: '28px' }}>
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>Sensory Status</h3>
                <div id="sensory-status" style={{ fontSize: '14px', color: 'var(--text-secondary)', padding: '12px', background: 'var(--subtle-bg)', borderRadius: '7px', border: '1px solid var(--border-color)' }}>
                  Check backend for audio/vision status
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Toast Notifications (e.g. background downloads) */}
      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast-card ${toast.type}`}>
              <div className="toast-content">
                <div className="toast-title">{toast.title}</div>
                <div className="toast-message">{toast.message}</div>
              </div>
              <button
                className="toast-close"
                onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <DialogProvider>
      <AppContent />
    </DialogProvider>
  );
}

export default App;
