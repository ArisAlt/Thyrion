import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock } from 'lucide-react';
import { vaultCreate, vaultUnlock } from '../../services/tauriBridge';

/** The shortest master password the Vault screen accepts too. */
const MIN_MASTER_LENGTH = 8;

interface Props {
  /** What the unlock is for, in a sentence ("to save this session's password"). */
  reason: string;
  /** `create` when there is no vault yet: a new master password, twice. */
  mode?: 'unlock' | 'create';
  onUnlocked: () => void;
  /** "Not now", or Escape. */
  onCancel: () => void;
  /** Given, the cancel button carries on without the vault instead (its
   *  label says what that does), and only Escape goes back. */
  onSkip?: () => void;
  skipLabel?: string;
}

// Asked for in place. A locked vault used to leave the session dialog with a
// note to go to "Vault in the top bar", which meant closing the dialog and
// losing what was typed into it.
export const VaultUnlockDialog: React.FC<Props> = ({ reason, mode = 'unlock', onUnlocked, onCancel, onSkip, skipLabel }) => {
  const creating = mode === 'create';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // While the vault is being unlocked or created, neither button nor Escape
  // can leave: "Save without the password" would save while the vault
  // opens anyway.
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    inputRef.current?.focus();
    // Escape closes this, not the dialog underneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (!busyRef.current) onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!password || busy) return;
    if (creating) {
      if (password.length < MIN_MASTER_LENGTH) {
        setError(`Use at least ${MIN_MASTER_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError('The two passwords are not the same.');
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (creating) await vaultCreate(password);
      else await vaultUnlock(password);
      setPassword('');
      setConfirm('');
      onUnlocked();
    } catch (err) {
      setError(creating ? `The vault wasn't created: ${String(err)}` : 'That master password did not unlock the vault.');
      inputRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  const errorId = error ? 'vault-unlock-error' : undefined;
  const inputClass = 'w-full bg-plinky-950 border border-plinky-700 rounded px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-sky-500';

  // A portal: this opens from inside the session form, and a form can't
  // hold another form.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-plinky-950/75 backdrop-blur-xs p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-unlock-title"
        onSubmit={submit}
        className="bg-plinky-900 border border-plinky-700 rounded-lg shadow-2xl max-w-sm w-full p-5 text-slate-100 space-y-3"
      >
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="vault-unlock-title" className="text-base font-semibold text-white">
              {creating ? 'Create the vault' : 'Unlock the vault'}
            </h3>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed">{reason}</p>
            {creating && (
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                The master password is never stored. Forget it and the vault can't be opened.
              </p>
            )}
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="vault-unlock-password" className="text-slate-300 text-meta">
            {creating ? 'New master password' : 'Master password'}
          </label>
          <input
            id="vault-unlock-password"
            ref={inputRef}
            type="password"
            autoComplete={creating ? 'new-password' : 'off'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={errorId}
            className={inputClass}
          />
        </div>
        {creating && (
          <div className="space-y-1">
            <label htmlFor="vault-unlock-confirm" className="text-slate-300 text-meta">Confirm master password</label>
            <input
              id="vault-unlock-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={errorId}
              className={inputClass}
            />
          </div>
        )}
        {error && <p id="vault-unlock-error" role="alert" className="text-rose-300 text-meta">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onSkip ?? onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-plinky-700 text-slate-200 hover:bg-plinky-800 text-xs disabled:opacity-50"
          >
            {onSkip ? (skipLabel ?? 'Skip') : 'Not now'}
          </button>
          <button
            type="submit"
            disabled={!password || (creating && !confirm) || busy}
            className="px-3 py-1.5 rounded bg-sky-700 text-on-accent text-xs font-medium hover:brightness-110 disabled:opacity-50"
          >
            {creating
              ? (busy ? 'Creating…' : 'Create')
              : (busy ? 'Unlocking…' : 'Unlock')}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};
