import React from 'react';
import { Upload, ShieldAlert, RotateCcw, Lock, FileCode, Clipboard, Key, Shield, X } from 'lucide-react';

// The small bars and overlays over a terminal: connecting, disconnected,
// locked, a script or a paste running, a password prompt the vault can
// answer, and a dropped file. When each shows is TerminalView's call.

const bar = 'absolute z-30 flex items-center space-x-2 bg-plinky-900/95 px-3 py-1.5 rounded-lg shadow-2xl text-xs';
const smallButton = 'px-2 py-0.5 rounded bg-plinky-800 hover:bg-plinky-700 text-slate-200 text-meta';
const DismissButton: React.FC<{ onClick: () => void; label?: boolean }> = ({ onClick, label }) => (
  <button onClick={onClick} className="p-0.5 text-slate-400 hover:text-white rounded" aria-label={label ? 'Dismiss' : undefined} title="Dismiss">
    <X className="w-3.5 h-3.5" />
  </button>
);

/** A file dragged over the terminal: dropping it types its path. */
export const DropOverlay: React.FC = () => (
  <div className="absolute inset-0 z-30 pointer-events-none border-2 border-dashed border-sky-400 bg-sky-950/70 backdrop-blur-xs flex items-center justify-center text-sky-300 font-mono text-xs space-x-2 animate-in fade-in duration-100">
    <Upload className="w-5 h-5 text-sky-400 animate-bounce" />
    <span>Drop file to paste path into terminal</span>
  </div>
);

/** Still connecting: where to, for how long, and Cancel (Esc). */
export const ConnectingOverlay: React.FC<{ target: string; since: number; onCancel: () => void }> = ({ target, since, onCancel }) => (
  <div role="status" className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
    <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-lg border border-plinky-700 bg-plinky-900/95 shadow-2xl text-xs text-slate-200">
      <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" aria-hidden />
      <span>
        Connecting to <span className="font-mono text-slate-100">{target}</span>
        <span className="text-plinky-muted tabular-nums"> · {Math.max(0, Math.floor((Date.now() - since) / 1000))} s</span>
      </span>
      <button
        onClick={onCancel}
        title="Esc"
        className="px-2 py-0.5 rounded border border-plinky-700 text-slate-300 hover:bg-plinky-800 outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        Cancel
      </button>
    </div>
  </div>
);

/** The connection was abandoned over a changed host key. */
export const HostKeyChangedBar: React.FC<{ onViewHostKeys: () => void }> = ({ onViewHostKeys }) => (
  <div role="alert" className={`${bar} bottom-3 left-4 border border-rose-500/70 text-rose-200`}>
    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
    <span>Host key changed. Connection abandoned.</span>
    <button onClick={onViewHostKeys} className="px-2 py-0.5 rounded border border-rose-500/50 text-rose-200 hover:bg-rose-500/10 text-meta">View host keys</button>
  </div>
);

/** Disconnected, or waiting to reconnect by itself. A serial tab restored
 *  at startup isn't disconnected, its line is just not opened yet. */
export const ConnectionBar: React.FC<{
  reconnectIn: number | null;
  notOpenedYet: boolean;
  onReconnectNow: () => void;
  onCancelReconnect: () => void;
  onReconnect: () => void;
}> = ({ reconnectIn, notOpenedYet, onReconnectNow, onCancelReconnect, onReconnect }) => (
  <div role="status" className={`${bar} bottom-3 left-4 border border-amber-500/60 text-amber-200`}>
    <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
    {reconnectIn !== null ? (
      <>
        <span>Connection lost. Reconnecting in {reconnectIn} s</span>
        <button onClick={onReconnectNow} className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-amber-950 text-meta">Reconnect now</button>
        <button onClick={onCancelReconnect} className={smallButton}>Cancel</button>
      </>
    ) : (
      <>
        <span>{notOpenedYet ? 'Serial line not opened' : 'Disconnected'}</span>
        <button onClick={onReconnect} className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-amber-950 text-meta">{notOpenedYet ? 'Connect' : 'Reconnect'}</button>
      </>
    )}
  </div>
);

/** The tab is read only. `typedJustNow`: someone just tried to type. */
export const LockedBar: React.FC<{ typedJustNow: boolean; onUnlock: () => void }> = ({ typedJustNow, onUnlock }) => (
  <div role="status" className={`${bar} top-3 right-14 border border-amber-500/60 text-amber-200`}>
    <Lock className="w-3.5 h-3.5 text-amber-400" />
    <span>{typedJustNow ? 'This tab is locked: typing is not sent' : 'Locked: read only'}</span>
    <button onClick={onUnlock} className={smallButton}>Unlock</button>
  </div>
);

/** A script runs on this session (Run Script). */
export const ScriptBar: React.FC<{ name: string; onStop: () => void }> = ({ name, onStop }) => (
  <div role="status" className={`${bar} bottom-3 left-3 border border-sky-500/60 text-sky-200`}>
    <FileCode className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
    <span>Running {name}</span>
    <button onClick={onStop} className="px-2 py-0.5 rounded bg-plinky-800 hover:bg-rose-600/60 text-slate-200 text-meta">
      Stop
    </button>
  </div>
);

/** A paced paste in progress: how far, and a way to stop it. */
export const PasteProgressBar: React.FC<{ sent: number; total: number; onCancel: () => void }> = ({ sent, total, onCancel }) => (
  <div role="status" className={`${bar} bottom-3 right-14 border border-sky-500/60 text-sky-200`}>
    <Clipboard className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
    <span>Pasting line {Math.min(sent + 1, total)} of {total}</span>
    <button onClick={onCancel} className="px-2 py-0.5 rounded bg-plinky-800 hover:bg-rose-600/60 text-slate-200 text-meta">
      Cancel
    </button>
  </div>
);

/** A password prompt the vault can answer. Names the entry it will use:
 *  prompt detection reads text the remote side controls, so after hopping
 *  to another host the prompt may not be this session's. */
export const PasswordPromptBar: React.FC<{
  kind: 'login' | 'enable';
  vaultKey: string;
  onSend: () => void;
  onDismiss: () => void;
}> = ({ kind, vaultKey, onSend, onDismiss }) => (
  <div className={`${bar} top-3 right-14 border border-amber-500/60 text-amber-200 backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150`}>
    <Key className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
    <span className="font-medium">{kind === 'enable' ? 'Enable password prompt' : 'Password prompt'}</span>
    <button
      onClick={onSend}
      title={`Types the ${kind === 'enable' ? 'enable ' : ''}password saved in vault entry "${vaultKey}"`}
      className="px-2.5 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-meta transition shadow-xs flex items-center space-x-1"
    >
      <span>{kind === 'enable' ? 'Send enable password' : 'Send password'}</span>
    </button>
    <span className="text-meta text-amber-300/70 font-mono truncate max-w-[140px]" title={vaultKey}>{vaultKey}</span>
    <DismissButton onClick={onDismiss} />
  </div>
);

/** A password prompt while the vault is locked. */
export const VaultLockedPromptBar: React.FC<{ onUnlock: () => void; onDismiss: () => void }> = ({ onUnlock, onDismiss }) => (
  <div className={`${bar} top-3 right-14 border border-slate-600 text-slate-300`}>
    <Key className="w-3.5 h-3.5 text-slate-400" />
    <span>Password prompt. The vault is locked.</span>
    <button onClick={onUnlock} className="px-2 py-0.5 rounded border border-slate-500 text-slate-200 hover:bg-plinky-800">
      Unlock…
    </button>
    <DismissButton onClick={onDismiss} />
  </div>
);

/** Asked for the enable password with none saved: where one goes. */
export const EnableNoticeBar: React.FC<{
  noVault: boolean;
  /** Opens the session's Credentials; none for a session that isn't saved. */
  onAddOne?: () => void;
  onDismiss: () => void;
}> = ({ noVault, onAddOne, onDismiss }) => (
  <div role="status" className="absolute top-3 right-14 z-30 flex items-center gap-2 bg-plinky-900/95 border border-slate-600 text-slate-200 px-3 py-1.5 rounded-lg shadow-2xl text-xs">
    <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
    <span>{noVault ? 'No enable password saved: there is no vault yet.' : 'No enable password saved for this session.'}</span>
    {onAddOne ? (
      <button onClick={onAddOne} className="px-2 py-0.5 rounded border border-slate-500 text-slate-100 hover:bg-plinky-800">
        Add one…
      </button>
    ) : (
      <span className="text-plinky-muted">Save the session, then add one in its settings.</span>
    )}
    <DismissButton onClick={onDismiss} label />
  </div>
);
