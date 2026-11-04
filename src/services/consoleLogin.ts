// What a console's automatic login has done in a tab's connection: whether
// the username and password were sent, and whether the user has run a
// command since (promptDetect.ts, consoleLoginAction).
//
// Kept here, per tab, not in the terminal view: the view remounts when the
// tab is switched away and back, and as refs these started over. A nested
// `ssh` started on the console, then a tab switch, and its Password: prompt
// (replayed, or the next one) got the console's password.

export interface ConsoleLoginState {
  sent: { user: boolean; password: boolean };
  commandRun: boolean;
}

const states = new Map<string, ConsoleLoginState>();

const fresh = (): ConsoleLoginState => ({ sent: { user: false, password: false }, commandRun: false });

/** This tab's state for its current connection. */
export function consoleLoginState(tabId: string): ConsoleLoginState {
  let s = states.get(tabId);
  if (!s) {
    s = fresh();
    states.set(tabId, s);
  }
  return s;
}

/** A new connection in this tab logs in again. */
export function resetConsoleLogin(tabId: string) {
  states.set(tabId, fresh());
}

/** The tab's session is closed. */
export function forgetConsoleLogin(tabId: string) {
  states.delete(tabId);
}
