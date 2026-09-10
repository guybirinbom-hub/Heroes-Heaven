import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, stateGrantSummary } from '../src/rules/derive';

/**
 * BATCH 035 — the gap data-rows-1 left open.
 *
 * A `whileActive` clause printed on a record is scanned off that record, which carries a `name`, so
 * the IWR breakdown says "Ligneous Instinct". A clause that arrives through an ANSWERED choice is
 * merged into `Character.chosenEffects` — one shared, nameless DefenseGrants bag — so
 * `ownedWhileActive` had nothing to attribute it to and fell back to the bare string "Active state".
 *
 * That is the whole set of instincts that ask a question: dragon, giant, superstition. A defence you
 * cannot trace to the feature that granted it is exactly what the breakdown exists to prevent, and
 * raging-resistance.test.ts:64 already closed the same hole for the instincts that ask nothing.
 */
const db = content();

function barb(level: number, instinct: string, raging: boolean, over: Record<string, unknown> = {}) {
  const c = build('barbarian', level, { subclassId: instinct, ...over });
  return { ...c, classResources: { ...(c.classResources ?? {}), rage: raging ? 1 : 0 } } as typeof c;
}

const fromsFor = (c: ReturnType<typeof barb>, key: string) =>
  (deriveDefenses(c, db).sources[key] ?? []).map((s) => s.from);

describe('dragon-instinct: a Raging Resistance the player CHOSE still names the instinct', () => {
  // batch 035 premise: instinct-9 "You resist piercing damage and the damage type of your instinct’s dragon breath."
  // Both halves of that one sentence come from the answered dragon option, so both breakdown lines
  // have to say Dragon Instinct — the record that printed the clause.
  it('a Rime dragon-instinct barbarian traces piercing AND cold to Dragon Instinct', () => {
    const c = barb(9, 'dragon-instinct', true, { featChoices: { 'feature:dragon-instinct': 'rime' } });
    for (const key of ['resistance:piercing', 'resistance:cold']) {
      const froms = fromsFor(c, key);
      expect(froms, key).toContain('Dragon Instinct');
      expect(froms, key).not.toContain('Active state');
    }
  });

  // batch 035 premise: instinct-9 "You resist piercing damage and the damage type of your instinct’s dragon breath."
  // The Rage card's "what entering this state gives you" index walks the same list, so it was blind
  // the same way — a dragon barbarian read an unattributed "Active state" row there too.
  it('the Rage card names Dragon Instinct as the source of what raging will give', () => {
    const c = barb(9, 'dragon-instinct', true, { featChoices: { 'feature:dragon-instinct': 'rime' } });
    const froms = stateGrantSummary(c, db, 'rage').map((e) => e.from);
    expect(froms).toContain('Dragon Instinct');
    expect(froms).not.toContain('Active state');
  });
});

describe('giant-instinct: the same lane, the other question', () => {
  // batch 035 premise: instinct-4 "You resist bludgeoning damage and your choice of cold, electricity, or fire, chosen when you gain raging resistance."
  it('a Giant Instinct barbarian who picked fire traces both types to Giant Instinct', () => {
    const c = barb(9, 'giant-instinct', true, { featChoices: { 'feature:giant-instinct': 'fire' } });
    for (const key of ['resistance:bludgeoning', 'resistance:fire']) {
      const froms = fromsFor(c, key);
      expect(froms, key).toContain('Giant Instinct');
      expect(froms, key).not.toContain('Active state');
    }
  });
});

describe('the controls — ligneous-instinct and an unchosen barbarian must not move', () => {
  // The non-choice half of the lane, already green: this is the guard that the fix cannot spill into
  // the record-scanned path, which reads its name off the record and never touched chosenEffects.
  it('ligneous-instinct keeps its own attribution', () => {
    const froms = fromsFor(barb(9, 'ligneous-instinct', true), 'resistance:piercing');
    expect(froms).toContain('Ligneous Instinct');
    expect(froms).not.toContain('Active state');
  });

  it('an unanswered dragon pick still grants nothing at all', () => {
    const c = barb(9, 'dragon-instinct', true);
    expect(deriveDefenses(c, db).resistances.find((r) => r.type === 'piercing')?.value ?? 0).toBe(0);
  });

  it('the chosen clause is still state-gated and level-gated', () => {
    const off = barb(9, 'dragon-instinct', false, { featChoices: { 'feature:dragon-instinct': 'rime' } });
    expect(deriveDefenses(off, db).resistances.find((r) => r.type === 'cold')?.value ?? 0).toBe(0);
    const low = barb(8, 'dragon-instinct', true, { featChoices: { 'feature:dragon-instinct': 'rime' } });
    expect(deriveDefenses(low, db).resistances.find((r) => r.type === 'cold')?.value ?? 0).toBe(0);
  });
});
