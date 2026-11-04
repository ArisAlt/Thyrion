// What a chunk of a session's output says about the session: it has ended,
// it is still logging in, or the login is over. The terminal (TerminalView)
// sets the tab's status from the answer.

/** plink's and the device's login prompts. */
export function looksLikeLogin(text: string): boolean {
  return (
    text.includes('password:') ||
    text.includes('Password:') ||
    text.includes('login as:') ||
    text.includes('Using username') ||
    text.includes('passphrase') ||
    text.includes('Passphrase') ||
    text.includes('(yes/no') ||
    text.includes('Store key in cache?')
  );
}

/** Signs the login is over: plink's and sshd's lines, or a shell prompt. */
export function looksLive(text: string): boolean {
  return (
    text.includes('Access granted') ||
    text.includes('Last login:') ||
    /(?:[\$#%❯]\s*)$/m.test(text.trim())
  );
}

/** Thyrion's own lines for a session that has ended (output_reader.rs). */
const CLOSED_NOTICES = ['[Thyrion: Session closed', '[Thyrion: Host key was rejected]', '[Thyrion: Error: '];

/**
 * The session's process has ended, or plink gave up.
 *
 * plink's "FATAL ERROR:" only counts before the login is over: after it,
 * the text is the session's own output, and a log or a file on screen with
 * that line in it marked a healthy tab disconnected; with auto-reconnect
 * on, Thyrion closed it and connected again. A drop after the login ends
 * with Thyrion's own "Session closed" as well.
 */
export function sessionEnded(text: string, reachedLive = false): boolean {
  return CLOSED_NOTICES.some(n => text.includes(n)) || (!reachedLive && text.includes('FATAL ERROR:'));
}

/**
 * Whether an ended session reconnects by itself: the session asks for it,
 * a network one, and plink said the connection failed (a clean `exit`
 * prints no FATAL), after a login that worked or during the retries that
 * followed one. Only the first retry happened: it fails before any login,
 * and the next one waited for a login that had worked.
 */
export function reconnectsAfterEnd(s: {
  autoReconnect: boolean;
  networkProtocol: boolean;
  /** The output just before the end. */
  recent: string;
  reachedLive: boolean;
  /** Retries already made since the last login that worked. */
  attempts: number;
}): boolean {
  return s.autoReconnect && s.networkProtocol && s.recent.includes('FATAL ERROR:') && (s.reachedLive || s.attempts > 0);
}

/**
 * - `ended`: the session has just ended.
 * - `stillEnded`: output from a process that had already ended; it changes nothing.
 * - `preauth`: a login prompt, before the login is over.
 * - `live`: the login is over.
 * - `null`: nothing that changes the status.
 */
export type OutputStatus = 'ended' | 'stillEnded' | 'preauth' | 'live' | null;

export function readOutputStatus(text: string, session: {
  /** The process has ended already. */
  ended: boolean;
  /** The login was over before this chunk. */
  reachedLive: boolean;
  /** A telnet or raw console (GNS3): no login messages, and often no prompt
   *  until Enter, so any output at all means it is connected (T-020). */
  consoleTarget: boolean;
}): OutputStatus {
  if (sessionEnded(text, session.reachedLive)) return 'ended';
  if (session.ended) return 'stillEnded';
  // Only before the login is over. After it, text that looks like a login
  // is the session's own output: Windows' pseudo-console repaints plink's
  // whole screen (the old "password:" included) when the tab tells it its
  // size on reattach, and a router's `enable` asks "Password:". Either
  // turned a live tab amber.
  if (looksLikeLogin(text) && !session.reachedLive) return 'preauth';
  if (looksLive(text) || (session.consoleTarget && !session.reachedLive && text.length > 0)) return 'live';
  return null;
}
