import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SettingsModal } from '../components/modals/SettingsModal';
import { vaultDestroy, vaultIsInitialized, setLoggingSettings } from '../services/tauriBridge';
import { version } from '../../package.json';
import { getMiddleClickPaste } from '../services/middleClickPaste';

// Mock tauriBridge detectPutty
vi.mock('../services/tauriBridge', () => ({
  detectPutty: vi.fn().mockResolvedValue({
    found: true,
    path: '/usr/bin/plink',
    version: '0.85',
  }),
  vaultIsInitialized: vi.fn().mockResolvedValue(true),
  vaultDestroy: vi.fn().mockResolvedValue(true),
  getLoggingSettings: vi.fn().mockResolvedValue({ enabled: false, dir: '/home/ops/Documents/Thyrion Logs', default_dir: true, mode: 'printable' }),
  setLoggingSettings: vi.fn(async (enabled: boolean, dir: string | null, mode: string) => ({
    enabled, mode, dir: dir ?? '/home/ops/Documents/Thyrion Logs', default_dir: dir === null,
  })),
  pickLogFolder: vi.fn().mockResolvedValue('/srv/logs'),
}));

describe('SettingsModal Component', () => {
  it('does not render when isOpen is false', () => {
    const { container } = render(
      <SettingsModal
        isOpen={false}
        onClose={vi.fn()}
        fontFamily="monospace"
        onChangeFontFamily={vi.fn()}
        fontSize={13}
        onChangeFontSize={vi.fn()}
        cursorStyle="block"
        onChangeCursorStyle={vi.fn()}
        onResetLayout={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders and calls callbacks when options change', () => {
    const onChangeFont = vi.fn();
    const onChangeSize = vi.fn();
    const onChangeCursor = vi.fn();
    const onReset = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        fontFamily="monospace"
        onChangeFontFamily={onChangeFont}
        fontSize={13}
        onChangeFontSize={onChangeSize}
        cursorStyle="block"
        onChangeCursorStyle={onChangeCursor}
        onResetLayout={onReset}
      />
    );

    expect(screen.getByText('Global Settings')).toBeDefined();

    // Change cursor style to underline
    const underlineBtn = screen.getByRole('button', { name: /underline/i });
    fireEvent.click(underlineBtn);
    expect(onChangeCursor).toHaveBeenCalledWith('underline');

    // Click Reset Layout
    fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }));
    const resetBtn = screen.getByRole('button', { name: /reset layout/i });
    fireEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalled();
  });

  describe('Delete Vault', () => {
    const renderSettings = () => render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        fontFamily="monospace"
        onChangeFontFamily={vi.fn()}
        fontSize={13}
        onChangeFontSize={vi.fn()}
        cursorStyle="block"
        onChangeCursorStyle={vi.fn()}
        onResetLayout={vi.fn()}
      />
    );
    const destroy = vi.mocked(vaultDestroy);
    const openDelete = async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Vault' }));
      const btn = await screen.findByRole('button', { name: /^Delete Vault$/ });
      await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(btn);
    };

    it('deletes only after both warnings are accepted', async () => {
      destroy.mockClear();
      renderSettings();
      await openDelete();
      expect(screen.getByRole('alertdialog', { name: 'First warning' })).toBeTruthy();
      expect(destroy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Yes, continue' }));
      expect(screen.getByRole('alertdialog', { name: 'Final warning' })).toBeTruthy();
      expect(destroy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Delete vault permanently' }));
      expect(await screen.findByText('Vault deleted. Open Vault to create a new one.')).toBeTruthy();
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it('deletes nothing when either warning is cancelled', async () => {
      destroy.mockClear();
      renderSettings();
      await openDelete();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();

      await openDelete();
      fireEvent.click(screen.getByRole('button', { name: 'Yes, continue' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(destroy).not.toHaveBeenCalled();
    });

    it('offers nothing to delete when there is no vault', async () => {
      vi.mocked(vaultIsInitialized).mockResolvedValueOnce(false);
      renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Vault' }));
      const btn = await screen.findByRole('button', { name: /^Delete Vault$/ });
      await waitFor(() => expect(vi.mocked(vaultIsInitialized)).toHaveBeenCalled());
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('About names the app, its real version, and Alis', () => {
    // The app showed its version nowhere. Alis, the mascot, was the
    // owner's dog.
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        fontFamily="monospace"
        onChangeFontFamily={vi.fn()}
        fontSize={13}
        onChangeFontSize={vi.fn()}
        cursorStyle="block"
        onChangeCursorStyle={vi.fn()}
        onResetLayout={vi.fn()}
      />
    );
    const about = document.querySelector('[data-about]') as HTMLElement;
    expect(about.textContent).toContain('Thyrion');
    expect(about.textContent).toContain(`v${version}`);
    expect(about.textContent).toContain('Alis');
  });

  describe('Logging', () => {
    const renderSettings = () => render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        fontFamily="monospace"
        onChangeFontFamily={vi.fn()}
        fontSize={13}
        onChangeFontSize={vi.fn()}
        cursorStyle="block"
        onChangeCursorStyle={vi.fn()}
        onResetLayout={vi.fn()}
      />
    );

    it('shows the folder logs go to and how they are filed', async () => {
      renderSettings();
      expect(await screen.findByText('/home/ops/Documents/Thyrion Logs')).toBeInTheDocument();
      expect(screen.getByText(/<folder>\/<session>\/2026-10-14_16-05-33\.log/)).toBeInTheDocument();
    });

    it('turns automatic logging on, keeping the default folder and the format', async () => {
      renderSettings();
      fireEvent.click(await screen.findByLabelText('Log every session automatically'));
      await waitFor(() => expect(setLoggingSettings).toHaveBeenCalledWith(true, null, 'printable'));
    });

    it('a chosen folder is saved, and Default puts it back', async () => {
      renderSettings();
      fireEvent.click(await screen.findByText('Choose…'));
      await waitFor(() => expect(setLoggingSettings).toHaveBeenCalledWith(false, '/srv/logs', 'printable'));
      fireEvent.click(await screen.findByText('Default'));
      await waitFor(() => expect(setLoggingSettings).toHaveBeenLastCalledWith(false, null, 'printable'));
    });
  });

  describe('Tabs', () => {
    // One long page hid its options: the owner looked for middle-click
    // paste and copy on select and couldn't find them.
    const renderSettings = () => render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        fontFamily="monospace"
        onChangeFontFamily={vi.fn()}
        fontSize={13}
        onChangeFontSize={vi.fn()}
        cursorStyle="block"
        onChangeCursorStyle={vi.fn()}
        onResetLayout={vi.fn()}
      />
    );

    it('lists the categories down the side, Terminal first', () => {
      renderSettings();
      const tabs = screen.getAllByRole('tab').map(t => t.textContent);
      expect(tabs).toEqual(['Terminal', 'Mouse & Clipboard', 'Appearance', 'Logging', 'Vault', 'Advanced', 'About']);
      expect(screen.getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
      expect(screen.getByRole('tab', { name: 'Terminal' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'settings-tab-terminal');
      expect(screen.getByLabelText('Scrollback')).toBeVisible();
    });

    it('shows one tab at a time, keeping every option in the page', () => {
      renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Mouse & Clipboard' }));
      expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'settings-panel-mouse');
      expect(document.getElementById('settings-copy-on-select')).toBeVisible();
      expect(document.getElementById('settings-middle-click-paste')).toBeVisible();
      expect(screen.getByRole('button', { name: /Paste Clipboard \(PuTTY\)/ })).toBeVisible();
      expect(screen.getByRole('button', { name: /Multi-line pastes/ })).toBeVisible();
      // The other tabs' options are still there (e2e finds them by id), only hidden.
      expect(document.getElementById('settings-scrollback')).not.toBeVisible();
      expect(document.getElementById('settings-terminal-scheme')).not.toBeVisible();
      fireEvent.click(screen.getByRole('tab', { name: 'Appearance' }));
      expect(document.getElementById('settings-terminal-scheme')).toBeVisible();
      expect(screen.getByRole('radiogroup', { name: 'Interface theme' })).toBeVisible();
    });

    it('moves between tabs with the arrow keys, Home and End', () => {
      renderSettings();
      const tab = (name: string) => screen.getByRole('tab', { name });
      tab('Terminal').focus();
      fireEvent.keyDown(tab('Terminal'), { key: 'ArrowDown' });
      expect(tab('Mouse & Clipboard')).toHaveAttribute('aria-selected', 'true');
      expect(tab('Mouse & Clipboard')).toHaveFocus();
      expect(tab('Mouse & Clipboard')).toHaveAttribute('tabindex', '0');
      expect(tab('Terminal')).toHaveAttribute('tabindex', '-1');
      fireEvent.keyDown(tab('Mouse & Clipboard'), { key: 'ArrowUp' });
      expect(tab('Terminal')).toHaveFocus();
      fireEvent.keyDown(tab('Terminal'), { key: 'ArrowUp' });
      expect(tab('About')).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(tab('About'), { key: 'ArrowDown' });
      expect(tab('Terminal')).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(tab('Terminal'), { key: 'End' });
      expect(tab('About')).toHaveFocus();
      fireEvent.keyDown(tab('About'), { key: 'Home' });
      expect(tab('Terminal')).toHaveFocus();
    });

    it('middle-click paste is on by default, and turning it off is remembered', () => {
      localStorage.removeItem('plinky_middle_click_paste');
      const { unmount } = renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Mouse & Clipboard' }));
      const box = screen.getByLabelText(/Middle-click pastes/) as HTMLInputElement;
      expect(box.checked).toBe(true);
      expect(box.closest('label')!.textContent).toMatch(/pastes the clipboard/);
      fireEvent.click(box);
      expect(box.checked).toBe(false);
      expect(localStorage.getItem('plinky_middle_click_paste')).toBe('false');
      expect(getMiddleClickPaste()).toBe(false);
      unmount();
      renderSettings();
      fireEvent.click(screen.getByRole('tab', { name: 'Mouse & Clipboard' }));
      expect((screen.getByLabelText(/Middle-click pastes/) as HTMLInputElement).checked).toBe(false);
      localStorage.removeItem('plinky_middle_click_paste');
    });
  });
});
