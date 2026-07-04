import { useState, useEffect, useLayoutEffect } from 'react';
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

function App() {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [repeatPenalty, setRepeatPenalty] = useState<number>(1.1);
  const [topP, setTopP] = useState<number>(0.9);
  const [minP, setMinP] = useState<number>(0.05);
  const [maxTokens, setMaxTokens] = useState<number>(-1);
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isAuxiliaryPaneOpen, setIsAuxiliaryPaneOpen] = useState(false);
  const [activeNavTab, setActiveNavTab] = useState<NavTab>('chats');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    return localStorage.getItem('orchai_theme') !== 'light';
  });
  const [sendOnEnter, setSendOnEnter] = useState<boolean>(() => localStorage.getItem('orchai_send_enter') !== 'false');
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => localStorage.getItem('orchai_notifications') === 'true');
  const [compactMode, setCompactMode] = useState<boolean>(() => localStorage.getItem('orchai_compact') === 'true');
  const [language, setLanguage] = useState<string>(() => localStorage.getItem('orchai_lang') || 'en');
  const [models, setModels] = useState<{name: string, supports_reasoning: boolean, supports_vision?: boolean}[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchModels(attempt = 1) {
      try {
        const res = await fetch('http://127.0.0.1:8000/api/chat/models');
        if (!res.ok) throw new Error('Failed to fetch models');
        const data = await res.json();
        if (cancelled) return;

        const rawModels = Array.isArray(data) ? data : Array.isArray(data.models) ? data.models : [];
        const formattedModels = rawModels.map((m: any) => 
          typeof m === 'string' ? { name: m, supports_reasoning: false, supports_vision: false } : m
        );

        setModels(formattedModels);
        setModelsLoading(false);

        setSelectedModel(current => {
          const hasSelectedModel = formattedModels.some((m: {name: string}) => m.name === current);
          if (formattedModels.length > 0 && (!current || !hasSelectedModel)) {
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
              return qwenModels[0].name;
            } else {
              return formattedModels[0].name;
            }
          }
          return current;
        });
      } catch (e) {
        if (!cancelled) {
          if (attempt < 10) setTimeout(() => fetchModels(attempt + 1), 1000);
          else { setModels([]); setModelsLoading(false); }
        }
      }
    }
    fetchModels();
    return () => { cancelled = true; };
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
      onNewChat={handleNewChat}
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

  return (
    <div className="app-container">
      {/* 1. Persistent Icon-Only Activity Bar (~56px) */}
      <ActivityBar
        activeTab={activeNavTab}
        onTabChange={(tab) => { setActiveNavTab(tab); if (!isDrawerOpen) setIsDrawerOpen(true); }}
        onSettingsClick={() => setShowSettingsModal(true)}
      />

      {/* 2. Collapsible Content Drawer (~240px → 0) */}
      <ContentDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        activeTab={activeNavTab}
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
          maxTokens={maxTokens}
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
        />
      </main>

      {/* 4. Auxiliary Pane (Right side) */}
      <AuxiliaryPane 
        isOpen={isAuxiliaryPaneOpen} 
        onClose={() => setIsAuxiliaryPaneOpen(false)} 
        activeMessages={activeMessages} 
      />

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
                maxTokens={maxTokens}
                onMaxTokensChange={setMaxTokens}
                stats={activeStats}
                chatId={activeChatId}
                models={models}
                loadingModels={modelsLoading}
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
                <select 
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '14px', width: '100%', cursor: 'pointer', outline: 'none' }}
                >
                  <option value="en">English (US)</option>
                  <option value="es">Español</option>
                  <option value="fr">Français</option>
                  <option value="de">Deutsch</option>
                  <option value="zh">中文 (Simplified)</option>
                </select>
              </div>

              <div className="settings-section" style={{ marginTop: '28px' }}>
                <h3 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: '12px' }}>Sensory Status</h3>
                <div id="sensory-status" style={{ fontSize: '14px', color: 'var(--text-secondary)', padding: '12px', background: 'var(--subtle-bg)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  Check backend for audio/vision status
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
