import React, { useEffect, useState } from 'react';
import { Shield, Monitor, RotateCcw, Check, Keyboard, FileCode } from 'lucide-react';
import { detectPutty, PuttyDetectInfo } from '../../../services/tauriBridge';
import { SHORTCUT_LIST } from '../../../services/shortcuts';

/** Settings > Advanced: PuTTY as found, resetting the layout, scripts and
 *  the keyboard shortcuts. */
export const AdvancedSettingsSection: React.FC<{ isOpen: boolean; onResetLayout: () => void }> = ({ isOpen, onResetLayout }) => {
  const [puttyInfo, setPuttyInfo] = useState<PuttyDetectInfo | null>(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (isOpen) {
      detectPutty().then(setPuttyInfo);
      setResetDone(false);
    }
  }, [isOpen]);

  const handleResetLayout = () => {
    onResetLayout();
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2000);
  };

  return (
    <>
      {/* PuTTY Environment */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-slate-300 font-semibold border-b border-plinky-800 pb-1">
          <Shield className="w-3.5 h-3.5 text-slate-400" />
          <span>PuTTY Discovery & Toolchain</span>
        </div>

        <div className="p-3 bg-plinky-950 rounded border border-plinky-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Binary Path:</span>
            <span className="font-mono text-slate-200">{puttyInfo?.path || '/usr/bin/plink'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Version:</span>
            <span className="font-mono text-slate-200">v{puttyInfo?.version || '0.85'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Status:</span>
            <span className="flex items-center space-x-1 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              <span>{puttyInfo?.ok ? 'Ready & Validated' : 'Detection Pending'}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Workbench Layout & State */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-slate-300 font-semibold border-b border-plinky-800 pb-1">
          <Monitor className="w-3.5 h-3.5 text-slate-400" />
          <span>Workbench Layout & Cache</span>
        </div>

        <div className="flex items-center justify-between p-2.5 bg-plinky-950 rounded border border-plinky-800">
          <div>
            <p className="font-medium text-slate-200">Reset Saved Layout</p>
            <p className="text-meta text-plinky-muted">Clears cached split panes, tab order, and restores default single layout.</p>
          </div>
          <button
            type="button"
            onClick={handleResetLayout}
            className="shrink-0 whitespace-nowrap flex items-center space-x-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            {resetDone ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Reset!</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>Reset Layout</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Scripts (src-tauri/src/scripts.rs, scripting/plinky.py) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-slate-300 font-semibold border-b border-plinky-800 pb-1">
          <FileCode className="w-3.5 h-3.5 text-slate-400" />
          <span>Scripts</span>
        </div>
        <div className="p-3 bg-plinky-950 rounded border border-plinky-800 space-y-2 text-meta text-slate-300 leading-relaxed">
          <p>
            Right-click a terminal and choose <strong>Run Script...</strong> to run a script on that session.
            What the script prints is typed into the session, and what the device prints is the script's input.
            Anything it writes to stderr shows in the terminal as a note and is not sent. <strong>Stop</strong> ends it.
          </p>
          <p>
            Python (<code>.py</code>) runs with <code>python3</code> (<code>python</code> on Windows); <code>.sh</code> with bash,
            {' '}<code>.ps1</code> with PowerShell, <code>.bat</code>/<code>.cmd</code> with cmd; anything else as a program.
          </p>
          <pre className="p-2 rounded bg-plinky-900 border border-plinky-800 font-mono text-slate-200 overflow-x-auto">{`from thyrion import session

session.send("terminal length 0")
session.wait_for_prompt()
config = session.command("show running-config")
open("backup.txt", "w").write(config)
session.log("saved", len(config), "characters")`}</pre>
          <p>
            <code>send(text)</code> types a line; <code>expect(regex)</code> waits for output;
            {' '}<code>wait_for_prompt()</code> waits for <code>#</code>, <code>&gt;</code> or <code>$</code>;
            {' '}<code>command(cmd)</code> returns a command's output; <code>log(...)</code> writes a note.
            Scripts never see the vault.
          </p>
        </div>
      </div>

      {/* Keyboard shortcuts (shortcuts.ts) */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2 text-slate-300 font-semibold border-b border-plinky-800 pb-1">
          <Keyboard className="w-3.5 h-3.5 text-slate-400" />
          <span>Keyboard Shortcuts</span>
        </div>
        <dl className="p-3 bg-plinky-950 rounded border border-plinky-800 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {SHORTCUT_LIST.map(s => (
            <React.Fragment key={s.action}>
              <dt className="flex flex-wrap gap-1">
                {s.keys.map(k => (
                  <kbd key={k} className="px-1.5 py-0.5 rounded bg-plinky-900 border border-plinky-700 font-mono text-meta text-slate-200 whitespace-nowrap">{k}</kbd>
                ))}
              </dt>
              <dd className="text-meta text-slate-300 self-center">{s.action}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="text-meta text-plinky-muted">Ctrl+C and Ctrl+V go to the device, as in PuTTY.</p>
      </div>
    </>
  );
};
