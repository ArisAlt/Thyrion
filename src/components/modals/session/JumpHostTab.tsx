import React from 'react';
import { Shield, Server, Laptop, ArrowRight, Trash2 } from 'lucide-react';
import { PuttySession, Protocol } from '../../../types/session';
import { Setter } from './types';

const HOP_PRESETS: { label: string; command: string }[] = [
  { label: 'NX-OS / Linux', command: 'ssh {user}@{host}' },
  { label: 'IOS / IOS-XE', command: 'ssh -l {user} {host}' },
  { label: 'Telnet', command: 'telnet {host}' },
];

/** Session settings > Jump Host (SSH only): a bastion's SSH tunnel, or a
 *  router's command line, on the way to this device. */
export const JumpHostTab: React.FC<{
  protocol: Protocol;
  name: string;
  hostname: string;
  savedSessions: PuttySession[];
  hadJumpHost: boolean;
  enableJumpHost: boolean;
  setEnableJumpHost: Setter<boolean>;
  jumpMode: 'tunnel' | 'cli';
  setJumpMode: Setter<'tunnel' | 'cli'>;
  jumpCommand: string;
  setJumpCommand: Setter<string>;
  jumpPreset: string | null;
  setJumpPreset: Setter<string | null>;
  jumpHost: string;
  setJumpHost: Setter<string>;
  jumpPort: string;
  setJumpPort: Setter<string>;
  jumpUsername: string;
  setJumpUsername: Setter<string>;
  jumpPassword: string;
  setJumpPassword: Setter<string>;
  jumpVaultKey: string | null;
}> = ({
  protocol, name, hostname, savedSessions, hadJumpHost, enableJumpHost, setEnableJumpHost,
  jumpMode, setJumpMode, jumpCommand, setJumpCommand, jumpPreset, setJumpPreset, jumpHost,
  setJumpHost, jumpPort, setJumpPort, jumpUsername, setJumpUsername, jumpPassword,
  setJumpPassword, jumpVaultKey,
}) => {
  return (
    <>
      {/* MOBAXTERM-STYLE JUMP HOST / SSH GATEWAY (SSH Only) */}
      {protocol === 'SSH' && (
        <div className="p-3 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableJumpHost}
                onChange={e => setEnableJumpHost(e.target.checked)}
                className="rounded border-plinky-700 text-sky-500 focus:ring-0 bg-plinky-900"
              />
              <span className="text-slate-200 font-medium flex items-center space-x-1.5">
                <Shield className="w-3.5 h-3.5 text-sky-400" />
                <span>Connect through SSH Jump Host (Gateway / Bastion)</span>
              </span>
            </label>
            {hadJumpHost && enableJumpHost && (
              <button
                type="button"
                onClick={() => {
                  setEnableJumpHost(false);
                  setJumpPreset(null);
                  setJumpHost('');
                  setJumpPort('22');
                  setJumpUsername('');
                  setJumpPassword('');
                }}
                className="flex items-center space-x-1 px-2 py-0.5 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-meta shrink-0"
              >
                <Trash2 className="w-3 h-3" />
                <span>Remove Jump Host</span>
              </button>
            )}
          </div>
          {hadJumpHost && !enableJumpHost && (
            <p role="status" className="text-amber-300/90 text-meta">
              The jump host will be removed when you save. This session will then connect directly.
            </p>
          )}

          {enableJumpHost && (
            <div className="space-y-2.5 pt-1 border-t border-plinky-800/80 animate-in fade-in duration-150">
              <fieldset className="space-y-1.5">
                <legend className="text-slate-300 text-meta mb-1">How the jump host reaches this device</legend>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {([
                    ['tunnel', 'SSH tunnel', 'A Linux bastion forwards the connection (PuTTY proxy).'],
                    ['cli', 'Device command line', 'Router or switch: log in, then type the hop command at its prompt.'],
                  ] as const).map(([id, title, note]) => (
                    <label key={id} className={`flex flex-col gap-0.5 p-2 rounded border cursor-pointer ${
                      jumpMode === id ? 'border-sky-500/60 bg-sky-500/10' : 'border-plinky-700 hover:border-plinky-600'
                    }`}>
                      <span className="flex items-center gap-1.5 font-medium text-slate-200">
                        <input type="radio" name="jump-mode" value={id} checked={jumpMode === id}
                          onChange={() => setJumpMode(id)} className="text-sky-500 focus:ring-0 bg-plinky-900" />
                        {title}
                      </span>
                      <span className="text-meta text-slate-400">{note}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {jumpMode === 'cli' && (
                <div className="space-y-1">
                  <label htmlFor="new-session-modal-hop-command" className="text-slate-300 text-meta">Hop command, typed at the jump device's prompt</label>
                  <input id="new-session-modal-hop-command"
                    type="text"
                    autoComplete="off"
                    value={jumpCommand}
                    onChange={e => setJumpCommand(e.target.value)}
                    className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 text-meta">
                    {HOP_PRESETS.map(p => (
                      <button key={p.label} type="button" onClick={() => setJumpCommand(p.command)}
                        className={`px-1.5 py-0.5 rounded border ${jumpCommand === p.command ? 'border-sky-500/60 text-sky-300' : 'border-plinky-700 text-slate-400 hover:text-slate-200'}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-meta text-plinky-muted leading-relaxed">
                    <code className="text-slate-400">{'{user}'}</code>, <code className="text-slate-400">{'{host}'}</code> and{' '}
                    <code className="text-slate-400">{'{port}'}</code> are this session's (General tab). With the vault unlocked,
                    Thyrion types the jump device's password, this command, then this session's password; the second
                    device's host key is checked by the jump device, not PuTTY.
                  </p>
                </div>
              )}
              {/* Visual Topology Route Banner (MobaXterm Style) */}
              <div className="p-2 rounded bg-plinky-900/90 border border-sky-500/30 flex items-center justify-between text-meta">
                <div className="flex items-center space-x-1">
                  <Laptop className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="text-slate-400">Client</span>
                </div>
                <div className="flex items-center space-x-1 text-plinky-muted">
                  <div className="h-px w-4 bg-sky-500/50" />
                  <span className="text-meta text-sky-400 uppercase font-semibold">SSH</span>
                  <ArrowRight className="w-3 h-3 text-sky-400" />
                </div>
                <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-sky-950/80 border border-sky-500/50">
                  <Shield className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-slate-200 font-mono font-medium truncate max-w-[160px]" title={jumpHost || 'Jump Host'}>
                    {jumpHost.trim() ? (jumpUsername ? `${jumpUsername}@${jumpHost}` : jumpHost) : 'Bastion'}
                  </span>
                </div>
                <div className="flex items-center space-x-1 text-plinky-muted">
                  <div className="h-px w-4 bg-sky-500/50" />
                  <span className="text-meta text-sky-400 uppercase font-semibold">SSH</span>
                  <ArrowRight className="w-3 h-3 text-slate-400" />
                </div>
                <div className="flex items-center space-x-1">
                  <Server className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="text-sky-200 font-mono font-medium truncate max-w-[150px]" title={hostname || 'Target'}>
                    {hostname.trim() || 'Target'}
                  </span>
                </div>
              </div>

              {/* Preset from existing saved sessions */}
              {savedSessions.length > 0 && (
                <div className="space-y-1">
                  <label htmlFor="new-session-modal-populate-from-saved-session" className="text-slate-400 text-meta">Populate from Saved Session</label>
                  <select id="new-session-modal-populate-from-saved-session"
                    onChange={e => {
                      const sess = savedSessions.find(s => s.name === e.target.value);
                      if (sess) {
                        setJumpPreset(sess.name);
                        setJumpHost(sess.hostname);
                        setJumpPort(String(sess.port || 22));
                        setJumpUsername(sess.username || '');
                      }
                    }}
                    value={jumpPreset ?? ''}
                    className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="" disabled>-- Select a saved bastion host --</option>
                    {savedSessions.filter(s => s.protocol === 'SSH' && s.name !== name).map(s => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.hostname}:{s.port})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <label htmlFor="new-session-modal-jump-host-gateway-ip" className="text-slate-300 text-meta">Jump Host / Gateway IP *</label>
                  <input id="new-session-modal-jump-host-gateway-ip"
                    type="text"
                    required={enableJumpHost}
                    placeholder="bastion.internal or jump.corp.com"
                    value={jumpHost}
                    onChange={e => { setJumpPreset(null); setJumpHost(e.target.value); }}
                    className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="new-session-modal-port-2" className="text-slate-300 text-meta">Port</label>
                  <input id="new-session-modal-port-2"
                    type="number"
                    value={jumpPort}
                    onChange={e => { setJumpPreset(null); setJumpPort(e.target.value); }}
                    className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="new-session-modal-gateway-username" className="text-slate-300 text-meta">Gateway Username</label>
                <input id="new-session-modal-gateway-username"
                  type="text"
                  placeholder="bastion_user"
                  value={jumpUsername}
                  onChange={e => { setJumpPreset(null); setJumpUsername(e.target.value); }}
                  className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              {jumpPreset ? (
                <p className="text-plinky-muted text-meta">
                  Logs in to the gateway with the vault password saved for "{jumpPreset}", if it has one.
                </p>
              ) : (
                <div className="space-y-1">
                  <label className="text-slate-300 text-meta">Gateway Password (saved in the vault)</label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    aria-label="Gateway Password"
                    placeholder={jumpVaultKey ? '(stored in the vault; blank keeps it)' : 'optional: leave blank to type it at connect'}
                    value={jumpPassword}
                    onChange={e => setJumpPassword(e.target.value)}
                    className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                  />
                  <p className="text-plinky-muted text-meta">
                    Sent only at {jumpUsername.trim() || '<user>'}@{jumpHost.trim() || '<gateway>'}'s password prompt, once.
                    The target then logs in with this session's own vault password (Credentials &amp; Vault).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
};
