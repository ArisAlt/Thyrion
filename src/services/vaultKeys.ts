import type { PuttySession } from '../types/session';

/**
 * The vault entry names that hold a session's password, best first: the
 * explicit link (PlinkyVaultKey), then "session:<name>", "<name>",
 * "user@host" and "host". Keep in step with vault_key_candidates in
 * src-tauri/src/lib.rs, which the backend uses to find a session's entry.
 */
export function vaultKeyCandidates(sessionName: string, explicit?: string, host?: string, user?: string): string[] {
  const keys: string[] = [];
  const push = (k: string) => { if (k && !keys.includes(k)) keys.push(k); };
  if (explicit) push(explicit);
  push(`session:${sessionName}`);
  push(sessionName);
  if (host) {
    if (user) push(`${user}@${host}`);
    push(host);
  }
  return keys;
}

/** The entry a saved session uses: its first candidate the vault holds. */
export function vaultEntryOf(session: PuttySession, existing: ReadonlySet<string>): string | undefined {
  const host = session.host_name || session.hostname;
  const user = session.user_name || session.username;
  return vaultKeyCandidates(session.name, session.extra?.PlinkyVaultKey, host, user).find(k => existing.has(k));
}

/** The saved sessions, other than `except`, that use vault entry `key`,
 *  through a link or one of the backend's fallback names. */
export function sessionsUsingVaultEntry(
  key: string,
  sessions: PuttySession[],
  existing: ReadonlySet<string>,
  except?: string,
): string[] {
  return sessions.filter(s => s.name !== except && vaultEntryOf(s, existing) === key).map(s => s.name);
}
