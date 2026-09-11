import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveStrikes, dailyChoiceKey } from '../src/rules/derive';
import { applyPlayState, emptyPlay } from '../src/rules/play';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import type { Character, ClassFeature, ContentDatabase, Feat, ModeDef } from '../src/rules/types';

/**
 * Batch 037 — the GAP lane for family data-rows-4: the three engine lanes the data agent's rows were
 * blocked on, plus the one row that could only be written once its lane existed.
 *
 *   animal-instinct#spider-web        a granted attack that deals NO damage, and its on-hit effect.
 *   scar-of-the-survivor#dying-toggle  a death threshold a TOGGLE moves, not a permanent field.
 *   soul-well#dying-toggle             the same toggle, for a one-minute activity.
 *   nagaji-spell-familiarity#daily-control  one control, asked at daily preparations.
 *
 * Two rows are authored in work/.b037-rows-gap-data-rows-4.json and are NOT applied yet, so every
 * test here that needs one patches it into a COPY of the content database in memory — spread, never
 * mutated, because `content()` is a cached singleton the rest of the suite shares. That is also what
 * makes these tests honest before the apply stage: they assert the READER on a stunted copy rather
 * than a patched-vs-shipped delta that flips the day the row lands.
 */
const db = () => content();

/** A content database with one class-feature record patched. Never mutates the shared singleton. */
function withFeature(id: string, patch: Partial<ClassFeature>): ContentDatabase {
  const base = db();
  return { ...base, classFeatures: { ...base.classFeatures, [id]: { ...base.classFeatures[id], ...patch } as ClassFeature } };
}

/** …and one with a feat record patched, for the nagaji daily choice. */
function withFeat(id: string, patch: Partial<Feat>): ContentDatabase {
  const base = db();
  return { ...base, feats: { ...base.feats, [id]: { ...base.feats[id], ...patch } as Feat } };
}

/** …and one with a MODE added, for the two dying-value toggles. */
function withMode(mode: ModeDef): ContentDatabase {
  const base = db();
  return { ...base, modes: { ...base.modes, [mode.id]: mode } };
}

function buildWith(over: Partial<BuildState>, on: ContentDatabase = db()): Character {
  const anc = Object.keys(on.ancestries)[0];
  const bg = Object.keys(on.backgrounds)[0];
  return buildCharacter({ ...emptyBuild(), name: 't', level: 1, ancestryId: anc, backgroundId: bg, keyAbility: 'str', ...over } as BuildState, on);
}

/* ------------------------------------------------------- animal-instinct: the spider's Web attack */

/** The Web row exactly as work/.b037-rows-gap-data-rows-4.json authors it. */
const WEB = {
  name: 'Web',
  traits: ['unarmed'],
  group: 'brawling',
  range: 15,
  choiceValue: 'spider',
  onHit: 'the target takes a -10-foot circumstance penalty to its Speeds for 1 round',
};

/** The shipped record with the Web appended — the state the overlay row produces. */
const withWeb = () => {
  const base = db();
  return withFeature('animal-instinct', { grantedStrikes: [...(base.classFeatures['animal-instinct'].grantedStrikes ?? []), WEB] });
};

const spiderBarb = (level: number, on: ContentDatabase) =>
  buildWith({ level, classId: 'barbarian', subclassId: 'animal-instinct', featChoices: { 'feature:animal-instinct': 'spider' } }, on);

/** The same character with the Rage toggle on — Bestial Rage's attacks exist only while raging. */
const raging = (ch: Character): Character => ({ ...ch, classResources: { ...(ch.classResources ?? {}), rage: 1 } });

describe('animal-instinct: the spider instinct grants a Web attack that deals no damage', () => {
  // batch 037: animal-instinct#spider-web
  it('animal-instinct — the spider Web reaches the Strikes row, and its damage cell says "no damage"', () => {
    // instinct-8: "| Spider | Fangs | 1d8 P | Grapple, unarmed, venomous | / | Web | Special* |
    // Range increment 15 feet |", footnote "*The spider's web attack deals no damage, but the target
    // takes a -10-foot circumstance penalty to its Speeds for 1 round on a hit." The lane could not
    // hold it: `die`/`damageType` were required, so the only expressible Web had an invented die.
    const on = withWeb();
    const spider = raging(spiderBarb(1, on));
    const web = (spider.naturalAttacks ?? []).find((n) => n.name === 'Web');
    expect(web, 'the Web is a granted attack, not prose on the Rage action').toBeTruthy();
    expect(web!.die).toBeUndefined();
    expect(web!.damageType).toBeUndefined();
    expect(web!.range).toBe(15);

    const strike = deriveStrikes(spider, on).find((s) => s.name === 'Web');
    expect(strike, 'a damageless attack is still a Strike you can roll').toBeTruthy();
    expect(strike!.damage).toContain('no damage');
    expect(strike!.damage).not.toMatch(/\dd\d/);
    // …and the Fangs beside it are untouched, so the lane change did not cost the animal its damage.
    expect(deriveStrikes(spider, on).find((s) => s.name === 'Fangs')?.damage).toMatch(/^1d8/);
  });

  // batch 037: animal-instinct#spider-web
  it('animal-instinct — the Web carries the printed on-hit Speed penalty onto the Strike', () => {
    // The rider had no carrier at all: GrantedStrike held damage and traits, and StrikeDamageRider
    // carries damage. Without it the Speed penalty — the whole point of the attack — reached the
    // player nowhere on the Strikes row.
    const on = withWeb();
    const strike = deriveStrikes(raging(spiderBarb(1, on)), on).find((s) => s.name === 'Web');
    expect(strike!.damage).toContain('-10-foot circumstance penalty');
    expect(strike!.damage).toContain('on a hit');
  });

  // batch 037: animal-instinct#spider-web
  it('animal-instinct — nothing that adds damage reaches a Web: no die step, no striking, no rage damage', () => {
    // Animal Instinct's own specialization rider steps "the damage die size for the unarmed attacks
    // granted by your chosen animal by one step" at level 7 (instinct-8), and Rage adds a status
    // bonus to melee damage rolls. A damageless attack makes no damage roll, so a 7th-level raging
    // spider barbarian's Web must still read exactly "no damage" — the guard against an engine that
    // quietly invents a d4 to have something to enlarge.
    const on = withWeb();
    const strike = deriveStrikes(raging(spiderBarb(7, on)), on).find((s) => s.name === 'Web');
    expect(strike!.damage.startsWith('no damage')).toBe(true);
    expect(strike!.damage).not.toMatch(/\+\d|\dd\d|plus /);
    // The Fangs on the same character DID grow, which is what proves the guard is scoped to the Web
    // rather than switching the rider off for the animal.
    expect(deriveStrikes(raging(spiderBarb(7, on)), on).find((s) => s.name === 'Fangs')?.damage).toMatch(/^1d10/);
  });

  // batch 037: animal-instinct#spider-web
  it('animal-instinct — no OTHER record has been given a blank-die granted attack in the meantime', () => {
    // The lane now allows an absent die, which is exactly the kind of permission that spreads. A
    // damageless attack is rare and printed ("Special" in the damage column); every other granted
    // attack in the corpus must still state a die and a damage type.
    const live = db();
    const damageless: string[] = [];
    for (const bucket of [live.feats, live.classFeatures, live.heritages, live.ancestries, live.items] as Record<string, { grantedStrikes?: { name: string; die?: string; damageType?: string }[] }>[]) {
      for (const [id, rec] of Object.entries(bucket ?? {})) {
        for (const g of rec?.grantedStrikes ?? []) if (!g.die || !g.damageType) damageless.push(`${id}/${g.name}`);
      }
    }
    // The shipped corpus has none until the Web row lands; when it does, it is the only one.
    expect(damageless.filter((s) => !s.startsWith('animal-instinct/Web'))).toEqual([]);
  });
});

/* --------------------------------------------- scar-of-the-survivor / soul-well: a dying threshold
                                                  that moves with a toggle rather than for ever */

describe('scar-of-the-survivor and soul-well: a mode can raise the dying value while it is on', () => {
  // batch 037: scar-of-the-survivor#dying-toggle
  it('scar-of-the-survivor — an active mode raises the death threshold to 5, and off it is 4 again', () => {
    // ikon-13 Immanence: "You gain the benefits of the Diehard feat and a +1 status bonus to
    // Fortitude saving throws" — true only while your divine spark is in that ikon. The mode row is
    // the data agent's and does not carry the field yet, so the field is patched onto a copy here:
    // what is under test is the READER, which had no route from a toggle to Character.dyingThreshold.
    const mode: ModeDef = {
      id: 'scar-of-the-survivor',
      name: 'Scar of the Survivor (immanence)',
      modifiers: [],
      predefined: true,
      dyingThresholdBonus: 1,
    };
    const on = withMode(mode);
    const ch = buildWith({ level: 5, classId: 'fighter' }, on);
    expect(ch.dyingThreshold ?? 4, 'the built character has no permanent raise').toBe(4);
    expect(applyPlayState(ch, { ...emptyPlay() }, on).dyingThreshold ?? 4).toBe(4);
    expect(applyPlayState(ch, { ...emptyPlay(), activeModes: ['scar-of-the-survivor'] }, on).dyingThreshold).toBe(5);
  });

  // batch 037: soul-well#dying-toggle
  it('soul-well — the one-minute toggle raises it too, and stacks on a permanent Diehard rather than replacing it', () => {
    // feat-7707: "For the next minute … living creatures within the same area die from the dying
    // condition at dying 5 rather than dying 4." The shipped feat field made that permanent; a
    // character who ALSO has Diehard must keep what the build worked out and gain the toggle on top.
    const mode: ModeDef = { id: 'soul-well', name: 'Soul Well', modifiers: [], predefined: true, duration: '1 minute', dyingThresholdBonus: 1 };
    const on = withMode(mode);
    const diehard = buildWith({ level: 5, classId: 'fighter', featPicks: { '1:general:0': 'diehard' } }, on);
    const base = diehard.dyingThreshold ?? 4;
    expect(base, 'the fixture must really own Diehard').toBe(5);
    expect(applyPlayState(diehard, { ...emptyPlay(), activeModes: ['soul-well'] }, on).dyingThreshold).toBe(6);
  });

  // batch 037: soul-well#dying-toggle
  it('soul-well — a mode with no dyingThresholdBonus leaves the number exactly where the build put it', () => {
    // The stunted copy: the same toggle without the field must change nothing, so the test cannot
    // pass on the mere presence of an active mode.
    const on = withMode({ id: 'soul-well', name: 'Soul Well', modifiers: [], predefined: true });
    const ch = buildWith({ level: 5, classId: 'fighter' }, on);
    expect(applyPlayState(ch, { ...emptyPlay(), activeModes: ['soul-well'] }, on).dyingThreshold ?? 4).toBe(4);
  });
});

/* ----------------------------------------- nagaji-spell-familiarity: one control, asked every morning */

describe('nagaji-spell-familiarity asks its question once, at daily preparations', () => {
  // batch 037: nagaji-spell-familiarity#daily-control
  it('nagaji-spell-familiarity is gone from FEAT_CANTRIP_GRANTS, the build-time lane print does not have', () => {
    // feat-3984: "During your daily preparations, choose daze, detect magic, or mage hand." The
    // registry asks once, at character creation, and never again — so with the record's own daily
    // `choice` carrying the grant, leaving it here asks the player the same question twice.
    expect(FEAT_CANTRIP_GRANTS['nagaji-spell-familiarity']).toBeUndefined();
    // Its five siblings, removed for the same sentence in the same batch, stay removed.
    for (const id of ['kitsune-spell-familiarity', 'kitsune-spell-mysteries', 'kitsune-spell-expertise', 'nagaji-spell-mysteries', 'nagaji-spell-expertise']) {
      expect(FEAT_CANTRIP_GRANTS[id]).toBeUndefined();
    }
  });

  // batch 037: nagaji-spell-familiarity#daily-control
  it('nagaji-spell-familiarity — the morning answer grants an at-will occult innate cantrip', () => {
    // The row is authored and not applied, so the grant is patched onto a copy: what is under test is
    // that a rank-0 daily grant survives the play overlay at all. It used to be dropped by
    // `if (rank <= 0) continue`, which is why the daily picker was recorded and changed nothing.
    const shipped = db().feats['nagaji-spell-familiarity'].choice!;
    const granting = {
      ...shipped,
      options: (shipped.options ?? []).map((o) => ({ ...o, grant: { innateSpells: [{ spellId: o.value, tradition: 'occult', atWill: true }] } })),
    };
    const on = withFeat('nagaji-spell-familiarity', { choice: granting } as Partial<Feat>);
    const ch = buildWith({ level: 1, classId: 'fighter', ancestryId: 'nagaji', featPicks: { '1:ancestry:0': 'nagaji-spell-familiarity' } }, on);
    expect(ch.feats.some((f) => f.featId === 'nagaji-spell-familiarity'), 'the fixture must own the feat').toBe(true);

    const key = dailyChoiceKey('nagaji-spell-familiarity', 'nagajiFamiliaritySpell');
    const live = applyPlayState(ch, { ...emptyPlay(), dailyChoices: { [key]: 'detect-magic' } }, on);
    const innate = live.spellcasting.find((e) => e.id === 'innate-casting');
    expect(innate, 'an occult innate cantrip needs an entry to live in').toBeTruthy();
    expect(innate!.cantrips ?? []).toContain('detect-magic');
    // A cantrip is cast at will: it must NOT be filed as a ranked spell with a daily use.
    expect(Object.values(innate!.repertoire ?? {}).flat()).not.toContain('detect-magic');
    expect(innate!.innateUses?.['detect-magic']).toBeUndefined();
    expect(innate!.spellTraditions?.['detect-magic']).toBe('occult');
  });

  // batch 037: nagaji-spell-familiarity#daily-control
  it('nagaji-spell-familiarity — grant-less options grant nothing, so the row is what turns the answer on', () => {
    // The stunted copy, the other way round: with the options' `grant` REMOVED the same morning answer
    // must reach no spellcasting entry — otherwise the test above would pass on something other than
    // the grant it claims to prove. Built by stripping rather than by reading the shipped record: the
    // row has landed, so the shipped options now carry the grant and `db()` is no longer the stunt.
    const shipped = db().feats['nagaji-spell-familiarity'].choice!;
    const bare = { ...shipped, options: (shipped.options ?? []).map(({ grant: _drop, ...o }) => o) };
    const off = withFeat('nagaji-spell-familiarity', { choice: bare } as Partial<Feat>);
    const ch = buildWith({ level: 1, classId: 'fighter', ancestryId: 'nagaji', featPicks: { '1:ancestry:0': 'nagaji-spell-familiarity' } }, off);
    const key = dailyChoiceKey('nagaji-spell-familiarity', 'nagajiFamiliaritySpell');
    const live = applyPlayState(ch, { ...emptyPlay(), dailyChoices: { [key]: 'detect-magic' } }, off);
    const innate = live.spellcasting.find((e) => e.id === 'innate-casting');
    expect(innate?.cantrips ?? []).not.toContain('detect-magic');
  });
});
