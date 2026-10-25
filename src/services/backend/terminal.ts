// A terminal session's life, through the backend: starting it (also in the
// background), attaching to it, typing, resizing, acknowledging its output,
// closing it, its host-key prompt, paced pastes, Break, broadcast input,
// read-only tabs, shell integration and serial ports.
import { isTauriEnvironment } from './env';

export interface AttachInfo {
  session_id: string;
  replay_data: number[];
  truncated: boolean;
  is_live: boolean;
  pending_prompt?: HostKeyPromptInfo | null;
  /** The session is over (its process exited, or it was closed). */
  ended?: boolean;
}

export interface HostKeyPromptInfo {
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  raw_prompt: string;
  /** The key differs from the one PuTTY cached ("POTENTIAL SECURITY BREACH"). */
  changed?: boolean;
  /** Not a host key: plink's weak-crypto question. What is weak, e.g.
   *  "key-exchange algorithm: diffie-hellman-group1-sha1". */
  weak?: string | null;
  /** Any other (y/n) question plink stopped at, verbatim. */
  question?: string | null;
}

export interface PromptEvent {
  session_id: string;
  prompt: HostKeyPromptInfo;
}

/** How plink reaches a target that isn't a saved session (T-020). */
export type TargetProtocol = 'ssh' | 'telnet' | 'raw';

/** A tab's protocol as plink needs it for an explicit target. */
export function targetProtocolOf(protocol?: string): TargetProtocol | undefined {
  switch (protocol) {
    case 'Telnet': return 'telnet';
    case 'RAW': return 'raw';
    case 'SSH': return 'ssh';
    default: return undefined;
  }
}

// Sessions started for tabs that aren't on screen yet, by tab id. A tab's
// view waits for its entry before attaching, so it never starts a second
// session under the same id.
const backgroundStarts = new Map<string, Promise<void>>();

/**
 * Starts a tab's session before its view exists (T-020): only the shown tab
 * mounts a terminal view, and the view is what used to start the session,
 * so after GNS3's "open all consoles" only the last console connected. The
 * session runs detached into scrollback; the tab attaches (and replays it)
 * when it's first shown.
 */
export function startSessionInBackground(tab: {
  id: string; sessionName: string; hostname?: string; port?: number; username?: string; protocol?: string;
}): Promise<boolean> {
  let started = false;
  const start = (async () => {
    const r = await startTerminalSession(
      tab.id, tab.sessionName, false, 120, 32, () => {},
      tab.hostname, tab.port, tab.username, undefined, targetProtocolOf(tab.protocol),
    );
    started = r.started;
    if (r.started) await detachTerminalSession(tab.id);
  })().finally(() => backgroundStarts.delete(tab.id));
  backgroundStarts.set(tab.id, start);
  return start.then(() => started);
}

/** The in-flight background start for a tab, if any. */
export function backgroundStartOf(tabId: string): Promise<void> | undefined {
  return backgroundStarts.get(tabId);
}

export async function startTerminalSession(
  sessionId: string,
  sessionName: string,
  isLocal: boolean,
  cols: number,
  rows: number,
  onData: (chunk: Uint8Array) => void,
  hostname?: string,
  port?: number,
  username?: string,
  logFileName?: string,
  protocol?: TargetProtocol,
  /** The tab's title: an automatic log of a session that isn't saved is
   *  filed under it (Unsaved/R1), not under telnet://host:port. */
  title?: string
): Promise<{ started: boolean; error?: string }> {
  if (isTauriEnvironment()) {
    try {
      const { invoke, Channel } = await import('@tauri-apps/api/core');
      // Raw bytes (an ArrayBuffer), not a JSON number array (ADR-006).
      const channel = new Channel<ArrayBuffer>();
      channel.onmessage = (buf: ArrayBuffer) => {
        onData(new Uint8Array(buf));
      };
      await invoke('start_terminal_session', {
        sessionId,
        sessionName,
        isLocal,
        cols,
        rows,
        onData: channel,
        hostname,
        port,
        username,
        logFileName: logFileName || null,
        protocol: protocol ?? null,
        title: title ?? null,
      });
      return { started: true };
    } catch (e) {
      console.warn("Failed to invoke start_terminal_session via Tauri:", e);
      // The backend's reason ("Failed to open serial line /dev/ttyUSB0: No
      // such file or directory") is the only useful thing to show the user.
      return { started: false, error: String(e) };
    }
  }
  return { started: false };
}

// A tab's attach and detach, one after another. Switching away from a tab
// and back detaches its session and attaches it again; the two raced (in
// the page, and as IPC requests WebView2 handles concurrently), the detach
// could land last, and the session's output then went only to scrollback:
// the tab took no more output and never heard the device hang up (e2e
// suite on a Windows runner).
const attachChains = new Map<string, Promise<unknown>>();

function attachInOrder<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const next = (attachChains.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(task);
  attachChains.set(sessionId, next);
  next.finally(() => {
    if (attachChains.get(sessionId) === next) attachChains.delete(sessionId);
  }).catch(() => {});
  return next;
}

export function attachTerminalSession(
  sessionId: string,
  fromSeq: number,
  onData: (chunk: Uint8Array) => void
): Promise<AttachInfo | null> {
  return attachInOrder(sessionId, () => attachNow(sessionId, fromSeq, onData));
}

async function attachNow(
  sessionId: string,
  fromSeq: number,
  onData: (chunk: Uint8Array) => void
): Promise<AttachInfo | null> {
  if (isTauriEnvironment()) {
    try {
      const { invoke, Channel } = await import('@tauri-apps/api/core');
      // Raw bytes (an ArrayBuffer), not a JSON number array (ADR-006).
      const channel = new Channel<ArrayBuffer>();
      channel.onmessage = (buf: ArrayBuffer) => {
        onData(new Uint8Array(buf));
      };
      const info = await invoke<AttachInfo>('attach_terminal_session', {
        sessionId,
        fromSeq,
        onData: channel,
      });
      return info;
    } catch (e) {
      console.warn("Failed to invoke attach_terminal_session via Tauri:", e);
      return null;
    }
  }
  return null;
}

/** Output the page may owe before it tells the backend it caught up. */
export const ACK_BATCH_BYTES = 128 * 1024;

/**
 * Tells the backend, in batches, how much of a session's output the page has
 * finished drawing (ADR-006). The backend stops reading a session that is
 * 512 KB behind, so a flood waits for the page instead of burying it.
 * Batched by size, with a short timer for the tail of a burst.
 */
export function createOutputAcker(
  sessionId: string,
  send: (sessionId: string, bytes: number) => unknown = ackTerminalOutput,
) {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending > 0) {
      const n = pending;
      pending = 0;
      send(sessionId, n);
    }
  };
  return {
    ack(bytes: number) {
      pending += bytes;
      if (pending >= ACK_BATCH_BYTES) flush();
      else if (!timer) timer = setTimeout(flush, 30);
    },
    dispose: flush,
  };
}

export async function ackTerminalOutput(sessionId: string, bytes: number): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ack_terminal_output', { sessionId, bytes });
    } catch (e) {
      console.warn('Failed to acknowledge terminal output:', e);
    }
  }
}

/** The tab left the screen: its session keeps running into scrollback. */
export function detachTerminalSession(sessionId: string): Promise<void> {
  return attachInOrder(sessionId, async () => {
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('detach_terminal_session', { sessionId });
      } catch {
        // Already closed: nothing to detach.
      }
    }
  });
}

// Each tab's writes, one after another. Every keystroke is its own IPC
// request, and nothing kept them in order: on Windows (WebView2) requests
// are handled concurrently, and typing reached the device scrambled --
// `set /a 40+2` became `set40+2 /a`, `show users` became `ssehros` (e2e
// suite on a Windows runner). A write now starts only after the one before
// it finished.
const writeChains = new Map<string, Promise<void>>();

export function writeTerminalInput(sessionId: string, data: Uint8Array): Promise<void> {
  if (!isTauriEnvironment()) return Promise.resolve();
  const bytes = Array.from(data);
  const next = (writeChains.get(sessionId) ?? Promise.resolve()).then(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_terminal_input', { sessionId, data: bytes });
    } catch (e) {
      console.warn("Failed to invoke write_terminal_input via Tauri:", e);
    }
  });
  writeChains.set(sessionId, next);
  // Forget a finished chain, so closed tabs leave nothing behind.
  next.then(() => {
    if (writeChains.get(sessionId) === next) writeChains.delete(sessionId);
  });
  return next;
}

// Resizes go in order too, for the same reason as writes: two sent while a
// tab settled (85 then 84 columns) could land the other way round, and the
// router was told 85 while the screen showed 84 (e2e suite on a Windows
// runner). Only the latest size is sent; one superseded while it waited is
// skipped.
const resizeChains = new Map<string, Promise<void>>();
const latestSize = new Map<string, string>();

export function resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void> {
  if (!isTauriEnvironment()) return Promise.resolve();
  const size = `${cols}x${rows}`;
  latestSize.set(sessionId, size);
  const next = (resizeChains.get(sessionId) ?? Promise.resolve()).then(async () => {
    if (latestSize.get(sessionId) !== size) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('resize_terminal', { sessionId, cols, rows });
    } catch (e) {
      console.warn("Failed to invoke resize_terminal via Tauri:", e);
    }
  });
  resizeChains.set(sessionId, next);
  next.then(() => {
    if (resizeChains.get(sessionId) === next) {
      resizeChains.delete(sessionId);
      latestSize.delete(sessionId);
    }
  });
  return next;
}

// Tab ids whose session was explicitly closed. A start_terminal_session call
// already in flight when its tab is closed would otherwise create a session
// after the close ran as a no-op -- TerminalView checks this when its start
// resolves late and closes the straggler.
const closedSessionIds = new Set<string>();

export function isSessionClosed(sessionId: string): boolean {
  return closedSessionIds.has(sessionId);
}

/**
 * Takes an id off the closed list so a session can be started again under
 * it (Reconnect restarts a tab in place). Otherwise a tab switch during the
 * restart would treat the new session as a closed tab's straggler.
 */
export function reopenSessionId(sessionId: string): void {
  closedSessionIds.delete(sessionId);
}

/** A session's TCP connection is up: the backend watches plink's own socket
 *  (tcp_state.rs), so a console that prints nothing still shows connected. */
export async function listenSessionConnected(
  callback: (sessionId: string) => void
): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('session:connected', (event) => callback(event.payload));
}

/** A session's process ended before it connected (refused, unreachable). */
export async function listenSessionEnded(
  callback: (sessionId: string) => void
): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<string>('session:ended', (event) => callback(event.payload));
}

/** For a tab made after `session:ended` went by. */
export async function isSessionEnded(sessionId: string): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('is_session_ended', { sessionId });
  } catch {
    return false;
  }
}

/** For a page that started listening after the event went by. */
export async function isSessionConnected(sessionId: string): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('is_session_connected', { sessionId });
  } catch {
    return false;
  }
}

export async function closeTerminalSession(sessionId: string): Promise<void> {
  closedSessionIds.add(sessionId);
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('close_terminal_session', { sessionId });
    } catch (e) {
      console.warn("Failed to invoke close_terminal_session via Tauri:", e);
    }
  }
}

export async function answerHostKeyPrompt(
  sessionId: string,
  answer: 'store' | 'once' | 'reject'
): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('answer_hostkey_prompt', {
        sessionId,
        answer,
      });
      return true;
    } catch (e) {
      console.warn("Failed to answer host key prompt via Tauri:", e);
      return false;
    }
  }
  return true;
}

export async function listenHostKeyPrompts(
  callback: (event: PromptEvent) => void
): Promise<(() => void) | null> {
  if (isTauriEnvironment()) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<PromptEvent>('session:prompt', (event) => {
        callback(event.payload);
      });
      return unlisten;
    } catch (e) {
      console.warn("Failed to listen for session:prompt via Tauri:", e);
      return null;
    }
  }
  return null;
}

export interface PasteProgress {
  sessionId: string;
  sent: number;
  total: number;
}

/**
 * Pastes text one line at a time with `lineDelayMs` between lines, for
 * console ports / network gear that drop characters on a fast paste. Refused
 * by the backend until the session is Live (never types into a password
 * prompt). Resolves with the number of lines sent; rejects on error.
 */
export async function pastePaced(sessionId: string, text: string, lineDelayMs: number): Promise<number> {
  if (!isTauriEnvironment()) return 0;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<number>('paste_paced', { sessionId, text, lineDelayMs });
}

export async function cancelPaste(sessionId: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('cancel_paste', { sessionId });
}

/**
 * Sends a serial Break (held ~400 ms). Rejects with a message for sessions
 * that aren't serial -- plink has no way to send one (ADR-005).
 */
export async function sendBreak(sessionId: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('send_break', { sessionId });
}

export async function listenPasteProgress(
  callback: (progress: PasteProgress) => void
): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<PasteProgress>('paste:progress', (event) => callback(event.payload));
}

export async function setSyncChannel(
  sessionId: string,
  channel: string | null
): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_sync_channel', {
        sessionId,
        channel,
      });
    } catch (e) {
      console.warn("Failed to set sync channel via Tauri:", e);
    }
  }
}

export async function setSyncProtected(
  sessionId: string,
  protectedStatus: boolean
): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_sync_protected', {
        sessionId,
        protected: protectedStatus,
      });
    } catch (e) {
      console.warn("Failed to set sync protection via Tauri:", e);
    }
  }
}

export async function setSyncArmed(armed: boolean): Promise<void> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_sync_armed', { armed });
    } catch (e) {
      console.warn("Failed to set sync armed state via Tauri:", e);
    }
  }
}

/** Sends to a channel ('all' or A-D). Returns the ids of the sessions that received it. */
export async function broadcastSyncInput(
  channel: string,
  data: Uint8Array
): Promise<string[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string[]>('broadcast_sync_input', {
        channel,
        data: Array.from(data),
      });
    } catch (e) {
      console.warn("Failed to broadcast sync input via Tauri:", e);
      return [];
    }
  }
  return [];
}

export async function getShellIntegrationScript(shell: 'bash' | 'zsh' | 'fish'): Promise<string> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string>('get_shell_integration_script', { shell });
    } catch (e) {
      console.warn("Failed to get shell integration script via Tauri:", e);
    }
  }
  return `# Fallback shell integration for ${shell}`;
}

export async function injectShellIntegration(
  sessionId: string,
  shell: 'bash' | 'zsh' | 'fish'
): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('inject_shell_integration', { sessionId, shell });
      return true;
    } catch (e) {
      console.error("Failed to inject shell integration via Tauri:", e);
      return false;
    }
  }
  return true;
}

export interface DetectedSerialPort {
  port_name: string;
  display_name: string;
  is_usb: boolean;
  manufacturer?: string | null;
  product?: string | null;
}

export async function listSerialPorts(): Promise<DetectedSerialPort[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<DetectedSerialPort[]>('list_serial_ports');
    } catch (e) {
      console.warn("Failed to list serial ports via Tauri:", e);
      return [];
    }
  }
  return [
    { port_name: '/dev/ttyUSB0', display_name: '/dev/ttyUSB0 (FTDI FT232R USB UART)', is_usb: true, manufacturer: 'FTDI', product: 'FT232R USB UART' },
    { port_name: '/dev/ttyACM0', display_name: '/dev/ttyACM0 (Cisco USB Console)', is_usb: true, manufacturer: 'Cisco', product: 'USB Console' },
    { port_name: 'COM3', display_name: 'COM3 (Silicon Labs CP210x)', is_usb: true, manufacturer: 'Silicon Labs', product: 'CP210x' },
    { port_name: '/dev/ttyS0', display_name: '/dev/ttyS0 (Serial Port)', is_usb: false },
  ];
}

/** Locks a tab read only, or unlocks it: the backend then refuses typing,
 *  pastes, snippets, scripts and broadcasts for it. */
export async function setSessionLocked(sessionId: string, locked: boolean): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_session_locked', { sessionId, locked });
}
