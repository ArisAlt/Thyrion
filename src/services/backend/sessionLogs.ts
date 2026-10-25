// Session logs: one started from a tab's menu, and automatic logging (Settings
// > Logging).
import { isTauriEnvironment } from './env';

/** A session log being written to disk. */
export interface SessionLogInfo {
  path: string;
  bytes: number;
}

/**
 * Asks where to save this session's log (a Save dialog), then the backend
 * writes the session's output there as it arrives. Null when the dialog is
 * cancelled, or outside the desktop app.
 */
export async function startSessionLog(
  sessionId: string,
  sessionName: string,
  mode: 'all' | 'printable'
): Promise<SessionLogInfo | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<SessionLogInfo | null>('start_session_log', { sessionId, sessionName, mode });
}

export async function stopSessionLog(sessionId: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('stop_session_log', { sessionId });
}

/** Where the session is logging and how many bytes are on disk; null if not. */
export async function sessionLogStatus(sessionId: string): Promise<SessionLogInfo | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<SessionLogInfo | null>('session_log_status', { sessionId });
}

/** Automatic session logs (Settings > Logging). */
export interface LoggingSettings {
  enabled: boolean;
  /** The folder in use, the default one included. */
  dir: string;
  /** Whether that folder is the default (Documents/Thyrion Logs). */
  default_dir: boolean;
  mode: 'printable' | 'all';
}

export async function getLoggingSettings(): Promise<LoggingSettings | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoggingSettings>('get_logging_settings');
}

/** `dir` null: the default folder. Applies to sessions started from now on. */
export async function setLoggingSettings(enabled: boolean, dir: string | null, mode: 'printable' | 'all'): Promise<LoggingSettings> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<LoggingSettings>('set_logging_settings', { enabled, dir, mode });
}

/** A folder for the logs, from the system's folder dialog; null if cancelled. */
export async function pickLogFolder(): Promise<string | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('pick_log_folder');
}
