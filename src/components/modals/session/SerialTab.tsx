import React from 'react';
import { Cpu } from 'lucide-react';
import { Setter } from './types';

/** Session settings > Serial: the line's data bits, stop bits, parity and
 *  flow control. The line and speed are on General. */
export const SerialTab: React.FC<{
  serialDataBits: string;
  setSerialDataBits: Setter<string>;
  serialStopBits: string;
  setSerialStopBits: Setter<string>;
  serialParity: string;
  setSerialParity: Setter<string>;
  serialFlowControl: string;
  setSerialFlowControl: Setter<string>;
}> = ({
  serialDataBits, setSerialDataBits, serialStopBits, setSerialStopBits, serialParity,
  setSerialParity, serialFlowControl, setSerialFlowControl,
}) => {
  return (
    <>
      <div className="p-3 bg-plinky-950/70 border border-plinky-800 rounded-md space-y-2">
        <div className="flex items-center space-x-2 text-slate-300 font-medium pb-1 border-b border-plinky-800">
          <Cpu className="w-3.5 h-3.5 text-slate-400" />
          <span>Line settings</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-1">
            <label htmlFor="new-session-modal-data-bits" className="text-slate-400 text-meta">Data Bits</label>
            <select id="new-session-modal-data-bits"
              value={serialDataBits}
              onChange={e => setSerialDataBits(e.target.value)}
              className="w-full bg-plinky-900 border border-plinky-700 rounded px-1.5 py-0.5 text-slate-200 text-xs"
            >
              <option value="8">8</option>
              <option value="7">7</option>
              <option value="6">6</option>
              <option value="5">5</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="new-session-modal-stop-bits" className="text-slate-400 text-meta">Stop Bits</label>
            <select id="new-session-modal-stop-bits"
              value={serialStopBits}
              onChange={e => setSerialStopBits(e.target.value)}
              className="w-full bg-plinky-900 border border-plinky-700 rounded px-1.5 py-0.5 text-slate-200 text-xs"
            >
              <option value="2">1</option>
              <option value="4">2</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="new-session-modal-parity" className="text-slate-400 text-meta">Parity</label>
            <select id="new-session-modal-parity"
              value={serialParity}
              onChange={e => setSerialParity(e.target.value)}
              className="w-full bg-plinky-900 border border-plinky-700 rounded px-1.5 py-0.5 text-slate-200 text-xs"
            >
              <option value="0">None</option>
              <option value="1">Odd</option>
              <option value="2">Even</option>
            </select>
          </div>

          <div className="space-y-1">
            <label htmlFor="new-session-modal-flow-control" className="text-slate-400 text-meta">Flow Control</label>
            <select id="new-session-modal-flow-control"
              value={serialFlowControl}
              onChange={e => setSerialFlowControl(e.target.value)}
              className="w-full bg-plinky-900 border border-plinky-700 rounded px-1.5 py-0.5 text-slate-200 text-xs"
            >
              <option value="0">None</option>
              <option value="1">XON/XOFF</option>
              <option value="2">RTS/CTS</option>
            </select>
          </div>
        </div>
      </div>
    </>
  );
};
