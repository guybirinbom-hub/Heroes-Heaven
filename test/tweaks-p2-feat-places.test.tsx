/*
 * Tweaks phase 2, WP7 RUN 1 — the ENGINE of "Extra feat places" (`choice.addPlace`, place 'feat'; plan
 * work/tweaks-phase2-notes/plan.md WP7 steps 1, 2, 4 and 6b; C8-C11). Synthetic characters only.
 *
 * A place's pick lives at `featPicks["<level>:extra<category>:<n>"]`; the block holds `{place:'feat', level, category,
 * n}` and the key is derived. Pinned here:
 *   - each category offers that category's list (and an extra archetype pick counts for the dedication rule);
 *   - the feat counts while the place is live and stops while it is paused or Tweaks are off, its key byte for byte
 *     the same (nothing writes on a pause); a key with no block, or an unreadable / newer one, counts (UNKNOWN ≠ EMPTY);
 *   - no slot toggle ever moves a place pick into a real slot or empties a real one; two tabs adding a place keep two;
 *   - changeAncestry drops an extra ancestry place's pick; the book twin gives equal numbers; a filled place fits its
 *     own place; an impulse place on a dual gate takes either element;
 *   - a granter in a paused / off place equals the character without it (every SLOT_KEYED answer under its key gone);
 *   - the two views: a paused place's Fleet still takes the cap, with the 6b words; a given Fleet beside it counts once;
 *     pausing Ultimate Flexibility moves no slot; the Character.feats row keeps the raw `extra<category>`;
 *   - levelChoices owes an empty LIVE place only, after the level's book slots.
 * The Builder's place card, drawnKeys and the round trip (Character.tweakKept) are RUN 2 / RUN 3.
 */
import { describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { buildCharacter, dedicationBlock, emptyBuild, levelChoices, takenForDedicationRule, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { featPlaceKey, heldBackPlaceKeys, placeLiveForKey } from '../src/rules/blocks/active';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import { writeChoiceTweak, writeTweak } from '../src/rules/blocks/write';
import {
  eligibleFeatsForSlot,
  fitsSlot,
  moveTargetFor,
  printedFeatPlaces,
  printedSlotKey,
  rekeyFeatSlots,
  slotBookRefusals,
  slotRefOf,
  slotRefusal,
  SLOT_KEYED,
} from '../src/rules/featSlots';
import { heldFeatSlots, slotCategoryOf } from '../src/rules/heldFeats';
import { deriveMaxHp, deriveSpeeds } from '../src/rules/derive';
import { KINETIC_ELEMENTS } from '../src/rules/kineticElements';
import { useBuilderActions } from '../src/builder/shared';
import { mergeRosterEdits } from '../src/data/rosterMerge';
import type { BuildOverrides, Character } from '../src/rules/types';

const db = content();
let seq = 0;
/** One `choice.addPlace` feat block (`on: false` = paused). */
const placeBlock = (level: number, category: string, n: number, on = true) => ({
  id: `t${++seq}_wp7pl${String(seq).padStart(2, '0')}`,
  kind: 'choice.addPlace',
  v: 1,
  place: 'feat',
  level,
  category,
  n,
  ...(on ? {} : { on: false }),
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const featIds = (ch: Character) => (ch.feats ?? []).map((f) => f.featId);
const ids = (b: BuildState, key: string) => eligibleFeatsForSlot(b, db, slotRefOf(key)!).map((f) => f.id).sort();
const owes = (b: BuildState, level: number, label: string) => levelChoices(b, db).some((c) => c.page === level && c.label.endsWith(`— ${label}`));

/** A synthetic character (the Tweaks harness's `hero`, inlined so this file needs no DOM). */
function hero(classId: string, level: number, overrides?: BuildOverrides, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  const b = {
    ...emptyBuild(),
    name: 'WP7 place fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    options: { overridesEnabled: true },
    ...more,
    ...(overrides ? { overrides } : {}),
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

/** A fighter at `level` with one extra place holding `featId` (live, or paused with `on: false`). */
function withPlace(level: number, category: string, n: number, featId: string | null, on = true, more: Partial<BuildState> = {}, classId = 'fighter', charLevel = Math.max(level, 4)) {
  const key = featPlaceKey(level, category, n);
  const b = hero(classId, charLevel, ov(placeBlock(level, category, n, on)), more);
  if (featId) b.featPicks = { ...b.featPicks, [key]: featId };
  return { b, key };
}

/** Every SLOT_KEYED map of `b` with every entry under `key` (the key itself, `key#…`, `key:…`) deleted. */
function withoutKey(b: BuildState, key: string): BuildState {
  const out = { ...b } as Record<string, unknown>;
  for (const f of SLOT_KEYED) {
    const map = (b as unknown as Record<string, Record<string, unknown> | undefined>)[f];
    if (!map) continue;
    out[f] = Object.fromEntries(Object.entries(map).filter(([k]) => !(k === key || k.startsWith(`${key}#`) || k.startsWith(`${key}:`))));
  }
  return out as unknown as BuildState;
}

describe('WP7 C10: an extra place fits its own place', () => {
  it('slotCategoryOf / slotRefOf read the book category and say "extra place"', () => {
    expect(slotCategoryOf('4:extraclass:483920')).toBe('class');
    expect(slotCategoryOf('4:class:0')).toBe('class');
    expect(slotCategoryOf('4:extra:1'), 'a bare "extra" is no place category').toBe('extra');
    expect(slotRefOf('4:extraclass:483920')).toEqual({ level: 4, category: 'class', idx: 483920, key: '4:extraclass:483920', place: true });
    expect(slotRefOf('4:class:0')).toEqual({ level: 4, category: 'class', idx: 0, key: '4:class:0', place: false });
    expect(slotRefOf('override:fleet')).toBeNull();
  });

  it('each category draws and offers that category list: the place offers what the book slot of its level and category offers', () => {
    // Free Archetype on, so the archetype place has a book twin at its level; mythic has its own character.
    const cats: [string, number][] = [
      ['ancestry', 5],
      ['class', 4],
      ['general', 7],
      ['skill', 8],
      ['archetype', 4],
      ['bonus', 9],
    ];
    let n = 483900;
    for (const [cat, level] of cats) {
      const base = hero('fighter', 9, undefined, { variantRules: { freeArchetype: true } });
      const key = featPlaceKey(level, cat, ++n);
      const b = { ...base, overrides: ov(placeBlock(level, cat, n)) } as BuildState;
      const book = printedSlotKey(b, db, level, cat, 0)!;
      expect(book, `${cat}: fixture has a book ${cat} slot at ${level}`).toBeTruthy();
      const offered = ids(b, key);
      expect(offered.length, cat).toBeGreaterThan(0);
      expect(offered, `${cat}: the place's list is the book slot's list`).toEqual(ids(b, book));
    }
    const m = hero('fighter', 12, undefined, { mythicEnabled: true });
    const mythic = printedFeatPlaces(m, db).find((p) => p.category === 'mythic')!;
    expect(mythic, 'fixture: a mythic slot').toBeTruthy();
    const mKey = featPlaceKey(mythic.level, 'mythic', 483999);
    const mb = { ...m, overrides: ov(placeBlock(mythic.level, 'mythic', 483999)) } as BuildState;
    expect(ids(mb, mKey)).toEqual(ids(mb, mythic.key));
  });

  it('a filled extra class place fits (no "Not valid for this slot"), keeps its own feat in its list, and is never a move target', () => {
    const { b, key } = withPlace(4, 'class', 483936, 'snagging-strike');
    expect(fitsSlot(b, db, key, key)).toBe(true);
    expect(slotBookRefusals(b, db, key)).toEqual([]);
    expect(ids(b, key)).toContain('snagging-strike');
    expect(moveTargetFor(b, db, key), 'a place pick is never moved to a book slot').toBeNull();
    // …and a general feat in it is refused by the class list, as in a book class slot
    const wrong = withPlace(4, 'class', 483937, 'toughness').b;
    expect(fitsSlot(wrong, db, '4:extraclass:483937', '4:extraclass:483937')).toBe(false);
  });

  // Decision (wp7-report.md "Deviations"): the class's restrictedSkillFeatLevels narrows ITS OWN skill-feat slots;
  // an extra skill place offers the whole skill list, as each place category offers its category's list.
  it("an extra SKILL place is not narrowed by the class's Skillful Lessons / Stylish Tricks; the book skill slot at that level is", () => {
    const ATHLETICS = 'combat-climber';
    for (const [classId, level] of [['investigator', 3], ['swashbuckler', 3]] as const) {
      expect(db.classes[classId].restrictedSkillFeatLevels?.levels, `fixture: ${classId} narrows level ${level}`).toContain(level);
      const { b, key } = withPlace(level, 'skill', 483945, null, true, {}, classId, level);
      const book = printedSlotKey(b, db, level, 'skill', 0)!;
      expect(book, `fixture: ${classId} has a book skill slot at ${level}`).toBeTruthy();
      const bookList = slotRefusal(b, db, slotRefOf(book)!)(db.feats[ATHLETICS]).filter((r) => r.rule === 'list');
      expect(bookList.map((r) => r.words), `${classId}: the book slot refuses an Athletics feat`).toEqual(["Not for one of this place's skills"]);
      expect(ids(b, book), classId).not.toContain(ATHLETICS);
      expect(ids(b, key), `${classId}: the extra place offers it`).toContain(ATHLETICS);
      const filled = { ...b, featPicks: { ...b.featPicks, [key]: ATHLETICS } } as BuildState;
      expect(fitsSlot(filled, db, key, key), classId).toBe(true);
    }
  });

  it('an impulse place on a dual gate takes either element; the book pair stays bound; a single gate keeps its element', () => {
    const AIR = 'aerial-boomerang';
    const FIRE = 'burning-jet';
    const kin = (gate: 'dual' | 'single', featId: string | null, extra: Partial<BuildState> = {}) =>
      withPlace(1, 'impulse', 483940, featId, true, {
        ancestryId: 'human',
        keyAbility: 'con',
        extraChoices: { element: gate === 'dual' ? ['air-gate', 'fire-gate'] : ['air-gate'] },
        featChoices: { 'feature:kinetic-gate': gate },
        ...extra,
      }, 'kineticist', 1);
    for (const id of [AIR, FIRE]) {
      const { b, key } = kin('dual', id);
      expect(fitsSlot(b, db, key, key), id).toBe(true);
      expect(ids(b, key), id).toContain(id);
    }
    // the book pair: still air then fire
    const { b: dual } = kin('dual', null);
    const pair = printedFeatPlaces(dual, db).filter((p) => p.category === 'impulse');
    const elementsOf = (key: string) => {
      const offers = eligibleFeatsForSlot(dual, db, slotRefOf(key)!);
      return KINETIC_ELEMENTS.filter((e) => offers.length > 0 && offers.every((f) => f.traits.includes(e))).join('+');
    };
    expect(pair.map((p) => elementsOf(p.key))).toEqual(['air', 'fire']);
    const { b: single, key } = kin('single', FIRE);
    expect(fitsSlot(single, db, key, key), 'a single air gate: no fire impulse in its place').toBe(false);
  });
});

describe('WP7 C9: the feat counts live and stops paused / off, its key byte for byte', () => {
  it('Toughness: live adds its HP; paused or Tweaks off adds nothing; the pause and the switch write no pick', () => {
    const plain = hero('fighter', 4);
    const { b: live, key } = withPlace(4, 'general', 483920, 'toughness');
    const blockKey = `blocks:${(live.overrides!.blocks as { id: string }[])[0].id}`;
    expect(featIds(built(live))).toContain('toughness');
    expect(deriveMaxHp(built(live), db)).toBe(deriveMaxHp(built(plain), db) + 4);
    // the pause through the write door, then the Builder's own setBuild path (rekeyFeatSlots)
    const w = writeTweak(live, { op: 'setOn', key: blockKey, on: false });
    expect(w.refused).toBeUndefined();
    const pausedRaw = { ...live, overrides: w.overrides } as BuildState;
    const switchedRaw = off(live);
    for (const [name, raw] of [['paused', pausedRaw], ['off', switchedRaw]] as const) {
      const next = rekeyFeatSlots(live, raw, db);
      for (const f of SLOT_KEYED) expect(JSON.stringify(next[f] ?? null), `${name}: ${f} byte-equal`).toBe(JSON.stringify(live[f] ?? null));
      expect(next.featPicks[key]).toBe('toughness');
      expect(placeLiveForKey(next, key), name).toBe(false);
      expect(featIds(built(next)), name).not.toContain('toughness');
      expect(deriveMaxHp(built(next), db), name).toBe(deriveMaxHp(built(plain), db));
    }
  });

  it('noblock: a place key with no block, an unreadable block or a newer one counts (UNKNOWN ≠ EMPTY), paused or not', () => {
    const key = featPlaceKey(4, 'general', 483925);
    const none = { ...hero('fighter', 4, ov()), featPicks: { [key]: 'toughness' } } as BuildState;
    expect(featIds(built(none))).toContain('toughness');
    expect(heldBackPlaceKeys(none).size).toBe(0);
    // an unreadable category (familiar) and a newer place (cantrip), both paused: neither is a block this app can read
    const odd = [
      { key: '4:extrafamiliar:100001', block: { id: 't91_wp7odd1', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'familiar', n: 100001, on: false } },
      { key: '4:extrageneral:100002', block: { id: 't92_wp7odd2', kind: 'choice.addPlace', v: 99, place: 'feat', level: 4, category: 'general', n: 100002, on: false } },
    ];
    for (const o of odd) {
      const b = { ...hero('fighter', 4, ov(o.block)), featPicks: { [o.key]: 'toughness' } } as BuildState;
      expect(parseStoredBlocks(b.overrides!.blocks).known.some((x) => x.kind === 'choice.addPlace'), o.key).toBe(false);
      expect(placeLiveForKey(b, o.key), o.key).toBe(true);
      expect(featIds(built(b)), o.key).toContain('toughness');
    }
  });
});

describe('WP7 C8/C11: places never move, and never capture a book slot', () => {
  const BOOK = {
    '1:ancestry:0': 'cooperative-nature',
    '1:class:1': 'sudden-charge',
    '2:class:0': 'intimidating-strike',
    '2:skill:1': 'cat-fall',
    '3:general:0': 'fleet',
    '4:class:0': 'snagging-strike',
    '4:skill:1': 'combat-climber',
  };
  const PLACES: [number, string, number, string][] = [
    [4, 'class', 483930, 'reactive-shield'],
    [2, 'archetype', 483931, 'medic-dedication'],
    [1, 'ancestry', 483932, 'natural-ambition'],
  ];
  const TOGGLES: [string, Partial<BuildState>][] = [
    ['Free Archetype', { variantRules: { freeArchetype: true } }],
    ['Ancestry Paragon', { variantRules: { ancestryParagon: true } }],
    ['Dual Class', { variantRules: { dualClass: true }, classId2: 'rogue' }],
    ['Mythic', { mythicEnabled: true }],
    ['all four', { variantRules: { freeArchetype: true, ancestryParagon: true, dualClass: true }, classId2: 'rogue', mythicEnabled: true }],
  ];
  const filledBook = (b: BuildState) => {
    const drawn = new Set(printedFeatPlaces(b, db).map((p) => p.key));
    return Object.entries(b.featPicks).filter(([k, v]) => v && drawn.has(k)).map(([, v]) => v).sort();
  };

  it('for every slot toggle (both ways, place live, paused or off) a place pick keeps its key and no book slot empties', () => {
    for (const state of ['live', 'paused', 'off'] as const) {
      const blocks = PLACES.map(([l, c, n]) => placeBlock(l, c, n, state !== 'paused'));
      let base = hero('fighter', 4, ov(...blocks), { featPicks: { ...BOOK } });
      for (const [l, c, n, id] of PLACES) base.featPicks[featPlaceKey(l, c, n)] = id;
      if (state === 'off') base = off(base);
      for (const [name, patch] of TOGGLES) {
        const on = rekeyFeatSlots(base, { ...base, ...patch } as BuildState, db);
        const back = rekeyFeatSlots(on, { ...on, variantRules: base.variantRules, classId2: base.classId2, mythicEnabled: base.mythicEnabled } as BuildState, db);
        for (const [label, b] of [['on', on], ['back off', back]] as const) {
          const at = `${state} ${name} ${label}`;
          for (const [l, c, n, id] of PLACES) {
            const k = featPlaceKey(l, c, n);
            expect(b.featPicks[k], `${at}: ${k}`).toBe(id);
            expect(Object.entries(b.featPicks).filter(([, v]) => v === id).map(([x]) => x), `${at}: ${id} only under its place key`).toEqual([k]);
          }
          expect(filledBook(b), `${at}: every book pick still sits in a drawn slot`).toEqual(Object.values(BOOK).sort());
        }
        expect(back.featPicks, `${state} ${name}: toggled back, every key as it was`).toEqual(base.featPicks);
      }
    }
  });

  it('two tabs each adding a level-4 class place keep two places (newPlaceN draws, the roster merge by block id)', () => {
    const base = { id: 'wp7-tabs', build: hero('fighter', 4, ov()) };
    const inTab = (r: number, featId: string) => {
      const spy = vi.spyOn(Math, 'random').mockReturnValue(r);
      try {
        const w = writeChoiceTweak(base.build, [{ kind: 'choice.addPlace', fields: { place: 'feat', level: 4, category: 'class' } }]);
        expect(w.refused, 'fixture: the tab adds its place').toBeUndefined();
        const p = parseStoredBlocks(w.build.overrides?.blocks).known.find((x) => x.kind === 'choice.addPlace')!;
        const key = featPlaceKey(p.params!.level, p.params!.category, p.params!.n);
        return { ...base, build: { ...w.build, featPicks: { ...w.build.featPicks, [key]: featId } } as BuildState };
      } finally {
        spy.mockRestore();
      }
    };
    const tabA = inTab(0.1, 'reactive-shield');
    const tabB = inTab(0.7, 'snagging-strike');
    const merged = mergeRosterEdits([base], [tabA], [tabB])[0].build;
    const places = parseStoredBlocks(merged.overrides?.blocks).known.filter((x) => x.kind === 'choice.addPlace');
    expect(places, 'two blocks, whole').toHaveLength(2);
    expect(new Set(places.map((p) => p.params!.n)).size, 'two numbers').toBe(2);
    const keys = places.map((p) => featPlaceKey(p.params!.level, p.params!.category, p.params!.n));
    expect(keys.map((k) => merged.featPicks[k]).sort()).toEqual(['reactive-shield', 'snagging-strike']);
    expect(featIds(built(merged))).toEqual(expect.arrayContaining(['reactive-shield', 'snagging-strike']));
    expect(owes(merged, 4, 'extra class feat'), 'both places filled').toBe(false);
  });

  it('changeAncestry drops an extra ANCESTRY place pick and its answers; the place and other places stay', () => {
    const anc = featPlaceKey(5, 'ancestry', 483932);
    const cls = featPlaceKey(4, 'class', 483933);
    let state = hero('fighter', 5, ov(placeBlock(5, 'ancestry', 483932), placeBlock(4, 'class', 483933)), {
      featPicks: { '1:ancestry:0': 'natural-ambition', [anc]: 'cooperative-nature', [cls]: 'reactive-shield' },
      featChoices: { [anc]: 'answer', [`${anc}#1`]: 'answer2' },
    });
    const setBuild = (fn: BuildState | ((b: BuildState) => BuildState)) => {
      state = typeof fn === 'function' ? (fn as (b: BuildState) => BuildState)(state) : fn;
    };
    const blocksBefore = JSON.stringify(state.overrides);
    useBuilderActions(setBuild as never, db).changeAncestry('elf');
    expect(state.ancestryId).toBe('elf');
    expect(state.featPicks[anc]).toBeUndefined();
    expect(state.featPicks['1:ancestry:0']).toBeUndefined();
    expect(Object.keys(state.featChoices).filter((k) => k.startsWith(anc))).toEqual([]);
    expect(state.featPicks[cls]).toBe('reactive-shield');
    expect(JSON.stringify(state.overrides), 'the places themselves stay').toBe(blocksBefore);
  });

  it('pausing (or switching off) a place holding Ultimate Flexibility moves no slot: featPicks byte-equal, the 20th bonus slot still drawn', () => {
    const uf = featPlaceKey(20, 'class', 483950);
    const live = hero('fighter', 20, ov(placeBlock(20, 'class', 483950)), { featPicks: { [uf]: 'ultimate-flexibility' } });
    const bonus = printedSlotKey(live, db, 20, 'bonus', 0)!;
    expect(bonus, 'fixture: Ultimate Flexibility draws a 20th-level bonus slot').toBeTruthy();
    live.featPicks[bonus] = 'snagging-strike';
    const id = (live.overrides!.blocks as { id: string }[])[0].id;
    const paused = { ...live, overrides: writeTweak(live, { op: 'setOn', key: `blocks:${id}`, on: false }).overrides } as BuildState;
    for (const [name, raw] of [['paused', paused], ['off', off(live)]] as const) {
      const next = rekeyFeatSlots(live, raw, db);
      expect(JSON.stringify(next.featPicks), name).toBe(JSON.stringify(live.featPicks));
      expect(printedSlotKey(next, db, 20, 'bonus', 0), `${name}: the slot stays drawn (storage view, C11)`).toBe(bonus);
      const ch = built(next);
      expect(featIds(ch), name).not.toContain('ultimate-flexibility');
      expect(featIds(ch), `${name}: the bonus slot's feat counts like any pick`).toContain('snagging-strike');
      // The final check (2026-10-25): levelChoices draws slots from the STORAGE view too, so the still-drawn bonus slot
      // stays on the "still to choose" list once it is empty (the live view dropped it).
      const empty = { ...next, featPicks: { ...next.featPicks, [bonus]: null } } as BuildState;
      expect(owes(empty, 20, 'bonus feat'), `${name}: the empty 20th bonus slot is still owed`).toBe(true);
    }
  });
});

describe('WP7: the dedication rule and the book twin', () => {
  it('an extra ARCHETYPE place pick counts toward its archetype (Soul Warden), as one in a Free Archetype slot; an extra class place pick does not', () => {
    const at = (cat: 'archetype' | 'class', on = true) =>
      hero('fighter', 8, ov(placeBlock(4, cat, 483934, on), placeBlock(6, cat, 483935, on)), {
        featPicks: { '2:class:0': 'soul-warden-dedication', [featPlaceKey(4, cat, 483934)]: 'domain-initiate', [featPlaceKey(6, cat, 483935)]: 'expanded-domain-initiate' },
      });
    const medic = db.feats['medic-dedication'];
    const block = (b: BuildState) => dedicationBlock(takenForDedicationRule(b, '8:class:0', 8), medic, db);
    expect(takenForDedicationRule(at('archetype'), '8:class:0', 8)).toEqual(expect.arrayContaining([{ id: 'domain-initiate', category: 'archetype' }]));
    expect(block(at('archetype')), 'two Soul Warden feats taken in archetype places: the gate is met').toBeNull();
    expect(block(at('class')), 'the same two as class feats are cleric feats, not Soul Warden ones').toEqual(expect.any(String));
    // the STORAGE view: a paused place's feats still count, so a dedication picked now stays legal on resume
    expect(block(at('archetype', false))).toBeNull();
  });

  it('the book twin gives equal numbers: Toughness and Fleet in an extra general place = in the book general slot', () => {
    const plain = hero('fighter', 4);
    for (const [featId, measure] of [
      ['toughness', (c: Character) => deriveMaxHp(c, db)],
      ['fleet', (c: Character) => deriveSpeeds(c, db).land],
    ] as const) {
      const place = withPlace(4, 'general', 483960, featId).b;
      const book = hero('fighter', 4, undefined, { featPicks: { '3:general:0': featId } });
      expect(measure(built(place)), featId).toBe(measure(built(book)));
      expect(measure(built(place)), `${featId} moves the number`).not.toBe(measure(built(plain)));
    }
  });
});

describe('WP7 C9: a granter in a paused or off place equals the character without it', () => {
  const SPECS: [string, () => { b: BuildState; key: string }][] = [
    ['dedskill', () => withPlace(4, 'archetype', 483922, 'rogue-dedication', true, { dedicationSkillFeats: { 'rogue-dedication': 'charlatan' } })],
    ['pickfocus', () => {
      const r = withPlace(4, 'class', 483923, 'social-purview');
      r.b.pickFeatChoices = { [r.key]: 'student-of-perfection-dedication' };
      return r;
    }],
    ['spell', () =>
      withPlace(4, 'archetype', 483924, 'wizard-dedication', true, {
        archetypeTradition: 'arcane',
        archetypeKeyAbility: 'int',
        archetypeSpells: { cantrips: ['prestidigitation', 'shield'], spells: {}, tradition: 'arcane', keyAbility: 'int' },
      } as unknown as Partial<BuildState>)],
  ];
  it.each(SPECS)('%s: paused and off deep-equal the twin with every answer under the key deleted; live differs', (_name, make) => {
    const { b: live, key } = make();
    const paused = { ...live, overrides: ov(...(live.overrides!.blocks as object[]).map((x) => ({ ...x, on: false }))) } as BuildState;
    for (const [state, b] of [['paused', paused], ['off', off(live)]] as const) {
      const twin = withoutKey(b, key);
      // WP7 run 2 (C46): the one difference is Character.tweakKept — what the held-back place holds, kept for a
      // build-less reopen (bug-builder-roundtrip.test.ts). Nothing on the sheet reads it, so it stays out of the compare.
      const { tweakKept, ...sheet } = built(b);
      expect(sheet, state).toEqual(built(twin));
      expect(tweakKept?.featPlaces?.map((p) => p.slotKey), `${state}: the place is kept aside`).toEqual([key]);
      expect(built(twin).tweakKept, `${state}: an empty place keeps nothing`).toBeUndefined();
    }
    expect(built(live)).not.toEqual(built(withoutKey(live, key)));
  });
});

describe('WP7 C9 two views + step 6b: the take count and its words', () => {
  const FLEET = db.feats.fleet;
  const takenWords = (b: BuildState, slot: string) => slotRefusal(b, db, slotRefOf(slot)!)(FLEET).filter((r) => r.rule === 'taken').map((r) => r.words);

  it('a paused place Fleet still takes the cap of the book general slot, with words saying why; Tweaks off says so too', () => {
    const paused = withPlace(4, 'general', 483970, 'fleet', false, {}, 'fighter', 7).b;
    expect(takenWords(paused, '3:general:0')).toEqual(['Taken in a paused extra place (level 4) — turn it on or remove it']);
    expect(ids(paused, '3:general:0'), 'a pause never frees the pick (storage view)').not.toContain('fleet');
    const switched = off(withPlace(4, 'general', 483970, 'fleet', true, {}, 'fighter', 7).b);
    expect(takenWords(switched, '3:general:0')).toEqual(['Taken in an extra place (level 4) that counts only while Tweaks are on']);
    // Tweaks off AND the place's own block paused: the paused words (turning Tweaks on alone would not bring it back)
    expect(takenWords(off(paused), '3:general:0'), 'off + own block paused').toEqual(['Taken in a paused extra place (level 4) — turn it on or remove it']);
    const live = withPlace(4, 'general', 483970, 'fleet', true, {}, 'fighter', 7).b;
    expect(takenWords(live, '3:general:0'), 'a live place copy').toEqual(['Already taken']);
    const bookCopy = { ...paused, featPicks: { ...paused.featPicks, '7:general:0': 'fleet' } } as BuildState;
    expect(takenWords(bookCopy, '3:general:0'), 'a book copy makes the cap: the plain words').toEqual(['Already taken']);
    expect(takenWords(hero('fighter', 7), '3:general:0'), 'no copy anywhere').toEqual([]);
  });

  it('a given Fleet beside a paused place Fleet counts once, on the sheet and in heldFeatSlots (both views)', () => {
    const key = featPlaceKey(4, 'general', 483971);
    const b = hero('fighter', 7, { v: 2, addedFeats: [{ featId: 'fleet', level: 3, category: 'general' }], blocks: [placeBlock(4, 'general', 483971, false)] } as unknown as BuildOverrides, {
      featPicks: { [key]: 'fleet' },
    });
    const ch = built(b);
    expect(featIds(ch).filter((x) => x === 'fleet')).toHaveLength(1);
    expect(deriveSpeeds(ch, db).land).toBe(deriveSpeeds(built(hero('fighter', 7)), db).land + 5);
    const live = heldFeatSlots(b).filter((e) => e.featId === 'fleet');
    expect(live.map((e) => e.via), 'live view: the given copy').toEqual(['override']);
    const stored = heldFeatSlots(b, undefined, { includePaused: true }).filter((e) => e.featId === 'fleet');
    expect(stored.map((e) => e.via), 'storage view: the stored pick').toEqual(['slot']);
  });

  it("a live place pick's Character.feats row keeps the raw category (extraclass / extrageneral / extraarchetype)", () => {
    for (const [cat, featId] of [
      ['class', 'snagging-strike'],
      ['general', 'toughness'],
      ['archetype', 'medic-dedication'],
    ] as const) {
      const { b, key } = withPlace(4, cat, 483980, featId);
      const row = built(b).feats.find((f) => f.slotKey === key);
      expect(row?.category, cat).toBe(`extra${cat}`);
    }
  });
});

describe('WP7 step 4: levelChoices owes an empty LIVE place only', () => {
  it('owed live and empty, after the level book slots; not owed paused, off or filled', () => {
    const { b: empty } = withPlace(4, 'class', 483990, null);
    expect(owes(empty, 4, 'extra class feat')).toBe(true);
    const labels = levelChoices(empty, db).filter((c) => c.page === 4).map((c) => c.label);
    expect(labels.findIndex((l) => l.endsWith('— class feat'))).toBeLessThan(labels.findIndex((l) => l.endsWith('— extra class feat')));
    expect(owes(withPlace(4, 'class', 483990, null, false).b, 4, 'extra class feat'), 'paused').toBe(false);
    expect(owes(off(empty), 4, 'extra class feat'), 'Tweaks off').toBe(false);
    for (const on of [true, false]) {
      const filled = withPlace(4, 'class', 483990, 'snagging-strike', on).b;
      for (const b of [filled, off(filled)]) {
        expect(levelChoices(b, db).filter((c) => /extra/.test(c.label)), `filled (on: ${on})`).toEqual([]);
      }
    }
  });
});
