import { describe, it, expect } from 'vitest';
import { readOutputStatus, looksLikeLogin, looksLive, reconnectsAfterEnd } from '../services/outputStatus';

const ssh = { ended: false, reachedLive: false, consoleTarget: false };

describe('readOutputStatus', () => {
  it('reads a login prompt before the login as preauth', () => {
    expect(readOutputStatus("ops@192.0.2.10's password: ", ssh)).toBe('preauth');
    expect(readOutputStatus('login as: ', ssh)).toBe('preauth');
    expect(readOutputStatus('Store key in cache? (y/n, Return cancels connection, i for more info) ', ssh)).toBe('preauth');
  });

  it('does not turn a live session amber on a Password: of its own', () => {
    // A router's `enable`, or Windows repainting plink's old login screen.
    expect(readOutputStatus('Router>enable\r\nPassword: ', { ...ssh, reachedLive: true })).toBeNull();
  });

  it("reads plink's Access granted, sshd's Last login and a shell prompt as live", () => {
    expect(readOutputStatus('Access granted. Press Return to begin session.', ssh)).toBe('live');
    expect(readOutputStatus('Last login: Thu Oct 23 10:00:00 2026 from 192.0.2.1', ssh)).toBe('live');
    expect(readOutputStatus('Router#', ssh)).toBe('live');
    expect(readOutputStatus('ops@host:~$ ', ssh)).toBe('live');
  });

  it('reads any output from a telnet or raw console as live, once', () => {
    const console_ = { ...ssh, consoleTarget: true };
    expect(readOutputStatus('\r\n', console_)).toBe('live');
    expect(readOutputStatus('', console_)).toBeNull();
    expect(readOutputStatus('some output', { ...console_, reachedLive: true })).toBeNull();
    expect(readOutputStatus('some output', ssh)).toBeNull();
  });

  it("reads Thyrion's closing notices as ended, and plink's FATAL ERROR before the login", () => {
    expect(readOutputStatus('\r\n[Thyrion: Session closed]\r\n', { ...ssh, reachedLive: true })).toBe('ended');
    expect(readOutputStatus('\r\n[Thyrion: Host key was rejected]\r\n', ssh)).toBe('ended');
    expect(readOutputStatus('FATAL ERROR: Remote side unexpectedly closed network connection', ssh)).toBe('ended');
    expect(readOutputStatus('FATAL ERROR: Network error', { ...ssh, ended: true })).toBe('ended');
  });

  it('leaves a live session alone when its own output says FATAL ERROR', () => {
    // A log on screen with that line in it marked the tab disconnected, and
    // auto-reconnect closed a healthy connection to open another.
    expect(readOutputStatus('ops@host:~$ grep FATAL plink.log\r\nFATAL ERROR: Network error: Connection timed out\r\n', { ...ssh, reachedLive: true }))
      .not.toBe('ended');
  });

  it('lets nothing an ended process printed change its status', () => {
    const ended = { ...ssh, ended: true, consoleTarget: true };
    expect(readOutputStatus('Router#', ended)).toBe('stillEnded');
    expect(readOutputStatus('Password: ', ended)).toBe('stillEnded');
  });

  it('takes a login prompt over a prompt-like ending before the login', () => {
    // "Password:" is not a shell prompt, but a banner can end in "#".
    expect(looksLikeLogin('Password: ')).toBe(true);
    expect(readOutputStatus('Banner #\r\nPassword: ', ssh)).toBe('preauth');
    expect(looksLive('nothing here')).toBe(false);
  });
});

describe('reconnecting by itself', () => {
  const dropped = { autoReconnect: true, networkProtocol: true, recent: 'FATAL ERROR: Network error: Software caused connection abort\r\n[Thyrion: Session closed]', reachedLive: true, attempts: 0 };

  it('after a drop from a live session', () => {
    expect(reconnectsAfterEnd(dropped)).toBe(true);
  });

  it('keeps trying through the retries, which fail before any login', () => {
    // Only the first retry happened: the next one waited for a login that
    // had worked.
    expect(reconnectsAfterEnd({ ...dropped, reachedLive: false, attempts: 1, recent: 'FATAL ERROR: Network error: Connection refused' })).toBe(true);
    expect(reconnectsAfterEnd({ ...dropped, reachedLive: false, attempts: 4, recent: 'FATAL ERROR: Network error: Connection refused' })).toBe(true);
  });

  it('not after a clean exit, a first login that failed, or with it off', () => {
    expect(reconnectsAfterEnd({ ...dropped, recent: 'logout\r\n[Thyrion: Session closed]' })).toBe(false);
    expect(reconnectsAfterEnd({ ...dropped, reachedLive: false, attempts: 0 })).toBe(false);
    expect(reconnectsAfterEnd({ ...dropped, autoReconnect: false })).toBe(false);
    expect(reconnectsAfterEnd({ ...dropped, networkProtocol: false })).toBe(false);
  });
});
