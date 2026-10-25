import React from 'react';
import { X } from 'lucide-react';
import { Protocol } from '../../../types/session';
import { LogonAction } from '../../../services/tabColors';
import { LOGON_PRESETS, withPreset } from '../../../services/logonPresets';
import { MAX_PASTE_LINE_DELAY_MS } from '../../../services/appEvents';
import { Setter, AutoLog } from './types';

/** Session settings > Advanced: keepalives and reconnecting, logging, the
 *  paste line delay and logon actions. */
export const AdvancedTab: React.FC<{
  protocol: Protocol;
  name: string;
  hostname: string;
  folder: string;
  keepalive: string;
  setKeepalive: Setter<string>;
  tcpKeepalives: boolean;
  setTcpKeepalives: Setter<boolean>;
  autoReconnect: boolean;
  setAutoReconnect: Setter<boolean>;
  autoLog: AutoLog;
  setAutoLog: Setter<AutoLog>;
  pasteDelay: string;
  setPasteDelay: Setter<string>;
  logonActions: LogonAction[];
  setLogonActions: Setter<LogonAction[]>;
}> = ({
  protocol, name, hostname, folder, keepalive, setKeepalive, tcpKeepalives, setTcpKeepalives,
  autoReconnect, setAutoReconnect, autoLog, setAutoLog, pasteDelay, setPasteDelay,
  logonActions, setLogonActions,
}) => {
  const isSerial = protocol === 'Serial';

  return (
    <>
      {/* Connection (T-016): keepalives + auto-reconnect */}
      {!isSerial && (
        <div className="p-2.5 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-1.5 text-meta">
          <div className="text-slate-300 font-medium">Connection</div>
          <label className="flex items-center justify-between space-x-2">
            <span className="text-slate-300">Send keepalives every</span>
            <span className="flex items-center space-x-1.5">
              <input
                type="number"
                min={0}
                step={5}
                value={keepalive}
                onChange={e => setKeepalive(e.target.value)}
                placeholder="0"
                aria-label="Keepalive interval in seconds"
                className="w-20 bg-plinky-900 border border-plinky-700 rounded px-2 py-0.5 text-slate-100 text-xs text-right focus:outline-none focus:border-sky-500"
              />
              <span className="text-plinky-muted">s (0 = off)</span>
            </span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input type="checkbox" checked={tcpKeepalives} onChange={e => setTcpKeepalives(e.target.checked)} />
            <span className="text-slate-300">TCP keepalives</span>
          </label>
          <label className="flex items-start space-x-2 cursor-pointer">
            <input type="checkbox" checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} className="mt-0.5" />
            <span className="text-slate-300">
              Reconnect automatically if the connection drops
              <span className="block text-plinky-muted">Not after you type exit or a login fails. Tries 5 times, waiting longer each time.</span>
            </span>
          </label>
        </div>
      )}

      {/* Automatic log (session/autolog.rs) */}
      <div className="p-2.5 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-1 text-meta">
        <label className="flex items-center justify-between space-x-2">
          <span className="text-slate-300 font-medium">Log this session</span>
          <select
            value={autoLog}
            onChange={e => setAutoLog(e.target.value as typeof autoLog)}
            aria-label="Log this session"
            className="bg-plinky-900 border border-plinky-700 rounded px-2 py-0.5 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
          >
            <option value="global">As in Settings</option>
            <option value="always">Always</option>
            <option value="never">Never</option>
          </select>
        </label>
        <p className="text-plinky-muted">
          Each connection is saved to its own file, in Settings' log folder under this session's folder and
          name: {(folder.trim() || 'Saved Sessions')}/{(name.trim() || hostname.trim() || 'session')}/date_time.log.
        </p>
      </div>

      {/* Paste line delay (T-015) */}
      <div className="p-2.5 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-1 text-meta">
        <label className="flex items-center justify-between space-x-2">
          <span className="text-slate-300 font-medium">Paste line delay</span>
          <span className="flex items-center space-x-1.5">
            <input
              type="number"
              min={0}
              max={MAX_PASTE_LINE_DELAY_MS}
              step={50}
              value={pasteDelay}
              onChange={e => setPasteDelay(e.target.value)}
              placeholder="0"
              aria-label="Paste line delay in milliseconds"
              className="w-20 bg-plinky-900 border border-plinky-700 rounded px-2 py-0.5 text-slate-100 text-xs text-right focus:outline-none focus:border-sky-500"
            />
            <span className="text-plinky-muted">ms</span>
          </span>
        </label>
        <p className="text-plinky-muted">
          Sends a multi-line paste one line at a time, this far apart, for console ports and network gear that
          drop characters. 0 pastes normally. Up to {MAX_PASTE_LINE_DELAY_MS} ms.
        </p>
      </div>

      {/* Logon actions (expect.rs logon_actions) */}
      <div className="p-2.5 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-1.5 text-meta">
        <div className="text-slate-300 font-medium">Logon actions</div>
        <p className="text-plinky-muted">
          Typed once the login is over, in order: wait until the output ends with the text on the left, then send
          the line on the right. Leave "wait for" empty to wait for any prompt (# &gt; $ %).
          Not for passwords: they are saved in the session file as plain text. Use the vault.
        </p>
        {logonActions.map((a, i) => (
          <div key={i} className="flex items-center space-x-1.5">
            <input
              value={a.wait}
              onChange={e => setLogonActions(list => list.map((x, j) => (j === i ? { ...x, wait: e.target.value } : x)))}
              placeholder="#"
              aria-label={`Logon action ${i + 1}: wait for`}
              className="w-24 bg-plinky-900 border border-plinky-700 rounded px-2 py-0.5 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
            />
            <span className="text-plinky-muted">then send</span>
            <input
              value={a.send}
              onChange={e => setLogonActions(list => list.map((x, j) => (j === i ? { ...x, send: e.target.value } : x)))}
              placeholder="terminal length 0"
              aria-label={`Logon action ${i + 1}: send`}
              className="flex-1 min-w-0 bg-plinky-900 border border-plinky-700 rounded px-2 py-0.5 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={() => setLogonActions(list => list.filter((_, j) => j !== i))}
              aria-label={`Remove logon action ${i + 1}`}
              className="p-1 text-plinky-muted hover:text-rose-400"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLogonActions(list => [...list, { wait: '#', send: '' }])}
            className="px-2 py-0.5 rounded bg-plinky-800 hover:bg-plinky-700 text-slate-300"
          >
            Add a logon action
          </button>
          {/* The commands a platform needs so output isn't paged (logonPresets.ts). */}
          <select
            value=""
            onChange={e => { const id = e.target.value; if (id) setLogonActions(list => withPreset(list, id)); }}
            aria-label="Add the commands for a platform"
            className="bg-plinky-900 border border-plinky-700 rounded px-1.5 py-0.5 text-slate-300 text-xs focus:outline-none focus:border-sky-500"
          >
            <option value="">Add for a platform…</option>
            {LOGON_PRESETS.map(p => (
              <option key={p.id} value={p.id}>{p.label}: {p.commands.join(', ')}</option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
};
