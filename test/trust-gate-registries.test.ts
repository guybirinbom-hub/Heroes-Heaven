import { describe, it, expect, afterEach } from 'vitest';
import { build, content } from './_content';
import { deriveStrike, deriveStrikes, ownedFeatureIds } from '../src/rules/derive';
import { FEAT_GRANTS, grantsFor, grantsRecordOff, setFeatGrantTrustOff } from '../src/rules/featGrants';
import { engineLaneOff, setEngineTrustOff } from '../src/rules/trustLanes';
import type { Character, InventoryItem } from '../src/rules/types';

/*
 * THE TRUST GATE'S TWO CODE SURFACES (docs/trust-gate.md section 3, decisions 2 and 6).
 *
 * The ledger turns a record's mechanics off by stripping FIELDS, which cannot reach a mechanic that
 * lives in CODE keyed by a record id. Two of those exist and this file is their proof:
 *
 *   · the grant registry — `lanes.featGrants` names the KINDS that are off for a carrier, and only
 *     `grantsFor(id)` honours it. The raw FEAT_GRANTS table stays readable for the Builder, because
 *     a picker that stops rendering is not "grants nothing", it is a missing control (ruling Q27);
 *   · the hard-coded engine lanes — `lanes.engine` names record ids, `engineLaneOff(id)` answers.
 *
 * Both setters are module-global and written once at content load, so every test here clears them
 * again: a leaked OFF list would silently darken the rest of the suite.
 */

const db = content();
const weapon = (itemId: string): InventoryItem => ({ instanceId: itemId, itemId, quantity: 1, equipped: true }) as InventoryItem;
const strikeOf = (ch: Character, itemId: string) => deriveStrike(ch, db, weapon(itemId))!;
const strikeNamed = (ch: Character, re: RegExp) => deriveStrikes(ch, db).find((s) => re.test(s.name))!;
const sneakDice = (ch: Character, itemId: string) =>
  strikeOf(ch, itemId).conditionalDamage?.find((r) => r.note.includes('off-guard'))?.text;

afterEach(() => {
  setFeatGrantTrustOff({});
  setEngineTrustOff([]);
});

/*
 * Guardian Dedication is the carrier: `skills: { athletics: trained }` (kind `skill`),
 * `armor: { light, medium: trained }` + `conditionalArmor` (kind `ac`), `redundantFallback` (kind
 * `choice`) — three kinds on one record, which is what "the trusted unit is the KIND on a record"
 * needs to be tested against. A wizard is untrained in all of them, so every grant is visible.
 */
const GUARDIAN = { featPicks: { '2:class:0': 'guardian-dedication' } };

describe('FEAT_GRANTS carriers go dark per KIND (lanes.featGrants)', () => {
  it('ungated, the carrier grants its skill AND its armour', () => {
    const ch = build('wizard', 4, GUARDIAN);
    expect(ch.proficiencies.skills.athletics).toBe('trained');
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(build('wizard', 4).proficiencies.skills.athletics).toBe('untrained'); // …and it is the feat that did it
  });

  it('with the SKILL kind off it grants no skill, and its other kinds still apply', () => {
    setFeatGrantTrustOff({ 'guardian-dedication': ['skill'] });
    const g = grantsFor('guardian-dedication')!;
    expect(g.skills).toBeUndefined();
    expect(g.armor).toBeDefined();

    const ch = build('wizard', 4, GUARDIAN);
    expect(ch.proficiencies.skills.athletics).toBe('untrained');
    expect(ch.proficiencies.defenses.light).toBe('trained');
    expect(ch.proficiencies.defenses.medium).toBe('trained');
  });

  it('a kind stays on while ANY kind the key answers is trusted (decision 1)', () => {
    // `skillChoices` answers skill+choice: with only `skill` off, the slot still asks and still grants.
    setFeatGrantTrustOff({ 'champion-dedication': ['skill'] });
    const g = grantsFor('champion-dedication')!;
    expect(g.skills).toBeUndefined();           // skill alone
    expect(g.skillChoices).toBeDefined();       // skill + choice → choice keeps it
    expect(g.armor).toBeDefined();              // ac
  });

  it('every delivered kind off → grantsFor is undefined, the character gets nothing, the picker keeps its data', () => {
    setFeatGrantTrustOff({ 'guardian-dedication': ['skill', 'ac', 'choice'] });
    expect(grantsFor('guardian-dedication')).toBeUndefined();

    const ch = build('wizard', 4, GUARDIAN);
    expect(ch.proficiencies.skills.athletics).toBe('untrained');
    expect(ch.proficiencies.defenses.light).toBe('untrained');
    expect(ch.proficiencies.defenses.medium).toBe('untrained');
    // The record is still taken — off is not "unpickable" — and the Builder's own read still sees it.
    expect(ch.feats.some((f) => f.featId === 'guardian-dedication')).toBe(true);
    expect(FEAT_GRANTS['guardian-dedication']).toBeDefined();
    expect(FEAT_GRANTS['guardian-dedication'].skills).toBeDefined();
    expect(db.feats['guardian-dedication']).toBeDefined();
  });

  it('a carrier not on the lane is untouched, and clearing the lane restores the gated one', () => {
    setFeatGrantTrustOff({ 'guardian-dedication': ['skill', 'ac', 'choice'] });
    expect(grantsFor('sentinel-dedication')).toBe(FEAT_GRANTS['sentinel-dedication']);
    setFeatGrantTrustOff({});
    expect(grantsFor('guardian-dedication')).toBe(FEAT_GRANTS['guardian-dedication']);
    const ch = build('wizard', 4, GUARDIAN);
    expect(ch.proficiencies.skills.athletics).toBe('trained');
    expect(ch.proficiencies.defenses.light).toBe('trained');
  });
});

/*
 * The OTHER half of the same lane. featFeatGrants.ts holds seven tables that hand over a whole FEAT,
 * keyed by carrier id; the generator credits every key of that file with `grantsRecord`
 * (scripts/trust-ledger.mjs FEATFEAT_FILE), so those carriers are already on `lanes.featGrants` — but
 * they are not FeatGrant rows, so `grantsFor` cannot answer for them and `grantsRecordOff` does.
 *
 * Alchemist Dedication is the carrier for both halves at once: FEAT_GRANTS trains Crafting (kind
 * `skill`) and FEAT_FEAT_GRANTS hands over Alchemical Crafting (kind `grantsRecord`), so one record
 * proves the two halves are gated independently.
 */
describe('feat-granting carriers go dark for grantsRecord (lanes.featGrants)', () => {
  const ALCHEMIST = { featPicks: { '2:class:0': 'alchemist-dedication' } };
  const hasFeat = (ch: Character, id: string) => ch.feats.some((f) => f.featId === id);

  it('ungated, the dedication hands over its feat', () => {
    const ch = build('fighter', 2, ALCHEMIST);
    expect(hasFeat(ch, 'alchemist-dedication')).toBe(true);
    expect(hasFeat(ch, 'alchemical-crafting')).toBe(true);
  });

  it('with grantsRecord off it hands over nothing, and its other kinds still apply', () => {
    setFeatGrantTrustOff({ 'alchemist-dedication': ['grantsRecord'] });
    expect(grantsRecordOff('alchemist-dedication')).toBe(true);
    const ch = build('fighter', 2, ALCHEMIST);
    expect(hasFeat(ch, 'alchemical-crafting')).toBe(false);
    // the dedication is still taken, and its `skill` kind — a different kind — still pays
    expect(hasFeat(ch, 'alchemist-dedication')).toBe(true);
    expect(ch.proficiencies.skills.crafting).toBe('trained');
  });

  it('another kind off does not touch the feat it grants', () => {
    setFeatGrantTrustOff({ 'alchemist-dedication': ['skill'] });
    expect(grantsRecordOff('alchemist-dedication')).toBe(false);
    expect(hasFeat(build('fighter', 2, ALCHEMIST), 'alchemical-crafting')).toBe(true);
  });
});

describe('hard-coded engine lanes go dark by record id (lanes.engine)', () => {
  it('sneak-attack: the precision rider is there, and gone while the lane is off', () => {
    expect(sneakDice(build('rogue', 5), 'rapier')).toBe('2d6 precision');

    setEngineTrustOff(['sneak-attack']);
    expect(engineLaneOff('sneak-attack')).toBe(true);
    const gated = build('rogue', 5);
    expect(sneakDice(gated, 'rapier')).toBeUndefined();
    // the class feature itself is still the character's — only the code lane went quiet
    expect(ownedFeatureIds(gated, db).has('sneak-attack')).toBe(true);
  });

  it('deadly-simplicity: the favored-weapon die steps, and stops stepping while the lane is off', () => {
    const cleric = () => build('cleric', 3, { subclassId: 'warpriest', deityId: 'asmodeus', divineFont: 'harm', inventory: [weapon('mace')] });
    expect(strikeNamed(cleric(), /mace/i).damage).toMatch(/^1d8/);

    setEngineTrustOff(['deadly-simplicity']);
    const gated = cleric();
    expect(strikeNamed(gated, /mace/i).damage).toMatch(/^1d6/);   // the mace's own printed die
    expect(gated.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true); // still taken
  });

  it('an unrelated id on the lane changes nothing, and clearing it brings both lanes back', () => {
    setEngineTrustOff(['some-record-nobody-reads']);
    expect(sneakDice(build('rogue', 5), 'rapier')).toBe('2d6 precision');

    setEngineTrustOff([]);
    expect(engineLaneOff('sneak-attack')).toBe(false);
    expect(sneakDice(build('rogue', 5), 'rapier')).toBe('2d6 precision');
    expect(strikeNamed(build('cleric', 3, { subclassId: 'warpriest', deityId: 'asmodeus', divineFont: 'harm', inventory: [weapon('mace')] }), /mace/i).damage).toMatch(/^1d8/);
  });
});
