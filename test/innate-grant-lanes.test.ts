import { describe, it, expect } from 'vitest';
import { content } from './_content';

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
}) =>
  (r.innateSpells ?? []).length > 0 ||
  (r.effectChoices ?? []).some((e) => e.spellFilter?.grantAs === 'innate' || (e.options ?? []).some((o) => (o.grant?.innateSpells ?? []).length > 0));

describe('innate spell grants', () => {
  it('a named single spell', () => {
    expect(c.feats['more-real-than-real'].innateSpells).toEqual([{ spellId: 'fabricated-truth', tradition: 'occult' }]);
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
