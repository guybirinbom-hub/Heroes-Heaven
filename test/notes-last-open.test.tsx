// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { NotesTab } from '../src/sheet/NotesTab';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/** Owner (2026-09-02): "when I open notes open them on the last note that was open." */
const withNotes = (id: string): Character => ({
  ...buildCharacter({ ...emptyBuild(), name: 'Notes', level: 1, classId: 'fighter', ancestryId: 'human', heritageId: 'skilled-human', backgroundId: 'acolyte', keyAbility: 'str' }, content()),
  id,
  notes: [
    { id: 'note-0', title: 'First page', content: 'one', icon: 'ti-note' },
    { id: 'note-1', title: 'Second page', content: 'two', icon: 'ti-note' },
    { id: 'note-2', title: 'Third page', content: 'three', icon: 'ti-note' },
  ] as Character['notes'],
});

describe('Notes reopen on the last page that was open', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the page per character across a remount, and falls back when that page is gone', () => {
    const openRow = (host: HTMLElement) => host.querySelector<HTMLElement>('.note-item.on')?.textContent ?? '';
    const ch = withNotes('char-a');
    const r1 = renderDom(<NotesTab character={ch} />);
    expect(openRow(r1.host)).toContain('First page');
    const third = [...r1.host.querySelectorAll<HTMLElement>('.note-item')].find((el) => /Third page/.test(el.textContent ?? ''));
    expect(third, 'a row for the third page').toBeTruthy();
    r1.click(third!);
    expect(openRow(r1.host)).toContain('Third page');
    r1.stop();

    // Reopening the tab: the third page is the one open.
    const r2 = renderDom(<NotesTab character={ch} />);
    expect(openRow(r2.host)).toContain('Third page');
    r2.stop();

    // Another character is remembered separately (nothing yet → its first page).
    const r3 = renderDom(<NotesTab character={withNotes('char-b')} />);
    expect(openRow(r3.host)).toContain('First page');
    r3.stop();

    // The remembered page was deleted → the first page, not a blank editor.
    const fewer = { ...ch, notes: ch.notes.slice(0, 2) } as Character;
    const r4 = renderDom(<NotesTab character={fewer} />);
    expect(openRow(r4.host)).toContain('First page');
    r4.stop();
  });
});
