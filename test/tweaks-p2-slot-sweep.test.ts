/*
 * WITH NO TWEAK, THE FEAT PICKERS OFFER EXACTLY WHAT THEY OFFERED BEFORE WP5 (Tweaks phase 2, plan WP5).
 *
 * WP5 rebuilt the slot test (`slotTakes`) on `slotRefusal`, which lists every refusing rule, and `pickableFeats` on
 * `pickRefusal`, so a live "Pick from any list" tweak can lift a rule. A character with no such tweak must see the
 * same options as before, in the same order. test/fixtures/p2-slot-sweep.json holds a hash of each list, written
 * from the code BEFORE the change (WP5 start):
 *   - `eligibleFeatsForSlot` for every slot of every sweep character (the zero-marks sweep's characters plus a grid
 *     of every class at 20th, and a few classes with Dual Class, Free Archetype, Ancestry Paragon and Mythic on);
 *   - `pickableFeats` for every FEAT_PICK_GRANTS spec × every sweep character;
 *   - the three bonus feat option lists (the Versatile Human heritage feat, the UMT wizard feat, a dedication's
 *     bonus skill feat), which are content-only.
 * A content fingerprint sits beside them: after `npm run data` changes the feats, this test says so and the
 * fixture is re-made on purpose (HH_WRITE_SLOT_SWEEP=1 node scripts/vt.mjs run test/tweaks-p2-slot-sweep.test.ts).
 * Synthetic characters only.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { listValues } from '../src/data/index';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { bonusSkillFeatOptions, heritageFeatOptions, umtFeatOptions } from '../src/builder/bonusFeatOptions';
import { BONUS_SKILL_FEAT_SPEC, FEAT_PICK_GRANTS, HERITAGE_FEAT_SPEC, UMT_FEAT_SPEC, pickableFeats } from '../src/rules/featPickGrants';
import { heldFeatIds } from '../src/rules/heldFeats';
import type { ContentDatabase, Feat } from '../src/rules/types';
import { content } from './_content';

const FIXTURE = join(process.cwd(), 'test/fixtures/p2-slot-sweep.json');
const WRITE = process.env.HH_WRITE_SLOT_SWEEP === '1';
const db = content();

const hash = (ids: readonly string[]) => createHash('sha1').update(ids.join('\n')).digest('hex').slice(0, 16);
const fingerprint = (c: ContentDatabase) =>
  hash(
    Object.values(c.feats)
      .map((f) => `${f.id}|${f.level}|${f.category}|${[...f.traits].sort().join(',')}|${f.onlyAtLevel ?? ''}|${f.name}|${c.duplicateIds?.has(f.id) ? 'd' : ''}`)
      .sort(),
  );

/** scripts/verify-characters.mjs `mk` (the held-feat-slots grid). */
const mk = (classId: string, level: number): BuildState => {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 'verify',
    level,
    classId,
    keyAbility: (cls?.keyAbility?.[0] ?? 'str') as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'human')?.id ?? null,
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: (cls?.subclass?.options?.[0]?.id as string) ?? null,
  } as BuildState;
};

const sweep = JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/p2-sweep-specs.json'), 'utf8')) as { zero: { id: string; build: BuildState }[] };
const TOGGLED = ['fighter', 'rogue', 'wizard', 'kineticist', 'champion'].filter((c) => db.classes[c]);
const CHARS: { id: string; build: BuildState }[] = [
  ...sweep.zero,
  ...Object.keys(db.classes)
    .sort()
    .map((c) => ({ id: `grid:${c}`, build: mk(c, 20) })),
  ...TOGGLED.flatMap((c) => [
    { id: `grid:${c}+dual`, build: { ...mk(c, 20), variantRules: { dualClass: true }, classId2: c === 'rogue' ? 'fighter' : 'rogue' } as BuildState },
    { id: `grid:${c}+fa`, build: { ...mk(c, 20), variantRules: { freeArchetype: true } } as BuildState },
    { id: `grid:${c}+paragon`, build: { ...mk(c, 20), ancestryId: 'elf', heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'elf')?.id ?? null, variantRules: { ancestryParagon: true } } as BuildState },
    { id: `grid:${c}+mythic`, build: { ...mk(c, 20), mythicEnabled: true } as BuildState },
  ]),
];

/** Every slot the Builder draws for a build, level 1 to its level (featSlots.ts `slotListAt`). */
const slotsOf = (b: BuildState) => {
  const taken = heldFeatIds(b);
  return Array.from({ length: b.level }, (_, i) => i + 1).flatMap((level) =>
    levelGrants(level, b.classId, db, b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, taken).featSlots.map((category, idx) => ({ level, category, idx })),
  );
};

const ids = (fs: readonly Feat[]) => fs.map((f) => f.id);

function measure(bonus: { heritage: string[]; umt: string[]; skill: string[] }) {
  const slots: Record<string, string> = {};
  const picks: Record<string, string> = {};
  for (const { id, build } of CHARS) {
    for (const p of slotsOf(build)) slots[`${id}|${p.level}:${p.category}:${p.idx}`] = hash(ids(eligibleFeatsForSlot(build, db, p)));
    for (const [key, spec] of Object.entries(FEAT_PICK_GRANTS)) picks[`${id}|${key}`] = hash(ids(pickableFeats(spec, build, db)));
  }
  return { content: fingerprint(db), slots, picks, bonus: { heritage: hash(bonus.heritage), umt: hash(bonus.umt), skill: hash(bonus.skill) } };
}

describe('with no tweak the feat pickers are unchanged (WP5 slot sweep)', () => {
  it('eligibleFeatsForSlot, pickableFeats and the three bonus lists equal the pre-WP5 fixture', () => {
    const now = measure({ heritage: heritageFeatOptions(db).map((f) => f.id), umt: umtFeatOptions(db).map((f) => f.id), skill: bonusSkillFeatOptions(db).map((f) => f.id) });
    if (WRITE) {
      writeFileSync(FIXTURE, JSON.stringify(now) + '\n');
      return;
    }
    expect(existsSync(FIXTURE), 'no fixture: HH_WRITE_SLOT_SWEEP=1 node scripts/vt.mjs run test/tweaks-p2-slot-sweep.test.ts').toBe(true);
    const was = JSON.parse(readFileSync(FIXTURE, 'utf8')) as ReturnType<typeof measure>;
    expect(now.content, 'the feats changed since the fixture was written (npm run data?) — re-make it on purpose').toBe(was.content);
    expect(Object.keys(now.slots).length).toBeGreaterThan(2000);
    expect(Object.keys(now.slots).sort()).toEqual(Object.keys(was.slots).sort());
    expect(Object.entries(now.slots).filter(([k, v]) => was.slots[k] !== v).map(([k]) => k)).toEqual([]);
    expect(Object.entries(now.picks).filter(([k, v]) => was.picks[k] !== v).map(([k]) => k)).toEqual([]);
    expect(Object.keys(now.picks).sort()).toEqual(Object.keys(was.picks).sort());
    expect(now.bonus).toEqual(was.bonus);
  }, 600_000);

  it('the three bonus specs list exactly the bonus option lists (pickRefusal reads them for the greyed rows)', () => {
    const b = { ...mk('wizard', 1) };
    const set = (fs: readonly Feat[]) => new Set(fs.map((f) => f.id));
    const noDupes = (fs: readonly Feat[]) => fs.filter((f) => !db.duplicateIds?.has(f.id));
    // heritageFeatOptions reads Object.values (duplicates included), the other two listValues.
    expect(set(pickableFeats(HERITAGE_FEAT_SPEC, b, db))).toEqual(set(heritageFeatOptions(db)));
    expect(set(noDupes(pickableFeats(UMT_FEAT_SPEC, b, db)))).toEqual(set(umtFeatOptions(db)));
    expect(set(noDupes(pickableFeats(BONUS_SKILL_FEAT_SPEC, b, db)))).toEqual(set(bonusSkillFeatOptions(db)));
    expect(listValues(db, db.feats).length).toBeGreaterThan(1000);
  });
});
