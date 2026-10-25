// Run Script: a program attached to one session (src-tauri/src/scripts.rs).
// What it prints is typed into the session, the session's output is its
// input, and its stderr comes back here as notes for the terminal.
import { isTauriEnvironment } from './env';

export async function pickScriptFile(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('pick_script_file');
}

export async function runScript(sessionId: string, sessionName: string, path: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('run_script', { sessionId, sessionName, path });
}

export async function stopScript(sessionId: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stop_script', { sessionId });
}

export async function listenScriptStarted(
  callback: (e: { sessionId: string; name: string }) => void
): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ sessionId: string; name: string }>('script:started', (event) => callback(event.payload));
}

export async function listenScriptLog(
  callback: (e: { sessionId: string; line: string }) => void
): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ sessionId: string; line: string }>('script:log', (event) => callback(event.payload));
}

export async function listenScriptEnded(
  callback: (e: { sessionId: string; code: number | null; stopped: boolean }) => void
): Promise<(() => void) | null> {
  if (!isTauriEnvironment()) return null;
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ sessionId: string; code: number | null; stopped: boolean }>('script:ended', (event) => callback(event.payload));
}
