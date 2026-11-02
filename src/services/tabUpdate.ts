import type { TerminalTab } from '../types/session';

/**
 * The tab list with `updates` applied to one tab, or the same list when
 * nothing would change. The terminal says "live" again on every prompt it
 * prints (a config paste on a Cisco console: every line ends in
 * `Switch(config)#`), and a new list each time re-rendered the whole window
 * and every tab: the screen stood still for 100 ms and more at a time, on a
 * C891F console at 9600 baud with nine tabs open.
 */
export function withTabUpdate(tabs: TerminalTab[], tabId: string, updates: Partial<TerminalTab>): TerminalTab[] {
  const i = tabs.findIndex(t => t.id === tabId);
  if (i < 0) return tabs;
  const tab = tabs[i];
  const changes = (Object.keys(updates) as (keyof TerminalTab)[]).some(k => tab[k] !== updates[k]);
  if (!changes) return tabs;
  const next = tabs.slice();
  next[i] = { ...tab, ...updates };
  return next;
}
