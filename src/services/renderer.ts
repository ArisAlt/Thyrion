// How the terminal is drawn: with WebGL on the GPU where there is one,
// with xterm's DOM renderer everywhere else (Settings > Terminal).
//
// The DOM renderer redraws the whole screen for every line that scrolls in
// and draws each highlighted character as a <span> of its own: keyword
// highlighting has to stand aside while output streams (keywordHighlight.ts)
// or a long paste stutters. WebGL draws the same screen in a fraction of
// that, colours included, so highlights stay on as output streams. In the
// renderer spike (WebKitGTK 2.52, coloured output) DOM topped out at
// 36-38 MB/s and WebGL kept up at 53.
//
// On by default on Windows and macOS. Off by default on Linux, where it was
// measured: a 300-line config pasted on a C891F's console froze the screen
// for up to 73 ms with WebGL (WebKitGTK, hidden test screen, render node
// present) and never with the DOM renderer and highlighting standing aside.
//
// Without a GPU (Linux with no render node: a VM, a remote desktop, CI)
// WebGL is drawn in software, slower than the DOM: such a machine keeps the
// DOM renderer. So does a terminal whose WebGL context is lost (a driver
// reset, a GPU switch): xterm goes back to the DOM renderer by itself.
import { useEffect, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke } from '@tauri-apps/api/core';
import { isTauriEnvironment } from './tauriBridge';

const isLinux = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);
export const DEFAULT_GPU_RENDERING = !isLinux;

const KEY = 'plinky_gpu_rendering';
const EVENT = 'plinky:gpu-rendering';

export function getGpuRendering(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'true' || v === 'false') return v === 'true';
  } catch { /* storage unavailable */ }
  return DEFAULT_GPU_RENDERING;
}

export function setGpuRendering(on: boolean) {
  try { localStorage.setItem(KEY, String(on)); } catch { /* not remembered */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useGpuRendering(): boolean {
  const [on, setOn] = useState(getGpuRendering);
  useEffect(() => {
    const update = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, []);
  return on;
}

let gpu: Promise<boolean> | null = null;

/** WebGL2 the webview would draw on the GPU. Chromium (WebView2) answers
 *  null here for software WebGL (SwiftShader: a VM, a remote desktop). */
function hardwareWebgl2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Whether WebGL here runs on a GPU: the backend's gpu_available (a render
 *  node, on Linux), and the webview's own answer. */
export function gpuAvailable(): Promise<boolean> {
  if (!gpu) {
    const backend = isTauriEnvironment()
      ? invoke<boolean>('gpu_available').catch(() => false)
      : Promise.resolve(true);
    gpu = backend.then((ok) => ok && hardwareWebgl2());
  }
  return gpu;
}

/**
 * Draws `term` with WebGL until stop() or a lost context. `onChange` hears
 * true once WebGL draws, false once it no longer does. A webview without
 * WebGL2 keeps the DOM renderer (loading the addon throws).
 */
export function startGpuRenderer(term: Terminal, onChange: (webgl: boolean) => void) {
  let addon: WebglAddon | null = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    if (!addon) return;
    const a = addon;
    addon = null;
    // A terminal disposed first (its tab closed) has disposed it already.
    try { a.dispose(); } catch { /* already gone */ }
    onChange(false);
  };
  void gpuAvailable().then((ok) => {
    if (!ok || stopped || !term.element) return;
    try {
      const a = new WebglAddon();
      a.onContextLoss(() => { if (addon === a) stop(); });
      term.loadAddon(a);
      addon = a;
      onChange(true);
    } catch (e) {
      console.warn('thyrion: WebGL renderer unavailable, drawing with the DOM:', e);
    }
  });
  return { stop };
}
