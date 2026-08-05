import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { blastTypesFor, deriveStrikes, domainPoolFor, ELEMENT_BLAST } from '../src/rules/derive';
import { dailyChoicesFor } from '../src/rules/dailyChoices';

/**
 * Records whose entire content is "add these to the menu that other record already gives you".
 *
 * Nothing let one record reach into another's option list, so these feats could be taken and the
 * menu stayed exactly the same size — the player read the new runes or damage types in the feat's own
 * text and could not pick one.
 */
const db = content();

const withFeats = (classId: string, level: number, featIds: string[], over: Record<string, unknown> = {}) => {
  const c = build(classId, level, over);
  return { ...c, feats: [...c.feats, ...featIds.map((featId, i) => ({ featId, level: 1, slot: `x:${i}` }))] } as typeof c;
};

describe('a feat can widen another record’s daily menu', () => {
  const menu = (c: ReturnType<typeof withFeats>, recordId: string) =>
    dailyChoicesFor(c, db).find((ch) => ch.recordId === recordId)?.options.map((o) => o.value) ?? [];

  it('the blessed armament menu ships without astral or brilliant', () => {
    const base = (db.classFeatures['blessed-armament'].choice?.options ?? []).map((o) => o.value);
    expect(base).not.toContain('astral');
    expect(base).not.toContain('brilliant');
  });

  it('Radiant Armament adds them', () => {
    const c = withFeats('champion', 12, ['radiant-armament'], { deityId: 'iomedae', extraChoices: { blessing: ['blessed-armament'] } });
    const opts = menu(c, 'blessed-armament');
    expect(opts, 'the champion must own blessed-armament for this to mean anything').not.toEqual([]);
    expect(opts).toContain('astral');
    expect(opts).toContain('brilliant');
    expect(opts).toContain('fearsome'); // the printed five survive
  });

  it('without the feat the menu is untouched', () => {
    const c = build('champion', 12, { deityId: 'iomedae', extraChoices: { blessing: ['blessed-armament'] } });
    expect(menu(c, 'blessed-armament')).not.toContain('astral');
  });

  it('the holy rune follows YOUR sanctification, never both', () => {
    const add = db.feats['radiant-armament'].choiceOptionAdditions![0];
    const sanct = add.addIfSanctified!.map((s) => s.sanctification);
    expect(sanct).toEqual(['holy', 'unholy']);
    // An unsanctified character gets neither: the additions are keyed to the character's own answer.
    const c = withFeats('champion', 12, ['radiant-armament'], { deityId: 'iomedae', extraChoices: { blessing: ['blessed-armament'] } });
    const opts = menu(c, 'blessed-armament');
    expect(opts).not.toEqual([]);
    expect(opts.filter((o) => o === 'holy' || o === 'unholy').length).toBeLessThanOrEqual(1);
  });

  it("Greater Armament adds all eight of the runes it names, and doesn't duplicate the five already there", () => {
    const add = db.feats['greater-armament'].choiceOptionAdditions![0];
    expect(add.add!.map((o) => o.value)).toEqual(['brilliant', 'corrosive', 'flaming', 'frost', 'holy', 'shock', 'thundering', 'unholy']);
    const c = withFeats('fighter', 12, ['harbingers-armament', 'greater-armament']);
    const opts = menu(c, 'harbingers-armament');
    expect(opts).not.toEqual([]);
    expect(new Set(opts).size, 'no rune listed twice').toBe(opts.length);
    expect(opts).toContain('flaming');
    expect(opts).toContain('fearsome'); // the original five survive
  });
});

describe('alternate domains', () => {
  it('they shipped for the deities that have them', () => {
    const withAlt = Object.values(db.deities).filter((d) => d.alternateDomains?.length);
    expect(withAlt.length).toBeGreaterThan(300);
  });

  it("Abadar's Duty domain is an alternate, not one of the primary four", () => {
    expect(db.deities.abadar.domains).not.toContain('duty');
    expect(db.deities.abadar.alternateDomains).toContain('duty');
  });

  it('the default pool is still only the deity’s own domains', () => {
    expect(domainPoolFor('abadar', db)).toEqual(db.deities.abadar.domains);
  });

  it('Splinter Faith draws from both lists', () => {
    const pool = domainPoolFor('abadar', db, 'deity+alternate');
    expect(pool).toContain('cities');
    expect(pool).toContain('duty');
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('the feat asks for four distinct domains and says what it cannot enforce', () => {
    const def = db.feats['splinter-faith'].choice!;
    expect(def.kind).toBe('domains');
    expect(def.domainPool).toBe('deity+alternate');
    expect(def.picks).toBe(4);
    expect(def.distinct).toBe(true);
    expect(def.note).toMatch(/anathematic|1 rank lower/i);
  });
});

describe('Elemental Blast damage types', () => {
  it('each element carries the list its own entry prints, not one type', () => {
    expect(ELEMENT_BLAST.air.types).toEqual(['electricity', 'slashing']);
    expect(ELEMENT_BLAST.earth.types).toEqual(['bludgeoning', 'piercing']);
    expect(ELEMENT_BLAST.fire.types, 'fire prints only one').toEqual(['fire']);
    expect(ELEMENT_BLAST.wood.types).toEqual(['bludgeoning', 'vitality']);
  });

  it('Versatile Blasts adds one type per element, read from its own text', () => {
    expect(db.feats['versatile-blasts'].blastTypeAdditions).toEqual({
      air: ['cold'],
      earth: ['poison'],
      fire: ['cold'],
      metal: ['electricity'],
      water: ['acid'],
      wood: ['poison'],
    });
  });

  it('a kineticist without the feat has only the printed types', () => {
    const c = build('kineticist', 5, {});
    expect(blastTypesFor(c, db, 'earth')).toEqual(['bludgeoning', 'piercing']);
  });

  it('with it, the widened list appears — printed ones first', () => {
    const c = withFeats('kineticist', 8, ['versatile-blasts']);
    expect(blastTypesFor(c, db, 'earth')).toEqual(['bludgeoning', 'piercing', 'poison']);
    expect(blastTypesFor(c, db, 'fire')).toEqual(['fire', 'cold']);
  });

  it('the chosen type is what the Strike deals', () => {
    const base = build('kineticist', 5, { extraChoices: { element: ['earth-gate'] } });
    const blast = (c: typeof base) => deriveStrikes(c, db).find((s) => /Elemental Blast/.test(s.name))?.damage ?? '';
    expect(blast(base), 'the fixture must actually have an earth blast').toMatch(/^\dd8/);
    const picked = { ...base, kineticist: { ...base.kineticist!, blastTypes: { earth: 'piercing' } } } as typeof base;
    expect(blast(picked)).toMatch(/piercing|\bP\b/);
  });

  it('a type the character cannot choose is ignored rather than obeyed', () => {
    // A saved pick from before a feat was removed must not keep granting a damage type.
    const c = build('kineticist', 5, { extraChoices: { element: ['earth-gate'] } });
    const bogus = { ...c, kineticist: { ...c.kineticist!, blastTypes: { earth: 'poison' } } } as typeof c;
    const dmg = deriveStrikes(bogus, db).find((s) => /Elemental Blast/.test(s.name))?.damage ?? '';
    expect(dmg).not.toEqual('');
    expect(dmg).not.toMatch(/poison/i);
  });
});
