import React from 'react';
import {
  Copy, Clipboard, CheckSquare, Shield, Key, Trash2, RotateCcw, List, FileText, FileCode,
  Settings as SettingsIcon, Search, Zap, Columns, Rows,
} from 'lucide-react';

// The terminal's right-click menu. What each item does is the terminal's
// (TerminalView); this is what the menu offers, and when.

export type HookShell = 'bash' | 'zsh' | 'fish';

export interface TerminalContextMenuProps {
  position: { x: number; y: number };
  menuRef: React.RefObject<HTMLDivElement | null>;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  /** The vault's items, for a session that isn't a local shell. */
  vault: { shown: boolean; key: string | null; hasLogin: boolean; unlocked: boolean };
  onSendLoginPassword: () => void;
  onSendEnablePassword: () => void;
  onClearScrollback: () => void;
  onResetTerminal: () => void;
  onOpenEventLog: () => void;
  onOpenSessionLog: () => void;
  onDuplicate?: () => void;
  onRunScript?: () => void;
  onEditSessionSettings?: () => void;
  onOpenSettings?: () => void;
  onReconnect?: () => void;
  onFind: () => void;
  onSendBreak?: () => void;
  /** Shell integration, for a session that can have it. */
  shellHooks?: { injected: string | null; lastShell: HookShell | null; onInject: (shell: HookShell) => void };
  onSplitPane?: (direction: 'vertical' | 'horizontal') => void;
}

const item = 'w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-sky-600/30 hover:text-sky-200 text-left transition';
const Divider = () => <div className="border-t border-plinky-800 my-1" />;

export const TerminalContextMenu: React.FC<TerminalContextMenuProps> = (p) => (
  <div
    ref={p.menuRef}
    className="fixed z-40 w-[17rem] max-h-[calc(100vh-16px)] overflow-y-auto bg-plinky-900 border border-plinky-700/80 rounded-lg shadow-2xl py-1 text-slate-200 text-xs select-none backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
    style={{ left: p.position.x, top: p.position.y }}
    onClick={(e) => e.stopPropagation()}
  >
    <button onClick={p.onCopy} className={item}>
      <Copy className="w-3.5 h-3.5 text-sky-400" />
      <span className="flex-1">Copy Selection</span>
      <span className="text-meta text-plinky-muted">Ctrl+Shift+C</span>
    </button>
    <button onClick={p.onPaste} className={item}>
      <Clipboard className="w-3.5 h-3.5 text-slate-400" />
      <span className="flex-1">Paste</span>
      <span className="text-meta text-plinky-muted">Ctrl+Shift+V</span>
    </button>
    <button onClick={p.onSelectAll} className={item}>
      <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
      <span className="flex-1">Select All</span>
      <span className="text-meta text-plinky-muted">Ctrl+Shift+A</span>
    </button>
    {/* The vault's passwords. "Send Enable Password" is listed for every
        session, saved one or not, so it can be found; with none saved it
        says where one goes. */}
    {p.vault.shown && (
      <>
        <Divider />
        <div className="px-3 py-1 text-meta font-semibold uppercase tracking-wider text-plinky-muted flex items-center space-x-1">
          <Shield className="w-3 h-3 text-slate-400" />
          <span>{p.vault.key ? `Vault (${p.vault.key})` : 'Vault'}</span>
        </div>
        {p.vault.key && p.vault.hasLogin && (
          <button
            onClick={p.onSendLoginPassword}
            disabled={!p.vault.unlocked}
            className={`w-full flex items-center space-x-2 px-3 py-1.5 text-left transition ${
              p.vault.unlocked ? 'hover:bg-sky-600/20 text-slate-200' : 'text-plinky-muted cursor-not-allowed'
            }`}
          >
            <Key className="w-3.5 h-3.5 text-slate-400" />
            <span>Send Login Password</span>
          </button>
        )}
        <button
          onClick={p.onSendEnablePassword}
          aria-keyshortcuts="Control+Shift+E"
          className="w-full flex items-center space-x-2 px-3 py-1.5 text-left transition hover:bg-sky-600/20 text-slate-200"
        >
          <Shield className="w-3.5 h-3.5 text-slate-400" />
          <span className="flex-1 whitespace-nowrap">Send Enable Password</span>
          <span className="text-meta text-plinky-muted whitespace-nowrap">Ctrl+Shift+E</span>
        </button>
      </>
    )}
    <Divider />
    <button onClick={p.onClearScrollback} className={item}>
      <Trash2 className="w-3.5 h-3.5 text-slate-400" />
      <span>Clear Scrollback</span>
    </button>
    <button onClick={p.onResetTerminal} className={item}>
      <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
      <span>Reset Terminal (RIS)</span>
    </button>
    <Divider />
    <button onClick={p.onOpenEventLog} className={item}>
      <List className="w-3.5 h-3.5 text-slate-400" />
      <span>PuTTY Event Log...</span>
    </button>
    <button onClick={p.onOpenSessionLog} className={item}>
      <FileText className="w-3.5 h-3.5 text-slate-400" />
      <span>Session Logging...</span>
    </button>
    {p.onDuplicate && (
      <button onClick={p.onDuplicate} className={item}>
        <Copy className="w-3.5 h-3.5 text-slate-400" />
        <span>Duplicate Session</span>
      </button>
    )}
    {p.onRunScript && (
      <button onClick={p.onRunScript} className={item}>
        <FileCode className="w-3.5 h-3.5 text-slate-400" />
        <span>Run Script...</span>
      </button>
    )}
    {/* This session's own settings, and the defaults for every session
        behind the title bar's gear. */}
    {p.onEditSessionSettings && (
      <button onClick={p.onEditSessionSettings} className={item}>
        <SettingsIcon className="w-3.5 h-3.5 text-sky-400" />
        <span>Change Session Settings…</span>
      </button>
    )}
    {p.onOpenSettings && (
      <button onClick={p.onOpenSettings} className={item}>
        <SettingsIcon className="w-3.5 h-3.5 text-slate-400" />
        <span>Global Settings…</span>
      </button>
    )}
    {p.onReconnect && (
      <button onClick={p.onReconnect} className={item}>
        <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
        <span>Reconnect</span>
      </button>
    )}
    <Divider />
    <button onClick={p.onFind} className={item}>
      <Search className="w-3.5 h-3.5 text-slate-400" />
      <span>Find in Terminal...</span>
    </button>
    {p.onSendBreak && (
      <>
        <Divider />
        <button
          onClick={p.onSendBreak}
          title="Hold a Break condition on the line for 400 ms (ROMMON / password recovery)"
          className={item}
        >
          <Zap className="w-3.5 h-3.5 text-slate-400" />
          <span>Send Break</span>
        </button>
      </>
    )}
    {p.shellHooks && (
      <>
        <Divider />
        <div
          className="px-3 pt-1 pb-0.5 flex items-center space-x-2 text-slate-400"
          title="Optional. Teaches the remote Unix shell to report prompts and its current directory (SFTP folder-following, Ctrl+Up/Down prompt jumping). Not for network devices."
        >
          <Zap className="w-3.5 h-3.5 text-slate-400" />
          <span>{p.shellHooks.injected ? `Shell hooks active (${p.shellHooks.injected})` : 'Shell hooks for:'}</span>
        </div>
        {!p.shellHooks.injected && (
          <div className="px-3 pb-1.5 flex items-center space-x-1">
            {(['bash', 'zsh', 'fish'] as const).map(shell => (
              <button
                key={shell}
                onClick={() => p.shellHooks!.onInject(shell)}
                title={shell === p.shellHooks!.lastShell ? 'Last used for this session' : undefined}
                className={`flex-1 py-0.5 rounded border font-mono text-meta transition ${
                  shell === p.shellHooks!.lastShell
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-200'
                    : 'border-plinky-700 text-slate-300 hover:bg-sky-600/30 hover:text-sky-200'
                }`}
              >
                {shell}
              </button>
            ))}
          </div>
        )}
      </>
    )}
    {p.onSplitPane && (
      <>
        <Divider />
        <button onClick={() => p.onSplitPane!('vertical')} className={item}>
          <Columns className="w-3.5 h-3.5 text-sky-400" />
          <span>Split Vertically</span>
        </button>
        <button onClick={() => p.onSplitPane!('horizontal')} className={item}>
          <Rows className="w-3.5 h-3.5 text-sky-400" />
          <span>Split Horizontally</span>
        </button>
      </>
    )}
  </div>
);
