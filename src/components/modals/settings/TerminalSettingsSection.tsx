import React from 'react';
import { TERMINAL_FONTS } from '../../../themes/fonts';
import { TERMINAL_FONT_MIN, TERMINAL_FONT_MAX } from '../../../services/terminalFontKeys';
import { SCROLLBACK_CHOICES, DEFAULT_SCROLLBACK, setScrollback, useScrollback } from '../../../services/scrollback';

/** Settings > Terminal: the default font, cursor and scrollback. */
export const TerminalSettingsSection: React.FC<{
  fontFamily: string;
  onChangeFontFamily: (font: string) => void;
  fontSize: number;
  onChangeFontSize: (size: number) => void;
  cursorStyle: 'block' | 'bar' | 'underline';
  onChangeCursorStyle: (style: 'block' | 'bar' | 'underline') => void;
}> = ({ fontFamily, onChangeFontFamily, fontSize, onChangeFontSize, cursorStyle, onChangeCursorStyle }) => {
  const scrollback = useScrollback();
  const knownFont = TERMINAL_FONTS.some(f => f.value === fontFamily);

  return (
    <>
      <p className="text-meta text-plinky-muted">
        The default for every session. A saved session can have its own font: right-click it,
        Change Session Settings, Appearance.
      </p>

      {/* Font Family */}
      <div className="space-y-1">
        <label htmlFor="settings-modal-font-family" className="text-meta text-slate-400 font-medium">Font Family</label>
        <select id="settings-modal-font-family"
          value={fontFamily}
          onChange={(e) => onChangeFontFamily(e.target.value)}
          className="w-full px-2.5 py-1.5 bg-plinky-950 border border-plinky-700 rounded text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition"
        >
          {!knownFont && <option value={fontFamily}>Custom (saved)</option>}
          <optgroup label="Built in">
            {TERMINAL_FONTS.filter(f => f.bundled).map(f => (
              <option key={f.value} value={f.value}>{f.label}{f.note ? ` (${f.note})` : ''}</option>
            ))}
          </optgroup>
          <optgroup label="If installed">
            {TERMINAL_FONTS.filter(f => !f.bundled).map(f => (
              <option key={f.value} value={f.value}>{f.label}{f.note ? ` (${f.note})` : ''}</option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Font Size & Cursor Style */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="settings-modal-font-size-px" className="text-meta text-slate-400 font-medium" title="Ctrl+Shift+= / Ctrl+Shift+- · Ctrl+Shift+0 resets">Font Size ({fontSize}px)</label>
          <input id="settings-modal-font-size-px"
            type="range"
            min={TERMINAL_FONT_MIN}
            max={TERMINAL_FONT_MAX}
            step="1"
            value={fontSize}
            onChange={(e) => onChangeFontSize(parseInt(e.target.value, 10))}
            className="w-full accent-sky-500 cursor-pointer"
          />
        </div>

        <div className="space-y-1">
          <label className="text-meta text-slate-400 font-medium">Cursor Style</label>
          <div className="flex space-x-1">
            {(['block', 'bar', 'underline'] as const).map(style => (
              <button
                key={style}
                type="button"
                onClick={() => onChangeCursorStyle(style)}
                className={`flex-1 py-1 rounded text-center capitalize transition border ${
                  cursorStyle === style
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                    : 'bg-plinky-950 border-plinky-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scrollback (scrollback.ts) */}
      <div className="space-y-1">
        <label htmlFor="settings-scrollback" className="text-meta text-slate-400 font-medium">Scrollback</label>
        <select
          id="settings-scrollback"
          value={scrollback}
          onChange={(e) => setScrollback(Number(e.target.value))}
          className="w-full bg-plinky-950 border border-plinky-800 rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
        >
          {SCROLLBACK_CHOICES.map(n => (
            <option key={n} value={n}>
              {n.toLocaleString('en-US')} lines{n === 2000 ? ' (PuTTY)' : n === DEFAULT_SCROLLBACK ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <p className="text-meta text-plinky-muted">
          Lines kept above the screen, for scrolling back and Copy All to Clipboard. More lines use more memory in every open tab.
        </p>
      </div>
    </>
  );
};
