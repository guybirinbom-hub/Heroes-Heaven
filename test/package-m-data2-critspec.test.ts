import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { build, content } from './_content';
import {
  critSpecConditionFor,
  critSpecSources,
  deityFavoredWeapons,
  deriveStrikes,
  strikeShowsCritSpec,
  type Strike,
} from '../src/rules/derive';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';
import { TRUST_LEDGER } from '../src/data/trustGate';

/**
 * PACKAGE M, ROUND 2 (b) — the rest of the critical specialization family reaches only what print names.
 *
 * Round 1 put the dropped rank gates back on the fighter, swashbuckler, commander, bard and ranger. This
 * round sweeps every other record that turned crit spec on with no narrowing (scripts/critspec-narrowing-
 * check.mjs now refuses a new one): the Ruffian racket (weapons within its dice, off-guard target), the four
 * "your deity's favored weapon" grants (Warpriest Third Doctrine, Cloistered Cleric Fourth Doctrine, Battle
 * Creed's Lesser Creed, the Avenger racket), seven exemplar epithets whose own on-crit ability was shown as
 * each weapon group's effect, and five archetype/ancestry feats. Expert Strikes (print: unarmed attacks only) was
 * held at its shipped brawling-group shape because Wanderer's Guide differs from print there (desk #176); he ruled
 * 'Unarmed only (Recommended)' on 2026-10-17 and the block below now pins print.
 * Each case quotes its printed clause; each has a planted bad case — an in-memory copy of the database with
 * the fix taken back out — that the same assertion catches.
 */
const db = content();

const held = (itemId: string): InventoryItem => ({ instanceId: `pm2-${itemId}`, itemId, quantity: 1, equipped: true });
const wielding = (c: Character, ...ids: string[]): Character => ({ ...c, inventory: [...c.inventory, ...ids.map(held)] });
const strikeNamed = (c: Character, d: ContentDatabase, name: string): Strike => {
  const s = deriveStrikes(c, d).find((x) => x.name === name);
  if (!s) throw new Error(`no Strike named ${name}`);
  return s;
};
const shows = (c: Character, d: ContentDatabase, name: string) => strikeShowsCritSpec(strikeNamed(c, d, name), critSpecSources(c, d), c);
const condition = (c: Character, d: ContentDatabase, name: string) => critSpecConditionFor(strikeNamed(c, d, name), critSpecSources(c, d), c);
/** A copy of the database with one record patched — the planted bad case. Never written anywhere. */
const patched = (bucket: 'classFeatures' | 'feats', id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, [bucket]: { ...db[bucket], [id]: { ...db[bucket][id], ...patch } } }) as ContentDatabase;
const withFeat = (c: Character, featId: string, level: number, choice?: string): Character => ({
  ...c,
  feats: [...c.feats, { featId, level, category: 'class', ...(choice ? { choice: { value: choice, label: choice } } : {}) } as Character['feats'][number]],
});

describe('the shipped items are what this file assumes', () => {
  it('dice and categories', () => {
    expect(db.items['rapier']).toMatchObject({ category: 'martial', damage: { die: 'd6' } });
    expect(db.items['longbow']).toMatchObject({ category: 'martial', damage: { die: 'd8' } });
    expect(db.items['longspear']).toMatchObject({ category: 'simple', damage: { die: 'd8' } });
    expect(db.items['heavy-crossbow']).toMatchObject({ category: 'simple', damage: { die: 'd10' } });
    expect(db.items['gauntlet']).toMatchObject({ category: 'simple', group: 'brawling' });
    expect(db.deities['sarenrae'].favoredWeapons).toEqual(['scimitar']);
    expect(db.deities['irori'].favoredWeapons).toEqual(['fist']);
  });

  it('a Strike carries the faces of the die it rolls', () => {
    const c = wielding(build('rogue', 3, { subclassId: 'ruffian' }), 'rapier', 'longbow');
    expect(strikeNamed(c, db, 'Rapier').dieFaces).toBe(6);
    expect(strikeNamed(c, db, 'Longbow').dieFaces).toBe(8);
    expect(strikeNamed(c, db, 'Fist').dieFaces).toBe(4);
  });
});

describe('Ruffian — "a simple weapon … greater than d8 or a martial or advanced weapon … greater than d6" (racket-7)', () => {
  const ruffian = () => wielding(build('rogue', 3, { subclassId: 'ruffian' }), 'rapier', 'longbow', 'dagger', 'longspear', 'heavy-crossbow', 'greataxe');

  // batch package-m premise: racket-7 "Critical hits you make with these weapons gain the weapon's critical specialization benefit if the target is off-guard to you."
  it('weapons within the dice have it; bigger dice and unarmed attacks do not', () => {
    const c = ruffian();
    for (const name of ['Rapier', 'Dagger', 'Longspear']) expect(shows(c, db, name), name).toBe(true);
    for (const name of ['Longbow', 'Heavy Crossbow', 'Greataxe', 'Fist']) expect(shows(c, db, name), name).toBe(false);
  });

  it('the off-guard clause is printed beside it', () => {
    expect(condition(ruffian(), db, 'Rapier')).toBe('when the target is off-guard to you');
  });

  it('planted: without the narrowing the longbow and the greataxe light up again', () => {
    const bad = patched('classFeatures', 'ruffian', { critSpecWeapons: undefined });
    expect(shows(ruffian(), bad, 'Longbow')).toBe(true);
    expect(shows(ruffian(), bad, 'Greataxe')).toBe(true);
  });
});

describe('"…using your deity\'s favored weapon" (doctrine-4, doctrine-5, doctrine-6, racket-10)', () => {
  // batch package-m premise: doctrine-5 "When you critically succeed at an attack roll using your deity's favored weapon, you apply the weapon's critical specialization effect"
  it('a 7th-level warpriest of Sarenrae: the scimitar has it, the longsword and the Fist do not', () => {
    const c = wielding(build('cleric', 7, { subclassId: 'warpriest', deityId: 'sarenrae' }), 'scimitar', 'longsword');
    expect(shows(c, db, 'Scimitar')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
    expect(shows(c, db, 'Fist')).toBe(false);
  });

  it("an unarmed favored weapon (Irori's fist) is the Fist", () => {
    const c = wielding(build('cleric', 7, { subclassId: 'warpriest', deityId: 'irori' }), 'scimitar');
    expect(deityFavoredWeapons(c, db)).toEqual({ bases: [], unarmed: ['fist'] });
    expect(shows(c, db, 'Fist')).toBe(true);
    expect(shows(c, db, 'Scimitar')).toBe(false);
  });

  it('no deity: no favored weapon, so nothing — never every weapon', () => {
    const c = wielding(build('cleric', 7, { subclassId: 'warpriest' }), 'scimitar');
    expect(critSpecSources(c, db).length, 'the doctrine is still a source').toBeGreaterThan(0);
    expect(shows(c, db, 'Scimitar')).toBe(false);
    expect(shows(c, db, 'Fist')).toBe(false);
  });

  // batch package-m premise: doctrine-4 Fourth Doctrine (11th) "using your deity's favored weapon"
  it('a cloistered cleric: from 11th, the favored weapon only', () => {
    expect(critSpecSources(build('cleric', 10, { subclassId: 'cloistered-cleric', deityId: 'sarenrae' }), db)).toHaveLength(0);
    const c = wielding(build('cleric', 11, { subclassId: 'cloistered-cleric', deityId: 'sarenrae' }), 'scimitar', 'longsword');
    expect(shows(c, db, 'Scimitar')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
  });

  // batch package-m premise: doctrine-6 Lesser Creed (5th) "using your deity's favored weapon"
  it('a battle-creed cleric: Lesser Creed at 5th, the favored weapon only', () => {
    const c = wielding(build('cleric', 5, { subclassId: 'battle-creed', deityId: 'sarenrae' }), 'scimitar', 'longsword');
    expect(shows(c, db, 'Scimitar')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
  });

  // batch package-m premise: racket-10 "using your deity's favored weapon and the target has the off-guard condition"
  it('an avenger: the favored weapon, against an off-guard target', () => {
    const c = wielding(build('rogue', 3, { subclassId: 'avenger', deityId: 'sarenrae' }), 'scimitar', 'longsword');
    expect(shows(c, db, 'Scimitar')).toBe(true);
    expect(condition(c, db, 'Scimitar')).toBe('when the target is off-guard');
    expect(shows(c, db, 'Longsword')).toBe(false);
  });

  it('planted: without deityFavored each of the four lights every weapon again', () => {
    const cases: [string, Character][] = [
      ['third-doctrine-warpriest', wielding(build('cleric', 7, { subclassId: 'warpriest', deityId: 'sarenrae' }), 'longsword')],
      ['fourth-doctrine-cloistered-cleric', wielding(build('cleric', 11, { subclassId: 'cloistered-cleric', deityId: 'sarenrae' }), 'longsword')],
      ['lesser-creed', wielding(build('cleric', 5, { subclassId: 'battle-creed', deityId: 'sarenrae' }), 'longsword')],
      ['avenger', wielding(build('rogue', 3, { subclassId: 'avenger', deityId: 'sarenrae' }), 'longsword')],
    ];
    for (const [id, c] of cases) {
      expect(shows(c, db, 'Longsword'), id).toBe(false);
      expect(shows(c, patched('classFeatures', id, { critSpecWeapons: undefined }), 'Longsword'), `${id} planted`).toBe(true);
    }
  });

  /* The guard for a whole class of defect: a favored weapon that is no item is read as an UNARMED attack
   * (deityFavoredWeapons, deityFavorsUnarmed, deityFavorsSimpleOrUnarmed), so every one that is not an item
   * must really be a body part. A weapon name that failed to resolve lands here and fails.
   *
   * The one case this round held open is closed (package M round 3): deity-528 (Malthus) prints "**Favored
   * Weapon** [Light Crossbow](/Weapons.aspx?ID=425)" and the record carried the link TEXT, 'light-crossbow' —
   * no item. weapon-425 is Player Core's Crossbow (items['crossbow']); scripts/deity-fields-check.mjs now reads
   * an unmatched printed name through the page's link, and the record names 'crossbow'. KNOWN_UNRESOLVED is
   * empty and must stay so; test/package-m-data3-deity-weapons.test.ts holds the Malthus sheet and the check. */
  const BODY_PARTS = new Set(['fist', 'claw', 'claws', 'jaw', 'jaws', 'fang', 'fangs', 'tail', 'nails', 'horn', 'horns', 'tentacle', 'tentacles', 'wing', 'wings', 'beak', 'talon', 'talons']);
  const KNOWN_UNRESOLVED: string[] = [];
  const unresolvedFavored = (d: ContentDatabase) =>
    Object.entries(d.deities).flatMap(([id, dz]) => (dz.favoredWeapons ?? []).filter((w) => !d.items[w] && !BODY_PARTS.has(w)).map((w) => `${id}:${w}`));
  it('every deity favored weapon is a weapon item or a body part (an unarmed attack)', () => {
    expect(unresolvedFavored(db).filter((x) => !KNOWN_UNRESOLVED.includes(x))).toEqual([]);
    expect(KNOWN_UNRESOLVED).toEqual([]);
  });
  it('planted: a second deity on an unresolved weapon name is caught', () => {
    const bad = { ...db, deities: { ...db.deities, abadar: { ...db.deities['abadar'], favoredWeapons: ['heavy-arbalest'] } } } as ContentDatabase;
    expect(unresolvedFavored(bad).filter((x) => !KNOWN_UNRESOLVED.includes(x))).toEqual(['abadar:heavy-arbalest']);
  });
  // batch package-m premise: deity-528 "**Favored Weapon** [Light Crossbow](/Weapons.aspx?ID=425)"
  it('a Malthus warpriest: the crossbow (weapon-425, the page\'s own link) has it; the longsword and the Fist do not', () => {
    const c = wielding(build('cleric', 7, { subclassId: 'warpriest', deityId: 'malthus' }), 'crossbow', 'longsword');
    expect(deityFavoredWeapons(c, db)).toEqual({ bases: ['crossbow'], unarmed: [] });
    expect(shows(c, db, 'Crossbow')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
    expect(shows(c, db, 'Fist')).toBe(false);
    /* planted: the old record (in memory) fails closed — nothing, never every weapon. */
    const old = { ...db, deities: { ...db.deities, malthus: { ...db.deities['malthus'], favoredWeapons: ['light-crossbow'] } } } as ContentDatabase;
    expect(unresolvedFavored(old)).toEqual(['malthus:light-crossbow']);
    expect(shows(c, old, 'Crossbow')).toBe(false);
    expect(shows(c, old, 'Longsword')).toBe(false);
  });

  it('with the trust gate on, as the app runs: the narrowing survives with the grant (class features are on)', () => {
    const gated = content({ trustGate: true });
    const c = wielding(build('cleric', 7, { subclassId: 'warpriest', deityId: 'sarenrae' }), 'scimitar', 'longsword');
    expect(shows(c, gated, 'Scimitar')).toBe(true);
    expect(shows(c, gated, 'Longsword')).toBe(false);
  });
});

describe('the exemplar\'s Dominion Epithets — "a critical specialization ability you can use instead" (class-feature-1070)', () => {
  const OWN_ABILITY = [
    'born-of-the-bones-of-the-earth',
    'dancer-in-the-seasons',
    'of-verse-unbroken',
    'plunderer-of-the-hives-riches',
    'restless-as-the-tide',
    'trespasser-in-deaths-realm',
    'whose-cry-is-thunder',
  ];
  const exemplar = (epithet: string) => wielding(build('exemplar', 7, { extraChoices: { 'dominion-epithet': [epithet] } }), 'longsword');

  // batch package-m premise: epithet-7 "When you critically succeed on a Strike and the target of the critical hit is standing on a surface of earth or stone, the target is driven down"
  it('the seven whose ability is their own effect grant no weapon\'s effect', () => {
    for (const id of OWN_ABILITY) {
      expect(db.classFeatures[id].critSpec, id).toBe(false);
      const c = exemplar(id);
      expect(shows(c, db, 'Longsword'), id).toBe(false);
      expect(shows(c, db, 'Fist'), id).toBe(false);
    }
  });

  // batch package-m premise: epithet-10 "granting you the critical specialization effect for the weapon group"
  it('Peerless under Heaven gives every Strike its group\'s effect — print says so', () => {
    const c = exemplar('peerless-under-heaven');
    expect(shows(c, db, 'Longsword')).toBe(true);
    expect(shows(c, db, 'Fist')).toBe(true);
  });

  it('planted: critSpec back on shows the longsword\'s sword effect for an earth epithet again', () => {
    const bad = patched('classFeatures', 'born-of-the-bones-of-the-earth', { critSpec: true });
    expect(shows(exemplar('born-of-the-bones-of-the-earth'), bad, 'Longsword')).toBe(true);
  });
});

/* Expert Strikes, RULED (desk #176, 2026-10-17). Print (class-feature-938) says "When you get a critical hit
 * with an unarmed attack in the brawling group, you get its critical specialization effect." — unarmed only —
 * while Wanderer's Guide row 31261 encodes WEAPON_CRITICAL_SPECIALIZATIONS "brawling weapons", the whole group.
 * Until he ruled, this block pinned WG's shape. Asked "(a) Unarmed attacks only, as print says - the gauntlet
 * and other brawling weapons lose it. (b) Every brawling-group Strike", his pick was 'Unarmed only
 * (Recommended)' (work/desk-answers-2026-10-17.json), so one overlay row now narrows the record to
 * { groups: ['brawling'], categories: ['unarmed'] }: `categories` is a gate the Strike must pass and the group
 * narrowing must match too (derive.ts weaponMatches). */
describe('Expert Strikes — unarmed attacks in the brawling group only (desk #176 ruled 2026-10-17: \'Unarmed only (Recommended)\', class-feature-938)', () => {
  const monk = () => wielding(build('monk', 5), 'gauntlet', 'longsword');
  const desk = JSON.parse(readFileSync('work/owner-questions.json', 'utf8').replace(/^﻿/, '')) as Record<string, { n?: number; id?: string; ruling?: string }[]>;

  it('the question is ruled — his words are on the desk entry', () => {
    const e = (desk.ruled ?? []).find((q) => q.id === 'expert-strikes');
    expect(e?.n).toBe(176);
    expect(e?.ruling).toContain("'Unarmed only (Recommended)'");
    expect([...(desk.open ?? []), ...(desk.deferred ?? [])].some((q) => q.id === 'expert-strikes')).toBe(false);
  });

  // batch package-m premise: class-feature-938 "When you get a critical hit with an unarmed attack in the brawling group, you get its critical specialization effect."
  it('the record: the brawling group AND the unarmed category', () => {
    expect(db.classFeatures['expert-strikes'].critSpecWeapons).toEqual({ groups: ['brawling'], categories: ['unarmed'] });
  });

  it('a 5th-level monk: the Fist shows it; the gauntlet (a brawling-group WEAPON) and a longsword do not', () => {
    expect(strikeNamed(monk(), db, 'Fist')).toMatchObject({ group: 'brawling', category: 'unarmed' });
    expect(strikeNamed(monk(), db, 'Gauntlet')).toMatchObject({ group: 'brawling', category: 'simple' });
    expect(shows(monk(), db, 'Fist')).toBe(true);
    expect(shows(monk(), db, 'Gauntlet')).toBe(false);
    expect(shows(monk(), db, 'Longsword')).toBe(false);
    // a 4th-level monk has not reached Expert Strikes: the Fist does not show it either
    expect(shows(wielding(build('monk', 4), 'gauntlet'), db, 'Fist')).toBe(false);
  });

  it("planted: Wanderer's Guide's old brawling-group-only shape lights the gauntlet again — this pin catches it", () => {
    const old = patched('classFeatures', 'expert-strikes', { critSpecWeapons: { groups: ['brawling'] } });
    expect(shows(monk(), old, 'Gauntlet')).toBe(true);
    expect(shows(monk(), old, 'Fist')).toBe(true);
  });

  it('with the trust gate on, as the app runs: the class feature and its narrowing are on together', () => {
    const gated = content({ trustGate: true });
    expect((gated.classFeatures['expert-strikes'] as { critSpecWeapons?: unknown }).critSpecWeapons).toEqual({ groups: ['brawling'], categories: ['unarmed'] });
    expect(shows(monk(), gated, 'Fist')).toBe(true);
    expect(shows(monk(), gated, 'Gauntlet')).toBe(false);
  });
});

describe('five feats that turned it on for every weapon (dark under the trust gate today; this is what applies with it off)', () => {
  // batch package-m premise: feat-2769 "Whenever you score a critical hit with your fangs unarmed attack"
  it("Hunter's Fangs: the anadi's Fangs, not the Fist", () => {
    const c = withFeat(build('wizard', 5, { ancestryId: 'anadi' }), 'hunters-fangs', 5);
    expect(shows(c, db, 'Fangs')).toBe(true);
    expect(shows(c, db, 'Fist')).toBe(false);
    expect(shows(c, patched('feats', 'hunters-fangs', { critSpecWeapons: undefined }), 'Fist'), 'planted').toBe(true);
  });

  // batch package-m premise: feat-7001 "Pick a weapon and give it a name … You gain access to its critical specialization effect."
  it('Signature Weapon: the picked weapon only; unanswered, nothing', () => {
    const base = wielding(build('wizard', 5), 'staff', 'dagger');
    const picked = withFeat(base, 'signature-weapon', 5, 'staff');
    expect(shows(picked, db, 'Staff')).toBe(true);
    expect(shows(picked, db, 'Dagger')).toBe(false);
    const unanswered = withFeat(base, 'signature-weapon', 5);
    expect(shows(unanswered, db, 'Staff')).toBe(false);
    expect(shows(picked, patched('feats', 'signature-weapon', { critSpecWeapons: undefined }), 'Dagger'), 'planted').toBe(true);
    expect(db.feats['signature-weapon'].choice?.inert).not.toMatch(/doesn't yet limit/);
  });

  /* Found by the Signature Weapon case above: a grant narrowed ONLY by its own pick resolved, unanswered, to
   * an empty list — and an empty narrowing matches every Strike. Samsaran Weapon Memory and Gird Champion
   * have the same shape. derive.ts critSpecSources now marks such a grant `unanswered` and it matches nothing. */
  it('a grant narrowed only by an unanswered pick matches nothing (Samsaran Weapon Memory, Gird Champion)', () => {
    const base = wielding(build('wizard', 5), 'staff', 'dagger', 'longsword');
    const samsaran = withFeat(base, 'samsaran-weapon-memory', 1);
    expect(shows(samsaran, db, 'Dagger')).toBe(false);
    expect(shows(samsaran, db, 'Longsword')).toBe(false);
    const answered = withFeat(base, 'samsaran-weapon-memory', 1, 'dagger,staff');
    expect(shows(answered, db, 'Dagger')).toBe(true);
    expect(shows(answered, db, 'Staff')).toBe(true);
    expect(shows(answered, db, 'Longsword')).toBe(false);
    const gird = withFeat(wielding(build('wizard', 16), 'longsword'), 'gird-champion', 16);
    expect(shows(gird, db, 'Longsword')).toBe(false);
  });

  it('planted: the same emptied grant without the `unanswered` mark lights every Strike', () => {
    const c = wielding(build('wizard', 5), 'dagger');
    const dagger = strikeNamed(c, db, 'Dagger');
    expect(strikeShowsCritSpec(dagger, [{ level: 1, weapons: { bases: [] }, unanswered: true }], c)).toBe(false);
    expect(strikeShowsCritSpec(dagger, [{ level: 1, weapons: { bases: [] } }], c)).toBe(true);
  });

  // batch package-m premise: feat-8915 "If you're at least an expert in the weapon you're using when fighting in or underwater"
  it('Undersea Privateer Dedication: expert weapons only, said to be underwater', () => {
    const c = withFeat(wielding(build('wizard', 5), 'staff', 'longsword'), 'undersea-privateer-dedication', 2);
    const expert = { ...c, proficiencies: { ...c.proficiencies, weaponOverrides: { ...(c.proficiencies.weaponOverrides ?? {}), staff: 'expert' as const } } };
    expect(strikeNamed(expert, db, 'Staff').rank).toBe('expert');
    expect(shows(expert, db, 'Staff')).toBe(true);
    expect(condition(expert, db, 'Staff')).toBe('when fighting in or underwater');
    expect(shows(expert, db, 'Longsword'), 'untrained').toBe(false);
    expect(shows(expert, patched('feats', 'undersea-privateer-dedication', { critSpecWeapons: undefined }), 'Longsword'), 'planted').toBe(true);
  });

  // batch package-m premise: feat-1223 "When you use an improvised weapon, you apply the critical specialization of a brawling weapon to it."
  it('Improvisational Warrior: improvised weapons, with the brawling effect — not the Fist or a gauntlet', () => {
    const c = withFeat(wielding(build('fighter', 9, { fighterWeaponGroup: 'bow' }), 'gauntlet'), 'improvisational-warrior', 9);
    expect(shows(c, db, 'Fist')).toBe(false);
    expect(shows(c, db, 'Gauntlet')).toBe(false);
    const improvised = { ...strikeNamed(c, db, 'Gauntlet'), name: 'Improvised Bottle', base: 'improvised-bottle' };
    expect(strikeShowsCritSpec(improvised, critSpecSources(c, db), c)).toBe(true);
    expect(critSpecConditionFor(improvised, critSpecSources(c, db), c)).toMatch(/brawling group's effect/);
    const bad = patched('feats', 'improvisational-warrior', { critSpecWeapons: { groups: ['brawling'] } });
    expect(shows(c, bad, 'Fist'), 'planted: the old group narrowing lights the Fist').toBe(true);
  });

  // batch package-m premise: feat-6443 "You can apply critical specialization effects to improvised weapons you wield."
  it('Improvised Critical: no shipped weapon is improvised, so none of them', () => {
    const c = withFeat(wielding(build('fighter', 8, { fighterWeaponGroup: 'bow' }), 'longsword'), 'improvised-critical', 8);
    expect(shows(c, db, 'Longsword')).toBe(false);
    const improvised = { ...strikeNamed(c, db, 'Longsword'), name: 'Improvised Chair', base: 'improvised-chair' };
    expect(strikeShowsCritSpec(improvised, critSpecSources(c, db), c)).toBe(true);
    expect(shows(c, patched('feats', 'improvised-critical', { critSpecWeapons: undefined }), 'Longsword'), 'planted').toBe(true);
  });

  // batch package-m premise: feat-7984 "you gain access to the critical specialization effect of the chosen weapon or unarmed attacks used with Bespell Strikes"
  it('Secrets of Steel: any weapon, said to need Bespell Strikes', () => {
    const c = withFeat(wielding(build('wizard', 10), 'staff'), 'secrets-of-steel', 10);
    expect(shows(c, db, 'Staff')).toBe(true);
    expect(condition(c, db, 'Staff')).toBe('on a Strike modified by Bespell Strikes');
  });

  it('no ledger record strips a crit-spec narrowing while leaving the grant on (that would widen it to every Strike)', () => {
    const records = (TRUST_LEDGER.records ?? {}) as Record<string, string[]>;
    const widening = Object.entries(records).filter(([, paths]) => paths.includes('critSpecWeapons') && !paths.includes('critSpec'));
    expect(widening).toEqual([]);
    // planted: a ledger entry that darkens only the narrowing is exactly what this catches
    const planted = { ...records, 'feats/brawling-focus': ['critSpecWeapons'] };
    expect(Object.entries(planted).filter(([, p]) => p.includes('critSpecWeapons') && !p.includes('critSpec'))).toHaveLength(1);
  });

  it('the trust gate strips the grant and its narrowing TOGETHER — never the narrowing alone', () => {
    const gated = content({ trustGate: true });
    for (const id of ['hunters-fangs', 'signature-weapon', 'undersea-privateer-dedication', 'improvised-critical', 'secrets-of-steel', 'improvisational-warrior']) {
      const rec = gated.feats[id] as { critSpec?: boolean; critSpecWeapons?: unknown };
      expect(rec.critSpec, id).toBeUndefined();
      expect(rec.critSpecWeapons, id).toBeUndefined();
    }
  });
});

/**
 * The second record Foundry gates on a FEATURE (scripts/critspec-narrowing-check.mjs RULE 3): the weapon
 * implement's initiate benefit, implement-9: *"At 5th level, when you gain thaumaturgic weapon expertise, your
 * instinctive knowledge of your weapon implement also grants you the weapon's critical specialization effect."*
 * Foundry: `feature:thaumaturge-weapon-expertise`. The record stands `critSpecLevel: 5` in for that feature, and
 * the check's featureGate entry says why that is enough on both routes to the record — these tests pin it.
 */
describe('Initiate Benefit (Weapon): the feature gate print names, on both routes to the record', () => {
  const withImpl = (c: Character, marks?: string[]): Character => ({
    ...c,
    inventory: [...c.inventory, { instanceId: 'impl', itemId: 'longsword', quantity: 1, equipped: true, ...(marks ? { designations: marks as InventoryItem['designations'] } : {}) }],
  });
  const thaum = (level: number, marks?: string[]) => withImpl(build('thaumaturge', level, { extraChoices: { implement: ['weapon'] } }), marks);
  const ded = (marks?: string[]): Character =>
    withImpl(withFeat(withFeat(build('wizard', 8), 'thaumaturge-dedication', 2, 'weapon'), 'implement-initiate', 4), marks);
  const implStrike = (c: Character) => deriveStrikes(c, db).find((s) => s.instanceId === 'impl')!;
  const showsImpl = (c: Character, d: ContentDatabase = db) => strikeShowsCritSpec(implStrike(c), critSpecSources(c, d), c);

  it('route 1, the class: the level gate is the feature — Weapon Expertise is on the thaumaturge table at the same 5th level', () => {
    expect(db.classFeatures['initiate-benefit-weapon']).toMatchObject({ critSpec: true, critSpecLevel: 5, critSpecWeapons: { designated: 'weapon-implement' } });
    expect(db.classes['thaumaturge'].features).toContainEqual({ level: 5, featureId: 'weapon-expertise' });
    expect((thaum(4).classChoices ?? []).some((x) => x.id === 'initiate-benefit-weapon')).toBe(true);
  });

  it('route 1: a thaumaturge 5 has it on the marked weapon implement; at 4, or unmarked, not', () => {
    expect(showsImpl(thaum(5, ['weapon-implement']))).toBe(true);
    expect(showsImpl(thaum(4, ['weapon-implement']))).toBe(false);
    expect(showsImpl(thaum(5))).toBe(false);
  });

  it('planted: the level gate taken off lights a thaumaturge 4, before thaumaturgic weapon expertise', () => {
    const bad = patched('classFeatures', 'initiate-benefit-weapon', { critSpecLevel: undefined });
    expect(showsImpl(thaum(4, ['weapon-implement']), bad)).toBe(true);
  });

  it('route 2, Implement Initiate: the dedication\'s derived grant reaches the record', () => {
    expect(db.feats['implement-initiate'].derivedGrant).toEqual({ fromFeat: 'thaumaturge-dedication', prefix: 'initiate-benefit-' });
  });

  it('route 2: a wizard 8 with the dedication (weapon) and Implement Initiate: no critical specialization on the longsword', () => {
    const c = ded();
    expect(critSpecSources(c, db).some((s) => s.weapons?.designated === 'weapon-implement')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
  });

  it('the mark the grant needs is offered only to a character holding the thaumaturge class', () => {
    const src = readFileSync('src/sheet/InventoryTab.tsx', 'utf8');
    expect(src).toContain("if (owned.has('thaumaturge')) out.push({ kind: 'weapon-implement', label: 'Weapon implement' });");
    expect(src).toMatch(/const owned = new Set\(heldClasses\(character\)\.map\(\(s\) => s\.classId\)/);
  });

  it('reported, not changed: a weapon-implement mark stored on that character would light it', () => {
    expect(shows(ded(['weapon-implement']), db, 'Longsword')).toBe(true);
  });
});
