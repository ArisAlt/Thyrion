// The file browser's SFTP calls.
import { SftpFileEntry } from '../../types/session';
import { isTauriEnvironment } from './env';

/**
 * Which server an SFTP call goes to. `password` is only for one typed into
 * the SFTP pane: a saved session's vault password is read in the backend
 * and never passes through here.
 */
export interface SftpTarget {
  sessionName: string;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
}

/** Prefixes the backend puts on errors the SFTP pane acts on. */
export const SFTP_ERR_PASSWORD = '[password] ';
export const SFTP_ERR_HOSTKEY = '[hostkey] ';

async function sftpInvoke<T>(cmd: string, t: SftpTarget, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, {
    sessionName: t.sessionName,
    hostname: t.hostname || undefined,
    port: t.port || undefined,
    username: t.username || undefined,
    password: t.password || undefined,
    ...args,
  });
}

// Browser dev preview only (no backend): a small fixed tree so the pane can
// be laid out. The desktop app never falls back to it -- failures throw.
const DEMO_REMOTE: SftpFileEntry[] = [
  { name: "etc", isDir: true, isSymlink: false, size: 4096, permissions: "drwxr-xr-x", owner: "root", group: "root", modified: "Sep 22 18:05" },
  { name: "app.log", isDir: false, isSymlink: false, size: 2048590, permissions: "-rw-r--r--", owner: "deploy", group: "deploy", modified: "Sep 22 20:15" },
];
const DEMO_LOCAL: SftpFileEntry[] = [
  { name: "Documents", isDir: true, isSymlink: false, size: 4096, permissions: "drwxr-xr-x", owner: "", group: "", modified: "Sep 22 20:10" },
  { name: "notes.txt", isDir: false, isSymlink: false, size: 1250, permissions: "-rw-r--r--", owner: "", group: "", modified: "Sep 22 19:40" },
];

/** The remote folder psftp starts in: the user's home. */
export async function sftpRemoteHome(t: SftpTarget): Promise<string> {
  if (!isTauriEnvironment()) return '/home/demo';
  return sftpInvoke<string>('sftp_home_dir', t);
}

export async function sftpList(t: SftpTarget, path: string): Promise<SftpFileEntry[]> {
  if (!isTauriEnvironment()) return DEMO_REMOTE;
  return sftpInvoke<SftpFileEntry[]>('sftp_list', t, { remotePath: path });
}

export async function sftpMkdir(t: SftpTarget, path: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await sftpInvoke('sftp_mkdir', t, { remotePath: path });
}

export async function sftpRemove(t: SftpTarget, path: string, isDir: boolean): Promise<void> {
  if (!isTauriEnvironment()) return;
  await sftpInvoke(isDir ? 'sftp_rmdir' : 'sftp_rm', t, { remotePath: path });
}

export async function sftpUpload(t: SftpTarget, localPath: string, remotePath: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await sftpInvoke('sftp_upload', t, { localPath, remotePath });
}

export async function sftpDownload(t: SftpTarget, remotePath: string, localPath: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await sftpInvoke('sftp_download', t, { remotePath, localPath });
}

export async function listLocalFiles(localPath: string): Promise<SftpFileEntry[]> {
  if (!isTauriEnvironment()) return DEMO_LOCAL;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<SftpFileEntry[]>('sftp_list_local', { localPath });
}

export async function getLocalHomeDir(): Promise<string> {
  if (!isTauriEnvironment()) return '/home/demo';
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('sftp_get_home_dir');
}
