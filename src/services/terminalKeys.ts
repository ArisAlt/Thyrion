// Which terminal a window-wide shortcut (Ctrl+F, Ctrl+Up/Down) is for.
//
// Every terminal view listens for them on the window, and every one acted:
// Ctrl+F opened search in each split pane and in every hidden tab at once.
// The view the key was pressed in takes it; with focus outside every
// terminal (the session list, the tab bar), the one last used, if it is on
// screen.

let lastFocused: string | null = null;

/** A terminal view, or something inside it, took focus. */
export function noteTerminalFocus(tabId: string) {
  lastFocused = tabId;
}

/** Whether a shortcut with this target belongs to the view `root` of tab `tabId`. */
export function shortcutIsFor(tabId: string, target: EventTarget | null, root: HTMLElement | null): boolean {
  if (!root) return false;
  const view = target instanceof Element ? target.closest('[data-terminal-view]') : null;
  if (view) return view === root;
  return lastFocused === tabId && root.getClientRects().length > 0;
}
