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

/** The session's process has ended, or plink gave up. */
export function sessionEnded(text: string): boolean {
  return text.includes('[Thyrion: Session closed') || text.includes('FATAL ERROR:');
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
  if (sessionEnded(text)) return 'ended';
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
