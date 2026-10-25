import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { listPuttyHostKeys, HostKeyPromptInfo } from '../../services/tauriBridge';

// The host-key decision: a key PuTTY has never seen, or one that changed
// since PuTTY saved it. Shown over the terminal while plink waits.

export const HostKeyDialog: React.FC<{
  prompt: HostKeyPromptInfo;
  onAnswer: (answer: 'reject' | 'once' | 'store') => void;
}> = ({ prompt, onAnswer }) => {
  const changed = !!prompt.changed;
  const abandonRef = useRef<HTMLButtonElement>(null);
  // The fingerprint PuTTY saved, beside the one offered now: comparing the
  // two is the whole decision, and only the new one was shown.
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => {
    if (!changed) return;
    let live = true;
    void storedFingerprint(prompt).then(fp => { if (live) setStored(fp); });
    return () => { live = false; };
  }, [changed, prompt]);
  // The parent re-renders on every chunk of output; a fresh onAnswer each
  // time must not re-run the effect and yank focus back to Abandon.
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;
  useEffect(() => {
    abandonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        answerRef.current('reject');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (prompt.question) {
    // A question plink asked that Thyrion has no dialog of its own for.
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-plinky-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div role="alertdialog" aria-modal="true" aria-labelledby="question-title"
          className="bg-plinky-900 border border-amber-500/60 rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-100">
          <h3 id="question-title" className="text-base font-semibold text-white mb-2">PuTTY is asking</h3>
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-slate-200 bg-plinky-950/80 border border-plinky-800 rounded-lg p-3 mb-5">{prompt.question}</pre>
          <div className="flex gap-2 justify-end">
            <button ref={abandonRef} onClick={() => onAnswer('reject')}
              className="px-3 py-2 rounded-lg text-xs font-semibold bg-plinky-800 hover:bg-plinky-700 text-slate-200 outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-plinky-900 focus:ring-sky-400">
              No
            </button>
            <button onClick={() => onAnswer('once')}
              className="px-3 py-2 rounded-lg bg-sky-700 hover:brightness-110 text-on-accent text-xs font-medium">
              Yes
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (prompt.weak) {
    // plink's weak-crypto question, before any host key. It used to land in
    // the terminal as plain text; the answer had to be typed.
    const [what, alg] = prompt.weak.split(': ');
    return (
      <div className="absolute inset-0 z-50 flex items-center justify-center bg-plinky-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="weakcrypto-title"
          aria-describedby="weakcrypto-desc"
          className="bg-plinky-900 border border-amber-500/60 rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-100"
        >
          <div className="flex items-start space-x-3 mb-4">
            <div className="p-2.5 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-400">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 id="weakcrypto-title" className="text-base font-semibold text-white">This server only offers outdated encryption</h3>
              <p id="weakcrypto-desc" className="text-xs text-slate-300 mt-1 leading-relaxed">
                Its first {what || 'algorithm'} is <span className="font-mono text-amber-300">{alg || prompt.weak}</span>,
                which PuTTY rates below its warning threshold. Older network gear often only has this; the
                connection works, but is easier to break than a modern one.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 justify-end">
            <button
              ref={abandonRef}
              onClick={() => onAnswer('reject')}
              className="order-first px-3 py-2 rounded-lg text-xs font-semibold bg-plinky-800 hover:bg-plinky-700 text-slate-200 outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-plinky-900 focus:ring-sky-400"
            >
              Abandon connection
            </button>
            <button
              onClick={() => onAnswer('once')}
              className="px-3 py-2 rounded-lg bg-sky-700 hover:brightness-110 text-on-accent text-xs font-medium transition-colors"
            >
              Connect anyway
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-plinky-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hostkey-title"
        aria-describedby="hostkey-desc"
        className={`bg-plinky-900 border rounded-xl shadow-2xl max-w-lg w-full p-6 text-slate-100 ${
          changed ? 'border-rose-500/80 ring-1 ring-rose-500/40' : 'border-amber-500/60'
        }`}
      >
        <div className="flex items-start space-x-3 mb-4">
          <div className={`p-2.5 rounded-lg border ${
            changed ? 'bg-rose-500/15 border-rose-500/40 text-rose-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
          }`}>
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 id="hostkey-title" className="text-base font-semibold text-white">
              {changed ? 'This server\'s host key has changed' : 'New host: check its key'}
            </h3>
            <p id="hostkey-desc" className="text-xs text-slate-300 mt-1 leading-relaxed">
              {changed ? (
                <>
                  The key {prompt.host || 'this server'} offered does not match the one PuTTY saved on an earlier visit.
                  Either an administrator replaced it, or something is intercepting the connection.{' '}
                  <strong className="text-rose-300">Abandon unless you were told the key changed</strong>, and
                  compare the fingerprint with the administrator first.
                </>
              ) : (
                <>PuTTY has never connected to this server before, so it cannot vouch for it. Compare the fingerprint with one you trust before storing it.</>
              )}
            </p>
          </div>
        </div>

        <div className="space-y-2 bg-plinky-950/80 rounded-lg p-3 border border-plinky-800 text-xs mb-5">
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Destination</span>
            <span className="font-mono text-slate-200 font-semibold">{prompt.host}:{prompt.port}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Key type</span>
            <span className="font-mono text-slate-200">{prompt.key_type}</span>
          </div>
          <div>
            <span className="text-slate-400 block mb-1">{changed ? 'Offered now' : 'Fingerprint'}</span>
            <span className={`font-mono break-all select-all font-semibold ${changed ? 'text-rose-200' : 'text-slate-100'}`}>
              {prompt.fingerprint}
            </span>
          </div>
          {changed && (
            <div>
              <span className="text-slate-400 block mb-1">Saved by PuTTY earlier</span>
              <span className="font-mono break-all select-all text-slate-300">
                {stored ?? 'Not found in PuTTY\u2019s store'}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-end">
          {changed ? (
            <>
              <button
                onClick={() => onAnswer('store')}
                className="px-3 py-2 rounded-lg border border-rose-500/50 text-rose-300 hover:bg-rose-500/10 text-xs font-medium transition-colors"
              >
                I expected this: replace the key
              </button>
              <button
                onClick={() => onAnswer('once')}
                className="px-3 py-2 rounded-lg border border-plinky-700 text-slate-300 hover:bg-plinky-800 text-xs font-medium transition-colors"
              >
                Connect once, keep the old key
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onAnswer('once')}
                className="px-3 py-2 rounded-lg border border-plinky-700 text-slate-300 hover:bg-plinky-800 text-xs font-medium transition-colors"
              >
                Connect once
              </button>
              <button
                onClick={() => onAnswer('store')}
                className="px-3 py-2 rounded-lg bg-sky-700 hover:brightness-110 text-on-accent text-xs font-medium transition-colors"
              >
                Trust and store key
              </button>
            </>
          )}
          <button
            ref={abandonRef}
            onClick={() => onAnswer('reject')}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-plinky-900 ${
              changed
                ? 'order-first sm:order-last bg-rose-700 hover:brightness-110 text-on-danger focus:ring-rose-300'
                : 'order-first bg-plinky-800 hover:bg-plinky-700 text-slate-200 focus:ring-sky-400'
            }`}
          >
            Abandon connection
          </button>
        </div>
      </div>
    </div>
  );
};

/** The fingerprint PuTTY has saved for this prompt's host, port and key
 *  type; the prompt names the type as the server does ("ssh-rsa"), the
 *  cache as PuTTY does ("rsa2"). */
export async function storedFingerprint(prompt: HostKeyPromptInfo): Promise<string | null> {
  const cacheType = ({ 'ssh-rsa': 'rsa2', 'ssh-dss': 'dss' } as Record<string, string>)[prompt.key_type] ?? prompt.key_type;
  try {
    const keys = await listPuttyHostKeys();
    return keys.find(k => k.hostname === prompt.host && k.port === prompt.port && k.keyType === cacheType)?.fingerprint ?? null;
  } catch {
    return null;
  }
}
