import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { importCharacter } from '../src/data/transfer';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { heldFeatIds } from '../src/rules/heldFeats';
import { readTweaks, tweaksSwitchOn } from '../src/rules/blocks/stored';
import { liveGivenSpells } from '../src/rules/blocks/active';
import { setTweaksSwitch } from '../src/rules/blocks/write';
import type { BuildOverrides, Character } from '../src/rules/types';

/**
 * IMPORT STAMPS (Tweaks part B, plan WP2; spec 2; B27). Two places turn a character's OWN content into a
 * stored tweak, outside the Builder: the Wanderer's Guide import (its rituals become `addedSpells`) and the
 * reverse build (`deriveBuildFromCharacter`: a feat no real slot can hold becomes an `addedFeats` chip).
 * Both stamp exactly the entries they append `meta.source: 'import'` (blocks/write.ts `markImported`), so
 * those entries ignore the Tweaks master switch (they were never a rule-breaking choice), and neither ever
 * writes `v` — a `v: 2` without `options.overridesEnabled: true` would read every old entry OFF (B27).
 *
 * Mutation proofs (recorded in work/tweaks-part-b-notes/wp2-report.md): a temp copy of transfer.ts whose
 * ritual block appends without `markImported` fails the first it(); a temp copy of build.ts whose overflow
 * appends without `markImported` fails the third. Synthetic characters only.
 */

const db = content();
const RITUAL = Object.values(db.spells).find((s) => s.name === 'Atone')!;

function wgWithRitual(): string {
  return JSON.stringify({
    version: 4,
    character: {
      name: 'Stamp Fighter',
      level: 5,
      details: { ancestry: { name: 'Human' }, background: { name: 'Guard' }, class: { name: 'Fighter' } },
      inventory: { coins: { gp: 5 }, items: [] },
    },
    content: {
      attributes: { ATTRIBUTE_STR: { value: 4 }, ATTRIBUTE_DEX: { value: 2 }, ATTRIBUTE_CON: { value: 2 } },
      feats_features: { classFeats: [], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [], heritages: [], classFeatures: [] },
      languages: ['COMMON'],
      spells: { cantrips: [], normal: [], rituals: [{ id: 904, name: RITUAL.name, rank: RITUAL.rank }] },
    },
  });
}

const grantOf = (ov: BuildOverrides | undefined, kind: string, record: string) => readTweaks(ov).instances.find((i) => i.kind === kind && i.record === record);

describe("Wanderer's Guide import: rituals are stamped source 'import'", () => {
  const { saved } = importCharacter(wgWithRitual(), db);
  const build = saved.build!;

  it("importFromWg stamps the imported rituals source 'import'", () => {
    expect(RITUAL, 'fixture: the Atone ritual').toBeDefined();
    expect(build.overrides?.addedSpells).toEqual([{ spellId: RITUAL.id, rank: RITUAL.rank }]);
    expect(grantOf(build.overrides, 'grant.spell', RITUAL.id)?.imported, 'the build').toBe(true);
    expect(grantOf((saved.character as Character).overrides, 'grant.spell', RITUAL.id)?.imported, 'the character built from it').toBe(true);
    // What the stamp is for: with Tweaks switched off the imported ritual is still the character's own.
    const off = { ...build, ...setTweaksSwitch({ overrides: build.overrides, options: build.options }, false) } as BuildState;
    expect(liveGivenSpells(buildCharacter(off, db)).map((s) => s.spellId)).toEqual([RITUAL.id]);
  });

  it('a WG import with rituals reads Tweaks ON (no v written)', () => {
    expect(build.overrides?.v, 'no v on the build').toBeUndefined();
    expect((saved.character as Character).overrides?.v, 'no v on the character').toBeUndefined();
    expect(tweaksSwitchOn(build)).toBe(true);
    expect(tweaksSwitchOn(saved.character as Character)).toBe(true);
  });
});

describe("the reverse build: an overflow feat is stamped source 'import'", () => {
  /** A level-1 fighter (no general slot until 3) holding Toughness anyway — the shape of an over-cap import. */
  function withOverflow(overrides?: BuildOverrides): Character {
    const cls = db.classes.fighter;
    const b: BuildState = {
      ...emptyBuild(),
      name: 'Overflow fixture',
      level: 1,
      classId: 'fighter',
      keyAbility: 'str',
      ancestryId: 'human',
      backgroundId: 'acolyte',
      subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
      ...(overrides ? { overrides } : {}),
    } as BuildState;
    const c = buildCharacter(b, db);
    return { ...c, feats: [...c.feats, { featId: 'toughness', level: 1, category: 'general' }] } as Character;
  }

  it("the reverse build's overflow feats are stamped source 'import'", () => {
    const back = deriveBuildFromCharacter(withOverflow(), db);
    expect(back.overrides?.addedFeats).toEqual([{ featId: 'toughness', level: 1, category: 'general' }]);
    expect(grantOf(back.overrides, 'grant.feat', 'toughness')?.imported).toBe(true);
    // Only the entries the overflow APPENDED: a given feat the character already had keeps its own meta.
    const given: BuildOverrides = { addedFeats: [{ featId: 'fleet', level: 1, category: 'general' }], meta: { 'addedFeats:fleet@1': { reason: 'GM gift', of: 'fleet@1' } } };
    const back2 = deriveBuildFromCharacter(withOverflow(given), db);
    expect(back2.overrides?.addedFeats?.map((a) => a.featId)).toEqual(['fleet', 'toughness']);
    expect(grantOf(back2.overrides, 'grant.feat', 'fleet')?.imported, 'the given feat: not stamped').toBeUndefined();
    expect(grantOf(back2.overrides, 'grant.feat', 'fleet')?.reason).toBe('GM gift');
    expect(grantOf(back2.overrides, 'grant.feat', 'toughness')?.imported, 'the overflow: stamped').toBe(true);
    // What the stamp is for: Tweaks off keeps the overflow feat held, and pauses the GM's gift.
    const off = { ...back2, ...setTweaksSwitch({ overrides: back2.overrides, options: back2.options }, false) } as BuildState;
    expect(heldFeatIds(off)).toContain('toughness');
    expect(heldFeatIds(off)).not.toContain('fleet');
  });

  it('a reverse build of a build-less character with old overrides and an overflow feat keeps tweaksSwitchOn true', () => {
    const old: BuildOverrides = { addedLanguages: ['aklo'] }; // saved before Tweaks existed: no v
    const c = withOverflow(old);
    expect(tweaksSwitchOn(c), 'fixture: ON by read').toBe(true);
    const back = deriveBuildFromCharacter(c, db);
    expect(back.overrides?.v, 'no v written').toBeUndefined();
    expect(tweaksSwitchOn(back)).toBe(true);
    expect(buildCharacter(back, db).languages, "the old tweak still applies after Builder open's reverse build").toContain('aklo');
    expect(heldFeatIds(back)).toContain('toughness');
  });
});
