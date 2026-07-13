import { useState, useEffect } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useDialog } from '../../ConfirmDialog/DialogContext';
import './ChatMessage.css';

interface ChatMessageProps {
  id: string;
  role: 'user' | 'model' | 'assistant';
  content: string;
  images?: string[];
  documents?: { name: string; content: string }[];
  thinking?: string;
  monologue?: string;
  stats?: {
    tokens_per_second: number;
    tokens: number;
    elapsed: number;
    prompt_eval_count?: number;
    model?: string;
    background_input_tokens?: number;
    user_input_tokens?: number;
    thinking_tokens?: number;
    content_tokens?: number;
  };
  toolApprovalRequest?: { tool: string; command: string; id: string };
  toolExecutions?: { tool: string; args: any }[];
  onEdit?: (id: string, newContent: string) => void;
  onBranch?: (id: string) => void;
  onApproveTool?: (id: string, approved: boolean) => void;
}

function parseChronologicalBlocks(content: string) {
  const blocks: { type: 'text' | 'thinking', content: string, isThinkingActive: boolean, duration?: string }[] = [];
  let remaining = content;
  
  while (remaining.length > 0) {
    const startIdx = remaining.indexOf('<think>');
    if (startIdx === -1) {
      if (remaining.trim()) blocks.push({ type: 'text', content: remaining, isThinkingActive: false });
      break;
    }
    
    if (startIdx > 0) {
      const textBefore = remaining.slice(0, startIdx);
      if (textBefore.trim()) blocks.push({ type: 'text', content: textBefore, isThinkingActive: false });
    }
    
    const endIdx = remaining.indexOf('</think>', startIdx);
    if (endIdx === -1) {
      blocks.push({ type: 'thinking', content: remaining.slice(startIdx + 7), isThinkingActive: true });
      break;
    } else {
      let thinkingContent = remaining.slice(startIdx + 7, endIdx);
      let duration: string | undefined;
      
      const durationMatches = [...thinkingContent.matchAll(/<!-- duration: ([\d.]+)s -->/g)];
      if (durationMatches.length > 0) {
        duration = durationMatches[durationMatches.length - 1][1];
        thinkingContent = thinkingContent.replace(/<!-- duration: [\d.]+s -->/g, '').trim();
      }
      
      blocks.push({ type: 'thinking', content: thinkingContent, isThinkingActive: false, duration });
      remaining = remaining.slice(endIdx + 8);
    }
  }
  
  if (blocks.length === 0) {
    blocks.push({ type: 'text', content: content, isThinkingActive: false });
  }
  
  return blocks;
}

function ThinkingBlock({ block }: { block: { content: string, isThinkingActive: boolean, duration?: string } }) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    if (block.isThinkingActive) {
      setIsCollapsed(false);
    } else {
      setIsCollapsed(true);
    }
  }, [block.isThinkingActive]);

  const toggleCollapse = () => {
    if (!block.isThinkingActive) {
      setIsCollapsed((prev) => !prev);
    }
  };

  return (
    <div className={`thinking-block ${block.isThinkingActive ? 'active' : ''}`}>
      <button 
        className={`thinking-header ${block.isThinkingActive ? 'thinking-active-header' : 'collapsible'}`}
        onClick={toggleCollapse}
        disabled={block.isThinkingActive}
      >
        <span className="thinking-title">
          {block.isThinkingActive ? (
            <>
              <svg className="thinking-icon spinning" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"></line>
                <line x1="12" y1="18" x2="12" y2="22"></line>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                <line x1="2" y1="12" x2="6" y2="12"></line>
                <line x1="18" y1="12" x2="22" y2="12"></line>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
              </svg>
              <span>Thinking...</span>
            </>
          ) : (
            <>
              <svg className="thinking-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span>Thought Process {block.duration ? `(${block.duration}s)` : ''}</span>
            </>
          )}
        </span>
        {!block.isThinkingActive && (
          <svg className={`chevron-icon ${isCollapsed ? 'collapsed' : ''}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        )}
      </button>
      
      {!isCollapsed && (
        <div className="thinking-body">
          <MarkdownRenderer content={block.content} />
        </div>
      )}
    </div>
  );
}

export function ChatMessage({
  id, role, content, images, documents, stats,
  toolApprovalRequest, onEdit, onBranch, onApproveTool, monologue
}: ChatMessageProps) {
  const isModel = role === 'model' || role === 'assistant';
  const chronologicalBlocks = isModel ? parseChronologicalBlocks(content) : [{ type: 'text' as const, content, isThinkingActive: false }];

  const dialog = useDialog();

  const [expandedDocIdx, setExpandedDocIdx] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);
  const [actionState, setActionState] = useState<'idle' | 'copied' | 'shared' | 'branched'>('idle');
  const [showShareModal, setShowShareModal] = useState(false);

  const triggerAction = (type: 'copied' | 'shared' | 'branched', callback?: () => void) => {
    if (callback) callback();
    setActionState(type);
    setTimeout(() => setActionState('idle'), 2000);
  };

  const handleExternalLink = (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    e.preventDefault();
    triggerAction('shared');
    setShowShareModal(false);
    
    if ((window as any).require) {
      try {
        const { shell } = (window as any).require('electron');
        shell.openExternal(url);
      } catch (err) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div id={`msg-${id}`} className={`message-row ${role === 'user' ? 'user-row' : 'model-row'}`}>
      <div className={`message-content ${role === 'user' ? 'user-bubble' : 'model-text'}`}>
        
        {/* Render User Images if present */}
        {images && images.length > 0 && (
          <div className="message-images-grid">
            {images.map((imgBase64, idx) => (
              <img 
                key={idx} 
                src={`data:image/jpeg;base64,${imgBase64}`} 
                alt="User attached" 
                className="message-image" 
              />
            ))}
          </div>
        )}
        
        {/* Render User Documents if present */}
        {documents && documents.length > 0 && (
          <div className="message-documents-container">
            <div className="message-documents-grid">
              {documents.map((doc, idx) => (
                <button 
                  key={idx} 
                  className={`message-document-chip ${expandedDocIdx === idx ? 'expanded' : ''}`}
                  onClick={() => setExpandedDocIdx(expandedDocIdx === idx ? null : idx)}
                  data-tooltip="Click to view content"
                >
                  <svg className="document-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <span className="document-name">{doc.name}</span>
                </button>
              ))}
            </div>
            {expandedDocIdx !== null && documents[expandedDocIdx] && (
              <div className="expanded-document-view">
                <div className="expanded-document-header">
                  <span>{documents[expandedDocIdx].name}</span>
                  <button className="close-expanded-btn" onClick={() => setExpandedDocIdx(null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                <div className="expanded-document-content">
                  <MarkdownRenderer content={documents[expandedDocIdx].content} />
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Render Pre-Response Internal Monologue (Thinking Chamber) if present */}
        {monologue && (
          <div className="monologue-container">
            <div className="monologue-header">
              <svg className="monologue-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 0 1 7.54 16.59c-.2.2-.47.34-.76.38L12 20l-6.78-1.03c-.29-.04-.56-.18-.76-.38A10 10 0 0 1 12 2z"></path>
                <circle cx="12" cy="11" r="3"></circle>
              </svg>
              <strong>My Monologue</strong>
            </div>
            <div className="monologue-body">
              <em>"{monologue}"</em>
            </div>
          </div>
        )}

        {/* Render Chronological Blocks (Thinking, Text, Tools inline) */}
        <div className="response-body">
          {chronologicalBlocks.map((block, idx) => {
            if (block.type === 'thinking') {
              return <ThinkingBlock key={idx} block={block} />;
            } else {
              return isEditing ? (
                <div key={idx} className="edit-container">
                  <textarea 
                    className="edit-textarea" 
                    value={editValue} 
                    onChange={(e) => setEditValue(e.target.value)} 
                    rows={Math.max(2, editValue.split('\n').length)}
                  />
                  <div className="edit-actions">
                    <button className="edit-btn save-btn" onClick={() => { 
                      setIsEditing(false); 
                      if(onEdit) onEdit(id, editValue); 
                    }}>Save & Submit</button>
                    <button className="edit-btn cancel-btn" onClick={() => { 
                      setIsEditing(false); 
                      setEditValue(content); 
                    }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <MarkdownRenderer key={idx} content={block.content} />
              );
            }
          })}
        </div>

        {/* Render Tool Approval Request if present */}
        {toolApprovalRequest && onApproveTool && (
          <div className="tool-approval-request">
            <div className="tool-approval-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <strong>Permission Required</strong>
            </div>
            <div className="tool-approval-body">
              <p>The model wants to execute a command: <code>{toolApprovalRequest.tool}</code></p>
              <pre className="tool-approval-code">{toolApprovalRequest.command}</pre>
              <div className="tool-approval-actions">
                <button className="tool-btn approve-btn" onClick={() => onApproveTool(toolApprovalRequest.id, true)}>Approve</button>
                <button className="tool-btn deny-btn" onClick={() => onApproveTool(toolApprovalRequest.id, false)}>Deny</button>
              </div>
            </div>
          </div>
        )}

        {/* User Message Action Toolbar */}
        {role === 'user' && !isEditing && (
          <div className="user-msg-toolbar">
            <button className={`msg-action-btn copy-btn-icon ${actionState === 'copied' ? 'success-anim' : ''}`} onClick={() => {
              triggerAction('copied', () => navigator.clipboard.writeText(content));
            }} data-tooltip="Copy Message">
              {actionState === 'copied' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              )}
            </button>
            <button className="msg-action-btn edit-btn-icon" onClick={async () => { 
              const confirmed = await dialog.confirm(
                "Edit Message?",
                "Are you sure you want to edit this message? All subsequent messages will be discarded.",
                { confirmLabel: "Edit", danger: true }
              );
              if (confirmed) {
                setIsEditing(true); 
                setEditValue(content); 
              }
            }} data-tooltip="Edit and Resubmit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
            <button className={`msg-action-btn branch-btn-icon ${actionState === 'branched' ? 'success-anim' : ''}`} onClick={() => {
              triggerAction('branched', () => { if (onBranch) onBranch(id); });
            }} data-tooltip="Branch Chat from Here">
              {actionState === 'branched' ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3v12"></path>
                  <circle cx="18" cy="6" r="3"></circle>
                  <circle cx="6" cy="18" r="3"></circle>
                  <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Model Message Footer (Stats & Actions) */}
        {isModel && (
          <div className="stats-footer">
            <div className="stats-footer-header">
              <div className="stats-left-section">
                {stats && (stats.tokens > 0 || stats.tokens_per_second > 0) && (
                  <span className="stats-summary-text">
                    <svg className="stats-summary-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span>{stats.tokens_per_second.toFixed(1)} t/s</span>
                    <span className="bullet-separator">•</span>
                    {stats.prompt_eval_count ? (
                      <span>
                        {stats.background_input_tokens !== undefined ? `${stats.background_input_tokens} bg in • ${stats.user_input_tokens} user in` : `${stats.prompt_eval_count} in`} 
                        {' • '}
                        {stats.thinking_tokens !== undefined ? `${stats.thinking_tokens} think out • ${stats.content_tokens} text out` : `${stats.tokens} out`}
                      </span>
                    ) : (
                      <span>{stats.tokens} tokens</span>
                    )}
                    <span className="bullet-separator">•</span>
                    <span>{stats.elapsed.toFixed(2)}s</span>
                  </span>
                )}
              </div>
              <div className="model-msg-toolbar" style={{ marginTop: 0 }}>
                <button className={`msg-action-btn copy-btn-icon ${actionState === 'copied' ? 'success-anim' : ''}`} onClick={() => {
                  triggerAction('copied', () => navigator.clipboard.writeText(content));
                }} data-tooltip="Copy Message">
                  {actionState === 'copied' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  )}
                </button>
                <div className="share-menu-container">
                  <button className={`msg-action-btn share-btn-icon ${actionState === 'shared' ? 'success-anim' : ''} ${showShareModal ? 'active' : ''}`} onClick={() => {
                    setShowShareModal(true);
                  }} data-tooltip="Share Message">
                    {actionState === 'shared' ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="18" cy="5" r="3"></circle>
                        <circle cx="6" cy="12" r="3"></circle>
                        <circle cx="18" cy="19" r="3"></circle>
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                      </svg>
                    )}
                  </button>
                  {showShareModal && (
                    <div className="share-modal-overlay" onClick={() => setShowShareModal(false)}>
                      <div className="share-modal" onClick={e => e.stopPropagation()}>
                        <button className="share-modal-close" onClick={() => setShowShareModal(false)}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        
                        <div className="share-modal-icon-top">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                          </svg>
                        </div>

                        <h2 className="share-modal-title">Share Response</h2>
                        <p className="share-modal-subtitle">Great ideas are meant to be shared! Forward this insight to others.</p>

                        <div className="share-modal-columns">
                          <div className="share-modal-left-col">
                            <div className="share-modal-preview-header">
                              <div className="share-modal-section-title" style={{ marginBottom: 0 }}>Message Preview</div>
                              <button className="share-modal-copy-btn header-copy" onClick={() => {
                                navigator.clipboard.writeText(content);
                                triggerAction('shared');
                              }} data-tooltip="Copy full response">
                                {actionState === 'shared' ? (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                ) : (
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                  </svg>
                                )}
                              </button>
                            </div>
                            <div className="share-modal-preview-box scrollable">
                              <div className="share-modal-preview-text full-text">
                                {content}
                              </div>
                            </div>
                          </div>

                          <div className="share-modal-right-col">
                            <div className="share-modal-section-title">Share to</div>
                            <div className="share-modal-apps-grid scrollable-grid">
                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://www.facebook.com/sharer/sharer.php?u=&quote=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon facebook-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>
                                </div>
                                <span className="share-app-label">Facebook</span>
                              </a>
                              
                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://twitter.com/intent/tweet?text=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon x-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l11.733 16h4.267l-11.733 -16z"></path><path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772"></path></svg>
                                </div>
                                <span className="share-app-label">X</span>
                              </a>
                              
                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://www.linkedin.com/sharing/share-offsite/?url=&summary=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon linkedin-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>
                                </div>
                                <span className="share-app-label">LinkedIn</span>
                              </a>

                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://reddit.com/submit?title=Klydis%20Response&text=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon reddit-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path></svg>
                                </div>
                                <span className="share-app-label">Reddit</span>
                              </a>

                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://wa.me/?text=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon whatsapp-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                                </div>
                                <span className="share-app-label">WhatsApp</span>
                              </a>
                              
                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://t.me/share/url?url=&text=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon telegram-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                </div>
                                <span className="share-app-label">Telegram</span>
                              </a>

                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://mail.google.com/mail/?view=cm&fs=1&su=Klydis%20Response&body=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon gmail-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                </div>
                                <span className="share-app-label">Gmail</span>
                              </a>

                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `https://docs.google.com/document/create?title=Klydis%20Response`)}>
                                <div className="share-app-icon docs-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                </div>
                                <span className="share-app-label">Google Docs</span>
                              </a>
                              
                              <a href="#" className="share-app-btn" onClick={(e) => handleExternalLink(e, `mailto:?subject=Klydis Response&body=${encodeURIComponent(content)}`)}>
                                <div className="share-app-icon email-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                </div>
                                <span className="share-app-label">Native Email</span>
                              </a>
                              
                              <button className="share-app-btn" onClick={async () => {
                                try {
                                  if (navigator.share && window.isSecureContext) {
                                    await navigator.share({ title: 'Klydis Response', text: content });
                                    triggerAction('shared');
                                  } else {
                                    await dialog.alert("Share Error", "Native sharing requires a secure HTTPS connection or isn't supported on this browser.");
                                  }
                                } catch (e: any) {
                                  // Ignore user cancellation, but alert on actual errors
                                  if (e.name !== 'AbortError') {
                                    await dialog.alert("Share Error", `Native share error: ${e.message}`);
                                  }
                                }
                                setShowShareModal(false);
                              }}>
                                <div className="share-app-icon windows-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                                </div>
                                <span className="share-app-label">More</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <button className={`msg-action-btn branch-btn-icon ${actionState === 'branched' ? 'success-anim' : ''}`} onClick={() => {
                  triggerAction('branched', () => { if (onBranch) onBranch(id); });
                }} data-tooltip="Branch Chat from Here">
                  {actionState === 'branched' ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 3v12"></path>
                      <circle cx="18" cy="6" r="3"></circle>
                      <circle cx="6" cy="18" r="3"></circle>
                      <path d="M18 9a9 9 0 0 1-9 9"></path>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}


