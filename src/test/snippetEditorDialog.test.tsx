import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSnippetBar } from '../components/snippets/QuickSnippetBar';

describe('the snippet editor', () => {
  it('is a modal dialog, and Escape closes it', () => {
    // It was neither: Escape did nothing, and Ctrl+Tab switched the tab
    // behind it while a name was typed (the app's shortcuts pause only for
    // a dialog marked modal).
    render(<QuickSnippetBar onExecuteSnippet={() => {}} />);
    fireEvent.click(screen.getByTitle('Create Custom Snippet'));
    const dialog = screen.getByRole('dialog', { name: 'Create Quick Snippet' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Create Quick Snippet' })).toBeNull();
  });
});
