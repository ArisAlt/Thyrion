// The vault, through the backend. Every change says so (VAULT_CHANGED_EVENT),
// so open views can refresh.
import { isTauriEnvironment } from './env';

/**
 * Fired after anything that changes what the vault can answer: create,
 * unlock, lock, saving or deleting an entry. Open terminals used to check
 * "is the vault unlocked?" once, when the tab opened -- unlock the vault
 * afterwards and the tab never offered it.
 */
export const VAULT_CHANGED_EVENT = 'plinky:vault-changed';
function notifyVaultChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VAULT_CHANGED_EVENT));
}

/** Which vault entry (never its secret) holds a session's password. */
export interface VaultLookup {
  locked: boolean;
  key: string | null;
  hasEnableSecret: boolean;
  /** False for an entry that holds only an enable password (a console
   *  with no login). Older backends leave it out: treat that as true. */
  hasLoginSecret?: boolean;
  /** The entry's username (not a secret), for Telnet/serial Username: prompts. */
  username?: string | null;
  /** Session opt-ins (PlinkyAutoLogin / PlinkyAutoEnable in the session file). */
  autoLogin?: boolean;
  autoEnable?: boolean;
}

export async function vaultLookup(sessionName: string, hostname?: string, username?: string): Promise<VaultLookup> {
  if (!isTauriEnvironment()) return { locked: true, key: null, hasEnableSecret: false, hasLoginSecret: false, autoLogin: false, autoEnable: false };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<VaultLookup>('vault_lookup', {
    sessionName,
    hostname: hostname || undefined,
    username: username || undefined,
  });
}

/**
 * Types a vault entry's login or enable password into a session, then Enter.
 * The secret goes from the vault to the session inside the backend -- the
 * webview never holds it -- and a locked vault refuses.
 */
export async function vaultSendSecret(sessionId: string, key: string, field: 'login' | 'enable'): Promise<void> {
  if (!isTauriEnvironment()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('vault_send_secret', { sessionId, key, field });
}

export interface VaultEntry {
  id: string;
  username?: string;
  secret: string;
  enable_secret?: string;
  notes?: string;
  created_at: number;
  updated_at: number;
}

/** Entry metadata WITHOUT the secret -- for listing views. */
export interface VaultEntryMeta {
  id: string;
  username?: string;
  has_enable_secret?: boolean;
  /** False for an entry with only an enable password. */
  has_login_secret?: boolean;
  notes?: string;
  created_at: number;
  updated_at: number;
}

/**
 * Exports the whole vault to a KeePass (.kdbx) file chosen in a Save As
 * dialog, protected by the vault's master password -- which is checked
 * against the vault file first. Resolves null if the dialog was cancelled.
 */
export async function vaultExportKdbx(masterPassword: string): Promise<{ path: string; entries: number } | null> {
  if (!isTauriEnvironment()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<{ path: string; entries: number } | null>('vault_export_kdbx', { masterPassword });
}

/**
 * Deletes the vault file permanently (Settings -> Delete vault). Resolves
 * false when there was no vault to delete.
 */
export async function vaultDestroy(): Promise<boolean> {
  if (!isTauriEnvironment()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  const deleted = await invoke<boolean>('vault_destroy');
  notifyVaultChanged();
  return deleted;
}

export async function vaultIsInitialized(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('vault_is_initialized');
    } catch (e) {
      console.warn("Failed to check vault_is_initialized:", e);
      return false;
    }
  }
  return true;
}

export async function vaultIsUnlocked(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<boolean>('vault_is_unlocked');
    } catch (e) {
      console.warn("Failed to check vault_is_unlocked:", e);
      return false;
    }
  }
  return true;
}

export async function vaultCreate(masterPassword: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('vault_create', { masterPassword });
      notifyVaultChanged();
      return true;
    } catch (e) {
      console.error("Failed to create vault:", e);
      throw e;
    }
  }
  return true;
}

export async function vaultUnlock(masterPassword: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('vault_unlock', { masterPassword });
      notifyVaultChanged();
      return true;
    } catch (e) {
      console.error("Failed to unlock vault:", e);
      throw e;
    }
  }
  return true;
}

export async function vaultLock(): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('vault_lock');
      notifyVaultChanged();
      return true;
    } catch (e) {
      console.warn("Failed to lock vault:", e);
      return false;
    }
  }
  return true;
}

export async function vaultGet(key: string): Promise<string | null> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string | null>('vault_get', { key });
    } catch (e) {
      console.warn(`Failed to get key '${key}' from vault:`, e);
      return null;
    }
  }
  return null;
}

export async function vaultSet(key: string, secret: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('vault_set', { key, secret });
      notifyVaultChanged();
      return true;
    } catch (e) {
      console.error(`Failed to set key '${key}' in vault:`, e);
      throw e;
    }
  }
  return true;
}

export async function vaultGetEntry(key: string): Promise<VaultEntry | null> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<VaultEntry | null>('vault_get_entry', { key });
    } catch (e) {
      console.warn(`Failed to get entry '${key}' from vault:`, e);
      return null;
    }
  }
  return null;
}

export async function vaultSetEntry(entry: VaultEntry): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('vault_set_entry', { entry });
      notifyVaultChanged();
      return true;
    } catch (e) {
      console.error(`Failed to set entry '${entry.id}' in vault:`, e);
      throw e;
    }
  }
  return true;
}

export async function vaultDelete(key: string): Promise<boolean> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const deleted = await invoke<boolean>('vault_delete', { key });
      notifyVaultChanged();
      return deleted;
    } catch (e) {
      console.warn(`Failed to delete key '${key}' from vault:`, e);
      return false;
    }
  }
  return true;
}

export async function vaultListKeys(): Promise<string[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<string[]>('vault_list_keys');
    } catch (e) {
      console.warn("Failed to list vault keys:", e);
      return [];
    }
  }
  return [];
}

/** Entry metadata for every stored credential, WITHOUT decrypted secrets.
 * Use vaultGetEntry(id) to fetch one entry's secret on demand -- never
 * bulk-load secrets just to render a list. */
export async function vaultListEntriesMeta(): Promise<VaultEntryMeta[]> {
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<VaultEntryMeta[]>('vault_list_entries_meta');
    } catch (e) {
      console.warn("Failed to list vault entry metadata:", e);
      return [];
    }
  }
  return [];
}
