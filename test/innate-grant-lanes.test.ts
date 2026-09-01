import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';

const c = content();

/**
 * FOUR LANES GRANT AN INNATE SPELL.
 *
 * A scan for "cast X once per day as an innate spell" reported 31 uncovered records. It was wrong
 * twice over: `effectChoices` also grants, in two shapes — `spellFilter` with `grantAs: 'innate'`,
 * and per-option `grant.innateSpells`. Counting only `innateSpells` and featCantripGrants.ts made
 * eighteen working records look broken, the same mis-measurement that has repeatedly inflated these
 * lanes.
 *
 * These tests pin the lanes so a future scan (or a future me) can be checked against them, and pin
 * the records wired from that pass.
 */

const grantsInnate = (r: {
  innateSpells?: unknown[];
  effectChoices?: { spellFilter?: { grantAs?: string }; options?: { grant?: { innateSpells?: unknown[] } }[] }[];
  enhancement?: { grant?: { innateSpells?: unknown[] } };
}) =>
  (r.innateSpells ?? []).length > 0 ||
  (r.effectChoices ?? []).some((e) => e.spellFilter?.grantAs === 'innate' || (e.options ?? []).some((o) => (o.grant?.innateSpells ?? []).length > 0)) ||
  // THE FIFTH LANE. `enhancement.grant` (the automaton Enhancement tier) is a general grant sink any
  // record may carry, so a sweep that does not walk it reports a working record as granting nothing —
  // and, below, lets an unresolvable spell id ship unchecked.
  (r.enhancement?.grant?.innateSpells ?? []).length > 0;

describe('innate spell grants', () => {
  it('a named single spell, with the frequency its text states', () => {
    /*
     * *"You gain the ability to cast Fabricated Truth ONCE PER DAY as an occult innate spell."*
     *
     * `usesPerDay` used to be absent, and this test pinned that shape as the example of a clean
     * single-spell grant — which is exactly what made it worth keeping as one. An innate grant with no
     * frequency is castable AT WILL, so 79 grants across the corpus were handing out at-will
     * Regenerate, Chain Lightning and Prismatic Armor. `scripts/innate-frequency-check.mjs` holds the
     * class at zero now, and the frequency belongs in the example.
     */
    expect(c.feats['more-real-than-real'].innateSpells).toEqual([{ spellId: 'fabricated-truth', tradition: 'occult', usesPerDay: 1 }]);
  });

  it('two named spells from one sentence', () => {
    expect(c.feats['kizidhar-magic'].innateSpells?.map((s) => s.spellId)).toEqual(['entangling-flora', 'one-with-plants']);
  });

  it('more than one use per day when the text says so', () => {
    expect(c.feats['may-death-itself-reconsider'].innateSpells?.[0].usesPerDay).toBe(3);
  });

  it('a custom heighten ladder rather than the half-level default', () => {
    // "at 18th it heightens to 8th rank, and at 20th to 9th"
    expect(c.feats['fey-life'].innateSpells?.[0].heightenAt).toEqual([{ level: 18, rank: 8 }, { level: 20, rank: 9 }]);
  });

  it('a BRANCH grants only the spells of the branch you pick', () => {
    const opts = c.feats['speakers-defense'].effectChoices?.[0].options ?? [];
    expect(opts.map((o) => o.value)).toEqual(['faithspeaker', 'greenspeaker']);
    expect(opts[0].grant?.innateSpells?.map((s) => s.spellId)).toEqual(['share-life', 'status']);
    expect(opts[1].grant?.innateSpells?.map((s) => s.spellId)).toEqual(['entangling-flora', 'environmental-endurance']);
  });

  it('a branch option with no spell still records the pick', () => {
    // Fey Ascension's Cat Sith and Monarch grant no spell; the option must still exist so the
    // player can record which fey they are, and so the list matches the printed one.
    const opts = c.feats['fey-ascension'].effectChoices?.[0].options ?? [];
    expect(opts).toHaveLength(8);
    expect(opts.filter((o) => o.grant?.innateSpells?.length)).toHaveLength(4);
  });

  it('every granted spell id resolves — a typo grants nothing, silently', () => {
    const bad: string[] = [];
    for (const col of ['feats', 'classFeatures', 'items', 'heritages', 'backgrounds', 'ancestries'] as const) {
      for (const [id, r] of Object.entries(c[col] as Record<string, Parameters<typeof grantsInnate>[0]>)) {
        for (const s of r.innateSpells ?? []) if (!c.spells[(s as { spellId: string }).spellId]) bad.push(`${col}/${id} -> ${(s as { spellId: string }).spellId}`);
        for (const e of r.effectChoices ?? [])
          for (const o of e.options ?? [])
            for (const s of o.grant?.innateSpells ?? []) if (!c.spells[(s as { spellId: string }).spellId]) bad.push(`${col}/${id}/${(o as { value?: string }).value} -> ${(s as { spellId: string }).spellId}`);
        for (const s of r.enhancement?.grant?.innateSpells ?? [])
          if (!c.spells[(s as { spellId: string }).spellId]) bad.push(`${col}/${id}/enhancement -> ${(s as { spellId: string }).spellId}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the records wired from the audit all grant through one of the lanes', () => {
    const wired = [
      'kizidhar-magic', 'horn-and-bone-incantation', 'seat-of-power', 'more-real-than-real',
      'may-death-itself-reconsider', 'fey-life', 'fey-ascension', 'speakers-defense',
    ];
    for (const id of wired) expect(grantsInnate(c.feats[id]), `${id} grants nothing`).toBe(true);
    expect(grantsInnate(c.backgrounds['blight-survivor'])).toBe(true);
  });
});

/**
 * The data existing is not the same as the spell REACHING the character. These build a character and
 * look for the spell in their innate entry — the only proof that the grant is wired end to end.
 */
describe('granted innate spells reach the character', () => {
  const withFeat = (featId: string, level = 20) =>
    buildCharacter(
      { ...emptyBuild(), classId: 'fighter', subclassId: null, level, ancestryId: 'human', keyAbility: 'str', featPicks: { [`${level}:general:0`]: featId } },
      c,
    );

  const innateIds = (ch: ReturnType<typeof buildCharacter>) =>
    ch.spellcasting.filter((e) => e.type === 'innate').flatMap((e) => [...(e.cantrips ?? []), ...Object.values(e.repertoire ?? {}).flat()]);

  it('More Real Than Real puts Fabricated Truth in the innate list', () => {
    expect(innateIds(withFeat('more-real-than-real'))).toContain('fabricated-truth');
  });

  it('Fey Life puts Summon Fey there', () => {
    expect(innateIds(withFeat('fey-life'))).toContain('summon-fey');
  });

  it('a character without the feat has neither', () => {
    const plain = buildCharacter({ ...emptyBuild(), classId: 'fighter', level: 20, ancestryId: 'human', keyAbility: 'str' }, c);
    expect(innateIds(plain)).not.toContain('fabricated-truth');
  });
});
