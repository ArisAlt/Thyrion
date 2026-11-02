import { describe, it, expect } from 'vitest';
import { withTabUpdate } from '../services/tabUpdate';
import type { TerminalTab } from '../types/session';

const tab = (id: string, status: TerminalTab['status'] = 'live'): TerminalTab => ({
  id, title: id, sessionName: id, syncChannel: 'none', status, freeTypeMode: false, activeHighlighting: true, hostname: '', port: 0,
});

describe('withTabUpdate', () => {
  it('gives back the same list when nothing changes, so nothing re-renders', () => {
    const tabs = [tab('a'), tab('b')];
    expect(withTabUpdate(tabs, 'b', { status: 'live' })).toBe(tabs);
    expect(withTabUpdate(tabs, 'nope', { status: 'disconnected' })).toBe(tabs);
  });

  it('changes only the tab that changed', () => {
    const tabs = [tab('a'), tab('b')];
    const next = withTabUpdate(tabs, 'b', { status: 'disconnected' });
    expect(next).not.toBe(tabs);
    expect(next[0]).toBe(tabs[0]);
    expect(next[1]).toEqual({ ...tabs[1], status: 'disconnected' });
  });
});
