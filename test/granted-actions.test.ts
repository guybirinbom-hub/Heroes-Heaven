import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { archetypeFeatCounts, deriveDefenses } from '../src/rules/derive';

/**
 * Two lanes that made passive records finally do something:
 *
 *  • `grantsActions` — "you also gain the Warding Shift action". The encounter list is built from
 *    records that ARE an action, so a passive record granting one contributed nothing. This hid the
 *    barbarian's Rage, the magus's Spellstrike, the ranger's Hunt Prey and Reactive Strike, every one
 *    of which is a PASSIVE class feature here and a 1-action record in content.actions.
 *
 *  • `@actor.archetypeFeats.<id>` — the imported data spelled "your number of archetype class feats
 *    from the Hellknight archetype" as a Foundry flag path no token could match, so all seven records
 *    carrying one resolved to 0.
 */
describe('grantsActions', () => {
  it('names an action record that exists and is actually an action', () => {
    const c = content();
    const buckets = ['feats', 'classFeatures', 'heritages', 'backgrounds'] as const;
    const costs = new Set(['actions', 'reaction', 'free', 'variable']);
    let n = 0;
    for (const bucket of buckets) {
      for (const rec of Object.values(c[bucket] as Record<string, { grantsActions?: string[]; name: string }>)) {
        for (const id of rec.grantsActions ?? []) {
          const act = c.actions[id];
          expect(act, `${rec.name} grants missing action ${id}`).toBeTruthy();
          expect(costs.has(act!.actionCost?.type ?? ''), `${id} is not an action`).toBe(true);
          n++;
        }
      }
    }
    // The sweep found 158. A regeneration that loses the backfill would drop this to 0.
    expect(n).toBeGreaterThanOrEqual(150);
  });

  it("covers the class features that ARE the class's signature action", () => {
    const c = content();
    for (const [feature, action] of [
      ['rage', 'rage'],
      ['spellstrike', 'spellstrike'],
      ['hunt-prey', 'hunt-prey'],
      ['reactive-strike', 'reactive-strike'],
      ['quick-alchemy', 'quick-alchemy'],
      ['devise-a-stratagem', 'devise-a-stratagem'],
      ['taunt', 'taunt'],
    ] as const) {
      // Each is passive as a class FEATURE and a real action in content.actions — which is exactly
      // why the encounter list had none of them.
      expect(c.classFeatures[feature]?.actionCost?.type).toBe('passive');
      expect(c.classFeatures[feature]?.grantsActions).toContain(action);
    }
  });

  it('gives Hellknight-Errant the Warding Shift action', () => {
    expect(content().feats['hellknight-errant']?.grantsActions).toEqual(['warding-shift']);
    expect(content().actions['warding-shift']?.actionCost?.type).toBe('actions');
  });
});

describe('archetype feat count', () => {
  const hellknight = (level: number, picks: Record<string, string>) =>
    build('fighter', level, { featPicks: picks });

  it('counts the feats of one archetype, dedication included', () => {
    const c = hellknight(6, { '2:class:0': 'hellknight-dedication' });
    expect(archetypeFeatCounts(c, content()).hellknight).toBe(1);
  });

  it('resolves Hellknight Dedication resistance to 1 + that count (was 0)', () => {
    const c = hellknight(6, { '2:class:0': 'hellknight-dedication' });
    const d = deriveDefenses(c, content());
    expect(d.resistances.find((r) => r.type === 'mental')?.value).toBe(2);
  });

  it('Hellknight-Errant raises it to 5 + the count', () => {
    const c = hellknight(6, { '2:class:0': 'hellknight-dedication', '6:class:0': 'hellknight-errant' });
    expect(archetypeFeatCounts(c, content()).hellknight).toBe(2);
    const d = deriveDefenses(c, content());
    // 5 + 2 wins the per-type max over the dedication's own 1 + 2.
    expect(d.resistances.find((r) => r.type === 'mental')?.value).toBe(7);
  });
});
