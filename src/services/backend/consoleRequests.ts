// Consoles opened from outside the page: the command line, a second launch,
// GNS3.
import { isTauriEnvironment } from './env';
import { TargetProtocol } from './terminal';

/** A console tab asked for on the command line (GNS3: --telnet host port). */
export interface OpenRequest {
  protocol: TargetProtocol;
  host: string;
  port: number;
  title?: string | null;
  user?: string | null;
  /** The session the backend already started for it; the tab attaches. */
  sessionId?: string | null;
}

/** Console tabs queued by launches of Thyrion (the first one's and forwarded ones); drains the queue. */
export async function takeOpenRequests(): Promise<OpenRequest[]> {
  if (!isTauriEnvironment()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<OpenRequest[]>('take_open_requests');
  } catch (e) {
    console.warn('Failed to take open requests:', e);
    return [];
  }
}

/** Called when another launch has queued console tabs. */
export async function listenOpenRequests(onNudge: () => void): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen('cli:open', () => onNudge());
  } catch (e) {
    console.warn('Failed to listen for cli:open:', e);
    return null;
  }
}
