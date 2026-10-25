import React from 'react';
import { List, FileText, X, CopyCheck } from 'lucide-react';

// The terminal's two log windows: PuTTY's Event Log (what Thyrion did for
// this session) and Session Logging (the session's output, to a file).

export interface PuTTYEventLog {
  id: string;
  time: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
}

/** Adds a line to a terminal's event log. */
export type AddEventLog = (message: string, level?: PuTTYEventLog['level']) => void;

const levelClass = (level: PuTTYEventLog['level']) =>
  level === 'error' ? 'text-rose-400'
    : level === 'warn' ? 'text-amber-400'
    : level === 'success' ? 'text-emerald-400 font-medium'
    : 'text-slate-300';

export const EventLogDialog: React.FC<{
  sessionName: string;
  logs: PuTTYEventLog[];
  onCopyAll: () => void;
  onClear: () => void;
  onClose: () => void;
}> = ({ sessionName, logs, onCopyAll, onClear, onClose }) => (
  <div className="absolute inset-0 z-50 flex items-center justify-center bg-plinky-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
    <div className="bg-plinky-900 border border-plinky-700 rounded-xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[80vh] overflow-hidden text-slate-100">
      <div className="px-4 py-3 bg-plinky-950 border-b border-plinky-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <List className="w-4 h-4 text-slate-400" />
          <span className="font-semibold text-sm">Event Log: {sessionName}</span>
        </div>
        <button aria-label="Close event log"
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-plinky-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-slate-950/90 font-mono text-meta space-y-1 select-text">
        {logs.length === 0 ? (
          <div className="text-plinky-muted italic">No events logged yet.</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex space-x-2 leading-relaxed">
              <span className="text-plinky-muted select-none">[{log.time}]</span>
              <span className={levelClass(log.level)}>{log.message}</span>
            </div>
          ))
        )}
      </div>

      <div className="p-3 bg-plinky-950 border-t border-plinky-800 flex items-center justify-between">
        <button
          onClick={onCopyAll}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
        >
          <CopyCheck className="w-3.5 h-3.5 text-slate-400" />
          <span>Copy All to Clipboard</span>
        </button>

        <div className="flex space-x-2">
          <button
            onClick={onClear}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-xs transition"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-sky-700 hover:brightness-110 text-on-accent text-xs font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
);

export const SessionLogDialog: React.FC<{
  isLogging: boolean;
  loggedBytes: number;
  path: string | null;
  error: string | null;
  onCopyPath: () => void;
  onToggle: () => void;
  onClose: () => void;
}> = ({ isLogging, loggedBytes, path, error, onCopyPath, onToggle, onClose }) => (
  <div className="absolute inset-0 z-50 flex items-center justify-center bg-plinky-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
    <div className="bg-plinky-900 border border-plinky-700 rounded-xl shadow-2xl max-w-md w-full flex flex-col overflow-hidden text-slate-100">
      <div className="px-4 py-3 bg-plinky-950 border-b border-plinky-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <FileText className="w-4 h-4 text-slate-400" />
          <span className="font-semibold text-sm">Session Log</span>
        </div>
        <button aria-label="Close logging"
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-plinky-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4 text-xs">
        {/* Status Bar */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-plinky-950 border border-plinky-800">
          <div className="flex items-center space-x-2">
            <span className={`h-2.5 w-2.5 rounded-full ${isLogging ? 'bg-rose-500' : 'bg-slate-600'}`}></span>
            <span className="font-semibold text-slate-200">
              {isLogging ? 'Logging is ACTIVE' : 'Logging is STOPPED'}
            </span>
          </div>
          <span className="font-mono text-slate-400">
            {(loggedBytes / 1024).toFixed(1)} KB logged
          </span>
        </div>

        <p className="text-slate-400">
          Saves what you see on screen as plain text, without colour or cursor codes.
        </p>

        {path && (
          <div className="space-y-1">
            <label className="text-slate-400 font-medium">Saving to</label>
            <div className="flex items-center space-x-2">
              <code className="flex-1 min-w-0 truncate p-1.5 rounded bg-plinky-950 border border-plinky-800 text-slate-300 font-mono text-meta" title={path}>
                {path}
              </code>
              <button
                onClick={onCopyPath}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                Copy path
              </button>
            </div>
          </div>
        )}
        {error && (
          <div role="alert" className="p-2 rounded border border-rose-500/40 bg-rose-950/40 text-rose-300 text-meta">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-plinky-800">
          <button
            onClick={onToggle}
            className={`px-3 py-1.5 rounded font-medium transition ${
              isLogging
                ? 'bg-rose-600 hover:bg-rose-500 text-on-danger'
                : 'bg-sky-700 hover:brightness-110 text-on-accent'
            }`}
          >
            {isLogging ? 'Stop Logging' : 'Start Logging…'}
          </button>
          <span className="text-plinky-muted text-meta">
            {isLogging ? 'Written to disk as it arrives.' : 'Asks where to save, then writes as output arrives.'}
          </span>
        </div>
      </div>
    </div>
  </div>
);
