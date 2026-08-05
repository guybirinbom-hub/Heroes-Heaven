import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveAnimalCompanion, deriveFamiliar } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';

/**
 * Owner feats that give a COMPANION something the companion cannot give itself.
 *
 * COMPANION_MODS was already a real registry keyed by the owner's feat, carrying senses, HP, speeds,
 * IWR and skills — but a companion's Strikes were built from its TYPE and its wielded gear alone, and
 * a familiar's abilities from the player's own picks alone. So a record whose whole content was "your
 * companions gain this attack" or "your familiar gains this ability" changed nothing at all.
 */
const db = content();

const owner = (featIds: string[]) => {
  const c = build('ranger', 8, {});
  return { ...c, feats: [...c.feats, ...featIds.map((featId, i) => ({ featId, level: 1, slot: `x:${i}` }))] } as typeof c;
};

const TYPE_ID = Object.keys(db.animalCompanions ?? {})[0];
/** The companion block, with `featIds` as the OWNER's feats. */
const companion = (featIds: string[], maturity = 'young') =>
  deriveAnimalCompanion(
    { id: 'c1', kind: 'animal', name: 'Pet', typeId: TYPE_ID, maturity } as never,
    db.animalCompanions[TYPE_ID],
    8,
    db,
    [],
    false,
    [],
    new Set(featIds),
  );

describe('Billowing Wings gives the companion a Strike it did not have', () => {
  it('the registry carries the printed attack', () => {
    const s = COMPANION_MODS['billowing-wings'].grantedStrikes?.[0];
    expect(s).toMatchObject({ name: 'Gust', dice: 1, die: 'd4', damageType: 'bludgeoning', range: 30 });
    expect(s!.traits).toContain('air');
    expect(s!.traits).toContain('propulsive');
  });

  it('a companion without the feat has no Gust', () => {
    expect(companion([]).attacks.some((a) => a.name === 'Gust')).toBe(false);
  });

  it('with the feat it appears alongside the natural attacks, not instead of them', () => {
    const plain = companion([]);
    const b = companion(['billowing-wings']);
    expect(b.attacks.find((a) => a.name === 'Gust'), 'the Gust must be listed').toBeTruthy();
    expect(plain.attacks.length, 'the fixture must already have attacks').toBeGreaterThan(0);
    expect(b.attacks.length).toBe(plain.attacks.length + 1);
  });

  it('its dice are the PRINTED 1d4 — it does not scale with maturity', () => {
    for (const b of [companion(['billowing-wings'], 'young'), companion(['billowing-wings'], 'specialized')]) {
      expect(b.attacks.find((a) => a.name === 'Gust')!.damage, 'the feat prints 1d4, not the maturity die').toMatch(/^1d4/);
    }
  });

  it('being ranged, it adds no Strength to damage', () => {
    expect(companion(['billowing-wings']).attacks.find((a) => a.name === 'Gust')!.damage).toMatch(/^1d4 bludgeoning/);
  });

  it('the note says it belongs to a WINGED companion, which the app cannot check', () => {
    expect(COMPANION_MODS['billowing-wings'].note).toMatch(/wings/i);
  });
});

describe('feats that give a familiar an ability', () => {
  const FEATS = {
    'lightning-rings-intervention': 'lightning-needles',
    'lightning-rings-overcharge': 'lightning-armillary',
    'tempest-clouds-speed': 'path-of-the-tempest',
  } as const;

  it('every ability they name is a real record', () => {
    for (const [feat, ability] of Object.entries(FEATS)) {
      expect(COMPANION_MODS[feat]?.familiarAbilities, feat).toEqual([ability]);
      expect(db.familiarAbilities[ability], `${ability} must exist`).toBeTruthy();
    }
  });

  const famCfg = { id: 'f1', kind: 'familiar' as const, name: 'Familiar', abilities: ['flier'] };

  it('the ability lands on the familiar', () => {
    for (const [feat, ability] of Object.entries(FEATS)) {
      const b = deriveFamiliar(famCfg as never, owner([feat]), db);
      expect(b.abilities.map((a) => a.id), feat).toContain(ability);
    }
  });

  it('without the feat it does not', () => {
    const b = deriveFamiliar(famCfg as never, build('wizard', 8, {}), db);
    for (const ability of Object.values(FEATS)) expect(b.abilities.map((a) => a.id)).not.toContain(ability);
  });

  it('it costs no ability slot, and is marked as such', () => {
    const plain = deriveFamiliar(famCfg as never, build('wizard', 8, {}), db);
    const b = deriveFamiliar(famCfg as never, owner(['lightning-rings-intervention']), db);
    expect(b.abilities.filter((a) => !a.fromFeat).length, 'the chosen ones are unchanged').toBe(plain.abilities.length);
    expect(b.abilities.find((a) => a.id === 'lightning-needles')!.fromFeat).toBe('lightning-rings-intervention');
  });

  it('a granted ability the player ALSO chose is listed once', () => {
    const cfg = { ...famCfg, abilities: ['flier', 'lightning-needles'] };
    const b = deriveFamiliar(cfg as never, owner(['lightning-rings-intervention']), db);
    expect(b.abilities.filter((a) => a.id === 'lightning-needles').length).toBe(1);
  });
});

describe('every mod in the registry is reachable', () => {
  it('each names a record that exists', () => {
    const bad = Object.keys(COMPANION_MODS).filter((id) => !db.feats[id] && !db.classFeatures[id]);
    // Pre-existing entries keyed to ids that no longer ship are the caller's problem, not this lane's;
    // the four added here must resolve.
    for (const id of ['billowing-wings', 'lightning-rings-intervention', 'lightning-rings-overcharge', 'tempest-clouds-speed']) {
      expect(bad, `${id} must name a shipped record`).not.toContain(id);
    }
  });
});
