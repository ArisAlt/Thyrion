import React, { useEffect, useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { vaultIsInitialized, vaultDestroy } from '../../../services/tauriBridge';

/** Settings > Vault: deleting the vault, after two warnings. */
export const VaultSettingsSection: React.FC<{ isOpen: boolean }> = ({ isOpen }) => {
  // Delete vault: two warnings, then delete.
  const [vaultExists, setVaultExists] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'warn1' | 'warn2' | 'deleting'>('idle');
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDeleteStep('idle');
      setDeleteResult(null);
      vaultIsInitialized().then(setVaultExists).catch(() => setVaultExists(false));
    }
  }, [isOpen]);

  const handleDeleteVault = async () => {
    setDeleteStep('deleting');
    try {
      const deleted = await vaultDestroy();
      setDeleteResult(deleted ? 'Vault deleted. Open Vault to create a new one.' : 'There was no vault to delete.');
      setVaultExists(false);
    } catch (e) {
      setDeleteResult(String(e));
    } finally {
      setDeleteStep('idle');
    }
  };

  return (
    <>
      <div className="p-2.5 bg-plinky-950 rounded border border-plinky-800 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-200">Delete Vault</p>
            <p className="text-meta text-plinky-muted">
              {vaultExists
                ? 'Permanently deletes the vault and every password saved in it.'
                : 'There is no vault yet, so there is nothing to delete.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setDeleteResult(null); setDeleteStep('warn1'); }}
            disabled={!vaultExists || deleteStep !== 'idle'}
            title={vaultExists ? 'Delete the vault' : 'There is no vault'}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded bg-rose-950/40 border border-rose-800/50 hover:bg-rose-900/50 text-rose-300 disabled:opacity-40 disabled:pointer-events-none transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Vault</span>
          </button>
        </div>

        {deleteStep === 'warn1' && (
          <div role="alertdialog" aria-label="First warning" className="p-2.5 rounded border border-amber-600/50 bg-amber-950/30 space-y-2">
            <p className="flex items-start space-x-1.5 text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span>
                Delete the vault? Every saved password and enable password in it will be deleted from this
                computer. Your sessions stay, but they will ask for passwords again.
              </span>
            </p>
            <div className="flex justify-end space-x-2">
              <button type="button" onClick={() => setDeleteStep('idle')} className="px-3 py-1 rounded bg-plinky-800 hover:bg-plinky-700">Cancel</button>
              <button type="button" onClick={() => setDeleteStep('warn2')} className="px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-on-warn">Yes, continue</button>
            </div>
          </div>
        )}

        {(deleteStep === 'warn2' || deleteStep === 'deleting') && (
          <div role="alertdialog" aria-label="Final warning" className="p-2.5 rounded border border-rose-600/60 bg-rose-950/40 space-y-2">
            <p className="flex items-start space-x-1.5 text-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
              <span>
                Last warning: this can't be undone. If you might need these passwords, cancel and use
                Vault → Export to KeePass first.
              </span>
            </p>
            <div className="flex justify-end space-x-2">
              <button type="button" onClick={() => setDeleteStep('idle')} disabled={deleteStep === 'deleting'} className="px-3 py-1 rounded bg-plinky-800 hover:bg-plinky-700 disabled:opacity-40">Cancel</button>
              <button type="button" onClick={handleDeleteVault} disabled={deleteStep === 'deleting'} className="px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-on-danger font-medium disabled:opacity-40">
                {deleteStep === 'deleting' ? 'Deleting…' : 'Delete vault permanently'}
              </button>
            </div>
          </div>
        )}

        {deleteResult && <p role="status" className="text-meta text-slate-300">{deleteResult}</p>}
      </div>
    </>
  );
};
