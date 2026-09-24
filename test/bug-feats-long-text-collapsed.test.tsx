// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { FeatsTab, LONG_NOTE_CHARS } from '../src/sheet/FeatsTab';
import type { Character } from '../src/rules/types';

/**
 * The block at the TOP of Feats & Features prints the class archetype's rules note in full, and
 * Flexible Spellcaster's renders 1,168 characters — twenty-odd lines at phone width, above the search
 * box, before the player has seen one feat. Long notes are now cut to three lines with a Show more /
 * Show less of their own; short ones are untouched.
 *
 * Every length here is measured on the string the tab RECEIVES — `build.ts` pushes
 * `` `${feat name}: ${ca.note}` ``, so the name is part of what is measured and of what is displayed.
 *
 * Every case runs on a BUILT character, because `classArchetype.notes` only exists once the build has
 * resolved the dedication onto one.
 */
const c = () => content();
const noop = () => undefined;

/** A wizard with Flexible Spellcaster — the longest note the app ships (1,168 rendered characters). */
const flexible = () => build('wizard', 2, { featPicks: { '2:class:0': 'flexible-spellcaster-dedication' } }) as Character;
/** A cleric with Battle Harbinger — the shortest (93 rendered), well under the threshold. */
const harbinger = () => build('cleric', 2, { featPicks: { '2:class:0': 'battle-harbinger-dedication' } }) as Character;
/** Two long notes on one character, so "one at a time" is a real question. */
const twoLong = () =>
  build('wizard', 4, {
    featPicks: { '2:class:0': 'flexible-spellcaster-dedication', '4:class:0': 'runelord-dedication' },
  }) as Character;

const openTab = (ch: Character) => renderDom(<FeatsTab character={ch} content={c()} onPlay={noop} />);

describe('a long class-archetype note at the top of Feats & Features', () => {
  it('renders CLOSED, with a Show more control', () => {
    const ch = flexible();
    // The fixture is the defect's own shape or this proves nothing.
    expect(ch.classArchetype?.notes.join('')).toContain('Flexible Spellcaster');
    // The note reaches the tab with its feat's NAME in front of it, which is part of the length.
    expect(ch.classArchetype!.notes[0].startsWith('Flexible Spellcaster Dedication: ')).toBe(true);
    expect(ch.classArchetype!.notes[0].length).toBeGreaterThan(LONG_NOTE_CHARS);

    const { host, stop } = openTab(ch);
    const note = host.querySelector('.ff-arch .ff-note');
    const more = host.querySelector<HTMLButtonElement>('.ff-arch .ff-note-more');
    // MUTATION LINE: default the ArchNote `open` state to true and these three go red.
    expect(note?.className).toContain('cut');
    expect(more?.textContent).toBe('Show more');
    expect(more?.getAttribute('aria-expanded')).toBe('false');
    // Cut, not truncated: the whole note is still in the DOM, so nothing the player needs was dropped
    // and find-in-page still reaches the tail.
    expect(note?.textContent).toContain('do not count toward the collection');
    stop();
  });

  it('expands when the control is clicked, and closes again', () => {
    const { host, click, stop } = openTab(flexible());
    const more = () => host.querySelector<HTMLButtonElement>('.ff-arch .ff-note-more');
    const note = () => host.querySelector('.ff-arch .ff-note');

    click(more());
    expect(note()?.className).not.toContain('cut');
    expect(more()?.textContent).toBe('Show less');
    expect(more()?.getAttribute('aria-expanded')).toBe('true');

    click(more());
    expect(note()?.className).toContain('cut');
    expect(more()?.textContent).toBe('Show more');
    stop();
  });

  it('opening one leaves the other closed', () => {
    const ch = twoLong();
    expect(ch.classArchetype?.notes.length).toBe(2);
    const { host, click, stop } = openTab(ch);
    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('.ff-arch .ff-note-more')];
    expect(buttons()).toHaveLength(2);

    click(buttons()[0]);
    expect(buttons().map((b) => b.textContent)).toEqual(['Show less', 'Show more']);
    stop();
  });
});

describe('a short class-archetype note', () => {
  it('has no control and still prints its text', () => {
    const ch = harbinger();
    expect(ch.classArchetype!.notes[0].length).toBeLessThan(LONG_NOTE_CHARS);
    const { host, stop } = openTab(ch);
    expect(host.querySelector('.ff-arch .ff-note-more')).toBeNull();
    expect(host.querySelector('.ff-arch .ff-note')).toBeNull();
    expect(host.querySelector('.ff-arch')?.textContent).toContain('Resolute Faith');
    stop();
  });
});

describe('the threshold itself', () => {
  /**
   * The threshold is a number picked from the data, so the data can walk up to it. It already did:
   * measured on `ca.note` alone the gap looked like 218 → 285, but the tab is handed
   * `` `${name}: ${note}` `` — Avenger renders 238, two characters under a threshold of 240, so three
   * more words of errata or a renamed feat would have flipped it with nobody looking.
   *
   * This reads every class-archetype note the app ships, renders it the way `build.ts` does, and fails
   * while there is still room to move the number instead of after a note has already crossed.
   */
  const MARGIN = 25;
  it(`keeps every shipped note at least ${MARGIN} characters clear of the threshold`, () => {
    const db = c();
    const rendered = [...Object.values(db.feats), ...Object.values(db.classFeatures)]
      .filter((r) => r.classArchetype?.note)
      .map((r) => ({ id: r.id, len: `${r.name}: ${r.classArchetype!.note}`.length }));
    // A guard that measured nothing would pass.
    expect(rendered.length).toBeGreaterThanOrEqual(14);
    const tooClose = rendered.filter((r) => Math.abs(r.len - LONG_NOTE_CHARS) < MARGIN);
    expect(tooClose.map((r) => `${r.id} (${r.len})`)).toEqual([]);
  });
});
