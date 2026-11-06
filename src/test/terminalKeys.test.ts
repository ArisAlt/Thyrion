import { describe, it, expect } from 'vitest';
import { noteTerminalFocus, shortcutIsFor } from '../services/terminalKeys';

const view = (id: string, shown = true) => {
  const root = document.createElement('div');
  root.dataset.terminalView = id;
  const input = document.createElement('textarea');
  root.appendChild(input);
  document.body.appendChild(root);
  // jsdom lays nothing out: a view on screen has a box, a hidden tab none.
  root.getClientRects = () => (shown ? [{}] : []) as unknown as DOMRectList;
  return { root, input };
};

describe('window-wide terminal shortcuts', () => {
  it('belong to the terminal they were pressed in, not to every one', () => {
    // Ctrl+F opened search in both split panes and in every hidden tab.
    const a = view('a'), b = view('b');
    expect(shortcutIsFor('a', a.input, a.root)).toBe(true);
    expect(shortcutIsFor('b', a.input, b.root)).toBe(false);
  });

  it('with focus outside every terminal, go to the one last used, if it is on screen', () => {
    const a = view('a'), b = view('b'), hidden = view('c', false);
    const sidebar = document.createElement('input');
    document.body.appendChild(sidebar);
    noteTerminalFocus('b');
    expect(shortcutIsFor('a', sidebar, a.root)).toBe(false);
    expect(shortcutIsFor('b', sidebar, b.root)).toBe(true);
    noteTerminalFocus('c');
    expect(shortcutIsFor('c', sidebar, hidden.root)).toBe(false);
  });
});
