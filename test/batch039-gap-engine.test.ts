import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveStrike } from '../src/rules/derive';
import { resourcesForCharacter } from '../src/rules/classResources';
import { modeRelevant } from '../src/rules/modes';
import { applyTrustGate, clearTrustGate, TRUST_LEDGER, trustOff } from '../src/data/trustGate';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 039, WG-comparison lane — GAP stage for the ENGINE family.
 *
 * The engine builder made the Arcane Cascade stance able to carry its own damage (StanceDef.strikeDamage)
 * and Student of the Staff's deadly die (a feat weaponTraits rider gated whileStance). What was left:
 *   - the duplicate switches (classResources magus 'arcane-cascade', modes cat-arcane-cascade,
 *     modes cat-student-of-the-staff) — the stance chip is now the one switch;
 *   - the trust gate did not know a stance could carry `strikeDamage`.
 * Every row is PATCHED INTO A CONTENT COPY IN MEMORY, so nothing here flips when the driver applies them.
 */
const db = () => content();

function magus(dbase: ContentDatabase, level: number, over: Partial<BuildState> = {}): Character {
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

function withField(bucket: 'feats' | 'stances', id: string, field: string, value: unknown, base = db()): ContentDatabase {
  const rec: Record<string, unknown> = { ...((base[bucket] ?? {}) as Record<string, object>)[id] };
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  return { ...base, [bucket]: { ...base[bucket], [id]: rec } } as ContentDatabase;
}

const strikeOf = (ch: Character, dbase: ContentDatabase, itemId: string) =>
  deriveStrike(ch, dbase, { instanceId: 'w', itemId, quantity: 1, equipped: true })!;
const featIdsOf = (c: Character) => new Set((c.feats ?? []).map((f) => f.featId));

/* The rows work/.b039-rows-engine.json emits, verbatim. */
const CASCADE_DAMAGE = [
  { type: 'force', appliesTo: 'melee', flat: 1, byWeaponSpecialization: { spec: 2, greater: 3 }, note: 'Arcane Cascade' },
];
const STAFF_DEADLY = [
  { match: { items: ['staff'], whileStance: 'arcane-cascade' }, add: ['deadly-d6'] },
  { match: { anyTrait: ['staff'], whileStance: 'arcane-cascade' }, add: ['deadly-d6'] },
];

describe('arcane-cascade: the stance chip is the ONE switch (no class-resource toggle, no Modes toggle)', () => {
  // batch 039: arcane-cascade#duplicate-toggles
  it('arcane-cascade: a built magus 7 has no Arcane Cascade class resource or mode, and the stance alone deals 2 force', () => {
    const d = withField('stances', 'arcane-cascade', 'strikeDamage', CASCADE_DAMAGE);
    const c = magus(d, 7);
    const ids = featIdsOf(c);
    // batch 039: arcane-cascade#duplicate-toggles
    expect(resourcesForCharacter(c.classId, ids).map((r) => r.id)).not.toContain('arcane-cascade');
    const offered = Object.values(d.modes).filter((m) => modeRelevant(m, c.classId, c.ancestryId, ids));
    // batch 039: arcane-cascade#duplicate-toggles
    expect(offered.filter((m) => /arcane cascade/i.test(`${m.name} ${m.note ?? ''}`)).map((m) => m.id)).toEqual([]);
    expect(d.modes['cat-arcane-cascade']).toBeUndefined();
    // The one switch left carries the printed payload.
    const inStance = { ...c, activeStance: 'arcane-cascade', activeModes: [], classResources: {} };
    expect(strikeOf(inStance, d, 'staff').damage).toMatch(/plus 2 force/);
  });
});

describe('student-of-the-staff: the deadly die rides the feat and the stance, not a Modes toggle', () => {
  const student = (dbase: ContentDatabase, stance?: string) => ({
    ...magus(dbase, 4, { featPicks: { '4:class': 'student-of-the-staff' } } as Partial<BuildState>),
    ...(stance ? { activeStance: stance } : {}),
  });

  // batch 039: student-of-the-staff#magic-staves
  it('student-of-the-staff: no Modes toggle is offered; in stance each staff gets deadly d6 exactly once', () => {
    const d = withField('feats', 'student-of-the-staff', 'weaponTraits', STAFF_DEADLY);
    const c = student(d, 'arcane-cascade');
    expect(c.feats.map((f) => f.featId)).toContain('student-of-the-staff');
    expect(d.modes['cat-student-of-the-staff']).toBeUndefined();
    const offered = Object.values(d.modes).filter((m) => modeRelevant(m, c.classId, c.ancestryId, featIdsOf(c)));
    expect(offered.filter((m) => m.feats?.includes('student-of-the-staff')).map((m) => m.id)).toEqual([]);
    for (const id of ['staff', 'staff-of-fire']) {
      // batch 039: student-of-the-staff#magic-staves
      expect(strikeOf(c, d, id).traits.filter((t) => t === 'deadly-d6')).toEqual(['deadly-d6']);
    }
  });

  // batch 039: student-of-the-staff#magic-staves
  it('student-of-the-staff: with the feat row stripped nothing else hands out the die (the retired mode is no hidden carrier)', () => {
    const d = withField('feats', 'student-of-the-staff', 'weaponTraits', undefined);
    const c = student(d, 'arcane-cascade');
    // batch 039: student-of-the-staff#magic-staves
    expect(strikeOf(c, d, 'staff').traits).not.toContain('deadly-d6');
  });
});

describe('magus stance arcane-cascade under the trust gate: its strikeDamage is payload', () => {
  afterEach(() => clearTrustGate());

  // batch 039: magus#arcane-cascade-mode
  it('magus: a gated arcane-cascade stance applies no force damage; ungated it applies 2 at 7th', () => {
    const d = withField('stances', 'arcane-cascade', 'strikeDamage', CASCADE_DAMAGE);
    const ledger = {
      ...TRUST_LEDGER,
      records: {},
      lanes: { situational: [], featGrants: {}, modes: [], stances: ['arcane-cascade'], engine: [] },
    };
    const gated = applyTrustGate(d, ledger);
    // batch 039: magus#arcane-cascade-mode
    expect(trustOff('stances', 'arcane-cascade')).toContain('strikeDamage');
    expect(gated.stances!['arcane-cascade']!.note).toBe(d.stances!['arcane-cascade']!.note);
    const inStance = (dbase: ContentDatabase) => ({ ...magus(dbase, 7), activeStance: 'arcane-cascade' });
    // batch 039: magus#arcane-cascade-mode
    expect(strikeOf(inStance(gated), gated, 'staff').damage).not.toMatch(/force/);
    expect(strikeOf(inStance(d), d, 'staff').damage).toMatch(/plus 2 force/);
  });
});
