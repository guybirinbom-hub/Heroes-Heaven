import { describe, it, expect } from 'vitest';
import { buildCharacter, deriveBuildFromCharacter, levelGrants, SKILL_INCREASE_LEVELS } from '../src/rules/build';
import { importCharacter, WG_VERSION } from '../src/data/transfer';
import type { ContentDatabase, Feat, FeatCategory } from '../src/rules/types';
import { content } from './_content';

const C = content();

/** Every featPicks key the builder actually RENDERS: `${lvl}:${cat}:${idx}` with idx < that level's
 *  featSlots.length and the slot at idx having the key's category. A pick under any other key (e.g. the
 *  old synthetic `${lvl}:${cat}:90`) is invisible in the builder — that's the bug we're guarding. */
function renderedSlotKeys(classId: string, level: number): Set<string> {
  const keys = new Set<string>();
  for (let lvl = 1; lvl <= level; lvl++) {
    levelGrants(lvl, classId, C).featSlots.forEach((cat, idx) => keys.add(`${lvl}:${cat}:${idx}`));
  }
  return keys;
}

/** Pick N feats of a category with the given trait, all sharing the SAME minimum level, from content. */
function featsSharingMinLevel(db: ContentDatabase, category: FeatCategory, trait: string | null, minLevel: number, n: number): Feat[] {
  const out = Object.values(db.feats).filter(
    (f) => f.category === category && f.level === minLevel && (trait ? f.traits.includes(trait) : true) && !f.choice,
  );
  return out.slice(0, n);
}

/** A minimal but importer-valid Wanderer's Guide v4 snapshot. `feats_features` mirrors WG's real
 *  export: each entry's `level` is the feat's MINIMUM level (raw ability-block level), so several feats
 *  of one category collide onto that level — exactly the shape that used to orphan feats into synthetic
 *  builder slots. */
function wgSnapshot(opts: {
  className: string;
  ancestryName: string;
  backgroundName: string;
  feats: { name: string; level: number; category: string }[];
  skillProfValues?: Record<string, number>; // SKILL key (e.g. 'ACROBATICS') → profValue 0/2/4/6/8
  level: number;
}): string {
  const proficiencies: Record<string, unknown> = {};
  for (const [sk, pv] of Object.entries(opts.skillProfValues ?? {})) {
    proficiencies[`SKILL_${sk}`] = { parts: { profValue: pv } };
  }
  return JSON.stringify({
    version: WG_VERSION,
    character: {
      name: 'WG Import',
      level: opts.level,
      details: {
        class: { name: opts.className },
        ancestry: { name: opts.ancestryName },
        background: { name: opts.backgroundName },
      },
    },
    content: {
      class: opts.className,
      ancestry: opts.ancestryName,
      background: opts.backgroundName,
      feats_features: opts.feats,
      proficiencies,
    },
  });
}

describe('WG import → builder slots', () => {
  it('places every colliding same-category feat in a REAL rendered slot (never a synthetic 90+ key)', () => {
    const level = 12;
    // Fighter gets a class feat at every level and skill feats at even levels — plenty of real slots.
    const cls = C.classes['fighter'];
    expect(cls).toBeTruthy();
    // A background with NO granted feat, so none of our chosen skill feats gets absorbed as the
    // background grant (that would legitimately keep it out of a player slot).
    const bg =
      Object.values(C.backgrounds).find((b) => !b.grantedFeatId) ?? C.backgrounds[Object.keys(C.backgrounds)[0]];
    const bgGrant = bg.grantedFeatId;
    // Several LEVEL-1 skill feats: in a real WG file they'd all carry minimum level 1 and collide.
    const skillFeats = featsSharingMinLevel(C, 'skill', null, 1, 5).filter((f) => f.id !== bgGrant).slice(0, 4);
    // Several LEVEL-1 fighter class feats: same collision on the class track.
    const classFeats = featsSharingMinLevel(C, 'class', 'fighter', 1, 3);
    expect(skillFeats.length).toBeGreaterThanOrEqual(3);
    expect(classFeats.length).toBeGreaterThanOrEqual(2);

    const featEntries = [
      ...skillFeats.map((f) => ({ name: f.name, level: 1, category: 'skill' })),
      ...classFeats.map((f) => ({ name: f.name, level: 1, category: 'class' })),
    ];

    const json = wgSnapshot({
      className: 'Fighter',
      ancestryName: C.ancestries[Object.keys(C.ancestries)[0]].name,
      backgroundName: bg.name,
      feats: featEntries,
      level,
    });

    const { saved } = importCharacter(json, C);
    const build = deriveBuildFromCharacter(saved.character, C);

    const rendered = renderedSlotKeys('fighter', level);
    const wantedIds = new Set([...skillFeats, ...classFeats].map((f) => f.id));

    // Which of the wanted feats ended up in a real rendered slot vs a visible granted-feat chip.
    const inRealSlot = new Set<string>();
    for (const [key, id] of Object.entries(build.featPicks)) {
      if (!id) continue;
      // No pick may live under a key the builder does not render.
      expect(rendered.has(key), `feat pick under non-rendered slot key ${key} (${id})`).toBe(true);
      if (wantedIds.has(id)) inRealSlot.add(id);
    }
    const granted = new Set((build.overrides?.addedFeats ?? []).map((a) => a.featId));

    // EVERY imported feat is visible somewhere the builder shows it: a real slot OR a granted chip.
    for (const id of wantedIds) {
      expect(inRealSlot.has(id) || granted.has(id), `feat ${id} is neither in a real slot nor a visible granted chip`).toBe(true);
    }
    // And these low-level, plentiful-slot feats should all land in REAL slots (no fallback needed here).
    for (const id of wantedIds) {
      expect(inRealSlot.has(id), `feat ${id} should occupy a real fighter slot`).toBe(true);
    }

    // A rebuild keeps every feat (nothing silently dropped).
    const rebuilt = buildCharacter(build, C);
    const rebuiltIds = new Set(rebuilt.feats.map((f) => f.featId));
    for (const id of wantedIds) expect(rebuiltIds.has(id), `feat ${id} lost on rebuild`).toBe(true);
  });

  it('surfaces overflow feats (no real slot left) as VISIBLE granted chips, never hidden', () => {
    // A level-3 fighter has class slots only at levels 1 and 2. Import SIX level-1 fighter class feats:
    // two fit the real class slots, the rest have no slot and MUST appear as visible granted-feat chips
    // (never a hidden synthetic slot), and all six must survive a rebuild.
    const level = 3;
    const classFeats = featsSharingMinLevel(C, 'class', 'fighter', 1, 6);
    expect(classFeats.length).toBeGreaterThanOrEqual(5);
    const json = wgSnapshot({
      className: 'Fighter',
      ancestryName: C.ancestries[Object.keys(C.ancestries)[0]].name,
      backgroundName: C.backgrounds[Object.keys(C.backgrounds)[0]].name,
      feats: classFeats.map((f) => ({ name: f.name, level: 1, category: 'class' })),
      level,
    });

    const { saved } = importCharacter(json, C);
    const build = deriveBuildFromCharacter(saved.character, C);
    const rendered = renderedSlotKeys('fighter', level);
    const wantedIds = new Set(classFeats.map((f) => f.id));

    const slotted = new Set<string>();
    for (const [key, id] of Object.entries(build.featPicks)) {
      if (!id) continue;
      expect(rendered.has(key), `feat pick under non-rendered slot key ${key} (${id})`).toBe(true);
      if (wantedIds.has(id)) slotted.add(id);
    }
    const granted = new Set((build.overrides?.addedFeats ?? []).map((a) => a.featId));

    // Some must overflow to granted chips (the level-3 fighter can't slot six class feats).
    expect(granted.size).toBeGreaterThan(0);
    // Every imported feat is EITHER in a real slot OR a visible granted chip — none vanished.
    for (const id of wantedIds) {
      expect(slotted.has(id) || granted.has(id), `feat ${id} vanished (not slotted, not granted)`).toBe(true);
    }
    const rebuilt = new Set(buildCharacter(build, C).feats.map((f) => f.featId));
    for (const id of wantedIds) expect(rebuilt.has(id), `feat ${id} lost on rebuild`).toBe(true);
  });

  it('subtracts auto-granted feats (muse + background) so genuine player feats keep their real slots', () => {
    // Mirrors the real Rux case: a Bard with a Maestro muse (auto-grants Lingering Composition, a CLASS
    // feat) and a Cook background (auto-grants Seasoned, a SKILL feat). A level-5 bard has class-feat
    // slots only at levels 2 and 4. If the muse grant weren't subtracted it would eat a class slot and
    // push a genuine player class feat into an overflow chip — the bug. With the fix: both player class
    // feats take the two real slots, the granted feats are neither slots NOR chips, and every feat
    // (granted + chosen) still appears on the rebuilt sheet.
    const level = 5;
    const bard = C.classes['bard'];
    const maestro = bard.subclass?.options.find((o) => o.id === 'maestro');
    const cook = C.backgrounds['cook'];
    expect(maestro?.grantedFeats).toContain('lingering-composition');
    expect(cook?.grantedFeatId).toBe('seasoned');
    const museFeatId = 'lingering-composition';
    const bgFeatId = cook.grantedFeatId!;

    // Two genuine player class feats (bard, min level 2) — exactly enough to fill the L2 + L4 slots.
    const playerClassFeats = featsSharingMinLevel(C, 'class', 'bard', 2, 2);
    expect(playerClassFeats.length).toBe(2);

    const json = wgSnapshot({
      className: 'Bard',
      ancestryName: C.ancestries[Object.keys(C.ancestries)[0]].name,
      backgroundName: 'Cook',
      // WG lists the resolved muse as a "Maestro Muse" feature; the granted feats (Lingering
      // Composition, Seasoned) show up in feats_features too, alongside the player's chosen class feats.
      feats: [
        { name: 'Maestro Muse', level: 1, category: 'class' },
        { name: C.feats[museFeatId].name, level: 1, category: 'class' },
        { name: C.feats[bgFeatId].name, level: 1, category: 'skill' },
        ...playerClassFeats.map((f) => ({ name: f.name, level: 2, category: 'class' })),
      ],
      level,
    });

    const { saved } = importCharacter(json, C);
    expect(saved.character.subclassId).toBe('maestro');
    const build = deriveBuildFromCharacter(saved.character, C);

    const rendered = renderedSlotKeys('bard', level);
    const slottedIds = new Set<string>();
    for (const [key, id] of Object.entries(build.featPicks)) {
      if (!id) continue;
      expect(rendered.has(key), `feat pick under non-rendered slot key ${key} (${id})`).toBe(true);
      slottedIds.add(id);
    }
    const chipIds = new Set((build.overrides?.addedFeats ?? []).map((a) => a.featId));

    // Both genuine player class feats occupy REAL slots — neither overflowed to a chip.
    for (const f of playerClassFeats) {
      expect(slottedIds.has(f.id), `player feat ${f.id} should be in a real slot`).toBe(true);
      expect(chipIds.has(f.id), `player feat ${f.id} must NOT be a chip`).toBe(false);
    }
    // The auto-granted feats are NEITHER a builder slot NOR a chip (buildCharacter re-injects them).
    expect(slottedIds.has(museFeatId), 'muse grant must not consume a slot').toBe(false);
    expect(chipIds.has(museFeatId), 'muse grant must not be a chip').toBe(false);
    expect(slottedIds.has(bgFeatId), 'background grant must not consume a slot').toBe(false);
    expect(chipIds.has(bgFeatId), 'background grant must not be a chip').toBe(false);

    // But they DO appear on the rebuilt sheet — nothing was lost, just not made an editable slot.
    const rebuiltIds = new Set(buildCharacter(build, C).feats.map((f) => f.featId));
    expect(rebuiltIds.has(museFeatId), 'muse grant should show on the rebuilt sheet').toBe(true);
    expect(rebuiltIds.has(bgFeatId), 'background grant should show on the rebuilt sheet').toBe(true);
    for (const f of playerClassFeats) expect(rebuiltIds.has(f.id), `player feat ${f.id} lost on rebuild`).toBe(true);
  });

  it('reconstructs skill increases so an expert/master skill survives import → rebuild', () => {
    const level = 8; // fighter skill-increase levels 3,5,7 are available (≤8)
    const ancestryName = C.ancestries[Object.keys(C.ancestries)[0]].name;
    const backgroundName = C.backgrounds[Object.keys(C.backgrounds)[0]].name;

    // Choose a skill NOT auto-trained by this class/background so the trained→expert→master jump is
    // unambiguously player skill increases. Acrobatics is a safe pick for most identities; we just need
    // SOME skill raised to master via profValue 6.
    const targetSkill = 'ACROBATICS';
    const json = wgSnapshot({
      className: 'Fighter',
      ancestryName,
      backgroundName,
      feats: [],
      skillProfValues: { [targetSkill]: 6 }, // master
      level,
    });

    const { saved } = importCharacter(json, C);
    const build = deriveBuildFromCharacter(saved.character, C);

    // The builder's skill-increase slots must be populated (not empty) for this to be editable.
    const usedIncreaseLevels = Object.keys(build.skillIncreases).map(Number);
    expect(usedIncreaseLevels.length).toBeGreaterThan(0);
    // Every assigned increase must be at a real skill-increase level for the class.
    const siLevels = C.classes['fighter'].skillIncreaseLevels ?? SKILL_INCREASE_LEVELS;
    for (const lvl of usedIncreaseLevels) expect(siLevels.includes(lvl)).toBe(true);

    // The final rank survives a rebuild.
    const rebuilt = buildCharacter(build, C);
    const key = targetSkill.toLowerCase();
    expect(rebuilt.proficiencies.skills[key]).toBe('master');
  });
});
