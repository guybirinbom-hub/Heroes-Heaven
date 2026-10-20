// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useState } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { NotesTab } from '../src/sheet/NotesTab';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { emptyPlay, type PlayState, type PlayUpdater } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * A NEW NOTES PAGE OPENS ON ITSELF (package H, 2026-10-20).
 *
 * A notes page's id is unique per mint now (src/rules/recordIds.ts — two tabs adding a page at once
 * used to give both pages one id and the merge mixed them). The Notes tab used to PREDICT the new page's
 * id (`nextNoteId(pages)` beside an add that minted its own) to open it; with a fresh id per mint the
 * prediction never matches, and the new page would not open. So the tab mints the id once and hands it
 * to `addNotePage`.
 * MUTATION (run 2026-10-20): drop the `id` argument from NotesTab's `addNotePage(p, icon, color, id)` —
 * this fails on `the new page is the one open: expected 'First page' to contain 'New page'`.
 * Synthetic character.
 */
const base = (): Character =>
  buildCharacter({ ...emptyBuild(), name: 'Notes', level: 1, classId: 'fighter', ancestryId: 'human', heritageId: 'skilled-human', backgroundId: 'acolyte', keyAbility: 'str' }, content());

function Harness() {
  const [play, setPlay] = useState<PlayState>({
    ...emptyPlay(),
    notes: [
      { id: 'note-0', title: 'First page', content: 'one', icon: 'ti-note' },
      { id: 'note-1', title: 'Second page', content: 'two', icon: 'ti-note' },
    ],
  });
  const onPlay: PlayUpdater = (fn) => setPlay((cur) => fn(cur));
  const character = { ...base(), id: 'notes-ui', notes: play.notes ?? [] } as Character;
  return <NotesTab character={character} onPlay={onPlay} />;
}

describe('a new notes page opens on itself', () => {
  beforeEach(() => localStorage.clear());

  it('New page → pick an icon: the page made is the page open', () => {
    const r = renderDom(<Harness />);
    const openRow = () => r.host.querySelector<HTMLElement>('.note-item.on')?.textContent ?? '';
    expect(openRow(), 'fixture: the first page is open').toContain('First page');
    r.click(r.host.querySelector('button.new-page-btn'));
    r.click(r.host.querySelector('.icon-picker .icon-opt'));
    expect(r.host.querySelectorAll('.note-item'), 'the page was added').toHaveLength(3);
    expect(openRow(), 'the new page is the one open').toContain('New page');
    r.stop();
  });
});
