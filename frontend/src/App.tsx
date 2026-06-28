import { useState, useEffect } from 'react';
import './App.css';
import { ChatManagementPanel } from './components/ChatManagementPanel/ChatManagementPanel';
import { ChatInterfacePanel } from './components/ChatInterfacePanel/ChatInterfacePanel';
import type { Message } from './components/ChatInterfacePanel/ChatInterfacePanel';
import { ModelSettingsPanel } from './components/ModelSettingsPanel/ModelSettingsPanel';

export interface Stats {
  tokens_per_second: number;
  tokens: number;
  elapsed: number;
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
  }
};

function App() {
  const [selectedModel, setSelectedModel] = useState<string>('north-mini-code-1.0:q4_K_M');
  const [temperature, setTemperature] = useState<number>(0.7);
  const [maxTokens, setMaxTokens] = useState<number>(-1);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);

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

  // Sync active chat's messages locally for convenient props binding
  const activeMessages = activeChat.messages;
  const activeStats = activeChat.stats;

  // Custom setter to update only the active chat's messages
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
      
      // Only generate title AFTER the model has fully finished responding to the first user message
      // We know it's finished when the final chunk arrives, which attaches 'model' to the stats object
      if (userMessages.length === 1 && lastMessage.role === 'model' && lastMessage.stats?.model) {
        const firstMsgContent = userMessages[0].content;
        
        // Instantly mark as "Renaming..." in state to prevent double-triggers
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
            // Fallback on bad response status or structure
            const sliced = firstMsgContent.trim().slice(0, 20) + '...';
            setChats((prevChats) =>
              prevChats.map((c) =>
                c.id === activeChatId ? { ...c, title: sliced } : c
              )
            );
          } catch (err) {
            console.error('Failed to generate chat title', err);
            // Fallback on network failure
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

  // Custom setter to update only the active chat's stats
  const handleUpdateStats = (newStats: Stats) => {
    setChats((prevChats) =>
      prevChats.map((c) =>
        c.id === activeChatId ? { ...c, stats: newStats } : c
      )
    );
  };

  // Create a new chat session
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
      }
    };
    setChats((prev) => [...prev, newChat]);
    setActiveChatId(newId);
  };

  // Delete a chat session
  const handleDeleteChat = async (id: string) => {
    // Notify the backend to clear session orchestrator memory
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
      // Derive new active chat from the up-to-date filtered list, not stale closure
      if (activeChatId === id) {
        setActiveChatId(result[0].id);
      }
      return result;
    });
  };

  // Branch a chat session from a specific message
  const handleBranchChat = async (chatId: string, messageId: string) => {
    const sourceChat = chats.find(c => c.id === chatId);
    if (!sourceChat) return;

    const msgIndex = sourceChat.messages.findIndex(m => m.id === messageId);
    if (msgIndex === -1) return;

    const branchedMessage = sourceChat.messages[msgIndex];
    const newId = `chat-${Date.now()}`;
    const newChat: ChatSession = {
      id: newId,
      title: `${sourceChat.title} (Branch)`,
      messages: [branchedMessage],
      stats: { ...sourceChat.stats }
    };
    
    setChats(prev => [...prev, newChat]);
    setActiveChatId(newId);
  };

  // Rename a chat session
  const handleRenameChat = (id: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    setChats((prevChats) =>
      prevChats.map((c) => (c.id === id ? { ...c, title: newTitle } : c))
    );
  };

  return (
    <div className="app-container">
      <div className={`left-panel ${isLeftCollapsed ? 'collapsed' : ''}`}>
        <ChatManagementPanel
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={setActiveChatId}
          onNewChat={handleNewChat}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
        />
      </div>
      <div className="middle-panel">
        <ChatInterfacePanel
          chatId={activeChatId}
          messages={activeMessages}
          setMessages={handleUpdateMessages}
          selectedModel={selectedModel}
          temperature={temperature}
          maxTokens={maxTokens}
          onStatsUpdate={handleUpdateStats}
          isLeftCollapsed={isLeftCollapsed}
          isRightCollapsed={isRightCollapsed}
          onToggleLeft={() => setIsLeftCollapsed(!isLeftCollapsed)}
          onToggleRight={() => setIsRightCollapsed(!isRightCollapsed)}
          onBranchChat={(messageId) => handleBranchChat(activeChatId, messageId)}
        />
      </div>
      <div className={`right-panel ${isRightCollapsed ? 'collapsed' : ''}`}>
        <ModelSettingsPanel
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          temperature={temperature}
          onTemperatureChange={setTemperature}
          maxTokens={maxTokens}
          onMaxTokensChange={setMaxTokens}
          stats={activeStats}
          chatId={activeChatId}
        />
      </div>
    </div>
  );
}

export default App;
