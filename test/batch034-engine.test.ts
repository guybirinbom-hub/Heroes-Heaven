// @vitest-environment jsdom
// jsdom because one of the readers pinned below is a BUILDER control: the construct innovation's
// modification pickers exist or not on the screen, and the only honest way to ask whether a card
// appeared is to render it. Every other test in this file is a pure engine test and unaffected.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { content } from './_content';
import { renderDom } from './_render';
import { OriginPickers, type BuilderActions } from '../src/builder/shared';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, inventorModificationOptions, type BuildState } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

const db = content();
const anc = Object.keys(db.ancestries)[0];
const bg = Object.keys(db.backgrounds)[0];

function mk(over: Partial<BuildState>, on: ContentDatabase = db): Character {
  return buildCharacter({ ...emptyBuild(), name: 't', level: 1, ancestryId: anc, backgroundId: bg, ...over }, on);
}

/** A shallow content copy with one classFeatures record replaced/added — the in-memory stand-in for
 *  a backfill row that has not landed yet. */
function withFeatures(recs: Record<string, unknown>): ContentDatabase {
  return { ...db, classFeatures: { ...db.classFeatures, ...recs } } as ContentDatabase;
}

// ---------------------------------------------------------------- the psychic's granted-spell ladder

/**
 * The Silent Whisper's conscious-mind ladder, with and without the printed "- 6th: Sending" rung
 * expressed as a `rank` on the ladder entry.
 *
 * BOTH sides are built in memory, from a ladder with every `sending` rung STRIPPED — never from
 * shipped content. The row this pins is the one the spec asks the driver to author, so an assertion
 * of the defect made against `db` would flip the day the row lands; a stripped copy states the same
 * defect and stays true forever.
 */
function ladderWithSending(rank: boolean): ContentDatabase {
  const cm = db.classFeatures['conscious-mind'] as unknown as {
    grantedSpells: Record<string, { id: string; level: number; rank?: number }[]>;
  };
  const rungs = cm.grantedSpells['the-silent-whisper'].filter((g) => g.id !== 'sending').map(({ id, level }) => ({ id, level }));
  return withFeatures({
    'conscious-mind': {
      ...cm,
      grantedSpells: {
        ...cm.grantedSpells,
        'the-silent-whisper': rank ? [...rungs, { id: 'sending', level: 11, rank: 6 }] : rungs,
      },
    },
  });
}

const psychic = (on: ContentDatabase) =>
  mk({ level: 11, classId: 'psychic', subclassId: 'the-silent-whisper', keyAbility: null }, on);

const granted = (ch: Character) => ch.spellcasting.find((s) => s.type === 'spontaneous')?.grantedRepertoire ?? {};

describe('the-silent-whisper: the conscious mind grants Sending at the rank the ladder prints', () => {
  // batch 034: the-silent-whisper#sending-rank
  it('the-silent-whisper files a granted spell under the ladder rank, not the spell rank', () => {
    // Print: "- 5th: Synaptic Pulse - 6th: Sending". Sending's own rank is 5, so without the ladder
    // rank both land on the 5th rung and the 6th — the one print names — stays empty.
    expect(db.spells['sending'].rank).toBe(5);
    const rankless = granted(psychic(ladderWithSending(false)));
    expect(rankless[5]).toContain('sending');
    expect(rankless[6] ?? []).not.toContain('sending');

    const fixed = granted(psychic(ladderWithSending(true)));
    expect(fixed[6]).toContain('sending');
    expect(fixed[5]).not.toContain('sending');
    expect(fixed[5]).toContain('synaptic-pulse'); // the other 5th-rank grant stays where it was
  });

  // batch 034: the-silent-whisper#sending-rank
  it('the-silent-whisper leaves every ladder entry without a rank filed under the spell rank', () => {
    // Blast radius: only an entry that SAYS `rank` moves. Shatter Mind (a cantrip) is still a cantrip.
    const entry = psychic(ladderWithSending(true)).spellcasting.find((s) => s.type === 'spontaneous')!;
    expect(entry.grantedCantrips).toContain('shatter-mind'); // a cantrip is still a cantrip
    expect(entry.grantedRepertoire![1]).toContain('mindlink');
  });
});

// ---------------------------------------------------------------- barbarian instincts

function barb(level: number, subclassId: string, over: Partial<BuildState> = {}): Character {
  const inventory: InventoryItem[] = [{ instanceId: 'w1', itemId: 'greatclub', quantity: 1, equipped: true }];
  const ch = mk({ level, classId: 'barbarian', subclassId, keyAbility: 'str', inventory, ...over });
  return { ...ch, classResources: { ...ch.classResources, rage: 1 } };
}

/** The Rage rider on the wielded (non-agile) greatclub. */
function rageRider(ch: Character) {
  const w = deriveStrikes(ch, db).find((s) => /greatclub/i.test(s.name));
  return w?.conditionalDamage?.find((r) => r.note.includes('raging')) ?? null;
}

describe('spirit-instinct: Spirit Rage is a per-Rage choice that also grants ghost touch', () => {
  // batch 034: spirit-instinct#damage-type-choice
  it('spirit-instinct shows both branches of the choice made each time you Rage', () => {
    // "you can increase the additional damage from Rage from 2 to 3 and change its damage type to
    // spirit, instead of the damage type for your weapon … (choose each time you Rage)"
    const r = rageRider(barb(5, 'spirit-instinct'))!;
    expect(r.text).toContain('3 spirit');
    expect(r.text).toContain('2 bludgeoning');
    expect(r.text).toMatch(/choose each Rage/i);
  });

  // batch 034: spirit-instinct#ghost-touch
  it('spirit-instinct says the spirit branch carries ghost touch against incorporeal creatures', () => {
    // "your weapon or unarmed attack gains the effects of the Ghost Touch property rune, which makes
    // it more effective against incorporeal creatures"
    expect(rageRider(barb(5, 'spirit-instinct'))!.note).toMatch(/ghost touch vs incorporeal/i);
  });

  // batch 034: spirit-instinct#damage-type-choice
  it('spirit-instinct halves BOTH branches on an agile attack, and no other instinct grows a choice', () => {
    const fist = deriveStrikes(barb(5, 'spirit-instinct'), db).find((s) => /fist/i.test(s.name));
    const r = fist?.conditionalDamage?.find((x) => x.note.includes('raging'))!;
    expect(r.text).toContain('1 spirit'); // floor(3/2)
    expect(r.text).toContain('1 bludgeoning'); // floor(2/2)
    // Blast radius: an instinct with no `typeOptional` still prints one branch.
    expect(rageRider(barb(5, 'dragon-instinct'))!.text).toBe('4 energy');
    expect(rageRider(barb(5, 'fury-instinct'))!.text).toBe('3 bludgeoning');
  });
});

describe('elemental-instinct: Rage deals the damage type you selected for your element', () => {
  // batch 034: elemental-instinct#rage-damage-type
  it('elemental-instinct takes its Rage damage type from the answered element choice', () => {
    // "change its damage type to the one you selected for your element" — the answer is
    // `<element>-<damageType>`, so an Air barbarian who chose slashing reads slashing.
    const air = barb(15, 'elemental-instinct', { featChoices: { 'feature:elemental-instinct': 'air-slashing' } });
    expect(air.featureChoices?.['feature:elemental-instinct']).toBe('air-slashing');
    expect(rageRider(air)!.text).toBe('12 slashing');
    const water = barb(5, 'elemental-instinct', { featChoices: { 'feature:elemental-instinct': 'water-cold' } });
    expect(rageRider(water)!.text).toBe('4 cold');
  });

  // batch 034: elemental-instinct#rage-damage-type
  it('elemental-instinct keeps the "energy" placeholder only while the element is unanswered', () => {
    expect(rageRider(barb(15, 'elemental-instinct'))!.text).toBe('12 energy');
  });

  // batch 034: elemental-instinct#rage-damage-type
  it('elemental-instinct survives an import that lost the build (the lossy round trip)', () => {
    const air = barb(15, 'elemental-instinct', { featChoices: { 'feature:elemental-instinct': 'air-slashing' } });
    const back = deriveBuildFromCharacter(air, db);
    expect(back.featChoices['feature:elemental-instinct']).toBe('air-slashing');
    expect(rageRider({ ...buildCharacter(back, db), classResources: { rage: 1 } })!.text).toBe('12 slashing');
  });
});

// ---------------------------------------------------------------- kineticist blasts

const blasts = (ch: Character) => deriveStrikes(ch, db).filter((s) => s.instanceId.startsWith('blast:'));

describe('elemental-blast: a non-physical damage type adds its trait to the blast', () => {
  // batch 034: elemental-blast#damage-type-trait
  it('elemental-blast carries the chosen damage type as a trait when it is not physical', () => {
    // "The element determines the damage die, damage type, and range … A damage type other than a
    // physical damage type adds its trait to the blast."
    const kin = mk({ level: 5, classId: 'kineticist', keyAbility: 'con', extraChoices: { element: ['fire-gate', 'air-gate'] } });
    const fire = blasts(kin).find((b) => b.name.includes('Fire'))!;
    expect(fire.traits).toContain('fire');
    const air = blasts(kin).find((b) => b.name.includes('Air'))!;
    expect(air.traits).toContain('electricity'); // air's first printed type
    expect(air.traits).toContain('air'); // the element trait is still there
  });

  // batch 034: elemental-blast#damage-type-trait
  it('elemental-blast adds no trait for a physical damage type, and follows the player pick', () => {
    const earth = mk({ level: 5, classId: 'kineticist', keyAbility: 'con', extraChoices: { element: ['earth-gate'] } });
    const b = blasts(earth)[0];
    expect(b.traits).toContain('earth');
    expect(b.traits).not.toContain('bludgeoning');
    // …and the pick moves the trait with it: air chosen as slashing is physical → no added trait.
    const slashing = mk({
      level: 5,
      classId: 'kineticist',
      keyAbility: 'con',
      extraChoices: { element: ['air-gate'] },
      blastTypes: { air: 'slashing' },
    });
    expect(blasts(slashing)[0].traits).not.toContain('electricity');
    expect(blasts(slashing)[0].traits).not.toContain('slashing');
  });
});

// ---------------------------------------------------------------- the construct innovation

/** The seven initial + six breakthrough construct modifications, in the shape DATA STILL NEEDED asks
 *  the driver to create (the light-mortar modification records are the shipped precedent). */
const CONSTRUCT_MODS: Record<string, unknown> = Object.fromEntries(
  [
    ['accelerated-mobility', 'Accelerated Mobility', 1],
    ['amphibious-construction', 'Amphibious Construction', 1],
    ['increased-size', 'Increased Size', 1],
    ['manual-dexterity', 'Manual Dexterity', 1],
    ['projectile-launcher', 'Projectile Launcher', 1],
    ['sensory-array', 'Sensory Array', 1],
    ['wonder-gears', 'Wonder Gears', 1],
    ['climbing-limbs', 'Climbing Limbs', 7],
    ['durable-construction', 'Durable Construction', 7],
  ].map(([id, name, level]) => [
    id,
    { id, name, traits: ['inventor'], rarity: 'common', level, actionCost: { type: 'passive' }, otherTags: ['construct-innovation-modification'] },
  ]),
);

/**
 * Content with every `construct-innovation-modification` record REMOVED — the shipped shape while
 * the 18 records are still DATA STILL NEEDED, and the base both sides below are built from. Stated
 * as a strip rather than read off `db`, so the "no records yet" assertions do not flip into failures
 * the day the driver creates them.
 */
function withoutConstructMods(): ContentDatabase {
  const kept = Object.fromEntries(
    Object.entries(db.classFeatures).filter(
      ([, f]) => !(f as { otherTags?: string[] }).otherTags?.includes('construct-innovation-modification'),
    ),
  );
  return { ...db, classFeatures: kept } as ContentDatabase;
}

/** …and that same stripped content with exactly the nine records this file authors in memory. */
function withConstructMods(): ContentDatabase {
  const bare = withoutConstructMods();
  return { ...bare, classFeatures: { ...bare.classFeatures, ...CONSTRUCT_MODS } } as ContentDatabase;
}

const constructBuild = (level: number, over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level,
  ancestryId: anc,
  backgroundId: bg,
  classId: 'inventor',
  subclassId: 'construct-innovation',
  keyAbility: 'int',
  ...over,
});

describe('construct-innovation: the modification pick is offered and recorded like every other innovation', () => {
  // batch 034: construct-innovation#higher-tier-picks
  it('construct-innovation offers its tagged modifications at each tier once the records exist', () => {
    // "Choose one initial construct modification to apply to your innovation" — and Breakthrough
    // Innovation prints the same for its own tier, with no exception for constructs.
    expect(inventorModificationOptions(withoutConstructMods(), 'construct', undefined, 1)).toEqual([]); // the missing half
    const on = withConstructMods();
    expect(inventorModificationOptions(on, 'construct', undefined, 1).map((o) => o.id)).toContain('sensory-array');
    expect(inventorModificationOptions(on, 'construct', undefined, 1)).toHaveLength(7);
    expect(inventorModificationOptions(on, 'construct', undefined, 7)).toHaveLength(9);
  });

  // batch 034: construct-innovation#modification-effects
  it('construct-innovation carries the chosen modification onto the built character', () => {
    const on = withConstructMods();
    const ch = buildCharacter(
      constructBuild(7, { inventorModifications: { initial: 'sensory-array', breakthrough: 'climbing-limbs' } }),
      on,
    );
    expect(ch.inventor?.innovationType).toBe('construct');
    expect(ch.inventor?.modifications.initial).toBe('sensory-array');
    expect(ch.inventor?.modifications.breakthrough).toBe('climbing-limbs');
  });

  // batch 034: construct-innovation#duplicate-picker
  it('construct-innovation no longer prints the placeholder that contradicted the picker', () => {
    const r = renderDom(
      createElement(OriginPickers, { build: constructBuild(7), actions: {} as BuilderActions, content: withConstructMods() }),
    );
    const text = r.host.textContent ?? '';
    expect(text).not.toMatch(/described in the innovation text/i);
    expect(text).toMatch(/Initial modification/);
    expect(text).toMatch(/Breakthrough modification/);
    r.stop();
  });

  // batch 034: construct-innovation#higher-tier-picks
  it('construct-innovation renders no empty tier card while the records are still missing', () => {
    const r = renderDom(
      createElement(OriginPickers, { build: constructBuild(7), actions: {} as BuilderActions, content: withoutConstructMods() }),
    );
    const text = r.host.textContent ?? '';
    expect(text).not.toMatch(/described in the innovation text/i);
    expect(text).not.toMatch(/Initial modification/);
    r.stop();
  });
});
