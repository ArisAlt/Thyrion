import { describe, it, expect } from 'vitest';
import { vaultKeyCandidates, vaultEntryOf, sessionsUsingVaultEntry } from '../services/vaultKeys';

const session = (name: string, hostname: string, username?: string, extra: Record<string, string> = {}) =>
  ({ name, hostname, port: 22, protocol: 'SSH', username, extra } as any);

describe('vault key candidates', () => {
  it('are the same names, in the same order, as the backend tries', () => {
    // Mirrors vault_keys_follow_the_names_the_vault_screen_suggests (src-tauri/src/lib.rs).
    expect(vaultKeyCandidates('Server 2', undefined, '192.0.2.10', 'ops'))
      .toEqual(['session:Server 2', 'Server 2', 'ops@192.0.2.10', '192.0.2.10']);
    expect(vaultKeyCandidates('Server 2', 'shared-admin', '192.0.2.10')[0]).toBe('shared-admin');
    expect(vaultKeyCandidates('R9', undefined, '', 'ops')).toEqual(['session:R9', 'R9']);
  });

  it('a session uses the first one the vault holds', () => {
    const s = session('Server 2', '192.0.2.10', 'ops');
    expect(vaultEntryOf(s, new Set(['192.0.2.10', 'ops@192.0.2.10']))).toBe('ops@192.0.2.10');
    expect(vaultEntryOf(s, new Set(['other']))).toBeUndefined();
    // A link to an entry that is gone falls through to the fallbacks.
    expect(vaultEntryOf({ ...s, extra: { PlinkyVaultKey: 'gone' } }, new Set(['Server 2']))).toBe('Server 2');
  });
});

describe('which sessions use an entry', () => {
  const entries = new Set(['shared-console', '192.0.2.9', 'R9 spare']);
  const editing = session('R9 console', '192.0.2.9', undefined, { PlinkyVaultKey: 'shared-console' });

  it('counts sessions that find it under a fallback name, not only by link', () => {
    const byHost = session('R9 via host', '192.0.2.9');
    expect(sessionsUsingVaultEntry('192.0.2.9', [editing, byHost], entries, 'R9 console')).toEqual(['R9 via host']);
    const byName = session('R9 spare', '198.51.100.1');
    expect(sessionsUsingVaultEntry('R9 spare', [editing, byName], entries, 'R9 console')).toEqual(['R9 spare']);
  });

  it('leaves out sessions that reach another entry first, and the one being edited', () => {
    const linkedElsewhere = session('R9 B', '192.0.2.9', undefined, { PlinkyVaultKey: 'shared-console' });
    expect(sessionsUsingVaultEntry('192.0.2.9', [editing, linkedElsewhere], entries, 'R9 console')).toEqual([]);
    expect(sessionsUsingVaultEntry('shared-console', [editing, linkedElsewhere], entries, 'R9 console')).toEqual(['R9 B']);
  });
});
