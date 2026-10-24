import { describe, it, expect } from 'vitest';
import { LOGON_PRESETS, withPreset } from '../services/logonPresets';

describe('logon-action presets', () => {
  it('add the platform\'s commands, each waiting for any prompt', () => {
    expect(withPreset([], 'cisco-ios')).toEqual([
      { wait: '', send: 'terminal length 0' },
      { wait: '', send: 'terminal width 511' },
    ]);
  });

  it('keep what the session has, and add nothing twice', () => {
    const mine = [{ wait: '#', send: 'terminal length 0' }, { wait: '#', send: 'show clock' }];
    expect(withPreset(mine, 'cisco-ios')).toEqual([...mine, { wait: '', send: 'terminal width 511' }]);
  });

  it('a row left empty makes way, and an unknown platform changes nothing', () => {
    expect(withPreset([{ wait: '#', send: '' }], 'huawei-vrp')).toEqual([{ wait: '', send: 'screen-length 0 temporary' }]);
    const mine = [{ wait: '#', send: 'show clock' }];
    expect(withPreset(mine, 'nope')).toBe(mine);
  });

  it('no preset changes a device\'s configuration', () => {
    for (const p of LOGON_PRESETS) {
      expect(p.commands.length).toBeGreaterThan(0);
      for (const c of p.commands) expect(c).not.toMatch(/^(conf(igure)?|config|system-view|edit|commit|write|copy)\b/i);
    }
  });
});
