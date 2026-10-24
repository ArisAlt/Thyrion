// Middle click (the scroll wheel) pastes, as in PuTTY. Thyrion pastes the
// clipboard through its own paste path (the paste window, serial echo
// pacing, line endings) on every system. PuTTY on Linux pastes the X
// primary selection instead; with Copy on select on, Thyrion's own
// selections are in the clipboard too, so they come back the same. Off,
// a middle click is the webview's: on Linux it pastes the X selection, on
// Windows it does nothing.
import { useEffect, useState } from 'react';

export const DEFAULT_MIDDLE_CLICK_PASTE = true;

const KEY = 'plinky_middle_click_paste';
const EVENT = 'plinky:middle-click-paste';

export function getMiddleClickPaste(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'true' || v === 'false') return v === 'true';
  } catch { /* storage unavailable */ }
  return DEFAULT_MIDDLE_CLICK_PASTE;
}

export function setMiddleClickPaste(on: boolean) {
  try { localStorage.setItem(KEY, String(on)); } catch { /* not remembered */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useMiddleClickPaste(): boolean {
  const [on, setOn] = useState(getMiddleClickPaste);
  useEffect(() => {
    const update = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return on;
}
