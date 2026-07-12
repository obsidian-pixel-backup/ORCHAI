import { useState, useRef, useEffect } from 'react';
import './ChatManagementPanel.css';

interface Chat {
  id: string;
  title: string;
}

interface ChatManagementPanelProps {
  chats: Chat[];
  activeChatId: string;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
}

export function ChatManagementPanel({
  chats,
  activeChatId,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
}: ChatManagementPanelProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isRenamingRef = useRef(false);

  // Focus input automatically when editing starts
  useEffect(() => {
    if (editingChatId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingChatId]);

  const handleStartRename = (id: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the chat item
    isRenamingRef.current = true;
    setEditingChatId(id);
    setEditingTitle(currentTitle);
  };

  const handleSaveRename = (id: string) => {
    if (!isRenamingRef.current) return;
    isRenamingRef.current = false;
    
    if (editingTitle.trim()) {
      onRenameChat(id, editingTitle.trim());
    }
    setEditingChatId(null);
  };

  const handleCancelRename = () => {
    if (!isRenamingRef.current) return;
    isRenamingRef.current = false;
    setEditingChatId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename(id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelRename();
    }
  };

  return (
    <div className="chat-management-container">
      <div className="chat-list">
        <div className="chat-items-scroll">
          {chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isEditing = chat.id === editingChatId;

            return (
              <div
                key={chat.id}
                className={`chat-item ${isActive ? 'active' : ''}`}
                onClick={() => !isEditing && onSelectChat(chat.id)}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    className="chat-rename-input"
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => handleSaveRename(chat.id)}
                    onKeyDown={(e) => handleKeyDown(e, chat.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="chat-item-title">{chat.title}</span>
                    <div className="chat-item-actions">
                      <button
                        className="chat-action-btn edit-action"
                        onClick={(e) => handleStartRename(chat.id, chat.title, e)}
                        title="Rename Chat"
                        aria-label="Rename Chat"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 20h9"></path>
                          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                        </svg>
                      </button>
                      <button
                        className="chat-action-btn delete-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteChat(chat.id);
                        }}
                        title="Delete Chat"
                        aria-label="Delete Chat"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
