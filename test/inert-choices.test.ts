import { describe, it, expect } from 'vitest';
import { content } from './_content';

const c = content();

/**
 * PICKS THAT ARE RECORDED BUT GRANT NOTHING.
 *
 * Two agreed cases (work/choice-lane/DECISIONS.md §2 and §4):
 *   - Kingdom feats belong to a kingdom sheet that doesn't exist yet — prompt anyway and store the
 *     answer, so it's already there when one arrives.
 *   - Legacy content keyed off something the Remaster deleted (Warding Rune wants a school of magic)
 *     — still offer the choice, but say plainly that it won't grant the benefit.
 *
 * The rule these encode: never silently show a pick that does nothing. `inert` is the reason, and it
 * must never appear on a pick that SHOULD work.
 */
describe('inert (recorded-only) choices', () => {
  const KINGDOM = ['civil-service', 'aon-civil-service', 'kingdom-assurance', 'aon-kingdom-assurance', 'skill-training-kingdom'];
  const LEGACY = ['warding-rune', 'aon-warding-rune'];

  it('every kingdom feat that asks for a pick offers one, and explains it is recorded only', () => {
    for (const id of KINGDOM) {
      const choice = c.feats[id]?.choice;
      expect(choice, `${id} should offer a choice`).toBeTruthy();
      expect(choice!.kind, `${id} has no option data in the app, so it must be free text`).toBe('text');
      expect(choice!.inert, `${id} must say why it grants nothing`).toMatch(/no Kingdom sheet/i);
    }
  });

  it('the legacy school-of-magic pick warns that the Remaster removed schools', () => {
    for (const id of LEGACY) {
      const choice = c.feats[id]?.choice;
      expect(choice?.kind).toBe('text');
      expect(choice?.inert).toMatch(/Remaster removed schools of magic/i);
    }
  });

  it('the school taxonomy really is gone — the warning is true, not defensive boilerplate', () => {
    const SCHOOLS = /^(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)$/i;
    const spells = Object.values(c.spells);
    const withSchool = spells.filter((s) => (s.traits ?? []).some((t) => SCHOOLS.test(t)));
    // If a future data import restores schools to most spells, this fails and the warning should go.
    expect(withSchool.length).toBeLessThan(spells.length / 2);
  });

  it('NO working choice was marked inert (the flag must not paper over a real pick)', () => {
    // Assurance is the canary: a real, working choose-a-skill pick.
    expect(c.feats['assurance']?.choice?.inert).toBeUndefined();
    expect(c.feats['domain-initiate']?.choice?.inert).toBeUndefined();
  });

  /**
   * This test used to pin `inert` to the five kingdom feats and two legacy ones. The build-choice
   * pass then applied the SAME agreed treatment — offer the pick, say plainly that it grants nothing —
   * to every record whose effect the app cannot model, which is dozens rather than seven. An
   * allow-list of names would have to grow with each one and would stop meaning anything, so what is
   * asserted now is the rule those seven were an instance of.
   */
  it('every inert choice explains itself, in words', () => {
    const bad: string[] = [];
    for (const [id, f] of Object.entries(c.feats)) {
      const inert = f.choice?.inert;
      if (inert === undefined) continue;
      // A boolean renders as an empty span in the builder — the reason IS the feature.
      if (typeof inert !== 'string') bad.push(`${id}: inert is ${typeof inert}, must be a reason string`);
      else if (inert.trim().length < 15) bad.push(`${id}: reason too short to explain anything ("${inert}")`);
    }
    expect(bad).toEqual([]);
  });

  it('inert is never used where the pick would actually work', () => {
    // The failure this guards: reaching for `inert` instead of wiring a pick the engine supports.
    const bad: string[] = [];
    for (const [id, f] of Object.entries(c.feats)) {
      if (!f.choice?.inert) continue;
      if ((f.effectChoices ?? []).length) bad.push(`${id}: grants through effectChoices AND claims to do nothing`);
      if (f.choice.kind === 'skills') bad.push(`${id}: a skills pick trains a skill — it is not inert`);
    }
    expect(bad).toEqual([]);
  });

  it('the number of do-nothing pickers does not creep up unnoticed', () => {
    // A ceiling, like the coverage ratchet: lowering it is progress; raising it needs a reason.
    const inert = Object.values(c.feats).filter((f) => f.choice?.inert).length;
    expect(inert, 'more records now record a pick without applying it').toBeLessThanOrEqual(47);
  });

  it('kingdom feats that ask nothing were left alone', () => {
    const kingdomFeats = Object.entries(c.feats).filter(([, f]) => (f.traits ?? []).includes('kingdom'));
    expect(kingdomFeats.length).toBe(32);
    // Only the 5 whose text actually says "choose" gained a picker; the other 27 stay untouched.
    const withChoice = kingdomFeats.filter(([, f]) => f.choice);
    expect(withChoice).toHaveLength(5);
  });
});

/**
 * A CHOICE NOBODY RENDERS IS DEAD DATA.
 *
 * Only `feats[id].choice` was ever rendered. `ClassFeature` and `Heritage` did not even DECLARE the
 * field, so 25 class-feature and 6 heritage choices shipped, appeared in no picker and were answered
 * by nobody — the same silent failure as a grant naming a spell that doesn't exist.
 *
 * The builder now renders both. Items are the remaining surface: an item's pick belongs to the
 * inventory row (you make it when you acquire or invest the item), which does not exist yet — so the
 * count is pinned rather than left to drift.
 */
describe('every choice has somewhere to be answered', () => {
  const RENDERED = ['feats', 'classFeatures', 'heritages'] as const;

  it('feats, class features and heritages are all rendered surfaces', () => {
    for (const col of RENDERED) {
      const withChoice = Object.values(c[col] as Record<string, { choice?: unknown }>).filter((r) => r.choice);
      expect(withChoice.length, `${col} should carry choices`).toBeGreaterThan(0);
    }
  });

  it('a non-daily ITEM choice has no picker yet — hold the line at the known count', () => {
    // Daily ones reach the player through the Rest sheet, so they are fine. The rest need an
    // inventory-row surface: you make an item's pick when you acquire or invest it, not at build time.
    const stranded = Object.entries(c.items)
      .filter(([, i]) => i.choice && !i.choice.daily)
      .map(([id]) => id);
    expect(stranded.length, `unrendered item choices: ${stranded.join(', ')}`).toBeLessThanOrEqual(10);
  });

  it('BACKGROUND choices: 30 reach the player another way, 40 do not', () => {
    // `backgrounds[id].choice` is not rendered either. Some of these are still delivered, by a LOOSER
    // control — `trainedLoreChoice` (a free-text Lore box), `trainedLoreOptions` or
    // `trainedSkillChoice` (pickers) — where the record names the exact legal options and the control
    // does not. I assumed most were covered that way; measuring says fewer than half are.
    //
    // Both numbers are pinned so the split is a fact rather than an impression, and so closing the
    // 40 shows up as this test being tightened.
    const stranded = Object.entries(c.backgrounds).filter(([, b]) => b.choice && !b.choice.daily);
    const covered = stranded.filter(([, b]) => b.trainedLoreChoice || (b.trainedLoreOptions ?? []).length || (b.trainedSkillChoice ?? []).length);
    expect(stranded.length, 'backgrounds carrying an unrendered choice').toBeLessThanOrEqual(70);
    expect(stranded.length - covered.length, 'of those, ones with no other route to the player').toBeLessThanOrEqual(40);
  });

  it('no OTHER collection carries a choice with nowhere to go', () => {
    const bad: string[] = [];
    for (const col of ['ancestries', 'spells', 'actions'] as const) {
      for (const [id, r] of Object.entries((c as unknown as Record<string, Record<string, { choice?: { daily?: boolean } }>>)[col] ?? {})) {
        if (r.choice && !r.choice.daily) bad.push(`${col}/${id}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

/**
 * A Lore skill that does not exist.
 *
 * "You're trained in Legal Lore or Underworld Lore" was imported as ONE subject, so seven characters
 * were trained in "Legal-lore-or-underworld Lore" and were never asked which they had.
 */
describe('background Lore subjects are real', () => {
  it('no trainedLore is two subjects glued together', () => {
    const bad = Object.entries(c.backgrounds)
      .filter(([, b]) => b.trainedLore && /-or-|_or_|\bor\b/i.test(b.trainedLore))
      .map(([id, b]) => `${id}: "${b.trainedLore}"`);
    expect(bad).toEqual([]);
  });

  it('the either/or ones offer both subjects', () => {
    expect(c.backgrounds['squire'].trainedLoreOptions).toEqual(['heraldry', 'warfare']);
    expect(c.backgrounds['squire'].trainedLore).toBeUndefined();
    expect(c.backgrounds['ex-con-token-guard'].trainedLoreOptions).toEqual(['legal', 'underworld']);
  });

  it('an OPEN second half becomes free text instead', () => {
    // Free Spirit offers "Settlement Lore or a terrain Lore" — the second is a category, not a subject.
    expect(c.backgrounds['free-spirit'].trainedLoreChoice).toBe(true);
    expect(c.backgrounds['free-spirit'].trainedLoreOptions).toBeUndefined();
  });

  it('a background never offers both controls at once', () => {
    const both = Object.entries(c.backgrounds)
      .filter(([, b]) => b.trainedLoreChoice && (b.trainedLoreOptions ?? []).length)
      .map(([id]) => id);
    expect(both).toEqual([]);
  });
});
