import React from 'react';
import { version as APP_VERSION } from '../../../../package.json';

/** Settings > About. Alis, the mascot, was the owner's dog. */
export const AboutSection: React.FC = () => {
  return (
    <>
      <div className="p-3 bg-plinky-950 rounded border border-plinky-800 flex items-start gap-3" data-about>
        <img src="/favicon.svg" alt="Alis, Thyrion's mascot" className="w-14 h-14 shrink-0 rounded-md" draggable={false} />
        <div className="space-y-1.5 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-slate-100">Thyrion</span>
            <span className="font-mono text-meta text-plinky-muted">v{APP_VERSION}</span>
          </div>
          <p className="text-slate-400">A terminal and session manager built on PuTTY. Free software under the GPL-3.0.</p>
          <p className="text-slate-300">
            Thyrion's mascot is <span className="font-semibold text-slate-100">Alis</span>. In memory of a very good dog.
          </p>
          <p className="text-meta text-plinky-muted">
            The name: Thyrion (Θύριον), a town of ancient Acarnania, from θύρα, a door, or a port.
          </p>
        </div>
      </div>
    </>
  );
};
