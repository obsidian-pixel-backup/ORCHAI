import { useState } from 'react';
import './ActivityBar.css';

type NavTab = 'chats' | 'memory' | 'skills';

interface ActivityBarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onSettingsClick: () => void;
  onModelLibraryClick: () => void;
  activeDownloadsCount?: number;
  downloadProgress?: number;
}

const CHAT_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const MEMORY_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a7 7 0 0 1 7 7c0 3-2 5.5-3.5 7.5S12 22 12 22s-1.5-2.5-3.5-4.5S6 12 6 9a7 7 0 0 1 7-7z"/>
    <circle cx="12" cy="9" r="2.5"/>
  </svg>
);

const SKILLS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

const MODELS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

const SETTINGS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

export function ActivityBar({
  activeTab,
  onTabChange,
  onSettingsClick,
  onModelLibraryClick,
  activeDownloadsCount = 0,
  downloadProgress = 0
}: ActivityBarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <aside className="activity-bar">
      {/* Top: Logo + Nav Tabs */}
      <div className="activity-bar-top">
        <button
          className={`activity-tab ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => onTabChange('chats')}
          onMouseEnter={() => setHoveredId('chats')}
          onMouseLeave={() => setHoveredId(null)}
          title="Chats"
        >
          {CHAT_ICON}
          {hoveredId === 'chats' && <span className="tab-tooltip">Chats</span>}
        </button>
        <button
          className={`activity-tab ${activeTab === 'memory' ? 'active' : ''}`}
          onClick={() => onTabChange('memory')}
          onMouseEnter={() => setHoveredId('memory')}
          onMouseLeave={() => setHoveredId(null)}
          title="Memory Hub"
        >
          {MEMORY_ICON}
          {hoveredId === 'memory' && <span className="tab-tooltip">Memory Hub</span>}
        </button>
        <button
          className={`activity-tab ${activeTab === 'skills' ? 'active' : ''}`}
          onClick={() => onTabChange('skills')}
          onMouseEnter={() => setHoveredId('skills')}
          onMouseLeave={() => setHoveredId(null)}
          title="Skills Library"
        >
          {SKILLS_ICON}
          {hoveredId === 'skills' && <span className="tab-tooltip">Skills Library</span>}
        </button>
        <button
          className={`activity-tab ${activeDownloadsCount > 0 ? 'downloading' : ''}`}
          onClick={onModelLibraryClick}
          onMouseEnter={() => setHoveredId('models')}
          onMouseLeave={() => setHoveredId(null)}
          title="Model Library"
        >
          {MODELS_ICON}
          {activeDownloadsCount > 0 && (
            <>
              {/* Notification badge showing percentage */}
              <div className="activity-tab-badge" title={`${activeDownloadsCount} model(s) downloading`}>
                {Math.round(downloadProgress)}%
              </div>
              {/* Progress bar */}
              <div className="activity-tab-progress-bar">
                <div 
                  className="activity-tab-progress-fill" 
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </>
          )}
          {hoveredId === 'models' && (
            <span className="tab-tooltip">
              {activeDownloadsCount > 0 
                ? `Model Library (${Math.round(downloadProgress)}% - ${activeDownloadsCount} downloading)`
                : 'Model Library'}
            </span>
          )}
        </button>
      </div>

      {/* Spacer to push settings to bottom */}
      <div className="activity-bar-spacer" />

      {/* Bottom: Settings Gear */}
      <div className="activity-bar-bottom">
        <button
          className={`settings-icon-btn ${hoveredId === 'settings' ? 'active' : ''}`}
          onClick={onSettingsClick}
          onMouseEnter={() => setHoveredId('settings')}
          onMouseLeave={() => setHoveredId(null)}
          title="Settings"
        >
          {SETTINGS_ICON}
          {hoveredId === 'settings' && <span className="tab-tooltip">Settings</span>}
        </button>
      </div>
    </aside>
  );
}
