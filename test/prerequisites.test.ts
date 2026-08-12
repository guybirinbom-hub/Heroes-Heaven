import { describe, it, expect } from 'vitest';
import { checkPrerequisites } from '../src/rules/build';
import type { Character } from '../src/rules/types';
import { content, build } from './_content';

describe('checkPrerequisites', () => {
  it('never throws across every imported feat', () => {
    const ch = build('fighter', 20);
    let crashes = 0;
    for (const f of Object.values(content().feats)) {
      try {
        checkPrerequisites(f, ch, content());
      } catch {
        crashes++;
      }
    }
    expect(crashes).toBe(0);
  });

  it('enforces a skill-rank prerequisite (expert in Medicine)', () => {
    const feats = Object.values(content().feats);
    const medFeat = feats.find((f) => f.prerequisites?.some((p) => /expert in medicine/i.test(p)));
    expect(medFeat).toBeTruthy();
    if (!medFeat) return;
    // A level-1 cleric is at most trained in Medicine -> blocked.
    const trained = build('cleric', 1, { classSkills: ['medicine'] });
    expect(checkPrerequisites(medFeat, trained, content()).met).toBe(false);
  });

  it('does not block a feat with no prerequisites', () => {
    const ch = build('fighter', 5);
    const open = Object.values(content().feats).find((f) => !f.prerequisites?.length);
    expect(open).toBeTruthy();
    if (open) expect(checkPrerequisites(open, ch, content()).met).toBe(true);
  });

  it('multi-ability dedication prereqs are AND, except Fighter/Monk which are OR', () => {
    const base = build('fighter', 5);
    const feats = content().feats;
    // Only Strength meets +2; Dex/Con/Cha are +0.
    const strOnly = { ...base, abilities: { str: 18, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } };
    // Fighter/Monk Dedication = "Strength or Dexterity": Strength alone satisfies it.
    expect(checkPrerequisites(feats['fighter-dedication'], strOnly, content()).met).toBe(true);
    expect(checkPrerequisites(feats['monk-dedication'], strOnly, content()).met).toBe(true);
    // Barbarian (Str AND Con), Champion (Str AND Cha), Swashbuckler (Cha AND Dex): one stat isn't enough.
    expect(checkPrerequisites(feats['barbarian-dedication'], strOnly, content()).met).toBe(false);
    expect(checkPrerequisites(feats['champion-dedication'], strOnly, content()).met).toBe(false);
    expect(checkPrerequisites(feats['swashbuckler-dedication'], strOnly, content()).met).toBe(false);
    // Meeting BOTH halves of the AND satisfies it.
    const strCon = { ...base, abilities: { str: 18, dex: 10, con: 18, int: 10, wis: 10, cha: 10 } };
    expect(checkPrerequisites(feats['barbarian-dedication'], strCon, content()).met).toBe(true);
  });
});

/**
 * A choice ANSWER as an eligibility token.
 *
 * Magaambyan Attendant Dedication asks which branch you affiliate with, and nine feats print
 * "<Branch> affiliation". `checkPrerequisites` resolves a prerequisite line to a feat id and ignored
 * anything that did not match one, so the affiliation line was unenforced: every branch feat was
 * offered to every attendant. Measured before the fix — all 8 feats printing an affiliation line came
 * back met for all 5 branches.
 */
describe('choice answers as eligibility tokens', () => {
  /** Every record type build.ts's TOKEN_BUCKETS collects from. Walked independently here so a change
   *  to that list without a matching change to the collector shows up as a test failure, not a
   *  silently inert declaration. */
  const TOKEN_BUCKETS = ['feats', 'classFeatures', 'heritages', 'backgrounds'] as const;
  const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  const declared = () => {
    const out = new Set<string>();
    for (const bucket of TOKEN_BUCKETS)
      for (const rec of Object.values((content() as unknown as Record<string, Record<string, { choice?: { options?: { grantsToken?: string }[] } }>>)[bucket] ?? {}))
        for (const o of rec?.choice?.options ?? []) if (o.grantsToken) out.add(norm(o.grantsToken));
    return out;
  };

  /** The feats whose prerequisites name a declared token, and which token each needs. */
  const tokenGated = () => {
    const d = declared();
    return Object.values(content().feats)
      .map((f) => ({ id: f.id, lines: (f.prerequisites ?? []).filter((l) => d.has(norm(l))) }))
      .filter((e) => e.lines.length > 0);
  };

  /** A level-12 attendant who took the dedication in the level-2 class slot, with `branch` answered.
   *  Cached: `build()` runs the whole builder, and these tests want the same six characters many
   *  times over — rebuilding per assertion is what timed this file out under full-suite load. */
  const attendantCache = new Map<string, Character>();
  const attendant = (branch: string | null): Character => {
    const key = branch ?? '(none)';
    let ch = attendantCache.get(key);
    if (!ch) {
      ch = build('wizard', 12, {
        featPicks: { '2:class:0': 'magaambyan-attendant-dedication' },
        featChoices: branch ? { '2:class:0': branch } : {},
      });
      attendantCache.set(key, ch);
    }
    return ch;
  };

  const BRANCH_OF: Record<string, string> = {
    'cascade-bearers-flexibility': 'cascade-bearers',
    'cascade-bearers-spellcasting': 'cascade-bearers',
    'emerald-boughs-accustomation': 'emerald-boughs',
    'emerald-boughs-hideaway': 'emerald-boughs',
    'rain-scribe-sustenance': 'rain-scribes',
    'rain-scribe-mobility': 'rain-scribes',
    'tempest-sun-redirection': 'tempest-sun-mages',
    'uzunjati-storytelling': 'uzunjati',
  };

  it('the dedication declares one token per branch, and every branch feat is covered', () => {
    const dedication = content().feats['magaambyan-attendant-dedication'];
    const tokens = (dedication.choice?.options ?? []).map((o) => o.grantsToken);
    expect(tokens.filter(Boolean)).toHaveLength(5);
    // The gate only bites on lines somebody declared, so a typo on either end is silent — pin both.
    expect(tokenGated().map((e) => e.id).sort()).toEqual(Object.keys(BRANCH_OF).sort());
  });

  it('a branch feat is offered to that branch and blocked for the other four', () => {
    for (const [featId, ownBranch] of Object.entries(BRANCH_OF)) {
      const feat = content().feats[featId];
      expect(feat, featId).toBeTruthy();
      for (const branch of ['cascade-bearers', 'emerald-boughs', 'rain-scribes', 'tempest-sun-mages', 'uzunjati']) {
        const unmet = checkPrerequisites(feat, attendant(branch), content()).unmet;
        const blocked = unmet.some((l) => /affiliation$/i.test(l));
        expect(blocked, `${featId} @ ${branch}`).toBe(branch !== ownBranch);
      }
    }
  });

  it('the branch feats are the ONLY feats a token gates, and only for the wrong answer', () => {
    const d = declared();
    const db = content();
    const all = Object.values(db.feats);
    const tokenBlocked = (branch: string | null) => {
      const ch = attendant(branch);
      return all.filter((f) => checkPrerequisites(f, ch, db).unmet.some((l) => d.has(norm(l)))).map((f) => f.id).sort();
    };
    // No answer at all: all eight are blocked — the honest reading of "you have no affiliation".
    expect(tokenBlocked(null)).toEqual(Object.keys(BRANCH_OF).sort());
    // With an answer, exactly that branch's feats come off the list and nothing else joins it.
    for (const branch of new Set(Object.values(BRANCH_OF)))
      expect(tokenBlocked(branch), branch).toEqual(
        Object.entries(BRANCH_OF).filter(([, b]) => b !== branch).map(([id]) => id).sort(),
      );
  });

  it('picking a branch grants exactly one token, and a lone dedication grants none', () => {
    expect(attendant('rain-scribes').choiceTokens).toEqual(['Rain-Scribes affiliation']);
    expect(attendant(null).choiceTokens).toBeUndefined();
    // A character with no Magaambya connection at all must not pick tokens up from anywhere.
    expect(build('fighter', 12).choiceTokens ?? []).toEqual([]);
  });

  it('a prerequisite line nobody declared stays permissive', () => {
    // The dedication's own "member of the Magaambya of attendant rank" is unparseable prose. Making
    // unmatched lines blocking would gate hundreds of feats on strings the app cannot read, so the
    // default must stay permissive — this is the invariant the whole lane rests on.
    const ded = content().feats['magaambyan-attendant-dedication'];
    const ch = build('wizard', 12, { classSkills: ['arcana'] });
    expect(checkPrerequisites(ded, ch, content()).unmet).toEqual([]);
  });

  it('no declared token collides with the ability or proficiency-rank patterns', () => {
    // The token check runs FIRST, so a token spelled like "trained in Society" would shadow the rank
    // check for every feat printing that line. Nothing in the data should ever be authored that way.
    for (const t of declared()) {
      expect(t, t).not.toMatch(/^(strength|dexterity|constitution|intelligence|wisdom|charisma) \d+$/);
      expect(t, t).not.toMatch(/^(trained|expert|master|legendary) /);
    }
  });
});
