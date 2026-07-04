import { describe, it, expect } from 'vitest';
import { build, content, firstSubclass } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import { deriveEidolon } from '../src/rules/companions';
import type { CompanionConfig, InventoryItem, WeaponRunes } from '../src/rules/types';

const db = content();

const weapon = (itemId: string): InventoryItem =>
  ({ instanceId: itemId, itemId, quantity: 1, equipped: true }) as InventoryItem;
const strikeNamed = (ch: ReturnType<typeof build>, re: RegExp) =>
  deriveStrikes(ch, db).find((s) => re.test(s.name))!;
const fistOf = (ch: ReturnType<typeof build>) => deriveStrikes(ch, db).find((s) => s.instanceId === 'fist')!;

/*
 * DEADLY SIMPLICITY (Player Core, cleric): while wielding your deity's favored weapon, increase its
 * damage die by one step. If the favored weapon is an UNARMED attack with a die smaller than d6,
 * raise it to d6 instead. A warpriest cleric of a simple/unarmed-favored deity auto-gains the feat.
 */
describe('Deadly Simplicity steps the favored weapon damage die', () => {
  it('mace deity (Asmodeus, simple d6) → wielded mace steps d6 → d8', () => {
    const ch = build('cleric', 3, {
      subclassId: 'warpriest',
      deityId: 'asmodeus',
      divineFont: 'harm',
      inventory: [weapon('mace')],
    });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true);
    expect(strikeNamed(ch, /mace/i).damage).toMatch(/^1d8/);
  });

  it('d4-favored deity (Pharasma, dagger simple d4) → wielded dagger steps d4 → d6', () => {
    const ch = build('cleric', 3, {
      subclassId: 'warpriest',
      deityId: 'pharasma',
      divineFont: 'heal',
      inventory: [weapon('dagger')],
    });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true);
    expect(strikeNamed(ch, /dagger/i).damage).toMatch(/^1d6/);
  });

  it('unarmed-favored deity (Irori, fist) → the Fist Strike die is raised to d6', () => {
    const ch = build('cleric', 3, { subclassId: 'warpriest', deityId: 'irori', divineFont: 'heal' });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(true);
    expect(fistOf(ch).damage).toMatch(/^1d6/);
  });

  it('NEGATIVE: longsword deity (Iomedae, martial) → no Deadly Simplicity, longsword die unchanged (d8)', () => {
    const ch = build('cleric', 3, {
      subclassId: 'warpriest',
      deityId: 'iomedae',
      divineFont: 'heal',
      inventory: [weapon('longsword')],
    });
    expect(ch.feats.some((f) => f.featId === 'deadly-simplicity')).toBe(false);
    expect(strikeNamed(ch, /longsword/i).damage).toMatch(/^1d8/); // base, not stepped to d10
  });

  it('NEGATIVE: a non-favored simple weapon in the same build is NOT stepped', () => {
    // Asmodeus (mace) warpriest also carrying a light mace (d4): only the favored mace steps.
    const ch = build('cleric', 3, {
      subclassId: 'warpriest',
      deityId: 'asmodeus',
      divineFont: 'harm',
      inventory: [weapon('mace'), weapon('light-mace')],
    });
    expect(strikeNamed(ch, /^mace/i).damage).toMatch(/^1d8/); // favored → stepped
    expect(strikeNamed(ch, /light mace/i).damage).toMatch(/^1d4/); // not favored → unchanged
  });
});

/*
 * EIDOLON handwraps property runes (eidolon.json rune-sharing): the eidolon's unarmed Strikes benefit
 * from the summoner's Handwraps of Mighty Blows property runes — flaming → +1d6 fire, greater flaming
 * → +2d10 persistent fire on a crit — exactly like the summoner's own unarmed Strikes.
 */
describe('Eidolon shares the summoner handwraps property runes', () => {
  const hw = (runes: WeaponRunes): InventoryItem =>
    ({ instanceId: 'hw', itemId: 'handwraps-of-mighty-blows', quantity: 1, equipped: true, runes }) as InventoryItem;
  const eidCfg: CompanionConfig = { id: 'e', kind: 'eidolon', name: '', typeId: firstSubclass('summoner') ?? '' } as CompanionConfig;

  it('flaming handwraps add +1d6 fire to the eidolon Strike', () => {
    const summoner = build('summoner', 8, {
      subclassId: firstSubclass('summoner') ?? undefined,
      inventory: [hw({ potency: 1, striking: 'striking', property: ['flaming'] })],
    });
    const eid = deriveEidolon(eidCfg, summoner, db);
    for (const a of eid.attacks) expect(a.damage).toContain('plus 1d6 fire');
  });

  it('greater flaming adds the persistent-fire crit rider to the eidolon Strike', () => {
    const summoner = build('summoner', 15, {
      subclassId: firstSubclass('summoner') ?? undefined,
      inventory: [hw({ potency: 2, striking: 'greater', property: ['flaming-greater'] })],
    });
    const eid = deriveEidolon(eidCfg, summoner, db);
    for (const a of eid.attacks) {
      expect(a.damage).toContain('plus 1d6 fire');
      expect(a.damage).toMatch(/2d10 persistent fire on a crit/);
    }
  });

  it('NEGATIVE: no property runes → eidolon Strike has no elemental rider', () => {
    const summoner = build('summoner', 8, {
      subclassId: firstSubclass('summoner') ?? undefined,
      inventory: [hw({ potency: 1, striking: 'striking' })],
    });
    const eid = deriveEidolon(eidCfg, summoner, db);
    for (const a of eid.attacks) expect(a.damage).not.toContain('fire');
  });
});
