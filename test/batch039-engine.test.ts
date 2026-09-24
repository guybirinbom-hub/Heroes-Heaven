import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { critSpecSources, deriveStrike, strikeShowsCritSpec } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 039, WG-comparison lane — the ENGINE family (Arcane Cascade / Student of the Staff).
 *
 * Three readers widened, none of which any shipped record uses yet:
 *   - `strikeDamageRiders` now reads the ACTIVE STANCE's `strikeDamage` (StanceDef.strikeDamage);
 *   - a StrikeDamageRider may scale with `byWeaponSpecialization` {spec, greater};
 *   - a WeaponRider match may be gated `whileStance`.
 * Every row is PATCHED INTO A CONTENT COPY IN MEMORY (both sides of each comparison are copies), so no
 * test here flips when the driver lands the rows.
 */
const db = () => content();

function buildWith(dbase: ContentDatabase, level: number, over: Partial<BuildState> = {}): Character {
  const cls = dbase.classes.magus;
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'magus',
      ancestryId: 'human',
      backgroundId: Object.keys(dbase.backgrounds)[0],
      keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: 'twisting-tree',
      ...over,
    },
    dbase,
  );
}

/** A content copy with one top-level field set (undefined = stripped) on one record. */
function withField(bucket: 'feats' | 'stances', id: string, field: string, value: unknown, base = db()): ContentDatabase {
  const rec: Record<string, unknown> = { ...((base[bucket] ?? {}) as Record<string, object>)[id] };
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  return { ...base, [bucket]: { ...base[bucket], [id]: rec } } as ContentDatabase;
}

const strikeOf = (ch: Character, dbase: ContentDatabase, itemId: string) =>
  deriveStrike(ch, dbase, { instanceId: 'w', itemId, quantity: 1, equipped: true })!;

/* The rows this file pins, exactly as work/.b039-rows-engine.json emits them. */
const CASCADE_DAMAGE = [
  {
    type: 'force',
    appliesTo: 'melee',
    flat: 1,
    byWeaponSpecialization: { spec: 2, greater: 3 },
    note: 'Arcane Cascade',
  },
];
const STAFF_CRIT = { bases: ['staff'], traits: ['staff'] };
const STAFF_DEADLY = [
  { match: { items: ['staff'], whileStance: 'arcane-cascade' }, add: ['deadly-d6'] },
  { match: { anyTrait: ['staff'], whileStance: 'arcane-cascade' }, add: ['deadly-d6'] },
];

/* ============================================================================================ */

describe('magus stance arcane-cascade: the stance itself deals the extra force damage, scaling 1/2/3', () => {
  const withRow = () => withField('stances', 'arcane-cascade', 'strikeDamage', CASCADE_DAMAGE);
  const inStance = (dbase: ContentDatabase, level: number) => ({ ...buildWith(dbase, level), activeStance: 'arcane-cascade' });

  // batch 039: magus#arcane-cascade-mode
  it('magus in Arcane Cascade: +1 force at 1st, 2 with weapon specialization (7th), 3 with greater (15th)', () => {
    /* action-4261: "your melee Strikes … deal 1 extra force damage … If you have the weapon
     * specialization class feature, the damage and resistance increase to 2, and if you have greater
     * weapon specialization, they increase to 3." */
    const d = withRow();
    expect(strikeOf(inStance(d, 1), d, 'staff').damage).toMatch(/plus 1 force/);
    expect(strikeOf(inStance(d, 7), d, 'staff').damage).toMatch(/plus 2 force/);
    expect(strikeOf(inStance(d, 15), d, 'staff').damage).toMatch(/plus 3 force/);
  });

  // batch 039: magus#arcane-cascade-mode
  it('magus in Arcane Cascade: melee only, and nothing without the stance or without the row', () => {
    const d = withRow();
    // "your MELEE Strikes"
    expect(strikeOf(inStance(d, 7), d, 'shortbow').damage).not.toMatch(/force/);
    // out of the stance
    expect(strikeOf(buildWith(d, 7), d, 'staff').damage).not.toMatch(/force/);
    // the field stripped: the stance alone carries nothing
    const bare = withField('stances', 'arcane-cascade', 'strikeDamage', undefined);
    expect(strikeOf(inStance(bare, 7), bare, 'staff').damage).not.toMatch(/force/);
  });
});

describe('arcane-cascade: ONE carrier — the stance chip alone, with no mode and no class-resource toggle', () => {
  // batch 039: arcane-cascade#duplicate-toggles
  it('arcane-cascade entered only through activeStance delivers the damage with activeModes empty', () => {
    /* action-4261: "You can enter a special stance …" — Character.activeStance is what the stance chip
     * sets. Neither cat-arcane-cascade (Modes) nor classResources.magus 'arcane-cascade' is on. */
    const d = withField('stances', 'arcane-cascade', 'strikeDamage', CASCADE_DAMAGE);
    const ch = { ...buildWith(d, 1), activeStance: 'arcane-cascade', activeModes: [], classResources: {} };
    expect(ch.activeModes).toEqual([]);
    expect(strikeOf(ch, d, 'staff').damage).toMatch(/plus 1 force/);
  });
});

/* ============================================================================================ */

describe('feats/student-of-the-staff: a MAGIC staff is a staff', () => {
  const student = (dbase: ContentDatabase, stance?: string) => ({
    ...buildWith(dbase, 4, { featPicks: { '4:class': 'student-of-the-staff' } } as Partial<BuildState>),
    ...(stance ? { activeStance: stance } : {}),
  });

  // batch 039: student-of-the-staff#magic-staves
  it('student-of-the-staff critSpecWeapons with traits:[staff] reaches Staff of Fire, not only the plain staff', () => {
    /* feat-9060: "When you critically succeed at an attack roll using a staff, you can apply the
     * critical specialization effect of the club group." items/staff-of-fire carries the `staff` trait
     * and no link to the plain `staff` id, which is why `bases` alone never reached it. */
    const before = withField('feats', 'student-of-the-staff', 'critSpecWeapons', { bases: ['staff'] });
    const after = withField('feats', 'student-of-the-staff', 'critSpecWeapons', STAFF_CRIT);
    const chB = student(before);
    const chA = student(after);
    expect(chA.feats.map((f) => f.featId)).toContain('student-of-the-staff');
    const shows = (ch: Character, d: ContentDatabase, id: string) => strikeShowsCritSpec(strikeOf(ch, d, id), critSpecSources(ch, d), ch);
    expect(shows(chB, before, 'staff-of-fire')).toBe(false);
    expect(shows(chA, after, 'staff-of-fire')).toBe(true);
    expect(shows(chA, after, 'staff')).toBe(true);
  });

  // batch 039: student-of-the-staff#magic-staves
  it('student-of-the-staff: deadly d6 on the plain AND the magic staff while in Arcane Cascade, and only then', () => {
    /* feat-9060: "While you're in Arcane Cascade stance, your staff gains the deadly d6 trait". */
    const d = withField('feats', 'student-of-the-staff', 'weaponTraits', STAFF_DEADLY);
    const inStance = student(d, 'arcane-cascade');
    const out = student(d);
    for (const id of ['staff', 'staff-of-fire']) {
      expect(strikeOf(inStance, d, id).traits).toContain('deadly-d6');
      expect(strikeOf(out, d, id).traits).not.toContain('deadly-d6');
    }
    // A magus WITHOUT the feat gains nothing for entering the stance.
    const noFeat = { ...buildWith(d, 4), activeStance: 'arcane-cascade' };
    expect(strikeOf(noFeat, d, 'staff-of-fire').traits).not.toContain('deadly-d6');
  });
});
