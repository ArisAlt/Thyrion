import assert from 'node:assert/strict';
import { clickButton, fill } from '../lib/actions.mjs';

export const title = 'Vault creation, locking, wrong password and persistence';
export async function setup() { return {}; }
const password = 'e2e-only master passphrase 7!';
const secret = 'e2e-only secret 42';
// The backend's error for reading a secret, or null if it was read. Caught
// in the page: WebView2's inspector reports a rejected call only as
// "Uncaught (in promise)", without the backend's message.
const vaultGetError = (app) => app.run(async (e) => {
  try { await e.invoke('vault_get', { key: 'e2e:credential' }); return null; }
  catch (err) { return String(err?.message ?? err); }
});
const openVault = (app) => app.run((e) => e.click(document.querySelector('[aria-label="Vault"]')));

export const tests = [
  ['creating a vault through the UI unlocks it and stores a credential', async ({ app }) => {
    await openVault(app);
    await fill(app, '#vault-manager-master-password', password);
    await fill(app, '#vault-manager-confirm-master-password', password);
    await clickButton(app, 'Create & Encrypt Vault');
    await app.waitFor(async (e) => await e.invoke('vault_is_unlocked'), [], { timeoutMs: 10000 });
    await clickButton(app, 'Add Credential');
    await fill(app, '[aria-label="Key / Session Identifier"]', 'e2e:credential');
    await fill(app, '[aria-label="Secret"]', secret);
    await clickButton(app, 'Save Secret');
    await app.waitFor(async (e) => (await e.invoke('vault_get', { key: 'e2e:credential' })) === 'e2e-only secret 42');
  }],

  ['locking blocks secret access and a wrong master password cannot unlock it', async ({ app }) => {
    await clickButton(app, 'Lock Vault');
    await app.waitFor(async (e) => !(await e.invoke('vault_is_unlocked')));
    assert.match(await vaultGetError(app) ?? 'read the secret', /locked/i);
    await fill(app, '#vault-manager-master-password-2', 'wrong password');
    await clickButton(app, 'Unlock Credential Vault');
    await app.waitFor(() => /Failed to unlock|incorrect|invalid|wrong|decryption/i.test(document.body.innerText), [], { what: 'the wrong-password error', timeoutMs: 10000 });
    assert.equal(await app.invoke('vault_is_unlocked'), false);
    assert.match(await vaultGetError(app) ?? 'read the secret', /locked/i);
  }],

  ['the right password restores the credential; restarting locks the vault again', async ({ app, ctx }) => {
    await fill(app, '#vault-manager-master-password-2', password);
    await clickButton(app, 'Unlock Credential Vault');
    await app.waitFor(async (e) => await e.invoke('vault_is_unlocked'), [], { timeoutMs: 10000 });
    assert.equal(await app.invoke('vault_get', { key: 'e2e:credential' }), secret);
    const again = await ctx.restart();
    assert.equal(await again.invoke('vault_is_unlocked'), false);
    assert.match(await vaultGetError(again) ?? 'read the secret', /locked/i);
    await openVault(again);
    await fill(again, '#vault-manager-master-password-2', password);
    await clickButton(again, 'Unlock Credential Vault');
    await again.waitFor(async (e) => await e.invoke('vault_is_unlocked'), [], { timeoutMs: 10000 });
    assert.equal(await again.invoke('vault_get', { key: 'e2e:credential' }), secret);
  }],
];
