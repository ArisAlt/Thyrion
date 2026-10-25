import React from 'react';
import { Folder, Tag, Cpu, RefreshCw } from 'lucide-react';
import { PuttySession, Protocol } from '../../../types/session';
import { DetectedSerialPort } from '../../../services/tauriBridge';
import { TAB_COLORS } from '../../../services/tabColors';
import { Setter } from './types';

/** Each protocol's usual port, as PuTTY fills it in. */
const DEFAULT_PORT: Partial<Record<Protocol, number>> = { SSH: 22, Telnet: 23, Rlogin: 513 };

/** Session settings > General: the protocol, where to connect, the name,
 *  folder, tags and tab colour. */
export const GeneralTab: React.FC<{
  protocol: Protocol;
  setProtocol: Setter<Protocol>;
  port: string;
  setPort: Setter<string>;
  hostname: string;
  setHostname: Setter<string>;
  name: string;
  setName: Setter<string>;
  nameError: string | null;
  setNameError: Setter<string | null>;
  editingSession: PuttySession | null | undefined;
  folder: string;
  setFolder: Setter<string>;
  tags: string;
  setTags: Setter<string>;
  tabColor: string;
  setTabColor: Setter<string>;
  serialPorts: DetectedSerialPort[];
  refreshPorts: () => void;
  isRefreshingPorts: boolean;
  serialLine: string;
  setSerialLine: Setter<string>;
  isCustomSerialLine: boolean;
  setIsCustomSerialLine: Setter<boolean>;
  serialSpeed: string;
  setSerialSpeed: Setter<string>;
}> = ({
  protocol, setProtocol, port, setPort, hostname, setHostname, name, setName, nameError,
  setNameError, editingSession, folder, setFolder, tags, setTags, tabColor, setTabColor,
  serialPorts, refreshPorts, isRefreshingPorts, serialLine, setSerialLine, isCustomSerialLine,
  setIsCustomSerialLine, serialSpeed, setSerialSpeed,
}) => {
  const isSerial = protocol === 'Serial';

  return (
    <>
      {/* Protocol Selection */}
      <div className="space-y-1">
        <label htmlFor="new-session-modal-connection-protocol" className="text-slate-300 font-medium">Connection Protocol</label>
        <select id="new-session-modal-connection-protocol"
          value={protocol}
          onChange={e => {
            const nextProto = e.target.value as Protocol;
            // The port follows the protocol while it is still the old
            // one's default: a Telnet copy switched to SSH kept 23.
            const was = DEFAULT_PORT[protocol];
            const next = DEFAULT_PORT[nextProto];
            if (next && (!port.trim() || (was && port.trim() === String(was)))) setPort(String(next));
            setProtocol(nextProto);
            if (nextProto === 'Serial') {
              if (serialPorts.length > 0 && !serialLine) {
                const firstUsb = serialPorts.find(p => p.is_usb);
                setSerialLine(firstUsb ? firstUsb.port_name : serialPorts[0].port_name);
              }
            }
          }}
          className="w-full bg-plinky-950 border border-plinky-700 rounded px-2 py-1.5 text-slate-100 focus:outline-none focus:border-sky-500"
        >
          <option value="SSH">SSH (Secure Shell)</option>
          <option value="Serial">Serial (USB / COM Port)</option>
          <option value="Telnet">Telnet</option>
          <option value="Rlogin">Rlogin</option>
          <option value="RAW">RAW</option>
        </select>
      </div>

      {/* SERIAL PROTOCOL FIELDS */}
      {isSerial ? (
        <div className="p-3 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-3">
          <div className="flex items-center space-x-2 text-slate-300 font-medium pb-1 border-b border-plinky-800">
            <Cpu className="w-3.5 h-3.5 text-slate-400" />
            <span>Serial Port & Hardware Line Settings</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 text-meta">Serial Line (COM / USB Port) *</label>
                <button
                  type="button"
                  onClick={refreshPorts}
                  title="Scan for plugged-in USB and serial devices"
                  className="text-slate-400 hover:text-sky-400 flex items-center space-x-1 text-meta transition"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${isRefreshingPorts ? 'animate-spin text-sky-400' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>
              {isCustomSerialLine ? (
                <div className="flex items-center space-x-1">
                  <input
                    type="text"
                    required
                    aria-label="Serial line"
                    placeholder="/dev/ttyUSB0 or COM3"
                    value={serialLine}
                    onChange={e => setSerialLine(e.target.value)}
                    className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={() => setIsCustomSerialLine(false)}
                    className="px-2 py-1 rounded bg-plinky-800 text-slate-300 hover:bg-plinky-700 text-meta"
                  >
                    List
                  </button>
                </div>
              ) : (
                <select
                  aria-label="Serial line"
                  value={serialLine}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setIsCustomSerialLine(true);
                    } else {
                      setSerialLine(e.target.value);
                    }
                  }}
                  className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                >
                  {/* Every detected port is plugged in right now (●). A
                      saved port that isn't gets its own entry (○): with
                      no matching option the select showed some other
                      port while still saving this one. */}
                  {serialLine && !serialPorts.some(p => p.port_name === serialLine) && (
                    <option value={serialLine}>{`○ ${serialLine} (not connected)`}</option>
                  )}
                  {serialPorts.length === 0 ? (
                    <option value="" disabled>No serial devices detected</option>
                  ) : (
                    serialPorts.map(p => (
                      <option key={p.port_name} value={p.port_name}>
                        {`● ${p.display_name}`}
                      </option>
                    ))
                  )}
                  <option value="__custom__">Manual path / Custom COM port...</option>
                </select>
              )}
            </div>

            <div className="space-y-1">
              <label htmlFor="new-session-modal-speed-baud" className="text-slate-300 text-meta">Speed (Baud)</label>
              <select id="new-session-modal-speed-baud"
                value={serialSpeed}
                onChange={e => setSerialSpeed(e.target.value)}
                className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="9600">9600</option>
                <option value="19200">19200</option>
                <option value="38400">38400</option>
                <option value="57600">57600</option>
                <option value="115200">115200 (Network)</option>
                <option value="230400">230400</option>
                <option value="921600">921600</option>
              </select>
            </div>
          </div>

        </div>
      ) : (
        /* NETWORK PROTOCOL FIELDS (SSH / Telnet / RAW / Rlogin) */
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label htmlFor="new-session-modal-host-name-or-ip-address" className="text-slate-300 font-medium">Host Name or IP Address *</label>
              <input id="new-session-modal-host-name-or-ip-address"
                type="text"
                required
                placeholder="192.0.2.10 or router.internal"
                value={hostname}
                onChange={e => setHostname(e.target.value)}
                className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-plinky-muted font-mono focus:outline-none focus:border-sky-500"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="new-session-modal-port" className="text-slate-300 font-medium">Port</label>
              <input id="new-session-modal-port"
                type="number"
                value={port}
                onChange={e => setPort(e.target.value)}
                className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 font-mono focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
          {(protocol === 'Telnet' || protocol === 'RAW') && port.trim() === '22' && (
            <div role="status" className="flex items-center justify-between gap-2 p-2 rounded border border-amber-500/40 bg-amber-950/30 text-amber-300 text-meta">
              <span>Port 22 is SSH's port. A {protocol === 'RAW' ? 'Raw' : 'Telnet'} session there gets the SSH greeting and is closed.</span>
              <button
                type="button"
                onClick={() => setProtocol('SSH')}
                className="shrink-0 px-2 py-0.5 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
              >
                Use SSH
              </button>
            </div>
          )}
        </>
      )}

      {/* Session name: after the host, as in PuTTY */}
      <div className="space-y-1">
        <label htmlFor="new-session-modal-session-name" className="text-slate-300 font-medium">Session name</label>
        <input id="new-session-modal-session-name"
          type="text"
          placeholder={(isSerial ? serialLine.trim() : hostname.trim()) || (isSerial ? 'e.g. core-sw1 console' : 'Defaults to the host name')}
          value={name}
          onChange={e => { setName(e.target.value); setNameError(null); }}
          className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-plinky-muted focus:outline-none focus:border-sky-500"
        />
        {nameError && (
          <p role="alert" className="text-rose-400 text-meta">{nameError}</p>
        )}
        {editingSession && name.trim() !== editingSession.name && (
          <p className="text-amber-400 text-meta">
            Changing the name saves a new session. "{editingSession.name}" stays as it is.
          </p>
        )}
      </div>

      {/* Organization & Tags */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="new-session-modal-folder-category" className="text-slate-300 font-medium flex items-center space-x-1">
            <Folder className="w-3.5 h-3.5 text-sky-400" />
            <span>Folder Category</span>
          </label>
          <input id="new-session-modal-folder-category"
            type="text"
            placeholder="e.g. Staging or Network"
            value={folder}
            onChange={e => setFolder(e.target.value)}
            className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-plinky-muted focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="new-session-modal-tags-comma-separated" className="text-slate-300 font-medium flex items-center space-x-1">
            <Tag className="w-3.5 h-3.5 text-slate-400" />
            <span>Tags (comma-separated)</span>
          </label>
          <input id="new-session-modal-tags-comma-separated"
            type="text"
            placeholder="cisco, core, serial, lab"
            value={tags}
            onChange={e => setTags(e.target.value)}
            className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-plinky-muted focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Tab colour (tabColors.ts) */}
      <div className="space-y-1">
        <span className="text-slate-300 font-medium">Tab colour</span>
        <div role="radiogroup" aria-label="Tab colour" className="flex items-center space-x-1.5">
          <button
            type="button"
            role="radio"
            aria-checked={tabColor === ''}
            onClick={() => setTabColor('')}
            className={`px-2 py-0.5 rounded border text-meta ${tabColor === '' ? 'border-sky-500 text-sky-300' : 'border-plinky-700 text-slate-400'}`}
          >
            None
          </button>
          {TAB_COLORS.map(c => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={tabColor === c.id}
              aria-label={c.label}
              title={c.label}
              onClick={() => setTabColor(c.id)}
              style={{ backgroundColor: c.hex }}
              className={`w-5 h-5 rounded-full border-2 ${tabColor === c.id ? 'border-white' : 'border-transparent'}`}
            />
          ))}
        </div>
        <p className="text-meta text-plinky-muted">Marks this session's tabs and its row in the list, for example red for production.</p>
      </div>
    </>
  );
};
