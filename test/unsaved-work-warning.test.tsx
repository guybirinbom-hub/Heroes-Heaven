// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { ItemEditorModal } from '../src/sheet/ItemEditorModal';
import { ModeEditor } from '../src/sheet/ModesPanel';
import type { ModeDef } from '../src/rules/types';
import { DraftNumberInput } from '../src/builder/DraftNumberInput';
import { DraftText } from '../src/builder/tweaks/parts';
import { confirmDialog } from '../src/sheet/confirm';
import { TextConverter } from '../tracker/src/components/TextConverter';
import {
  _resetUnsavedWorkForTests,
  guardReloadKey,
  guardWindowClose,
  hasUnsavedWork,
  installUnsavedWarning,
  isReloadKey,
  registerUnsavedWork,
} from '../src/data/unsavedWork';

/**
 * LEAVING THE WEB VERSION WITH UNSAVED WORK (Guy, 2026-11-08: "existing the web virsion while doing
 * somthing that wont be saved ( like creating a character) should have a warning to the user before
 * they leav").
 *
 * Measured before the fix: a new character lives only in the builder's draft until Save; closing the
 * tab or reloading threw it away with no question, because the only `beforeunload` listener (App's
 * write flush) never prevents the unload. Now one shared listener (src/data/unsavedWork.ts) asks every
 * open screen's check and prevents the unload — the browser's own "Leave site?" — only when one says yes.
 *
 * Every "warns" case asserts the unload was PREVENTED, so it fails if preventDefault goes; every
 * "no warning" case fails if the listener prevents always. Measured 2026-11-08: the builder cases
 * failed (3 of 13) while the builder had no check registered, and pass with it.
 */

let uninstall: (() => void) | null = null;
const cleanups: (() => void)[] = [];

beforeEach(() => {
  _resetUnsavedWorkForTests();
  uninstall = installUnsavedWarning(window);
});
afterEach(() => {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* already unmounted */
    }
  }
  uninstall?.();
  uninstall = null;
  _resetUnsavedWorkForTests();
  for (const n of [...document.body.children]) n.remove();
});

/** What the browser does on close/reload: fire a cancelable beforeunload; prevented = it asks first. */
function leaveIsWarned(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** React-friendly typing: the value setter, then the input event the onChange listens to. */
function typeInto(input: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: v.slice(-1), bubbles: true }));
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the shared unsaved-work signal', () => {
  it('nothing open → no warning', () => {
    expect(hasUnsavedWork()).toBe(false);
    expect(leaveIsWarned()).toBe(false);
  });

  it('a screen whose check says "nothing unsaved" → no warning', () => {
    registerUnsavedWork(() => false);
    expect(leaveIsWarned()).toBe(false);
  });

  it('a screen with unsaved work → the leave is prevented (the browser asks), returnValue set', () => {
    registerUnsavedWork(() => true);
    const e = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('the check is asked at leave time, and a closed screen stops counting', () => {
    let unsaved = false;
    const off = registerUnsavedWork(() => unsaved);
    expect(leaveIsWarned()).toBe(false);
    unsaved = true;
    expect(leaveIsWarned()).toBe(true);
    off();
    expect(leaveIsWarned()).toBe(false);
  });

  it('a check that throws counts as unsaved (asking once too often beats losing a character)', () => {
    registerUnsavedWork(() => {
      throw new Error('boom');
    });
    expect(leaveIsWarned()).toBe(true);
  });

  it('App installs the warning on the web only, beside the write flush (never in place of it)', () => {
    const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/useEffect\(\(\) => \(isTauri \? undefined : installUnsavedWarning\(\)\), \[\]\);/);
    expect(app).toContain("window.addEventListener('beforeunload', flush);");
    expect(app).toContain("window.addEventListener('pagehide', flush);");
  });
});

describe('the Windows app close (X button, Alt+F4): guardWindowClose', () => {
  function fakes(answer: boolean | Promise<boolean>) {
    const log: string[] = [];
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    const deps = {
      ask: () => {
        log.push('ask');
        return Promise.resolve(answer);
      },
      beforeClose: () => void log.push('flush'),
      close: async () => void log.push('close'),
    };
    return { log, event, deps };
  }

  it('nothing unsaved → not held, no question, writes flushed (Tauri then closes as before)', async () => {
    const { log, event, deps } = fakes(true);
    await guardWindowClose(event, deps);
    expect(event.prevented).toBe(false);
    expect(log).toEqual(['flush']);
  });

  it('unsaved, "Keep editing" → held, the window stays, nothing flushed or closed', async () => {
    registerUnsavedWork(() => true);
    const { log, event, deps } = fakes(false);
    await guardWindowClose(event, deps);
    expect(event.prevented).toBe(true);
    expect(log).toEqual(['ask']);
  });

  it('unsaved, "Close anyway" → held, then flushed and closed for good', async () => {
    registerUnsavedWork(() => true);
    const { log, event, deps } = fakes(true);
    await guardWindowClose(event, deps);
    expect(event.prevented).toBe(true);
    expect(log).toEqual(['ask', 'flush', 'close']);
  });

  it('a second close while the question is open is held and asks nothing more', async () => {
    registerUnsavedWork(() => true);
    let answer!: (v: boolean) => void;
    const first = fakes(new Promise<boolean>((r) => (answer = r)));
    const pending = guardWindowClose(first.event, first.deps);
    const second = fakes(true);
    await guardWindowClose(second.event, second.deps);
    expect(second.event.prevented).toBe(true);
    expect(second.log).toEqual([]);
    answer(false);
    await pending;
    expect(first.log).toEqual(['ask']);
  });

  it('App hands the desktop close request to it, and the window may be destroyed', () => {
    const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('win.onCloseRequested((event) =>');
    expect(app).toContain('guardWindowClose(event, {');
    const caps = readFileSync(join(__dirname, '..', 'src-tauri', 'capabilities', 'default.json'), 'utf8');
    // onCloseRequested closes through destroy(); without this permission the X button would do nothing.
    expect(caps).toContain('"core:window:allow-destroy"');
  });
});

describe('the Windows app reload keys (F5, Ctrl+R): guardReloadKey', () => {
  // Guy 2026-11-08: "i want it to ask : F5 in the Windows app reloads with no question".
  function press(init: KeyboardEventInit) {
    return new KeyboardEvent('keydown', { cancelable: true, ...init });
  }
  function fakes(answer: boolean | Promise<boolean>) {
    const log: string[] = [];
    const deps = {
      ask: () => {
        log.push('ask');
        return Promise.resolve(answer);
      },
      beforeReload: () => void log.push('flush'),
      reload: () => void log.push('reload'),
    };
    return { log, deps };
  }

  it('F5, Shift+F5, Ctrl+F5, Ctrl+R and Ctrl+Shift+R are reload keys; R alone, Ctrl+T and Alt+F5 are not', () => {
    expect(isReloadKey(press({ key: 'F5' }))).toBe(true);
    expect(isReloadKey(press({ key: 'F5', shiftKey: true }))).toBe(true);
    expect(isReloadKey(press({ key: 'F5', ctrlKey: true }))).toBe(true);
    expect(isReloadKey(press({ key: 'r', ctrlKey: true }))).toBe(true);
    expect(isReloadKey(press({ key: 'R', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isReloadKey(press({ key: 'r' }))).toBe(false);
    expect(isReloadKey(press({ key: 't', ctrlKey: true }))).toBe(false);
    expect(isReloadKey(press({ key: 'F5', altKey: true }))).toBe(false);
  });

  it('nothing unsaved → the key is left alone (the page reloads as before), no question', async () => {
    const e = press({ key: 'F5' });
    const { log, deps } = fakes(true);
    await guardReloadKey(e, deps);
    expect(e.defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('unsaved, "Keep editing" → the reload is held, nothing flushed or reloaded', async () => {
    registerUnsavedWork(() => true);
    const e = press({ key: 'F5' });
    const { log, deps } = fakes(false);
    await guardReloadKey(e, deps);
    expect(e.defaultPrevented).toBe(true);
    expect(log).toEqual(['ask']);
  });

  it('unsaved, "Reload anyway" → flushed, then reloaded', async () => {
    registerUnsavedWork(() => true);
    const e = press({ key: 'r', ctrlKey: true });
    const { log, deps } = fakes(true);
    await guardReloadKey(e, deps);
    expect(e.defaultPrevented).toBe(true);
    expect(log).toEqual(['ask', 'flush', 'reload']);
  });

  it('a second F5 while the question is open is held and asks nothing more; other keys pass', async () => {
    registerUnsavedWork(() => true);
    let answer!: (v: boolean) => void;
    const first = fakes(new Promise<boolean>((r) => (answer = r)));
    const pending = guardReloadKey(press({ key: 'F5' }), first.deps);
    const again = press({ key: 'F5' });
    const second = fakes(true);
    await guardReloadKey(again, second.deps);
    expect(again.defaultPrevented).toBe(true);
    expect(second.log).toEqual([]);
    const typing = press({ key: 'a' });
    await guardReloadKey(typing, second.deps);
    expect(typing.defaultPrevented).toBe(false);
    answer(false);
    await pending;
    expect(first.log).toEqual(['ask']);
  });

  it('App hands every key press to it, in the desktop app, before any screen sees it', () => {
    const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('void guardReloadKey(e, {');
    expect(app).toContain("window.addEventListener('keydown', onKey, true);");
  });
});

describe('checker findings 2026-11-08', () => {
  function typeText(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('1a. a Tweaks number box still being typed in counts as unsaved; leaving the box saves it', () => {
    let saved: number | null = 3;
    const r = renderDom(
      createElement(DraftNumberInput, { value: saved, onCommit: (n: number) => (saved = n), onClear: () => (saved = null), 'aria-label': 'Test number' }),
    );
    cleanups.push(r.stop);
    const box = r.host.querySelector('input') as HTMLInputElement;
    expect(leaveIsWarned()).toBe(false);
    typeText(box, '3'); // the same as saved: nothing to lose
    expect(leaveIsWarned()).toBe(false);
    typeText(box, '8');
    expect(leaveIsWarned()).toBe(true);
    act(() => box.dispatchEvent(new FocusEvent('blur')));
    act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(saved).toBe(8);
    expect(leaveIsWarned()).toBe(false);
  });

  it('1b. a Tweaks text box still being typed in counts as unsaved; leaving the box saves it', () => {
    let saved = 'Old reason';
    const r = renderDom(createElement(DraftText, { value: saved, onCommit: (t: string) => (saved = t), ariaLabel: 'Reason' }));
    cleanups.push(r.stop);
    const box = r.host.querySelector('input') as HTMLInputElement;
    expect(leaveIsWarned()).toBe(false);
    typeText(box, 'New reason');
    expect(leaveIsWarned()).toBe(true);
    act(() => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(saved).toBe('New reason');
    expect(leaveIsWarned()).toBe(false);
  });

  it('2. focusCancel puts the focus on "Keep editing", so a stray Enter/Space keeps the work', async () => {
    let p!: Promise<boolean>;
    await act(async () => {
      p = confirmDialog({ title: 'Close without saving?', confirmLabel: 'Close anyway', cancelLabel: 'Keep editing', danger: true, focusCancel: true });
    });
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Keep editing');
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(await p).toBe(false);
    // Without it the confirm button keeps the focus, as every other question in the app does.
    let q!: Promise<boolean>;
    await act(async () => {
      q = confirmDialog({ title: 'Delete page?', confirmLabel: 'Delete', cancelLabel: 'Cancel' });
    });
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Delete');
    await act(async () => (document.activeElement as HTMLElement).click());
    expect(await q).toBe(true);
  });

  it('3. every leave question (close, reload, install the update) focuses "Keep editing" and sits above the campaign tracker\'s layers', () => {
    const src = (...p: string[]) => readFileSync(join(__dirname, '..', 'src', ...p), 'utf8');
    // One shared definition (src/sheet/confirm.tsx since 2026-11-08), spread by every question that can
    // throw away unsaved work as the app closes.
    expect(src('sheet', 'confirm.tsx')).toContain('export const LEAVE_QUESTION = { focusCancel: true, style: { zIndex: 40000 } } as const;');
    expect(src('App.tsx').match(/\.\.\.LEAVE_QUESTION,/g)?.length).toBe(2);
    expect(src('sheet', 'UpdateNotice.tsx').match(/\.\.\.LEAVE_QUESTION,/g)?.length).toBe(1);
    // The highest tracker layer the checker found: the floating hover card at 30000.
    const fw = readFileSync(join(__dirname, '..', 'tracker', 'src', 'components', 'FloatingWindow.tsx'), 'utf8');
    const zs = [...fw.matchAll(/zIndex: (\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...zs)).toBeLessThan(40000);
  });

  it('4. the tracker\'s custom creature panel: opened → no warning; a stat block typed → warns; closed → no warning', () => {
    const r = renderDom(createElement(TextConverter, { onClose: () => undefined }));
    cleanups.push(r.stop);
    expect(leaveIsWarned()).toBe(false);
    const box = document.querySelector('textarea.themed-placeholder') as HTMLTextAreaElement;
    typeText(box, 'Test Goblin Creature 1');
    expect(leaveIsWarned()).toBe(true);
    r.stop();
    expect(leaveIsWarned()).toBe(false);
  });
});

describe('the builder', () => {
  function open(initial?: BuildState) {
    const r = renderDom(
      createElement(Builder, { content: content(), initial, onCancel: () => undefined, onCreate: () => undefined }),
    );
    cleanups.push(r.stop);
    const nameInput = () => r.host.querySelector('.builder-head input.name-input') as HTMLInputElement;
    return { r, nameInput };
  }

  it('a new character, nothing chosen yet → no warning', () => {
    open();
    expect(leaveIsWarned()).toBe(false);
  });

  it('a new character with a pick (a name typed) → the leave warns', () => {
    const { nameInput } = open();
    typeInto(nameInput(), 'Test Hero');
    expect(leaveIsWarned()).toBe(true);
  });

  it('the builder closed (Save or Cancel took the player away) → no warning', () => {
    const { r, nameInput } = open();
    typeInto(nameInput(), 'Test Hero');
    expect(leaveIsWarned()).toBe(true);
    r.stop();
    expect(leaveIsWarned()).toBe(false);
  });

  it('an existing character opened and left untouched → no warning; edited → warns', () => {
    const saved: BuildState = JSON.parse(
      JSON.stringify({ ...emptyBuild(), name: 'Saved Hero', level: 3, ancestryId: 'human', classId: 'fighter' }),
    );
    const { nameInput } = open(saved);
    expect(leaveIsWarned()).toBe(false);
    typeInto(nameInput(), 'Saved Hero II');
    expect(leaveIsWarned()).toBe(true);
  });
});

describe('the other editors with their own Save', () => {
  it('the item editor: opened → no warning; a name typed → warns; closed → no warning', () => {
    const r = renderDom(
      createElement(ItemEditorModal, { mode: 'create', content: content(), onSave: () => undefined, onClose: () => undefined }),
    );
    cleanups.push(r.stop);
    expect(leaveIsWarned()).toBe(false);
    const input = r.host.querySelector('input[placeholder="e.g. Stormcaller blade"]') as HTMLInputElement;
    typeInto(input, 'Test blade');
    expect(leaveIsWarned()).toBe(true);
    r.stop();
    expect(leaveIsWarned()).toBe(false);
  });

  it('the mode editor: opened → no warning; a name typed → warns', () => {
    const start: ModeDef = { id: 'test-mode', name: '', modifiers: [] } as ModeDef;
    function Host() {
      const [draft, setDraft] = useState(start);
      return createElement(ModeEditor, {
        draft,
        catalog: [],
        onChange: setDraft,
        onSave: () => undefined,
        onCancel: () => undefined,
      });
    }
    const r = renderDom(createElement(Host));
    cleanups.push(r.stop);
    expect(leaveIsWarned()).toBe(false);
    const input = r.host.querySelector('input[placeholder="e.g. Inspired"]') as HTMLInputElement;
    typeInto(input, 'Raging');
    expect(leaveIsWarned()).toBe(true);
  });

  it('the GM edit sheet, the homebrew editor and the note editor each register their check', () => {
    // These three need a campaign, a schema or a rich-text page to render; the guard here is that the
    // hook-in stays: each file must ask useUnsavedWork with its own unsaved state.
    const src = (p: string) => readFileSync(join(__dirname, '..', 'src', 'sheet', p), 'utf8');
    expect(src('GmEditSheet.tsx')).toContain('useUnsavedWork(() => dirty);');
    expect(src('HomebrewPage.tsx')).toContain('useUnsavedWork(() => JSON.stringify(form) !== opened.current);');
    expect(src('NotesTab.tsx')).toContain('useUnsavedWork(() => savePending.current);');
  });
});
