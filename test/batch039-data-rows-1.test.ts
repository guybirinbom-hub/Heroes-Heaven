import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveDefenses } from '../src/rules/derive';
import { situationalTitle } from '../src/rules/explain';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Batch 039, data-rows chunk 1: the magus WG-comparison findings whose whole fix is authored data
 * (work/.b039-rows-data-rows-1.json). Printed text (Impossible Magic, each record's own aonId) is the
 * authority.
 *
 * The "shipped" assertions read public/core.json + core-descriptions.json through `content()`, so they
 * fail until the driver applies the rows — that is the point, they pin the row. The "mechanism"
 * assertions build on an in-memory copy with the field STRIPPED or PATCHED to the row's value, so they
 * hold both before and after the row lands and prove the reader turns the field into what the player
 * sees.
 */
const db = content();

type Bucket = 'classFeatures' | 'stances' | 'feats';
/** `db` with one top-level field of one record replaced (`undefined` strips it). */
const withField = (bucket: Bucket, id: string, field: string, value: unknown): ContentDatabase => {
  const rec = { ...(db[bucket] as Record<string, Record<string, unknown>>)[id] };
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  return { ...db, [bucket]: { ...(db[bucket] as object), [id]: rec } } as ContentDatabase;
};
const desc = (bucket: 'classFeatures' | 'actions' | 'feats', id: string) =>
  String((db[bucket] as Record<string, { description?: string }>)[id]?.description ?? '');

const magus = (level: number) => build('magus', level);

/** The inputs `test/_content.ts#build` uses for a magus, so a content copy can be swapped in. */
const magusState = (level: number, over: Partial<BuildState> = {}): BuildState => {
  const cls = db.classes['magus']!;
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId: 'magus',
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ...over,
  };
};

describe('arcane-spellcasting-magus hands over the free spellbook', () => {
  const ROW = [{ itemId: 'spellbook-blank', quantity: 1 }];

  // batch 039: arcane-spellcasting-magus#spellbook-item
  it('arcane-spellcasting-magus: the shipped feature grants spellbook-blank and a built magus holds it', () => {
    // AoN class-feature-1258: "You start with a spellbook worth 10 sp or less, which you receive for free"
    expect(db.classFeatures['arcane-spellcasting-magus']!.grantsItems).toEqual(ROW);
    // batch 039: arcane-spellcasting-magus#spellbook-item
    expect(magus(1).inventory.some((i) => i.itemId === 'spellbook-blank')).toBe(true);
  });

  // batch 039: arcane-spellcasting-magus#spellbook-item
  it('arcane-spellcasting-magus: grantsItems is the carrier (stripped copy hands over no spellbook)', () => {
    const stripped = withField('classFeatures', 'arcane-spellcasting-magus', 'grantsItems', undefined);
    const patched = withField('classFeatures', 'arcane-spellcasting-magus', 'grantsItems', ROW);
    const has = (con: ContentDatabase) => buildCharacter(magusState(1), con).inventory.some((i) => i.itemId === 'spellbook-blank');
    // batch 039: arcane-spellcasting-magus#spellbook-item
    expect(has(stripped)).toBe(false);
    expect(has(patched)).toBe(true);
  });

  // batch 039: arcane-spellcasting-magus#description
  it('arcane-spellcasting-magus: the description is the Impossible Magic text (no slot cap, Learn a Spell)', () => {
    const d = desc('classFeatures', 'arcane-spellcasting-magus');
    // batch 039: arcane-spellcasting-magus#description
    expect(d).toContain('as shown in the Magus Spells per Day table');
    expect(d).toContain('You can also add spells to your spellbook with the Learn a Spell activity.');
    expect(d).not.toMatch(/no more than two spell slots|lose some lower spell slots|use the Arcana skill/);
  });
});

describe('arcane-cascade gives resistance to damage from spells', () => {
  const inStance = (level: number) => ({ ...magus(level), activeStance: 'arcane-cascade' }) as Character;
  const spellsRes = (c: Character, con: ContentDatabase = db) =>
    deriveDefenses(c, con).resistances.find((r) => r.type === 'spells')?.value ?? 0;
  const ROW = [{ type: 'spells', value: '1+min(1,max(0,@actor.level-6))+min(1,max(0,@actor.level-14))' }];

  // batch 039: arcane-cascade#resistance
  it('arcane-cascade: the shipped stance gives resistance 1 / 2 at 7th / 3 at 15th, only while in it', () => {
    // AoN action-4261: "you gain resistance 1 to damage from spells ... increase to 2, ... increase to 3."
    expect(db.stances!['arcane-cascade']!.resistances).toEqual(ROW);
    // batch 039: arcane-cascade#resistance
    expect([1, 6, 7, 14, 15, 20].map((l) => spellsRes(inStance(l)))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(spellsRes(magus(7))).toBe(0);
  });

  // batch 039: arcane-cascade#resistance
  it('arcane-cascade: the stance resistances field is the carrier (stripped copy resists nothing)', () => {
    const stripped = withField('stances', 'arcane-cascade', 'resistances', undefined);
    const patched = withField('stances', 'arcane-cascade', 'resistances', ROW);
    // batch 039: arcane-cascade#resistance
    expect(spellsRes(inStance(15), stripped)).toBe(0);
    expect([1, 6, 7, 14, 15, 20].map((l) => spellsRes(inStance(l), patched))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(spellsRes(magus(15), patched)).toBe(0);
  });

  // batch 039: arcane-cascade#requirement
  it('arcane-cascade: no Player Core requirement; stance, action and feature read as Impossible Magic prints', () => {
    const stance = db.stances!['arcane-cascade']!;
    // batch 039: arcane-cascade#requirement
    expect(stance.requires).toBeUndefined();
    expect(stance.note).toContain('If you Cast a Spell and then enter Arcane Cascade on the same turn');
    expect(stance.note).not.toMatch(/most recent/);
    // batch 039: arcane-cascade#requirement
    const action = desc('actions', 'arcane-cascade');
    expect(action).not.toMatch(/\*\*Requirements\*\*|most recent spell/);
    expect(action).toContain('you gain resistance 1 to damage from spells');
    expect(desc('classFeatures', 'arcane-cascade')).toMatch(/^You can enter a special stance to blend magic into your attacks/);
  });
});

describe('spellstrike text is the Impossible Magic printing', () => {
  // batch 039: spellstrike#action-text
  it('spellstrike: the action disrupts the spell on a critically failed Strike and combines damage for IWR', () => {
    const d = desc('actions', 'spellstrike');
    // batch 039: spellstrike#action-text
    expect(d).toContain('unless your Strike was a critical failure, in which case your spell is disrupted');
    expect(d).toContain("Combine the Strike and spell's damage for the purpose of resistances and weaknesses.");
    expect(d).not.toContain('the target is unaffected');
  });

  // batch 039: spellstrike#description
  it('spellstrike: the class feature has no Multiple Defenses paragraph and the new Spellshape clause', () => {
    const d = desc('classFeatures', 'spellstrike');
    // batch 039: spellstrike#description
    expect(d).not.toContain('Multiple Defenses');
    expect(d).toContain('Even if you gain a spellshape action from outside the magus class');
  });
});

describe('magus feats carry their Impossible Magic bodies', () => {
  // batch 039: raise-a-tome#description
  it('raise-a-tome: passive Raise a Shield substitution plus the reinforcing rune, in text and note', () => {
    const d = desc('feats', 'raise-a-tome');
    // batch 039: raise-a-tome#description
    expect(d).not.toContain('**Requirements**');
    expect(d).toContain('When you Raise a Shield, you can raise a book');
    expect(d).toMatch(/inscribe the \*reinforcing rune\* into your spellbook/);
    expect(db.feats['raise-a-tome']!.note).toMatch(/reinforcing rune.*daily preparations/);
  });

  // batch 039: expansive-spellstrike#description
  it('expansive-spellstrike: disrupted spells do nothing and a Large target lets you pick any corner', () => {
    const d = desc('feats', 'expansive-spellstrike');
    // batch 039: expansive-spellstrike#description
    expect(d).toContain('Expansive Spellstrike has no effect if your spell was disrupted');
    expect(d).toContain('or the corner of any square in its space for a Large or larger creature');
    expect(d).not.toContain('closest to the center');
  });

  // batch 039: force-fang#description
  it('force-fang: no legacy focus-pool sentence, and the pool still counts the spell', () => {
    // batch 039: force-fang#description
    expect(desc('feats', 'force-fang')).not.toContain('Increase the number of Focus Points');
    expect(db.feats['force-fang']!.focusSpells).toEqual(['force-fang']);
  });
});

describe('starlit-eyes lowers the flat check out of stance and marks Shooting Star', () => {
  const withEyes = () =>
    ({ ...build('magus', 4), feats: [{ featId: 'starlit-eyes', level: 4, category: 'class' as const }] }) as Character;
  const strikeStars = (c: Character, con: ContentDatabase = db) =>
    situationalTitle(c, { kind: 'strikeAttack', instanceId: 'x' }, con);

  // batch 039: starlit-eyes#dc
  it('starlit-eyes: the ranged-Strike star reads 4 / 10, and 3 / 9 only in Arcane Cascade', () => {
    const s = db.feats['starlit-eyes']!.situational!;
    // batch 039: starlit-eyes#dc
    expect(s[0].when).not.toMatch(/Arcane Cascade/);
    expect(s[0].bonus).toMatch(/4 instead of 5.*10 instead of 11.*Arcane Cascade.*3.*9/);
    expect(s[1].when).toMatch(/Shooting Star/);
    expect(strikeStars(withEyes())).toMatch(/4 instead of 5/);
    expect(desc('feats', 'starlit-eyes')).toContain('The DC is reduced to 4 instead of 5 against a concealed creature');
  });

  // batch 039: starlit-eyes#dc
  it('starlit-eyes: the situational field is what the Strike star reads (patched copy)', () => {
    const patched = withField('feats', 'starlit-eyes', 'situational', [
      { targets: [{ kind: 'strikeAttack' }], when: 'W', bonus: 'flat check DC is 4 instead of 5' },
    ]);
    // batch 039: starlit-eyes#dc
    expect(strikeStars(withEyes(), patched)).toMatch(/flat check DC is 4 instead of 5/);
  });

  const eyesPicked = (con: ContentDatabase) =>
    buildCharacter(magusState(4, { subclassId: 'starlit-span', featPicks: { '4:class': 'starlit-eyes' } }), con);

  // batch 039: starlit-eyes#shooting-star
  it('starlit-eyes: the shipped feat writes its clause onto the Shooting Star spell card', () => {
    const ch = eyesPicked(db);
    // batch 039: starlit-eyes#shooting-star
    expect(ch.feats.some((f) => f.featId === 'starlit-eyes')).toBe(true);
    expect(ch.spellNotes?.['shooting-star']?.some((n) => n.from === 'Starlit Eyes' && /flat check/.test(n.note))).toBe(true);
  });

  // batch 039: starlit-eyes#shooting-star
  it('starlit-eyes: spellNotes on the feat is the carrier (stripped copy writes nothing)', () => {
    const stripped = eyesPicked(withField('feats', 'starlit-eyes', 'spellNotes', undefined));
    const patched = eyesPicked(withField('feats', 'starlit-eyes', 'spellNotes', [{ spellId: 'shooting-star', note: 'X' }]));
    // batch 039: starlit-eyes#shooting-star
    expect((stripped.spellNotes?.['shooting-star'] ?? []).some((n) => n.from === 'Starlit Eyes')).toBe(false);
    expect(patched.spellNotes?.['shooting-star']).toContainEqual({ from: 'Starlit Eyes', note: 'X' });
  });
});
