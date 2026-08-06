import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveInitiative, INITIATIVE_SKILLS } from '../src/rules/initiative';
import { derivePerception, deriveSkill } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';

/**
 * Initiative had no statistic of its own: it was rolled with Perception, shown nowhere, and all ~47
 * of its bonuses were filed under `{kind: 'perception'}` for want of anywhere else — including
 * Incredible Initiative, which prints "whatever statistic you roll for initiative".
 */
const db = content();
const rogue = (initiativeSkill?: string) => build('rogue', 10, { ...(initiativeSkill ? { initiativeSkill } : {}) } as never);

describe('initiative is rolled with Perception by default', () => {
  it('matches Perception exactly when unset', () => {
    const c = rogue();
    const init = deriveInitiative(c, db);
    expect(init.stat).toBe('perception');
    expect(init.label).toBe('Perception');
    expect(init.modifier).toBe(derivePerception(c, db).modifier);
    expect(init.rank).toBe(derivePerception(c, db).rank);
  });
});

describe('…and with a skill when the character rolls it with one', () => {
  it('takes that skill’s modifier and rank', () => {
    const c = rogue('stealth');
    const init = deriveInitiative(c, db);
    expect(init.stat).toBe('stealth');
    expect(init.label).toBe('Stealth');
    expect(init.modifier).toBe(deriveSkill(c, 'stealth', db).modifier);
    // A rogue's Stealth is better than their Perception, so this is a real difference, not a tie.
    expect(init.modifier).not.toBe(derivePerception(c, db).modifier);
  });

  it('offers only skills with a printed initiative use, not every skill', () => {
    // Offering all twenty-odd, Lores included, would turn a rules-supported choice into a free pick
    // of your best number.
    expect(INITIATIVE_SKILLS).toContain('stealth');
    expect(INITIATIVE_SKILLS).toContain('deception');
    expect(INITIATIVE_SKILLS).not.toContain('crafting');
    expect(INITIATIVE_SKILLS.some((s) => s.startsWith('lore:'))).toBe(false);
  });

  it('the choice round-trips through the build', () => {
    expect(rogue('deception').initiativeSkill).toBe('deception');
    expect(rogue().initiativeSkill).toBeUndefined();
  });
});

describe('the bonuses follow the right statistic', () => {
  it('stat-agnostic ones moved to initiative; Perception-specific ones did not', () => {
    let agnosticOnInit = 0;
    let percSpecific = 0;
    for (const entries of Object.values(FEAT_SITUATIONAL)) {
      for (const e of entries) {
        if (!/initiative/i.test(e.when ?? '')) continue;
        const kinds = e.targets.map((t) => t.kind);
        const namesPerception = /perception/i.test(e.when ?? '') && !/whatever statistic/i.test(e.when ?? '');
        if (namesPerception) {
          // "on Perception checks rolled for initiative" only applies while you roll Perception.
          expect(kinds, e.when).toContain('perception');
          percSpecific++;
        } else if (kinds.includes('initiative')) {
          agnosticOnInit++;
        }
      }
    }
    expect(agnosticOnInit).toBeGreaterThanOrEqual(30);
    expect(percSpecific).toBeGreaterThanOrEqual(10);
  });

  it('Incredible Initiative applies whatever you roll — it says so', () => {
    const e = FEAT_SITUATIONAL['incredible-initiative'];
    expect(e, 'incredible-initiative is not in the registry').toBeTruthy();
    expect(e[0].targets.map((t) => t.kind)).toContain('initiative');
  });
});

describe('the breakdown', () => {
  it('delegates to whatever statistic is rolled, so the two cannot drift', () => {
    const c = rogue('stealth');
    const e = explainStat(c, db, { kind: 'initiative' });
    expect(e.title).toBe('Initiative');
    expect(e.subtitle).toMatch(/Stealth/i);
    expect(e.totalText).toBe(explainStat(c, db, { kind: 'skill', skill: 'stealth' }).totalText);
  });

  it('a Perception-filed initiative bonus still reaches the row', () => {
    // They were only ever on Perception as a workaround; moving the row must not lose them.
    const c = rogue();
    const e = explainStat(c, db, { kind: 'initiative' });
    expect(e.subtitle).toMatch(/Perception/i);
    expect(e.totalText).toBe(explainStat(c, db, { kind: 'perception' }).totalText);
  });
});
