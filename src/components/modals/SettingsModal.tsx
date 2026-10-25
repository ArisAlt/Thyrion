import React, { useState, useEffect, useRef } from 'react';
import { Settings, X, Type, Shield, MousePointer, Info, Palette, ScrollText, Wrench } from 'lucide-react';
import { TerminalSettingsSection } from './settings/TerminalSettingsSection';
import { MouseSettingsSection } from './settings/MouseSettingsSection';
import { AppearanceSettingsSection } from './settings/AppearanceSettingsSection';
import { LoggingSettingsSection } from './settings/LoggingSettingsSection';
import { VaultSettingsSection } from './settings/VaultSettingsSection';
import { AdvancedSettingsSection } from './settings/AdvancedSettingsSection';
import { AboutSection } from './settings/AboutSection';

// The pages, grouped the way PuTTY's Category tree groups its options.
// Every panel stays mounted, hidden when not shown, so a half-done vault
// deletion or a log folder being picked survives a look at another tab.
const SETTINGS_TABS = [
  { id: 'terminal', label: 'Terminal', icon: Type, heading: 'Options controlling the terminal' },
  { id: 'mouse', label: 'Mouse & Clipboard', icon: MousePointer, heading: 'Options controlling copy and paste with the mouse' },
  { id: 'appearance', label: 'Appearance', icon: Palette, heading: 'Options controlling colours and the interface' },
  { id: 'logging', label: 'Logging', icon: ScrollText, heading: 'Options controlling session logging' },
  { id: 'vault', label: 'Vault', icon: Shield, heading: 'Options controlling the credential vault' },
  { id: 'advanced', label: 'Advanced', icon: Wrench, heading: 'PuTTY, layout, scripts and keyboard shortcuts' },
  { id: 'about', label: 'About', icon: Info, heading: 'About Thyrion' },
] as const;
export type SettingsTab = typeof SETTINGS_TABS[number]['id'];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  fontFamily: string;
  onChangeFontFamily: (font: string) => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  cursorStyle: 'block' | 'bar' | 'underline';
  onChangeCursorStyle: (style: 'block' | 'bar' | 'underline') => void;
  copyOnSelect?: boolean;
  onChangeCopyOnSelect?: (val: boolean) => void;
  rightClickAction?: 'paste' | 'contextMenu';
  onChangeRightClickAction?: (action: 'paste' | 'contextMenu') => void;
  onResetLayout: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  fontFamily,
  onChangeFontFamily,
  fontSize,
  onChangeFontSize,
  cursorStyle,
  onChangeCursorStyle,
  copyOnSelect = true,
  onChangeCopyOnSelect,
  rightClickAction = 'contextMenu',
  onChangeRightClickAction,
  onResetLayout,
}) => {
  // The tab shown; it stays put between openings, as PuTTY's tree does.
  const [tab, setTab] = useState<SettingsTab>('terminal');
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Arrow keys move between tabs (the list is vertical, but Left and Right
  // work too), Home and End go to the first and last; only the selected
  // tab is in the Tab order.
  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const i = SETTINGS_TABS.findIndex(t => t.id === tab);
    const last = SETTINGS_TABS.length - 1;
    const next =
      e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? last
      : -1;
    if (next < 0) return;
    e.preventDefault();
    const id = SETTINGS_TABS[next].id;
    setTab(id);
    tabRefs.current[id]?.focus();
  };

  const panelProps = (id: SettingsTab) => ({
    role: 'tabpanel' as const,
    id: `settings-panel-${id}`,
    'aria-labelledby': `settings-tab-${id}`,
    hidden: tab !== id,
    tabIndex: 0,
    className: 'p-4 space-y-5 outline-none',
  });

  const panelHeading = (id: SettingsTab) => (
    <p className="text-slate-300 font-semibold pb-1 border-b border-plinky-800">
      {SETTINGS_TABS.find(t => t.id === id)!.heading}
    </p>
  );

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 bg-plinky-950/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="bg-plinky-900 border border-plinky-700 rounded-lg w-[760px] max-w-full shadow-2xl flex flex-col overflow-hidden text-xs text-slate-200">
        {/* Header */}
        <div className="p-3 bg-plinky-950 border-b border-plinky-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings className="w-4 h-4 text-sky-400" />
            <div>
              <h3 id="settings-title" className="font-semibold text-slate-100 text-base">Global Settings</h3>
              <p className="text-meta text-plinky-muted">The defaults for every session. A saved session can change its own: right-click it, Change Session Settings.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close settings"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-plinky-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* A fixed height, so the dialog and its Done button stay put as
            the tabs change (see NewSessionModal). */}
        <div className="flex h-[min(560px,calc(100vh-160px))] min-h-0">
          {/* Category list */}
          <div
            role="tablist"
            aria-label="Settings categories"
            aria-orientation="vertical"
            onKeyDown={handleTabKeyDown}
            className="w-48 shrink-0 p-2 space-y-0.5 bg-plinky-950 border-r border-plinky-800 overflow-y-auto"
          >
            {SETTINGS_TABS.map(t => {
              const Icon = t.icon;
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  ref={el => { tabRefs.current[t.id] = el; }}
                  type="button"
                  role="tab"
                  id={`settings-tab-${t.id}`}
                  aria-selected={selected}
                  aria-controls={`settings-panel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
                    selected
                      ? 'bg-sky-500/15 text-sky-300 font-medium'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-plinky-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* Terminal */}
            <div {...panelProps('terminal')}>
              {panelHeading('terminal')}
              <TerminalSettingsSection
                fontFamily={fontFamily} onChangeFontFamily={onChangeFontFamily}
                fontSize={fontSize} onChangeFontSize={onChangeFontSize}
                cursorStyle={cursorStyle} onChangeCursorStyle={onChangeCursorStyle}
              />
            </div>

            {/* Mouse & Clipboard */}
            <div {...panelProps('mouse')}>
              {panelHeading('mouse')}
              <MouseSettingsSection
                copyOnSelect={copyOnSelect} onChangeCopyOnSelect={onChangeCopyOnSelect}
                rightClickAction={rightClickAction} onChangeRightClickAction={onChangeRightClickAction}
              />
            </div>

            {/* Appearance */}
            <div {...panelProps('appearance')}>
              {panelHeading('appearance')}
              <AppearanceSettingsSection fontFamily={fontFamily} fontSize={fontSize} />
            </div>

            {/* Logging (session/autolog.rs) */}
            <div {...panelProps('logging')}>
              {panelHeading('logging')}
              <LoggingSettingsSection isOpen={isOpen} />
            </div>

            {/* Credential Vault */}
            <div {...panelProps('vault')}>
              {panelHeading('vault')}
              <VaultSettingsSection isOpen={isOpen} />
            </div>

            {/* Advanced */}
            <div {...panelProps('advanced')}>
              {panelHeading('advanced')}
              <AdvancedSettingsSection isOpen={isOpen} onResetLayout={onResetLayout} />
            </div>

            {/* About. Alis, the mascot, was the owner's dog. */}
            <div {...panelProps('about')}>
              {panelHeading('about')}
              <AboutSection />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-plinky-950 border-t border-plinky-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-sky-700 hover:brightness-110 text-on-accent font-medium transition"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
