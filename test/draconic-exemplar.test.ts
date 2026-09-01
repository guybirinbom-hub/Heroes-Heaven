import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { narrowChoiceOptions } from '../src/rules/derive';

/*
 * THE DRACONIC EXEMPLAR — a choice that never existed, and the seven feats that filter it.
 *
 * The Draconic Codex sidebar lets any dragonblood character choose an exemplar; seven dragonblood
 * feats then constrain WHICH dragon is legal (*"you must choose a dragon with a climb Speed"*, *"…an
 * arcane dragon"*). The app never asked the question, so the constraints had no menu to filter — and
 * the heritage picker mapped raw options, so even an authored limit could not have reached it.
 *
 * Everything asserted here is computed from printed data: traditions from each exemplar's own page,
 * speeds from the bestiary's young/adult/ancient stat blocks. Owner ruling 2026-08-22.
 */
const db = content();

const dragonblood = (feats: Record<string, string> = {}) =>
  buildCharacter(
    { ...emptyBuild(), name: 't', level: 5, classId: 'fighter', ancestryId: 'human', heritageId: 'dragonblood', featPicks: feats } as BuildState,
    db,
  );

const optionsFor = (ch: ReturnType<typeof dragonblood>) => {
  const def = db.heritages['dragonblood'].choice!;
  return narrowChoiceOptions('dragonblood', def, def.options ?? [], ch, db).map((o) => o.value);
};

describe('the draconic exemplar choice', () => {
  it('exists on the heritage, with the 40 dragons and no tradition headings', () => {
    const def = db.heritages['dragonblood'].choice;
    expect(def?.flag).toBe('draconicExemplar');
    expect(def?.options?.length).toBe(40);
    for (const heading of ['arcane', 'divine', 'occult', 'primal']) {
      expect(def!.options!.some((o) => o.value === heading), `${heading} is a table heading, not a dragon`).toBe(false);
    }
  });

  it('unconstrained, every dragon is on the menu', () => {
    expect(optionsFor(dragonblood()).length).toBe(40);
  });

  it('Summiting Dragonblood narrows it to the dragons with a climb Speed', () => {
    /* From the bestiary: Conspirator, Mirage and Wish dragons climb; nothing else does. */
    const opts = optionsFor(dragonblood({ '1:ancestry': 'summiting-dragonblood' }));
    expect(opts.sort()).toEqual(['conspirator', 'mirage', 'wish']);
  });

  it('a tradition feat narrows to its own tradition', () => {
    const opts = optionsFor(dragonblood({ '1:ancestry': 'primal-dragonblood' }));
    expect(opts.length).toBe(12);
    expect(opts).toContain('adamantine');
    expect(opts, 'Mirage is an arcane dragon').not.toContain('mirage');
  });

  it('two constraints INTERSECT — and an empty intersection is what the book implies', () => {
    /*
     * Primal ∩ climb is empty: the three climbing dragons are arcane/occult. A character with both
     * feats has no legal exemplar, which is what the printed constraints jointly say — the picker
     * shows nothing rather than something illegal.
     */
    const opts = optionsFor(dragonblood({ '1:ancestry': 'primal-dragonblood', '5:ancestry': 'summiting-dragonblood' }));
    expect(opts).toEqual([]);
  });

  it('the limits do not leak onto characters without the feats', () => {
    expect(optionsFor(dragonblood()).length, 'no feat, no narrowing').toBe(40);
    /* …and never onto a different heritage: the choice only exists on dragonblood. */
    expect(db.heritages['skilled-human'].choiceOptionLimits ?? null).toBeNull();
  });
});
