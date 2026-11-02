import type { Terminal, IDisposable, IMarker, ITheme } from '@xterm/xterm';

/**
 * Keyword highlighting for network-device output (T-017): interface
 * states, syslog severities, IOS error lines, interface names, addresses.
 *
 * Drawn as xterm decorations over the rendered text, not by rewriting the
 * byte stream: the session log, copied text and full-screen programs see
 * exactly what the device sent.
 */

export interface HighlightRule {
  re: RegExp;
  color: string;
}

export interface Highlight {
  start: number;
  end: number;
  color: string;
}

const RED = '#f87171';
const AMBER = '#fbbf24';
const GREEN = '#34d399';
const CYAN = '#22d3ee';
const VIOLET = '#c4b5fd';

/** Earlier rules win where matches overlap. All patterns use the g flag. */
export const NETWORK_RULES: HighlightRule[] = [
  // IOS/NX-OS/EOS command errors: "% Invalid input detected at '^' marker."
  { re: /%\s*(?:Invalid input detected|Incomplete command|Ambiguous command|Unknown command|Bad mask|Error)[^\r\n]*/gi, color: RED },
  // Syslog mnemonics by severity: %FACILITY-SEV-MNEMONIC
  { re: /%[A-Z][A-Z0-9_]*-[0-3]-[A-Z0-9_]+/g, color: RED },
  { re: /%[A-Z][A-Z0-9_]*-4-[A-Z0-9_]+/g, color: AMBER },
  { re: /%[A-Z][A-Z0-9_]*-[5-7]-[A-Z0-9_]+/g, color: CYAN },
  // States
  { re: /\badministratively down\b|\berr-?disabled\b|\bnotconnect\b|\b(?:down|failed|failure|errors?|denied|invalid|unreachable|timed out|timeout|mismatch|blocked|dropped)\b/gi, color: RED },
  { re: /\b(?:warning|warn|flapping|standby|pending|learning|listening|degraded)\b/gi, color: AMBER },
  { re: /\b(?:up|connected|established|forwarding|active|enabled|full)\b/gi, color: GREEN },
  // Interface names (Cisco/Arista/Juniper/Linux styles)
  { re: /\b(?:(?:Ten|Forty|Hundred|TwentyFive)?GigabitEthernet|FastEthernet|Ethernet|Port-channel|Vlan|Loopback|Tunnel|Serial|Management|mgmt|Gi|Te|Fa|Fo|Hu|Eth|Et|Po|Lo|Vl|Tu)\d+(?:\/\d+)*(?:\.\d+)?\b|\b(?:ge|xe|et|ae)-\d+(?:\/\d+)*(?:\.\d+)?\b/g, color: VIOLET },
  // IPv4 (with optional /prefix) and MAC addresses
  { re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\/(?:3[0-2]|[12]?\d))?\b/g, color: CYAN },
  { re: /\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b|\b(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\b/gi, color: CYAN },
];

/** Non-overlapping highlights for one line of text, in column order. */
export function findHighlights(text: string, rules: HighlightRule[] = NETWORK_RULES): Highlight[] {
  const taken: Highlight[] = [];
  const overlaps = (s: number, e: number) => taken.some(h => s < h.end && e > h.start);
  for (const rule of rules) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const start = m.index;
      const end = start + m[0].length;
      if (!overlaps(start, end)) taken.push({ start, end, color: rule.color });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** Lines scanned at most per pass, so a huge burst of output can't stall the UI. */
const MAX_LINES_PER_SCAN = 500;
/** Lines scanned at most once output settles after streaming (settle()). */
const SETTLE_SCAN_LINES = 2000;
/** Decorations kept before trimming the ones whose lines left the scrollback. */
const PRUNE_AT = 5000;

/**
 * Decorates finished lines as they arrive. The line the cursor is on is
 * left alone until the cursor moves past it (it may still be rewritten --
 * a prompt, a progress counter). Full-screen programs (the alternate
 * buffer: vim, top, less) are never decorated.
 */
export class KeywordHighlighter {
  private items: { marker: IMarker; deco: IDisposable }[] = [];
  /** The first line not scanned yet. A marker, not a line number: once the
   *  scrollback is full, line numbers stop growing (the top lines go), and
   *  a number kept here said every new line was already scanned. */
  private next: IMarker | null = null;
  private enabled: boolean;
  /** Output is streaming: nothing new is decorated (standAside()). */
  private aside = false;

  /** Rule colour -> the scheme's own colour for it. The rules name fixed
   *  colours; drawn as they are, amber #fbbf24 and cyan #22d3ee were
   *  unreadable on a light scheme and clashed with every other one. */
  private colourMap: Record<string, string> = {};

  constructor(private term: Terminal, enabled = true) {
    this.enabled = enabled;
  }

  /** Takes the scheme's ANSI colours: the bright ones on a dark scheme,
   *  the normal ones on a light scheme, where bright ones are too pale. */
  setTheme(theme: ITheme, light = false) {
    const pick = (normal?: string, bright?: string) => (light ? normal : bright ?? normal);
    const m: Record<string, string | undefined> = {
      [RED]: pick(theme.red, theme.brightRed),
      [AMBER]: pick(theme.yellow, theme.brightYellow),
      [GREEN]: pick(theme.green, theme.brightGreen),
      [CYAN]: pick(theme.cyan, theme.brightCyan),
      [VIOLET]: pick(theme.magenta, theme.brightMagenta),
    };
    this.colourMap = Object.fromEntries(Object.entries(m).filter(([, v]) => !!v)) as Record<string, string>;
    // Highlights already drawn keep the old scheme's colours (cyan IPs on a
    // white terminal): redraw what is on screen.
    if (this.enabled && this.items.length > 0) {
      this.clear();
      this.rewind();
      this.scan();
    }
  }

  colourFor(ruleColour: string): string {
    return this.colourMap[ruleColour] ?? ruleColour;
  }

  get count(): number {
    return this.items.filter(i => !i.marker.isDisposed).length;
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      // Pick up what's on screen now, not only what arrives next.
      this.rewind();
      this.scan();
    } else {
      this.clear();
    }
  }

  clear() {
    for (const i of this.items) {
      i.deco.dispose();
      i.marker.dispose();
    }
    this.items = [];
  }

  private cursorLine(): number {
    const buf = this.term.buffer.active;
    return buf.baseY + buf.cursorY;
  }

  /** The next scan starts at this line. */
  private resumeAt(line: number) {
    this.next?.dispose();
    this.next = this.term.registerMarker(line - this.cursorLine()) ?? null;
  }

  /** Where the next scan starts: the marker's line, or, with no marker (or
   *  its line gone from the scrollback), as far back as one scan reaches. */
  private resumeLine(cursorLine: number): number {
    if (this.next && !this.next.isDisposed && this.next.line >= 0) return this.next.line;
    return Math.max(0, cursorLine - MAX_LINES_PER_SCAN);
  }

  /** Scan back over what is on screen now, as a first scan would. */
  private rewind() {
    this.next?.dispose();
    this.next = null;
  }

  /** Decorate every finished line not seen yet. Call after output is written. */
  scan(maxLines = MAX_LINES_PER_SCAN) {
    const buf = this.term.buffer.active;
    if (!this.enabled || this.aside || buf.type !== 'normal') return;
    const cursorLine = this.cursorLine();
    // Cleared under us (a marker can't be past the cursor otherwise).
    const from = Math.max(Math.min(this.resumeLine(cursorLine), cursorLine), cursorLine - maxLines);
    for (let y = from; y < cursorLine; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const hits = findHighlights(line.translateToString(true));
      if (hits.length === 0) continue;
      for (const h of hits) {
        const marker = this.term.registerMarker(y - cursorLine);
        if (!marker) continue;
        const deco = this.term.registerDecoration({
          marker,
          x: h.start,
          width: h.end - h.start,
          foregroundColor: this.colourFor(h.color),
          layer: 'top',
        });
        if (deco) this.items.push({ marker, deco });
        else marker.dispose();
      }
    }
    this.resumeAt(cursorLine);
    if (this.items.length > PRUNE_AT) this.items = this.items.filter(i => !i.marker.isDisposed);
  }

  /**
   * Output is streaming: take the highlights off the screen and add none
   * until settle(). xterm (DOM renderer, 5.5) redraws the whole screen for
   * every line that scrolls in, and draws each decorated character as a
   * <span> of its own: with a config's addresses and interfaces coloured, a
   * 300-line paste on a serial console (C891F) took 40-120 ms a frame and
   * stood still for 100 ms and more. Plain, it drew line by line, as
   * SecureCRT does. Highlights above the screen stay: they cost nothing.
   */
  standAside() {
    const buf = this.term.buffer.active;
    // A full-screen program's output: it has no highlights to take off.
    if (this.aside || buf.type !== 'normal') return;
    this.aside = true;
    const top = buf.viewportY;
    let first = Infinity;
    this.items = this.items.filter(i => {
      const line = i.marker.line;
      if (line < top) return !i.marker.isDisposed;
      first = Math.min(first, line);
      i.deco.dispose();
      i.marker.dispose();
      return false;
    });
    if (first < this.resumeLine(this.cursorLine())) this.resumeAt(first);
  }

  /** Output has settled: decorate what arrived while it streamed. */
  settle() {
    if (!this.aside) return;
    this.aside = false;
    this.scan(SETTLE_SCAN_LINES);
  }

  dispose() {
    this.clear();
    this.next?.dispose();
    this.next = null;
  }
}

/** Quiet after output before a scan, and the longest output waits for one. */
export const SCAN_QUIET_MS = 150;
export const SCAN_MAX_WAIT_MS = 1000;
/** Lines in one go (no pause of SETTLE_MS) that make output a stream. */
export const STREAM_LINES = 24;
/** Quiet that ends a stream. Longer than a serial console's pause between
 *  the lines of a pasted config (0.1-0.2 s on a C891F at 9600). */
export const SETTLE_MS = 600;

/**
 * When to decorate. Output arrives in many small chunks: scan them in one
 * pass once output pauses, and at least once a second while it doesn't.
 * Once a screenful of lines has come without a pause, the output streams
 * (a pasted config, a long show): highlighting stands aside until it
 * settles (KeywordHighlighter.standAside()).
 */
export function highlightPacer(h: Pick<KeywordHighlighter, 'scan' | 'standAside' | 'settle'>) {
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let firstPending: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let lines = 0;
  let streaming = false;
  // setTimeout and clearTimeout are called plainly: as methods of another
  // object, WebKit refuses them ("Illegal invocation").
  const cancelScan = () => {
    if (scanTimer !== null) clearTimeout(scanTimer);
    scanTimer = null;
    firstPending = null;
  };
  const requestScan = () => {
    const now = Date.now();
    if (firstPending === null) firstPending = now;
    if (scanTimer !== null) clearTimeout(scanTimer);
    const due = Math.min(now + SCAN_QUIET_MS, firstPending + SCAN_MAX_WAIT_MS);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      firstPending = null;
      h.scan();
    }, Math.max(0, due - now));
  };
  return {
    /** The terminal moved to a new line (xterm's onLineFeed). */
    lineFeed() {
      lines++;
      if (streaming || lines < STREAM_LINES) return;
      streaming = true;
      cancelScan();
      h.standAside();
    },
    /** Output was written. */
    written() {
      if (!streaming) requestScan();
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        lines = 0;
        if (!streaming) return;
        streaming = false;
        h.settle();
      }, SETTLE_MS);
    },
    dispose() {
      cancelScan();
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
    },
  };
}
