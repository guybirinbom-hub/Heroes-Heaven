import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { pickerSpellOptions } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, ContentDatabase, SpellcastingEntry } from '../src/rules/types';

/**
 * SPELLS A FEAT WRITES INTO A DEDICATION'S BOOK (follow-up to the dedication books, 585544e, 2026-10-15).
 *
 * Two feat families add a spell to a book that Witch / Necromancer Dedication now carries, and neither
 * reached it:
 *
 *   · Basic / Greater / Major Lesson (feat-4996 / feat-5002 / feat-5010) — *"You gain its associated hex,
 *     and your familiar learns the associated spell."* A Witch Dedication character takes them through Basic
 *     Witchcraft (feat-5101, *"You gain a 1st- or 2nd-level witch feat of your choice"*) and Advanced
 *     Witchcraft (feat-5102). Measured on 585544e: a fighter with Witch Dedication + Basic Witchcraft →
 *     Basic Lesson (Life) got NEITHER the Life Boost hex NOR Spirit Link — the lesson branch ran for slot
 *     feats only, and the class route would have aimed the spell at the class, not the archetype familiar.
 *   · Expanded Necromancy (feat-9132) — *"Add the grisly growths spell to your dirge. Add the following
 *     spells to your dirge as soon as you gain the ability to cast necromancer spells of that rank: 7th:
 *     execute, 8th: desiccate, 9th: massacre."* The record only WIDENED THE LIST (`as: 'list'`), so a
 *     Necromancer Dedication's dirge (reached at 20th through Advanced Death Dealing) never held them, and a
 *     necromancer had to buy them with its own dirge picks.
 *
 * Wanderer's Guide (work/wg/wg-data.sql, read with scripts/wg-show.mjs) encodes both as giveSpell NORMAL
 * into the caster's book source (WITCH / NECROMANCER), Expanded Necromancy's three under LEVEL >= 13/15/17.
 * Ours gates those three on the ENTRY's own castable rank — WG's levels for the class, print's words for the
 * archetype. Where they differ (WG adds them to a level-20 archetype's dirge by character level, even
 * without the slots, massacre included) is owner question #171, and print is followed meanwhile.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character. Every `mutation-proof` leg plants the bad
 * case in memory (a record's field taken away or bent) and restores it.
 */
const db = content();
const gated = content({ trustGate: true });

const pc = (level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST book grants',
    level,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: null,
    ...over,
  }) as BuildState;
const subOf = (db0: ContentDatabase, cls: string) => db0.classes[cls]?.subclass?.options[0]?.id ?? null;

const WITCH_ENTRY = 'witch-dedication-casting';
const NECRO_ENTRY = 'necromancer-dedication-casting';
/** Witch Dedication on a fighter, its spellcasting to Master, Basic Witchcraft at 6th and two Advanced
 *  Witchcraft at 8th / 10th — every slot a lesson can be granted through. */
const WITCH_FEATS = {
  '2:class:0': 'witch-dedication',
  '4:class:1': 'basic-witch-spellcasting',
  '6:class:2': 'basic-witchcraft',
  '8:class:3': 'advanced-witchcraft',
  '10:class:4': 'advanced-witchcraft',
  '12:class:5': 'expert-witch-spellcasting',
  '18:class:6': 'master-witch-spellcasting',
};
const witchDed = (level: number, lesson: { feat: 'basic-lesson' | 'greater-lesson' | 'major-lesson'; value: string; spell?: string }, over: Partial<BuildState> = {}) =>
  pc(level, {
    featPicks: WITCH_FEATS,
    // Basic Lesson under Basic Witchcraft; Greater / Major under an Advanced Witchcraft ("half your level").
    pickFeatChoices: { [lesson.feat === 'basic-lesson' ? '6:class:2' : '10:class:4']: lesson.feat },
    grantedFeatChoices: { [lesson.feat]: lesson.value },
    ...(lesson.spell ? { featSpellChoices: { [`granted:${lesson.feat}:granted-spell`]: lesson.spell } } : {}),
    cantrips: ['daze', 'shield'],
    spells: { 1: ['fear', 'command'] },
    ...over,
  });
const LIFE = { feat: 'basic-lesson', value: 'aon-lesson-of-life' } as const;

/** Advanced Death Dealing at 20th: Expanded Necromancy is a 10th-level feat and "your necromancer level is
 *  equal to half your character level" (feat-9298), so 20th is the first level it can be picked. */
const NECRO_FEATS = {
  '2:class:0': 'necromancer-dedication',
  '4:class:1': 'basic-necromancer-spellcasting',
  '6:class:2': 'basic-death-dealing',
  '12:class:3': 'expert-necromancer-spellcasting',
  '18:class:5': 'master-necromancer-spellcasting',
  '20:class:6': 'advanced-death-dealing',
};
const necroDed = (over: Partial<BuildState> = {}) =>
  pc(20, { featPicks: NECRO_FEATS, pickFeatChoices: { '20:class:6': 'expanded-necromancy' }, cantrips: ['daze', 'shield', 'light', 'void-warp'], spells: { 1: ['fear', 'command'] }, ...over });
const necroClass = (level: number, db0 = db) =>
  pc(level, { classId: 'necromancer', keyAbility: 'int', subclassId: subOf(db0, 'necromancer'), featPicks: { '10:class': 'expanded-necromancy' }, spells: { 1: ['fear'] } });

const entry = (ch: Character, id: string): SpellcastingEntry | undefined => ch.spellcasting.find((e) => e.id === id);
const focusSpells = (ch: Character) => ch.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
const bookSpells = (e: SpellcastingEntry | undefined) => Object.values(e?.spellbook ?? {}).flat();
const rankOf = (id: string) => db.spells[id]?.rank ?? 1;
const lessonId = (value: string) => value.replace(/^aon-/, '');
/** Plant `value` on a record's field for the length of `fn` (undefined deletes it), then restore it. */
function planted<R>(rec: Record<string, unknown>, field: string, value: unknown, fn: () => R): R {
  const had = Object.prototype.hasOwnProperty.call(rec, field);
  const saved = rec[field];
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  try {
    return fn();
  } finally {
    if (had) rec[field] = saved;
    else delete rec[field];
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* the lessons                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

describe('a Witch Dedication character’s lesson teaches the ARCHETYPE familiar', () => {
  // mutation-proof
  it('Basic Witchcraft → Basic Lesson (Life): Spirit Link in the familiar’s 1st-rank page, a grant from Lesson of Life, and the Life Boost hex', () => {
    const ch = buildCharacter(witchDed(6, LIFE), db);
    const e = entry(ch, WITCH_ENTRY);
    expect(e, 'fixture: the archetype familiar').toBeTruthy();
    expect(e?.spellbook?.[1]).toEqual(['fear', 'command', 'spirit-link']);
    expect(e?.grantedRepertoire?.[1], 'marked as a grant, not one of the two picks').toEqual(['spirit-link']);
    expect(e?.spellSources?.['spirit-link']).toBe('Lesson of Life');
    expect(e?.repertoire, 'a prepared book never grows a repertoire row').toBeUndefined();
    expect(focusSpells(ch), 'the hex half of the lesson').toContain('life-boost');
    // Planted: the lesson without its taught spell teaches nothing — the familiar's page is the two picks.
    planted(db.classFeatures['lesson-of-life'] as unknown as Record<string, unknown>, 'grantedSpells', undefined, () => {
      expect(entry(buildCharacter(witchDed(6, LIFE), db), WITCH_ENTRY)?.spellbook?.[1]).toEqual(['fear', 'command']);
    });
  });

  it('it is PREPARABLE: the sheet’s 1st-rank slot offers Spirit Link out of the familiar', () => {
    const ch = buildCharacter(witchDed(6, LIFE), db);
    const ov = applyPlayState(ch, initialPlay(ch, db), db);
    const e = entry(ov, WITCH_ENTRY)!;
    const offered = pickerSpellOptions({ character: ov, entry: e, content: db }, 1, undefined, enabledBookSet(undefined)).map((s) => s.id);
    expect(offered).toContain('spirit-link');
    expect(entry(ov, WITCH_ENTRY)?.spellSources?.['spirit-link'], 'the play overlay keeps the attribution').toBe('Lesson of Life');
  });

  it('every lesson Basic / Greater / Major Lesson offers lands in the familiar — its taught spell(s) and its hex', () => {
    const cases: { feat: 'basic-lesson' | 'greater-lesson' | 'major-lesson'; level: number }[] = [
      { feat: 'basic-lesson', level: 6 },
      { feat: 'greater-lesson', level: 12 },
      { feat: 'major-lesson', level: 20 },
    ];
    let checked = 0;
    for (const { feat, level } of cases) {
      for (const opt of db.feats[feat].choice?.options ?? []) {
        const rec = db.classFeatures[lessonId(opt.value)];
        expect(rec, `${feat} offers ${opt.value}, which is no class feature`).toBeTruthy();
        const pick = rec.grantedSpellChoice?.options[0];
        const ch = buildCharacter(witchDed(level, { feat, value: opt.value, spell: pick }), db);
        const e = entry(ch, WITCH_ENTRY);
        const taught = [...(Array.isArray(rec.grantedSpells) ? rec.grantedSpells : []), ...(pick ? [pick] : [])];
        for (const sid of taught) {
          expect(e?.spellbook?.[rankOf(sid)], `${feat} → ${rec.name}: ${sid} in the familiar`).toContain(sid);
          expect(e?.grantedRepertoire?.[rankOf(sid)], `${rec.name}: ${sid} marked as a grant`).toContain(sid);
          expect(e?.spellSources?.[sid]).toBe(rec.name);
          checked++;
        }
        for (const hex of rec.focusSpells ?? []) expect(focusSpells(ch), `${feat} → ${rec.name}: the ${hex} hex`).toContain(hex);
      }
    }
    expect(checked, 'fixture: the lessons that teach a spell were walked').toBeGreaterThanOrEqual(14);
  });

  // mutation-proof
  it('Lesson of the Elements granted under Basic Witchcraft: the answer to its own "or" (`granted:<feat>:granted-spell`) is the spell taught', () => {
    const elements = { feat: 'basic-lesson', value: 'aon-lesson-of-elements' } as const;
    const e = entry(buildCharacter(witchDed(6, { ...elements, spell: 'gust-of-wind' }), db), WITCH_ENTRY);
    expect(e?.spellbook?.[1]).toContain('gust-of-wind');
    expect(e?.spellSources?.['gust-of-wind']).toBe('Lesson of the Elements');
    // Unanswered, or answered with a spell that is not one of the four: nothing is taught.
    expect(bookSpells(entry(buildCharacter(witchDed(6, elements), db), WITCH_ENTRY))).not.toContain('gust-of-wind');
    expect(bookSpells(entry(buildCharacter(witchDed(6, { ...elements, spell: 'fireball' }), db), WITCH_ENTRY))).not.toContain('fireball');
  });

  it('REMOVAL is symmetric: Basic Witchcraft gone from its slot (the answer left behind) takes the hex and the spell with it', () => {
    // setFeat does not clear `pickFeatChoices`, so the stale answer is the realistic shape.
    const stale = witchDed(6, LIFE, { featPicks: { ...WITCH_FEATS, '6:class:2': 'basic-witch-spellcasting' } });
    const ch = buildCharacter(stale, db);
    expect(ch.feats.some((f) => f.featId === 'basic-lesson'), 'fixture: the lesson is not granted').toBe(false);
    expect(bookSpells(entry(ch, WITCH_ENTRY))).not.toContain('spirit-link');
    expect(focusSpells(ch)).not.toContain('life-boost');
  });

  /* Checker finding 2026-10-15: the early "is the granter held" test only asked that the slot held SOME
   * pick-a-feat feat, so each of these kept the lesson's hex and a Focus Point the build had dropped. */
  it('…and a granter that may NOT pick the lesson grants nothing: another pick-a-feat feat in the slot, Advanced Witchcraft below the lesson’s level, a second pick its spec never makes', () => {
    const cases: [string, BuildState][] = [
      ['slot swapped to Basic Arcana (a pick-a-feat feat of another class), answer left behind', witchDed(6, LIFE, { featPicks: { ...WITCH_FEATS, '6:class:2': 'basic-arcana' } })],
      [
        'Greater Lesson under Advanced Witchcraft at 11th (half level 5 < the feat’s 6)',
        witchDed(11, { feat: 'greater-lesson', value: 'aon-lesson-of-snow' }, { pickFeatChoices: { '8:class:3': 'greater-lesson' } }),
      ],
      ['a "#1" answer Basic Witchcraft (one pick) never makes', witchDed(6, LIFE, { pickFeatChoices: { '6:class:2#1': 'basic-lesson' } })],
    ];
    for (const [label, b] of cases) {
      const ch = buildCharacter(b, db);
      expect(ch.feats.some((f) => /-lesson$/.test(f.featId)), `${label}: fixture — the pick walk grants no lesson`).toBe(false);
      expect(focusSpells(ch), `${label}: no hex`).toEqual([]);
      expect(ch.focus?.max ?? 0, `${label}: no Focus Point`).toBe(0);
      expect(Object.values(entry(ch, WITCH_ENTRY)?.grantedRepertoire ?? {}).flat(), `${label}: no familiar spell`).toEqual([]);
    }
    // Final check 2026-10-15: an answer saved under the granter's bare id (before picks were keyed by slot)
    // counts only where the walk would read it — a taking at or below this level with no slot answer.
    const bare = { 'basic-witchcraft': 'basic-lesson' };
    const oldBeside = buildCharacter(witchDed(6, LIFE, { pickFeatChoices: { ...bare, '6:class:2': 'wortwitch' } }), db);
    expect(oldBeside.feats.some((f) => f.featId === 'wortwitch'), 'fixture: the slot answer wins').toBe(true);
    expect(focusSpells(oldBeside), 'the old bare-id lesson teaches nothing').toEqual([]);
    const early = buildCharacter(witchDed(6, LIFE, { featPicks: { ...WITCH_FEATS, '6:class:2': 'basic-witch-spellcasting', '8:class:3': 'basic-witchcraft' }, pickFeatChoices: bare }), db);
    expect(focusSpells(early), 'Basic Witchcraft in an 8th-level slot on a 6th-level character').toEqual([]);
    // …a bare answer behind a SECOND Basic Witchcraft slot the walk drops (the first answered Wortwitch):
    const dropped = buildCharacter(witchDed(8, LIFE, { featPicks: { ...WITCH_FEATS, '8:class:3': 'basic-witchcraft' }, pickFeatChoices: { ...bare, '6:class:2': 'wortwitch' } }), db);
    expect(focusSpells(dropped), 'a dropped slot does not read the bare answer').toEqual([]);
    // …and a NULL slot answer falls through to the bare one, as the walk's `slot ?? bare` does.
    const nulled = buildCharacter(witchDed(6, LIFE, { pickFeatChoices: { '6:class:2': null as unknown as string, ...bare } }), db);
    expect(nulled.feats.some((f) => f.featId === 'basic-lesson'), 'fixture: the walk grants it').toBe(true);
    expect(focusSpells(nulled)).toContain('life-boost');
    const legacy = buildCharacter(witchDed(6, LIFE, { pickFeatChoices: bare }), db);
    expect(focusSpells(legacy), 'control: a legacy save with only the bare-id answer keeps its lesson').toContain('life-boost');
    expect(bookSpells(entry(legacy, WITCH_ENTRY))).toContain('spirit-link');
    // A SECOND Basic Witchcraft slot the walk drops (Basic Witchcraft is not repeatable): its answer is never read.
    const twice = buildCharacter(witchDed(8, LIFE, { featPicks: { ...WITCH_FEATS, '8:class:3': 'basic-witchcraft' }, pickFeatChoices: { '8:class:3': 'basic-lesson' } }), db);
    expect(twice.feats.some((f) => f.featId === 'basic-lesson'), 'fixture: the dropped slot grants nothing').toBe(false);
    expect(focusSpells(twice)).toEqual([]);
    // Overrides: Basic Witchcraft added through Overrides answers under its synthetic slot `override:<id>` …
    const NO6 = { ...WITCH_FEATS, '6:class:2': 'basic-witch-spellcasting' };
    const added = { overrides: { addedFeats: [{ featId: 'basic-witchcraft', level: 6, category: 'class' }] } } as unknown as Partial<BuildState>;
    const viaOverride = buildCharacter(witchDed(6, LIFE, { featPicks: NO6, ...added, pickFeatChoices: { 'override:basic-witchcraft': 'basic-lesson' } }), db);
    expect(viaOverride.feats.some((f) => f.featId === 'basic-lesson'), 'fixture: the walk grants it').toBe(true);
    expect(focusSpells(viaOverride), 'an Overrides-added Basic Witchcraft teaches its lesson').toContain('life-boost');
    // … and the Overrides copy is dropped when a slot already holds the feat, so its answer is never read.
    const shadowed = buildCharacter(witchDed(6, LIFE, { ...added, pickFeatChoices: { 'override:basic-witchcraft': 'basic-lesson' } }), db);
    expect(shadowed.feats.some((f) => f.featId === 'basic-lesson'), 'fixture: the slot copy wins, unanswered').toBe(false);
    expect(focusSpells(shadowed)).toEqual([]);
    // Control: the same Greater Lesson at 12th (half level 6) is legal and teaches.
    const legal = buildCharacter(witchDed(12, { feat: 'greater-lesson', value: 'aon-lesson-of-snow' }, { pickFeatChoices: { '8:class:3': 'greater-lesson' } }), db);
    expect(focusSpells(legal)).toContain('personal-blizzard');
    expect(bookSpells(entry(legal, WITCH_ENTRY))).toContain('wall-of-wind');
  });

  it('a WIZARD with Witch Dedication: the lesson teaches the witch familiar, never the wizard’s spellbook', () => {
    const b = witchDed(6, LIFE, {
      classId: 'wizard',
      keyAbility: 'int',
      subclassId: subOf(db, 'wizard'),
      cantrips: [],
      spells: {},
      archetypeSpells: { cantrips: ['daze', 'shield'], spells: { 1: ['fear', 'command'] }, tradition: null, keyAbility: null } as unknown as BuildState['archetypeSpells'],
    });
    const ch = buildCharacter(b, db);
    expect(entry(ch, WITCH_ENTRY)?.spellbook?.[1]).toContain('spirit-link');
    expect(bookSpells(entry(ch, 'wizard-casting')), 'not the wizard’s book').not.toContain('spirit-link');
    // …and the reverse build keeps the two stores apart, the grant in neither.
    const back = deriveBuildFromCharacter(ch, db);
    expect(back.archetypeSpells?.spells?.[1]).toEqual(['fear', 'command']);
    expect(Object.values(back.spells ?? {}).flat()).not.toContain('spirit-link');
  });

  it('the reverse build does not read a lesson’s spell back as a player pick (archetype familiar)', () => {
    const back = deriveBuildFromCharacter(buildCharacter(witchDed(6, LIFE), db), db);
    expect(back.spells?.[1]).toEqual(['fear', 'command']);
  });
});

describe('a WITCH’s own lesson (the class route, unchanged in place, now marked as a grant)', () => {
  const witch = (level: number, slot: string, feat: string, value: string) =>
    pc(level, { classId: 'witch', keyAbility: 'int', subclassId: subOf(db, 'witch'), featPicks: { [slot]: feat }, featChoices: { [slot]: value }, spells: { 1: ['fear'] } });

  it('Basic Lesson (Life): Spirit Link in the witch’s familiar, a grant, and not read back as a pick', () => {
    const ch = buildCharacter(witch(4, '2:class', 'basic-lesson', 'aon-lesson-of-life'), db);
    const e = entry(ch, 'witch-casting');
    expect(e?.spellbook?.[1]).toContain('spirit-link');
    expect(e?.grantedRepertoire?.[1]).toContain('spirit-link');
    expect(e?.spellSources?.['spirit-link']).toBe('Lesson of Life');
    expect(entry(ch, WITCH_ENTRY), 'no archetype entry').toBeUndefined();
    expect(deriveBuildFromCharacter(ch, db).spells?.[1], 'the reverse build: the player’s fear only').toEqual(['fear']);
  });

  it('a witch who ALSO learned Spirit Link by hand keeps it as their own: not marked a grant, and kept by the reverse build', () => {
    const b = { ...witch(4, '2:class', 'basic-lesson', 'aon-lesson-of-life'), spells: { 1: ['spirit-link', 'fear'] } } as BuildState;
    const ch = buildCharacter(b, db);
    const e = entry(ch, 'witch-casting');
    expect(e?.spellbook?.[1]).toContain('spirit-link');
    expect(Object.values(e?.grantedRepertoire ?? {}).flat(), 'the player’s own pick is never recorded as the lesson’s').not.toContain('spirit-link');
    expect(deriveBuildFromCharacter(ch, db).spells?.[1]?.slice().sort()).toEqual(['fear', 'spirit-link']);
  });

  // mutation-proof
  it('Major Lesson: Death teaches Raise Dead, Renewal Field of Life, the Frozen Queen Wall of Ice (print + WG; were missing)', () => {
    for (const [value, sid] of [
      ['aon-lesson-of-death', 'raise-dead'],
      ['aon-lesson-of-renewal', 'field-of-life'],
      ['aon-lesson-of-the-frozen-queen', 'wall-of-ice'],
    ] as const) {
      const e = entry(buildCharacter(witch(10, '10:class', 'major-lesson', value), db), 'witch-casting');
      expect(e?.spellbook?.[rankOf(sid)], `${value} → ${sid}`).toContain(sid);
      planted(db.classFeatures[lessonId(value)] as unknown as Record<string, unknown>, 'grantedSpells', undefined, () => {
        expect(bookSpells(entry(buildCharacter(witch(10, '10:class', 'major-lesson', value), db), 'witch-casting')), `planted: ${value} without the row`).not.toContain(sid);
      });
    }
  });
});

/**
 * THE DATA, against print. Every lesson whose own text says *"your familiar learns X"* carries X — as
 * `grantedSpells`, or as the `grantedSpellChoice` its "your choice of …" form needs. The five below print a
 * familiar spell and Wanderer's Guide carries NO row for them at all (wg-show: "No ability_block row"), so
 * there is nothing of theirs to match (R10) and a mechanic WG lacks ships dark under the trust gate (R17):
 * they are left as they are, named here so a sixth cannot join them unnoticed and a fix to one must take it
 * off this list.
 */
const PRINT_ONLY_NO_WG_ROW = ['lesson-of-bargains', 'lesson-of-calamity', 'lesson-of-favors', 'lesson-of-memory', 'lesson-of-vows'];

describe('every lesson that teaches its familiar a spell carries it', () => {
  it('"your familiar learns X" → grantedSpells [X] (or a grantedSpellChoice for "your choice of …")', () => {
    const missing: string[] = [];
    const wrong: string[] = [];
    const byName = new Map(Object.values(db.spells).map((s) => [s.name.toLowerCase().replace(/[’']/g, "'"), s.id]));
    const lessons = Object.entries(db.classFeatures).filter(([id]) => id.startsWith('lesson-of-'));
    expect(lessons.length, 'fixture: the 19 lessons').toBeGreaterThanOrEqual(19);
    for (const [id, rec] of lessons) {
      const text = String(rec.description ?? '').replace(/\s+/g, ' ');
      const m = /your familiar learns (your choice of )?([^.]+)\./i.exec(text);
      if (!m) continue;
      if (m[1]) {
        if (!rec.grantedSpellChoice?.options?.length) missing.push(`${id}: prints a choice, carries no grantedSpellChoice`);
        continue;
      }
      const sid = byName.get(m[2].trim().toLowerCase().replace(/[’']/g, "'"));
      const flat = Array.isArray(rec.grantedSpells) ? rec.grantedSpells : [];
      if (!flat.length) missing.push(id);
      else if (sid && !flat.includes(sid)) wrong.push(`${id}: print names ${sid}, record carries ${flat.join(', ')}`);
    }
    expect(wrong).toEqual([]);
    expect(missing.sort(), 'a lesson printing a familiar spell with no carrier — add a row, or (no WG row) list it here').toEqual(PRINT_ONLY_NO_WG_ROW);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* Expanded Necromancy                                                                               */
/* ------------------------------------------------------------------------------------------------ */

describe('Expanded Necromancy writes INTO the dirge', () => {
  // mutation-proof
  it('Necromancer Dedication at 20th (Advanced Death Dealing → Expanded Necromancy): grisly growths, execute and desiccate in the dirge — not massacre (owner question #171)', () => {
    const ch = buildCharacter(necroDed(), db);
    expect(ch.feats.some((f) => f.featId === 'expanded-necromancy' && f.grantedBy === 'advanced-death-dealing'), 'fixture: granted by Advanced Death Dealing').toBe(true);
    const e = entry(ch, NECRO_ENTRY);
    expect(Object.keys(e?.prepared ?? {}), 'fixture: the archetype casts up to 8th rank').toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(e?.spellbook?.[5]).toEqual(['grisly-growths']);
    expect(e?.spellbook?.[7]).toEqual(['execute']);
    expect(e?.spellbook?.[8]).toEqual(['desiccate']);
    expect(bookSpells(e), 'massacre: "as soon as you gain the ability to cast necromancer spells of that rank" — never, for the archetype').not.toContain('massacre');
    expect(e?.grantedRepertoire).toEqual({ 5: ['grisly-growths'], 7: ['execute'], 8: ['desiccate'] });
    expect(e?.spellSources?.['grisly-growths']).toBe('Expanded Necromancy');
    expect(e?.repertoire, 'a prepared book never grows a repertoire row').toBeUndefined();
    // Planted: the gate taken off the data row, massacre arrives (proves the gate, not the rank table, keeps it out).
    const rows = db.feats['expanded-necromancy'].spellListAdditions as { whenCastable?: string[] }[];
    const bent = rows.map((r) => ({ ...r, whenCastable: undefined }));
    planted(db.feats['expanded-necromancy'] as unknown as Record<string, unknown>, 'spellListAdditions', bent, () => {
      expect(bookSpells(entry(buildCharacter(necroDed(), db), NECRO_ENTRY))).toContain('massacre');
    });
  });

  it('without Master Necromancer Spellcasting the dirge cannot cast 7th/8th rank, so it gets grisly growths alone (owner question #171)', () => {
    const { '18:class:5': _master, ...expertOnly } = NECRO_FEATS;
    const e = entry(buildCharacter(necroDed({ featPicks: expertOnly }), db), NECRO_ENTRY);
    expect(Object.keys(e?.prepared ?? {}).map(Number).every((r) => r <= 6), 'fixture: Expert reaches 6th rank at most').toBe(true);
    expect(Object.values(e?.grantedRepertoire ?? {}).flat()).toEqual(['grisly-growths']);
  });

  it('…and the dirge, read back, gives the player’s own picks only', () => {
    const back = deriveBuildFromCharacter(buildCharacter(necroDed(), db), db);
    expect(Object.values(back.spells ?? {}).flat().sort()).toEqual(['command', 'fear']);
  });

  it('REMOVAL is symmetric: no Expanded Necromancy, none of the four', () => {
    const ch = buildCharacter(necroDed({ pickFeatChoices: {} }), db);
    const all = bookSpells(entry(ch, NECRO_ENTRY));
    for (const sid of ['grisly-growths', 'execute', 'desiccate', 'massacre']) expect(all).not.toContain(sid);
  });

  // mutation-proof
  it('a NECROMANCER: grisly growths at once; execute at 13th, desiccate at 15th, massacre at 17th — WG’s LEVEL >= 13/15/17', () => {
    const at = (lvl: number) => bookSpells(entry(buildCharacter(necroClass(lvl), db), 'necromancer-casting'));
    expect(at(12)).toContain('grisly-growths');
    expect(at(12)).not.toContain('execute');
    expect(at(13)).toContain('execute');
    expect(at(14)).not.toContain('desiccate');
    expect(at(15)).toContain('desiccate');
    expect(at(16)).not.toContain('massacre');
    expect(at(17)).toContain('massacre');
    const ch = buildCharacter(necroClass(17), db);
    expect(entry(ch, 'necromancer-casting')?.repertoire, 'the class dirge stays a prepared book').toBeUndefined();
    expect(ch.spellListAdditions?.['*'] ?? [], 'no longer a list widening the player pays for').not.toContain('grisly-growths');
    // Every rank, not rank 1: the four sit at 5th/7th/8th/9th, where a rank-1 check could never see them.
    expect(Object.values(deriveBuildFromCharacter(ch, db).spells ?? {}).flat(), 'the player’s fear only — harm and the four are the class’s / the feat’s').toEqual(['fear']);
    // Planted: the old encoding — a list widening — puts nothing in the dirge.
    planted(db.feats['expanded-necromancy'] as unknown as Record<string, unknown>, 'spellListAdditions', { spells: ['grisly-growths', 'execute', 'desiccate', 'massacre'], as: 'list' }, () => {
      expect(at(17)).not.toContain('grisly-growths');
    });
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* the app Guy runs is the TRUST-GATED one                                                           */
/* ------------------------------------------------------------------------------------------------ */

describe('under the trust gate (what the app ships)', () => {
  it('the lesson and Expanded Necromancy still reach their books', () => {
    const w = buildCharacter(witchDed(6, LIFE), gated);
    expect(entry(w, WITCH_ENTRY)?.spellbook?.[1]).toContain('spirit-link');
    expect(focusSpells(w)).toContain('life-boost');
    const n = entry(buildCharacter(necroDed(), gated), NECRO_ENTRY);
    expect(n?.spellbook?.[5]).toContain('grisly-growths');
    expect(bookSpells(entry(buildCharacter(necroClass(17, gated), gated), 'necromancer-casting'))).toContain('massacre');
    const d = entry(buildCharacter(pc(10, { classId: 'witch', keyAbility: 'int', subclassId: subOf(gated, 'witch'), featPicks: { '10:class': 'major-lesson' }, featChoices: { '10:class': 'aon-lesson-of-death' } }), gated), 'witch-casting');
    expect(d?.spellbook?.[6]).toContain('raise-dead');
  });
});
