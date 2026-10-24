import { describe, it, expect } from 'vitest';
import { copiedText } from '../services/clipboard';

describe('copiedText', () => {
  it('drops the spaces at the end of each line, as PuTTY copies', () => {
    // From a C891F's show running-config: IOS ends some lines in a space.
    expect(copiedText('ip dhcp pool LOCAL\n network 10.10.10.0 255.255.255.0\n default-router 10.10.10.1 \n lease 2'))
      .toBe('ip dhcp pool LOCAL\n network 10.10.10.0 255.255.255.0\n default-router 10.10.10.1\n lease 2');
  });

  it('a line copied off the screen pastes back without a trailing space', () => {
    expect(copiedText('username testing privilege 15 password testing   ')).toBe('username testing privilege 15 password testing');
  });

  it('keeps CR LF line ends, blank lines and spaces inside or at the start of a line', () => {
    expect(copiedText('  interface Gi0/1 \r\n   \r\n description  uplink\r\n')).toBe('  interface Gi0/1\r\n\r\n description  uplink\r\n');
  });
});
