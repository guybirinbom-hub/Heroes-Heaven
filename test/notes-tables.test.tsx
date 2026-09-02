// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { NotesTab } from '../src/sheet/NotesTab';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/**
 * Owner: "tables don't work in the notes". There was no way to make one (no toolbar button, no
 * markdown), and a note that was only a table never reached the rich-HTML renderer, so its tags were
 * stripped and the cells came out as loose text.
 */
const withNote = (html: string): Character => ({
  ...buildCharacter(
    { ...emptyBuild(), name: 'Notes', level: 1, classId: 'fighter', ancestryId: 'human', heritageId: 'skilled-human', backgroundId: 'acolyte', keyAbility: 'str' },
    content(),
  ),
  id: 'char-tables',
  notes: [{ id: 'note-0', title: 'Table page', content: html, icon: 'ti-note' }] as Character['notes'],
});

describe('Notes tables', () => {
  it('the Insert table button puts a real table in the editor', () => {
    const { host, stop } = renderDom(<NotesTab character={withNote('')} onPlay={() => undefined} />);
    const btn = [...host.querySelectorAll('button')].find((b) => b.title === 'Insert table');
    expect(btn, 'an Insert table toolbar button').toBeTruthy();
    // The toolbar acts on mousedown (so the editor keeps its selection), not click.
    act(() => btn!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })));

    const table = host.querySelector('.editor-body table');
    expect(table, 'a table inside the editor body').toBeTruthy();
    expect(table!.querySelectorAll('thead th').length).toBe(3);
    expect(table!.querySelectorAll('tbody tr').length).toBe(2);
    expect(table!.querySelectorAll('tbody td').length).toBe(6);
    // Cells must not be empty, or the caret can't be placed in them (a non-breaking space, which
    // String.trim() would eat — so compare the raw text).
    expect(table!.querySelector('tbody td')!.textContent).toBe(' ');
    stop();
  });

  it('renders a saved table — editable and read-only', () => {
    const saved = '<table><thead><tr><th>Loot</th><th>Owner</th></tr></thead><tbody><tr><td>Sword</td><td>Kyra</td></tr></tbody></table>';

    // Editable: the contentEditable is filled from the stored HTML through sanitize().
    const edit = renderDom(<NotesTab character={withNote(saved)} onPlay={() => undefined} />);
    expect(edit.host.querySelector('.editor-body table'), 'table in the editor').toBeTruthy();
    expect(edit.host.querySelectorAll('.editor-body td').length).toBe(2);
    edit.stop();

    // Read-only (teammate/GM view): same content through DescBody.
    const ro = renderDom(<NotesTab character={withNote(saved)} />);
    expect(ro.host.querySelector('.editor-body table'), 'table in the read-only note').toBeTruthy();
    expect(ro.host.querySelector('.editor-body th')!.textContent).toBe('Loot');
    ro.stop();
  });
});
