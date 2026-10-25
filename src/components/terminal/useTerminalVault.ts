import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalTab } from '../../types/session';
import { askConfirm } from '../../services/confirm';
import {
  vaultGetEntry, vaultIsInitialized, vaultLookup, vaultSendSecret, writeTerminalInput, VaultLookup, VAULT_CHANGED_EVENT,
} from '../../services/tauriBridge';
import { isPrivilegeCommand, consoleLoginAction, TypedInput } from '../../services/promptDetect';
import { SESSION_SAVED_EVENT, SessionSavedDetail } from '../../services/appEvents';
import { readClipboard, writeClipboard } from '../../services/clipboard';
import { AddEventLog } from './TerminalLogDialogs';

// A terminal's vault: which entry is this session's, sending and copying
// its passwords, and the automatic answers to the device's prompts.

export function useTerminalVault(tab: TerminalTab, isLocalSession: boolean, addEventLog: AddEventLog) {
  // Encrypted Vault. The backend decides which entry is this session's
  // (vault_lookup: an explicit link, or an entry named after the session or
  // host) and types it itself (vault_send_secret), so the webview never
  // holds a password to send. This used to fetch the entry once on mount:
  // unlocking the vault afterwards never reached an open tab, and locking
  // it didn't stop the tab sending the password it had cached.
  const [vault, setVault] = useState<VaultLookup | null>(null);
  const [vaultExists, setVaultExists] = useState(false);
  const vaultKey = vault?.key ?? null;
  const isVaultUnlocked = !!vault && !vault.locked;
  const [isVaultMenuOpen, setIsVaultMenuOpen] = useState(false);
  const [detectedPasswordPrompt, setDetectedPasswordPrompt] = useState<'login' | 'enable' | null>(null);
  // Unlocked in place: the notice then offers the saved password for the
  // prompt still waiting. It used to say "Vault in the top bar".
  const [unlockOpen, setUnlockOpen] = useState(false);
  // Unlocking to send the enable password sends it once unlocked.
  const unlockThenEnableRef = useRef(false);
  // Asked for the enable password with none saved: says so, and where to add one.
  const [enableNotice, setEnableNotice] = useState<null | 'none' | 'noVault'>(null);
  // Typing `enable` with none saved says so once per tab, not every time.
  const enableHintShownRef = useRef(false);
  const [copiedVaultKey, setCopiedVaultKey] = useState<'login' | 'enable' | null>(null);

  // "Send it when the device asks" as last saved in this window: the
  // session file may not be written yet when a lookup reads it.
  const savedAutoEnableRef = useRef<boolean | undefined>(undefined);
  const refreshVault = useCallback(async () => {
    try {
      const found = await vaultLookup(tab.sessionName, tab.hostname, tab.username);
      if (savedAutoEnableRef.current !== undefined) found.autoEnable = savedAutoEnableRef.current;
      setVault(found);
      if (found.locked) setVaultExists(await vaultIsInitialized());
    } catch {
      setVault(null);
    }
  }, [tab.sessionName, tab.hostname, tab.username]);

  useEffect(() => {
    void refreshVault();
    const onChange = () => void refreshVault();
    // The session's settings saved: "Send it when the device asks" and the
    // entry it uses may have changed.
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<SessionSavedDetail>).detail;
      if (detail?.name !== tab.sessionName) return;
      savedAutoEnableRef.current = detail.autoEnable;
      void refreshVault();
    };
    window.addEventListener(VAULT_CHANGED_EVENT, onChange);
    window.addEventListener(SESSION_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener(VAULT_CHANGED_EVENT, onChange);
      window.removeEventListener(SESSION_SAVED_EVENT, onSaved);
    };
  }, [refreshVault, tab.sessionName]);

  const sendVaultSecret = async (field: 'login' | 'enable', key: string | null = vaultKey) => {
    if (!key) return;
    const label = field === 'enable' ? 'enable password' : 'password';
    // Away from a password prompt the device echoes what's typed: at a shell
    // prompt the password would show on screen, run as a command and land
    // in the remote history and the session log.
    if (!detectedPasswordPrompt && !(await askConfirm({
      title: `Type the ${label} anyway?`,
      body: `No password prompt is showing. If the device echoes what is typed, the ${label} from "${key}" will be visible, and may land in its history and the session log.`,
      confirmLabel: `Type ${label}`,
      danger: true,
    }))) return;
    try {
      await vaultSendSecret(tab.id, key, field);
      addEventLog(`Sent the ${label} from vault entry "${key}"`, 'info');
      setDetectedPasswordPrompt(null);
    } catch (e) {
      addEventLog(`Vault: ${String(e)}`, 'error');
      void refreshVault();
    }
  };
  const handleSendVaultPassword = () => sendVaultSecret('login');
  const handleSendVaultEnablePassword = () => sendVaultSecret('enable');

  /** "Send Enable Password" from the menu or Ctrl+Shift+E. Always offered,
   *  so it can be found: with none saved it says so and offers to add one;
   *  with the vault locked it asks to unlock, then sends. */
  const requestEnablePassword = () => {
    if (isLocalSession) return;
    if (vault && !vault.locked && vault.key && vault.hasEnableSecret) {
      setEnableNotice(null);
      void sendVaultSecret('enable');
    } else if (vault?.locked && vaultExists) {
      unlockThenEnableRef.current = true;
      setUnlockOpen(true);
    } else {
      setEnableNotice(vault?.locked && !vaultExists ? 'noVault' : 'none');
    }
  };
  const requestEnableRef = useRef(requestEnablePassword);
  requestEnableRef.current = requestEnablePassword;

  // Unlocked to send the enable password: look the entry up again (the
  // state above is from before) and send it, or say there is none.
  const afterUnlock = async () => {
    if (!unlockThenEnableRef.current) return;
    unlockThenEnableRef.current = false;
    try {
      const found = await vaultLookup(tab.sessionName, tab.hostname, tab.username);
      if (found.key && found.hasEnableSecret) await sendVaultSecret('enable', found.key);
      else setEnableNotice('none');
    } catch (e) {
      addEventLog(`Vault: ${String(e)}`, 'error');
    }
  };

  const copyVaultSecret = async (field: 'login' | 'enable') => {
    if (!vaultKey) return;
    try {
      // Fetched for this copy only, never kept.
      const entry = await vaultGetEntry(vaultKey);
      const secret = field === 'enable' ? entry?.enable_secret : entry?.secret;
      if (!secret) {
        addEventLog('Vault: nothing to copy (is the vault locked?)', 'warn');
        return;
      }
      await writeClipboard(secret);
      setCopiedVaultKey(field);
      setTimeout(() => setCopiedVaultKey(null), 2000);
      // The clear below can't be verified in every webview (reading the
      // clipboard back may be refused), and clipboard managers keep their own
      // history -- so the message doesn't promise it.
      addEventLog(`Copied the ${field === 'enable' ? 'enable ' : ''}password to the clipboard; Thyrion will try to clear it in 25 s. A clipboard manager may keep a copy.`, 'info');
      setTimeout(async () => {
        try {
          if ((await readClipboard()) === secret) await writeClipboard('');
        } catch {
          // Can't check it's still ours, so leave the clipboard alone.
        }
      }, 25000);
    } catch (e) {
      addEventLog(`Vault: ${String(e)}`, 'error');
    }
  };
  const handleCopyVaultPassword = () => copyVaultSecret('login');
  const handleCopyVaultEnablePassword = () => copyVaultSecret('enable');

  // ---- Automatic answers (opt-in per session) ----------
  // SSH login needs none of this: plink logs in from the vault by itself.
  // What's left are prompts the device prints, which the device controls,
  // so each fires only on something the user did in this tab:
  //  - enable: right after the user typed enable/en/super (their keystrokes,
  //    not the echo) and the device asked for a password within 5 s; once.
  //  - Telnet/serial login: the device's Username:/Password: prompts, once
  //    each per connection.
  const typedRef = useRef<TypedInput>({ line: '', submitted: null });
  const autoLoginSentRef = useRef({ user: false, password: false });
  // The user has run a command in this connection: automatic console login
  // is over (promptDetect.ts, consoleLoginAction).
  const commandRunRef = useRef(false);
  // Returns true when it answered, so the manual Send chip stays hidden.
  const autoRespondRef = useRef<(kind: 'login' | 'enable' | null, recent: string) => boolean>(() => false);
  autoRespondRef.current = (kind, recent) => {
    const v = vault;
    const cmd = typedRef.current.submitted;
    const justAskedForEnable = !!cmd && isPrivilegeCommand(cmd.line) && Date.now() - cmd.at < 5000;
    // The device asks for an enable password and none is saved: say where
    // one goes, once per tab. (A locked vault has its own note.)
    if (kind && justAskedForEnable && !isLocalSession && !enableHintShownRef.current
        && !(v?.locked && vaultExists) && !(v && !v.locked && v.key && v.hasEnableSecret)) {
      enableHintShownRef.current = true;
      setEnableNotice(v?.locked ? 'noVault' : 'none');
    }
    if (!v || v.locked || !v.key) return false;
    const key = v.key;
    const autoSend = (field: 'login' | 'enable') =>
      vaultSendSecret(tab.id, key, field)
        .then(() => addEventLog(`Sent the ${field === 'enable' ? 'enable password' : 'password'} automatically (vault entry "${key}")`, 'info'))
        .catch(e => addEventLog(`Vault: ${String(e)}`, 'error'));

    if (kind && justAskedForEnable) {
      if (v.autoEnable && v.hasEnableSecret) {
        typedRef.current = { ...typedRef.current, submitted: null }; // once per enable
        void autoSend('enable');
        return true;
      }
      return false; // never answer an enable prompt with the login password
    }
    const action = consoleLoginAction({
      enabled: !!v.autoLogin && (tab.protocol === 'Telnet' || tab.protocol === 'Serial'),
      commandRun: commandRunRef.current,
      recent,
      promptKind: kind,
      hasUsername: !!v.username,
      sent: autoLoginSentRef.current,
    });
    if (action === 'username' && v.username) {
      autoLoginSentRef.current.user = true;
      writeTerminalInput(tab.id, new TextEncoder().encode(v.username + '\r'));
      addEventLog(`Sent the username automatically (vault entry "${key}")`, 'info');
      return true;
    }
    if (action === 'password') {
      autoLoginSentRef.current.password = true;
      void autoSend('login');
      return true;
    }
    return false;
  };

  return {
    vault, vaultExists, vaultKey, isVaultUnlocked, isVaultMenuOpen, setIsVaultMenuOpen,
    detectedPasswordPrompt, setDetectedPasswordPrompt, unlockOpen, setUnlockOpen, unlockThenEnableRef,
    enableNotice, setEnableNotice, copiedVaultKey, refreshVault,
    handleSendVaultPassword, handleSendVaultEnablePassword, requestEnablePassword, requestEnableRef, afterUnlock,
    handleCopyVaultPassword, handleCopyVaultEnablePassword,
    typedRef, autoLoginSentRef, commandRunRef, autoRespondRef,
  };
}
