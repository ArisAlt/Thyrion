import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { TerminalTab, SyncChannel } from '../../types/session';
import { terminalManager } from '../../services/terminalManager';
import { 
  startTerminalSession, 
  attachTerminalSession,
  startSessionLog,
  stopSessionLog,
  sessionLogStatus,
  detachTerminalSession,
  backgroundStartOf,
  targetProtocolOf,
  createOutputAcker,
  writeTerminalInput, 
  resizeTerminal, 
  closeTerminalSession,
  answerHostKeyPrompt,
  showHostKeys,
  listenHostKeyPrompts,
  setSyncChannel,
  HostKeyPromptInfo,
  injectShellIntegration,
  isTauriEnvironment,
  isSessionClosed,
  sendBreak,
  readPuttySession,
  listenSessionConnected,
  isSessionConnected,
  pickScriptFile,
  runScript,
  stopScript,
  listenScriptStarted,
  setSessionLocked,
  listenScriptLog,
  listenScriptEnded,
  cancelPaste,
  reopenSessionId,
} from '../../services/tauriBridge';
import {
  classifyPasswordPrompt, appendRecentOutput, trackTypedInput, isCommandSubmission,
} from '../../services/promptDetect';
import { KeywordHighlighter } from '../../services/keywordHighlight';
import { shouldTakeHoverFocus } from '../../services/hoverFocus';
import { useBroadcastGlow, glowColor } from '../../services/broadcast';
import { SESSION_SAVED_EVENT, SessionSavedDetail, SessionLook, sessionLookFrom, pasteLineDelayFrom } from '../../services/appEvents';
import { useTerminalTheme, findTerminalTheme } from '../../themes/terminalThemes';
import { useScrollback } from '../../services/scrollback';
import { newId } from '../../services/ids';
import { VaultUnlockDialog } from '../vault/VaultUnlockDialog';
import { HostKeyDialog, storedFingerprint } from './HostKeyDialog';
import { TerminalContextMenu, HookShell } from './TerminalContextMenu';
import { EventLogDialog, SessionLogDialog, PuTTYEventLog } from './TerminalLogDialogs';
import { TerminalSearchBar } from './TerminalSearchBar';
import { TerminalHeader } from './TerminalHeader';
import { registerLinks } from './terminalLinks';
import { registerShellIntegration, jumpToPrompt } from './shellIntegration';
import { readOutputStatus } from '../../services/outputStatus';
import { useTerminalVault } from './useTerminalVault';
import { useTerminalPaste, listenForPastes } from './useTerminalPaste';
import { useAutoReconnect } from './useAutoReconnect';
import {
  DropOverlay, ConnectingOverlay, HostKeyChangedBar, ConnectionBar, LockedBar, ScriptBar,
  PasteProgressBar, PasswordPromptBar, VaultLockedPromptBar, EnableNoticeBar,
} from './TerminalStatusBars';
import { fatalHint, sshBannerHint } from '../../services/fatalHint';
import { terminalShortcut, keySequenceFor } from '../../services/shortcuts';
import { writeClipboard, copiedText } from '../../services/clipboard';
import { DEFAULT_TERMINAL_FONT, loadTerminalFont } from '../../themes/fonts';

interface TerminalViewProps {
  tab: TerminalTab;
  onUpdateTab: (tabId: string, updates: Partial<TerminalTab>) => void;
  onSplitPane?: (direction: 'vertical' | 'horizontal') => void;
  onCwdChange?: (cwd: string) => void;
  onDuplicateTab?: (tab: TerminalTab) => void;
  onOpenSettings?: () => void;
  /** Opens this tab's saved session's settings, on Credentials when asked;
   *  absent for a tab with no saved session (a GNS3 console, a local shell). */
  onEditSessionSettings?: (section?: 'credentials') => void;
  fontFamily?: string;
  fontSize?: number;
  cursorStyle?: 'block' | 'bar' | 'underline';
  copyOnSelect?: boolean;
  rightClickAction?: 'paste' | 'contextMenu';
  /** The mouse moved into this terminal and it took the keyboard focus. */
  onHoverFocus?: () => void;
  /** Shown in the header in place of the session name: a split pane puts
   *  its number and its tab picker here, so the name isn't shown twice. */
  titleSlot?: React.ReactNode;
}

export const TerminalView: React.FC<TerminalViewProps> = ({ 
  tab, 
  onUpdateTab,
  onSplitPane,
  onCwdChange,
  onDuplicateTab,
  onOpenSettings,
  onEditSessionSettings,
  fontFamily: globalFontFamily,
  fontSize: globalFontSize,
  cursorStyle,
  copyOnSelect = true,
  rightClickAction = 'contextMenu',
  onHoverFocus,
  titleSlot,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const isLivePtyRef = useRef<boolean>(false);
  // Keys typed before this view has a session to send them to (its attach
  // or start still in flight). They were dropped: the tab can already show
  // live (the connection event comes separately), and on Windows, where an
  // attach takes a few hundred ms, the first Enter typed into a console
  // just opened never reached the router (e2e suite on a Windows runner).
  const heldInputRef = useRef<Uint8Array[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isOsc133IntegratedRef = useRef<boolean>(false);
  const isPromptInputRegionRef = useRef<boolean>(true);
  const promptLinesRef = useRef<number[]>([]);

  // Shell the hooks were injected into, or null. Remembered per session name
  // so the picker can mark the last choice -- never used to auto-inject.
  const [hooksInjected, setHooksInjected] = useState<HookShell | null>(null);
  const hooksShellKey = `plinky_shell_hooks:${tab.sessionName}`;
  const lastHooksShell = (() => {
    try {
      return localStorage.getItem(hooksShellKey) as HookShell | null;
    } catch {
      return null;
    }
  })();
  // Shell hooks are Unix-shell scripts. Serial/Telnet/Raw tabs are usually
  // network gear (IOS, Junos, ...) whose CLI would try to run every line.
  const supportsShellHooks = !tab.protocol || tab.protocol === 'SSH';
  const [hooksError, setHooksError] = useState<string | null>(null);
  // Only consider local if it's explicitly "Local Shell" or flagged as local.
  // PuTTY sessions or SSH targets (even localhost:22) must connect via plink.
  // The session's own scheme and font (Change Session Settings >
  // Appearance) win over Settings' defaults; unset, Settings applies.
  const [sessionLook, setSessionLook] = useState<SessionLook>({});
  const globalTerminalTheme = useTerminalTheme();
  const terminalTheme = sessionLook.scheme ? findTerminalTheme(sessionLook.scheme) : globalTerminalTheme;
  const fontFamily = sessionLook.fontFamily || globalFontFamily;
  const fontSize = sessionLook.fontSize || globalFontSize;
  const scrollback = useScrollback();
  const scrollbackRef = useRef(scrollback);
  scrollbackRef.current = scrollback;
  const terminalThemeRef = useRef(terminalTheme);
  terminalThemeRef.current = terminalTheme;
  const isLocalSession = tab.sessionName === 'Local Shell' || (tab as any).isLocal === true;
  // Free Type mode's toggle was removed (confusing, no visible feedback) --
  // isFreeType is kept read-only at whatever the tab was created with
  // (always false now, see App.tsx) since the cursor-style/click-to-edit
  // logic below still reads it.
  const [isFreeType] = useState(tab.freeTypeMode);
  const [clickIndicator, setClickIndicator] = useState<{ x: number; y: number } | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<HostKeyPromptInfo | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [searchStats, setSearchStats] = useState<{ index: number; total: number } | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Keep the menu inside the window. Its height varies (split actions, shell
  // hooks), so a fixed-height estimate let it run off the bottom edge.
  useLayoutEffect(() => {
    const el = contextMenuRef.current;
    if (!contextMenu || !el) return;
    const fittedTop = Math.max(8, window.innerHeight - el.getBoundingClientRect().height - 8);
    if (contextMenu.y > fittedTop) {
      setContextMenu({ x: contextMenu.x, y: fittedTop });
    }
  }, [contextMenu]);

  // PuTTY Event Log State
  const [eventLogs, setEventLogs] = useState<PuTTYEventLog[]>([
    {
      id: 'init-1',
      time: new Date().toTimeString().split(' ')[0],
      message: `Configured session "${tab.sessionName}" target: ${tab.hostname || 'localhost'}:${tab.port || 22}`,
      level: 'info',
    },
  ]);
  const [isEventLogOpen, setIsEventLogOpen] = useState(false);
  const addEventLog = useCallback((message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const time = new Date().toTimeString().split(' ')[0];
    setEventLogs(prev => [...prev.slice(-200), { id: newId('log'), time, message, level }]);
  }, []);

  // PuTTY Session Logging State
  const [isLogging, setIsLogging] = useState(false);
  const [loggedBytes, setLoggedBytes] = useState(0);
  const [isLoggingOpen, setIsLoggingOpen] = useState(false);
  // Escape closes the topmost of this pane's own overlays. The Log and
  // Events dialogs and the context menu ignored it, so a key that closes
  // everything else in the app did nothing here.
  useEffect(() => {
    if (!contextMenu && !isEventLogOpen && !isLoggingOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (contextMenu) setContextMenu(null);
      else if (isLoggingOpen) setIsLoggingOpen(false);
      else setIsEventLogOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [contextMenu, isEventLogOpen, isLoggingOpen]);
  // The log is written to disk by the backend as output arrives; the page
  // only shows where and how much. It used to collect output in memory for an
  // export -- and collected nothing: its capture flag was never set.
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  // Also picks up a log PuTTY's own LogFileName setting started, and a log
  // still running after a reload. Polled only while logging or the panel is open.
  useEffect(() => {
    let alive = true;
    const refresh = () => sessionLogStatus(tab.id).then(info => {
      if (!alive) return;
      setIsLogging(!!info);
      setLogPath(info ? info.path : null);
      setLoggedBytes(info ? info.bytes : 0);
    }).catch(() => {});
    refresh();
    if (!isLogging && !isLoggingOpen) {
      const once = setTimeout(refresh, 1500); // a PuTTY log opens just after the spawn
      return () => { alive = false; clearTimeout(once); };
    }
    const timer = setInterval(refresh, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [tab.id, isLogging, isLoggingOpen]);

  const copyOnSelectRef = useRef(copyOnSelect);
  copyOnSelectRef.current = copyOnSelect;

  // Encrypted Vault (useTerminalVault.ts).
  const {
    vault, vaultExists, vaultKey, isVaultUnlocked, isVaultMenuOpen, setIsVaultMenuOpen,
    detectedPasswordPrompt, setDetectedPasswordPrompt, unlockOpen, setUnlockOpen, unlockThenEnableRef,
    enableNotice, setEnableNotice, copiedVaultKey, refreshVault,
    handleSendVaultPassword, handleSendVaultEnablePassword, requestEnablePassword, requestEnableRef, afterUnlock,
    handleCopyVaultPassword, handleCopyVaultEnablePassword,
    typedRef, autoLoginSentRef, commandRunRef, autoRespondRef,
  } = useTerminalVault(tab, isLocalSession, addEventLog);

  // When plink was started and nothing has come back yet. An unreachable
  // host printed nothing for 35 s or more: a black terminal under a green
  // dot and a green "Terminal ready", which read as connected but hung.
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [, setWaitTick] = useState(0);
  useEffect(() => {
    if (waitingSince === null) return;
    const t = setInterval(() => setWaitTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [waitingSince]);
  const cancelConnectRef = useRef<() => void>(() => {});
  // Set when a changed host key was abandoned: the pane then offers the
  // host keys, not a one-click Reconnect.
  const [hostKeyMismatch, setHostKeyMismatch] = useState<{ host: string } | null>(null);
  // Esc cancels while waiting, from the terminal itself: nothing is running
  // on the other end to take the key, and moving focus to a Cancel button
  // would leave it nowhere once the password prompt arrives.
  useEffect(() => {
    if (waitingSince === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !containerRef.current?.contains(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      cancelConnectRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [waitingSince]);
  const recentOutputRef = useRef('');

  // Pasting, paced on a serial line or when the session asks (useTerminalPaste.ts).
  const isSerial = tab.protocol === 'Serial';
  const { pasteDelayRef, pasteJob, deliverTypedPaste, pasteFromClipboard, pasteActionsRef } = useTerminalPaste({
    tab, isSerial, isLivePtyRef, terminalRef, addEventLog, detectedPasswordPrompt, recentOutputRef,
  });

  // Locked read only (tab menu): keys are dropped here, and the backend
  // refuses every other input. A note says why typing does nothing.
  const lockedRef = useRef(!!tab.locked);
  lockedRef.current = !!tab.locked;
  const [lockNotice, setLockNotice] = useState(false);
  const lockNoticeTimer = useRef<number | null>(null);
  const showLockNotice = () => {
    setLockNotice(true);
    if (lockNoticeTimer.current !== null) window.clearTimeout(lockNoticeTimer.current);
    lockNoticeTimer.current = window.setTimeout(() => setLockNotice(false), 1500);
  };

  // Run Script (scripts.rs): the script running on this tab, by file name.
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const autoReconnectRef = useRef(false);

  useEffect(() => {
    let active = true;
    // A session's own font is loaded before it is applied: xterm measures
    // its cell once, when the font changes.
    const applyLook = (look: SessionLook) => {
      const ready = look.fontFamily ? loadTerminalFont(look.fontFamily, look.fontSize ?? 14) : Promise.resolve();
      void ready.then(() => { if (active) setSessionLook(look); });
    };
    readPuttySession(tab.sessionName)
      .then(s => {
        if (!active) return;
        pasteDelayRef.current = pasteLineDelayFrom(s?.extra);
        autoReconnectRef.current = s?.extra?.PlinkyAutoReconnect === '1';
        applyLook(sessionLookFrom(s?.extra));
      })
      .catch(() => {});
    const onSaved = (e: Event) => {
      const d = (e as CustomEvent<SessionSavedDetail>).detail;
      if (d?.name === tab.sessionName) {
        pasteDelayRef.current = d.pasteLineDelayMs;
        autoReconnectRef.current = d.autoReconnect;
        if (d.look) applyLook(d.look);
      }
    };
    window.addEventListener(SESSION_SAVED_EVENT, onSaved);
    return () => { active = false; window.removeEventListener(SESSION_SAVED_EVENT, onSaved); };
  }, [tab.sessionName]);

  // A script's notes (its stderr) and its end, shown in the terminal only.
  useEffect(() => {
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const keep = (u: (() => void) | null) => { if (disposed) u?.(); else if (u) unlisten.push(u); };
    void listenScriptStarted(e => {
      if (e.sessionId === tab.id) setRunningScript(e.name);
    }).then(keep);
    void listenScriptLog(e => {
      if (e.sessionId === tab.id) terminalRef.current?.write(`\r\n\x1b[2m[script] ${e.line}\x1b[0m\r\n`);
    }).then(keep);
    void listenScriptEnded(e => {
      if (e.sessionId !== tab.id) return;
      setRunningScript(null);
      const how = e.stopped ? 'stopped' : e.code === 0 ? 'finished' : `ended with code ${e.code ?? '?'}`;
      terminalRef.current?.write(`\r\n\x1b[2m[script ${how}]\x1b[0m\r\n`);
      addEventLog(`Script ${how}`, e.stopped || e.code === 0 ? 'info' : 'warn');
    }).then(keep);
    return () => { disposed = true; unlisten.forEach(u => u()); };
  }, [tab.id]);

  const handleRunScript = async () => {
    setContextMenu(null);
    const path = await pickScriptFile();
    if (!path) return;
    const name = path.split(/[\\/]/).pop() || path;
    try {
      await runScript(tab.id, tab.sessionName, path);
      addEventLog(`Running script ${name}`, 'info');
    } catch (e) {
      terminalRef.current?.write(`\r\n\x1b[31m[Thyrion: ${String(e)}]\x1b[0m\r\n`);
      addEventLog(String(e), 'error');
    }
    terminalRef.current?.focus();
  };

  // Reconnect (T-016): restarts the session in this same terminal, like
  // PuTTY's "Restart Session" (useAutoReconnect.ts).
  const {
    restartSessionRef, reconnectAttemptRef, reconnectIn,
    cancelAutoReconnect, reconnectNow, handleManualReconnect, scheduleAutoReconnectRef,
  } = useAutoReconnect(addEventLog);

  // Network keyword highlighting (T-017), toggled per tab.
  const highlighterRef = useRef<KeywordHighlighter | null>(null);
  useEffect(() => {
    highlighterRef.current?.setEnabled(tab.activeHighlighting !== false);
  }, [tab.activeHighlighting]);
  const reachedLiveRef = useRef(false);
  // The session's process has ended ("[Thyrion: Session closed"). Output
  // after that can't mean it is live again: on Windows the pseudo console
  // repaints once plink exits, and for a telnet or raw console "any output
  // means connected" turned a hung-up tab back to live 100 ms after it went
  // disconnected -- no Reconnect button, and typing went nowhere (e2e suite
  // on a Windows runner). Only a reconnect clears it.
  const endedRef = useRef(false);
  // A serial tab restored at startup: its line stays closed until Connect.
  const deferredRef = useRef(!!tab.deferConnect);
  // The tab's broadcast channel, for a reconnect to put the session back on.
  const syncChannelRef = useRef(tab.syncChannel);
  syncChannelRef.current = tab.syncChannel;
  const sshBannerToldRef = useRef(false);
  // Lit briefly when a sync broadcast reaches this session (T-012).
  const broadcastGlow = useBroadcastGlow().has(tab.id);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm.js instance with modern dark theme
    const term = new Terminal({
      scrollback: scrollbackRef.current,
      cursorBlink: true,
      cursorStyle: cursorStyle || (isFreeType ? 'bar' : 'block'),
      fontFamily: fontFamily || DEFAULT_TERMINAL_FONT,
      fontSize: fontSize || 14,
      lineHeight: 1.25,
      allowTransparency: true,
      // Find highlights matches with xterm decorations, a "proposed" API in
      // xterm 5. Without this, the first search threw "You must set the
      // allowProposedApi option" inside a React effect and blanked the view.
      allowProposedApi: true,
      // The scheme chosen in Settings; changes apply live (effect below).
      theme: terminalThemeRef.current.theme,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Initialize Search Addon
    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;

    // Prompts and the current directory, from a shell with Thyrion's hooks.
    const shellIntegration = registerShellIntegration(term, {
      integrated: isOsc133IntegratedRef, inPromptInput: isPromptInputRegionRef, promptLines: promptLinesRef,
    }, onCwdChange);

    searchAddon.onDidChangeResults((e) => {
      if (e) {
        setSearchStats({ index: e.resultIndex, total: e.resultCount });
      } else {
        setSearchStats(null);
      }
    });

    term.open(containerRef.current);
    // The size xterm itself uses, for anything outside that needs it exact
    // (the e2e suite compares it with the size the device was told; a
    // size worked out from pixel widths can be a column off).
    const markSize = () => {
      if (term.element) {
        term.element.dataset.cols = String(term.cols);
        term.element.dataset.rows = String(term.rows);
      }
    };
    markSize();
    // Registered here, before anything fits the terminal: the first fit
    // comes before the other resize handler below exists.
    term.onResize(markSize);
    const highlighter = new KeywordHighlighter(term, tab.activeHighlighting !== false);
    highlighterRef.current = highlighter;
    highlighter.setTheme(terminalThemeRef.current.theme, !!terminalThemeRef.current.light);
    // Output arrives in many small chunks; decorate them in one pass a few
    // ms later. (setTimeout, not requestAnimationFrame: rAF doesn't run
    // while the window is hidden, and highlights would lag behind output.)
    let scanQueued = false;
    const scheduleHighlight = () => {
      if (scanQueued) return;
      scanQueued = true;
      window.setTimeout(() => {
        scanQueued = false;
        if (!disposed) highlighter.scan();
      }, 30);
    };
    fitAddon.fit();
    // A freshly connected session needs keyboard focus immediately -- the
    // user is about to be looking at a host-key or password prompt and
    // should be able to just start typing, not have to click into the
    // terminal first.
    term.focus();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Register terminal with manager for broadcast sync input
    terminalManager.registerTerminal(tab.id, term, tab.syncChannel);
    terminalManager.setActiveTab(tab.id);

    // IP addresses copy, URLs open (terminalLinks.ts).
    registerLinks(term);

    // Set once this view unmounts. Unmounting (switching tabs, a split pane
    // re-render) must NOT kill the backend session -- it's detached, not
    // closed, and the next mount reattaches with scrollback replay. Only an
    // explicit tab close ends a session. Async work started by this effect
    // checks the flag so a stale view never writes to its disposed terminal
    // or spawns a second process for the same tab.
    let disposed = false;

    // Subscribe to native host key prompt events from backend
    let unlistenPrompts: (() => void) | null = null;
    listenHostKeyPrompts((event) => {
      if (event.session_id === tab.id) {
        // The server answered: this is no longer "connecting", and Esc now
        // belongs to the host-key dialog (it cancelled the connection too,
        // printing "Connection cancelled" above the mismatch report).
        setWaitingSince(null);
        setPendingPrompt(event.prompt);
        onUpdateTab(tab.id, { status: 'preauth' });
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten?.();
      } else {
        unlistenPrompts = unlisten;
      }
    });

    // Tells the backend what this page has drawn, so a flood waits for it
    // (ADR-006). Only live output counts: a replay was never sent by the
    // backend, so there is nothing to acknowledge.
    const acker = createOutputAcker(tab.id);
    // The session is there: send what was typed while it wasn't, in order.
    const goLive = () => {
      isLivePtyRef.current = true;
      for (const keys of heldInputRef.current.splice(0)) writeTerminalInput(tab.id, keys);
    };
    const handleIncomingChunk = (chunk: Uint8Array, live = true) => {
      if (disposed) return;
      goLive();
      if (chunk.length > 0) setWaitingSince(null);
      term.write(chunk, () => {
        scheduleHighlight();
        if (live) acker.ack(chunk.length);
      });
      const text = new TextDecoder().decode(chunk);

      // Password & enable prompt detection, on the tail of the output so a
      // prompt split across chunks, or IOS's "enable" then "Password:", is seen.
      recentOutputRef.current = appendRecentOutput(recentOutputRef.current, text);
      const promptKind = classifyPasswordPrompt(recentOutputRef.current);
      const answeredAutomatically = autoRespondRef.current(promptKind, recentOutputRef.current);

      const hint = live ? fatalHint(text, tab.hostname, tab.port) : null;
      if (hint) term.writeln(`\x1b[33m[Thyrion: ${hint}]\x1b[0m`);
      const mismatch = sshBannerToldRef.current ? null : sshBannerHint(recentOutputRef.current, tab.protocol);
      if (mismatch) {
        sshBannerToldRef.current = true;
        term.writeln(`\r\n\x1b[33m[Thyrion: ${mismatch}]\x1b[0m`);
      }

      // Status transitions (outputStatus.ts).
      const status = readOutputStatus(text, {
        ended: endedRef.current,
        reachedLive: reachedLiveRef.current,
        consoleTarget: tab.protocol === 'Telnet' || tab.protocol === 'RAW',
      });
      if (status === 'ended') {
        endedRef.current = true;
        onUpdateTab(tab.id, { status: 'disconnected' });
        setDetectedPasswordPrompt(null);
        // A FATAL ERROR after the session was live is a dropped connection
        // ("Remote side unexpectedly closed", "Network error: ..."). A clean
        // `exit` prints no FATAL, and a failed login never reached live --
        // neither reconnects on its own.
        const networkProtocol = !tab.protocol || tab.protocol === 'SSH' || tab.protocol === 'Telnet';
        if (text.includes('FATAL ERROR:') && reachedLiveRef.current && autoReconnectRef.current && networkProtocol) {
          reachedLiveRef.current = false;
          scheduleAutoReconnectRef.current();
        }
        reachedLiveRef.current = false;
      } else if (status === 'stillEnded') {
        // A process that has ended: nothing it printed last changes it.
      } else if (status === 'preauth') {
        // The prompt is noticed as well, for the vault's offer.
        onUpdateTab(tab.id, { status: 'preauth' });
        if (promptKind) setDetectedPasswordPrompt(promptKind);
      } else if (status === 'live') {
        if (!reachedLiveRef.current && live) addEventLog(isLocalSession ? 'Shell ready' : 'Connected', 'success');
        onUpdateTab(tab.id, { status: 'live' });
        setDetectedPasswordPrompt(null);
        reachedLiveRef.current = true;
        reconnectAttemptRef.current = 0; // back up: the next drop starts over
      } else if (promptKind) {
        // A prompt the status stays the same for (a router's enable, one
        // split across chunks): the vault offers its password.
        setDetectedPasswordPrompt(promptKind);
      }
      if (answeredAutomatically) setDetectedPasswordPrompt(null);
    };

    // PuTTY Classic: Copy on select
    term.onSelectionChange(() => {
      if (copyOnSelectRef.current) {
        const selection = copiedText(term.getSelection());
        if (selection && selection.length > 0) void writeClipboard(selection);
      }
    });

    // The connection is up (the backend watches plink's socket). A router
    // console prints nothing until something happens on the device -- 0
    // bytes in 5 s on a GNS3 IOS console -- so "Connecting to host:port"
    // can't wait for output: it stayed up ~10 s on saved console sessions.
    // A telnet or raw console is live from here; SSH still has to log in.
    const onConnected = () => {
      if (disposed) return;
      setWaitingSince(null);
      if ((tab.protocol === 'Telnet' || tab.protocol === 'RAW') && !reachedLiveRef.current) {
        reachedLiveRef.current = true;
        reconnectAttemptRef.current = 0;
        addEventLog('Connected', 'success');
        onUpdateTab(tab.id, { status: 'live' });
      }
    };
    let unlistenConnected: (() => void) | null = null;
    void listenSessionConnected(id => { if (id === tab.id) onConnected(); })
      .then(u => { if (disposed) u?.(); else unlistenConnected = u; });

    const startFresh = () => {
      // A reconnect closed the old session, which took it off its channel.
      setSyncChannel(tab.id, syncChannelRef.current === 'none' ? null : syncChannelRef.current);
      // Fresh start
      addEventLog(isLocalSession
        ? 'Starting local shell'
        : `Connecting to ${tab.hostname || tab.sessionName}${tab.port ? `:${tab.port}` : ''}`, 'info');
      if (!isLocalSession && isTauriEnvironment()) setWaitingSince(Date.now());
      startTerminalSession(
        tab.id,
        tab.sessionName,
        isLocalSession,
        term.cols,
        term.rows,
        handleIncomingChunk,
        tab.hostname,
        tab.port,
        tab.username,
        (tab as any).logFileName,
        targetProtocolOf(tab.protocol),
        tab.title
      ).then(({ started, error }) => {
        if (disposed) {
          // Tab closed while the spawn was in flight: its close ran as a
          // no-op before this session existed, so close the straggler now.
          if (started && isSessionClosed(tab.id)) {
            closeTerminalSession(tab.id);
          }
          return;
        }
        if (started) {
          goLive();
        }
        if (!started) {
          heldInputRef.current = [];
          setWaitingSince(null);
          onUpdateTab(tab.id, { status: 'disconnected' });
          if (isTauriEnvironment()) {
            const reason = error || 'Verify that PuTTY (plink) is installed and target host is reachable.';
            term.writeln(`\r\n\x1b[31m[Thyrion Error: Failed to start session "${tab.sessionName}": ${reason}]\x1b[0m\r\n`);
            addEventLog(`Failed to start session "${tab.sessionName}": ${reason}`, 'error');
          } else {
            // Browser development preview fallback banner (non-Tauri mode)
            term.writeln(`\x1b[33m[Thyrion: Running in Web Browser Dev Mode - Desktop Tauri Backend Inactive]\x1b[0m\r\n`);
            addEventLog("Running in browser development preview mode", 'info');
            onUpdateTab(tab.id, { status: 'live' });
          }
        } else {
          // The process is up; the connection is not. "Connected" is logged
          // when the login actually finishes.
          const isSerial = tab.protocol === 'Serial';
          addEventLog(
            isLocalSession ? 'Local shell started' : isSerial ? 'Serial line opened' : 'plink started, waiting for the server',
            'info',
          );
          if (isLocalSession || isSerial) {
            // No login to wait for: a local shell or a serial line is up
            // once it starts. Its prompt can't be the sign: Windows' ends in
            // ">" ("C:\Users\ops>"), which the live pattern never matched,
            // so a Local Shell tab spun "connecting" forever (Windows 11 VM),
            // and a router on a serial line may print nothing at all.
            reachedLiveRef.current = true;
            setWaitingSince(null);
            onUpdateTab(tab.id, { status: 'live' });
          } else {
            // Connected before this page listened: the event went by.
            void isSessionConnected(tab.id).then(c => { if (c) onConnected(); });
          }
        }
      });
    };

    cancelConnectRef.current = () => {
      if (disposed) return;
      setWaitingSince(null);
      void closeTerminalSession(tab.id);
      onUpdateTab(tab.id, { status: 'disconnected' });
      term.writeln('\r\n\x1b[33m[Thyrion: Connection cancelled]\x1b[0m');
      addEventLog('Connection cancelled', 'warn');
    };

    // Reconnect: close whatever is left of the old session and start again
    // under the same tab id, in this terminal.
    restartSessionRef.current = async () => {
      if (disposed) return;
      setHostKeyMismatch(null);
      // Until the new session is there, keys are held for it (goLive), as
      // on a first connect: sent now, they went to a closed session and
      // were lost.
      isLivePtyRef.current = false;
      await closeTerminalSession(tab.id);
      reopenSessionId(tab.id);
      if (disposed) return;
      recentOutputRef.current = '';
      reachedLiveRef.current = false; // a new login, shown as one
      endedRef.current = false; // a new process
      typedRef.current = { line: '', submitted: null };
      autoLoginSentRef.current = { user: false, password: false };
      commandRunRef.current = false; // a new connection logs in again
      setDetectedPasswordPrompt(null);
      term.writeln(deferredRef.current ? '\x1b[33m[Thyrion: Connecting...]\x1b[0m' : '\r\n\x1b[33m[Thyrion: Reconnecting...]\x1b[0m');
      deferredRef.current = false;
      onUpdateTab(tab.id, { status: 'connecting', deferConnect: false });
      startFresh();
    };

    // Attempt to reattach to existing session or start a new PTY session.
    // A console tab opened in the background (T-020) may still be starting:
    // wait for it, then attach, instead of starting a second session.
    //
    // Output that arrives while the attach is in flight is held and drawn
    // after the replay. The backend starts sending it the moment it hands
    // over the replay, and the page can hear it first: on Windows an attach
    // with a full scrollback took ~270 ms, a router that hung up in that
    // window had its "Session closed" drawn, then overwritten by the older
    // replay, and the tab set back to live from the attach's older answer
    // (e2e suite on a Windows runner).
    let attaching = true;
    const heldDuringAttach: Uint8Array[] = [];
    const onAttachedChunk = (chunk: Uint8Array) => {
      if (attaching) heldDuringAttach.push(chunk);
      else handleIncomingChunk(chunk);
    };
    const flushHeld = () => {
      attaching = false;
      for (const chunk of heldDuringAttach.splice(0)) handleIncomingChunk(chunk);
    };
    (backgroundStartOf(tab.id) ?? Promise.resolve())
      .then(() => (disposed ? null : attachTerminalSession(tab.id, 0, onAttachedChunk)))
      .then((attachInfo) => {
        if (disposed) return;
        if (attachInfo) {
          goLive();
          // A session started before this view (a console from GNS3, a
          // background tab) began at 120x32. The resize observer fired
          // before the attach, while nothing was live, so tell it the real
          // size now: telnet passes it on, and Cisco IOS wraps by it.
          if (term.cols && term.rows) resizeTerminal(tab.id, term.cols, term.rows);
          // A host-key prompt raised while this tab was in the background was
          // broadcast to no listener; the backend still blocks input for it,
          // so re-show the dialog or the session is stuck.
          if (attachInfo.pending_prompt) {
            setPendingPrompt(attachInfo.pending_prompt);
          }
          // The backend knows whether the login is over; the replay below
          // holds the old login prompt and must not decide it.
          reachedLiveRef.current = attachInfo.is_live;
          if (attachInfo.replay_data && attachInfo.replay_data.length > 0) {
            handleIncomingChunk(new Uint8Array(attachInfo.replay_data), false);
            addEventLog(`Attached to active session "${tab.sessionName}" with replayed scrollback`, 'success');
          } else {
            addEventLog(`Attached to active session "${tab.sessionName}"`, 'success');
          }
          // An ended session is disconnected: "not live" alone read as a
          // login still pending, and a refused console showed the amber key.
          onUpdateTab(tab.id, { status: attachInfo.ended ? 'disconnected' : attachInfo.is_live ? 'live' : 'preauth' });
          reachedLiveRef.current = attachInfo.is_live;
          // Newer than everything above: a hang-up in it has the last word.
          flushHeld();
        } else if (deferredRef.current) {
          // Restored at startup: the line may be in use by another program.
          attaching = false;
          term.writeln(`\x1b[2m[Thyrion: ${tab.sessionName} was not reopened at startup, so its serial line stays free for whatever is using it. Connect opens it.]\x1b[0m`);
          onUpdateTab(tab.id, { status: 'disconnected' });
        } else {
          attaching = false;
          startFresh();
        }
      });

    // Pastes the webview makes itself, and the middle click (useTerminalPaste.ts).
    const stopPasteListeners = listenForPastes(containerRef.current, term, pasteActionsRef);

    // Copy, paste and select all (shortcuts.ts). Handled here, not left to
    // the webview: WebKitGTK and WebView2 disagree on which of these keys
    // paste by themselves. preventDefault stops the webview's own paste,
    // which would otherwise arrive as a second, unconfirmed one. Copy with
    // nothing selected does nothing -- it must not reach the device as ^C.
    term.attachCustomKeyEventHandler((e) => {
      const sequence = keySequenceFor(e, isLocalSession);
      if (sequence) {
        e.preventDefault();
        if (e.type === 'keydown') term.input(sequence, true);
        return false;
      }
      const action = terminalShortcut(e);
      if (!action || (action === 'sendEnable' && isLocalSession)) return true;
      e.preventDefault();
      if (e.type !== 'keydown') return false;
      if (action === 'sendEnable') {
        requestEnableRef.current();
      } else if (action === 'copy') {
        const selection = copiedText(term.getSelection());
        if (selection) void writeClipboard(selection);
      } else if (action === 'selectAll') {
        term.selectAll();
      } else {
        void pasteActionsRef.current.pasteFromClipboard(t => pasteActionsRef.current.deliverTypedPaste(t));
      }
      return false;
    });

    // Handle user keyboard input
    term.onData((data) => {
      if (lockedRef.current) {
        showLockNotice();
        return;
      }
      // Not connected yet: nothing to send to, and nothing to hold for a
      // session the user hasn't asked for.
      if (deferredRef.current) return;
      const before = typedRef.current.submitted;
      typedRef.current = trackTypedInput(typedRef.current, data, Date.now());
      const sub = typedRef.current.submitted;
      if (sub && sub !== before && isCommandSubmission(sub.line, recentOutputRef.current)) commandRunRef.current = true;
      if (isLivePtyRef.current) {
        writeTerminalInput(tab.id, new TextEncoder().encode(data));
      } else if (isTauriEnvironment()) {
        // Held until the session is there (goLive). A bound keeps a tab
        // that never gets one from collecting a paste forever.
        const held = heldInputRef.current;
        if (held.reduce((n, k) => n + k.length, 0) < 64 * 1024) held.push(new TextEncoder().encode(data));
      } else {
        // Echo input locally for browser preview
        if (data === '\r') {
          term.write('\r\n');
        } else if (data === '\u007F') {
          term.write('\b \b');
        } else {
          term.write(data);
        }
      }
    });

    term.onResize(({ cols, rows }) => {
      if (isLivePtyRef.current) {
        resizeTerminal(tab.id, cols, rows);
      }
    });

    // Handle Ctrl+F for search and Ctrl+Up/Down for prompt navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      // e.code, not e.key: on a Greek layout the F key types "φ".
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
      } else if (e.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
        searchAddonRef.current?.clearDecorations();
        term.focus();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // OSC 133 semantic prompt jump
        e.preventDefault();
        jumpToPrompt(term, promptLinesRef.current, e.key === 'ArrowUp' ? 'prev' : 'next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const handleResize = () => {
      try {
        fitAddon.fit();
        if (isLivePtyRef.current && term.cols && term.rows) {
          resizeTerminal(tab.id, term.cols, term.rows);
        }
      } catch {
        // Ignored
      }
    };

    window.addEventListener('resize', handleResize);

    // Dynamic container resize observer (handles split view toggles, sidebar collapse, sftp pane)
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(handleResize);
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      restartSessionRef.current = null;
      unlistenConnected?.();
      stopPasteListeners();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (unlistenPrompts) {
        unlistenPrompts();
      }
      // The session keeps its broadcast channel: unmounting is switching
      // tabs, not leaving the channel. Clearing it here left every tab not
      // on screen -- and the one on screen, after one round trip -- off its
      // channel in the backend while its badge still said B: "Not sent: no
      // live session on CH-B" with two live routers on B. Closing the tab
      // takes it off (the backend's close_session).
      terminalManager.unregisterTerminal(tab.id);
      // Nothing will draw this session's output now: let it run into
      // scrollback rather than wait for acknowledgements (ADR-006).
      acker.dispose();
      if (!isSessionClosed(tab.id)) void detachTerminalSession(tab.id);
      shellIntegration.dispose();
      disposed = true;
      highlighter.dispose();
      highlighterRef.current = null;
      term.dispose();
    };
  }, [tab.id, tab.sessionName, tab.hostname, tab.port, tab.username]);

  // Execute in-buffer search
  const performSearch = useCallback((direction: 'next' | 'prev' = 'next') => {
    if (!searchAddonRef.current || !searchQuery) return;
    const options = {
      caseSensitive,
      wholeWord,
      regex: isRegex,
      incremental: direction === 'next',
      decorations: {
        matchOverviewRuler: '#38bdf8',
        activeMatchColorOverviewRuler: '#f59e0b',
        matchBackground: 'rgba(56, 189, 248, 0.3)',
        activeMatchBackground: 'rgba(245, 158, 11, 0.6)',
      }
    };

    // A search must never take the terminal down with it (an invalid regex,
    // or an xterm error): report it and keep the view.
    try {
      if (direction === 'next') {
        searchAddonRef.current.findNext(searchQuery, options);
      } else {
        searchAddonRef.current.findPrevious(searchQuery, options);
      }
    } catch (e) {
      setSearchStats(null);
      console.warn('Search failed:', e);
    }
  }, [searchQuery, caseSensitive, wholeWord, isRegex]);

  useEffect(() => {
    if (isSearchOpen && searchQuery) {
      performSearch('next');
    } else if (!searchQuery && searchAddonRef.current) {
      searchAddonRef.current.clearDecorations();
      setSearchStats(null);
    }
  }, [searchQuery, caseSensitive, wholeWord, isRegex, isSearchOpen, performSearch]);

  // Dynamically update font family, font size, or cursor style from settings
  useEffect(() => {
    if (terminalRef.current) {
      if (fontFamily) {
        terminalRef.current.options.fontFamily = fontFamily;
      }
      if (fontSize) {
        terminalRef.current.options.fontSize = fontSize;
      }
      if (cursorStyle) {
        terminalRef.current.options.cursorStyle = cursorStyle;
      }
      fitAddonRef.current?.fit();
    }
  }, [fontFamily, fontSize, cursorStyle]);

  // A shorter length drops the oldest lines at once; a longer one keeps
  // what is there and grows from now.
  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.scrollback = scrollback;
  }, [scrollback]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme.theme;
    highlighterRef.current?.setTheme(terminalTheme.theme, !!terminalTheme.light);
  }, [terminalTheme]);

  // WindTerm Free Type Mode: Arbitrary cursor placement and delta computation
  // Focus follows the mouse into a terminal, so a split or grid pane can be
  // typed into without clicking it first. Never while something else is
  // being typed into (broadcast bar, search, a dialog field) or while a
  // button is held (a text selection dragged across panes).
  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!shouldTakeHoverFocus(e.buttons, document.activeElement, !!pendingPrompt)) return;
    terminalRef.current?.focus();
    onHoverFocus?.();
  };

  // And while the mouse stays over it: after a menu closes, a button is
  // clicked or a dialog shuts, the mouse is already inside and no enter
  // comes, so the terminal stayed without the keyboard (owner: "if the
  // mouse is over the terminal, the focus should be on the terminal").
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const term = terminalRef.current;
    if (!term || contextMenu || document.activeElement === term.textarea) return;
    if (!shouldTakeHoverFocus(e.buttons, document.activeElement, !!pendingPrompt)) return;
    term.focus();
    onHoverFocus?.();
  };

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Close context menu on left click
    if (contextMenu) {
      setContextMenu(null);
    }

    if (!isFreeType || !containerRef.current || !terminalRef.current) return;
    const term = terminalRef.current;

    // Gating 1: Suppress in alternate screen buffer (vim, nano, htop, less)
    if (term.buffer.active.type === 'alternate') {
      return;
    }

    // Gating 2: Suppress if OSC 133 semantic prompt is integrated and outside B..C input region
    if (isOsc133IntegratedRef.current && !isPromptInputRegionRef.current) {
      return;
    }

    const screenEl = containerRef.current.querySelector('.xterm-screen');
    if (!screenEl) return;

    const rect = screenEl.getBoundingClientRect();
    const cellWidth = rect.width / term.cols;
    const cellHeight = rect.height / term.rows;

    const targetCol = Math.floor((e.clientX - rect.left) / cellWidth);
    const targetRow = Math.floor((e.clientY - rect.top) / cellHeight);

    // Visual click ripple
    const localX = e.clientX - containerRef.current.getBoundingClientRect().left;
    const localY = e.clientY - containerRef.current.getBoundingClientRect().top;
    setClickIndicator({ x: localX, y: localY });
    setTimeout(() => setClickIndicator(null), 600);

    const cursorCol = term.buffer.active.cursorX;
    const cursorRow = term.buffer.active.cursorY;

    // Line gating: only move cursor if clicking on the active input row
    if (targetRow === cursorRow && targetCol >= 0 && targetCol < term.cols) {
      // Gating 3: DECCKM (Application Cursor Keys Mode)
      // When DECCKM is active, arrow keys send SS3 (\x1bO[A-D]) instead of CSI (\x1b[[A-D])
      const isDecckm = (term.modes as { applicationCursorKeysMode?: boolean } | undefined)?.applicationCursorKeysMode === true;
      const rightSeqToken = isDecckm ? '\x1bOC' : '\x1b[C';
      const leftSeqToken = isDecckm ? '\x1bOD' : '\x1b[D';

      const delta = targetCol - cursorCol;
      if (delta > 0) {
        const rightSeq = rightSeqToken.repeat(delta);
        if (isLivePtyRef.current) {
          writeTerminalInput(tab.id, new TextEncoder().encode(rightSeq));
        } else {
          term.write(rightSeq);
        }
      } else if (delta < 0) {
        const leftSeq = leftSeqToken.repeat(Math.abs(delta));
        if (isLivePtyRef.current) {
          writeTerminalInput(tab.id, new TextEncoder().encode(leftSeq));
        } else {
          term.write(leftSeq);
        }
      }
    }

    term.focus();
  }, [isFreeType, tab.id, contextMenu]);

  // Context Menu Handler
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (rightClickAction === 'paste' && !e.shiftKey) {
      handlePaste();
      return;
    }
    const x = Math.min(e.clientX, window.innerWidth - 280);
    setContextMenu({ x, y: e.clientY });
  };

  const handleCopy = () => {
    const selection = copiedText(terminalRef.current?.getSelection() ?? '');
    if (selection) void writeClipboard(selection);
    setContextMenu(null);
  };

  // The menu's Paste (and a right click set to paste) sends what the paste
  // keys send. It wrote the clipboard raw: a line break reached a router as
  // LF, and text copied on Windows as CR LF, two Enters per line, where
  // Ctrl+Shift+V sends each line with one Enter (e2e suite).
  const handlePaste = async () => {
    setContextMenu(null);
    await pasteFromClipboard(deliverTypedPaste);
    // Back to the terminal, not the menu item that was just removed.
    terminalRef.current?.focus();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const paths = files.map(f => {
      const fullPath = (f as any).path || f.name;
      // Always single-quote, unconditionally -- the previous version only
      // quoted when the path contained space/$/&/(, which misses every
      // other shell metacharacter (;, |, `, ", *, newlines, ...). A file
      // or directory with a crafted name could paste as what looks like a
      // harmless path but actually injects a second shell command once the
      // user hits Enter. Single-quoting is the standard, complete fix: wrap
      // in '...' and escape embedded quotes as '\''.
      return `'${fullPath.replace(/'/g, "'\\''")}'`;
    }).join(' ');

    if (isLivePtyRef.current) {
      writeTerminalInput(tab.id, new TextEncoder().encode(paths));
    } else {
      terminalRef.current?.write(paths);
    }
    terminalRef.current?.focus();
    addEventLog(`Pasted dropped file path(s) into terminal: ${paths}`, 'info');
  };

  const handleSelectAll = () => {
    terminalRef.current?.selectAll();
    setContextMenu(null);
  };

  const handleClearScrollback = () => {
    terminalRef.current?.clear();
    addEventLog("Terminal scrollback cleared", 'info');
    setContextMenu(null);
  };

  const handleResetTerminal = () => {
    if (terminalRef.current) {
      terminalRef.current.reset();
    }
    if (isLivePtyRef.current) {
      writeTerminalInput(tab.id, new TextEncoder().encode('\x1bc'));
    }
    addEventLog("Terminal hard reset (RIS) sent", 'info');
    setContextMenu(null);
  };

  const handleAnswerPrompt = async (answer: 'store' | 'once' | 'reject') => {
    const prompt = pendingPrompt;
    await answerHostKeyPrompt(tab.id, answer);
    setPendingPrompt(null);
    if (answer === 'reject' && prompt?.changed) {
      // Abandoning a changed key used to end like any failed connect: a
      // generic closed line and a Reconnect button, the easiest thing to
      // click at the one moment an attacker could be in the middle.
      const stored = await storedFingerprint(prompt);
      const where = `${prompt.host}:${prompt.port}`;
      terminalRef.current?.writeln(
        `\r\n\x1b[1;31m[Thyrion: the host key for ${where} does not match the one PuTTY saved. Connection abandoned.]\x1b[0m` +
        `\r\n\x1b[31m  Offered: ${prompt.fingerprint || 'unknown'}\x1b[0m` +
        (stored ? `\r\n\x1b[31m  Saved:   ${stored}\x1b[0m` : '') +
        `\r\n\x1b[31m  Check the offered fingerprint with the server's administrator before trusting it.\x1b[0m\r\n`
      );
      addEventLog(`Host key mismatch for ${where}; connection abandoned`, 'error');
      setHostKeyMismatch({ host: prompt.host });
    }
    terminalRef.current?.focus();
  };

  // A menu, not a cycle: clicking through Off, A, B, C, D showed nothing
  // of what came next and meant counting clicks to reach a channel.
  const [channelMenuOpen, setChannelMenuOpen] = useState(false);
  useEffect(() => {
    if (!channelMenuOpen) return;
    const close = () => setChannelMenuOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', onKey, true); };
  }, [channelMenuOpen]);

  const chooseChannel = (nextChannel: SyncChannel) => {
    setChannelMenuOpen(false);
    onUpdateTab(tab.id, { syncChannel: nextChannel }); // the effect below tells the backend
    terminalManager.setSyncChannel(tab.id, nextChannel);
  };

  // The backend's router decides who gets a broadcast; the tab's channel is
  // what the user chose. Told on every mount (a tab shown again, a restored
  // layout) and on every change, so the two can't drift apart.
  useEffect(() => {
    void setSyncChannel(tab.id, tab.syncChannel === 'none' ? null : tab.syncChannel);
  }, [tab.id, tab.syncChannel]);

  const handleInjectHooks = async (shell: HookShell) => {
    setHooksError(null);
    setContextMenu(null);
    if (hooksInjected) {
      setHooksError(`Shell hooks are already active (${hooksInjected}).`);
      setTimeout(() => setHooksError(null), 4000);
      return;
    }
    if (!isLivePtyRef.current) {
      // injectShellIntegration silently returns false on backend rejection
      // (e.g. write_input_live_only refusing a session that's still at a
      // host-key or password prompt) -- that failure needs to be visible,
      // not just a console.warn, or the button looks like it does nothing.
      setHooksError('Session is not connected yet -- log in first, then inject hooks.');
      setTimeout(() => setHooksError(null), 4000);
      return;
    }
    try {
      // The shell must match: this used to always send the bash script. In
      // zsh its `trap ... DEBUG` also fires inside command substitutions,
      // leaking OSC bytes into prompt themes' arithmetic ("bad math
      // expression: illegal character: ^["), and zsh ignores PROMPT_COMMAND.
      const ok = await injectShellIntegration(tab.id, shell);
      if (ok) {
        setHooksInjected(shell);
        try {
          localStorage.setItem(hooksShellKey, shell);
        } catch {
          // Remembering the choice is a convenience only.
        }
      } else {
        setHooksError('Failed to inject shell hooks.');
        setTimeout(() => setHooksError(null), 4000);
      }
    } catch (e) {
      console.warn('Failed to inject hooks:', e);
      setHooksError('Failed to inject shell hooks.');
      setTimeout(() => setHooksError(null), 4000);
    }
  };

  /** Session Logging's Start/Stop. */
  const toggleSessionLog = async () => {
    setLogError(null);
    try {
      if (isLogging) {
        await stopSessionLog(tab.id);
        setIsLogging(false);
        addEventLog(`Session logging stopped (${logPath ?? 'log'})`, 'info');
        return;
      }
      // Plain text only: colour codes read as [01;34m...[0m in an editor.
      const info = await startSessionLog(tab.id, tab.sessionName, 'printable');
      if (!info) return; // dialog cancelled
      setIsLogging(true);
      setLogPath(info.path);
      setLoggedBytes(info.bytes);
      addEventLog(`Session logging to ${info.path}`, 'success');
    } catch (err) {
      // Not started: no live session yet, or the file couldn't be opened.
      setLogError(String(err));
    }
  };

  return (
    <div 
      className="relative flex flex-col h-full w-full bg-plinky-950 overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      {/* Broadcast glow: an overlay, since an inset shadow on this element
          would be painted under the terminal canvas. */}
      <div
        aria-hidden
        data-broadcast-glow={broadcastGlow ? 'on' : 'off'}
        className="pointer-events-none absolute inset-0 z-30"
        style={{
          boxShadow: `inset 0 0 0 2px ${glowColor(tab.syncChannel)}, inset 0 0 28px ${glowColor(tab.syncChannel, 0.4)}`,
          opacity: broadcastGlow ? 1 : 0,
          transition: `opacity ${broadcastGlow ? 120 : 700}ms ease-out`,
        }}
      />
      <TerminalHeader
        status={tab.status}
        title={titleSlot ?? <span className="font-semibold text-slate-200 truncate">{tab.sessionName}</span>}
        // Quick-connect tabs are named after their target already; the
        // header read "Quick (127.0.0.1:1) (127.0.0.1:1)".
        subtitle={isLocalSession ? '(local shell)'
          : tab.sessionName.includes(`${tab.hostname}:${tab.port}`) ? undefined : `(${tab.hostname}:${tab.port})`}
        hooksError={hooksError}
        vault={vaultKey ? {
          entry: vaultKey,
          unlocked: isVaultUnlocked,
          hasLogin: vault?.hasLoginSecret !== false,
          hasEnable: !!vault?.hasEnableSecret,
          copied: copiedVaultKey,
          open: isVaultMenuOpen,
          onToggle: () => {
            if (!isVaultMenuOpen) void refreshVault();
            setIsVaultMenuOpen(prev => !prev);
          },
          onSendLogin: () => { handleSendVaultPassword(); setIsVaultMenuOpen(false); },
          onSendEnable: () => { requestEnablePassword(); setIsVaultMenuOpen(false); },
          onCopyLogin: handleCopyVaultPassword,
          onCopyEnable: handleCopyVaultEnablePassword,
        } : undefined}
        onFind={() => {
          setIsSearchOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
        }}
        channel={tab.syncChannel}
        channelMenuOpen={channelMenuOpen}
        onToggleChannelMenu={() => setChannelMenuOpen(v => !v)}
        onChooseChannel={chooseChannel}
        highlighting={tab.activeHighlighting !== false}
        onToggleHighlighting={() => onUpdateTab(tab.id, { activeHighlighting: tab.activeHighlighting === false })}
        logging={{ active: isLogging, bytes: loggedBytes }}
        onOpenLogging={() => setIsLoggingOpen(true)}
        onOpenEventLog={() => setIsEventLogOpen(true)}
      />

      {isSearchOpen && (
        <TerminalSearchBar
          inputRef={searchInputRef}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          stats={searchStats}
          onFind={performSearch}
          options={{ caseSensitive, wholeWord, isRegex }}
          onToggle={(option) => {
            if (option === 'caseSensitive') setCaseSensitive(!caseSensitive);
            else if (option === 'wholeWord') setWholeWord(!wholeWord);
            else setIsRegex(!isRegex);
          }}
          onClose={() => {
            setIsSearchOpen(false);
            searchAddonRef.current?.clearDecorations();
            terminalRef.current?.focus();
          }}
        />
      )}

      {/* Terminal Viewport */}
      <div
        ref={containerRef}
        onClick={handleCanvasClick}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex-1 relative w-full h-full overflow-hidden ${isFreeType ? 'free-type-active' : ''}`}
        // The strip around the character grid takes the scheme's background,
        // or a light scheme sat in a dark frame.
        style={{ background: terminalTheme.theme.background }}
      >
        {isDragOver && <DropOverlay />}

        {waitingSince !== null && (
          <ConnectingOverlay
            target={`${tab.hostname || tab.sessionName}${tab.port ? `:${tab.port}` : ''}`}
            since={waitingSince}
            onCancel={() => cancelConnectRef.current()}
          />
        )}
        {/* Reconnect (T-016) */}
        {hostKeyMismatch && tab.status === 'disconnected' && reconnectIn === null && (
          <HostKeyChangedBar onViewHostKeys={() => showHostKeys(hostKeyMismatch.host)} />
        )}
        {!hostKeyMismatch && (reconnectIn !== null || tab.status === 'disconnected') && (
          <ConnectionBar
            reconnectIn={reconnectIn}
            notOpenedYet={!!tab.deferConnect}
            onReconnectNow={reconnectNow}
            onCancelReconnect={cancelAutoReconnect}
            onReconnect={handleManualReconnect}
          />
        )}

        {tab.locked && (
          <LockedBar
            typedJustNow={lockNotice}
            onUnlock={() => {
              onUpdateTab(tab.id, { locked: false });
              void setSessionLocked(tab.id, false);
              terminalRef.current?.focus();
            }}
          />
        )}

        {runningScript && (
          <ScriptBar
            name={runningScript}
            // Stop ends the script and sends Ctrl+C to what it started
            // (scripts.rs); the keyboard goes back to the terminal, which
            // was left on this button (owner).
            onStop={() => { void stopScript(tab.id); terminalRef.current?.focus(); }}
          />
        )}

        {/* Paced paste in progress (T-015): how far, and a way to stop it. */}
        {pasteJob && (
          <PasteProgressBar sent={pasteJob.sent} total={pasteJob.total} onCancel={() => { void cancelPaste(tab.id); }} />
        )}

        {/* Vault autofill at a password prompt. An enable prompt is only
            offered an enable password. */}
        {detectedPasswordPrompt && vaultKey && isVaultUnlocked &&
          (detectedPasswordPrompt === 'login' ? vault?.hasLoginSecret !== false : vault?.hasEnableSecret) && (
          <PasswordPromptBar
            kind={detectedPasswordPrompt}
            vaultKey={vaultKey}
            onSend={detectedPasswordPrompt === 'enable' ? handleSendVaultEnablePassword : handleSendVaultPassword}
            onDismiss={() => setDetectedPasswordPrompt(null)}
          />
        )}
        {detectedPasswordPrompt && vault?.locked && vaultExists && (
          <VaultLockedPromptBar onUnlock={() => setUnlockOpen(true)} onDismiss={() => setDetectedPasswordPrompt(null)} />
        )}

        {enableNotice && !(detectedPasswordPrompt && vault?.locked && vaultExists) && (
          <EnableNoticeBar
            noVault={enableNotice === 'noVault'}
            onAddOne={onEditSessionSettings ? () => { setEnableNotice(null); onEditSessionSettings('credentials'); } : undefined}
            onDismiss={() => setEnableNotice(null)}
          />
        )}

        {unlockOpen && (
          <VaultUnlockDialog
            reason={unlockThenEnableRef.current
              ? "This session's enable password is in the vault. Unlock it and Thyrion sends it."
              : "This prompt's password is in the vault. Unlock it and Thyrion can send it."}
            onUnlocked={() => { setUnlockOpen(false); terminalRef.current?.focus(); void afterUnlock(); }}
            onCancel={() => { setUnlockOpen(false); unlockThenEnableRef.current = false; terminalRef.current?.focus(); }}
          />
        )}

        {/* Free Type Visual Click Indicator */}
        {clickIndicator && (
          <div
            className="free-type-cursor-indicator rounded"
            style={{
              transform: `translate(${clickIndicator.x - 12}px, ${clickIndicator.y - 8}px)`,
              width: '24px',
              height: '18px',
            }}
          />
        )}

        {contextMenu && (
          <TerminalContextMenu
            position={contextMenu}
            menuRef={contextMenuRef}
            onCopy={handleCopy}
            onPaste={handlePaste}
            onSelectAll={handleSelectAll}
            vault={{ shown: !isLocalSession, key: vaultKey, hasLogin: vault?.hasLoginSecret !== false, unlocked: isVaultUnlocked }}
            onSendLoginPassword={() => { setContextMenu(null); handleSendVaultPassword(); }}
            onSendEnablePassword={() => { setContextMenu(null); requestEnablePassword(); }}
            onClearScrollback={handleClearScrollback}
            onResetTerminal={handleResetTerminal}
            onOpenEventLog={() => { setContextMenu(null); setIsEventLogOpen(true); }}
            onOpenSessionLog={() => { setContextMenu(null); setIsLoggingOpen(true); }}
            onDuplicate={onDuplicateTab ? () => { setContextMenu(null); onDuplicateTab(tab); } : undefined}
            onRunScript={isTauriEnvironment() && tab.status !== 'disconnected' && !runningScript ? () => { void handleRunScript(); } : undefined}
            onEditSessionSettings={onEditSessionSettings ? () => { setContextMenu(null); onEditSessionSettings(); } : undefined}
            onOpenSettings={onOpenSettings ? () => { setContextMenu(null); onOpenSettings(); } : undefined}
            onReconnect={tab.status === 'disconnected' ? () => { setContextMenu(null); handleManualReconnect(); } : undefined}
            onFind={() => {
              setContextMenu(null);
              setIsSearchOpen(true);
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            onSendBreak={tab.protocol === 'Serial' ? () => {
              setContextMenu(null);
              // A serial Break (held ~400 ms): Cisco ROMMON and similar
              // password recovery need it during boot. Only a serial line
              // can send one (ADR-005).
              sendBreak(tab.id)
                .then(() => addEventLog('Sent a serial Break', 'info'))
                .catch(e => addEventLog(`Send Break failed: ${String(e)}`, 'error'));
            } : undefined}
            shellHooks={supportsShellHooks ? { injected: hooksInjected, lastShell: lastHooksShell, onInject: handleInjectHooks } : undefined}
            onSplitPane={onSplitPane ? (direction) => { onSplitPane(direction); setContextMenu(null); } : undefined}
          />
        )}

        {isEventLogOpen && (
          <EventLogDialog
            sessionName={tab.sessionName}
            logs={eventLogs}
            onCopyAll={() => {
              const text = eventLogs.map(e => `[${e.time}] ${e.message}`).join('\n');
              void writeClipboard(text);
              addEventLog("Event log copied to clipboard", 'info');
            }}
            onClear={() => setEventLogs([])}
            onClose={() => setIsEventLogOpen(false)}
          />
        )}

        {isLoggingOpen && (
          <SessionLogDialog
            isLogging={isLogging}
            loggedBytes={loggedBytes}
            path={logPath}
            error={logError}
            onCopyPath={() => { if (logPath) void writeClipboard(logPath); }}
            onToggle={() => { void toggleSessionLog(); }}
            onClose={() => setIsLoggingOpen(false)}
          />
        )}

        {/* Host key dialog. A changed key is the moment a man-in-the-middle
            shows up, and plink itself says Return (abandon) is the only
            guaranteed safe choice; so it gets a red frame, Abandon focused,
            and accepting reads as the destructive action it is. */}
        {pendingPrompt && (
          <HostKeyDialog prompt={pendingPrompt} onAnswer={handleAnswerPrompt} />
        )}
      </div>
    </div>
  );
};
