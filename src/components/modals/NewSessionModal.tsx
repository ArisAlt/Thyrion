import React, { useState, useEffect, useRef } from 'react';
import { PuttySession, Protocol } from '../../types/session';
import { Terminal, X, Save } from 'lucide-react';
import {
  listSerialPorts, DetectedSerialPort,
  vaultListEntriesMeta, vaultSetEntry, VaultEntryMeta, VaultEntry,
  vaultIsInitialized, vaultIsUnlocked, vaultGetEntry, vaultDelete,
  VAULT_CHANGED_EVENT,
} from '../../services/tauriBridge';
import { VaultUnlockDialog } from '../vault/VaultUnlockDialog';
import { sessionsUsingVaultEntry } from '../../services/vaultKeys';
import { LogonAction, parseLogonActions, serializeLogonActions } from '../../services/tabColors';
import { SESSION_SAVED_EVENT, SessionSavedDetail, sessionLookFrom, pasteLineDelayFrom, keepaliveSecondsFrom, keepaliveKeys } from '../../services/appEvents';
import { GeneralTab } from './session/GeneralTab';
import { CredentialsTab } from './session/CredentialsTab';
import { JumpHostTab } from './session/JumpHostTab';
import { SerialTab } from './session/SerialTab';
import { AppearanceTab } from './session/AppearanceTab';
import { AdvancedTab } from './session/AdvancedTab';
import { VaultState, AutoLog } from './session/types';

export type SessionTab = 'general' | 'credentials' | 'jump' | 'serial' | 'appearance' | 'advanced';

/** The hop command a router jump types (NX-OS syntax; the backend's default too). */
const DEFAULT_HOP_COMMAND = 'ssh {user}@{host}';

const NO_VAULT_MESSAGE =
  'There is no vault yet, so the password was not saved. Create one first: Vault in the top bar, set a master password, then save this session again.';

interface NewSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (session: PuttySession) => void;
  editingSession?: PuttySession | null;
  savedSessions?: PuttySession[];
  /** A new session's folder, when opened from a folder's "New Session Here". */
  initialFolder?: string;
  /** The tab to open on, e.g. Credentials from a terminal's "Add an enable password". */
  initialTab?: SessionTab;
}

export const NewSessionModal: React.FC<NewSessionModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingSession,
  savedSessions = [],
  initialFolder,
  initialTab,
}) => {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [protocol, setProtocol] = useState<Protocol>('SSH');
  const [username, setUsername] = useState('');
  const [folder, setFolder] = useState('Saved Sessions');
  const [tags, setTags] = useState('');
  const [publicKeyFile, setPublicKeyFile] = useState('');

  // Encrypted Vault credentials state
  const [useVault, setUseVault] = useState(false);
  const [vaultMode, setVaultMode] = useState<'new' | 'link'>('new');
  const [vaultEntries, setVaultEntries] = useState<VaultEntryMeta[]>([]);
  const [selectedVaultKey, setSelectedVaultKey] = useState('');
  const [vaultKeyId, setVaultKeyId] = useState('');
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultEnablePassword, setVaultEnablePassword] = useState('');
  // "Remove" pressed on a saved enable password: dropped when saving.
  const [removeEnable, setRemoveEnable] = useState(false);
  const [vaultSaveError, setVaultSaveError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  // The vault entry this session already uses, when editing. Its password
  // isn't shown: left blank, it stays as it is.
  const [savedVaultKey, setSavedVaultKey] = useState<string | null>(null);
  // Unlock asked for in place; `save` continues the Save that needed it.
  const [unlockFor, setUnlockFor] = useState<null | 'edit' | 'save'>(null);
  const unlockDeclined = useRef(false);
  const [resubmit, setResubmit] = useState(false);
  // "Save without the password" in that unlock: the Save goes on and
  // leaves the vault alone.
  const saveWithoutVault = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Whether there is a vault to save into. On a first run there is none:
  // saving a password failed with "Vault is locked ... unlock the vault",
  // pointing at something that didn't exist yet.
  const [vaultState, setVaultState] = useState<VaultState>('unknown');
  const checkVault = async () => {
    try {
      if (!(await vaultIsInitialized())) setVaultState('none');
      else setVaultState((await vaultIsUnlocked()) ? 'ready' : 'locked');
    } catch {
      setVaultState('unknown');
    }
  };
  // Automatic answers from the vault (opt-in per session).
  const [autoEnable, setAutoEnable] = useState(false);
  const [autoLogin, setAutoLogin] = useState(false);
  // Paste line delay in ms ('' or 0 = paste normally).
  const [pasteDelay, setPasteDelay] = useState('');
  // Automatic log (PlinkyAutoLog): follow Settings > Logging, always, never.
  const [autoLog, setAutoLog] = useState<AutoLog>('global');
  // Connection (T-016): PuTTY's keepalive settings and Thyrion's auto-reconnect.
  const [keepalive, setKeepalive] = useState('');
  const [tcpKeepalives, setTcpKeepalives] = useState(false);
  const [autoReconnect, setAutoReconnect] = useState(false);
  // SecureCRT-style logon actions and a tab colour (tabColors.ts).
  const [logonActions, setLogonActions] = useState<LogonAction[]>([]);
  const [tabColor, setTabColor] = useState('');
  // The session's own appearance; '' follows Settings (appEvents SessionLook).
  const [lookScheme, setLookScheme] = useState('');
  const [lookFont, setLookFont] = useState('');
  const [lookSize, setLookSize] = useState('');

  // Serial-specific state
  const [serialPorts, setSerialPorts] = useState<DetectedSerialPort[]>([]);
  const [isRefreshingPorts, setIsRefreshingPorts] = useState(false);
  const [pickedTab, setTab] = useState<SessionTab>('general');
  const [serialLine, setSerialLine] = useState('');
  const [isCustomSerialLine, setIsCustomSerialLine] = useState(false);
  const [serialSpeed, setSerialSpeed] = useState('9600');
  const [serialDataBits, setSerialDataBits] = useState('8');
  const [serialStopBits, setSerialStopBits] = useState('2'); // 2 = 1 stop bit
  const [serialParity, setSerialParity] = useState('0'); // 0 = None
  const [serialFlowControl, setSerialFlowControl] = useState('1'); // 1 = XON/XOFF

  // Jump Host (MobaXterm style) state
  const [enableJumpHost, setEnableJumpHost] = useState(false);
  const [jumpHost, setJumpHost] = useState('');
  const [jumpPort, setJumpPort] = useState('22');
  // How the jump host reaches the target. "tunnel": PuTTY's SSH proxy (a
  // Linux bastion forwards the connection). "cli": log in to the device and
  // type the hop command at its prompt -- NX-OS and IOS refuse the tunnel,
  // which hung the session right after the jump password.
  const [jumpMode, setJumpMode] = useState<'tunnel' | 'cli'>('tunnel');
  const [jumpCommand, setJumpCommand] = useState(DEFAULT_HOP_COMMAND);
  const [jumpUsername, setJumpUsername] = useState('');
  // A saved session picked as the bastion: stored by name, so plink uses
  // that session's own host, port, username and key file (tested against a
  // real bastion/target pair with no agent running).
  const [jumpPreset, setJumpPreset] = useState<string | null>(null);
  // The jump host's password, typed here and stored only in the vault (as
  // "jump:<session>", linked by PlinkyJumpVaultKey). Never kept in the
  // PuTTY session. Blank on edit: blank keeps the stored one.
  const [jumpPassword, setJumpPassword] = useState('');
  const [jumpVaultKey, setJumpVaultKey] = useState<string | null>(null);
  const pressedOnBackdrop = useRef(false);
  // The session being edited already goes through a jump host: offer to
  // remove it, and say what saving will do once it's off.
  const hadJumpHost = editingSession?.extra?.PlinkyJumpHost === '1' || editingSession?.extra?.ProxyMethod === '6';

  const refreshPorts = async () => {
    setIsRefreshingPorts(true);
    try {
      const ports = await listSerialPorts();
      setSerialPorts(ports);
      if (ports.length > 0) {
        const firstUsb = ports.find(p => p.is_usb);
        // Functional update: by the time the scan returns, the session being
        // edited has loaded its saved line, but this closure still sees the
        // value from before -- testing that replaced the saved port with the
        // first one detected, and Save wrote it.
        setSerialLine(cur => cur || (firstUsb ?? ports[0]).port_name);
      }
    } finally {
      setIsRefreshingPorts(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setTab(initialTab ?? 'general');
    setUnlockFor(null);
    unlockDeclined.current = false;
    refreshPorts();
    setVaultSaveError(null);
    setNameError(null);
    vaultListEntriesMeta().then(setVaultEntries).catch(() => {});
    void checkVault();
    if (editingSession) {
      setName(editingSession.name);
      setHostname(editingSession.hostname);
      setPort(String(editingSession.port || 22));
      setProtocol(editingSession.protocol);
      setUsername(editingSession.username || '');
      setFolder(editingSession.folder || 'Saved Sessions');
      setTags((editingSession.tags || []).join(', '));
      setPublicKeyFile(editingSession.publicKeyFile || '');

      // Load serial settings
      const extra = editingSession.extra || {};
      const line = extra.SerialLine || (editingSession.protocol === 'Serial' ? editingSession.hostname : '');
      setSerialLine(line);
      setSerialSpeed(extra.SerialSpeed || String(editingSession.port || 9600));
      setSerialDataBits(extra.SerialDataBits || '8');
      setSerialStopBits(extra.SerialStopHalfbits || '2');
      setSerialParity(extra.SerialParity || '0');
      setSerialFlowControl(extra.SerialFlowControl || '1');

      // Load jump host settings
      // Only Thyrion's own jump host (or PuTTY's SSH proxy type) counts. Any
      // ProxyHost used to, so an HTTP/SOCKS proxy set up in real PuTTY showed
      // up here and was rewritten as a jump host on save.
      const hasJumpHost = extra.PlinkyJumpHost === '1' || extra.ProxyMethod === '6';
      const preset = hasJumpHost ? savedSessions.find(s => s.name === extra.ProxyHost) : undefined;
      setEnableJumpHost(hasJumpHost);
      setJumpPreset(preset ? preset.name : null);
      setJumpHost(hasJumpHost ? (preset ? preset.hostname : extra.ProxyHost || '') : '');
      setJumpPort(hasJumpHost ? (preset ? String(preset.port || 22) : extra.ProxyPort || '22') : '22');
      setJumpMode(extra.PlinkyJumpMode === 'cli' ? 'cli' : 'tunnel');
      setJumpCommand(extra.PlinkyJumpCommand || DEFAULT_HOP_COMMAND);
      setJumpUsername(hasJumpHost ? (preset ? preset.username || '' : extra.ProxyUsername || '') : '');
      setJumpPassword('');
      setJumpVaultKey(hasJumpHost && extra.PlinkyJumpVaultKey ? extra.PlinkyJumpVaultKey : null);

      // Load vault credentials key. Shown as the entry itself, password
      // blank = unchanged. It opened on "Link to existing", which with the
      // vault locked was an empty list and a warning, for a session whose
      // login was fine.
      if (extra.PlinkyVaultKey) {
        setUseVault(true);
        setVaultMode('new');
        setSelectedVaultKey(extra.PlinkyVaultKey);
        setVaultKeyId(extra.PlinkyVaultKey);
        setSavedVaultKey(extra.PlinkyVaultKey);
      } else {
        setSavedVaultKey(null);
        setUseVault(false);
        setVaultMode('new');
        setSelectedVaultKey('');
        setVaultKeyId(`session:${editingSession.name}`);
      }
      setVaultPassword('');
      setVaultEnablePassword('');
      setRemoveEnable(false);
      setAutoEnable(extra.PlinkyAutoEnable === '1');
      setAutoLogin(extra.PlinkyAutoLogin === '1');
      const delay = pasteLineDelayFrom(extra);
      setPasteDelay(delay ? String(delay) : '');
      setAutoLog(extra.PlinkyAutoLog === '1' ? 'always' : extra.PlinkyAutoLog === '0' ? 'never' : 'global');
      const ka = keepaliveSecondsFrom(extra);
      setKeepalive(ka ? String(ka) : '');
      setTcpKeepalives(extra.TCPKeepalives === '1');
      setAutoReconnect(extra.PlinkyAutoReconnect === '1');
      setLogonActions(parseLogonActions(extra.PlinkyLogonActions));
      setTabColor(extra.PlinkyTabColor || '');
      setLookScheme(extra.PlinkyColourScheme || '');
      setLookFont(extra.PlinkyFontFamily || '');
      setLookSize(extra.PlinkyFontSize || '');
    } else {
      setLogonActions([]);
      setTabColor('');
      setLookScheme('');
      setLookFont('');
      setLookSize('');
      setName('');
      setHostname('');
      setPort('22');
      setProtocol('SSH');
      setUsername('');
      setFolder(initialFolder || 'Saved Sessions');
      setTags('');
      setPublicKeyFile('');
      setSerialLine('');
      setIsCustomSerialLine(false);
      setSerialSpeed('9600');
      setSerialDataBits('8');
      setSerialStopBits('2');
      setSerialParity('0');
      setSerialFlowControl('1');
      setEnableJumpHost(false);
      setJumpHost('');
      setJumpPort('22');
      setJumpMode('tunnel');
      setJumpCommand(DEFAULT_HOP_COMMAND);
      setJumpUsername('');
      setJumpPreset(null);
      setUseVault(false);
      setVaultMode('new');
      setSelectedVaultKey('');
      setVaultKeyId('');
      setSavedVaultKey(null);
      setJumpPassword('');
      setJumpVaultKey(null);
      setVaultPassword('');
      setVaultEnablePassword('');
      setRemoveEnable(false);
      setAutoEnable(false);
      setAutoLogin(false);
      setPasteDelay('');
      setAutoLog('global');
      setKeepalive('');
      setTcpKeepalives(false);
      setAutoReconnect(false);
    }
  }, [isOpen, editingSession, initialFolder]);

  // Ticking "Save credentials", or opening a saved session's credentials,
  // with the vault locked asks for the master password there and then.
  // Once per opening: "Not now" means not now.
  const pickedCredentials = pickedTab === 'credentials';
  useEffect(() => {
    if (isOpen && useVault && vaultState === 'locked' && pickedCredentials && !unlockDeclined.current && unlockFor === null) {
      setUnlockFor('edit');
    }
  }, [isOpen, useVault, vaultState, pickedCredentials, unlockFor]);

  // A Save that stopped for the unlock goes on once the entries are loaded.
  useEffect(() => {
    if (!resubmit) return;
    setResubmit(false);
    formRef.current?.requestSubmit();
  }, [resubmit]);

  const afterUnlock = async () => {
    const again = unlockFor === 'save';
    // Unlocked in the same render that closes the window. Marked only once
    // the entries had loaded, the window closed with the vault still
    // "locked" in between, and opening Credentials with the vault locked
    // asked again: after a wrong master password, the right one seemed not
    // to close the window.
    setVaultState('ready');
    setUnlockFor(null);
    try { setVaultEntries(await vaultListEntriesMeta()); } catch { /* listed on the next change */ }
    if (again) setResubmit(true);
  };

  // Cancelling the unlock used to cancel the Save too, with nothing said:
  // the session and everything typed into it were simply not saved.
  const saveSkippingVault = () => {
    setUnlockFor(null);
    unlockDeclined.current = true;
    saveWithoutVault.current = true;
    setResubmit(true);
  };

  // Unlocking the vault with this dialog open fills "Link to existing".
  useEffect(() => {
    if (!isOpen) return;
    const reload = () => {
      vaultListEntriesMeta().then(setVaultEntries).catch(() => setVaultEntries([]));
      void checkVault();
    };
    window.addEventListener(VAULT_CHANGED_EVENT, reload);
    return () => window.removeEventListener(VAULT_CHANGED_EVENT, reload);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Host first, as in PuTTY; the name defaults to the host when left
    // empty, so a quick save needs one field, not two.
    const sessionName = name.trim() || hostname.trim() || (protocol === 'Serial' ? serialLine.trim() : '');
    if (!sessionName) return;
    setVaultSaveError(null);
    const skipVault = saveWithoutVault.current;
    saveWithoutVault.current = false;
    // Saving writes PuTTY's session of that name, whatever was there: a new
    // session, or a rename, onto a name already saved replaced that other
    // session without a word (e2e suite). Compared without case: Windows
    // keeps sessions in the registry, where R1 and r1 are the same key.
    const taken = savedSessions.find(s =>
      s.name.toLowerCase() === sessionName.toLowerCase()
      && s.name !== editingSession?.name);
    if (taken) {
      setNameError(`A session named "${taken.name}" is already saved. Choose another name, or change that session instead.`);
      setTab('general');
      return;
    }

    // Writing or checking a vault entry needs it unlocked: ask, then carry
    // on. With no vault yet and a password to keep, offer to create one.
    const jumpInUse = protocol === 'SSH' && enableJumpHost && !jumpPreset && !!jumpHost.trim();
    const typedSecret = (useVault && vaultMode === 'new' && (!!vaultPassword || !!vaultEnablePassword)) || (jumpInUse && !!jumpPassword);
    const needsVault = (useVault && vaultMode === 'new') || (jumpInUse && !!jumpPassword);
    let noVault = vaultState === 'none';
    if (needsVault && !skipVault) {
      noVault = !(await vaultIsInitialized().catch(() => true));
      const open = !noVault && await vaultIsUnlocked().catch(() => false);
      if (!open && (!noVault || typedSecret)) {
        setVaultState(noVault ? 'none' : 'locked');
        setUnlockFor('save');
        return;
      }
    }

    const isSerial = protocol === 'Serial';
    const tagArray = tags.split(',').map(t => t.trim()).filter(Boolean);
    const extra: Record<string, string> = editingSession?.extra ? { ...editingSession.extra } : {};

    let finalHostname = hostname.trim();
    let finalPort = parseInt(port, 10) || 22;

    if (isSerial) {
      const activeLine = serialLine.trim() || '/dev/ttyUSB0';
      finalHostname = activeLine;
      finalPort = parseInt(serialSpeed, 10) || 9600;

      extra.SerialLine = activeLine;
      extra.SerialSpeed = serialSpeed || '9600';
      extra.SerialDataBits = serialDataBits || '8';
      extra.SerialStopHalfbits = serialStopBits || '2';
      extra.SerialParity = serialParity || '0';
      extra.SerialFlowControl = serialFlowControl || '1';
    } else {
      delete extra.SerialLine;
      delete extra.SerialSpeed;
      delete extra.SerialDataBits;
      delete extra.SerialStopHalfbits;
      delete extra.SerialParity;
      delete extra.SerialFlowControl;

      // PuTTY's own SSH proxy (ProxyMethod 6): plink connects to the bastion
      // itself and forwards to the target, asking about each host key in
      // turn. The previous local-command proxy (5) never worked: it used
      // "%proxyuser", which PuTTY doesn't substitute (it's %user), so every
      // bastion login was as the literal user "%proxyuser".
      const wasJumpHost = editingSession?.extra?.PlinkyJumpHost === '1' || editingSession?.extra?.ProxyMethod === '6';
      if (protocol === 'SSH' && enableJumpHost && (jumpPreset || jumpHost.trim())) {
        // A router jump is Thyrion's own (a script); PuTTY must not tunnel.
        extra.ProxyMethod = jumpMode === 'cli' ? '0' : '6';
        if (jumpMode === 'cli') {
          extra.PlinkyJumpMode = 'cli';
          extra.PlinkyJumpCommand = jumpCommand.trim() || DEFAULT_HOP_COMMAND;
        } else {
          delete extra.PlinkyJumpMode;
          delete extra.PlinkyJumpCommand;
        }
        extra.ProxyHost = jumpPreset ?? jumpHost.trim();
        extra.ProxyPort = jumpPort.trim() || '22';
        if (jumpPreset) delete extra.ProxyUsername; // the saved session's own user applies
        else extra.ProxyUsername = jumpUsername.trim();
        delete extra.ProxyTelnetCommand;
        extra.PlinkyJumpHost = '1';
      } else if (wasJumpHost) {
        // Only undo Thyrion's own jump host; a PuTTY proxy stays as it was.
        delete extra.ProxyMethod;
        delete extra.ProxyHost;
        delete extra.ProxyPort;
        delete extra.ProxyUsername;
        delete extra.ProxyTelnetCommand;
        delete extra.PlinkyJumpHost;
        delete extra.PlinkyJumpVaultKey;
        delete extra.PlinkyJumpMode;
        delete extra.PlinkyJumpCommand;
      }
    }

    // The jump host's own vault login. A saved session picked as the jump
    // host brings its own vault entry, so nothing is stored for it here.
    if (jumpInUse && jumpPassword && skipVault) {
      // Saved without the vault: the password typed is not stored, and a
      // stored one this session already had stays linked.
    } else if (jumpInUse && jumpPassword) {
      if (noVault) {
        setVaultSaveError(NO_VAULT_MESSAGE);
        setTab('jump');
        return;
      }
      if (!jumpUsername.trim()) {
        setVaultSaveError('Enter the gateway username: the stored password is only sent at that user\'s password prompt.');
        setTab('jump');
        return;
      }
      const key = `jump:${sessionName}`;
      const now = Math.floor(Date.now() / 1000);
      try {
        await vaultSetEntry({
          id: key,
          username: jumpUsername.trim(),
          secret: jumpPassword,
          notes: `Jump host ${jumpUsername.trim()}@${jumpHost.trim()} for session "${sessionName}"`,
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        const noVault = !(await vaultIsInitialized().catch(() => true));
        setVaultSaveError(noVault
          ? NO_VAULT_MESSAGE
          : `The gateway password wasn't saved: ${String(err)}. Unlock the vault (Vault in the top bar), then save again.`);
        setTab('jump');
        return;
      }
      extra.PlinkyJumpVaultKey = key;
    } else if (!jumpInUse) {
      delete extra.PlinkyJumpVaultKey;
    }

    // Encrypted Vault Credential Binding
    if (useVault) {
      if (vaultMode === 'link' && selectedVaultKey) {
        extra.PlinkyVaultKey = selectedVaultKey;
      } else if (vaultMode === 'new' && skipVault) {
        // Saved without the vault: nothing is written to it, and the session
        // keeps only the entry it already had (one it can't check is not
        // linked: a link to an entry that isn't there finds nothing).
        const finalKeyId = vaultKeyId.trim() || `session:${sessionName}`;
        if (finalKeyId !== savedVaultKey) delete extra.PlinkyVaultKey;
      } else if (vaultMode === 'new') {
        const finalKeyId = vaultKeyId.trim() || `session:${sessionName}`;
        if ((vaultPassword || vaultEnablePassword) && noVault) {
          setVaultSaveError(NO_VAULT_MESSAGE);
          setTab('credentials');
          return;
        }
        const exists = vaultEntries.some(v => v.id === finalKeyId);
        if (vaultPassword || vaultEnablePassword || (exists && removeEnable)) {
          const now = Math.floor(Date.now() / 1000);
          // Left blank, a password stays what it was: replacing the login
          // password used to drop the enable password with it.
          const prev = exists ? await vaultGetEntry(finalKeyId) : null;
          const keptEnable = removeEnable ? undefined : prev?.enable_secret;
          const entry: VaultEntry = {
            id: finalKeyId,
            username: isSerial ? undefined : (username.trim() || prev?.username || undefined),
            // Never trimmed: a password with a leading or trailing space is
            // a different password.
            secret: vaultPassword || prev?.secret || '',
            enable_secret: vaultEnablePassword || keptEnable || undefined,
            notes: prev?.notes || `Saved credentials for session "${sessionName}"`,
            created_at: prev?.created_at ?? now,
            updated_at: now,
          };
          // A console may ask for no login, only an enable password: an
          // entry with just that is fine (the backend never sends an empty
          // login password). An entry with neither is not.
          const emptied = !entry.secret && !entry.enable_secret;
          if (emptied && !(exists && removeEnable)) {
            setVaultSaveError('Enter the login password, the enable password or both to save in the vault.');
            setTab('credentials');
            return;
          }
          if (emptied) {
            // Remove took the entry's only password. Saving it empty was
            // refused, so the Remove could never be saved: drop the entry
            // instead, or only this session's link when others use it.
            if (vaultEntryUsers(finalKeyId).length === 0 && !(await vaultDelete(finalKeyId))) {
              setVaultSaveError(`The enable password wasn't removed: vault entry "${finalKeyId}" couldn't be deleted. Unlock the vault (Vault in the top bar), then save again.`);
              setTab('credentials');
              return;
            }
            delete extra.PlinkyVaultKey;
          } else {
            // This failed silently when the vault was locked: the dialog
            // closed, the session was linked to an entry that didn't exist,
            // and the password was simply gone. Stay open and say why.
            try {
              await vaultSetEntry(entry);
            } catch (err) {
              const noVault = !(await vaultIsInitialized().catch(() => true));
              setVaultSaveError(noVault
                ? NO_VAULT_MESSAGE
                : `The password wasn't saved: ${String(err)}. Unlock the vault (Vault in the top bar), then save again.`);
              setTab('credentials');
              return;
            }
            extra.PlinkyVaultKey = finalKeyId;
          }
        } else if (exists) {
          extra.PlinkyVaultKey = finalKeyId;
        } else {
          // Linking to an entry that doesn't exist left a dangling key.
          setVaultSaveError('Enter the login password, the enable password or both to save in the vault, or untick "Save Credentials in Encrypted Vault".');
          setTab('credentials');
          return;
        }
      }
    } else {
      delete extra.PlinkyVaultKey;
    }

    if (autoEnable) extra.PlinkyAutoEnable = '1'; else delete extra.PlinkyAutoEnable;
    if (!isSerial) {
      // Keepalives stop idle NAT/firewall timeouts killing the session and
      // let plink notice a dead link, which is what auto-reconnect acts on.
      Object.assign(extra, keepaliveKeys(parseInt(keepalive, 10) || 0));
      extra.TCPKeepalives = tcpKeepalives ? '1' : '0';
    }
    const autoReconnectOn = autoReconnect && !isSerial;
    if (autoReconnectOn) extra.PlinkyAutoReconnect = '1'; else delete extra.PlinkyAutoReconnect;
    const logon = serializeLogonActions(logonActions);
    if (logon) extra.PlinkyLogonActions = logon; else delete extra.PlinkyLogonActions;
    if (tabColor) extra.PlinkyTabColor = tabColor; else delete extra.PlinkyTabColor;
    if (lookScheme) extra.PlinkyColourScheme = lookScheme; else delete extra.PlinkyColourScheme;
    if (lookFont) extra.PlinkyFontFamily = lookFont; else delete extra.PlinkyFontFamily;
    if (lookSize) extra.PlinkyFontSize = lookSize; else delete extra.PlinkyFontSize;
    const pasteLineDelayMs = pasteLineDelayFrom({ PlinkyPasteLineDelayMs: pasteDelay });
    if (pasteLineDelayMs > 0) extra.PlinkyPasteLineDelayMs = String(pasteLineDelayMs);
    else delete extra.PlinkyPasteLineDelayMs;
    if (autoLog === 'always') extra.PlinkyAutoLog = '1';
    else if (autoLog === 'never') extra.PlinkyAutoLog = '0';
    else delete extra.PlinkyAutoLog;
    if (autoLogin && (protocol === 'Telnet' || protocol === 'Serial')) extra.PlinkyAutoLogin = '1';
    else delete extra.PlinkyAutoLogin;

    const session: PuttySession = {
      name: sessionName,
      hostname: finalHostname,
      port: finalPort,
      protocol,
      username: isSerial ? undefined : (username.trim() || undefined),
      folder: folder.trim() || 'Saved Sessions',
      tags: tagArray.length > 0 ? tagArray : undefined,
      publicKeyFile: isSerial ? undefined : (publicKeyFile.trim() || undefined),
      extra,
      log_file_name: editingSession?.log_file_name,
      lastConnected: editingSession?.lastConnected,
    };

    onSave(session);
    // Open terminals of this session apply the new delay right away.
    window.dispatchEvent(new CustomEvent<SessionSavedDetail>(SESSION_SAVED_EVENT, {
      detail: { name: session.name, pasteLineDelayMs, autoReconnect: autoReconnectOn, autoEnable, look: sessionLookFrom(extra) },
    }));
    onClose();
  };

  const isSerial = protocol === 'Serial';
  // The other saved sessions that use vault entry `key`: linked to it, or
  // finding it under one of the backend's fallback names (a bare session
  // name, user@host, host). Only the link and "session:<name>" were
  // counted, so an entry shared through a fallback name was deleted.
  const vaultEntryUsers = (key: string) =>
    sessionsUsingVaultEntry(key, savedSessions, new Set(vaultEntries.map(v => v.id)), editingSession?.name);

  // The tabs this protocol has. A dot marks one holding non-default settings.
  const visibleTabs: { id: SessionTab; label: string; on?: boolean }[] = [
    { id: 'general', label: 'General' },
    { id: 'credentials', label: 'Credentials & Vault', on: useVault || (protocol === 'SSH' && !!publicKeyFile.trim()) },
    ...(protocol === 'SSH' ? [{ id: 'jump' as const, label: 'Jump Host', on: enableJumpHost }] : []),
    ...(isSerial ? [{ id: 'serial' as const, label: 'Serial' }] : []),
    { id: 'appearance', label: 'Appearance', on: !!(lookScheme || lookFont || lookSize) },
    { id: 'advanced', label: 'Advanced', on: (!isSerial && (parseInt(keepalive, 10) > 0 || autoReconnect)) || parseInt(pasteDelay, 10) > 0 || autoLog !== 'global' || logonActions.some(a => a.send.trim()) },
  ];
  // Switching protocol can take away the tab that was open (Jump Host).
  const tab: SessionTab = visibleTabs.some(t => t.id === pickedTab) ? pickedTab : 'general';

  return (
    <div
      // Only a click that starts AND ends on the backdrop closes the dialog.
      // A drag that ends outside (selecting text in a field) used to close it,
      // losing every edit.
      onMouseDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOnBackdrop.current) onClose();
        pressedOnBackdrop.current = false;
      }}
      className="fixed inset-0 bg-plinky-950/75 backdrop-blur-xs flex items-center justify-center z-50 p-4 select-none"
    >
      <div role="dialog" aria-modal="true" aria-labelledby="new-session-title" className="bg-plinky-900 border border-plinky-700 rounded-lg w-[560px] max-w-full shadow-2xl flex flex-col overflow-hidden text-xs max-h-[90vh]">
        {/* Header */}
        <div className="p-3 bg-plinky-950 border-b border-plinky-800 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Terminal className="w-4 h-4 text-sky-400" />
            <h3 id="new-session-title" className="font-semibold text-slate-100 text-base">
              {editingSession ? `Session Settings — ${editingSession.name}` : 'New session'}
            </h3>
          </div>
          <button aria-label="Close"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-plinky-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs (T-014). Every panel stays mounted, hidden when not
            shown, so switching tabs never loses what was typed. */}
        <div role="tablist" aria-label="Session settings" className="flex items-end px-2 pt-1.5 bg-plinky-950 border-b border-plinky-800 shrink-0 overflow-x-auto overflow-y-hidden">
          {visibleTabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`relative px-3 py-1.5 -mb-px rounded-t border text-meta font-medium whitespace-nowrap transition ${
                tab === t.id
                  ? 'bg-plinky-900 border-plinky-800 border-b-plinky-900 text-sky-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
              {t.on && <span aria-hidden className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-sky-400" />}
            </button>
          ))}
        </div>

        {/* Form Body */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          // A required field on a hidden tab would block Save with nothing
          // on screen to say why: show the tab that holds it.
          onInvalidCapture={e => {
            const owner = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as SessionTab | undefined;
            if (owner && owner !== tab) setTab(owner);
          }}
          className="flex-1 flex flex-col overflow-hidden"
        >
          {/* A fixed height, not a floor. Measured body heights per tab
              (13px text, every option ticked): General 350, Credentials 330
              to 531, Jump Host 330 to 407, Advanced 330. With only a floor
              the dialog grew and re-centred as tabs changed, so the tabs and
              Save moved under the pointer; once, a click aimed at Save landed
              on the backdrop and closed it unsaved. 440 px
              holds every tab but a fully expanded Credentials, which scrolls
              inside; short screens get less, never more than fits. */}
          <div className="p-4 overflow-y-auto h-[min(440px,calc(100vh-220px))] shrink-0">
            <div data-tab="general" hidden={tab !== 'general'} className="space-y-3">
              <GeneralTab {...{
                protocol, setProtocol, port, setPort, hostname, setHostname, name, setName, nameError,
                setNameError, editingSession, folder, setFolder, tags, setTags, tabColor, setTabColor,
                serialPorts, refreshPorts, isRefreshingPorts, serialLine, setSerialLine, isCustomSerialLine,
                setIsCustomSerialLine, serialSpeed, setSerialSpeed
              }} />
            </div>

            <div data-tab="credentials" hidden={tab !== 'credentials'} className="space-y-3">
              <CredentialsTab {...{
                protocol, name, username, setUsername, publicKeyFile, setPublicKeyFile, useVault, setUseVault,
                vaultState, setUnlockFor, vaultMode, setVaultMode, vaultEntries, selectedVaultKey,
                setSelectedVaultKey, vaultKeyId, setVaultKeyId, savedVaultKey, vaultPassword, setVaultPassword,
                vaultEnablePassword, setVaultEnablePassword, removeEnable, setRemoveEnable, vaultEntryUsers,
                enableJumpHost, autoEnable, setAutoEnable, autoLogin, setAutoLogin
              }} />
            </div>

            <div data-tab="jump" hidden={tab !== 'jump'} className="space-y-3">
              <JumpHostTab {...{
                protocol, name, hostname, savedSessions, hadJumpHost, enableJumpHost, setEnableJumpHost,
                jumpMode, setJumpMode, jumpCommand, setJumpCommand, jumpPreset, setJumpPreset, jumpHost,
                setJumpHost, jumpPort, setJumpPort, jumpUsername, setJumpUsername, jumpPassword,
                setJumpPassword, jumpVaultKey
              }} />
            </div>

            <div data-tab="serial" hidden={tab !== 'serial'} className="space-y-3">
              <SerialTab {...{
                serialDataBits, setSerialDataBits, serialStopBits, setSerialStopBits, serialParity,
                setSerialParity, serialFlowControl, setSerialFlowControl
              }} />
            </div>

            <div data-tab="appearance" hidden={tab !== 'appearance'} className="space-y-3">
              <AppearanceTab {...{
                lookScheme, setLookScheme, lookFont, setLookFont, lookSize, setLookSize
              }} />
            </div>

            <div data-tab="advanced" hidden={tab !== 'advanced'} className="space-y-3">
              <AdvancedTab {...{
                protocol, name, hostname, folder, keepalive, setKeepalive, tcpKeepalives, setTcpKeepalives,
                autoReconnect, setAutoReconnect, autoLog, setAutoLog, pasteDelay, setPasteDelay, logonActions,
                setLogonActions
              }} />
            </div>

            {vaultSaveError && (
              <div role="alert" className="p-2 rounded border border-rose-500/40 bg-rose-950/40 text-rose-300 text-meta">
                {vaultSaveError}
              </div>
            )}

          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-2 px-4 py-3 border-t border-plinky-800 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded bg-plinky-800 text-slate-300 hover:bg-plinky-700 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded bg-sky-700 hover:brightness-110 text-on-accent font-medium shadow-sm transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{editingSession ? 'Save Changes' : 'Save session'}</span>
            </button>
          </div>
        {unlockFor && (
            <VaultUnlockDialog
              mode={vaultState === 'none' ? 'create' : 'unlock'}
              reason={vaultState === 'none'
                ? (unlockFor === 'save'
                  ? 'There is no vault yet to keep this session\'s password in. Create one and the save carries on, or save the session without the password.'
                  : 'Passwords are kept in the vault. Create one, then save the session to store its password in it.')
                : (unlockFor === 'save'
                  ? 'Saving this session writes its password to the vault. Unlock it and the save carries on, or save the session without the password.'
                  : 'This session keeps its password in the vault. Unlock it to see or change the entry.')}
              onUnlocked={() => { void afterUnlock(); }}
              /* Escape goes back to the settings, nothing saved. */
              onCancel={() => { unlockDeclined.current = true; setUnlockFor(null); }}
              onSkip={unlockFor === 'save' ? saveSkippingVault : undefined}
              skipLabel="Save without the password"
            />
          )}
        </form>
      </div>
    </div>
  );
};
