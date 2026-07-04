import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import './AuxiliaryPane.css';
import type { Message } from '../ChatInterfacePanel/ChatInterfacePanel';
import { MarkdownRenderer, CodeBlockCard } from '../ChatInterfacePanel/ChatMessage/MarkdownRenderer';

interface AuxiliaryPaneProps {
  isOpen: boolean;
  onClose: () => void;
  activeMessages: Message[];
}

interface Artifact {
  filepath: string;
  content: string;
  filename: string;
  extension: string;
}

interface FileChanged {
  filepath: string;
  filename: string;
  directory: string;
  tool: string;
}

interface Subagent {
  role: string;
  type: string;
}

interface BackgroundTask {
  command: string;
}

export function AuxiliaryPane({ isOpen, onClose, activeMessages }: AuxiliaryPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [isResizing, setIsResizing] = useState(false);
  
  const [activeTab, setActiveTab] = useState<'overview' | 'review'>('overview');
  const [selectedItem, setSelectedItem] = useState<{ type: 'artifact' | 'file', data: any } | null>(null);

  // Accordion states
  const [openSections, setOpenSections] = useState({
    subagents: true,
    files: true,
    artifacts: true,
    tasks: true,
  });

  const toggleSection = (section: keyof typeof openSections) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const startResizing = useCallback((e: React.MouseEvent) => {
    setIsResizing(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      let newWidth = window.innerWidth - e.clientX;
      if (newWidth < 250) newWidth = 250;
      if (newWidth > 800) newWidth = 800;
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

  // Extract data from active messages
  const extractedData = useMemo(() => {
    const subagents: Subagent[] = [];
    const filesChangedMap = new Map<string, FileChanged>();
    const artifactMap = new Map<string, Artifact>();
    const backgroundTasks: BackgroundTask[] = [];

    for (const msg of activeMessages) {
      if (msg.toolExecutions) {
        for (const exec of msg.toolExecutions) {
          if (exec.tool === 'invoke_subagent' && exec.args?.Subagents) {
            exec.args.Subagents.forEach((s: any) => subagents.push({
              role: s.Role || 'Subagent',
              type: s.TypeName || 'Agent'
            }));
          }
          if (['write_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content'].includes(exec.tool)) {
            const filepath = exec.args?.filepath || exec.args?.TargetFile;
            if (typeof filepath === 'string') {
               const parts = filepath.split(/[/\\]/);
               const filename = parts.pop() || 'unknown_file';
               const directory = parts.length > 0 ? parts[parts.length - 1] : '';
               
               filesChangedMap.set(filepath, { filepath, filename, directory, tool: exec.tool });

               // Check if it's an artifact
               const isArtifact = exec.args?.ArtifactMetadata || filename.endsWith('.md');
               if (isArtifact && (exec.tool === 'write_file' || exec.tool === 'write_to_file')) {
                  const content = exec.args?.content || exec.args?.CodeContent || '';
                  const extension = filename.split('.').pop()?.toLowerCase() || '';
                  artifactMap.set(filepath, { filepath, content, filename, extension });
               }
            }
          }
          if (exec.tool === 'run_command' && exec.args?.CommandLine) {
            backgroundTasks.push({ command: exec.args.CommandLine });
          }
        }
      }
    }
    
    return {
      subagents,
      filesChanged: Array.from(filesChangedMap.values()),
      artifacts: Array.from(artifactMap.values()),
      backgroundTasks
    };
  }, [activeMessages]);

  // Reset selected if it no longer exists
  useEffect(() => {
    if (selectedItem?.type === 'artifact' && !extractedData.artifacts.some(a => a.filepath === selectedItem.data.filepath)) {
      setSelectedItem(null);
      setActiveTab('overview');
    }
  }, [extractedData.artifacts, selectedItem]);

  const handleItemClick = (type: 'artifact' | 'file', data: any) => {
    setSelectedItem({ type, data });
    setActiveTab('review');
  };

  const renderReviewContent = () => {
    if (!selectedItem) {
      return (
        <div className="artifacts-empty">
          <p>No item selected for review.</p>
        </div>
      );
    }

    if (selectedItem.type === 'artifact') {
      const artifact = selectedItem.data as Artifact;
      if (artifact.extension === 'md' || artifact.extension === 'markdown') {
        return (
          <div className="artifact-markdown-wrapper">
            <MarkdownRenderer content={artifact.content} />
          </div>
        );
      } else {
        return <CodeBlockCard code={artifact.content} language={artifact.extension} />;
      }
    } else if (selectedItem.type === 'file') {
      const file = selectedItem.data as FileChanged;
      return (
        <div className="file-review-placeholder">
          <p>Reviewing changes for {file.filename}</p>
          <span className="file-path">{file.filepath}</span>
        </div>
      );
    }
    
    return null;
  };

  return (
    <aside
      ref={containerRef}
      className={`auxiliary-pane ${isOpen ? 'open' : ''} ${isResizing ? 'resizing' : ''}`}
      style={isOpen ? { width: `${width}px` } : undefined}
      role="complementary"
      aria-hidden={!isOpen}
      aria-label="Auxiliary Panel"
    >
      <div className="drawer-resizer drawer-resizer-left" onMouseDown={startResizing} />

      <div className="drawer-header">
        <div className="drawer-tabs">
          <button 
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
            Overview
          </button>
          <button 
            className={`tab-btn ${activeTab === 'review' ? 'active' : ''}`}
            onClick={() => setActiveTab('review')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            Review
          </button>
        </div>
        <button
          className="drawer-close-btn"
          onClick={onClose}
          title="Close panel"
          aria-label="Close panel"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="drawer-content">
        {activeTab === 'overview' && (
          <div className="overview-container">
            {/* Subagents Section */}
            <div className="accordion-section">
              <button className="accordion-header" onClick={() => toggleSection('subagents')}>
                <span className="section-title">Subagents <span className="section-count">{extractedData.subagents.length}</span></span>
                <svg className={`chevron ${openSections.subagents ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
              {openSections.subagents && (
                <div className="accordion-content list-content">
                  {extractedData.subagents.length === 0 ? (
                    <div className="empty-list">No subagents</div>
                  ) : (
                    extractedData.subagents.map((s, i) => (
                      <div key={i} className="list-item">
                        <span className="item-icon">🤖</span>
                        <div className="item-meta">
                          <span className="item-name">{s.role}</span>
                          <span className="item-desc">{s.type}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Files Changed Section */}
            <div className="accordion-section">
              <button className="accordion-header" onClick={() => toggleSection('files')}>
                <span className="section-title">Files Changed <span className="section-count">{extractedData.filesChanged.length}</span></span>
                <svg className={`chevron ${openSections.files ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
              {openSections.files && (
                <div className="accordion-content list-content">
                  {extractedData.filesChanged.length === 0 ? (
                    <div className="empty-list">No files changed</div>
                  ) : (
                    extractedData.filesChanged.map(f => (
                      <button key={f.filepath} className="list-item clickable" onClick={() => handleItemClick('file', f)}>
                        <span className="item-icon">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: 'var(--accent-green)'}}>
                            <path d="M12 20h9"></path>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                          </svg>
                        </span>
                        <div className="item-meta">
                          <span className="item-name">{f.filename} <span className="item-dir">{f.directory}</span></span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Artifacts Section */}
            <div className="accordion-section">
              <button className="accordion-header" onClick={() => toggleSection('artifacts')}>
                <span className="section-title">Artifacts <span className="section-count">{extractedData.artifacts.length}</span></span>
                <svg className={`chevron ${openSections.artifacts ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
              {openSections.artifacts && (
                <div className="accordion-content list-content">
                  {extractedData.artifacts.length === 0 ? (
                    <div className="empty-list">No artifacts</div>
                  ) : (
                    extractedData.artifacts.map(a => (
                      <button key={a.filepath} className="list-item clickable" onClick={() => handleItemClick('artifact', a)}>
                        <span className="item-icon">
                          {a.filename.includes('task') ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 11 12 14 22 4"></polyline>
                              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                            </svg>
                          ) : a.filename.includes('plan') ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                              <line x1="9" y1="3" x2="9" y2="21"></line>
                            </svg>
                          )}
                        </span>
                        <div className="item-meta">
                          <span className="item-name">{a.filename.replace('.md', '').replace(/_/g, ' ')}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Background Tasks Section */}
            <div className="accordion-section">
              <button className="accordion-header" onClick={() => toggleSection('tasks')}>
                <span className="section-title">Background Tasks <span className="section-count">{extractedData.backgroundTasks.length}</span></span>
                <svg className={`chevron ${openSections.tasks ? 'open' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </button>
              {openSections.tasks && (
                <div className="accordion-content list-content">
                  {extractedData.backgroundTasks.length === 0 ? (
                    <div className="empty-list">No tasks</div>
                  ) : (
                    extractedData.backgroundTasks.map((t, i) => (
                      <div key={i} className="list-item">
                        <span className="item-icon">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                        </span>
                        <div className="item-meta">
                          <span className="item-name truncate">{t.command}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="review-container">
            {selectedItem && (
              <div className="review-header">
                <span className="review-title">{selectedItem.data.filename}</span>
                <span className="review-path">{selectedItem.data.filepath}</span>
              </div>
            )}
            <div className="review-content-body">
              {renderReviewContent()}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
