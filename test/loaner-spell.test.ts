import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { dailyChoicesFor } from '../src/rules/dailyChoices';
import { applyPlayState, emptyPlay } from '../src/rules/play';

/**
 * Loaner Spell: "During your daily preparations, you can gain the assistance of an allied prepared
 * spellcaster to prepare one spell for the day… you gain the ability to cast the prepared spell once
 * that day."
 *
 * An OPEN daily choice used to record the answer and grant nothing — only fixed `options` carried
 * grants — so the borrowed spell never appeared anywhere.
 */
const db = content();
const KEY = 'loaner-spell:loanerSpell';
const ch = build('fighter', 10, { featPicks: { '8:class:0': 'loaner-spell' } } as never);
const borrowed = Object.values(db.spells).find((s) => s.rank === 2 && !s.ritual)!;

const withAnswer = (spellId?: string) =>
  applyPlayState(ch, { ...emptyPlay(), ...(spellId ? { dailyChoices: { [KEY]: spellId } } : {}) }, db);
const innate = (c: ReturnType<typeof applyPlayState>) => c.spellcasting.find((e) => e.id === 'innate-casting');

describe('Loaner Spell — a spell borrowed for the day', () => {
  it('asks for the spell at daily preparations, capped at 3rd rank', () => {
    const choice = dailyChoicesFor(ch, db).find((c) => c.key === KEY);
    expect(choice, 'the choice never reached the Rest sheet').toBeTruthy();
    expect(choice!.kind).toBe('open');
    expect(choice!.options.length).toBeGreaterThan(20);
    for (const o of choice!.options) {
      const rank = db.spells[o.value]?.rank ?? 0;
      expect(rank, o.value).toBeGreaterThan(0);
      expect(rank, o.value).toBeLessThanOrEqual(3);
    }
  });

  it('the answer becomes a real 1/day casting on the Spells page', () => {
    expect(borrowed, 'no 2nd-rank spell to borrow').toBeTruthy();
    expect(innate(withAnswer()), 'a fighter with no answer has no innate entry').toBeUndefined();
    const e = innate(withAnswer(borrowed.id));
    expect(e, 'the borrowed spell produced no entry').toBeTruthy();
    expect(e!.repertoire?.[2]).toContain(borrowed.id);
    expect(e!.spellSources?.[borrowed.id]).toMatch(/borrowed/i);
  });

  it('the class-DC clause is stated, since an innate entry casts off the caster’s own DC', () => {
    expect(db.feats['loaner-spell'].choice?.note).toMatch(/class DC/i);
    expect(db.feats['loaner-spell'].dataWarning).toBeUndefined();
  });

  it('an answer naming a spell that does not exist grants nothing', () => {
    expect(innate(withAnswer('not-a-real-spell'))).toBeUndefined();
  });
});
