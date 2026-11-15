// @vitest-environment jsdom
/*
 * Deleting a mode asks first.
 *
 * bug 2026-10-23 (sheet fixes): the mode editor's Delete called `onDelete` at once — one tap and a mode
 * with all its modifiers was gone. It now asks with the app's own `confirmDialog` (never a native
 * confirm). The question lives in ModeEditor itself, so every host asks: the sheet's Modes panel, the
 * GM's edit sheet (the same panel) and Settings → Modes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { renderDom } from './_render';
import { ModeEditor } from '../src/sheet/ModesPanel';
import type { ModeDef } from '../src/rules/types';

const MODE: ModeDef = { id: 'mode-test-ward', name: 'Test Ward', modifiers: [{ value: 1, type: 'status', target: 'ac' }] };
const tick = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const dialogButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.confirm-modal button')].find((b) => (b.textContent ?? '').trim() === label);

afterEach(() => {
  for (const el of [...document.querySelectorAll('.confirm-overlay')]) el.parentElement?.remove();
});

const editor = (onDelete: () => void, extra: { deleteLabel?: string; deleteTitle?: string } = {}) =>
  renderDom(
    createElement(ModeEditor, { draft: MODE, catalog: [], onChange: () => undefined, onSave: () => undefined, onCancel: () => undefined, onDelete, ...extra }),
  );

describe('mode editor — Delete asks first', () => {
  it('a tap opens the app’s confirm and deletes nothing; Cancel keeps the mode', async () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const r = editor(onDelete);
    try {
      r.click(r.host.querySelector('.me-delete'));
      await tick();
      expect(onDelete).not.toHaveBeenCalled();
      expect(document.querySelector('.confirm-modal')?.textContent).toContain('Delete Test Ward?');
      expect(confirmSpy, 'never the native confirm').not.toHaveBeenCalled();
      await act(async () => void dialogButton('Cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await tick();
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      r.stop();
      confirmSpy.mockRestore();
    }
  });

  it('answering Delete deletes it', async () => {
    const onDelete = vi.fn();
    const r = editor(onDelete);
    try {
      r.click(r.host.querySelector('.me-delete'));
      await tick();
      await act(async () => void dialogButton('Delete')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await tick();
      expect(onDelete).toHaveBeenCalledTimes(1);
    } finally {
      r.stop();
    }
  });

  it('a "Remove from this character" button asks to remove, with its own explanation', async () => {
    const onDelete = vi.fn();
    const r = editor(onDelete, { deleteLabel: 'Remove from this character', deleteTitle: 'Removing it takes it off this character only.' });
    try {
      r.click(r.host.querySelector('.me-delete'));
      await tick();
      const text = document.querySelector('.confirm-modal')?.textContent ?? '';
      expect(text).toContain('Remove Test Ward from this character?');
      expect(text).toContain('Removing it takes it off this character only.');
      await act(async () => void dialogButton('Remove')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await tick();
      expect(onDelete).toHaveBeenCalledTimes(1);
    } finally {
      r.stop();
    }
  });
});
