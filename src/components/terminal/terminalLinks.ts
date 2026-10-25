import { Terminal } from '@xterm/xterm';
import { writeClipboard } from '../../services/clipboard';

// Links in a terminal's output: clicking an IPv4 address copies it, clicking
// a URL opens it.

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

      // IPv4 Pattern Matcher
      const ipRegex = /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
      let match;
      while ((match = ipRegex.exec(text)) !== null) {
        const start = match.index + 1;
        const matchedText = match[0];
        links.push({
          range: {
            start: { x: start, y: bufferLineNumber },
            end: { x: start + matchedText.length, y: bufferLineNumber },
          },
          text: matchedText,
          activate: (_e, ip) => {
            void writeClipboard(ip);
          },
        });
      }

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
