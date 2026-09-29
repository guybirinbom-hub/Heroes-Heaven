import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveDefenses, deriveStrikes, dailyChoiceKey } from '../src/rules/derive';
import { explainStat, recordMarkersFor } from '../src/rules/explain';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Print batch P02, data-rows chunk 1: the Bastion of Blasphemies backgrounds (background-647 to 652)
 * and three magus hybrid-study rows, whose whole fix is authored data (work/.bP02-rows-data-rows-1.json,
 * prose for the created action in work/.bP02-created-desc-data-rows-1.json). The printed text - each
 * record's own aonId in the AoN mirror - is the authority.
 *
 * The "shipped" assertions read public/core.json + core-descriptions.json through `content()`, so they
 * are red until the driver applies the rows: they pin the row, and a regeneration that drops it fails
 * here. The "mechanism" assertions build on an in-memory copy with the field STRIPPED or PATCHED to the
 * row's value, so they hold before and after the row lands and prove the reader turns the field into
 * what the player sees.
 */
const db = content();

type Bucket = 'backgrounds' | 'classFeatures';
/** `db` with one top-level field of one record replaced (`undefined` strips it). */
const withField = (bucket: Bucket, id: string, field: string, value: unknown): ContentDatabase => {
  const rec = { ...(db[bucket] as Record<string, Record<string, unknown>>)[id] };
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  return { ...db, [bucket]: { ...(db[bucket] as object), [id]: rec } } as ContentDatabase;
};
const bgField = (id: string, field: string) => (db.backgrounds[id] as unknown as Record<string, unknown>)[field];
const withBg = (bg: string): Character => build('fighter', 1, { backgroundId: bg });

/** Every situational line a stat shows that came from `sourceId`. */
const stars = (c: Character, ref: Parameters<typeof explainStat>[2], sourceId: string, con: ContentDatabase = db) =>
  (explainStat(c, con, ref).situational ?? []).filter((n) => n.sourceId === sourceId).map((n) => n.text);
const willStars = (c: Character, id: string, con: ContentDatabase = db) => stars(c, { kind: 'save', save: 'will' }, id, con);

/* ---------------------------------------------------------------------------------------------- */

describe('art-collector: the daily inspiration and its mental-save star', () => {
  // batch P02: art-collector
  it('art-collector: asks at daily preparations and stars saves against mental effects (+2, +1 on a repeat)', () => {
    // AoN background-647: "Whenever you do your daily preparations, select an art object ... +2 circumstance
    // bonus to saving throws against mental effects ... or a +1 circumstance bonus if you've chosen this artwork more than once."
    const choice = bgField('art-collector', 'choice') as { daily?: boolean; options?: { value: string }[] } | undefined;
    // batch P02: art-collector
    expect(choice?.daily).toBe(true);
    expect(choice?.options?.map((o) => o.value)).toEqual(['new-piece', 'repeat-piece']);
    // batch P02: art-collector
    const lines = willStars(withBg('art-collector'), 'art-collector');
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/\+2 circumstance \(\+1 if you've chosen that artwork before\).*against mental effects/);
  });
});

describe('blooded-by-the-dead: three morning routines', () => {
  const KEY = dailyChoiceKey('blooded-by-the-dead', 'bloodedRoutine');
  const bleedRes = (c: Character, con: ContentDatabase = db) =>
    deriveDefenses(c, con).resistances.find((r) => r.type === 'persistent bleed')?.value ?? 0;
  const morning = (answer: string): Character => ({ ...withBg('blooded-by-the-dead'), dailyChoices: { [KEY]: answer } }) as Character;
  const PATCHED_CHOICE = {
    flag: 'bloodedRoutine',
    prompt: 'Morning routine (daily preparations, 24 hours)',
    kind: 'array',
    daily: true,
    options: [
      { value: 'blood', label: 'Bolster the Blood', grant: { resistances: [{ type: 'persistent bleed', value: 2 }] } },
      { value: 'fury', label: 'Bolster the Fury' },
      { value: 'mind', label: 'Bolster the Mind' },
    ],
  };

  // batch P02: blooded-by-the-dead
  it('blooded-by-the-dead: Bolster the Blood chosen this morning gives resistance 2 to persistent bleed, the others do not', () => {
    // AoN background-648: "Bolster the Blood: You gain resistance to persistent bleed 2"
    expect(bleedRes(morning('blood'))).toBe(2);
    // batch P02: blooded-by-the-dead
    expect(bleedRes(morning('fury'))).toBe(0);
    expect(bleedRes(withBg('blooded-by-the-dead'))).toBe(0);
  });

  // batch P02: blooded-by-the-dead
  it('blooded-by-the-dead: the daily choice is the carrier (stripped copy resists nothing, patched copy resists 2)', () => {
    const stripped = withField('backgrounds', 'blooded-by-the-dead', 'choice', undefined);
    const patched = withField('backgrounds', 'blooded-by-the-dead', 'choice', PATCHED_CHOICE);
    // batch P02: blooded-by-the-dead
    expect(bleedRes(morning('blood'), stripped)).toBe(0);
    expect(bleedRes(morning('blood'), patched)).toBe(2);
  });

  // batch P02: blooded-by-the-dead
  it('blooded-by-the-dead: Fury and Mind are stars, the bleed flat-check DC is a mark on persistent damage', () => {
    // AoN background-648: "+2 circumstance bonus to Will saving throws against a vampire's dominate ability"
    const c = withBg('blooded-by-the-dead');
    // batch P02: blooded-by-the-dead
    expect(willStars(c, 'blooded-by-the-dead').some((t) => /dominate/.test(t) && /\+2 circumstance/.test(t))).toBe(true);
    expect(willStars(c, 'blooded-by-the-dead').some((t) => /incapacitation/.test(t) && /level as 2 higher/.test(t))).toBe(true);
    // batch P02: blooded-by-the-dead
    const strike = deriveStrikes(c, db)[0];
    expect(stars(c, { kind: 'strikeDamage', instanceId: strike.instanceId }, 'blooded-by-the-dead').some((t) => /\+2 damage/.test(t) && /piercing/.test(t))).toBe(true);
    // batch P02: blooded-by-the-dead
    expect(recordMarkersFor(c, db, 'condition', 'persistent-damage').some((m) => m.sourceId === 'blooded-by-the-dead' && /DC 2 lower/.test(m.note))).toBe(true);
  });
});

describe('curse-marked: +2 against curses while not cursed', () => {
  // batch P02: curse-marked
  it('curse-marked: saves, skills (hazards) and spell attack (counteract) each carry the +2 / -2 star', () => {
    // AoN background-649: "+2 circumstance bonus on checks made to counteract curses, on saving throws to resist curses,
    // and on any skill check to disable a hazard capable of inflicting a curse. If you are cursed, you instead gain a -2"
    const list = bgField('curse-marked', 'situational') as { targets: { kind: string; detail?: string }[]; bonus: string }[] | undefined;
    // batch P02: curse-marked
    expect(list?.map((s) => s.targets.map((t) => `${t.kind}:${t.detail ?? ''}`).join())).toEqual(['save:all', 'skill:all', 'spell:attack']);
    for (const s of list ?? []) expect(s.bonus).toMatch(/^\+2 circumstance \(-2 circumstance instead while cursed\)$/);
    // batch P02: curse-marked
    expect(willStars(withBg('curse-marked'), 'curse-marked').some((t) => /resist curses/.test(t))).toBe(true);
  });
});

describe('friend-of-a-friend: +2 against poison and disease', () => {
  const ROW = [
    { targets: [{ kind: 'save', detail: 'all' }], when: 'against poison and disease', bonus: '+2 circumstance' },
    { targets: [{ kind: 'spell', detail: 'attack' }], when: 'on checks to counteract a poison or disease', bonus: '+2 circumstance' },
  ];

  // batch P02: friend-of-a-friend#situational
  it('friend-of-a-friend: the shipped background stars saves against poison and disease', () => {
    // AoN background-650: "You gain a +2 circumstance bonus to saving throws against poison and disease,
    // and to any checks made to counteract poison or disease."
    expect(bgField('friend-of-a-friend', 'situational')).toEqual(ROW);
    // batch P02: friend-of-a-friend#situational
    expect(willStars(withBg('friend-of-a-friend'), 'friend-of-a-friend')).toEqual(['+2 circumstance from Friend of a Friend — against poison and disease']);
  });

  // batch P02: friend-of-a-friend#situational
  it('friend-of-a-friend: the record field is the carrier (stripped copy shows no star)', () => {
    const c = withBg('friend-of-a-friend');
    // batch P02: friend-of-a-friend#situational
    expect(willStars(c, 'friend-of-a-friend', withField('backgrounds', 'friend-of-a-friend', 'situational', undefined))).toEqual([]);
    expect(willStars(c, 'friend-of-a-friend', withField('backgrounds', 'friend-of-a-friend', 'situational', ROW)).length).toBe(1);
  });
});

describe('once-possessed: Fiend Lore, the fiend mental-save star and the Spiritual Scar reaction', () => {
  // batch P02: once-possessed#fiend-lore
  it('once-possessed: trains Fiend Lore', () => {
    // AoN background-651: "a Lore skill focused on all fiends ... This Fiend Lore skill"
    expect(bgField('once-possessed', 'trainedLore')).toBe('fiend');
    // batch P02: once-possessed#fiend-lore
    expect(withBg('once-possessed').proficiencies.skills['lore:fiend']).toBe('trained');
  });

  // batch P02: once-possessed#fiend-lore
  it('once-possessed: trainedLore is the carrier (patched copy trains lore:fiend, stripped copy does not)', () => {
    const fiendLore = (con: ContentDatabase) =>
      buildCharacter({ ...emptyBuild(), name: 't', level: 1, classId: 'fighter', ancestryId: Object.keys(db.ancestries)[0], backgroundId: 'once-possessed' }, con)
        .proficiencies.skills['lore:fiend'] ?? 'untrained';
    // batch P02: once-possessed#fiend-lore
    expect(fiendLore(withField('backgrounds', 'once-possessed', 'trainedLore', 'fiend'))).toBe('trained');
    expect(fiendLore(withField('backgrounds', 'once-possessed', 'trainedLore', undefined))).toBe('untrained');
  });

  // batch P02: once-possessed#mental-saves
  it('once-possessed: +2 circumstance to saves against mental effects from fiends', () => {
    // AoN background-651: "You gain a +2 circumstance bonus to saving throws against mental effects from fiends."
    expect(willStars(withBg('once-possessed'), 'once-possessed')).toEqual(['+2 circumstance from Once Possessed — against mental effects from fiends']);
    // batch P02: once-possessed#mental-saves
    expect(willStars(withBg('once-possessed'), 'once-possessed', withField('backgrounds', 'once-possessed', 'situational', undefined))).toEqual([]);
  });

  // batch P02: once-possessed#spiritual-scar
  it('once-possessed: grants the Spiritual Scar reaction once per day', () => {
    // AoN background-651: "Spiritual Scar Reaction (concentrate) Frequency once per day; Trigger You would take spirit damage from a fiend"
    const action = db.actions['spiritual-scar'];
    // batch P02: once-possessed#spiritual-scar
    expect(action?.actionCost).toEqual({ type: 'reaction' });
    expect(action?.traits).toEqual(['concentrate']);
    expect(String(action?.description ?? '')).toContain('twice your level plus your Charisma modifier against the triggering damage');
    // batch P02: once-possessed#spiritual-scar
    expect(bgField('once-possessed', 'grantsActions')).toEqual(['spiritual-scar']);
    expect(bgField('once-possessed', 'limitedUses')).toEqual({ max: 1, per: 'day' });
  });
});

describe('trusted-rival: +2 to Research Bastardhall', () => {
  // batch P02: trusted-rival#research-bonus
  it('trusted-rival: the record carries the Research star and a built character shows it on a skill', () => {
    // AoN background-652: "whenever you attempt any check to Research a topic associated with Bastardhall
    // using the Research subsystem, you gain a +2 circumstance bonus on the check."
    const c = withBg('trusted-rival');
    // batch P02: trusted-rival#research-bonus
    expect(stars(c, { kind: 'skill', skill: 'society' }, 'trusted-rival').some((t) => /^\+2 circumstance from Trusted Rival — to Research a topic associated with Bastardhall/.test(t))).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------- */

const magusWith = (subclassId: string, level = 1) => build('magus', level, { subclassId });
const option = (id: string) =>
  (db.classes['magus']!.subclass!.options as unknown as { id: string; description?: string; descRefs?: { label: string; key: string }[] }[]).find((o) => o.id === id)!;
const desc = (bucket: 'classFeatures' | 'hybridStudy', id: string) =>
  String(((db as unknown as Record<string, Record<string, { description?: string }>>)[bucket] ?? {})[id]?.description ?? '');

describe('aloof-firmament: Cat Fall has one carrier', () => {
  // batch P02: aloof-firmament#cat-fall-duplicate
  it('aloof-firmament: a built magus owns Cat Fall exactly once', () => {
    // AoN hybrid-study-7: "You gain the Cat Fall general feat" - delivered by the subclass option's grantedFeats.
    const ch = magusWith('aloof-firmament');
    // batch P02: aloof-firmament#cat-fall-duplicate
    expect(ch.feats.filter((f) => f.featId === 'cat-fall').length).toBe(1);
    expect(option('aloof-firmament') as unknown as { grantedFeats?: string[] }).toMatchObject({ grantedFeats: ['cat-fall'] });
  });
});

describe('resurgent-maelstrom: the already-has-the-trait riders and the handwraps name', () => {
  const RIDER = [
    {
      targets: [{ kind: 'strikeDamage' }],
      when: 'with an improvised weapon that would already have backstabber (1H) or forceful (2H)',
      bonus: 'backstabber: double its precision damage; forceful: count one more weapon damage die',
    },
  ];
  const dmgStars = (con: ContentDatabase = db) => {
    const c = magusWith('resurgent-maelstrom');
    const strike = deriveStrikes(c, con)[0];
    return stars(c, { kind: 'strikeDamage', instanceId: strike.instanceId }, 'resurgent-maelstrom', con);
  };

  // batch P02: resurgent-maelstrom#trait-already-present
  it('resurgent-maelstrom: the strike-damage star carries the double-precision and one-more-die riders', () => {
    // AoN hybrid-study-9: "if it would already have the backstabber trait, double the amount of additional precision
    // damage ... if it would already have the forceful trait, treat the number of weapon damage dice ... as 1 higher"
    expect((db.classFeatures['resurgent-maelstrom'] as unknown as { situational?: unknown }).situational).toEqual(RIDER);
    // batch P02: resurgent-maelstrom#trait-already-present
    expect(dmgStars().some((t) => /double its precision damage; forceful: count one more weapon damage die/.test(t))).toBe(true);
  });

  // batch P02: resurgent-maelstrom#trait-already-present
  it('resurgent-maelstrom: the class-feature situational field is the carrier (stripped copy has no rider)', () => {
    const stripped = withField('classFeatures', 'resurgent-maelstrom', 'situational', undefined);
    const patched = withField('classFeatures', 'resurgent-maelstrom', 'situational', RIDER);
    // batch P02: resurgent-maelstrom#trait-already-present
    expect(dmgStars(stripped).some((t) => /double its precision damage/.test(t))).toBe(false);
    expect(dmgStars(patched).some((t) => /double its precision damage/.test(t))).toBe(true);
  });

  // batch P02: resurgent-maelstrom#handwraps-name
  it('resurgent-maelstrom: names Handwraps of Mighty Blows, and the ref label resolves to a real item', () => {
    // AoN hybrid-study-9: "like runic body and handwraps of mighty blows, also apply those runes"
    const feature = db.classFeatures['resurgent-maelstrom'] as unknown as { description?: string; descRefs?: { label: string }[] };
    // batch P02: resurgent-maelstrom#handwraps-name
    expect(feature.description).toContain('Handwraps of Mighty Blows');
    expect(feature.description).not.toContain('Might Blows');
    expect(option('resurgent-maelstrom').description).toContain('Handwraps of Mighty Blows');
    // batch P02: resurgent-maelstrom#handwraps-name
    const labels = [...(feature.descRefs ?? []), ...(option('resurgent-maelstrom').descRefs ?? [])].map((r) => r.label);
    expect(labels.filter((l) => /^Handwraps/.test(l))).toEqual(['Handwraps of Mighty Blows', 'Handwraps of Mighty Blows']);
    expect(Object.values(db.items).some((i) => i.name === 'Handwraps of Mighty Blows')).toBe(true);
  });
});

describe('sparkling-targe: the Impossible Magic printing', () => {
  // batch P02: sparkling-targe#description
  it('sparkling-targe: class feature, hybrid-study record and subclass option all read hybrid-study-12', () => {
    // AoN hybrid-study-12: "even a dragon's breath or a force barrage", "damage you take from a spell or other magical
    // effect", "an amount equal to the resistance you have from Arcane Cascade", three Studious Spell lines.
    for (const d of [desc('classFeatures', 'sparkling-targe'), desc('hybridStudy', 'sparkling-targe'), option('sparkling-targe').description ?? '']) {
      // batch P02: sparkling-targe#description
      expect(d).toContain("even a dragon's breath or a force barrage.");
      expect(d).toContain('damage you take from a spell or other magical effect');
      expect(d).toContain("increase your shield's Hardness by an amount equal to the resistance you have from Arcane Cascade.");
      expect(d).not.toMatch(/magic missile|as a result of a spell|extra damage from Arcane Cascade/);
    }
    // batch P02: sparkling-targe#description
    expect(desc('classFeatures', 'sparkling-targe')).toMatch(/\*\*Studious Spell \(7th\)\*\* Resist Energy\n\n\*\*Studious Spell \(11th\)\*\* Warding Aggression\n\n\*\*Studious Spell \(13th\)\*\* Mountain Resilience$/);
    expect(desc('hybridStudy', 'sparkling-targe')).toBe(desc('classFeatures', 'sparkling-targe'));
    expect(option('sparkling-targe').description).toMatch(/\*\*Conflux Spell\*\* Shielding Strike$/);
  });
});
