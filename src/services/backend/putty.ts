// PuTTY itself, through the backend: finding plink, PuTTY's saved sessions
// (with their tunnels), host keys and key files. In the browser preview, demo
// data stands in.
import { PuttySession, HostKeyEntry, PpkInfo, TunnelEntry, Protocol } from '../../types/session';
import { getSessionMetadata, saveSessionFolder, saveSessionTags } from '../sessionMetadata';
import { isTauriEnvironment } from './env';

export interface PuttyDetectInfo {
  path: string | null;
  version: string | null;
  ok: boolean;
  reason: string | null;
}

// Fallback demo sessions for browser development/preview mode
const DEMO_SESSIONS: PuttySession[] = [
  {
    name: "Production Cluster Alpha",
    hostname: "192.0.2.10",
    port: 22,
    protocol: "SSH",
    username: "deploy",
    folder: "Production",
    tags: ["prod", "us-east", "primary"],
    lastConnected: Date.now() - 3600000,
  },
  {
    name: "Production Cluster Beta",
    hostname: "192.0.2.11",
    port: 22,
    protocol: "SSH",
    username: "deploy",
    folder: "Production",
    tags: ["prod", "us-east", "replica"],
    lastConnected: Date.now() - 7200000,
  },
  {
    name: "Staging Gateway",
    hostname: "192.0.2.20",
    port: 2222,
    protocol: "SSH",
    username: "admin",
    folder: "Staging",
    tags: ["staging", "bastion"],
    lastConnected: Date.now() - 86400000,
  },
  {
    name: "Edge Gateway Router",
    hostname: "192.0.2.1",
    port: 22,
    protocol: "SSH",
    username: "netops",
    folder: "Networking",
    tags: ["cisco", "core-router"],
    lastConnected: Date.now() - 172800000,
  },
  {
    name: "Switch Console USB0",
    hostname: "/dev/ttyUSB0",
    port: 9600,
    protocol: "Serial",
    folder: "Hardware",
    tags: ["serial", "console"],
    lastConnected: Date.now() - 259200000,
  },
  {
    name: "Default Settings",
    hostname: "",
    port: 22,
    protocol: "SSH",
    folder: "General",
    tags: ["default"],
  },
];

const DEMO_HOSTKEYS: HostKeyEntry[] = [
  {
    keyType: "ssh-ed25519",
    port: 22,
    hostname: "192.0.2.10",
    fingerprint: "SHA256:4t7E0k5M2ZgJ9V8W7K6L5X4Y3Z2A1B0C9D8E7F6G5H4",
    rawKey: "0x1234abcd5678ef90...",
  },
  {
    keyType: "ecdsa-sha2-nistp256",
    port: 22,
    hostname: "192.0.2.20",
    fingerprint: "SHA256:9A8B7C6D5E4F3G2H1I0J9K8L7M6N5O4P3Q2R1S0T",
    rawKey: "0xabcdef1234567890...",
  },
];

export async function detectPutty(): Promise<PuttyDetectInfo> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<PuttyDetectInfo>('putty_detect');
    } catch (e) {
      console.warn("Failed to invoke putty_detect via Tauri:", e);
    }
  }
  return {
    path: "/usr/bin/plink",
    version: "0.85",
    ok: true,
    reason: null,
  };
}


// PuTTY stores protocols lowercase ("ssh", "serial", ...). Uppercasing them
// produced "SERIAL"/"TELNET", which matched neither the Protocol type nor
// the edit modal's options -- a serial session showed a generic badge and
// opened in the editor displaying "SSH".
function canonicalProtocol(raw: unknown): Protocol {
  switch (String(raw || 'ssh').toLowerCase()) {
    case 'serial': return 'Serial';
    case 'telnet': return 'Telnet';
    case 'rlogin': return 'Rlogin';
    case 'raw': return 'RAW';
    default: return 'SSH';
  }
}

function normalizeSession(raw: any): PuttySession {
  const meta = getSessionMetadata(raw.name);
  const folder = raw.folder 
    || raw.extra?.PlinkyFolder 
    || meta?.folder 
    || 'Saved Sessions';

  let tags = raw.tags;
  if (!tags || tags.length === 0) {
    if (raw.extra?.PlinkyTags) {
      tags = raw.extra.PlinkyTags.split(',').map((t: string) => t.trim()).filter(Boolean);
    } else if (meta?.tags && meta.tags.length > 0) {
      tags = meta.tags;
    } else {
      tags = [];
    }
  }

  return {
    ...raw,
    hostname: raw.hostname || raw.host_name || '',
    host_name: raw.host_name || raw.hostname || '',
    port: raw.port || raw.port_number || 22,
    port_number: raw.port_number || raw.port || 22,
    username: raw.username || raw.user_name || '',
    user_name: raw.user_name || raw.username || '',
    publicKeyFile: raw.publicKeyFile || raw.public_key_file || '',
    public_key_file: raw.public_key_file || raw.publicKeyFile || '',
    protocol: canonicalProtocol(raw.protocol),
    extra: raw.extra || {},
    tags,
    folder,
    lastConnected: raw.lastConnected,
  };
}

export function parsePortForwardings(raw: string | undefined, sessionName: string): TunnelEntry[] {
  if (!raw || !raw.trim()) return [];
  const entries: TunnelEntry[] = [];
  const items = raw.split(',').map(s => s.trim()).filter(Boolean);
  
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const typeChar = item[0]?.toUpperCase();
    const rest = item.slice(1);
    
    if (typeChar === 'D') {
      const port = parseInt(rest.replace('=', ''), 10);
      if (port) {
        entries.push({
          id: `tunnel-${sessionName}-${i}`,
          type: 'Dynamic',
          srcPort: port,
          active: true,
          sessionName,
          bytesTransferred: 0,
        });
      }
    } else if (typeChar === 'L' || typeChar === 'R') {
      const type = typeChar === 'L' ? 'Local' : 'Remote';
      const [srcPart, destPart] = rest.split('=');
      const srcPort = parseInt(srcPart, 10);
      if (srcPort && destPart) {
        const [destHost, destPortStr] = destPart.split(':');
        const destPort = parseInt(destPortStr, 10);
        entries.push({
          id: `tunnel-${sessionName}-${i}`,
          type,
          srcPort,
          destHost: destHost || 'localhost',
          destPort: destPort || 80,
          active: true,
          sessionName,
          bytesTransferred: 0,
        });
      }
    }
  }
  return entries;
}

export function serializePortForwardings(entries: TunnelEntry[]): string {
  const parts: string[] = [];
  for (const t of entries) {
    if (!t.active) continue;
    if (t.type === 'Dynamic') {
      parts.push(`D${t.srcPort}`);
    } else if (t.type === 'Local') {
      parts.push(`L${t.srcPort}=${t.destHost || 'localhost'}:${t.destPort || 80}`);
    } else if (t.type === 'Remote') {
      parts.push(`R${t.srcPort}=${t.destHost || '127.0.0.1'}:${t.destPort || 80}`);
    }
  }
  return parts.join(',');
}

export async function listPuttySessions(): Promise<PuttySession[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const rawList = await invoke<any[]>('list_putty_sessions');
      return rawList.map(normalizeSession);
    } catch (e) {
      console.warn("Failed to invoke Tauri list_putty_sessions, using fallback:", e);
      return DEMO_SESSIONS.map(normalizeSession);
    }
  }
  // Browser preview mode
  return DEMO_SESSIONS.map(normalizeSession);
}

export async function readPuttySession(name: string): Promise<PuttySession | null> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<any>('read_putty_session', { name });
      return raw ? normalizeSession(raw) : null;
    } catch (e) {
      console.warn(`Failed to read session ${name} via Tauri:`, e);
      const found = DEMO_SESSIONS.find(s => s.name === name);
      return found ? normalizeSession(found) : null;
    }
  }
  const found = DEMO_SESSIONS.find(s => s.name === name);
  return found ? normalizeSession(found) : null;
}

export async function writePuttySession(session: PuttySession): Promise<boolean> {
  const extra = { ...(session.extra || {}) };
  if (session.folder) {
    extra.PlinkyFolder = session.folder;
    saveSessionFolder(session.name, session.folder);
  }
  if (session.tags && session.tags.length > 0) {
    extra.PlinkyTags = session.tags.join(',');
    saveSessionTags(session.name, session.tags);
  } else {
    // extra is copied from the session being edited, so a stale PlinkyTags
    // survived clearing every tag and the tags came straight back.
    delete extra.PlinkyTags;
    saveSessionTags(session.name, []);
  }

  const payload = {
    name: session.name,
    host_name: session.hostname || session.host_name || '',
    port_number: session.port || session.port_number || 22,
    user_name: session.username || session.user_name || '',
    protocol: (session.protocol || 'ssh').toLowerCase(),
    public_key_file: session.publicKeyFile || session.public_key_file || '',
    // First-class field on the Rust side, not part of extra. Omitting it
    // deserialized as "" and rewrote the session file with an empty
    // LogFileName=, wiping a real PuTTY session's logging setting on any edit.
    log_file_name: session.log_file_name || '',
    extra,
  };
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_putty_session', { session: payload });
      return true;
    } catch (e) {
      console.error("Failed to write session via Tauri:", e);
      return false;
    }
  }
  const idx = DEMO_SESSIONS.findIndex(s => s.name === session.name);
  if (idx >= 0) {
    DEMO_SESSIONS[idx] = normalizeSession({ ...session, ...payload, folder: session.folder, tags: session.tags });
  } else {
    DEMO_SESSIONS.push(normalizeSession({ ...session, ...payload, folder: session.folder, tags: session.tags }));
  }
  return true;
}

/**
 * Moves sessions between folders in one all-or-nothing save: a folder
 * rename or move rewrites every session under it. Throws with the backend's
 * message when nothing (or, if a rollback also failed, not everything) was
 * saved. The sidecar mirror is only updated once PuTTY's store has changed.
 */
/** Deletes a saved session. Vault entries and open tabs are left alone. */
export async function deletePuttySession(name: string): Promise<void> {
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('delete_putty_session', { name });
  } else {
    const i = DEMO_SESSIONS.findIndex(s => s.name === name);
    if (i < 0) throw new Error(`Session not found: ${name}`);
    DEMO_SESSIONS.splice(i, 1);
  }
}

/** "web-1 (copy)", then "web-1 (copy 2)", ..., free among `taken`. */
export function copyName(name: string, taken: string[]): string {
  const base = `${name} (copy)`;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const next = `${name} (copy ${n})`;
    if (!taken.includes(next)) return next;
  }
}

export async function setSessionFolders(changes: [string, string][]): Promise<void> {
  if (changes.length === 0) return;
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_session_folders', { changes });
  } else {
    const missing = changes.find(([name]) => !DEMO_SESSIONS.some(s => s.name === name));
    if (missing) throw new Error(`Session not found: ${missing[0]}`);
    for (const [name, folder] of changes) {
      const idx = DEMO_SESSIONS.findIndex(s => s.name === name);
      const s = DEMO_SESSIONS[idx];
      DEMO_SESSIONS[idx] = { ...s, folder, extra: { ...(s.extra || {}), PlinkyFolder: folder } };
    }
  }
  for (const [name, folder] of changes) saveSessionFolder(name, folder);
}

export async function listPuttyHostKeys(): Promise<HostKeyEntry[]> {
  if (isTauriEnvironment()) {
    // No fallback to the demo keys here: on a trust screen, made-up keys
    // after a failed read would be worse than the error.
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<HostKeyEntry[]>('list_putty_hostkeys');
  }
  return DEMO_HOSTKEYS;
}

/** Forgets a cached host key; true if it was there. */
/** Opens the Host Keys screen, optionally filtered to one host. */
export const SHOW_HOST_KEYS_EVENT = 'plinky:show-host-keys';
export function showHostKeys(host?: string) {
  window.dispatchEvent(new CustomEvent<{ host?: string }>(SHOW_HOST_KEYS_EVENT, { detail: { host } }));
}

export async function removePuttyHostKey(keyType: string, hostname: string, port: number): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<boolean>('remove_putty_hostkey', { keyType, hostname, port });
}

/** Opens a file picker for a .ppk; null if cancelled or outside the app. */
export async function pickPpkFile(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('pick_ppk_file');
}

export async function inspectPpk(path: string): Promise<PpkInfo | null> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // The backend's names (algo, encrypted, fingerprint) differ from the
      // page's; unmapped, the banner showed "undefined" for all three.
      const raw = await invoke<{ version: number; algo: string; encrypted: boolean; comment: string; fingerprint: string }>('inspect_ppk', { path });
      return { path, version: raw.version, algorithm: raw.algo, isEncrypted: raw.encrypted, comment: raw.comment, fingerprintSha256: raw.fingerprint };
    } catch (e) {
      console.warn("Failed to inspect ppk via Tauri:", e);
      return null;
    }
  }
  return {
    path,
    version: 3,
    algorithm: "ssh-ed25519",
    isEncrypted: false,
    comment: "imported-key-preview",
    fingerprintSha256: "SHA256:7u8I9O0P1Q2W3E4R5T6Y7U8I9O0P1Q2W3E4R5T6Y",
  };
}
