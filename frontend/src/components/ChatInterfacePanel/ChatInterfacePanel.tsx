import { useState, useEffect, useRef, useCallback } from 'react';
import './ChatInterfacePanel.css';
import { ChatMessage } from './ChatMessage/ChatMessage';
import { ChatInput } from './ChatInput/ChatInput';

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  images?: string[];
  documents?: { name: string; content: string }[];
  thinking?: string;
  stats?: {
    tokens_per_second: number;
    tokens: number;
    elapsed: number;
    prompt_eval_count?: number;
    model?: string;
  };
  toolApprovalRequest?: { tool: string; command: string; id: string };
  toolExecutions?: { tool: string; args: any }[];
}

interface ChatInterfacePanelProps {
  chatId: string;
  messages: Message[];
  setMessages: (newMessagesOrFn: Message[] | ((prev: Message[]) => Message[])) => void;
  selectedModel: string;
  temperature: number;
  repeatPenalty: number;
  topP: number;
  minP: number;
  maxTokens: number;
  onStatsUpdate: (stats: { tokens_per_second: number; tokens: number; elapsed: number; prompt_eval_count?: number }) => void;
  isNavCollapsed: boolean;
  onBranchChat?: (messageId: string) => void;
  isDarkTheme: boolean;
  onToggleTheme: () => void;
  sendOnEnter?: boolean;
  models?: {name: string, supports_reasoning: boolean, supports_vision?: boolean}[];
  onModelChange?: (model: string) => void;
}

export function ChatInterfacePanel({
  chatId,
  messages,
  setMessages,
  selectedModel,
  temperature,
  repeatPenalty,
  topP,
  minP,
  maxTokens,
  onStatsUpdate,
  isNavCollapsed: _,
  onBranchChat,
  isDarkTheme,
  onToggleTheme,
  sendOnEnter,
  models = [],
  onModelChange,
}: ChatInterfacePanelProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const historyContainerRef = useRef<HTMLDivElement | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [queuedMessages, setQueuedMessages] = useState<Message[]>([]);
  const queuedMessagesRef = useRef(queuedMessages);
  const isStreamingRef = useRef(false);
  const messagesRef = useRef(messages);
  const selectedModelRef = useRef(selectedModel);
  const temperatureRef = useRef(temperature);
  const repeatPenaltyRef = useRef(repeatPenalty);
  const topPRef = useRef(topP);
  const minPRef = useRef(minP);
  const maxTokensRef = useRef(maxTokens);

  useEffect(() => { queuedMessagesRef.current = queuedMessages; }, [queuedMessages]);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { selectedModelRef.current = selectedModel; }, [selectedModel]);
  useEffect(() => { temperatureRef.current = temperature; }, [temperature]);
  useEffect(() => { repeatPenaltyRef.current = repeatPenalty; }, [repeatPenalty]);
  useEffect(() => { topPRef.current = topP; }, [topP]);
  useEffect(() => { minPRef.current = minP; }, [minP]);
  useEffect(() => { maxTokensRef.current = maxTokens; }, [maxTokens]);
  
  // Track if user was near the bottom before token updates
  const isAtBottomRef = useRef(true);

  // ── Stable callback refs ──
  // Store callbacks in refs so the WebSocket effect doesn't re-run when
  // parent re-renders create new function references.
  const setMessagesRef = useRef(setMessages);
  const onStatsUpdateRef = useRef(onStatsUpdate);
  const handleSendMessageRef = useRef<any>(null); // assigned below
  useEffect(() => { setMessagesRef.current = setMessages; }, [setMessages]);
  useEffect(() => { onStatsUpdateRef.current = onStatsUpdate; }, [onStatsUpdate]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    chatEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const handleScroll = () => {
    const container = historyContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // Smart auto-scroll check: True if user is within 100px of bottom
    isAtBottomRef.current = distanceFromBottom <= 100;
    setShowScrollButton(distanceFromBottom > 200);

    // Active response outlines tracking
    if (messages.length === 0) return;

    let currentActiveId: string | null = null;
    const containerRect = container.getBoundingClientRect();

    // Check which message is currently in view
    for (let i = 0; i < messages.length; i++) {
      const msgId = messages[i].id;
      const element = document.getElementById(`msg-${msgId}`);
      if (element) {
        const rect = element.getBoundingClientRect();
        // If element's top boundary is within container viewport
        if (rect.top >= containerRect.top && rect.top <= containerRect.top + containerRect.height * 0.5) {
          currentActiveId = msgId;
          break;
        } else if (rect.top < containerRect.top && rect.bottom > containerRect.top + containerRect.height * 0.25) {
          currentActiveId = msgId;
        }
      }
    }

    if (currentActiveId && currentActiveId !== activeResponseId) {
      setActiveResponseId(currentActiveId);
    }
  };

  const scrollToResponse = (msgId: string) => {
    const element = document.getElementById(`msg-${msgId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveResponseId(msgId);
    }
  };

  // Scroll to bottom on first load of a new chat session
  useEffect(() => {
    isAtBottomRef.current = true;
    scrollToBottom('auto');
    setActiveResponseId(null);
  }, [chatId, scrollToBottom]);

  const handleApproveTool = useCallback((id: string, approved: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: 'tool_approve',
        id,
        approved
      }));
    }
  }, []);

  // Smart auto scroll effect: only snaps to bottom if user is already at the bottom
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom('auto');
    }
  }, [messages, isStreaming, scrollToBottom]);

  // ── WebSocket lifecycle: only reconnects when chatId changes ──
  useEffect(() => {
    let isCancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 10;
    const BASE_RECONNECT_DELAY_MS = 1000;
    // Close codes that indicate intentional/normal closure — don't auto-reconnect
    const NORMAL_CLOSE_CODES = new Set([1000, 1001, 1005, 1012]);

    function connectWebSocket() {
      if (isCancelled) return;

      const ws = new WebSocket('ws://127.0.0.1:8000/api/chat/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        // Guard against StrictMode: if the effect was cleaned up while we were
        // still connecting, close immediately now that we have an open socket.
        if (isCancelled) {
          ws.close(1000, 'Effect cleaned up');
          return;
        }
        console.log('Connected to ORCHAI backend');
        reconnectAttempts = 0; // Reset backoff on successful connection
      };

      ws.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'stream_thinking') {
            const token: string = data.content ?? '';

            // Handle thinking tokens - ALWAYS maintain single thinking message for chronological flow
            if (!streamingMessageIdRef.current) {
              const newId = `model-${Date.now()}`;
              streamingMessageIdRef.current = newId;
              setMessagesRef.current((prev) => [...prev, { id: newId, role: 'model', content: '', thinking: token, stats: data.stats }]);
            } else {
              const currentId = streamingMessageIdRef.current;
              setMessagesRef.current((prev) =>
                prev.map((msg) =>
                  msg.id === currentId ? { ...msg, thinking: (msg.thinking || '') + token, stats: data.stats } : msg
                )
              );
            }
          } else if (data.type === 'stream') {
            const token: string = data.content ?? '';

            if (!streamingMessageIdRef.current) {
              const newId = `model-${Date.now()}`;
              streamingMessageIdRef.current = newId;
              setMessagesRef.current((prev) => [...prev, { id: newId, role: 'model', content: token, stats: data.stats }]);
            } else {
              const currentId = streamingMessageIdRef.current;
              setMessagesRef.current((prev) =>
                prev.map((msg) =>
                  msg.id === currentId ? { ...msg, content: msg.content + token, stats: data.stats } : msg
                )
              );
            }
          } else if (data.type === 'stream_end') {
            const currentId = streamingMessageIdRef.current;
            if (currentId && data.stats) {
              setMessagesRef.current((prev) =>
                prev.map((msg) =>
                  msg.id === currentId ? { ...msg, stats: data.stats } : msg
                )
              );
            }
            streamingMessageIdRef.current = null;

            if (data.stats) {
              onStatsUpdateRef.current({
                tokens_per_second: data.stats.tokens_per_second ?? 0,
                tokens: data.stats.tokens ?? 0,
                elapsed: data.stats.elapsed ?? 0,
                prompt_eval_count: data.stats.prompt_eval_count,
              });
            }

            if (localStorage.getItem('orchai_notifications') === 'true' && document.hidden) {
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('OrchAI', {
                  body: 'New response received from model.',
                  icon: '/favicon.ico'
                });
              }
            }

            // Check for queued messages
            setTimeout(() => {
              const qMsgs = queuedMessagesRef.current;
              if (qMsgs.length > 0) {
                // Send the first queued message
                const nextMsg = qMsgs[0];
                
                // Update states
                setQueuedMessages(prev => prev.slice(1));
                
                const updatedHistory = [...messagesRef.current, nextMsg];
                setMessagesRef.current(updatedHistory);
                
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  const conversationHistory = updatedHistory.map(({ role, content: c, images: img, documents: docs }) => {
                    let finalContent = c;
                    if (docs && docs.length > 0) {
                      docs.forEach(doc => {
                        finalContent += `\n\n--- Attached Document: ${doc.name} ---\n${doc.content}`;
                      });
                    }
                    const msg: any = { role, content: finalContent };
                    if (img && img.length > 0) {
                      msg.images = img;
                    }
                    return msg;
                  });

                  wsRef.current.send(
                    JSON.stringify({
                      session_id: chatId,
                      model: selectedModelRef.current,
                      messages: conversationHistory,
                      options: {
                        temperature: temperatureRef.current,
                        repeat_penalty: repeatPenaltyRef.current,
                        top_p: topPRef.current,
                        min_p: minPRef.current,
                        num_predict: maxTokensRef.current,
                      },
                    })
                  );
                }
              } else {
                setIsStreaming(false);
                isStreamingRef.current = false;
              }
            }, 0);
          } else if (data.type === 'tool_approval_request') {
            const currentId = streamingMessageIdRef.current;
            if (currentId) {
              setMessagesRef.current((prev) =>
                prev.map((msg) =>
                  msg.id === currentId
                    ? { ...msg, toolApprovalRequest: { tool: data.tool, command: data.command, id: data.id } }
                    : msg
                )
              );
            }
          } else if (data.type === 'tool_execution') {
            const currentId = streamingMessageIdRef.current;
            if (currentId) {
              setMessagesRef.current((prev) =>
                prev.map((msg) => {
                  if (msg.id === currentId) {
                    const execs = msg.toolExecutions ? [...msg.toolExecutions] : [];
                    execs.push({ tool: data.tool, args: data.args });
                    // clear approval request if this is an execution
                    return { ...msg, toolExecutions: execs, toolApprovalRequest: undefined };
                  }
                  return msg;
                })
              );
            }
          } else if (data.type === 'error') {
            streamingMessageIdRef.current = null;
            setIsStreaming(false);
            isStreamingRef.current = false;
            const errorContent = data.content ?? data.message ?? 'An unknown error occurred.';
            setMessagesRef.current((prev) => [
              ...prev,
              { id: `error-${Date.now()}`, role: 'model', content: `Error: ${errorContent}` },
            ]);
          } else if (data.type === 'sensory_input') {
            const spokenText = data.content;
            if (spokenText && handleSendMessageRef.current) {
              setTimeout(() => {
                handleSendMessageRef.current(spokenText);
              }, 0);
            }
          }
        } catch (parseErr) {
          console.error('Failed to parse WebSocket message:', parseErr);
        }
      };

      ws.onclose = (event) => {
        if (isCancelled) return;
        console.log(`WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        setIsStreaming(false);
        isStreamingRef.current = false;
        streamingMessageIdRef.current = null;
        wsRef.current = null;

        // Auto-reconnect with exponential backoff for unexpected closures only
        if (!NORMAL_CLOSE_CODES.has(event.code) && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts), 30000);
          reconnectAttempts++;
          console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
          reconnectTimer = setTimeout(connectWebSocket, delay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnection.
        // Suppressed to avoid noisy console output for expected transient failures.
      };
    }

    connectWebSocket();

    return () => {
      isCancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
          // Socket is open or already closing — send a clean close frame
          ws.close(1000, 'Chat session changed');
        } else if (ws.readyState === WebSocket.CONNECTING) {
          // Socket hasn't opened yet (common with React StrictMode double-invoke).
          // Null out handlers so nothing fires when it eventually opens/errors,
          // and the onopen guard above will close it once it connects.
          ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        }
        wsRef.current = null;
      }
    };
  }, [chatId]);

  const handleSendMessage = (content: string, images: string[] = [], documents: { name: string; content: string }[] = []) => {
    const userMessage: Message = { 
      id: `user-${Date.now()}`, 
      role: 'user', 
      content, 
      images, 
      documents
    };

    if (isStreamingRef.current) {
      setQueuedMessages(prev => [...prev, userMessage]);
      return;
    }
    
    const updatedMessages = [...messagesRef.current, userMessage];
    setMessages(updatedMessages);

    setIsStreaming(true);
    isStreamingRef.current = true;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const conversationHistory = updatedMessages.map(({ role, content: c, images: img, documents: docs }) => {
        let finalContent = c;
        if (docs && docs.length > 0) {
          docs.forEach(doc => {
            finalContent += `\n\n--- Attached Document: ${doc.name} ---\n${doc.content}`;
          });
        }
        
        const msg: any = { role, content: finalContent };
        if (img && img.length > 0) {
          msg.images = img;
        }
        return msg;
      });

      wsRef.current.send(
        JSON.stringify({
          session_id: chatId,
          model: selectedModelRef.current,
          messages: conversationHistory,
          options: {
            temperature: temperatureRef.current,
            repeat_penalty: repeatPenaltyRef.current,
            top_p: topPRef.current,
            min_p: minPRef.current,
            num_predict: maxTokensRef.current,
          },
        })
      );
    } else {
      console.error('WebSocket is not connected');
      setIsStreaming(false);
      isStreamingRef.current = false;
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: 'model', content: 'Error: Not connected to the backend. Please try again.' },
      ]);
    }
  };

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  const handleEditMessage = (messageId: string, newContent: string) => {
    if (isStreamingRef.current) return;

    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;

    const originalMessage = messages[messageIndex];
    
    const editedUserMessage: Message = {
      ...originalMessage,
      content: newContent
    };

    const updatedMessages = [...messages.slice(0, messageIndex), editedUserMessage];
    
    setMessages(updatedMessages);
    setIsStreaming(true);
    isStreamingRef.current = true;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const conversationHistory = updatedMessages.map(({ role, content: c, images: img, documents: docs }) => {
        let finalContent = c;
        if (docs && docs.length > 0) {
          docs.forEach(doc => {
            finalContent += `\n\n--- Attached Document: ${doc.name} ---\n${doc.content}`;
          });
        }
        
        const msg: any = { role, content: finalContent };
        if (img && img.length > 0) {
          msg.images = img;
        }
        return msg;
      });

      wsRef.current.send(
        JSON.stringify({
          session_id: chatId,
          model: selectedModelRef.current,
          messages: conversationHistory,
          options: {
            temperature: temperatureRef.current,
            repeat_penalty: repeatPenaltyRef.current,
            top_p: topPRef.current,
            min_p: minPRef.current,
            num_predict: maxTokensRef.current,
          },
        })
      );
    } else {
      console.error('WebSocket is not connected');
      setIsStreaming(false);
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: 'model', content: 'Error: Not connected to the backend. Please try again.' },
      ]);
    }
  };

  const handleStopGeneration = () => {
    if (!isStreamingRef.current) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "cancel" }));
      setIsStreaming(false);
      isStreamingRef.current = false;
      // Wait for backend to send stream_end, or optimistic local update:
      // We rely on backend stream_end to update stats, but we can clear streaming message id
      streamingMessageIdRef.current = null;
    }
  };

  let activeIndex = messages.findIndex(m => m.id === activeResponseId);
  if (activeIndex === -1) activeIndex = messages.length - 1;

  let startIndex = activeIndex - 3;
  let endIndex = activeIndex + 4; // 8 items total

  if (startIndex < 0) {
    startIndex = 0;
    endIndex = Math.min(8, messages.length) - 1;
  } else if (endIndex >= messages.length) {
    endIndex = messages.length - 1;
    startIndex = Math.max(0, messages.length - 8);
  }

  const navigatorMessages = messages.slice(startIndex, endIndex + 1);

  const navigateToRelative = (offset: number) => {
    const targetIdx = Math.max(0, Math.min(messages.length - 1, activeIndex + offset));
    if (targetIdx !== activeIndex && messages[targetIdx]) {
      scrollToResponse(messages[targetIdx].id);
    }
  };

  return (
    <div className="chat-interface-container">
      {/* ── Premium Top Header Bar ── */}
      <div className="chat-header-bar">
        <div className="model-status-indicator" style={{ position: 'relative', cursor: 'pointer', userSelect: 'none' }} ref={modelDropdownRef} onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}>
          <span className="status-dot green"></span>
          <span className="status-label">Active Model:</span>
          <span className="status-value" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {selectedModel}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 0.2s', transform: isModelDropdownOpen ? 'rotate(-180deg)' : 'none' }}>
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
          
          {isModelDropdownOpen && models.length > 0 && (
            <div className="custom-model-dropdown" style={{ top: '100%', left: 0, marginTop: '8px', minWidth: '220px', zIndex: 100 }}>
              {models.map((m) => (
                <div 
                  key={m.name} 
                  className={`custom-model-option ${m.name === selectedModel ? 'selected' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onModelChange) onModelChange(m.name);
                    setIsModelDropdownOpen(false);
                  }}
                >
                  {m.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            className="icon-btn"
            onClick={onToggleTheme}
            title={isDarkTheme ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label={isDarkTheme ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDarkTheme ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Chat History Area (with rounded top-left corner) ── */}
      <div className="chat-history-wrapper">
        <div
          className="chat-history"
          ref={historyContainerRef}
          onScroll={handleScroll}
        >
          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              id={msg.id}
              role={msg.role}
              content={msg.content}
              images={msg.images}
              documents={msg.documents}
              thinking={msg.thinking}
              stats={msg.stats}
              toolApprovalRequest={msg.toolApprovalRequest}
              toolExecutions={msg.toolExecutions}
              onEdit={handleEditMessage}
              onBranch={onBranchChat}
              onApproveTool={handleApproveTool}
            />
          ))}
          {isStreaming && !streamingMessageIdRef.current && (
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* ── Response Navigator Sidebar (Slide Outline Dashboard) ── */}
        {messages.length > 0 && (
          <div className="response-navigator">
            <button
              className="navigator-chevron"
              onClick={() => navigateToRelative(-1)}
              disabled={activeIndex <= 0}
              title="Previous message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
            </button>

            {navigatorMessages.map((msg) => {
              const isActive = msg.id === activeResponseId || (activeResponseId === null && msg.id === messages[messages.length - 1]?.id);

              let cleanContent = msg.content;
              if (msg.role === 'model') {
                const thinkEndTag = '</think>';
                const endIdx = msg.content.indexOf(thinkEndTag);
                if (endIdx !== -1) {
                  cleanContent = msg.content.slice(endIdx + thinkEndTag.length);
                } else if (msg.content.includes('<think>')) {
                  cleanContent = 'Thinking...';
                }
              }

              const words = cleanContent.trim().split(/\s+/).filter(Boolean);
              const previewText = words.length <= 6
                ? words.join(' ')
                : words.slice(0, 6).join(' ') + '...';

              return (
                <div key={msg.id} className="navigator-item-wrapper">
                  <button
                    className={`navigator-dash ${msg.role} ${isActive ? 'active' : ''}`}
                    onClick={() => scrollToResponse(msg.id)}
                    aria-label={`Jump to ${msg.role === 'user' ? 'Message' : 'Response'}`}
                  />
                  <div className="navigator-tooltip">
                    <span className="tooltip-role">{msg.role === 'user' ? 'You' : 'OrchAI'}</span>
                    <span className="tooltip-text">{previewText}</span>
                  </div>
                </div>
              );
            })}

            <button
              className="navigator-chevron"
              onClick={() => navigateToRelative(1)}
              disabled={activeIndex >= messages.length - 1}
              title="Next message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* ── Input Area ── */}
      <div className="chat-input-wrapper">
        <div className="chat-input-inner">
          {queuedMessages.length > 0 && (
            <div className="queued-messages-container">
              <div className="queued-messages-header">
                <span className="queued-messages-title">Queued ({queuedMessages.length})</span>
              </div>
              <div className="queued-messages-list">
                {queuedMessages.map(msg => (
                  <div key={msg.id} className="queued-message-chip">
                    <span className="queued-message-text">
                      {msg.content || (msg.documents?.length ? `Attached: ${msg.documents[0].name}` : 'Image attached')}
                    </span>
                    <button className="queued-message-cancel" onClick={() => setQueuedMessages(prev => prev.filter(m => m.id !== msg.id))} title="Cancel queued message">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <ChatInput 
            onSendMessage={handleSendMessage} 
            isStreaming={isStreaming} 
            onStopGeneration={handleStopGeneration} 
            sendOnEnter={sendOnEnter}
          />
          {/* ── Smart Floating Scroll-to-Bottom Button next to User Input ── */}
          {showScrollButton && (
            <button
              className="scroll-bottom-btn"
              onClick={() => scrollToBottom('smooth')}
              title="Scroll to bottom"
              aria-label="Scroll to bottom"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
