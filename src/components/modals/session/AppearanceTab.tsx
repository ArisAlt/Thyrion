import React from 'react';
import { TERMINAL_THEMES, MATCH_INTERFACE, findTerminalTheme, useTerminalTheme } from '../../../themes/terminalThemes';
import { TERMINAL_FONTS, DEFAULT_TERMINAL_FONT } from '../../../themes/fonts';
import { TerminalSchemePreview } from '../../common/TerminalSchemePreview';
import { Setter } from './types';

/** Session settings > Appearance: this session's own scheme and font, over
 *  Settings (the gear), which stays the default for every session. */
export const AppearanceTab: React.FC<{
  lookScheme: string;
  setLookScheme: Setter<string>;
  lookFont: string;
  setLookFont: Setter<string>;
  lookSize: string;
  setLookSize: Setter<string>;
}> = ({
  lookScheme, setLookScheme, lookFont, setLookFont, lookSize, setLookSize,
}) => {
  // The preview shows what this session will look like: its own choice, or
  // Settings' default where it has none.
  const defaultScheme = useTerminalTheme();
  const storedFont = (() => { try { return localStorage.getItem('plinky_terminal_font') || DEFAULT_TERMINAL_FONT; } catch { return DEFAULT_TERMINAL_FONT; } })();
  const storedSize = (() => { try { const n = Number(localStorage.getItem('plinky_terminal_font_size')); return n >= 8 && n <= 32 ? n : 14; } catch { return 14; } })();

  return (
    <>
      <p className="text-meta text-plinky-muted">
        For this session only. "Use default" follows Settings (the gear), the default for every session.
      </p>
      <div className="space-y-1">
        <label htmlFor="session-look-scheme" className="text-slate-300 font-medium">Colour scheme</label>
        <select
          id="session-look-scheme"
          value={lookScheme}
          onChange={e => setLookScheme(e.target.value)}
          className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="">Use default (from Settings)</option>
          <option value={MATCH_INTERFACE}>Match interface theme</option>
          {TERMINAL_THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="session-look-font" className="text-slate-300 font-medium">Font</label>
        <select
          id="session-look-font"
          value={lookFont}
          onChange={e => setLookFont(e.target.value)}
          className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="">Use default (from Settings)</option>
          {lookFont && !TERMINAL_FONTS.some(f => f.value === lookFont) && <option value={lookFont}>Custom (saved)</option>}
          {TERMINAL_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}{f.note ? ` (${f.note})` : ''}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="session-look-size" className="text-slate-300 font-medium">Font size</label>
        <select
          id="session-look-size"
          value={lookSize}
          onChange={e => setLookSize(e.target.value)}
          className="w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="">Use default (from Settings)</option>
          {Array.from({ length: 25 }, (_, i) => i + 8).map(n => <option key={n} value={String(n)}>{n} px</option>)}
        </select>
      </div>
      <TerminalSchemePreview
        scheme={lookScheme ? findTerminalTheme(lookScheme) : defaultScheme}
        fontFamily={lookFont || storedFont}
        fontSize={Number(lookSize) || storedSize}
        testId="session-look-preview"
      />
    </>
  );
};
