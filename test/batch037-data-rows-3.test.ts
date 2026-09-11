import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses } from '../src/rules/derive';
import { dailyChoicesFor } from '../src/rules/dailyChoices';
import type { BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/*
 * BATCH 037 — WG-comparison lane, data-rows chunk 3.
 *
 * Every assertion here reads the SHIPPED content through `content()` and exercises it on a BUILT
 * character, so each one fails today for the one reason the batch exists: the row is not applied yet.
 * Nothing in this file patches a record in memory and then asserts the patch — that would be a
 * patched-vs-shipped delta that flips the moment the driver runs and proves nothing either way.
 */
const db = content();

/* Both halves of an innate entry: a rank-0 spell lands in `cantrips`, a ranked one in `repertoire`. */
const innateIds = (c: Character) =>
  (c.spellcasting ?? []).flatMap((e) => [
    ...((e as { cantrips?: string[] }).cantrips ?? []),
    ...Object.values((e as { repertoire?: Record<string, string[]> }).repertoire ?? {}).flat(),
  ]);

/** A character wearing one invested emblem — the state the tattoo's text describes. */
const wearing = (itemId: string): Character =>
  build('fighter', 5, {
    inventory: [{ instanceId: 'e', itemId, quantity: 1, invested: true, worn: true }],
  } as never) as Character;

describe('unifying-emblem-shundar-quah, unifying-emblem-sklar-quah and unifying-emblem-tamiir-quah cast the spell their Activate line promises', () => {
  /*
   * "Activate — the actions required to Activate the tattoo are the same as those needed to cast its
   * spell; Frequency once per day; Effect The tattoo casts its spell."
   */
  // batch 037: unifying-emblem-shundar-quah#daily-spell
  it('unifying-emblem-shundar-quah casts Thoughtful Gift once a day', () => {
    expect(innateIds(wearing('unifying-emblem-shundar-quah'))).toContain('thoughtful-gift');
    const g = (db.items['unifying-emblem-shundar-quah'] as { innateSpells?: { spellId: string; usesPerDay?: number }[] }).innateSpells ?? [];
    expect(g.find((s) => s.spellId === 'thoughtful-gift')?.usesPerDay, 'once per day, not at will').toBe(1);
  });

  // batch 037: unifying-emblem-sklar-quah#daily-spell
  it('unifying-emblem-sklar-quah casts Concordant Choir, and its activation costs what the spell costs', () => {
    expect(innateIds(wearing('unifying-emblem-sklar-quah'))).toContain('concordant-choir');
    /* Print takes the activation from the spell, and Concordant Choir casts in 1 to 3 actions — the
     * emblem shipped with no activation cost at all, so the player could not spend anything. */
    expect((db.items['unifying-emblem-sklar-quah'] as { activationCost?: unknown }).activationCost)
      .toEqual({ type: 'variable', min: 1, max: 3 });
  });

  // batch 037: unifying-emblem-tamiir-quah#daily-spell
  it('unifying-emblem-tamiir-quah casts Tailwind behind the two-action activation it already showed', () => {
    expect(innateIds(wearing('unifying-emblem-tamiir-quah'))).toContain('tailwind');
    expect((db.items['unifying-emblem-tamiir-quah'] as { activationCost?: unknown }).activationCost)
      .toEqual({ type: 'actions', value: 2 });
  });

  it('an emblem left in the pack casts nothing — the tattoo has to be invested', () => {
    const packed = build('fighter', 5, {
      inventory: [{ instanceId: 'e', itemId: 'unifying-emblem-tamiir-quah', quantity: 1 }],
    } as never) as Character;
    expect(innateIds(packed)).not.toContain('tailwind');
  });
});

/** An automaton fighter. Ancestry slots are `<level>:ancestry`; a feat's own `choice` answer is
 *  stored under the SLOT key, an `effectChoices` answer under `<featId>:<choiceId>`. */
const auto = (level: number, featPicks: Record<string, string>, over: Partial<BuildState> = {}): Character =>
  build('fighter', level, { ancestryId: 'automaton', featPicks, ...over });

const res = (c: Character, type: string) => deriveDefenses(c, db).resistances.find((r) => r.type === type)?.value ?? 0;

describe('hardened-chassis computes its Enhancement tier instead of describing it', () => {
  /*
   * feat-9400: "Enhancement Your chassis gets even tougher. Choose one of the following benefits: you
   * gain resistance 3 to all physical damage, or your chosen resistance increases to a value equal to
   * half your level (minimum 3). This resistance is still bypassed by adamantine."
   */
  // batch 037: hardened-chassis#enhancement
  it('hardened-chassis raises the CHOSEN resistance to half your level once an augmentation names it', () => {
    const ch = auto(
      9,
      { '5:ancestry': 'hardened-chassis', '9:ancestry': 'lesser-augmentation' },
      {
        featChoices: { '5:ancestry': 'slashing' } as BuildState['featChoices'],
        effectChoices: {
          'lesser-augmentation:enhancement': 'hardened-chassis',
          'hardened-chassis:hardened-chassis-enhancement': 'raise-slashing',
        },
      } as never,
    );
    expect(ch.enhancements).toEqual([{ featId: 'hardened-chassis', from: 'Lesser Augmentation' }]);
    // half of 9 is 4, above the printed minimum of 3 — and above the base tier's flat 3.
    expect(res(ch, 'slashing')).toBe(4);
  });

  // batch 037: hardened-chassis#enhancement
  it('hardened-chassis can instead take resistance 3 to ALL physical damage', () => {
    const ch = auto(
      9,
      { '5:ancestry': 'hardened-chassis', '9:ancestry': 'lesser-augmentation' },
      {
        featChoices: { '5:ancestry': 'slashing' } as BuildState['featChoices'],
        effectChoices: {
          'lesser-augmentation:enhancement': 'hardened-chassis',
          'hardened-chassis:hardened-chassis-enhancement': 'all-physical',
        },
      } as never,
    );
    expect(res(ch, 'physical')).toBe(3);
  });

  // batch 037: hardened-chassis#enhancement
  it('hardened-chassis grants the tier to NO automaton who has not been augmented — never asked of everyone', () => {
    /* WG asks "Enhancement?" on the feat itself with a No option, so any automaton can answer yes.
     * ancestry-98: "You don't gain the benefits of the enhancement unless you take a feat that grants
     * you those benefits, such as Lesser Augmentation." */
    const plain = auto(9, { '5:ancestry': 'hardened-chassis' }, {
      featChoices: { '5:ancestry': 'slashing' } as BuildState['featChoices'],
    } as never);
    expect(plain.enhancements).toBeUndefined();
    expect(res(plain, 'slashing'), 'the base tier only').toBe(3);
    expect(res(plain, 'physical')).toBe(0);
  });

  // batch 037: hardened-chassis#enhancement
  it("hardened-chassis offers the raise-branch only for the damage type its BASE choice named", () => {
    const rec = db.feats['hardened-chassis'] as {
      enhancement?: { choiceIds?: string[] };
      effectChoices?: { id: string; options?: { value: string; onlyWhenFlag?: { flag: string; value: string } }[] }[];
    };
    expect(rec.enhancement?.choiceIds).toEqual(['hardened-chassis-enhancement']);
    const ch = (rec.effectChoices ?? []).find((c) => c.id === 'hardened-chassis-enhancement');
    /* FOUR raw options. A one-option gated choice is auto-applied by resolvePick even unanswered,
     * which would deliver the tier to every automaton — the defect this lane exists to prevent. */
    expect(ch?.options).toHaveLength(4);
    for (const o of ch?.options ?? []) {
      if (o.value === 'all-physical') expect(o.onlyWhenFlag).toBeUndefined();
      else expect(o.onlyWhenFlag).toEqual({ flag: 'hardenedChassisDamage', value: o.value.replace('raise-', '') });
    }
  });
});

describe('armigers-protection offers the three suits print names, and no invented one', () => {
  /*
   * feat-8814: "In addition, when you choose this feat, you receive a non-magical suit of Hellknight
   * armor of a type you become trained in (Hellknight breastplate, Hellknight half plate, or
   * Hellknight plate)."
   */
  // batch 037: armigers-protection#armor-pick
  it('armigers-protection lists all three printed suits and every value is a real item', () => {
    const ch = (db.feats['armigers-protection'] as { choice?: { options?: { value: string }[]; note?: string } }).choice;
    const values = (ch?.options ?? []).map((o) => o.value);
    expect(values).toEqual(['hellknight-breastplate', 'hellknight-half-plate', 'hellknight-plate']);
    // The shipped picker offered "hellknight-plates", which is not an item in the database at all.
    for (const v of values) expect(db.items[v], `${v} must exist`).toBeTruthy();
    // The two heavy suits are trained only via the printed light+medium condition, which no per-option
    // gate can express (SkillRankGate names a SKILL) — so the picker has to say it.
    expect(ch?.note ?? '').toMatch(/light armor and medium armor/i);
  });
});

describe('haunting-memories asks the second daily question print gives it', () => {
  /*
   * feat-7701: "You also gain one skill feat with a minimum requirement of your new rank in the chosen
   * skill. For the purpose of meeting level prerequisites for this feat, your level is equal to half
   * your level."
   */
  const ghost = (level: number): Character =>
    build('fighter', level, {
      featPicks: {
        '2:class': 'ghost-dedication',
        '4:class': 'headless-haunt',
        '8:class': 'haunting-memories',
      },
    } as never) as Character;

  // batch 037: haunting-memories#skill-feat-pick
  it('haunting-memories hands over the carrier that asks it, and the morning list carries both questions', () => {
    const ch = ghost(8);
    expect((ch.feats ?? []).map((f) => f.featId)).toContain('haunting-memories-skill-feat');
    const keys = dailyChoicesFor(ch, db).map((d) => d.key);
    expect(keys, 'the proficiency half').toContain('haunting-memories:hauntingMemory');
    expect(keys, 'the skill-feat half').toContain('haunting-memories-skill-feat:hauntingMemorySkillFeat');
  });

  // batch 037: haunting-memories#skill-feat-pick
  it('haunting-memories caps the borrowed feat at HALF your level, not at WG’s flat 10th', () => {
    const at8 = dailyChoicesFor(ghost(8), db).find((d) => d.key === 'haunting-memories-skill-feat:hauntingMemorySkillFeat');
    const at20 = dailyChoicesFor(ghost(20), db).find((d) => d.key === 'haunting-memories-skill-feat:hauntingMemorySkillFeat');
    const maxLevel = (opts: { value: string }[] | undefined) =>
      Math.max(...(opts ?? []).map((o) => db.feats[o.value]?.level ?? 0));
    expect(maxLevel(at8?.options)).toBeLessThanOrEqual(4);
    // Only skill feats — the borrowed pick is "one skill feat", never a general or class one.
    for (const o of at8?.options ?? []) expect(db.feats[o.value]?.category).toBe('skill');
    expect(maxLevel(at20?.options)).toBeGreaterThan(4);
    expect(maxLevel(at20?.options)).toBeLessThanOrEqual(10);
  });

  // batch 037: haunting-memories#skill-feat-pick
  it('haunting-memories no longer tells the player to take the feat by hand', () => {
    const note = (db.feats['haunting-memories'] as { choice?: { note?: string } }).choice?.note ?? '';
    expect(note).not.toMatch(/take it as a temporary feat/i);
    // …and the carrier states the half the app cannot filter on: the feat's skill requirement.
    const carrier = (db.feats['haunting-memories-skill-feat'] as { choice?: { note?: string } }).choice?.note ?? '';
    expect(carrier).toMatch(/minimum requirement/i);
  });
});
