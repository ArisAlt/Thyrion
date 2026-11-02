import { Terminal } from '@xterm/xterm';

// Links in a terminal's output: clicking a URL opens it. IP addresses were
// links too (a click copied one), underlined under the mouse; nobody needed
// that, and a config full of addresses scrolling under a resting mouse kept
// finding them (owner).

export function registerLinks(term: Terminal) {
  return term.registerLinkProvider({
    provideLinks: (bufferLineNumber, callback) => {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(true);
      const links: Array<{
        range: { start: { x: number; y: number }; end: { x: number; y: number } };
        text: string;
        activate: (event: MouseEvent, text: string) => void;
      }> = [];

      let match;
      // URL Pattern Matcher
      const urlRegex = /https?:\/\/[^\s/$.?#].[^\s]*/g;
      while ((match = urlRegex.exec(text)) !== null) {
        const start = match.index + 1;
        const matchedText = match[0];
        links.push({
          range: {
            start: { x: start, y: bufferLineNumber },
            end: { x: start + matchedText.length, y: bufferLineNumber },
          },
          text: matchedText,
          activate: (_e, url) => {
            window.open(url, '_blank');
          },
        });
      }

      callback(links);
    },
  });
}
