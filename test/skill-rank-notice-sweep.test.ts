import { describe, expect, it } from 'vitest';
import { loadEngine } from '../scripts/blocks-parity-snapshot.mjs';
import { buildCharacter, skillOrderLegacyOf, type BuildState } from '../src/rules/build';
import { skillOrderChanges } from '../src/rules/skillOrderNotice';
import type { Character } from '../src/rules/types';
import { unstamped } from './fixtures/skill-order-cases';

/**
 * THE SKILL-ORDER NOTICE SAYS NOTHING WHEN NOTHING CHANGED, AND SOMETHING WHEN SOMETHING DID (skill-order plan
 * work/skill-rank-level-by-level/plan.md 3.3, WP9; ruling 3 of 2026-10-21: "Show a Builder notice that names what
 * changed on that character; say nothing when nothing changed").
 *
 * The node-environment half of test/skill-rank-notice.test.tsx (the parity instrument refuses jsdom's URL). Every
 * character of the parity snapshot, at both trust gates, read as an OLD save (no `skillOrder` stamp):
 *   - outside the `skillorder:` family (whose cases are built to show the changes), the notice is silent, except
 *     the EXACT `NOISY` list below — each entry a real change the old order hid, classified in
 *     work/skill-rank-level-by-level/state.md (WP9). A new noisy character turns this red; so does a listed one
 *     going quiet (remove its entry);
 *   - for EVERY character, when the old order's ranks, replacement picks or rank-gated feats differ from the
 *     character's, the notice is not silent (a change it would hide).
 */

/** Characters outside the skill-order family whose notice is not silent, with the line kinds it shows. */
const NOISY: Record<string, string[]> = {
  // fighter 4, Medic Dedication at 2nd (prerequisite "trained in Medicine"), the Medicine increase at 3rd, no old
  // entry (the #none twin). The old order spent the increase first (untrained → trained) and the dedication then
  // made Medicine expert; level by level the dedication comes first (expert at 2nd), so the 3rd-level increase is
  // wasted (line 5) and the dedication's prerequisite is only met at 3rd (line 6, D5). Medicine ends expert both
  // ways, so the parity compare shows no move. The twin WITH the old "=" Medicine untrained is silent (the old slot
  // swallowed the increase both ways, plan D3).
  'overrides:lowered-raise:fighter-L4#none': ['increase', 'prerequisite'],
};

const ranks = (s: Record<string, string>) =>
  Object.entries(s)
    .filter(([, r]) => r !== 'untrained')
    .map(([k, r]) => `${k}:${r}`)
    .sort()
    .join(',');
const fbs = (l: NonNullable<Character['skillFallbacks']>) => l.map((f) => `${f.featId}:${f.skill}:${f.slot ?? ''}`).sort().join(',');

describe('the skill-order notice over every snapshot character (WP9)', () => {
  it('silent outside the skill-order family except the exact NOISY list; never silent over a change', async () => {
    const E = await loadEngine();
    expect(E.buildCharacter, 'the engine and this test share one build module').toBe(buildCharacter);
    const noisy: Record<string, string> = {};
    const hidden: string[] = [];
    let checked = 0;
    let familyNoisy = 0;
    try {
      for (const gate of ['off', 'on'] as const) {
        E.setGate(gate);
        for (const s of E.specs as { id: string; build: BuildState; dbPatch?: (db: unknown) => unknown }[]) {
          const db = (s.dbPatch ? s.dbPatch(E.DB[gate]) : E.DB[gate]) as Parameters<typeof skillOrderChanges>[1];
          const build = unstamped(s.build);
          const lines = skillOrderChanges(build, db);
          checked++;
          if (s.id.startsWith('skillorder:')) {
            if (lines.length) familyNoisy++;
          } else if (lines.length) noisy[`${s.id}@${gate}`] = lines.map((l) => l.kind).join(',');
          if (lines.length) continue;
          // Silent: the old order must have given exactly what the character shows.
          let c: Character;
          try {
            c = buildCharacter(build, db);
          } catch {
            continue; // no character, no notice (the Builder still opens)
          }
          const L = skillOrderLegacyOf(c);
          if (!L) continue;
          const gated = c.feats.filter((f) => f.grantedBy && (E.FEAT_RANK_FEAT_GRANTS[f.grantedBy] ?? []).some((e: { feat: string }) => e.feat === f.featId)).map((f) => `${f.grantedBy}>${f.featId}`).sort().join(',');
          if (ranks(L.skills) !== ranks(c.proficiencies.skills as Record<string, string>)) hidden.push(`${s.id}@${gate}: ranks`);
          if (fbs(L.skillFallbacks) !== fbs(c.skillFallbacks ?? [])) hidden.push(`${s.id}@${gate}: replacement picks`);
          if ([...L.rankGated].sort().join(',') !== gated) hidden.push(`${s.id}@${gate}: rank-gated feats`);
        }
      }
    } finally {
      E.clearTrustGate();
    }
    expect(checked, 'every snapshot character at both gates').toBeGreaterThan(4000);
    expect(familyNoisy, 'the skill-order family really shows notices (the sweep is not vacuous)').toBeGreaterThan(40);
    const want: Record<string, string> = {};
    for (const [id, kinds] of Object.entries(NOISY)) for (const g of ['off', 'on']) want[`${id}@${g}`] = kinds.join(',');
    expect(noisy).toEqual(want);
    expect(hidden).toEqual([]);
  }, 600_000);
});
