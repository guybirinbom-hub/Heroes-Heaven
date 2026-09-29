import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import { buildCharacter, deriveBuildFromCharacter, sameNaturalAttack } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';
import { movedProseVerdict, proseWords, wordShare } from '../scripts/lib/moved-prose.mjs';

/**
 * Print batch P02, gap agent for data-rows-2: the engine half of unfurling-brocade#two-handed-die.
 *
 * A granted Strike's `die` is a die SIZE and deriveUnarmedStrike prefixes the count, but 14 shipped
 * grantedStrikes wrote the count too ('1d4', Phantom Shroud's '3d6'). The fabric rendered "11d4+1 S" on
 * a built magus. The data-rows-2 row fixes the fabric alone; these cases pin the engine so NO row shape
 * can print a doubled count, and so '1d4' and 'd4' are one attack when a save is rebuilt.
 *
 * Every case PATCHES the fabric's grantedStrikes IN MEMORY, so it holds before and after the driver
 * applies the data-rows-2 row (which rewrites the same field).
 */
const db = content();
const traits = ['disarm', 'finesse', 'reach', 'sweep', 'trip'];
const withStrikes = (gs: unknown[]): ContentDatabase => ({
  ...db,
  classFeatures: { ...db.classFeatures, 'unfurling-brocade': { ...db.classFeatures['unfurling-brocade']!, grantedStrikes: gs } },
}) as ContentDatabase;
const magus = (level: number, over: ContentDatabase) =>
  buildCharacter(deriveBuildFromCharacter(build('magus', level, { subclassId: 'unfurling-brocade', keyAbility: 'str' }), over), over);
const strikeOf = (level: number, over: ContentDatabase, name: string) => deriveStrikes(magus(level, over), over).find((s) => s.name === name);

describe('unfurling-brocade: a granted Strike never prints a doubled dice count', () => {
  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: the shipped pre-row fabric die "1d4" derives 1d4, not 11d4', () => {
    const over = withStrikes([{ name: 'Qi-Infused Fabric', die: '1d4', damageType: 'slashing', traits, group: 'flail' }]);
    const s = strikeOf(1, over, 'Qi-Infused Fabric');
    // batch P02: unfurling-brocade#two-handed-die
    expect(s?.damage).toMatch(/^1d4[+ ]/);
    expect(s?.damage).not.toMatch(/^11d/);
  });

  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: the stored natural attack carries the bare die size, so the die ladder can step it', () => {
    const over = withStrikes([{ name: 'Qi-Infused Fabric', die: '1d4', damageType: 'slashing', traits, group: 'flail' }]);
    const na = (magus(1, over).naturalAttacks ?? []).find((n) => n.name === 'Qi-Infused Fabric');
    // batch P02: unfurling-brocade#two-handed-die
    expect(na?.die).toBe('d4');
    expect(na?.dieNote).toBeUndefined();
  });

  /* Phantom Shroud: *"You also gain an unarmed attack that deals 3d6 negative damage"* (AoN
   * equipment-1783). A printed count above one is the floor, not a prefix: "3d6", never "13d6". */
  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: a printed count above one (3d6) derives 3d6 and says 2 extra dice', () => {
    const over = withStrikes([{ name: 'Qi-Infused Fabric', die: '3d6', damageType: 'slashing', traits, group: 'flail' }]);
    const s = strikeOf(1, over, 'Qi-Infused Fabric');
    // batch P02: unfurling-brocade#two-handed-die
    expect(s?.damage).toMatch(/^3d6[+ ]/);
    expect(s?.strikingDice).toBe(2);
  });

  /* The guard: EVERY die string any shipped grantedStrikes row uses (any record, any depth) derives with
   * the count its row printed (1 when it wrote a bare size) — so the next '1d8' or '3d4' row cannot
   * render '11d8' / '13d4' again. Level 1, no handwraps: nothing adds dice. */
  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: every die shape in the shipped grantedStrikes derives with its own count', () => {
    const dies = new Set<string>();
    const walk = (o: unknown): void => {
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (!o || typeof o !== 'object') return;
      const rec = o as Record<string, unknown>;
      if (Array.isArray(rec.grantedStrikes)) for (const g of rec.grantedStrikes as { die?: unknown }[]) if (typeof g?.die === 'string') dies.add(g.die);
      for (const [k, v] of Object.entries(rec)) if (k !== 'grantedStrikes' && k !== 'description') walk(v);
    };
    for (const bucket of ['feats', 'items', 'classFeatures', 'heritages', 'ancestries', 'classes', 'stances']) walk((db as unknown as Record<string, unknown>)[bucket]);
    // batch P02: unfurling-brocade#two-handed-die
    expect([...dies].some((d) => /^\d+d/.test(d))).toBe(true); // the shape this guards is really in the corpus
    const wrong: string[] = [];
    for (const d of dies) {
      const m = /^(\d*)(d\d+)$/.exec(d);
      if (!m) continue;
      const want = `${m[1] ? Number(m[1]) : 1}${m[2]}`;
      const s = strikeOf(1, withStrikes([{ name: 'Qi-Infused Fabric', die: d, damageType: 'slashing', traits, group: 'flail' }]), 'Qi-Infused Fabric');
      if (!s?.damage.startsWith(want)) wrong.push(`${d} -> ${s?.damage}`);
    }
    // batch P02: unfurling-brocade#two-handed-die
    expect(wrong).toEqual([]);
  });
});

describe('unfurling-brocade: "1d4" and "d4" are one attack when a save is rebuilt (sameNaturalAttack)', () => {
  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: a count of one is dropped in the compare, a larger count is not', () => {
    const a = { name: 'Old Fabric', die: '1d4', damageType: 'slashing', group: 'flail' };
    // batch P02: unfurling-brocade#two-handed-die
    expect(sameNaturalAttack(a, { ...a, name: 'Qi-Infused Fabric', die: 'd4' })).toBe(true);
    expect(sameNaturalAttack({ ...a, die: '3d6' }, { ...a, name: 'Qi-Infused Fabric', die: 'd6' })).toBe(false);
    expect(sameNaturalAttack(a, { ...a, name: 'Qi-Infused Fabric', die: 'd4', damageType: 'piercing' })).toBe(false);
  });

  /* A magus saved while the grant was a RENAMED '1d4' row, rebuilt after the row became a bare 'd4' under
   * another name: the stored copy is the same attack by shape and must not survive as a manual Strike. */
  // batch P02: unfurling-brocade#two-handed-die
  it('unfurling-brocade: a save holding a renamed 1d4 grant rebuilds to the one d4 grant, not two', () => {
    const before = withStrikes([{ name: 'Old Fabric', die: '1d4', damageType: 'slashing', traits, group: 'flail' }]);
    const after = withStrikes([{ name: 'Qi-Infused Fabric (one hand)', die: 'd4', damageType: 'slashing', traits, group: 'flail' }]);
    const saved = magus(3, before);
    const rebuilt = buildCharacter(deriveBuildFromCharacter(saved, after), after);
    const names = (rebuilt.naturalAttacks ?? []).map((n) => n.name);
    // batch P02: unfurling-brocade#two-handed-die
    expect(names).toContain('Qi-Infused Fabric (one hand)');
    expect(names).not.toContain('Old Fabric');
  });
});

/*
 * The guard distracting-spellstrike#description proposed: scripts/reprint-check.mjs CHECK 8 never saw
 * feats/distracting-spellstrike carrying the older printing (feat-2854) through an effect-backfill row,
 * because a near-identical reprint leaves the word-share margin under 0.05 (measured on the real pages:
 * own 0.951, old 1.000). The pages below are the printed feat-9053 sentence and the older one it
 * replaced, as the finding quotes them; the prose is what the backfill row wrote.
 */
describe('distracting-spellstrike: CHECK 8 sees a backfill-written legacy body inside the margin', () => {
  const own = 'Requirements You have a hand free, and your Spellstrike is charged. You weave distracting magic with one hand to enhance the efficacy of your Spellstrike. Make a Spellstrike and Feint against the target of your Strike. The Feint gains the arcane and visual traits, and it always has the basic effects of a Feint.';
  const old = "Requirements You're in Arcane Cascade stance and have a hand free. You weave distracting magic with one hand to enhance the efficacy of your Spellstrike. Make a Spellstrike and Feint against the target of your Strike. The Feint gains the arcane, illusion, and visual traits, and it always has the basic effects of a Feint.";
  const legacyRow = "**Requirements** You're in Arcane Cascade stance and have a hand free.\n\n---\n\nYou weave distracting magic with one hand to enhance the efficacy of your Spellstrike. Make a Spellstrike and Feint against the target of your Strike. The Feint gains the arcane, illusion, and visual traits, and it always has the basic effects of a Feint.";

  // batch P02: distracting-spellstrike#description
  it('distracting-spellstrike: the legacy body is judged verbatim, where the margin alone passed it', () => {
    const w = proseWords(legacyRow);
    // batch P02: distracting-spellstrike#description
    expect(wordShare(w, old)).toBe(1);
    expect(wordShare(w, old) - wordShare(w, own)).toBeLessThanOrEqual(0.25); // a short body: the gap is a handful of words
    expect(movedProseVerdict(legacyRow, own, [['feat-2854', old]])).toEqual({ kind: expect.stringMatching(/^(margin|verbatim)$/), best: 'feat-2854' });
  });

  // batch P02: distracting-spellstrike#description
  it('distracting-spellstrike: a body inside the 0.05 margin that the old page holds word for word is "verbatim"', () => {
    // 40 shared words, one only the old page has: own 40/41 = 0.976, old 1.000 — inside the margin.
    const shared = Array.from({ length: 40 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`).join(' ');
    const ownPage = `${shared} visual`;
    const oldPage = `${shared} illusion visual`;
    const prose = `${shared} illusion`;
    // batch P02: distracting-spellstrike#description
    expect(wordShare(proseWords(prose), oldPage) - wordShare(proseWords(prose), ownPage)).toBeLessThan(0.05);
    expect(movedProseVerdict(prose, ownPage, [['feat-2854', oldPage]])).toEqual({ kind: 'verbatim', best: 'feat-2854' });
  });

  // batch P02: distracting-spellstrike#description
  it('distracting-spellstrike: the printed feat-9053 body, and a body its own page holds whole, are clean', () => {
    // batch P02: distracting-spellstrike#description
    expect(movedProseVerdict(own, own, [['feat-2854', old]])).toBeNull();
    // Every word on BOTH pages: nothing says which printing it is, so it is not flagged.
    expect(movedProseVerdict('You weave distracting magic with one hand.', own, [['feat-2854', old]])).toBeNull();
  });

  // batch P02: distracting-spellstrike#description
  it('distracting-spellstrike: the margin reading CHECK 8 shipped with is unchanged', () => {
    // batch P02: distracting-spellstrike#description
    expect(movedProseVerdict('alpha bravo charlie delta echo', 'alpha zulu yankee xray whiskey', [['old-1', 'alpha bravo charlie delta echo']])).toEqual({ kind: 'margin', best: 'old-1' });
  });

  /* The baseline this reading shipped with holds records only, each "<own> reads like <old>", and the
   * record the guard was written for is NOT in it (its description row lands in this batch). */
  // batch P02: distracting-spellstrike#description
  it('distracting-spellstrike: is not grandfathered into the verbatim baseline', async () => {
    const { readFileSync } = await import('node:fs');
    const base = JSON.parse(readFileSync('scripts/data/moved-prose-verbatim-baseline.json', 'utf8')) as Record<string, string>;
    // batch P02: distracting-spellstrike#description
    expect(base['feats/distracting-spellstrike']).toBeUndefined();
    for (const [k, v] of Object.entries(base)) if (k !== '_') expect(v).toMatch(/^[a-z-]+-[\d-]+ reads like [a-z-]+-[\d-]+$/);
  });
});
