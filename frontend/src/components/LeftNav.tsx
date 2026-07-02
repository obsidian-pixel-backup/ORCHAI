import { useState } from 'react';
import './LeftNav.css';

type NavTab = 'chats' | 'memory';

interface LeftNavProps {
  isCollapsed: boolean;
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onSettingsClick: () => void;
  onCollapseToggle: () => void;
  isDarkTheme: boolean;
  chatPanel?: React.ReactNode;
  memoryPanel?: React.ReactNode;
}

// SVG icon paths for each tab and the settings button
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

const SETTINGS_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51H3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 14.6 9a1.65 1.65 0 0 0 1.51 1H16a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const COLLAPSE_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

const EXPAND_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

const LOGO_TEXT = (
  <span className="logo-text">ORCHAI</span>
);

export function LeftNav({
  isCollapsed,
  activeTab,
  onTabChange,
  onSettingsClick,
  onCollapseToggle,
  chatPanel,
  memoryPanel,
}: LeftNavProps) {
  const [hoveredTab, setHoveredTab] = useState<NavTab | null>(null);

  return (
    <aside className={`left-nav ${isCollapsed ? 'collapsed' : ''}`}>
      {/* Header: Logo + Collapse Toggle */}
      <div className="nav-header">
        {!isCollapsed && LOGO_TEXT}
        <button
          className="collapse-btn"
          onClick={onCollapseToggle}
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? EXPAND_ICON : COLLAPSE_ICON}
        </button>
      </div>

      {/* Tab Navigation */}
      <nav className="nav-tabs">
        <TabItem
          icon={CHAT_ICON}
          label="Chats"
          isActive={activeTab === 'chats'}
          onClick={() => onTabChange('chats')}
          isCollapsed={isCollapsed}
          hoveredTab={hoveredTab}
          setHoveredTab={setHoveredTab}
        />
        <TabItem
          icon={MEMORY_ICON}
          label="Memory Hub"
          isActive={activeTab === 'memory'}
          onClick={() => onTabChange('memory')}
          isCollapsed={isCollapsed}
          hoveredTab={hoveredTab}
          setHoveredTab={setHoveredTab}
        />
      </nav>

      {/* Tab Content Area */}
      <div className="nav-content">
        {activeTab === 'chats' && chatPanel}
        {activeTab === 'memory' && memoryPanel}
      </div>

      {/* Bottom: Settings Button */}
      <div className="nav-footer">
        <button
          className="settings-btn"
          onClick={onSettingsClick}
          title="Settings"
        >
          {SETTINGS_ICON}
        </button>
      </div>
    </aside>
  );
}

function TabItem({
  icon,
  label,
  isActive,
  onClick,
  isCollapsed,
  hoveredTab,
  setHoveredTab,
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  isCollapsed: boolean;
  hoveredTab: NavTab | null;
  setHoveredTab: (tab: NavTab | null) => void;
}) {
  return (
    <button
      className={`nav-tab ${isActive ? 'active' : ''}`}
      onClick={onClick}
      onMouseEnter={() => setHoveredTab(label.toLowerCase() as NavTab)}
      onMouseLeave={() => setHoveredTab(null)}
      title={isCollapsed ? label : undefined}
    >
      <span className="tab-icon">{icon}</span>
      {!isCollapsed && <span className="tab-label">{label}</span>}
      {hoveredTab === label.toLowerCase() && !isActive && (
        <span className="tab-tooltip">{label}</span>
      )}
    </button>
  );
}
