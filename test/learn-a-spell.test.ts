import { describe, it, expect } from 'vitest';
import { applyPlayState, initialPlay, learnSpell, unlearnSpell, playForRebuild } from '../src/rules/play';
import { content, build } from './_content';

/*
 * Learn a Spell. The rule the tests are protecting is where a learned spell LANDS, which the activity
 * makes different per caster: "A spell you learn is added to your repository of spells, such as a
 * spellbook for a wizard… If you have a spell repertoire, such as a bard, it's not automatically added
 * since you can only know a limited number of spells. Instead, you can select it when you add or swap
 * spells."
 */

const c = content();
const wizard = build('wizard', 5, { keyAbility: 'int' });
const bard = build('bard', 5, { keyAbility: 'cha' });
const bookEntry = wizard.spellcasting.find((e) => e.spellbook)!;
const repEntry = bard.spellcasting.find((e) => e.repertoire)!;
// The fixture wizard is built with no spells chosen, so its book is empty. A copy with one 1st-rank
// spell already written in it is what the merge-into-the-spellbook cases actually need to test.
const stocked = {
  ...wizard,
  spellcasting: wizard.spellcasting.map((e) =>
    e.id === bookEntry.id ? { ...e, spellbook: { ...(e.spellbook ?? {}), 1: ['fear'] } } : e,
  ),
};

describe('learnSpell — a spellbook caster', () => {
  it('adds the spell to the spellbook, where the daily preparation can reach it', () => {
    const play = learnSpell(initialPlay(wizard, c), bookEntry.id, 1, 'force-barrage');
    const after = applyPlayState(wizard, play, c).spellcasting.find((e) => e.id === bookEntry.id)!;
    expect(after.spellbook![1]).toContain('force-barrage');
  });

  it('leaves what the build already wrote in the book alone', () => {
    const play = learnSpell(initialPlay(stocked, c), bookEntry.id, 1, 'grease');
    const after = applyPlayState(stocked, play, c).spellcasting.find((e) => e.id === bookEntry.id)!;
    expect(after.spellbook![1]).toEqual(['fear', 'grease']);
  });

  it('never duplicates a spell already in the book', () => {
    const play = learnSpell(initialPlay(stocked, c), bookEntry.id, 1, 'fear');
    const after = applyPlayState(stocked, play, c).spellcasting.find((e) => e.id === bookEntry.id)!;
    expect(after.spellbook![1]).toEqual(['fear']);
  });
});

describe('learnSpell — a repertoire caster', () => {
  it('does NOT push the spell into the repertoire — that would break the known-spells cap', () => {
    const play = learnSpell(initialPlay(bard, c), repEntry.id, 1, 'fear');
    const after = applyPlayState(bard, play, c).spellcasting.find((e) => e.id === repEntry.id)!;
    expect(after.repertoire![1] ?? []).not.toContain('fear');
  });

  it('records it as learned, so the repertoire picker can offer it as a known option', () => {
    const play = learnSpell(initialPlay(bard, c), repEntry.id, 1, 'fear');
    const after = applyPlayState(bard, play, c).spellcasting.find((e) => e.id === repEntry.id)!;
    expect(after.learned![1]).toEqual(['fear']);
  });
});

describe('learnSpell bookkeeping', () => {
  it('learning the same spell twice is a no-op (same object back)', () => {
    const once = learnSpell(initialPlay(wizard, c), bookEntry.id, 1, 'force-barrage');
    expect(learnSpell(once, bookEntry.id, 1, 'force-barrage')).toBe(once);
  });

  it('unlearnSpell takes it back out of the book', () => {
    let play = learnSpell(initialPlay(wizard, c), bookEntry.id, 1, 'force-barrage');
    play = unlearnSpell(play, bookEntry.id, 1, 'force-barrage');
    const after = applyPlayState(wizard, play, c).spellcasting.find((e) => e.id === bookEntry.id)!;
    expect(after.spellbook![1] ?? []).not.toContain('force-barrage');
  });

  it('unlearning the last spell prunes the entry rather than leaving empty maps behind', () => {
    let play = learnSpell(initialPlay(wizard, c), bookEntry.id, 1, 'force-barrage');
    play = unlearnSpell(play, bookEntry.id, 1, 'force-barrage');
    expect(play.learnedSpells).toEqual({});
  });

  it('survives a rebuild — an hour of study and real gold is progress, not a preparation', () => {
    const play = learnSpell(initialPlay(wizard, c), bookEntry.id, 1, 'force-barrage');
    expect(playForRebuild(play).learnedSpells).toEqual({ [bookEntry.id]: { 1: ['force-barrage'] } });
  });
});
