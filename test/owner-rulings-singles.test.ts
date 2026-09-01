import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';
import { FEAT_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Single owner rulings from The Rulings Desk, 2026-08-27. Each of these was a WG-vs-print divergence
 * the owner resolved as "ours — the printed rule". The ruling's protection is these assertions on
 * BUILT characters: a later edit drifting toward WG's encoding (or deleting the mechanic) fails here
 * instead of resurfacing as a parity finding batches later.
 *
 * Siblings already guarded elsewhere: the Summiting Dragonblood climb formula (20 or +5) in
 * speed-increases.test.ts, its exemplar restriction in draconic-exemplar.test.ts, and the whole
 * Circle of Spirits pool formula in bespoke-tail.test.ts.
 */

describe('ruling #1 — Backup Runic Enhancement follows its printed sentence', () => {
  /*
   * Printed: *"You can cast the sigil cantrip as an innate spell at will. In addition, choose either
   * runic body or runic weapon. You can cast this spell once per day as an innate spell. The rank of
   * these spells is equal to half your level, rounded up."*
   *
   * WG's dump holds two versions of this record and they disagree with each other AND the print (both
   * named spells at once with the rank pinned to 1 / a choice granted as an ordinary known spell).
   * The ruling: exactly one of the two, as a 1/day innate, at ceil(level/2).
   */
  const runesmith = (pick: string) =>
    build('runesmith', 6, {
      featPicks: { '2:class:0': 'backup-runic-enhancement' },
      effectChoices: { 'backup-runic-enhancement:backup-runic-spell': pick },
    } as Partial<BuildState>);

  it.each(['runic-body', 'runic-weapon'])('%s: sigil at will + the chosen spell at ceil(level/2)', (pick) => {
    const ch = runesmith(pick);
    expect(ch.feats.some((f) => f.featId === 'backup-runic-enhancement'), 'the feat must actually be taken').toBe(true);
    const innate = ch.spellcasting?.find((e) => e.type === 'innate');
    expect(innate?.cantrips, 'sigil is an at-will innate cantrip').toContain('sigil');
    /* The innate entry files each spell under the rank it is cast at, so the rank IS the key. */
    const at = Object.entries(innate?.repertoire ?? {}).find(([, ids]) => ids.includes(pick));
    expect(at, `${pick} should be castable`).toBeTruthy();
    expect(Number(at![0]), 'half your level, rounded up (level 6 → 3rd)').toBe(3);
  });

  it('grants exactly ONE of the two named spells, never both', () => {
    const rep = Object.values(runesmith('runic-body').spellcasting?.find((e) => e.type === 'innate')?.repertoire ?? {}).flat();
    expect(rep).toContain('runic-body');
    expect(rep, 'WG granted both at once; the print says choose either').not.toContain('runic-weapon');
  });
});

describe('ruling #6 — Summiting Dragonblood also brings Combat Climber', () => {
  /* The climb Speed (20, or +5 if you have one) and the exemplar restriction have their own guards;
   * the feat grant is the one leg that did not. */
  it('the grant table carries it', () => {
    expect(FEAT_FEAT_GRANTS['summiting-dragonblood']).toEqual(['combat-climber']);
  });
});

describe('ruling #8 — Monastic Archer Stance trains the printed bows, not the bow group', () => {
  /*
   * Printed Special: *"you become trained in the longbow, shortbow, and any simple and martial bows
   * with the monk trait. If you gain the expert strikes class feature, your proficiency rank for these
   * weapons increases to expert, and if you gain the master strikes class feature… to master."*
   *
   * WG sets the whole bow GROUP to trained — 32 weapons including composite bows and the advanced
   * daikyu — and never raises it. The ruling: exactly the seven printed weapons, mirroring the
   * character's best weapon category so expert/master strikes carry them along.
   */
  const SEVEN = ['longbow', 'shortbow', 'gakgung', 'bow-staff', 'bow-staff-ranged', 'mikazuki', 'mikazuki-ranged'];
  const monk = (level: number) =>
    build('monk', level, { featPicks: { '1:class:0': 'monastic-archer-stance' } } as Partial<BuildState>);

  it('the grant is the seven-weapon list with mirrorBestCategory, exactly', () => {
    const wf = FEAT_GRANTS['monastic-archer-stance']?.weaponFamiliarity;
    const one = Array.isArray(wf) ? wf[0] : wf;
    expect([...(one?.weapons ?? [])].sort()).toEqual([...SEVEN].sort());
    expect(one?.mirrorBestCategory).toBe(true);
  });

  it.each([
    [1, 'trained'],
    [5, 'expert'], // expert strikes
    [13, 'master'], // master strikes
  ] as const)('at monk level %i the seven bows are %s', (level, rank) => {
    const ch = monk(level);
    expect(ch.feats.some((f) => f.featId === 'monastic-archer-stance'), 'the feat must actually be taken').toBe(true);
    for (const w of SEVEN) expect(ch.proficiencies.weaponOverrides?.[w], w).toBe(rank);
  });

  it('the rest of the bow group stays out — their over-grant is the divergence that was ruled on', () => {
    const wo = monk(5).proficiencies.weaponOverrides ?? {};
    for (const w of ['composite-longbow', 'composite-shortbow', 'daikyu']) {
      expect(wo[w] ?? 'untrained', `${w} is bow-group but not printed`).toBe('untrained');
    }
  });
});
