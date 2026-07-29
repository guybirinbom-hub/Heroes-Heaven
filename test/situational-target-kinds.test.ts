import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FEAT_SITUATIONAL, featSituationalFor, type SituationalTarget } from '../src/rules/situationalBonuses';

/**
 * THE STORAGE/DISPLAY DRIFT GUARD.
 *
 * The situational classification pass produced 338 verified bonuses that could not be stored, because
 * `SituationalTarget.kind` was authored from the DISPLAY vocabulary (`StatRef`) rather than agreed
 * with it: the registry accepted only skill|save|perception|ac|attack while the data needed
 * strikeDamage, speed, spell, hp, classDc and ability. Applying it blind would have dropped them
 * silently.
 *
 * These tests make that class of mistake fail the build instead of the data:
 *   1. every kind the union admits must actually MATCH its StatRef (no write-only kinds), and
 *   2. every kind must be spelled the same in both files.
 */
describe('situational target kinds stay in sync with StatRef', () => {
  /** One representative StatRef per registry kind. `attack` is the legacy alias for `strikeAttack`. */
  const REF_FOR: Record<string, { kind: string; skill?: string; save?: string; which?: string; ability?: string }> = {
    skill: { kind: 'skill', skill: 'athletics' },
    save: { kind: 'save', save: 'fortitude' },
    perception: { kind: 'perception' },
    ac: { kind: 'ac' },
    attack: { kind: 'strikeAttack' },
    strikeAttack: { kind: 'strikeAttack' },
    strikeDamage: { kind: 'strikeDamage' },
    speed: { kind: 'speed' },
    hp: { kind: 'hp' },
    classDc: { kind: 'classDc' },
    spell: { kind: 'spell', which: 'dc' },
    // Distinct from `spell`: that is the spell attack roll and the DC, this is the damage a spell deals.
    spellDamage: { kind: 'spellDamage' },
    ability: { kind: 'ability', ability: 'str' },
  };

  /** The kinds the union declares, read from source so the test can't drift from the type. */
  const declaredKinds = (): string[] => {
    const src = readFileSync(new URL('../src/rules/situationalBonuses.ts', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('kind:'), src.indexOf('detail?:'));
    return [...block.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  };

  it('every declared kind has a representative StatRef in this test', () => {
    // If this fails someone widened the union without deciding how the new kind is displayed.
    for (const k of declaredKinds()) expect(REF_FOR[k], `no StatRef mapped for kind '${k}'`).toBeTruthy();
  });

  it('every declared kind MATCHES its StatRef — no write-only kinds', () => {
    for (const k of declaredKinds()) {
      const target = { kind: k, detail: k === 'skill' ? 'athletics' : k === 'save' ? 'fortitude' : undefined } as SituationalTarget;
      const reg = { __probe: [{ targets: [target], when: 'test', bonus: '+1 circumstance' }] };
      const hits = featSituationalForIn(reg, '__probe', REF_FOR[k]);
      expect(hits.length, `kind '${k}' can be stored but never matches its StatRef`).toBe(1);
    }
  });

  it('a kind never matches an unrelated StatRef', () => {
    const reg = { __probe: [{ targets: [{ kind: 'speed' } as SituationalTarget], when: 't', bonus: '+5' }] };
    expect(featSituationalForIn(reg, '__probe', { kind: 'ac' })).toHaveLength(0);
    expect(featSituationalForIn(reg, '__probe', { kind: 'speed' })).toHaveLength(1);
  });

  it('the shipped registry only uses kinds the union declares', () => {
    const allowed = new Set(declaredKinds());
    const bad: string[] = [];
    for (const [id, list] of Object.entries(FEAT_SITUATIONAL))
      for (const b of list) for (const t of b.targets) if (!allowed.has(t.kind)) bad.push(`${id} -> ${t.kind}`);
    expect(bad, `registry entries with an undeclared kind: ${bad.slice(0, 5).join(', ')}`).toHaveLength(0);
  });
});

/** featSituationalFor reads the module-level registry, so probe through a temporary override. */
function featSituationalForIn(
  reg: Record<string, { targets: SituationalTarget[]; when: string; bonus: string }[]>,
  id: string,
  ref: { kind: string; skill?: string; save?: string; which?: string; ability?: string },
) {
  const saved = FEAT_SITUATIONAL[id];
  (FEAT_SITUATIONAL as Record<string, unknown>)[id] = reg[id];
  try {
    return featSituationalFor([id], ref);
  } finally {
    if (saved === undefined) delete (FEAT_SITUATIONAL as Record<string, unknown>)[id];
    else (FEAT_SITUATIONAL as Record<string, unknown>)[id] = saved;
  }
}
