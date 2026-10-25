import React from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';

// Find in Terminal: the bar over the terminal's top right corner. The
// search itself (xterm's search addon) is the terminal's.

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  isRegex: boolean;
}

const toggleClass = (on: boolean) =>
  `px-1.5 py-0.5 rounded text-meta font-bold border transition ${
    on ? 'bg-sky-500/20 text-sky-300 border-sky-500/50' : 'text-plinky-muted border-transparent hover:text-slate-300'
  }`;

export const TerminalSearchBar: React.FC<{
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  /** Which match is shown, of how many. */
  stats: { index: number; total: number } | null;
  onFind: (direction: 'next' | 'prev') => void;
  options: SearchOptions;
  onToggle: (option: keyof SearchOptions) => void;
  onClose: () => void;
}> = ({ inputRef, query, onQueryChange, stats, onFind, options, onToggle, onClose }) => (
  <div className="absolute top-10 right-4 z-40 flex items-center space-x-1.5 p-2 bg-plinky-900 border border-sky-500/40 rounded-lg shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2 duration-150 text-xs">
    <Search className="w-3.5 h-3.5 text-sky-400 ml-1" />
    <input
      ref={inputRef}
      type="text"
      aria-label="Find in terminal"
      placeholder="Find in terminal…"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onFind(e.shiftKey ? 'prev' : 'next');
      }}
      className="w-44 bg-plinky-950 border border-plinky-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
    />

    <span className="text-meta font-mono text-slate-400 px-1 min-w-[50px] text-center">
      {stats ? `${stats.index + 1}/${stats.total}` : (query ? '0/0' : '')}
    </span>

    <button onClick={() => onFind('prev')} title="Previous Match (Shift+Enter)" className="p-1 rounded hover:bg-plinky-800 text-slate-400 hover:text-white">
      <ChevronUp className="w-3.5 h-3.5" />
    </button>
    <button onClick={() => onFind('next')} title="Next Match (Enter)" className="p-1 rounded hover:bg-plinky-800 text-slate-400 hover:text-white">
      <ChevronDown className="w-3.5 h-3.5" />
    </button>

    <button onClick={() => onToggle('caseSensitive')} title="Match Case" className={toggleClass(options.caseSensitive)}>
      Aa
    </button>
    <button onClick={() => onToggle('wholeWord')} title="Match Whole Word" className={toggleClass(options.wholeWord)}>
      \b
    </button>
    <button onClick={() => onToggle('isRegex')} title="Use Regular Expression" className={toggleClass(options.isRegex)}>
      .*
    </button>

    <button onClick={onClose} title="Close Search (Esc)" className="p-1 text-plinky-muted hover:text-rose-400 ml-1">
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);
