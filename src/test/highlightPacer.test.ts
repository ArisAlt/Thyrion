import { describe, it, expect, vi, afterEach } from 'vitest';
import { Terminal } from '@xterm/xterm';
import {
  KeywordHighlighter, highlightPacer, SCAN_QUIET_MS, SCAN_MAX_WAIT_MS, STREAM_LINES, SETTLE_MS,
} from '../services/keywordHighlight';

afterEach(() => { vi.useRealTimers(); });

const pacer = () => {
  const h = { scan: vi.fn(), standAside: vi.fn(), settle: vi.fn() };
  return { h, p: highlightPacer(h) };
};

describe('highlight pacing', () => {
  it('scans once output pauses', () => {
    vi.useFakeTimers();
    const { h, p } = pacer();
    p.written();
    vi.advanceTimersByTime(50);
    p.written();
    vi.advanceTimersByTime(SCAN_QUIET_MS - 1);
    expect(h.scan).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.scan).toHaveBeenCalledTimes(1);
  });

  it('scans about once a second while a few lines keep coming', () => {
    vi.useFakeTimers();
    const { h, p } = pacer();
    for (let t = 0; t < 3000; t += 5) {
      p.written();
      vi.advanceTimersByTime(5);
    }
    expect(h.scan.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.scan.mock.calls.length).toBeLessThanOrEqual(Math.ceil(3000 / SCAN_MAX_WAIT_MS));
    expect(h.standAside).not.toHaveBeenCalled();
  });

  it('stands aside while lines stream, and decorates once they settle', () => {
    // A config pasted on a serial console: a line every 0.2 s, never quiet
    // for long. Each scan's highlights made every later line cost a redraw
    // of the whole screen, span by span.
    vi.useFakeTimers();
    const { h, p } = pacer();
    for (let i = 0; i < 300; i++) {
      p.written();
      p.lineFeed();
      vi.advanceTimersByTime(200);
    }
    expect(h.standAside).toHaveBeenCalledTimes(1);
    const scansBefore = h.scan.mock.calls.length;
    expect(scansBefore).toBeLessThanOrEqual(Math.ceil((STREAM_LINES * 200) / SCAN_QUIET_MS));
    expect(h.settle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SETTLE_MS);
    expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.scan.mock.calls.length).toBe(scansBefore);
  });

  it('typing, and a short reply, never count as streaming', () => {
    vi.useFakeTimers();
    const { h, p } = pacer();
    for (let cmd = 0; cmd < 10; cmd++) {
      for (let i = 0; i < 5; i++) { p.written(); p.lineFeed(); }
      vi.advanceTimersByTime(SETTLE_MS + 1);
    }
    expect(h.standAside).not.toHaveBeenCalled();
  });

  it('does nothing after dispose', () => {
    vi.useFakeTimers();
    const { h, p } = pacer();
    p.written();
    p.dispose();
    vi.advanceTimersByTime(SETTLE_MS + SCAN_MAX_WAIT_MS);
    expect(h.scan).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
  });
});

const write = (term: Terminal, data: string) => new Promise<void>(r => term.write(data, r));

describe('keyword highlighter on a real terminal', () => {
  const setup = (scrollback = 1000) => {
    const term = new Terminal({ allowProposedApi: true, rows: 24, cols: 80, scrollback });
    const hl = new KeywordHighlighter(term);
    return { term, hl };
  };

  it('keeps decorating once the scrollback is full', async () => {
    // The next line to scan was a line number; with the scrollback full the
    // numbers stop growing, and no new line was ever decorated.
    const { term, hl } = setup(100);
    for (let i = 0; i < 300; i++) await write(term, `line ${i}\r\n`);
    hl.scan();
    const before = hl.count;
    await write(term, 'interface Gi0/1 is up\r\n');
    hl.scan();
    expect(hl.count).toBe(before + 2);
  });

  it('takes the highlights off the screen while streaming, and puts them back', async () => {
    const { term, hl } = setup();
    for (let i = 0; i < 10; i++) await write(term, `permit 10.0.${i}.0 0.0.0.255\r\n`);
    hl.scan();
    expect(hl.count).toBe(20);
    hl.standAside();
    expect(hl.count).toBe(0);
    for (let i = 10; i < 40; i++) await write(term, `permit 10.0.${i}.0 0.0.0.255\r\n`);
    hl.scan();
    expect(hl.count).toBe(0);
    hl.settle();
    expect(hl.count).toBe(80);
  });
});

describe('highlight pacing under WebGL', () => {
  it('keeps highlighting while lines stream: WebGL draws it cheaply', () => {
    vi.useFakeTimers();
    const h = { scan: vi.fn(), standAside: vi.fn(), settle: vi.fn() };
    const p = highlightPacer(h, { asideWhileStreaming: () => false });
    for (let i = 0; i < 100; i++) {
      p.written();
      p.lineFeed();
      vi.advanceTimersByTime(200);
    }
    expect(h.standAside).not.toHaveBeenCalled();
    expect(h.scan.mock.calls.length).toBeGreaterThan(50);
  });
});
