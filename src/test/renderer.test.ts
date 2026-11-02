import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({
  gpu: true, hardware: true, throwOnLoad: false, addons: [] as { disposed: boolean; loseContext: () => void }[],
}));
vi.mock('../services/tauriBridge', () => ({ isTauriEnvironment: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string) => (cmd === 'gpu_available' ? env.gpu : null),
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    disposed = false;
    private lost: (() => void) | null = null;
    constructor() { env.addons.push(this as never); }
    onContextLoss(cb: () => void) { this.lost = cb; return { dispose() {} }; }
    loseContext() { this.lost?.(); }
    dispose() { this.disposed = true; }
  },
}));

const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeTerm = () => ({
  element: {},
  loadAddon: vi.fn(() => { if (env.throwOnLoad) throw new Error('no webgl2'); }),
});

beforeEach(() => {
  vi.resetModules();
  env.gpu = true; env.hardware = true; env.throwOnLoad = false; env.addons = [];
  // jsdom has no WebGL: the webview's answer to failIfMajorPerformanceCaveat.
  HTMLCanvasElement.prototype.getContext = (() => (env.hardware ? { getExtension: () => null } : null)) as never;
});

describe('the terminal renderer', () => {
  it('draws with WebGL where there is a GPU', async () => {
    const { startGpuRenderer } = await import('../services/renderer');
    const term = fakeTerm(), seen: boolean[] = [];
    startGpuRenderer(term as never, (on) => seen.push(on));
    await flush();
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([true]);
  });

  it('keeps the DOM without a GPU: software WebGL is slower than it', async () => {
    env.gpu = false;
    const { startGpuRenderer } = await import('../services/renderer');
    const term = fakeTerm(), seen: boolean[] = [];
    startGpuRenderer(term as never, (on) => seen.push(on));
    await flush();
    expect(term.loadAddon).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('keeps the DOM where the webview would draw WebGL in software', async () => {
    // WebView2 on a VM or over remote desktop: SwiftShader.
    env.hardware = false;
    const { startGpuRenderer } = await import('../services/renderer');
    const term = fakeTerm();
    startGpuRenderer(term as never, () => {});
    await flush();
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('keeps the DOM when the webview has no WebGL2', async () => {
    env.throwOnLoad = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { startGpuRenderer } = await import('../services/renderer');
    const seen: boolean[] = [];
    startGpuRenderer(fakeTerm() as never, (on) => seen.push(on));
    await flush();
    expect(seen).toEqual([]);
    warn.mockRestore();
  });

  it('goes back to the DOM when the GPU context is lost', async () => {
    const { startGpuRenderer } = await import('../services/renderer');
    const seen: boolean[] = [];
    startGpuRenderer(fakeTerm() as never, (on) => seen.push(on));
    await flush();
    env.addons[0].loseContext();
    expect(env.addons[0].disposed).toBe(true);
    expect(seen).toEqual([true, false]);
  });

  it('turned off before the GPU answered, never loads', async () => {
    const { startGpuRenderer } = await import('../services/renderer');
    const term = fakeTerm();
    startGpuRenderer(term as never, () => {}).stop();
    await flush();
    expect(term.loadAddon).not.toHaveBeenCalled();
  });

  it('is off by default on Linux, on elsewhere, and remembered', async () => {
    const { getGpuRendering, setGpuRendering } = await import('../services/renderer');
    localStorage.removeItem('plinky_gpu_rendering');
    expect(getGpuRendering()).toBe(!/Linux/.test(navigator.userAgent));
    setGpuRendering(true);
    expect(getGpuRendering()).toBe(true);
    setGpuRendering(false);
    expect(getGpuRendering()).toBe(false);
    localStorage.removeItem('plinky_gpu_rendering');
  });
});
