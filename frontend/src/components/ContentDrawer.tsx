import { useRef, useEffect, useState, useCallback } from 'react';
import './ContentDrawer.css';

interface ContentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: string;
  children: React.ReactNode;
  onNewChat?: () => void;
  onAddSkill?: () => void;
}

export function ContentDrawer({ isOpen, onClose, activeTab, children, onNewChat, onAddSkill }: ContentDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [isResizing, setIsResizing] = useState(false);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus trap when open
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const focusable = containerRef.current.querySelector('input, button, [tabindex]:not([tabindex="-1"])');
      if (focusable instanceof HTMLElement) focusable.focus();
    }
  }, [isOpen]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      let newWidth = e.clientX - 56; // Activity bar is ~56px
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 600) newWidth = 600;
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <aside
      ref={containerRef}
      className={`content-drawer ${isOpen ? 'open' : ''} ${isResizing ? 'resizing' : ''}`}
      style={isOpen ? { width: `${width}px` } : undefined}
      role="complementary"
      aria-hidden={!isOpen}
      aria-label={`${activeTab === 'chats' ? 'Chat Management' : activeTab === 'skills' ? 'Skills Library' : 'Memory Hub'} panel`}
    >
      {/* Header */}
      <div className="drawer-header">
        <button
          className="drawer-close-btn"
          onClick={onClose}
          title="Collapse panel"
          aria-label="Collapse panel"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <h2 className="drawer-title">
          {activeTab === 'chats' ? 'Chats' : activeTab === 'skills' ? 'Skills Library' : 'Memory Hub'}
        </h2>
        <div className="drawer-header-actions" style={{ marginLeft: 'auto' }}>
          {activeTab === 'chats' && onNewChat && (
            <button className="drawer-action-btn" onClick={onNewChat} title="New Chat">
              + New Chat
            </button>
          )}
          {activeTab === 'skills' && onAddSkill && (
            <button className="drawer-action-btn" onClick={onAddSkill} title="Add Skill">
              + Add Skill
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="drawer-content">
        {children}
      </div>
      
      {/* Resize Handle */}
      <div className="drawer-resizer" onMouseDown={startResizing} />
    </aside>
  );
}
