import React from 'react';
import { Key, Zap, Shield, Copy, Check, Search, Radio, Sparkles, FileText, List } from 'lucide-react';
import { SyncChannel, TerminalTab } from '../../types/session';
import { STATUS_DOT, STATUS_TEXT } from '../../services/sessionStatus';

// The bar over each terminal: the session's status and name on the left;
// on the right the vault's quick menu, Find, the broadcast channel, keyword
// highlighting, session logging and the event log. What each does is
// TerminalView's.

const channelClass = (ch: SyncChannel) => {
  switch (ch) {
    case 'A': return 'bg-ch-a/20 text-ch-a border-ch-a/40';
    case 'B': return 'bg-ch-b/20 text-ch-b border-ch-b/40';
    case 'C': return 'bg-ch-c/20 text-ch-c border-ch-c/40';
    case 'D': return 'bg-ch-d/20 text-ch-d border-ch-d/40';
    default: return 'bg-slate-800 text-slate-400 border-slate-700';
  }
};

export interface VaultQuickMenuProps {
  /** The session's vault entry. */
  entry: string;
  unlocked: boolean;
  hasLogin: boolean;
  hasEnable: boolean;
  /** Which password was just copied, for a tick beside it. */
  copied: 'login' | 'enable' | null;
  open: boolean;
  onToggle: () => void;
  onSendLogin: () => void;
  onSendEnable: () => void;
  onCopyLogin: () => void;
  onCopyEnable: () => void;
}

const VaultQuickMenu: React.FC<VaultQuickMenuProps> = (v) => (
  <div className="relative">
    <button
      onClick={v.onToggle}
      title={`Encrypted Vault: ${v.entry}`}
      className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-meta font-medium transition-colors ${
        v.open
          ? 'bg-sky-500/15 text-sky-200 border-sky-500/40'
          : 'bg-slate-800/80 text-slate-300 border-plinky-700 hover:bg-slate-700 hover:text-slate-100'
      }`}
    >
      <Key className="w-3 h-3 text-slate-400" />
      <span>Vault</span>
    </button>

    {v.open && (
      <div
        className="absolute right-0 top-full mt-1.5 z-40 w-56 bg-plinky-900 border border-plinky-700 rounded-lg shadow-2xl py-1.5 text-xs select-none backdrop-blur-md animate-in fade-in duration-100"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-3 py-1 border-b border-plinky-800 flex items-center justify-between">
          <span className="font-semibold text-slate-200 text-meta">Vault Credentials</span>
          <span className="text-meta text-plinky-muted font-mono truncate max-w-[100px]" title={v.entry}>
            {v.entry}
          </span>
        </div>

        {!v.unlocked ? (
          <div className="p-2.5 text-center space-y-1.5">
            <p className="text-meta text-slate-400">Vault is currently locked.</p>
            <p className="text-meta text-plinky-muted">Unlock it with Vault in the top bar to send saved passwords.</p>
          </div>
        ) : (
          <div className="py-1">
            {v.hasLogin && (
              <button
                onClick={v.onSendLogin}
                className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-sky-600/30 hover:text-sky-200 text-left transition"
              >
                <Zap className="w-3.5 h-3.5 text-slate-400" />
                <span>Send Login Password</span>
              </button>
            )}

            <button
              onClick={v.onSendEnable}
              aria-keyshortcuts="Control+Shift+E"
              className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-sky-600/20 hover:text-sky-100 text-left transition"
            >
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              <span className="flex-1">Send Enable Password</span>
              <span className="text-meta text-plinky-muted">{v.hasEnable ? 'Ctrl+Shift+E' : 'none saved'}</span>
            </button>

            <div className="border-t border-plinky-800 my-1" />

            <button
              onClick={v.onCopyLogin}
              className="w-full flex items-center justify-between px-3 py-1 hover:bg-slate-800 text-slate-300 text-left text-meta transition"
            >
              <span className="flex items-center space-x-1.5">
                <Copy className="w-3 h-3 text-slate-400" />
                <span>Copy Password</span>
              </span>
              {v.copied === 'login' && <Check className="w-3 h-3 text-emerald-400" />}
            </button>

            {v.hasEnable && (
              <button
                onClick={v.onCopyEnable}
                className="w-full flex items-center justify-between px-3 py-1 hover:bg-slate-800 text-slate-300 text-left text-meta transition"
              >
                <span className="flex items-center space-x-1.5">
                  <Copy className="w-3 h-3 text-slate-400" />
                  <span>Copy Enable Password</span>
                </span>
                {v.copied === 'enable' && <Check className="w-3 h-3 text-emerald-400" />}
              </button>
            )}
          </div>
        )}
      </div>
    )}
  </div>
);

const ChannelMenu: React.FC<{
  channel: SyncChannel;
  open: boolean;
  onToggle: () => void;
  onChoose: (channel: SyncChannel) => void;
}> = ({ channel, open, onToggle, onChoose }) => (
  <div className="relative">
    <button
      onClick={onToggle}
      onPointerDown={e => e.stopPropagation()}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Broadcast channel: commands sent to a channel reach every live tab on it"
      className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-meta whitespace-nowrap transition-colors ${channelClass(channel)}`}
    >
      <Radio className="w-3 h-3" />
      <span>Channel: {channel === 'none' ? 'Off' : channel}</span>
    </button>
    {open && (
      <div
        role="menu"
        aria-label="Broadcast channel"
        onPointerDown={e => e.stopPropagation()}
        className="absolute right-0 top-full mt-1 z-40 w-40 py-1 rounded-lg border border-plinky-700 bg-plinky-900 shadow-xl text-xs"
      >
        {(['none', 'A', 'B', 'C', 'D'] as const).map(ch => (
          <button
            key={ch}
            role="menuitemradio"
            aria-checked={channel === ch}
            onClick={() => onChoose(ch)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-plinky-800 ${channel === ch ? 'text-slate-100' : 'text-slate-300'}`}
          >
            <span className={`w-5 text-center rounded border text-meta font-semibold ${ch === 'none' ? 'border-plinky-700 text-plinky-muted' : channelClass(ch)}`}>
              {ch === 'none' ? '·' : ch}
            </span>
            <span className="flex-1">{ch === 'none' ? 'Off' : `Channel ${ch}`}</span>
            {channel === ch && <Check className="w-3 h-3 text-sky-400" />}
          </button>
        ))}
      </div>
    )}
  </div>
);

export const TerminalHeader: React.FC<{
  status: TerminalTab['status'];
  /** The name, or what the tab puts there instead. */
  title: React.ReactNode;
  /** Beside the name: "(host:port)" or "(local shell)". */
  subtitle?: string;
  hooksError: string | null;
  /** The vault's quick menu, for a session with a vault entry. */
  vault?: VaultQuickMenuProps;
  onFind: () => void;
  channel: SyncChannel;
  channelMenuOpen: boolean;
  onToggleChannelMenu: () => void;
  onChooseChannel: (channel: SyncChannel) => void;
  highlighting: boolean;
  onToggleHighlighting: () => void;
  logging: { active: boolean; bytes: number };
  onOpenLogging: () => void;
  onOpenEventLog: () => void;
}> = (p) => (
  <div className="relative flex items-center justify-between gap-3 px-3 py-1.5 bg-plinky-900/90 border-b border-plinky-800 text-xs select-none whitespace-nowrap">
    <div className="flex items-center space-x-2 min-w-0 overflow-hidden">
      <span
        role="img"
        aria-label={STATUS_TEXT[p.status]}
        title={STATUS_TEXT[p.status]}
        className={`h-2 w-2 rounded-full ${STATUS_DOT[p.status]}`}
      />
      {p.title}
      {p.subtitle && <span className="text-plinky-muted font-mono truncate">{p.subtitle}</span>}
    </div>

    {p.hooksError && (
      <div className="absolute top-full right-3 mt-1 z-40 px-2 py-1 rounded bg-rose-950/95 border border-rose-500/50 text-rose-300 text-meta shadow-lg animate-in fade-in slide-in-from-top-1 duration-150">
        {p.hooksError}
      </div>
    )}
    <div className="flex items-center space-x-2">
      {p.vault && <VaultQuickMenu {...p.vault} />}

      <button
        onClick={p.onFind}
        title="Find in Terminal (Ctrl+F)"
        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-meta transition"
      >
        <Search className="w-3 h-3 text-sky-400" />
        <span>Find</span>
      </button>

      <ChannelMenu channel={p.channel} open={p.channelMenuOpen} onToggle={p.onToggleChannelMenu} onChoose={p.onChooseChannel} />

      {/* Keyword highlighting (T-017). */}
      <button
        onClick={p.onToggleHighlighting}
        aria-pressed={p.highlighting}
        title={p.highlighting
          ? 'Keyword highlighting on: errors and down states red, warnings amber, up green, interfaces, IPs and MACs. Click to turn off.'
          : 'Keyword highlighting off. Click to turn on.'}
        className={`flex items-center space-x-1 px-1.5 py-0.5 rounded border text-meta transition ${
          p.highlighting
            ? 'bg-sky-500/15 text-sky-300 border-sky-500/40 hover:bg-sky-500/25'
            : 'bg-slate-800/60 text-plinky-muted border-slate-700 hover:text-slate-300'
        }`}
      >
        <Sparkles className="w-3 h-3" />
        <span>Highlight</span>
      </button>

      <button
        onClick={p.onOpenLogging}
        title="Session Logging (PuTTY-style) - record output to log file"
        className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-meta transition-colors ${
          p.logging.active
            ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
            : 'bg-slate-800/80 text-slate-400 border-slate-700 hover:text-slate-300'
        }`}
      >
        {p.logging.active ? (
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400"></span>
        ) : (
          <FileText className="w-3 h-3 text-slate-400" />
        )}
        <span>{p.logging.active ? `Log: ${(p.logging.bytes / 1024).toFixed(1)}k` : 'Log'}</span>
      </button>

      <button
        onClick={p.onOpenEventLog}
        title="PuTTY Event Log - view connection diagnostics and trace"
        className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 text-meta transition"
      >
        <List className="w-3 h-3 text-slate-400" />
        <span>Events</span>
      </button>
    </div>
  </div>
);
