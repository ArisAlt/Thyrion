import React from 'react';
import { UI_THEMES, applyUiTheme, useUiTheme } from '../../../themes/uiThemes';
import { TERMINAL_THEMES, MATCH_INTERFACE, setTerminalTheme, useTerminalTheme } from '../../../themes/terminalThemes';
import { useUiZoom, zoomIn, zoomOut, zoomReset, UI_ZOOM_MIN, UI_ZOOM_MAX } from '../../../services/uiZoom';
import { TerminalSchemePreview } from '../../common/TerminalSchemePreview';

/** Settings > Appearance: the interface's theme and size, and the default
 *  terminal colour scheme with a preview. */
export const AppearanceSettingsSection: React.FC<{
  /** The terminal font, for the preview. */
  fontFamily: string;
  fontSize: number;
}> = ({ fontFamily, fontSize }) => {
  const uiZoom = useUiZoom();
  const uiTheme = useUiTheme();
  const termTheme = useTerminalTheme();

  return (
    <>
      {/* Interface theme */}
      <div className="space-y-2">
        <div className="text-slate-300 font-semibold">Interface theme</div>
        <div role="radiogroup" aria-label="Interface theme" className="grid grid-cols-3 gap-2">
          {UI_THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={uiTheme === t.id}
              onClick={() => applyUiTheme(t.id)}
              className={`flex items-center gap-2 p-1.5 rounded border text-left transition ${
                uiTheme === t.id ? 'border-sky-500 bg-sky-500/10 text-slate-100' : 'border-plinky-700 hover:border-plinky-600 text-slate-300'
              }`}
            >
              <span className="flex h-6 w-9 shrink-0 overflow-hidden rounded border border-black/20" aria-hidden>
                <span className="flex-1" style={{ background: t.swatch[0] }} />
                <span className="flex-1" style={{ background: t.swatch[1] }} />
                <span className="flex-1" style={{ background: t.swatch[2] }} />
                <span className="flex-1" style={{ background: t.swatch[3] }} />
              </span>
              <span className="truncate">{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Interface size */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-slate-300 font-semibold">Interface size</div>
            <div className="text-meta text-plinky-muted">Sessions, tabs and dialogs. Set here only.</div>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Interface size">
            <button type="button" onClick={zoomOut} disabled={uiZoom <= UI_ZOOM_MIN} aria-label="Smaller interface"
              className="w-7 h-7 rounded border border-plinky-700 bg-plinky-950 text-slate-200 hover:border-sky-500 disabled:opacity-40">−</button>
            <span className="w-12 text-center tabular-nums text-slate-200" aria-live="polite">{Math.round(uiZoom * 100)}%</span>
            <button type="button" onClick={zoomIn} disabled={uiZoom >= UI_ZOOM_MAX} aria-label="Larger interface"
              className="w-7 h-7 rounded border border-plinky-700 bg-plinky-950 text-slate-200 hover:border-sky-500 disabled:opacity-40">+</button>
            <button type="button" onClick={zoomReset} disabled={uiZoom === 1}
              className="ml-1 px-2 h-7 rounded text-slate-400 hover:text-slate-200 hover:bg-plinky-800 disabled:opacity-40">Reset</button>
          </div>
        </div>
      </div>

      {/* Terminal colour scheme + live preview */}
      <div className="space-y-2">
        <div className="space-y-1">
          <label htmlFor="settings-terminal-scheme" className="text-slate-300 font-semibold">Terminal colour scheme</label>
          <p className="text-meta text-plinky-muted">
            The default for every session. A saved session can have its own: right-click it,
            Change Session Settings, Appearance.
          </p>
          <select
            id="settings-terminal-scheme"
            value={termTheme.id}
            onChange={(e) => setTerminalTheme(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-plinky-950 border border-plinky-700 rounded text-xs text-slate-200 focus:outline-none focus:border-sky-500 transition"
          >
            <option value={MATCH_INTERFACE}>Match interface theme</option>
            {TERMINAL_THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <TerminalSchemePreview scheme={termTheme} fontFamily={fontFamily} fontSize={fontSize} testId="terminal-preview" />
      </div>
    </>
  );
};
