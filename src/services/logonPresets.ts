// Logon actions to start from, per platform: what a device needs once the
// login is over so long output isn't stopped by --More-- and long lines
// aren't wrapped. The commands are the ones Netmiko sends to prepare each
// platform, and only those that last for the session and change nothing in
// the device's configuration. FortiOS is left out: turning its pager off
// changes its configuration.
import type { LogonAction } from './tabColors';

export interface LogonPreset {
  id: string;
  label: string;
  /** Sent in order, each once the prompt is back. */
  commands: string[];
}

export const LOGON_PRESETS: LogonPreset[] = [
  { id: 'cisco-ios', label: 'Cisco IOS / IOS-XE', commands: ['terminal length 0', 'terminal width 511'] },
  { id: 'cisco-nxos', label: 'Cisco NX-OS', commands: ['terminal length 0', 'terminal width 511'] },
  { id: 'cisco-xr', label: 'Cisco IOS-XR', commands: ['terminal length 0', 'terminal width 511'] },
  { id: 'cisco-asa', label: 'Cisco ASA', commands: ['terminal pager 0'] },
  { id: 'juniper-junos', label: 'Juniper Junos', commands: ['set cli screen-length 0', 'set cli screen-width 511'] },
  { id: 'arista-eos', label: 'Arista EOS', commands: ['terminal length 0', 'terminal width 32767'] },
  { id: 'aruba-aoss', label: 'HPE Aruba AOS-S / ProCurve', commands: ['no page'] },
  { id: 'aruba-aoscx', label: 'Aruba AOS-CX', commands: ['no page'] },
  { id: 'hpe-comware', label: 'HPE Comware / H3C', commands: ['screen-length disable'] },
  { id: 'huawei-vrp', label: 'Huawei VRP', commands: ['screen-length 0 temporary'] },
  { id: 'paloalto-panos', label: 'Palo Alto PAN-OS', commands: ['set cli pager off'] },
  { id: 'dell-os10', label: 'Dell OS10', commands: ['terminal length 0'] },
  { id: 'extreme-exos', label: 'Extreme EXOS', commands: ['disable clipaging'] },
];

/**
 * The session's logon actions with a preset's added after them: each
 * command waits for any prompt (an empty "wait for"). A command the session
 * already sends is not added twice.
 */
export function withPreset(actions: LogonAction[], presetId: string): LogonAction[] {
  const preset = LOGON_PRESETS.find(p => p.id === presetId);
  if (!preset) return actions;
  const sent = new Set(actions.map(a => a.send.trim()));
  // Rows left empty ("Add a logon action" not filled in) make way.
  const kept = actions.filter(a => a.send.trim());
  return [...kept, ...preset.commands.filter(c => !sent.has(c)).map(send => ({ wait: '', send }))];
}
