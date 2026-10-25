import React from 'react';
import { Key, Shield, Lock, Trash2 } from 'lucide-react';
import { Protocol } from '../../../types/session';
import { VaultEntryMeta } from '../../../services/tauriBridge';
import { Setter, VaultState } from './types';

/** Session settings > Credentials & Vault: the username and key file, the
 *  vault entry with the login and enable passwords, and automatic login. */
export const CredentialsTab: React.FC<{
  protocol: Protocol;
  name: string;
  username: string;
  setUsername: Setter<string>;
  publicKeyFile: string;
  setPublicKeyFile: Setter<string>;
  useVault: boolean;
  setUseVault: Setter<boolean>;
  vaultState: VaultState;
  setUnlockFor: Setter<null | 'edit' | 'save'>;
  vaultMode: 'new' | 'link';
  setVaultMode: Setter<'new' | 'link'>;
  vaultEntries: VaultEntryMeta[];
  selectedVaultKey: string;
  setSelectedVaultKey: Setter<string>;
  vaultKeyId: string;
  setVaultKeyId: Setter<string>;
  savedVaultKey: string | null;
  vaultPassword: string;
  setVaultPassword: Setter<string>;
  vaultEnablePassword: string;
  setVaultEnablePassword: Setter<string>;
  removeEnable: boolean;
  setRemoveEnable: Setter<boolean>;
  /** The other saved sessions that use a vault entry. */
  vaultEntryUsers: (key: string) => string[];
  enableJumpHost: boolean;
  autoEnable: boolean;
  setAutoEnable: Setter<boolean>;
  autoLogin: boolean;
  setAutoLogin: Setter<boolean>;
}> = ({
  protocol, name, username, setUsername, publicKeyFile, setPublicKeyFile, useVault,
  setUseVault, vaultState, setUnlockFor, vaultMode, setVaultMode, vaultEntries,
  selectedVaultKey, setSelectedVaultKey, vaultKeyId, setVaultKeyId, savedVaultKey,
  vaultPassword, setVaultPassword, vaultEnablePassword, setVaultEnablePassword, removeEnable,
  setRemoveEnable, vaultEntryUsers, enableJumpHost, autoEnable, setAutoEnable, autoLogin,
  setAutoLogin,
}) => {
  const isSerial = protocol === 'Serial';

  // The key typed is one the vault already holds (or this session's own):
  // a blank password then keeps the stored one.
  const typedKey = vaultKeyId.trim();
  const keyIsSaved = !!typedKey && (typedKey === savedVaultKey || vaultEntries.some(v => v.id === typedKey));
  // The entry the enable password comes from, and whether it has one.
  const enableEntryKey = useVault ? (vaultMode === 'link' ? selectedVaultKey : typedKey) : '';
  const enableSaved = !!enableEntryKey && !!vaultEntries.find(v => v.id === enableEntryKey)?.has_enable_secret;
  const hasEnable = !!vaultEnablePassword || (enableSaved && !removeEnable);
  // Removing the enable password from an entry that has nothing else
  // leaves it empty: saving then deletes it, or unlinks a shared one.
  const enableOnly = enableSaved && vaultEntries.find(v => v.id === enableEntryKey)?.has_login_secret === false && !vaultPassword;
  const enableEntryShared = enableOnly ? vaultEntryUsers(enableEntryKey) : [];
  const enableEditable = !useVault || vaultMode === 'new';

  return (
    <>
      {!isSerial && (
        <div className="space-y-1">
          <label htmlFor="new-session-modal-default-username" className="text-slate-300 font-medium">Username</label>
          <input id="new-session-modal-default-username"
            type="text"
            autoComplete="off"
            placeholder="e.g. root, admin, or deploy"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-plinky-muted focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      {protocol === 'SSH' && (
        <div className="space-y-1">
          <label htmlFor="new-session-modal-private-key-file-ppk" className="text-slate-300 font-medium flex items-center space-x-1">
            <Key className="w-3.5 h-3.5 text-slate-400" />
            <span>Private Key File (.ppk)</span>
          </label>
          <input id="new-session-modal-private-key-file-ppk"
            type="text"
            placeholder="/path/to/key.ppk (or Pageant/agent will handle auth)"
            value={publicKeyFile}
            onChange={e => setPublicKeyFile(e.target.value)}
            className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 placeholder-plinky-muted font-mono focus:outline-none focus:border-sky-500"
          />
        </div>
      )}
      {/* ENCRYPTED VAULT CREDENTIALS SECTION */}
      <div className="p-3 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useVault}
              onChange={e => setUseVault(e.target.checked)}
              className="rounded border-plinky-700 text-sky-500 focus:ring-0 bg-plinky-900"
            />
            <span className="text-slate-200 font-medium flex items-center space-x-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              <span>Save Credentials in Encrypted Vault</span>
            </span>
          </label>
          {useVault && (
            <span className="text-meta text-slate-400 font-mono">
              Argon2id + AES-256-GCM
            </span>
          )}
        </div>
        {useVault && vaultState === 'none' && (
          <div role="status" className="flex items-center justify-between gap-2 p-2 rounded border border-amber-500/40 bg-amber-950/30 text-amber-300 text-meta">
            <span>No vault yet, so a password here can't be saved. Create one now, or Save asks for it.</span>
            <button
              type="button"
              onClick={() => setUnlockFor('edit')}
              className="shrink-0 px-2 py-0.5 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
            >
              Create vault…
            </button>
          </div>
        )}
        {useVault && vaultState === 'locked' && (
          <div role="status" className="flex items-center justify-between gap-2 p-2 rounded border border-amber-500/40 bg-amber-950/30 text-amber-300 text-meta">
            <span>The vault is locked, so this session's password can't be read or saved.</span>
            <button
              type="button"
              onClick={() => setUnlockFor('edit')}
              className="shrink-0 px-2 py-0.5 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-500/10"
            >
              Unlock…
            </button>
          </div>
        )}

        {useVault && (
          <div className="space-y-2.5 pt-1 border-t border-plinky-800/80 animate-in fade-in duration-150">

            {vaultMode === 'link' ? (
              <div className="space-y-1">
                <label htmlFor="new-session-modal-select-vault-credential" className="text-slate-300 text-meta">Select Vault Credential *</label>
                <select id="new-session-modal-select-vault-credential"
                  value={selectedVaultKey}
                  onChange={e => setSelectedVaultKey(e.target.value)}
                  className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 text-xs focus:outline-none focus:border-sky-500 font-mono"
                >
                  <option value="" disabled>-- Select a vault credential --</option>
                  {vaultEntries.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.id} {e.username ? `(${e.username})` : ''} {e.has_enable_secret ? '· enable password' : ''}
                    </option>
                  ))}
                </select>
                {vaultEntries.length === 0 && (
                  <p className="text-amber-400 text-meta">
                    No credentials found in vault (or vault is locked). You can switch to "Create New Vault Entry".
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="new-session-modal-vault-key-id" className="text-slate-300 text-meta">Vault Key ID</label>
                    <input id="new-session-modal-vault-key-id"
                      type="text"
                      value={vaultKeyId}
                      onChange={e => setVaultKeyId(e.target.value)}
                      placeholder={name.trim() ? `session:${name.trim()}` : 'session:device-name'}
                      className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="new-session-modal-login-password" className="text-slate-300 text-meta">
                      {keyIsSaved || vaultEnablePassword ? 'Login Password' : 'Login Password *'}
                    </label>
                    <input id="new-session-modal-login-password"
                      type="password"
                      // WebView2 filled a remembered password in here
                      // on edit, and Save wrote it over the vault's.
                      autoComplete="new-password"
                      value={vaultPassword}
                      onChange={e => setVaultPassword(e.target.value)}
                      placeholder={keyIsSaved ? 'Saved. Type to replace' : 'Session login password...'}
                      className="w-full bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

              </div>
            )}

            {/* Mode toggle, under the fields it switches */}
            <div className="flex items-center space-x-2 text-xs">
              <button
                type="button"
                onClick={() => setVaultMode('new')}
                className={`flex-1 py-1 px-2 rounded border text-center font-medium transition ${
                  vaultMode === 'new'
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                    : 'bg-plinky-900 text-slate-400 border-plinky-700 hover:text-slate-300'
                }`}
              >
                Create New Vault Entry
              </button>
              <button
                type="button"
                onClick={() => setVaultMode('link')}
                className={`flex-1 py-1 px-2 rounded border text-center font-medium transition ${
                  vaultMode === 'link'
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                    : 'bg-plinky-900 text-slate-400 border-plinky-700 hover:text-slate-300'
                }`}
              >
                Link to Existing Vault Entry
              </button>
            </div>

            <p className="flex items-center gap-1.5 text-meta text-slate-400">
              <Lock className="w-3 h-3 shrink-0 text-plinky-muted" aria-hidden="true" />
              <span>Stored encrypted in the vault, never in PuTTY's session files.</span>
            </p>
          </div>
        )}
      </div>

      {/* The enable password: its own block, always shown, so it is
          plain where it goes. It used to sit behind "Save credentials",
          "Create new entry" and a "Network Device" box. Stored in the
          session's vault entry (enable_secret) like the login password;
          the automatic switch is PlinkyAutoEnable in the session file. */}
      <section aria-labelledby="new-session-modal-enable-heading" className="p-3 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-2 text-meta">
        <h3 id="new-session-modal-enable-heading" className="text-slate-200 text-xs font-medium flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          <span>Privileged mode (enable)</span>
        </h3>
        {enableEditable ? (
          <div className="space-y-1">
            <label htmlFor="new-session-modal-enable-password" className="block text-slate-300">Enable password</label>
            <div className="flex items-center gap-2">
              <input id="new-session-modal-enable-password"
                type="password"
                autoComplete="new-password"
                aria-describedby="new-session-modal-enable-help"
                value={vaultEnablePassword}
                onChange={e => {
                  setVaultEnablePassword(e.target.value);
                  // Saving it needs the vault: typing here is asking for that.
                  if (e.target.value && !useVault) { setUseVault(true); setVaultMode('new'); }
                  if (e.target.value) setRemoveEnable(false);
                }}
                placeholder={enableSaved && !removeEnable ? 'Saved. Type to replace' : 'For routers, switches and firewalls'}
                className="flex-1 min-w-0 bg-plinky-900 border border-plinky-700 rounded px-2 py-1 text-slate-100 font-mono text-xs placeholder-plinky-muted focus:outline-none focus:border-sky-500"
              />
              {enableSaved && !removeEnable && !vaultEnablePassword && (
                <button
                  type="button"
                  onClick={() => setRemoveEnable(true)}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-plinky-700 text-slate-300 hover:border-rose-500/50 hover:text-rose-300"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  <span>Remove</span>
                </button>
              )}
            </div>
            {removeEnable && (
              <p role="status" className="flex items-center gap-2 text-amber-300">
                <span>
                  {!enableOnly
                    ? 'The enable password is removed from the vault when you save.'
                    : enableEntryShared.length === 0
                      ? 'It is this entry\'s only password, so saving deletes the vault entry and unlinks this session.'
                      : `It is this entry's only password and ${enableEntryShared.join(', ')} also ${enableEntryShared.length === 1 ? 'uses' : 'use'} it, so saving only unlinks this session.`}
                </span>
                <button type="button" onClick={() => setRemoveEnable(false)} className="underline hover:text-amber-200">Keep it</button>
              </p>
            )}
          </div>
        ) : (
          <p className="text-slate-300">
            {enableSaved
              ? <>Comes from vault entry <span className="font-mono">{enableEntryKey}</span>.</>
              : <>Vault entry <span className="font-mono">{enableEntryKey || '(none picked)'}</span> has no enable password.</>}
            {' '}Change it in Vault, in the top bar.
          </p>
        )}
        <p id="new-session-modal-enable-help" className="text-plinky-muted">
          The password the device asks for after you type <code className="text-slate-300">enable</code>.
          It is kept in the vault with this session's login{protocol === 'SSH' && enableJumpHost ? ' and only ever sent to this device, never to the jump host' : ''}.
          Leave it empty for servers.
        </p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={autoEnable} onChange={e => setAutoEnable(e.target.checked)} className="mt-0.5" aria-describedby="new-session-modal-auto-enable-help" />
          <span className="text-slate-300">
            Send it when the device asks
            <span id="new-session-modal-auto-enable-help" className="block text-plinky-muted">
              Only right after you type <code>enable</code>, <code>en</code> or <code>super</code> and the device answers <code>Password:</code>.
              Leave off if you connect from this device to others: they would be sent this password too.
            </span>
          </span>
        </label>
        {autoEnable && !hasEnable && enableEditable && (
          <p role="status" className="text-amber-300">No enable password saved yet, so there is nothing to send. Type it above.</p>
        )}
        <p className="text-plinky-muted">
          To send it yourself: right-click the terminal, then <span className="text-slate-300">Send Enable Password</span>, or press{' '}
          <kbd className="px-1 rounded border border-plinky-700 text-slate-300 font-mono">Ctrl+Shift+E</kbd>.
        </p>
      </section>

      {/* Automatic answers from the vault. SSH needs no switch: plink
          logs in by itself. The others answer prompts the device prints,
          so they're opt-in per session. */}
      <div className="p-2.5 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-1.5 text-meta">
        <div className="text-slate-300 font-medium">Automatic login from the vault</div>
        {protocol === 'SSH' && (
          <p className="text-plinky-muted">
            SSH logs in by itself when the vault is unlocked and holds this session's password
            (linked above, or an entry named "session:{name.trim() || 'name'}" or after the host).
          </p>
        )}
        {(protocol === 'Telnet' || protocol === 'Serial') && (
          <label className="flex items-start space-x-2 cursor-pointer">
            <input type="checkbox" checked={autoLogin} onChange={e => setAutoLogin(e.target.checked)} className="mt-0.5" />
            <span className="text-slate-300">
              Log in automatically
              <span className="block text-plinky-muted">Types the vault username and password at the device's Username:/Password: prompts, once per connection.</span>
            </span>
          </label>
        )}
      </div>
    </>
  );
};
