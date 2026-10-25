import React from 'react';
import { usePasteConfirmMode, setPasteConfirmMode, PasteConfirmMode } from '../../../services/pasteConfirm';
import { useMiddleClickPaste, setMiddleClickPaste } from '../../../services/middleClickPaste';

const PASTE_OPTIONS: { mode: PasteConfirmMode; label: string; hint: string }[] = [
  { mode: 'multiline', label: 'Multi-line pastes', hint: 'Asks before pasting several lines' },
  { mode: 'always', label: 'Every paste', hint: 'Asks before any paste' },
  { mode: 'never', label: 'Never', hint: 'Pastes straight away' },
];

/** Settings > Mouse & Clipboard: copy on select, middle and right click,
 *  and when the paste window shows. */
export const MouseSettingsSection: React.FC<{
  copyOnSelect: boolean;
  onChangeCopyOnSelect?: (val: boolean) => void;
  rightClickAction: 'paste' | 'contextMenu';
  onChangeRightClickAction?: (action: 'paste' | 'contextMenu') => void;
}> = ({ copyOnSelect, onChangeCopyOnSelect, rightClickAction, onChangeRightClickAction }) => {
  const pasteMode = usePasteConfirmMode();
  const middleClickPaste = useMiddleClickPaste();

  return (
    <>
      <div className="space-y-3 p-3 bg-plinky-950 rounded border border-plinky-800">
        {/* Copy on select */}
        <label className="flex items-start space-x-2.5 cursor-pointer">
          <input
            id="settings-copy-on-select"
            type="checkbox"
            checked={copyOnSelect}
            onChange={(e) => onChangeCopyOnSelect?.(e.target.checked)}
            className="mt-0.5 rounded border-plinky-700 bg-plinky-900 text-sky-500 focus:ring-0 cursor-pointer"
          />
          <div className="select-none">
            <span className="text-slate-200 font-medium block">Copy on select (Classic PuTTY)</span>
            <span className="text-meta text-plinky-muted block">Selecting text with the mouse copies it to the clipboard straight away, no shortcut needed.</span>
          </div>
        </label>

        {/* Middle-click paste (middleClickPaste.ts) */}
        <label className="flex items-start space-x-2.5 cursor-pointer pt-2 border-t border-plinky-800/80">
          <input
            id="settings-middle-click-paste"
            type="checkbox"
            checked={middleClickPaste}
            onChange={(e) => setMiddleClickPaste(e.target.checked)}
            className="mt-0.5 rounded border-plinky-700 bg-plinky-900 text-sky-500 focus:ring-0 cursor-pointer"
          />
          <div className="select-none">
            <span className="text-slate-200 font-medium block">Middle-click pastes (PuTTY)</span>
            <span className="text-meta text-plinky-muted block">
              Pressing the scroll wheel pastes the clipboard, the way the paste keys do (paste window included).
              On Linux too it pastes the clipboard, not PuTTY's X selection (text selected in another program
              but not copied). With Copy on select on, what you select in Thyrion is in both.
              When a program uses the mouse, Shift+middle-click pastes.
            </span>
          </div>
        </label>

        {/* Right-click action */}
        <div className="space-y-1.5 pt-2 border-t border-plinky-800/80">
          <label className="text-meta text-slate-400 font-medium block">Right-Click Action</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeRightClickAction?.('contextMenu')}
              className={`py-1.5 px-2 rounded text-left transition border ${
                rightClickAction === 'contextMenu'
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                  : 'bg-plinky-900 border-plinky-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="font-semibold text-meta">Context Menu</div>
              <div className="text-meta text-slate-400">Show PuTTY action menu</div>
            </button>

            <button
              type="button"
              onClick={() => onChangeRightClickAction?.('paste')}
              className={`py-1.5 px-2 rounded text-left transition border ${
                rightClickAction === 'paste'
                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                  : 'bg-plinky-900 border-plinky-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="font-semibold text-meta">Paste Clipboard (PuTTY)</div>
              <div className="text-meta text-slate-400">Right click pastes (Shift+Right for menu)</div>
            </button>
          </div>
        </div>

        {/* Paste window (pasteConfirm.ts) */}
        <div className="space-y-1.5 pt-2 border-t border-plinky-800/80">
          <label className="text-meta text-slate-400 font-medium block">Show the paste window</label>
          <div className="grid grid-cols-3 gap-2">
            {PASTE_OPTIONS.map(o => (
              <button
                key={o.mode}
                type="button"
                onClick={() => setPasteConfirmMode(o.mode)}
                aria-pressed={pasteMode === o.mode}
                className={`py-1.5 px-2 rounded text-left transition border ${
                  pasteMode === o.mode
                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 font-medium'
                    : 'bg-plinky-900 border-plinky-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="font-semibold text-meta">{o.label}</div>
                <div className="text-meta text-slate-400">{o.hint}</div>
              </button>
            ))}
          </div>
          <p className="text-meta text-plinky-muted">Shows the text before it is sent, so you can check or edit it.</p>
        </div>
      </div>
    </>
  );
};
