import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { content, mainCasting } from './_content';
import { applyOverrides, buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import {
  addRepertoireSpell,
  addSpellTrade,
  applyPlayState,
  bonusSlotKey,
  cantripTradeKey,
  CANTRIP_TRADE,
  initialPlay,
  learnSpell,
  playForRebuild,
  removeRepertoireSpell,
  setPreparedCantrip,
  setPreparedSpell,
  setRepertoireRank,
  setRestrictedRank,
  setRestrictedSpell,
  setSignatureSpells,
  setTradedCantrip,
  starsAtRank,
  toggleMode,
  toggleSignatureSpell,
  type PlayState,
} from '../src/rules/play';
import { chosenAt, hiddenAt, repertoireCap, signatureEchoIds, spellOptions } from '../src/rules/spellOptions';
import { carryStoredOverrides, rebuildRoster } from '../src/data/rebuild';
import type { Character } from '../src/rules/types';

/**
 * OPEN THE BUILDER, SAVE, LOSE THE PLAYER'S WORK.
 *
 * > "i chose spells then whent into the editor pressed saave changes and my spells diosappeard …
 * > this is a very important problom that neds to be solves and tested to see if this happens in
 * > places that arent related to spells" — owner, 2026-09-22
 *
 * It did happen in places that aren't related to spells. `playForRebuild` — the one function every
 * Save runs the play overlay through (the builder's Save in App.tsx, the GM edit sheet's) — was a
 * WHITELIST: it named about twenty fields and returned an object assembled from those alone, so
 * every other field of PlayState was deleted on any Save, changed or not. Spells were the half the
 * owner noticed; `knownRituals` (a ritual that costs days to learn), `etchedRunes` (*"remain
 * indefinitely"*), `preparedTactics`, `spellTrades`, `restrictedSlotRanks`, `dailyChoices`,
 * `dailyItems`, `featUses`, `alchemyPrep`, `innateUsed`, `activeStance`, `resources` and
 * `tempHpFrom` were deleted by the same line, and any field added to PlayState afterwards would
 * have been deleted in silence too.
 *
 * So the guard here is not "spells survive". It is:
 *
 *   1. NO KEY OF PlayState MAY DISAPPEAR on a Save. Asserted generically, over a fixture that is
 *      checked against the PlayState interface itself, so a field added tomorrow is covered.
 *   2. A Save that changes nothing changes nothing — beyond three usage counters that a rebuild
 *      legitimately refills (`expendedSlots`, `slotsUsed`, `focusUsed`) and `resources`, which is
 *      merged over the new build's defaults rather than replaced.
 *   3. A Save that changes ONE thing (level +1) changes only that.
 *   4. …and a sheet pick is taken away at a key only when the FRESH BUILD makes it illegal — the
 *      slot is gone, the spell is off the list, the collection is over its cap. The build answer
 *      merely MOVING is not a reason: a content update moves it with nobody touching the builder.
 *      (The block at the bottom of this file is that rule, per field. Which surface wins at one key
 *      is settled, not open: a still-legal sheet pick stays and a builder ADD comes through — the
 *      two surfaces may disagree, and neither may delete.)
 */
const db = content();

/** The primary caster's entry id on every fixture here. */
const ENTRY = 'cleric-casting';

/**
 * A FLEXIBLE SPELLCASTER cleric — the shape the report came from: the archetype turns the prepared
 * class entry into a repertoire ("spell collection"), which is edited on the SHEET, so all of the
 * player's spell picks live in the play overlay and none of them in the build.
 */
const flexCleric = (level: number, spells: Record<number, string[]> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level,
    classId: 'cleric',
    subclassId: 'cloistered-cleric',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'wis',
    featPicks: { '2:class:0': 'flexible-spellcaster-dedication' },
    spells,
  }) as unknown as BuildState;

/** The same cleric WITHOUT the archetype: an ordinary prepared caster with per-slot preparation. */
const preparedCleric = (level: number, spells: Record<number, string[]> = {}): BuildState => {
  const b = flexCleric(level, spells);
  return { ...b, featPicks: {} } as BuildState;
};

/** An ordinary SPONTANEOUS caster, whose repertoire the builder also fills. The MUSE is a parameter
 *  because it is what grants a spell into the repertoire (enigma → sure strike, warrior → fear), and
 *  a granted spell is the one entry in there that is not the player's to keep or to lose. */
const bard = (
  level: number,
  spells: Record<number, string[]>,
  signatures: Record<number, string[]> = {},
  muse?: string,
): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level,
    classId: 'bard',
    subclassId: muse ?? db.classes.bard?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'cha',
    spells,
    signatures,
  }) as unknown as BuildState;

/** A WIZARD — the one caster whose leveled source the built character writes down (`spellbook`), and
 *  whose ARCANE SCHOOL brings a restricted curriculum slot, which is the other list the engine can
 *  read. Between them, both halves of "is this spell still on the fresh list". */
const wizard = (
  level: number,
  book: Record<number, string[]>,
  cantrips: string[] = ['detect-magic'],
  school?: string,
): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level,
    classId: 'wizard',
    subclassId: school ?? db.classes.wizard?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'int',
    spells: book,
    cantrips,
  }) as unknown as BuildState;

/** The same wizard with the SPELL BLENDING thesis — the one caster who has BONUS slots, which are
 *  keyed by the rank they were traded FROM rather than by their position in the rank's array. */
const blendingWizard = (level: number, book: Record<number, string[]>): BuildState =>
  ({ ...wizard(level, book), extraChoices: { thesis: ['spell-blending'] } }) as BuildState;

/** A MAGUS — the caster whose spellbook moves with the LEVEL rather than only with the player's
 *  picks: `magusStudiousSpells` replaces the studied pair per level band, so a 5th-rank slot's
 *  preparation can be legal at 11th, off the book at 10th, and legal again at 11th. */
const magus = (level: number): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level,
    classId: 'magus',
    subclassId: db.classes.magus?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'int',
    spells: { 1: ['grease'], 2: ['mirror-image'] },
  }) as unknown as BuildState;

/** A RUNELORD wizard with Sin Reservoir — one restricted slot whose RANK follows the caster's own
 *  table down while its `allowed` list stays flat across every rank of the curriculum. The two move
 *  apart, which is the whole reason the slot's rank ceiling is checked and not just the list. */
const runelord = (level: number, book: Record<number, string[]> = {}): BuildState =>
  ({
    ...wizard(level, book, ['detect-magic'], 'runelord'),
    featChoices: { 'feature:runelord': 'envy' },
    featPicks: { '8:class:0': 'sin-reservoir' },
  }) as unknown as BuildState;

/** A PSYCHIC — a caster with NO spellbook whose restricted slots still carry a machine-readable
 *  list: the conscious mind's own spells, which change when the mind does. */
const psychic = (mind: string): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level: 14,
    classId: 'psychic',
    subclassId: mind,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: null,
    featPicks: { '14:class:0': 'conscious-spell-specialization' },
  }) as unknown as BuildState;

/** A SORCERER — the caster whose BLOODLINE decides the tradition, so that a subclass swap in the
 *  builder moves the whole spell list under a collection the player filled on the sheet, and whose
 *  slot table grows by exactly one 4th-rank slot between 7th and 8th level (the shrink-by-one a level
 *  correction produces, which is a different case from a rank vanishing altogether). */
const sorcerer = (level: number, bloodline: string, spells: Record<number, string[]> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level,
    classId: 'sorcerer',
    subclassId: bloodline,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'cha',
    spells,
  }) as unknown as BuildState;
const SORC = 'sorcerer-casting';

/** An ORACLE at the top of the ladder — the one record in the data whose repertoire is printed WIDER
 *  than its slot table (Oracular Clarity: two 10th-rank spells over a single 10th-rank slot). */
const oracle = (level: number, spells: Record<number, string[]>): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Coriander Vale',
    level,
    classId: 'oracle',
    subclassId: db.classes.oracle?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'cha',
    spells,
  }) as unknown as BuildState;

/** The plain cleric plus a dedication that brings a CLASS RESOURCE with it (Rage), which is how the
 *  build's answer about resources moves at all: a cleric on its own has none. */
const ragingCleric = (level: number): BuildState =>
  ({ ...preparedCleric(level), featPicks: { '2:class:0': 'barbarian-dedication' } }) as BuildState;

const built = (b: BuildState): Character => buildCharacter(b, applyOverrides(db, b.overrides));

/**
 * The EXACT chain App.tsx's builder `onCreate` runs (and GmEditSheet's, line for line): build the
 * edited build, carry the stored character's own fields onto it, run the play overlay through
 * `playForRebuild` with the fresh AND previous characters.
 */
function save(prevBuild: BuildState, play: PlayState, nextBuild: BuildState = prevBuild) {
  const prev = built(prevBuild);
  const fresh = built(nextBuild);
  return {
    character: carryStoredOverrides(fresh, prev),
    build: nextBuild,
    play: playForRebuild(play, fresh, prev),
  };
}

/** What the SHEET shows — the built character with the play overlay applied, which is the only view
 *  the player ever sees. Asserting on the stored character alone would miss half of every loss. */
const sheet = (c: { character: Character; play: PlayState }) => applyPlayState(c.character, c.play, db);
const collected = (ch: Character) => Object.values(mainCasting(ch)?.repertoire ?? {}).flat();

/* ------------------------------------------------------------------ the owner's report, exactly */

describe("the report: choose spells on the sheet, open the builder, Save — and they're gone", () => {
  const b = flexCleric(3); // the player never picked a spell in the BUILDER; the collection is empty
  const ch = built(b);
  const chosen = { 1: ['heal'], 2: ['restoration', 'death-knell', 'enhance-victuals'] };
  let play = initialPlay(ch, db);
  for (const [rank, ids] of Object.entries(chosen)) play = setRepertoireRank(play, ENTRY, Number(rank), ids);

  it('fixture: the picks are the player\'s alone — the build holds none of them', () => {
    expect(b.spells).toEqual({});
    expect(collected(ch), 'a build with no spell picks collects nothing').toEqual([]);
    expect(collected(sheet({ character: ch, play })).sort()).toEqual([...chosen[1], ...chosen[2]].sort());
  });

  it('a Save that changes NOTHING keeps every one of them', () => {
    const after = save(b, play);
    expect(collected(sheet(after)).sort(), 'the builder Save emptied the collection').toEqual(
      [...chosen[1], ...chosen[2]].sort(),
    );
    expect(after.play.repertoireSpells).toEqual(play.repertoireSpells);
  });

  it('…and so does a Save that levels the character up', () => {
    const after = save(b, play, flexCleric(4));
    expect(sheet(after).level).toBe(4);
    expect(collected(sheet(after)).sort()).toEqual([...chosen[1], ...chosen[2]].sort());
  });
});

/* ------------------------------------------------- the generalisation: no key of PlayState is lost */

/**
 * A play state carrying one value in EVERY field of PlayState — the point being that the fixture is
 * checked against the interface below, so this is "everything the sheet can hold", not "everything
 * someone remembered".
 */
function loadedPlay(ch: Character): PlayState {
  const base = initialPlay(ch, db);
  return {
    ...base,
    damage: 7,
    tempHp: 4,
    tempHpFrom: 'mode:dragon-transformation',
    shieldDamage: 2,
    tempSpeed: 35,
    appearance: { accent: '#884466' },
    heroPoints: 2,
    mythicPoints: 1,
    xp: 640,
    focusUsed: 1,
    expendedSlots: { [`${ENTRY}:1:0`]: true },
    slotsUsed: { [`${ENTRY}:1`]: 1 },
    innateUsed: { [`${ENTRY}:light`]: true },
    conditions: [{ id: 'frightened', value: 1 }],
    inventory: [
      { instanceId: 'inv-bag', itemId: 'backpack', quantity: 1, worn: true },
      { instanceId: 'inv-wand', itemId: 'wand-of-manifold-missiles', quantity: 1, charges: 1, counters: { uses: 2 } },
      { instanceId: 'inv-ration', itemId: 'rations', quantity: 3, containerInstanceId: 'inv-bag' },
    ],
    currency: { gp: 41, sp: 3, cp: 7 },
    pinned: ['action:Stride'],
    pinnedDescs: [{ kind: 'spell', id: 'heal', name: 'Heal' }],
    resources: { 'infused-reagents': 2 },
    alchemyPrep: { 'elixir-of-life-minor': 2 },
    dailyChoices: { 'environmental-adaptability:element': 'cold' },
    dailyItems: { 'slot-0': 'scroll-of-heal' },
    featUses: { 'ancestral-longevity': 1 },
    knownRituals: ['consecrate'],
    formulaPicks: { 'slot-0': 'elixir-of-life-minor' },
    formulaBookGranted: true,
    notes: [{ id: 'note-0', title: 'The vault', content: 'third brick from the left', icon: 'ti-note' }],
    companionConditions: { 'comp-0': [{ id: 'clumsy', value: 1 }] },
    companionHp: { 'comp-0': { damage: 3, temp: 0 } },
    companionModes: { 'comp-0': ['mode-x'] },
    companions: [],
    details: { age: '31' },
    activeModes: ['mode-x'],
    activeStance: 'mountain-stance',
    preparedSpells: { [`${ENTRY}:1:0`]: 'bless' },
    repertoireSpells: { [ENTRY]: { 1: ['heal'] } },
    signatureSpells: { [ENTRY]: ['heal'] },
    learnedSpells: { [ENTRY]: { 1: ['sanctuary'] } },
    preparedTactics: ['tactic-x'],
    etchedRunes: ['rune-x'],
    spellTrades: { [ENTRY]: [{ from: 1, to: 2, indices: [1] }] },
    restrictedSlotRanks: { 'sin-reservoir': 2 },
  };
}

/** The three usage counters a rebuild refills, and the one field it merges. Nothing else — a Save
 *  takes nothing away from any player-written store, not even a bookkeeping note beside one (a
 *  ledger of the player's ✕ clicks lived here for one round and was ruled out, R1). Everything else
 *  must come back byte-identical, and each of these four is asserted on its own. */
const RECONCILED = ['expendedSlots', 'slotsUsed', 'focusUsed', 'resources'] as const;
const withoutReconciled = (p: PlayState) => {
  const o = { ...p } as Record<string, unknown>;
  for (const k of RECONCILED) delete o[k];
  return o;
};

describe('a Save is lossless for every field of PlayState', () => {
  const b = flexCleric(3);
  const play = loadedPlay(built(b));

  it('the fixture covers every field the interface declares (so a new field cannot slip past)', () => {
    const src = readFileSync('src/rules/play.ts', 'utf8');
    const block = src.slice(src.indexOf('export interface PlayState {'));
    // The interface ends at the first `}` in column 0. Found by line rather than by `'\r\n}'`: this
    // repo's files are mixed (play.ts is CRLF, this file is LF), and a guard that reads the source
    // must not go quietly vacuous the day one of them is normalised.
    const fields = [...block.slice(0, block.search(/^\}/m)).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields.length, 'the PlayState block was not found — this guard would pass vacuously').toBeGreaterThan(30);
    expect(fields.filter((f) => !(f in play)), 'add these to loadedPlay(); they are being left unguarded').toEqual([]);
  });

  it('no field loses its value', () => {
    // By VALUE, not by key: `{ ...play, repertoireSpells: undefined }` leaves the key in place and
    // the player's spells gone all the same, so `k in after` would pass over the very bug.
    const after = save(b, play) as { play: Record<string, unknown> };
    const held = Object.entries(play).filter(([, v]) => v !== undefined);
    expect(held.length).toBeGreaterThan(30);
    expect(held.filter(([k]) => after.play[k] === undefined).map(([k]) => k), 'emptied by the Save').toEqual([]);
  });

  it('a Save with no change leaves every field untouched but the four that reconcile', () => {
    const after = save(b, play);
    expect(withoutReconciled(after.play)).toEqual(withoutReconciled(play));
  });

  it('a Save that levels the character up leaves them untouched too', () => {
    const after = save(b, play, flexCleric(4));
    expect(withoutReconciled(after.play)).toEqual(withoutReconciled(play));
    expect(after.character.level).toBe(4);
  });

  it('the four that reconcile do so for a stated reason', () => {
    const after = save(b, play);
    // Slots and focus REFILL on a rebuild — the only thing a rebuild is entitled to reset, and a
    // refill can only ever hand the player something back.
    expect(after.play.expendedSlots).toEqual({});
    expect(after.play.slotsUsed).toEqual({});
    expect(after.play.focusUsed).toBe(0);
    // A resource the new build introduces has to reach the sheet at its default, but a value the
    // player has been tracking is theirs: merged, never replaced or dropped.
    expect(after.play.resources).toMatchObject({ 'infused-reagents': 2 });
  });
});

/* ---------------------------------------------------- the ruling: LEGAL survives, ILLEGAL gives way */

/**
 * The residual the refuter found in the first fix.
 *
 * That fix dropped a sheet override wherever the build's own answer at the key had MOVED between the
 * two Saves — "the builder holds the later edit, so it wins there". But the app cannot tell a
 * deliberate builder edit from a CONTENT UPDATE: a data fix that renames the spell a record grants,
 * re-orders a cantrip list or changes what a subclass puts in the repertoire moves the build's answer
 * with nobody touching the builder, and the next Save then deleted the player's pick at that key.
 *
 * So the rule pinned here is: a sheet pick is dropped ONLY when the FRESH build makes it illegal —
 * the slot/opening/rank is gone, the spell is off the list the build offers, the collection is over
 * its cap, a ★ sits on a spell that is no longer known. A legal pick survives whether the two build
 * answers agree or not. Each field below gets both legs: the build answer moves under a legal pick
 * (it stands), and the pick goes illegal (the fresh answer takes over).
 *
 * ⚠ The lane's call, not a ruling: it loses nothing of the player's, but a builder edit and a sheet
 * pick at the same key can now DISAGREE, with the sheet showing. Standing under QUESTIONS FOR THE
 * OWNER (2026-09-22). If he wants the builder to win at a key he just touched there, the previous
 * character is already passed in (`prev`) and this block is where that goes.
 */
describe('a sheet pick gives way only where the fresh build makes it illegal', () => {
  /* ---- 1. a prepared slot's spell ---- */

  it('prepared slot: the build\'s spell at that key moves, the player\'s still-legal pick stands', () => {
    const b = preparedCleric(3, { 1: ['heal', 'bless'] });
    const ch = built(b);
    expect(mainCasting(ch)?.prepared?.[1]?.map((s) => s.spellId).slice(0, 2)).toEqual(['heal', 'bless']);
    let play = initialPlay(ch, db);
    play = setPreparedSpell(play, ENTRY, 1, 0, 'sanctuary');
    // ⚠ FIXTURE, corrected by this pass: this was `shield-other`, an id that no longer SHIPS. It
    // rendered because the old reader read "the database has never heard of this spell" as "cannot
    // say, so draw it"; the slot's own picker cannot offer a spell it has no record of, so the slot
    // now falls back to the build's own — the same rule ③ already stated for a cantrip opening.
    play = setPreparedSpell(play, ENTRY, 1, 1, 'admonishing-ray');
    // The build's answer at slot 0 moves (heal → harm — a builder edit, or equally a data fix to a
    // granted spell). A cleric prepares off the whole divine list, so both sheet picks stay legal.
    const after = save(b, play, preparedCleric(3, { 1: ['harm', 'bless'] }));
    expect(mainCasting(sheet(after))?.prepared?.[1]?.map((s) => s.spellId).slice(0, 2)).toEqual([
      'sanctuary',
      'admonishing-ray',
    ]);
  });

  it('prepared slot: a pick the fresh SPELLBOOK no longer holds is still drawn — and marked, never hidden', () => {
    // Until 2026-10-14 this pinned "gives way to the build's spell" (grease undrawn). Lane C1 (owner: a
    // stored pick is never hidden; one no longer legal is drawn WITH a marker saying why): the book now
    // decides what the picker may ADD, and the render draws grease with `notInBook`.
    const b = wizard(3, { 1: ['force-barrage', 'grease'] });
    const ch = built(b);
    expect(mainCasting(ch)?.spellbook?.[1], 'fixture: the book is the wizard\'s only source').toEqual([
      'force-barrage',
      'grease',
    ]);
    let play = initialPlay(ch, db);
    play = setPreparedSpell(play, 'wizard-casting', 1, 0, 'grease'); // legal today: it is in the book
    play = setPreparedSpell(play, 'wizard-casting', 1, 1, 'force-barrage');
    // The builder rewrites the book: grease is out, mage armor is in.
    const after = save(b, play, wizard(3, { 1: ['force-barrage', 'mage-armor'] }));
    const shown = mainCasting(sheet(after));
    const slots = shown?.prepared?.[1]?.map((s) => s.spellId);
    expect(slots?.[0], 'the player\'s pick is still drawn').toBe('grease');
    expect(shown?.notInBook, '…with the marker saying it is in no book the wizard owns').toContain('grease');
    expect(after.play.preparedSpells?.['wizard-casting:1:0'], 'and the store is untouched').toBe('grease');
    expect(slots?.[1], 'this one is still in the book — the build answer moving under it is not a reason').toBe(
      'force-barrage',
    );
    expect(shown?.notInBook ?? [], 'a book spell carries no marker').not.toContain('force-barrage');
  });

  it('prepared slot: a spell LEARNED in play counts as the fresh list too', () => {
    // Learn a Spell adds to the book through the overlay, never to the build. Reading legality off
    // the built book alone would delete the preparation of a spell that cost days to learn.
    const b = wizard(3, { 1: ['force-barrage'] });
    let play = learnSpell(initialPlay(built(b), db), 'wizard-casting', 1, 'grease');
    play = setPreparedSpell(play, 'wizard-casting', 1, 1, 'grease');
    const after = save(b, play, wizard(3, { 1: ['force-barrage', 'mage-armor'] }));
    expect(mainCasting(sheet(after))?.prepared?.[1]?.[1]?.spellId).toBe('grease');
  });

  it('⑩ a spell a REPERTOIRE caster learned in play is on the list too — every caster shape', () => {
    /*
     * ⛔ R3. The learned list reached the picker through the SPELLBOOK merge, which is guarded by
     * `if (out.spellbook)` — so for the shape ⑥ is actually about (bard, sorcerer: no book, and the
     * one print deliberately keeps out of a book — *"it's not automatically added since you can only
     * know a limited number of spells. Instead, you can select it when you add or swap spells"*) the
     * spell the character spent days learning was on no list any picker or render read. Harmless only
     * while LearnSpellModal draws its candidates from the tradition pool; the moment it does not, the
     * sheet draws a picker that refuses its own offer.
     */
    const offList = Object.values(db.spells).find(
      (s) => s.rank === 1 && !s.ritual && s.traditions.includes('divine') && !s.traditions.includes('arcane'),
    )!.id;
    const b = sorcerer(5, 'bloodline-draconic'); // arcane
    const ch = built(b);
    const entry0 = mainCasting(ch)!;
    expect(
      spellOptions({ character: ch, entry: entry0, content: db }, 1).some((s) => s.id === offList),
      'fixture: off the bloodline\'s list until it is learned',
    ).toBe(false);
    let play = learnSpell(initialPlay(ch, db), SORC, 1, offList);
    const live = mainCasting(applyPlayState(ch, play, db))!;
    expect(
      spellOptions({ character: ch, entry: live, content: db }, 1).some((s) => s.id === offList),
      'the picker offers what the character learned',
    ).toBe(true);
    play = addRepertoireSpell(play, SORC, 1, offList, [], live.grantedRepertoire?.[1] ?? []);
    expect(mainCasting(applyPlayState(ch, play, db))?.repertoire?.[1], 'and the render draws it').toContain(offList);
    // …and it survives the Save, like any other pick the fresh build still allows.
    expect(mainCasting(sheet(save(b, play)))?.repertoire?.[1]).toContain(offList);
    // ⚠ Under the ordinary RANK CEILING, like every other list this function reads: learning a spell
    // buys the spell, not a place to cast it from.
    const high = Object.values(db.spells).find((s) => s.rank === 3 && !s.ritual && s.traditions.includes('divine'))!.id;
    const withHigh = mainCasting(applyPlayState(ch, learnSpell(play, SORC, 3, high), db))!;
    expect(
      spellOptions({ character: ch, entry: withHigh, content: db }, 1).some((s) => s.id === high),
      'a 3rd-rank spell is not offered to a 1st-rank opening',
    ).toBe(false);
  });

  it('prepared slot: a slot the fresh build no longer has keeps its spell (5 → 3 → 5)', () => {
    // The other direction of the same rule: the key is not rendered, so it is not deleted either —
    // the level correction that takes the slot away is usually followed by the one that gives it back.
    const b5 = wizard(5, { 1: ['force-barrage'], 2: ['mirror-image'], 3: ['fireball', 'haste'] });
    const b3 = wizard(3, { 1: ['force-barrage'], 2: ['mirror-image'] });
    const play = setPreparedSpell(initialPlay(built(b5), db), 'wizard-casting', 3, 0, 'haste');
    expect(mainCasting(sheet({ character: built(b5), play }))?.prepared?.[3]?.[0]?.spellId, 'fixture').toBe('haste');
    const down = save(b5, play, b3);
    expect(mainCasting(sheet(down))?.prepared?.[3], 'a 3rd-level wizard has no 3rd-rank slots').toBeUndefined();
    expect(down.play.preparedSpells?.['wizard-casting:3:0'], 'nothing renders it; nothing deletes it').toBe('haste');
    const back = save(b3, down.play, b5);
    expect(mainCasting(sheet(back))?.prepared?.[3]?.[0]?.spellId, 'the slot came back, and so did the spell').toBe(
      'haste',
    );
  });

  it('prepared slot: a level-gated BOOK grant moving down and back up costs the player nothing', () => {
    /*
     * ⛔ THE HEADLINE OF THE REVERSAL. The spellbook is a build answer and moves with the LEVEL, so
     * "delete the pick the fresh book no longer holds" deletes on a level correction. The magus is
     * the plainest case in the data: `magusStudiousSpells` REPLACES per level band — rank 3
     * ['sure-strike', 'haste'] from 11th, rank 2 ['sure-strike', 'water-breathing'] at 7-10 — so
     * `haste` is a book grant at 11th and simply absent at 10th.
     *
     * Enter the level wrong, Save, correct it, Save again, and the 5th-rank slot BOTH levels have
     * came back empty. The test is at the render now: at 10 the spell is not drawn, at 11 it is, and
     * the key never moved.
     */
    const m11 = magus(11);
    const m10 = magus(10);
    const ch = built(m11);
    const id = mainCasting(ch)!.id;
    expect(mainCasting(ch)?.spellbook?.[3], 'fixture: an 11th-level magus studies haste').toContain('haste');
    expect(
      Object.values(mainCasting(built(m10))?.spellbook ?? {}).flat(),
      'fixture: a 10th-level one does not',
    ).not.toContain('haste');
    for (const b of [m10, m11])
      expect(mainCasting(built(b))?.prepared?.[5]?.length, 'fixture: both levels have 5th-rank slots').toBeGreaterThan(0);
    const play = setPreparedSpell(initialPlay(ch, db), id, 5, 0, 'haste');
    expect(mainCasting(sheet({ character: ch, play }))?.prepared?.[5]?.[0]?.spellId, 'fixture: legal today').toBe('haste');
    const down = save(m11, play, m10);
    // Until 2026-10-14 this read `.toBeNull()` — "at 10th it is in no book they own", so not drawn. Lane C1
    // (never hidden; drawn WITH a marker): haste is arcane and under the 5th-rank ceiling, so it is drawn
    // at 10th and marked `notInBook`; the book still keeps it off the picker.
    expect(mainCasting(sheet(down))?.prepared?.[5]?.[0]?.spellId, 'at 10th it is in no book they own — drawn all the same').toBe('haste');
    expect(mainCasting(sheet(down))?.notInBook, '…and SAID').toContain('haste');
    expect(down.play.preparedSpells?.[`${id}:5:0`], 'and it is not deleted').toBe('haste');
    const back = save(m10, down.play, m11);
    expect(mainCasting(sheet(back))?.prepared?.[5]?.[0]?.spellId, 'the correction cost them nothing').toBe('haste');
    expect(mainCasting(sheet(back))?.notInBook ?? [], 'back in the book, the marker goes').not.toContain('haste');
  });

  /* ---- 1b. a Spell Blending BONUS slot ---- */

  /*
   * A bonus slot is keyed `entry:rank:b<from>` — the rank it was TRADED FROM, so that undoing another
   * trade cannot renumber it — which is a shape the `entry:rank:index` loop cannot produce, and
   * applyPlayState appends it to its rank reading `preparedSpells` with no test at all. So a wizard
   * could rewrite their spellbook in the builder and keep casting yesterday's spell out of the bonus
   * slot: a spell in no book they own, prepared and castable.
   */
  const BOOK5 = { 1: ['force-barrage', 'grease'], 2: ['mirror-image'], 3: ['fireball'] };
  const BONUS3 = bonusSlotKey('wizard-casting', 3, 1);
  const bonusSlotOf = (ch: Character) => (mainCasting(ch)?.prepared?.[3] ?? []).find((s) => s.bonusFrom != null);

  /** Trade two 1st-rank slots for a bonus 3rd-rank slot and prepare `spell` into THAT slot. */
  const withBonusSlot = (b: BuildState, spell: string): PlayState => {
    const ch = built(b);
    const start = initialPlay(ch, db);
    let play = addSpellTrade(start, mainCasting(applyPlayState(ch, start, db))!, 1, 3);
    const rendered = mainCasting(applyPlayState(ch, play, db))?.prepared?.[3] ?? [];
    const i = rendered.findIndex((s) => s.bonusFrom != null);
    expect(i, 'fixture: the trade produced a bonus 3rd-rank slot').toBeGreaterThanOrEqual(0);
    play = setPreparedSpell(play, 'wizard-casting', 3, i, spell, rendered[i]);
    expect(play.preparedSpells?.[BONUS3], 'fixture: keyed by the rank traded FROM, not by position').toBe(spell);
    return play;
  };

  it('bonus slot: a spell the fresh book still holds stands', () => {
    const b = blendingWizard(5, BOOK5);
    const play = withBonusSlot(b, 'grease');
    // The builder rewrites a DIFFERENT rank; grease is still in the book, so nothing here is illegal.
    const after = save(b, play, blendingWizard(5, { ...BOOK5, 2: ['invisibility'] }));
    expect(after.play.preparedSpells?.[BONUS3]).toBe('grease');
    expect(bonusSlotOf(sheet(after))?.spellId, 'the bonus slot kept what the player prepared').toBe('grease');
  });

  it('bonus slot: a spell the fresh book no longer holds is still drawn — marked, never hidden', () => {
    // Until 2026-10-14 this pinned "gives way" (an empty bonus slot). Lane C1 (never hidden; drawn WITH a
    // marker): grease is arcane and under the slot's ceiling, so it stays drawn, marked `notInBook`.
    const b = blendingWizard(5, BOOK5);
    const play = withBonusSlot(b, 'grease');
    const after = save(b, play, blendingWizard(5, { ...BOOK5, 1: ['force-barrage', 'mage-armor'] }));
    expect(bonusSlotOf(sheet(after))?.spellId, 'the player\'s pick in the bonus slot is still drawn').toBe('grease');
    expect(mainCasting(sheet(after))?.notInBook, '…marked as in no book the wizard owns').toContain('grease');
    expect(after.play.preparedSpells?.[BONUS3], 'and not deleted either').toBe('grease');
    // …and the book rewrite undone takes the marker away again.
    const back = sheet(save(blendingWizard(5, { ...BOOK5, 1: ['force-barrage', 'mage-armor'] }), after.play, b));
    expect(bonusSlotOf(back)?.spellId).toBe('grease');
    expect(mainCasting(back)?.notInBook ?? []).not.toContain('grease');
  });

  /* ---- 1c. a RESTRICTED slot's spell ---- */

  /*
   * A restricted slot is keyed in `preparedSpells` by the slot's OWN id, not by `entry:rank:index`,
   * and that id is deliberately stable across rebuilds — so a pick made under one arcane school (or
   * one conscious mind, one patron) lands in the slot the next build puts at the same id, and
   * applyPlayState renders it with no test at all. It is also the one place a caster who keeps no
   * spellbook has a machine-readable list: `allowed` is exactly what the slot's picker offers.
   *
   * Two schools that share one 1st-rank curriculum spell and differ on the rest give both legs.
   */
  const MENTALISM = 'school-of-mentalism';
  const INFLUENCE = 'school-of-breathtaking-influence';
  const curriculum1 = (school: string) => db.classFeatures[school]?.curriculum?.['1'] ?? [];
  const rank1Slot = (ch: Character) => mainCasting(ch)?.restrictedSlots?.find((s) => s.rank === 1);
  const wizardOf = (school: string) => wizard(3, { 1: ['force-barrage'] }, ['detect-magic'], school);

  it('restricted slot: a spell the fresh slot may not hold gives way', () => {
    const only = curriculum1(MENTALISM).filter((id) => !curriculum1(INFLUENCE).includes(id));
    expect(only.length, 'fixture: mentalism teaches something the other school does not').toBeGreaterThan(0);
    const b = wizardOf(MENTALISM);
    const ch = built(b);
    const slot = rank1Slot(ch);
    expect(slot?.allowed, 'fixture: the slot offers its school\'s curriculum').toContain(only[0]);
    const play = setRestrictedSpell(initialPlay(ch, db), slot!.id, only[0]);
    expect(rank1Slot(sheet({ character: ch, play }))?.spellId, 'fixture: legal today').toBe(only[0]);
    const after = save(b, play, wizardOf(INFLUENCE));
    const now = rank1Slot(sheet(after));
    expect(now?.id, 'the id is stable — which is how a stale pick reaches the new school\'s slot').toBe(slot!.id);
    expect(now?.spellId, 'the new school\'s slot cannot hold the old school\'s spell').toBeNull();
    expect(after.play.preparedSpells?.[slot!.id], 'not DRAWN — and not deleted either').toBe(only[0]);
    // Swap the school back (the mis-click this usually is) and the pick is there.
    expect(rank1Slot(sheet(save(wizardOf(INFLUENCE), after.play, b)))?.spellId).toBe(only[0]);
  });

  it('restricted slot: a spell the fresh slot still allows stands', () => {
    const shared = curriculum1(MENTALISM).filter((id) => curriculum1(INFLUENCE).includes(id));
    expect(shared.length, 'fixture: the two schools share a 1st-rank spell').toBeGreaterThan(0);
    const b = wizardOf(MENTALISM);
    const slot = rank1Slot(built(b));
    const play = setRestrictedSpell(initialPlay(built(b), db), slot!.id, shared[0]);
    const after = save(b, play, wizardOf(INFLUENCE));
    expect(rank1Slot(sheet(after))?.spellId, 'the school moved under it; the spell is still on the list').toBe(
      shared[0],
    );
  });

  /*
   * …and the list is only HALF of what the slot's picker asks. `allowed` is flat across ranks —
   * restrictedSlots.ts accumulates every ladder step and the whole curriculum into one array — while
   * the slot's own RANK follows the caster's table. Sin Reservoir sits at the highest rank two below
   * the caster's own, so a level corrected from 20 to 8 drops the slot from 8th rank to 2nd with its
   * list unchanged, and an 8th-rank spell stays sitting in a 2nd-rank slot: rendered, castable, and
   * something the picker would never have offered.
   */
  const sinSlot = (ch: Character) => mainCasting(ch)?.restrictedSlots?.find((s) => s.label === 'Sin Reservoir');
  const SPELL8 = (sinSlot(built(runelord(20)))?.allowed ?? []).find((id) => db.spells[id]?.rank === 8)!;

  it('restricted slot: a pick above the rank the slot now renders at gives way', () => {
    expect(SPELL8, 'fixture: the curriculum teaches an 8th-rank spell').toBeTruthy();
    const b = runelord(20, { 8: [SPELL8] });
    const ch = built(b);
    const slot = sinSlot(ch)!;
    expect(slot.rank, 'fixture: at 20th level the slot is 8th rank').toBe(8);
    const play = setRestrictedSpell(initialPlay(ch, db), slot.id, SPELL8);
    expect(sinSlot(sheet({ character: ch, play }))?.spellId, 'fixture: legal today').toBe(SPELL8);
    // The level was wrong and the builder corrects it — the slot falls to 2nd rank.
    const after = save(b, play, runelord(8, { 8: [SPELL8] }));
    const now = sinSlot(sheet(after));
    expect(now?.rank, 'fixture: the slot the fresh build renders').toBe(2);
    expect(now?.allowed, 'the LIST did not move — which is why the list alone is not the test').toContain(SPELL8);
    expect(now?.spellId, 'an 8th-rank spell cannot sit in a 2nd-rank slot').toBeNull();
    expect(after.play.preparedSpells?.[slot.id], 'not DRAWN — and not deleted either').toBe(SPELL8);
    // The level correction corrected: 20 again, 8th-rank slot again, and the player's pick is in it.
    expect(sinSlot(sheet(save(runelord(8, { 8: [SPELL8] }), after.play, b)))?.spellId).toBe(SPELL8);
  });

  it('restricted slot: an `allowed` pick above the ceiling gives way even off the BOOK (the curriculum case)', () => {
    /*
     * The ceiling used to be reconstructed from the built character's own spellbook, so it could only
     * speak about a spell that happened to be in that book — and a curriculum `allowed` list is the
     * SCHOOL's list, disjoint from the player's book by construction. A 3rd-rank curriculum spell the
     * wizard has NOT written down therefore sat in a 2nd-rank Sin Reservoir slot, rendered and
     * castable: literally the example the docblock used while claiming to have closed it. At the
     * render the spell's own rank comes off the content database, so the book is not consulted at all.
     */
    const SPELL3 = (sinSlot(built(runelord(20)))?.allowed ?? []).find((id) => db.spells[id]?.rank === 3)!;
    expect(SPELL3, 'fixture: the curriculum teaches a 3rd-rank spell').toBeTruthy();
    const b = runelord(9); // no `spells` at all: the book holds nothing of this spell's rank
    const ch = built(b);
    const slot = sinSlot(ch)!;
    expect(slot.rank, 'fixture: at 9th level the slot is 3rd rank').toBe(3);
    expect(Object.values(mainCasting(ch)?.spellbook ?? {}).flat(), 'fixture: and it is in no book').not.toContain(
      SPELL3,
    );
    const play = setRestrictedSpell(initialPlay(ch, db), slot.id, SPELL3);
    expect(sinSlot(sheet({ character: ch, play }))?.spellId, 'fixture: legal today — it is on the list').toBe(SPELL3);
    const after = save(b, play, runelord(8));
    expect(sinSlot(sheet(after))?.rank, 'fixture: the slot falls to 2nd rank').toBe(2);
    expect(sinSlot(sheet(after))?.allowed, 'fixture: and the list did not move').toContain(SPELL3);
    expect(sinSlot(sheet(after))?.spellId, 'a 3rd-rank spell cannot sit in a 2nd-rank slot').toBeNull();
  });

  it('restricted slot: a pick at the slot\'s own rank stands', () => {
    const b = runelord(20, { 8: [SPELL8] });
    const slot = sinSlot(built(b))!;
    const play = setRestrictedSpell(initialPlay(built(b), db), slot.id, SPELL8);
    // A builder edit somewhere else entirely: the slot is still 8th rank, so the pick is still legal.
    const after = save(b, play, runelord(20, { 8: [SPELL8], 1: ['force-barrage'] }));
    expect(sinSlot(sheet(after))?.spellId).toBe(SPELL8);
  });

  it('restricted slot: a slot the player has MOVED draws a pick made AFTER the move', () => {
    /*
     * ⛔ THE INVERSE HOLE, and it sat in the function this lane rewrote. The reader nulled a moved
     * slot unconditionally — `moved ? null : …` — and `moved` is true for as long as the chosen rank
     * differs from the slot's default, which is FOR EVER, not just for the move. `setRestrictedRank`
     * already deletes the old pick (it was chosen for the rank the slot has left), so the null was
     * doing nothing but throwing away every pick made afterwards: a Sin Reservoir slot moved off its
     * default rank could never hold a spell again, and the key it wrote was read by nobody.
     *
     * What the move empties is the BUILD'S OWN spell for the slot, and only that.
     */
    const b = runelord(20, { 8: [SPELL8] });
    const ch = built(b);
    const slot = sinSlot(ch)!;
    expect(slot.rankOptions, 'fixture: the slot can move').toContain(1);
    const movedTo1 = (id: string) => {
      const sp = (db.spells[id] ?? {}) as { rank?: number };
      expect(sp.rank, `fixture: ${id} fits a 1st-rank slot`).toBe(1);
    };
    const RANK1 = (slot.allowed ?? []).find((id) => db.spells[id]?.rank === 1)!;
    movedTo1(RANK1);
    let play = setRestrictedRank(initialPlay(ch, db), slot.id, 1);
    expect(play.preparedSpells?.[slot.id], 'the move itself clears what was there').toBeUndefined();
    play = setRestrictedSpell(play, slot.id, RANK1); // …and the player picks again, for the NEW rank
    expect(sinSlot(sheet({ character: ch, play }))?.rank, 'fixture: the slot is at 1st').toBe(1);
    expect(sinSlot(sheet({ character: ch, play }))?.spellId, 'the pick they just made is drawn').toBe(RANK1);
    const after = save(b, play, runelord(20, { 8: [SPELL8], 1: ['force-barrage'] }));
    expect(after.play.restrictedSlotRanks?.[slot.id]).toBe(1);
    expect(after.play.preparedSpells?.[slot.id], 'and the Save keeps it').toBe(RANK1);
    expect(sinSlot(sheet(after))?.spellId, 'still drawn after a builder Save').toBe(RANK1);
  });

  it('restricted slot: a pick the MOVED slot could not hold is not drawn, and is not deleted', () => {
    // The move does not switch the legality test off: the slot's picker is asked at the rank the slot
    // is AT, so an 8th-rank curriculum spell in a slot moved to 1st draws nothing — and keeps its key.
    const b = runelord(20, { 8: [SPELL8] });
    const ch = built(b);
    const slot = sinSlot(ch)!;
    let play = setRestrictedRank(initialPlay(ch, db), slot.id, 1);
    play = setRestrictedSpell(play, slot.id, SPELL8);
    expect(sinSlot(sheet({ character: ch, play }))?.spellId, 'an 8th-rank spell in a 1st-rank slot').toBeNull();
    const after = save(b, play, runelord(8, { 8: [SPELL8] }));
    expect(after.play.preparedSpells?.[slot.id], 'nothing rendered it; nothing deletes it').toBe(SPELL8);
  });

  it('restricted slot: "Leave slot empty" is not undone by a spell the record put in the slot', () => {
    /*
     * ⑤'s renderer read `prepared1(…) ?? (moved ? null : s.spellId)`, and `??` cannot tell a stored
     * NULL — the modal's "Leave slot empty" button, a decision the player made — from no key at all:
     * the build's own spell went straight back into the slot they had just emptied. The ordinary
     * slots one screen up get this right (`override !== undefined ? override : s.spellId`).
     *
     * It is inert in today's data only because restrictedSlots.ts builds every slot with
     * `spellId: null`, so the fixture forces the one thing no record ships yet — which is exactly
     * what "latent" means, and the day a record does ship one this is the row that goes wrong.
     */
    const b = runelord(20, { 8: [SPELL8] });
    const ch = built(b);
    const slot = sinSlot(ch)!;
    expect(slot.spellId, 'fixture: the data ships restricted slots empty').toBeNull();
    const withDefault: Character = {
      ...ch,
      spellcasting: (ch.spellcasting ?? []).map((e) => ({
        ...e,
        restrictedSlots: (e.restrictedSlots ?? []).map((s) => (s.id === slot.id ? { ...s, spellId: SPELL8 } : s)),
      })),
    };
    expect(sinSlot(applyPlayState(withDefault, initialPlay(ch, db), db))?.spellId, 'control: it draws on its own').toBe(
      SPELL8,
    );
    const emptied = setRestrictedSpell(initialPlay(ch, db), slot.id, null);
    expect(emptied.preparedSpells?.[slot.id], 'fixture: the player stored a null, not nothing').toBeNull();
    expect(sinSlot(applyPlayState(withDefault, emptied, db))?.spellId, 'they emptied it; it stays empty').toBeNull();
  });

  it('restricted slot: a caster with no spellbook is held to the same list (a psychic\'s conscious mind)', () => {
    /* The other half of the per-caster coverage: every other case here is a wizard, and a wizard has
     * a book. A psychic has none — the conscious mind's own spells are the only list the engine can
     * read for them, and changing mind in the builder rewrites it under a stable slot id. */
    const minds = (db.classes.psychic?.subclass?.options ?? []).map((o) => o.id);
    const consciousSlot = (ch: Character) => mainCasting(ch)?.restrictedSlots?.[0];
    const [a, z] = [psychic(minds[0]), psychic(minds[1])];
    const slot = consciousSlot(built(a))!;
    const zAllows = consciousSlot(built(z))?.allowed ?? [];
    const own = (slot.allowed ?? []).filter((id) => !zAllows.includes(id) && db.spells[id]?.rank === slot.rank);
    expect(own.length, 'fixture: the two minds teach different spells at the slot\'s rank').toBeGreaterThan(0);
    const play = setRestrictedSpell(initialPlay(built(a), db), slot.id, own[0]);
    expect(consciousSlot(sheet({ character: built(a), play }))?.spellId, 'fixture: legal today').toBe(own[0]);
    expect(consciousSlot(sheet(save(a, play)))?.spellId, 'a Save that changes nothing keeps it').toBe(own[0]);
    const after = save(a, play, z);
    expect(consciousSlot(after.character)?.id, 'the id is stable — which is how the stale pick gets here').toBe(slot.id);
    expect(consciousSlot(sheet(after))?.spellId, 'the new mind cannot hold the old mind\'s spell').toBeNull();
  });

  /* ---- 1d. a restricted slot a toggled MODE grants ---- */

  /*
   * ⛔ THE SLOTS A LIT CANDLE OF INVOCATION GRANTS ARE ON NO STORED CHARACTER.
   *
   * `applyPlayState` builds them from the modes the player has switched on, appends them to the
   * entry's own `restrictedSlots`, and SpellsTab lists the slots off that OVERLAID entry — so
   * `setRestrictedSpell` writes `preparedSpells['<entry>:rs:m<mode>:<n>']` like any other slot and
   * the overlay reads it back. A Save-side loop over the STORED `e.restrictedSlots` could never
   * reach one, so the pick in a candle slot was the one restricted pick nothing tested at all: light
   * a candle, prepare into it, rewrite the spellbook in the builder, and the spell was still there
   * and still castable out of a book the wizard no longer owns.
   *
   * It is the only mode in the data that grants restricted slots, and its grant is
   * `{label, note, halfHighest: 2}` — no `allowed`, no `maxRank`, which is exactly the shape the old
   * `if (!s.allowed) continue;` skip used to wave through.
   */
  const CANDLE = 'item-candle-of-invocation';
  const candleSlots = (ch: Character) => (mainCasting(ch)?.restrictedSlots ?? []).filter((s) => s.id.includes(':rs:m'));
  const lit = (ch: Character) => toggleMode(initialPlay(ch, db), CANDLE, db.modes);

  it('mode slot: the fixture is the shape nothing reached — granted in play, no list, no ceiling', () => {
    expect(db.modes[CANDLE]?.spellSlotBonus?.restricted, 'fixture: the one mode in the data that grants slots')
      .toMatchObject({ halfHighest: 2 });
    expect(db.modes[CANDLE]?.spellSlotBonus?.restricted?.spells, 'and it carries no list').toBeUndefined();
    const b = wizard(11, { 1: ['force-barrage'], 3: ['fireball'] });
    const ch = built(b);
    expect(candleSlots(applyPlayState(ch, initialPlay(ch, db), db)), 'unlit: no slots').toHaveLength(0);
    const slots = candleSlots(applyPlayState(ch, lit(ch), db));
    expect(slots, 'lit: two slots at half the highest rank').toHaveLength(2);
    expect(slots[0].rank).toBe(3);
    expect(slots[0].allowed, 'no `allowed` — so the BOOK and the ceiling are the whole test').toBeUndefined();
    expect(
      (mainCasting(ch)?.restrictedSlots ?? []).map((s) => s.id),
      'and not one of them is on the STORED character, which is where the Save-side loop looked',
    ).not.toContain(slots[0].id);
  });

  it('mode slot: a spell the fresh book no longer holds is still drawn, marked — and is not deleted', () => {
    // Until 2026-10-14 this pinned "is not drawn" (`.toBeNull()`). Lane C1 (never hidden; drawn WITH a
    // marker): fireball is arcane and under the candle slot's 3rd-rank ceiling, so it stays drawn,
    // marked `notInBook`; what the slot may NOT draw is still refused (the next tests).
    const b = wizard(11, { 1: ['force-barrage'], 3: ['fireball'] });
    const ch = built(b);
    const id = candleSlots(applyPlayState(ch, lit(ch), db))[0].id;
    const play = setRestrictedSpell(lit(ch), id, 'fireball');
    expect(candleSlots(applyPlayState(ch, play, db))[0].spellId, 'fixture: legal today').toBe('fireball');
    const after = save(b, play, wizard(11, { 1: ['force-barrage'], 3: ['blink'] }));
    expect(candleSlots(sheet(after))[0]?.spellId, 'a spell in no book the wizard owns — drawn all the same').toBe('fireball');
    expect(mainCasting(sheet(after))?.notInBook, '…and said').toContain('fireball');
    expect(after.play.preparedSpells?.[id], 'and not deleted either').toBe('fireball');
    expect(candleSlots(sheet(save(wizard(11, { 1: ['force-barrage'], 3: ['blink'] }), after.play, b)))[0]?.spellId).toBe(
      'fireball',
    );
  });

  it('mode slot: a caster with NO book is held to the tradition and to the slot\'s rank', () => {
    /* The other half of ⑤'s ceiling, and the one that could not be asked at the Save at all: a cleric
     * keeps no spellbook, so the built character enumerates no list and states no spell's rank. Both
     * come off the content database at the render. */
    const b = preparedCleric(11);
    const ch = built(b);
    const slot = candleSlots(applyPlayState(ch, lit(ch), db))[0];
    expect(slot.rank, 'fixture: a 3rd-rank candle slot').toBe(3);
    expect(mainCasting(ch)?.spellbook, 'fixture: and a caster with no book').toBeUndefined();
    const ARCANE_ONLY = Object.values(db.spells).find(
      (s) => s.rank === 3 && !s.ritual && s.traditions.includes('arcane') && !s.traditions.includes('divine'),
    )!.id;
    const TOO_HIGH = Object.values(db.spells).find((s) => s.rank === 5 && !s.ritual && s.traditions.includes('divine'))!.id;
    const OK = Object.values(db.spells).find((s) => s.rank === 3 && !s.ritual && s.traditions.includes('divine'))!.id;
    const drawn = (spell: string) =>
      candleSlots(applyPlayState(ch, setRestrictedSpell(lit(ch), slot.id, spell), db))[0]?.spellId;
    expect(drawn(OK), 'a 3rd-rank divine spell is what this slot is for').toBe(OK);
    expect(drawn(ARCANE_ONLY), 'off the tradition').toBeNull();
    expect(drawn(TOO_HIGH), 'above the slot\'s rank').toBeNull();
  });

  it('mode slot: its id survives switching an UNRELATED mode off', () => {
    /* The id used to carry the mode's INDEX in the active list (`m${i}`), and `toggleMode` removes by
     * filter — so switching off any mode that happened to sit earlier renumbered the candle's slot
     * from `…:rs:m1:0` to `…:rs:m0:0`, the stored key stopped matching, and the slot rendered empty.
     * Nothing about the candle had changed. */
    const OTHER = Object.keys(db.modes).find((m) => m !== CANDLE && !db.modes[m].exclusiveGroup)!;
    const b = wizard(11, { 1: ['force-barrage'], 3: ['fireball'] });
    const ch = built(b);
    let play = toggleMode(toggleMode(initialPlay(ch, db), OTHER, db.modes), CANDLE, db.modes);
    expect(play.activeModes, 'fixture: the candle is the SECOND mode on').toEqual([OTHER, CANDLE]);
    const id = candleSlots(applyPlayState(ch, play, db))[0].id;
    play = setRestrictedSpell(play, id, 'fireball');
    play = toggleMode(play, OTHER, db.modes); // …and the player switches the other one off
    expect(play.activeModes).toEqual([CANDLE]);
    expect(candleSlots(applyPlayState(ch, play, db))[0]?.id, 'the same slot, the same id').toBe(id);
    expect(candleSlots(applyPlayState(ch, play, db))[0]?.spellId, 'and the same spell in it').toBe('fireball');
  });

  it('EVERY restricted slot the SHEET shows refuses a spell its picker would not offer', () => {
    /* The guard for the class of hole, rather than for the case. Six rounds of refute each found one
     * more slot the test loop could not reach — the `#2` half, then the ones a mode grants — because
     * the loop walked a list of its own instead of the list the player is looking at. This walks THAT
     * list: every slot on the overlaid entry, both halves of a paired one, each handed a spell no
     * picker of theirs would offer. A new slot source that the renderer does not test goes red here. */
    const b = { ...comboWizard({ 1: ['grease'], 3: ['fireball'] }), level: 20 } as BuildState;
    const ch = built(b);
    const base = toggleMode(initialPlay(ch, db), CANDLE, db.modes);
    const slots = mainCasting(applyPlayState(ch, base, db))?.restrictedSlots ?? [];
    expect(slots.length, 'fixture: built slots AND mode-granted ones').toBeGreaterThan(2);
    expect(slots.some((s) => s.id.includes(':rs:m')), 'fixture: at least one of them comes from a mode').toBe(true);
    // In no spellbook, on no curriculum, and 9th rank — above every ceiling here.
    const ILLEGAL = Object.values(db.spells).find(
      (s) => s.rank === 9 && !s.ritual && !(slots[0].allowed ?? []).includes(s.id),
    )!.id;
    for (const s of slots) {
      for (const key of s.pairs ? [s.id, `${s.id}#2`] : [s.id]) {
        const play = setRestrictedSpell(base, key, ILLEGAL);
        const now = (mainCasting(applyPlayState(ch, play, db))?.restrictedSlots ?? []).find((x) => x.id === s.id);
        const shown = key.endsWith('#2') ? now?.spellId2 : now?.spellId;
        expect(shown, `slot ${key} (rank ${s.rank}) drew a spell its picker would not offer`).toBeNull();
        expect(play.preparedSpells?.[key], `slot ${key} lost the player's pick instead of just not drawing it`).toBe(
          ILLEGAL,
        );
      }
    }
  });

  /*
   * …and SPELL COMBINATION, the slot shape that had no test of its own — and the one that made the
   * ceiling above dead code for as long as it went unchecked.
   *
   * `maxRank` has exactly one producer in the engine (`ranksBelow`, restrictedSlots.ts) and exactly
   * one record in the data that feeds it: the 20th-level wizard feat Spell Combination, whose grant
   * carries label/note/perRankFrom/pairs/ranksBelow/costsSlot and NO `spells`, no `from`, no
   * `traits`. restrictedSlots.ts writes `allowed` only when the accumulated list is non-empty, so
   * this slot never has one — and the reconcile used to open `if (!s.allowed) continue;`. Every slot
   * that reached the ceiling therefore had `maxRank` undefined, `Math.min(s.rank, s.maxRank ?? rank)`
   * could only ever come out as `s.rank`, and BOTH halves of the slot (`id` and `id#2`) were checked
   * by nothing at all. A wizard is a BOOK caster, so both tests the picker applies are answerable
   * here: rewrite the spellbook in the builder and yesterday's spell stayed in both halves of every
   * combination slot, prepared and castable, out of a book the wizard no longer owns.
   */
  const COMBO_BOOK = { 1: ['grease', 'force-barrage'], 3: ['fireball'] };
  const comboWizard = (book: Record<number, string[]>): BuildState =>
    ({ ...wizard(20, book), featPicks: { '20:class:0': 'spell-combination' } }) as unknown as BuildState;
  /** The rank-3 combination slot: `maxRank` 1 — "each spell … must be 2 or more spell ranks below". */
  const comboSlot = (ch: Character) => mainCasting(ch)?.restrictedSlots?.find((s) => s.pairs && s.rank === 3);
  const comboPlay = (ch: Character, first: string, second: string): PlayState => {
    const id = comboSlot(ch)!.id;
    return setRestrictedSpell(setRestrictedSpell(initialPlay(ch, db), id, first), `${id}#2`, second);
  };

  it('combination slot: the fixture is the shape the `!allowed` skip hid — a ceiling and no list', () => {
    const slot = comboSlot(built(comboWizard(COMBO_BOOK)));
    expect(slot, 'fixture: a 20th-level wizard with Spell Combination has a rank-3 pair slot').toBeTruthy();
    expect(slot!.maxRank, 'the only maxRank the data produces — and it is 2 ranks below the slot').toBe(1);
    expect(slot!.allowed, 'and it carries no allowed list, which is what the skip keyed off').toBeUndefined();
    expect(slot!.pairs, 'both halves ride the same preparedSpells map, under id and id#2').toBe(true);
  });

  it('combination slot: spells the fresh book still holds stand, in both halves', () => {
    const b = comboWizard(COMBO_BOOK);
    const ch = built(b);
    const id = comboSlot(ch)!.id;
    const play = comboPlay(ch, 'grease', 'force-barrage');
    const before = comboSlot(applyPlayState(ch, play, db));
    expect([before?.spellId, before?.spellId2], 'fixture: legal today — both are 1st-rank book spells').toEqual([
      'grease',
      'force-barrage',
    ]);
    // A builder edit at a DIFFERENT rank. Rank 1 is untouched, so nothing here is illegal.
    const after = save(b, play, comboWizard({ ...COMBO_BOOK, 3: ['fireball', 'haste'] }));
    const now = comboSlot(sheet(after));
    expect([now?.spellId, now?.spellId2], 'the build moving under them is not a reason').toEqual([
      'grease',
      'force-barrage',
    ]);
    expect(after.play.preparedSpells?.[`${id}#2`]).toBe('force-barrage');
  });

  it('combination slot: a spell the fresh book no longer holds is still drawn, marked — in BOTH halves', () => {
    // Until 2026-10-14 this pinned "gives way" ([null, null]). Lane C1 (never hidden; drawn WITH a marker):
    // both are arcane and under the slot's 1st-rank ceiling, so both stay drawn, marked `notInBook`.
    const b = comboWizard(COMBO_BOOK);
    const ch = built(b);
    const id = comboSlot(ch)!.id;
    const play = comboPlay(ch, 'grease', 'force-barrage');
    // The builder rewrites rank 1 of the spellbook entirely.
    const after = save(b, play, comboWizard({ ...COMBO_BOOK, 1: ['mage-armor'] }));
    const now = comboSlot(sheet(after));
    expect([now?.spellId, now?.spellId2], 'both halves still drawn').toEqual(['grease', 'force-barrage']);
    expect(mainCasting(sheet(after))?.notInBook, '…both marked').toEqual(expect.arrayContaining(['grease', 'force-barrage']));
    expect(
      [after.play.preparedSpells?.[id], after.play.preparedSpells?.[`${id}#2`]],
      'and neither is deleted',
    ).toEqual(['grease', 'force-barrage']);
  });

  it('combination slot: a pick above the slot\'s own ceiling is not drawn, with or without a Save', () => {
    /* The `maxRank` half, isolated: `fireball` is in the spellbook and no build change is needed, so
     * the ONLY thing that can refuse it is the ceiling — the slot renders at rank 3 and holds nothing
     * above rank 1. This is exactly what the picker offers (`optionsFor` computes the ceiling first
     * and then walks `fromBook()` for r = 1..ceiling), and with the `!allowed` skip in place the slot
     * sat there rendering a 3rd-rank spell it may not hold. Now that the test is at the RENDER, no
     * Save is involved at all: it never draws. */
    const b = comboWizard(COMBO_BOOK);
    const ch = built(b);
    const slot = comboSlot(ch)!;
    expect(mainCasting(ch)?.spellbook?.[3], 'fixture: fireball is in the book').toContain('fireball');
    const play = setRestrictedSpell(initialPlay(ch, db), slot.id, 'fireball');
    expect(comboSlot(applyPlayState(ch, play, db))?.spellId, 'a 3rd-rank spell in a slot capped at 1st').toBeNull();
    const after = save(b, play); // the IDENTICAL build
    expect(comboSlot(sheet(after))?.spellId).toBeNull();
    expect(after.play.preparedSpells?.[slot.id], 'and the Save deletes nothing').toBe('fireball');
  });

  /* ---- 2. a prepared caster's cantrip openings ---- */

  it('cantrip opening: the build\'s cantrip list moves, the player\'s openings stand', () => {
    const b = { ...preparedCleric(3, {}), cantrips: ['guidance', 'light'] } as BuildState;
    let play = initialPlay(built(b), db);
    play = setPreparedCantrip(play, ENTRY, 0, 'shield');
    play = setPreparedCantrip(play, ENTRY, 1, 'stabilize');
    const after = save(b, play, { ...b, cantrips: ['guidance', 'daze'] } as BuildState);
    const slots = mainCasting(sheet(after))?.cantripSlots;
    expect(slots?.[0]).toBe('shield');
    expect(slots?.[1], 'the default under the opening changed; what the player prepared did not').toBe('stabilize');
  });

  it('cantrip opening: a pick past the fresh cap stops rendering — and is NOT deleted', () => {
    /* The flexible cleric draws 5 openings at 4th level and 4 at 3rd, so a Save that corrects the
     * level down takes the fifth opening away. The cap is the only thing that renders an opening, so
     * the key below it costs nothing to keep — and deleting it cannot be undone: correct the level
     * back and the player would get the build's default in place of the cantrip they prepared. */
    const b = flexCleric(4);
    expect(mainCasting(built(b))?.cantripCap, 'fixture: 5 openings at 4th level').toBe(5);
    let play = initialPlay(built(b), db);
    play = setPreparedCantrip(play, ENTRY, 0, 'guidance');
    play = setPreparedCantrip(play, ENTRY, 4, 'shield');
    const down = save(b, play, flexCleric(3));
    expect(mainCasting(sheet(down))?.cantripSlots).toHaveLength(4);
    expect(mainCasting(sheet(down))?.cantripSlots, 'an opening that is not there casts nothing').not.toContain(
      'shield',
    );
    expect(down.play.preparedSpells?.[`${ENTRY}:cantrip:0`], 'the openings that remain keep their picks').toBe(
      'guidance',
    );
    const back = save(flexCleric(3), down.play, b);
    expect(mainCasting(sheet(back))?.cantripSlots?.[4], 'the opening came back, and so did what was in it').toBe(
      'shield',
    );
  });

  it('cantrip opening: a BOOK caster keeps what they prepared on a Save that changes nothing', () => {
    /* The cap is the only test an opening gets, and this is why. A built spellbook holds ranks 1 and
     * up — build.ts fills it off the SLOT table, which starts at 1 — so "is this cantrip in the
     * book?" answers NO for every cantrip a wizard, witch or magus has ever prepared. Asking it
     * deleted all of them on any Save at all, with no builder edit involved. */
    const b = wizard(3, { 1: ['force-barrage', 'grease'] }, ['detect-magic', 'light']);
    const ch = built(b);
    // Still true after lane C1 (2026-10-14): the book's cantrips are `bookCantrips`, never `spellbook[0]`.
    expect(mainCasting(ch)?.spellbook?.[0], 'fixture: a built spellbook has no rank-0 list').toBeUndefined();
    expect(mainCasting(ch)?.cantripsPrepared, 'fixture: a wizard re-prepares cantrips daily').toBe(true);
    const play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 0, 'shield');
    const after = save(b, play); // the IDENTICAL build
    expect(after.play.preparedSpells?.['wizard-casting:cantrip:0']).toBe('shield');
    expect(mainCasting(sheet(after))?.cantripSlots?.[0], 'the wizard woke up with yesterday\'s cantrip').toBe('shield');
    // …and since lane C1 shield (not in this wizard's book) is marked "Not in your spellbook", never hidden.
    expect(mainCasting(sheet(after))?.notInBook).toContain('shield');
  });

  it('cantrip opening: a spell that is not a cantrip is not drawn as one — and is not deleted', () => {
    /* ③④ were the last row claiming to have no list at all ("there is no rank-0 list to check
     * against"), and there is one: `optionsFor(0)` is the tradition's CANTRIPS. A 4th-rank spell
     * parked in an opening rendered as an at-will cantrip, castable, for free, for ever. */
    const b = { ...preparedCleric(5, {}), cantrips: ['guidance', 'light'] } as BuildState;
    const ch = built(b);
    expect(db.spells['fly']?.rank, 'fixture: a spell nobody may prepare as a cantrip').toBe(4);
    const play = setPreparedCantrip(initialPlay(ch, db), ENTRY, 0, 'fly');
    expect(mainCasting(applyPlayState(ch, play, db))?.cantripSlots?.[0], 'not a cantrip, not drawn').toBeNull();
    expect(mainCasting(applyPlayState(ch, play, db))?.cantrips, 'and not castable at will either').not.toContain('fly');
    const after = save(b, play);
    expect(after.play.preparedSpells?.[`${ENTRY}:cantrip:0`], 'and the Save deletes nothing').toBe('fly');
  });

  it('cantrip opening: a BOOK caster\'s opening DRAWS the tradition (and its book) — the render half', () => {
    /* The engine keeps a caster's cantrips in `entry.cantrips` and fills the spellbook off the SLOT
     * table, which starts at rank 1 — so the book cannot answer about a cantrip at all. It says
     * "cannot say" and the tradition answers, for the picker (which offered an EMPTY list to every
     * wizard, witch and magus) and for the render alike.
     * ⚠ Lane C1 (2026-10-14) changed the PICKER half: the book now answers at rank 0 (`bookCantrips`)
     * and the picker offers only it (test/book-cantrips.test.ts); the RENDER, pinned here, still draws
     * the tradition ∪ the book, so an arcane pick made before that is drawn (marked), a divine one not. */
    const b = wizard(3, { 1: ['force-barrage', 'grease'] }, ['detect-magic', 'light']);
    const ch = built(b);
    expect(mainCasting(ch)?.spellbook?.[0], 'fixture: a built spellbook has no rank-0 list').toBeUndefined();
    const arcane = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 0, 'shield');
    expect(mainCasting(applyPlayState(ch, arcane, db))?.cantripSlots?.[0], 'an arcane cantrip is drawn').toBe('shield');
    const divine = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 0, 'stabilize');
    expect(db.spells['stabilize']?.traditions, 'fixture: not on the arcane list').not.toContain('arcane');
    expect(mainCasting(applyPlayState(ch, divine, db))?.cantripSlots?.[0], 'and one off the list is not').not.toBe(
      'stabilize',
    );
  });

  it('cantrip opening: a cantrip the character KNOWS off-tradition can be prepared back into an opening', () => {
    /*
     * …and the tradition is not the WHOLE answer, which is what made the widening above dangerous.
     * Adapted Cantrip buys a cantrip from another tradition on purpose ("Choose one cantrip from a
     * magical tradition other than your own"), and the openings only became reachable for a book
     * caster once the book stopped saying "nothing" at rank 0 — so the first thing a wizard could do
     * with them was re-prepare the opening the off-tradition cantrip was sitting in and lose it for
     * good: gone from the sheet, and offered back by no picker in the app, ever.
     *
     * An opening therefore offers the tradition PLUS what the character knows (`cantripPool`, the
     * build's own list, which the overlay keeps beside the rewritten one so both surfaces answer the
     * same).
     */
    const b = {
      ...wizard(5, { 1: ['force-barrage', 'grease'] }, ['light', 'shield', 'detect-magic']),
      featPicks: { '2:class': 'adapted-cantrip' },
      featChoices: { '2:class': 'guidance' },
    } as unknown as BuildState;
    const ch = built(b);
    const entry = mainCasting(ch)!;
    expect(entry.cantrips, 'fixture: the feat put an off-tradition cantrip in the pool').toContain('guidance');
    expect(db.spells['guidance']?.traditions, 'fixture: and it is not arcane').not.toContain('arcane');
    const i = entry.cantrips.indexOf('guidance');
    expect(mainCasting(applyPlayState(ch, initialPlay(ch, db), db))?.cantripSlots?.[i], 'fixture: its opening holds it').toBe(
      'guidance',
    );
    // The player re-prepares that opening with something else — an ordinary morning.
    const play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', i, 'daze');
    const shown = mainCasting(applyPlayState(ch, play, db))!;
    expect(shown.cantripSlots?.[i]).toBe('daze');
    expect(shown.cantrips, 'so it is not prepared today').not.toContain('guidance');
    // …and the picker offers it back — the one thing that was impossible.
    const opts = spellOptions({ character: applyPlayState(ch, play, db), entry: shown, content: db }, 0).map((s) => s.id);
    expect(opts, 'the opening offers what the character knows, not only the tradition').toContain('guidance');
    // The render is the same answer: put it back and it draws.
    const back = setPreparedCantrip(play, 'wizard-casting', i, 'guidance');
    expect(mainCasting(applyPlayState(ch, back, db))?.cantripSlots?.[i]).toBe('guidance');
    // …and an ordinary off-list spell is still refused, so the widening is exactly this wide.
    expect(opts, 'a cantrip they do not know and cannot cast is still not offered').not.toContain('stabilize');
  });

  it('cantrip-trade opening: the openings bought with a traded slot are kept too', () => {
    /* "You can also trade any spell slot for two additional cantrips" — those openings ride the same
     * map under `entry:0:c<i>`, a third key shape, and they are cantrips: there is no list to hold
     * them to, so they are kept exactly as the ordinary openings are. */
    const b = blendingWizard(5, BOOK5);
    const ch = built(b);
    const start = initialPlay(ch, db);
    let play = addSpellTrade(start, mainCasting(applyPlayState(ch, start, db))!, 1, CANTRIP_TRADE);
    play = setTradedCantrip(play, 'wizard-casting', 0, 'shield');
    const after = save(b, play, blendingWizard(5, { ...BOOK5, 1: ['force-barrage', 'mage-armor'] }));
    expect(after.play.preparedSpells?.[cantripTradeKey('wizard-casting', 0)]).toBe('shield');
    expect(mainCasting(sheet(after))?.tradedCantrips?.[0], 'the opening kept what was in it').toBe('shield');
  });

  /* ---- 3. a spontaneous/flexible caster's repertoire ---- */

  it('repertoire: the build\'s answer at the rank moves, the player\'s legal collection stands', () => {
    const b = bard(3, { 1: ['soothe', 'fear'], 2: ['sound-body'] });
    let play = initialPlay(built(b), db);
    play = setRepertoireRank(play, 'bard-casting', 1, ['bless', 'fear', 'sure-strike']);
    play = setRepertoireRank(play, 'bard-casting', 2, ['blur']);
    const after = save(b, play, bard(3, { 1: ['soothe', 'fear'], 2: ['invisibility'] }));
    const rep = mainCasting(sheet(after))?.repertoire;
    expect(rep?.[1], 'the rank the build did not move').toEqual(['bless', 'fear', 'sure-strike']);
    expect(
      rep?.[2],
      'the rank the build DID move — the player still knows blur, AND the builder\'s new pick arrives',
    ).toEqual(['blur', 'invisibility']);
  });

  it('repertoire: a spell ADDED in the builder reaches a rank the sheet has already overridden', () => {
    /*
     * A stored rank replaces the build's answer outright — that is what an override is — so a spell
     * the player added in the BUILDER at a rank they had touched on the sheet was invisible there and
     * unreachable except by adding it a second time in Manage spells. It is a pick they made, and the
     * rule does not care which surface they made it on.
     *
     * `sure-strike` is the enigma muse's grant, which arrives on its own; `bless` is the builder's.
     */
    const b4 = bard(4, { 1: ['soothe', 'fear'] }, {}, 'enigma');
    const b5 = bard(5, { 1: ['soothe', 'fear', 'bless'] }, {}, 'enigma');
    const play = setRepertoireRank(initialPlay(built(b4), db), 'bard-casting', 1, ['soothe', 'fear', 'sure-strike']);
    expect(mainCasting(built(b5))?.repertoire?.[1], 'fixture: the build itself lists all four').toEqual(
      expect.arrayContaining(['soothe', 'fear', 'bless', 'sure-strike']),
    );
    const after = save(b4, play, b5);
    expect(mainCasting(sheet(after))?.repertoire?.[1]).toEqual(['soothe', 'fear', 'sure-strike', 'bless']);
  });

  it('repertoire: …but a level correction down and up does NOT re-add what the player took off', () => {
    /* The other side of the same rule. A rank the PREVIOUS build did not have says nothing about what
     * the builder has just done, so `bless` — which the player removed on the sheet — must not come
     * back through the door the arrival above opens. */
    const b3 = bard(3, { 1: ['soothe', 'bless'] });
    const b1 = bard(1, { 1: ['soothe', 'bless'] });
    const play = setRepertoireRank(initialPlay(built(b3), db), 'bard-casting', 1, ['soothe', 'fear']);
    const down = save(b3, play, b1);
    const back = save(b1, down.play, b3);
    expect(mainCasting(sheet(back))?.repertoire?.[1], 'the round trip changed nothing of theirs').toEqual(
      expect.not.arrayContaining(['bless']),
    );
  });

  /*
   * ⑥ — THE LEVEL DIP, where the previous character cannot answer at all.
   *
   * The append used to be gated on the PREVIOUS build having the rank, and a level entered wrong and
   * corrected is exactly the case that gate cannot judge: rank 3 is on neither the 3rd-level
   * character nor anything else the Save can see, so "on the fresh list and not in the store" is the
   * builder's new spell AND the one the player took off, indistinguishable. Refusing both lost the
   * builder's PERMANENTLY — from the next Save on, `everWas` holds it and it can never arrive.
   *
   * ⛔ THE TIE IS BROKEN IN FAVOUR OF THE APPEND, and the losing side is asserted below rather than
   * argued away. A ledger of the player's own ✕ clicks was tried here for one round; the owner ruled
   * it out (R1, 2026-09-22) — the Save consults no player-written store and prunes none. So at the one
   * rank the previous character never had, a spell the player removed on the sheet comes back with the
   * correction. Nothing is DELETED by it; a spell reappears, and the ✕ is one click away.
   *
   * Every id is occult and 3rd rank, so nothing here is hidden for tradition or ceiling and only the
   * append is under test.
   */
  const ENIGMA7 = (spells: Record<number, string[]>) => bard(7, spells, {}, 'enigma');
  const DIPPED = bard(3, { 1: ['soothe'] }, {}, 'enigma'); // a 3rd-level bard has no 3rd rank at all

  it('repertoire: a spell the builder adds survives the level dip that takes the rank away and back', () => {
    const b7 = ENIGMA7({ 3: ['haste'] });
    const ch = built(b7);
    const granted = mainCasting(ch)?.grantedRepertoire?.[3] ?? [];
    expect(mainCasting(ch)?.repertoire?.[3], 'fixture: the builder chose one 3rd-rank spell').toContain('haste');
    // The player adds one of their own on the sheet.
    const play = addRepertoireSpell(initialPlay(ch, db), 'bard-casting', 3, 'agonizing-despair', ['haste'], granted);
    expect(play.repertoireSpells?.['bard-casting']?.[3]).toEqual(['haste', 'agonizing-despair']);
    // The level is entered wrong, and corrected — with the builder adding a spell of its own.
    const down = save(b7, play, DIPPED);
    const back = save(DIPPED, down.play, ENIGMA7({ 3: ['haste', 'sculpt-sound'] }));
    expect(mainCasting(sheet(back))?.repertoire?.[3], 'theirs, and the builder\'s new one').toEqual(
      expect.arrayContaining(['haste', 'agonizing-despair', 'sculpt-sound']),
    );
    // …and it is in the STORE, which is what makes the loss permanent when it does not arrive: from
    // the next Save on it is on the previous character too, so this is its only chance.
    expect(back.play.repertoireSpells?.['bard-casting']?.[3]).toContain('sculpt-sound');
  });

  it('repertoire: a removal at a rank the previous character never had comes back on the dip — D1 as written', () => {
    /*
     * The stated cost of R1, asserted so that it is a decision and not a surprise. The ✕ leaves no
     * record for the Save to read, so at a rank neither the previous character nor anything else can
     * answer for, the build's own spell is treated as the builder's word and appended. It is the
     * append above, seen from the other side — the two are the same line and cannot be told apart.
     *
     * ⚠ Nothing is DELETED here: the player's other picks at the rank are untouched.
     */
    const b7 = ENIGMA7({ 3: ['haste'] });
    const ch = built(b7);
    const granted = mainCasting(ch)?.grantedRepertoire?.[3] ?? [];
    let play = addRepertoireSpell(initialPlay(ch, db), 'bard-casting', 3, 'agonizing-despair', ['haste'], granted);
    play = removeRepertoireSpell(play, 'bard-casting', 3, 'haste', ['haste', 'agonizing-despair'], granted);
    expect(play.repertoireSpells?.['bard-casting']?.[3], 'the ✕ writes the list and nothing else').toEqual([
      'agonizing-despair',
    ]);
    const down = save(b7, play, DIPPED);
    const back = save(DIPPED, down.play, ENIGMA7({ 3: ['haste', 'sculpt-sound'] }));
    const rep = mainCasting(sheet(back))?.repertoire?.[3] ?? [];
    expect(rep, 'their own pick is theirs through both Saves').toContain('agonizing-despair');
    expect(rep, 'and the builder\'s new spell arrives').toContain('sculpt-sound');
    expect(rep, 'the build\'s own spell comes back with the rank — the accepted cost of D1').toContain('haste');
  });

  it('repertoire: a removal at a rank the previous character DID have stands through a round trip', () => {
    // The ordinary case, and the one the player meets: `everWas` holds the spell, so the ✕ is the
    // later word and the Save has no reason to append it. No ledger is needed for this.
    const b7 = ENIGMA7({ 3: ['haste'] });
    const ch = built(b7);
    const play = removeRepertoireSpell(initialPlay(ch, db), 'bard-casting', 3, 'haste', ['haste'], []);
    expect(play.repertoireSpells?.['bard-casting']?.[3]).toEqual([]);
    const after = save(b7, play, ENIGMA7({ 3: ['haste', 'sculpt-sound'] }));
    const rep = mainCasting(sheet(after))?.repertoire?.[3] ?? [];
    expect(rep, 'the app does not put back what the player took off').not.toContain('haste');
    expect(rep, 'and the builder\'s own new spell still arrives, through the same door').toContain('sculpt-sound');
    // Three more ordinary Saves change nothing either way.
    let p = after;
    for (let i = 0; i < 3; i++) p = save(ENIGMA7({ 3: ['haste', 'sculpt-sound'] }), p.play);
    expect(mainCasting(sheet(p))?.repertoire?.[3] ?? []).not.toContain('haste');
  });

  it('repertoire: ✕ then Add is exactly the list, with no second store behind it', () => {
    const b7 = ENIGMA7({ 3: ['haste'] });
    const ch = built(b7);
    const gone = removeRepertoireSpell(initialPlay(ch, db), 'bard-casting', 3, 'haste', ['haste'], []);
    const again = addRepertoireSpell(gone, 'bard-casting', 3, 'haste', [], []);
    expect(again.repertoireSpells?.['bard-casting']?.[3]).toEqual(['haste']);
    // ⛔ R1 — the writers touch `repertoireSpells` and nothing else. A second store, written by the
    // player's ✕ and then READ AND PRUNED by the Save, is what was taken out; the guard is that no
    // field of PlayState and no expression in play.ts names one again. (The withdrawn row in the
    // table names it in prose, which is the point of the row, so the guard is on the syntax.)
    expect(Object.keys(again).filter((k) => /^repertoire/.test(k))).toEqual(['repertoireSpells']);
    const src = readFileSync('src/rules/play.ts', 'utf8');
    expect(src.match(/repertoireRemoved\s*[?:.[]/g), 'the removal ledger is back — the Save reads no player store').toBeNull();
  });

  it('repertoire: a rank the fresh build no longer has stops rendering — and is NOT deleted', () => {
    // applyPlayState walks the FRESH repertoire's ranks, so a rank the build does not have shows
    // nothing whatever the overlay says. Keeping the override therefore costs nothing, and dropping
    // it costs the player the whole collection they chose there the moment the rank comes back.
    const b = bard(3, { 1: ['soothe', 'fear'], 2: ['sound-body'] });
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 2, ['blur']);
    const down = save(b, play, bard(1, { 1: ['soothe', 'fear'] })); // a 1st-level bard has no 2nd rank
    expect(mainCasting(sheet(down))?.repertoire?.[2]).toBeUndefined();
    expect(down.play.repertoireSpells?.['bard-casting']?.[2], 'nothing renders it; nothing deletes it').toEqual([
      'blur',
    ]);
    const back = save(bard(1, { 1: ['soothe', 'fear'] }), down.play, b); // the wrong level, corrected
    // Their `blur` is back, and so is the build's own `sound-body`: a spell the build lists and the
    // store does not is the BUILDER's unless the player took it off, and this fixture's store was
    // written directly rather than by the ✕ (the removal case is its own test, below).
    expect(mainCasting(sheet(back))?.repertoire?.[2]).toEqual(['blur', 'sound-body']);
  });

  it('repertoire: a collection bigger than the fresh build allows still DRAWS, and REPORTS `overCap`', () => {
    /*
     * ⛔ THE REVERSAL. 4 known at 1st rank is legal for a 3rd-level bard and two too many for a
     * 1st-level one, and the renderer used to hold the extra back: not a delete, and it returns when
     * the cap does. Except that Manage-spells read the list it was SHOWING and wrote it straight
     * back, so one ordinary add or remove at a rank with something held back collapsed the store to
     * the drawn list — with the player never seeing what the click was about to take.
     *
     * So the cap lives where refusing costs nobody anything they already had (the picker's add gate),
     * over-cap is DRAWN in full, and the entry says so rather than the app quietly choosing a victim.
     */
    const b = bard(3, { 1: ['soothe', 'fear'], 2: ['sound-body'] });
    const stored = ['soothe', 'fear', 'charm', 'ill-omen'];
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, stored);
    const after = save(b, play, bard(1, { 1: ['soothe', 'fear'] }));
    expect(mainCasting(after.character)?.slots?.[1]?.max, 'fixture: a 1st-level bard has two places').toBe(2);
    expect(mainCasting(after.character)?.grantedRepertoire?.[1], 'fixture: the muse grants one on top').toEqual([
      'sure-strike',
    ]);
    expect(mainCasting(sheet(after))?.repertoire?.[1], 'every one of them is the player\'s own pick').toEqual([
      'sure-strike',
      ...stored,
    ]);
    expect(mainCasting(sheet(after))?.overCap, 'and the sheet is told, so it can say so').toContainEqual({
      rank: 1,
      by: 2,
    });
    // …and a collection that FITS reports nothing (three of their own, three places at 3rd level).
    const legal = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, ['soothe', 'fear', 'charm']);
    expect(mainCasting(sheet(save(b, legal)))?.overCap).toBeUndefined();
  });

  it('repertoire: the ADD GATE refuses while the collection is over its cap — the flat pool too', () => {
    /* The other half of D5. The render draws every one of the player's spells and reports; the gate
     * is what stops the state getting worse, and it is the same function the report is computed
     * against (`repertoireCap` / `chosenAt`, beside `spellOptions`), so the picker cannot offer a
     * place the sheet does not have. SpellsTab's Add button is exactly `chosenAt < repertoireCap`. */
    const b = bard(3, { 1: ['soothe', 'fear'], 2: ['sound-body'] });
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, [
      'soothe',
      'fear',
      'charm',
      'ill-omen',
    ]);
    const over = mainCasting(sheet(save(b, play, bard(1, { 1: ['soothe', 'fear'] }))))!;
    expect(chosenAt(over, 1) < repertoireCap(over, 1), 'the Add button is not offered').toBe(false);

    // …and a FLEXIBLE collection is full as a POOL, not at a rank — the report says `rank: 0`.
    const fb = flexCleric(3);
    const fch = built(fb);
    const size = mainCasting(fch)?.spellCollection ?? 0;
    expect(size, 'fixture: the archetype sizes the pool').toBeGreaterThan(1);
    const spells = ['heal', 'bless', 'sanctuary', 'admonishing-ray', 'harm'].slice(0, size + 1);
    const fplay = setRepertoireRank(initialPlay(fch, db), ENTRY, 1, spells);
    const flex = mainCasting(sheet(save(fb, fplay)))!;
    expect(flex.repertoire?.[1], 'every one of them is drawn').toEqual(spells);
    expect(flex.overCap, 'and the pool says how far over it is').toContainEqual({ rank: 0, by: 1 });
    expect(chosenAt(flex, 1) < repertoireCap(flex, 1), 'the Add button is not offered').toBe(false);
  });

  it('repertoire: the ADD GATE counts what the store HOLDS, not what the rank is drawing', () => {
    /*
     * ⛔ The docblock claims over-cap is a state only a BUILD edit can produce, and the SHEET could
     * produce it: the gate counted the DRAWN list while the store held more. Fill a rank to its cap
     * with arcane-only spells, swap the bloodline to a divine one and every single one of them is
     * hidden — so the rank looked empty to the picker, which handed out a full rank's worth of new
     * places. Swap back and the player has twice the cap, from the sheet alone.
     *
     * `chosenAt` reads `repertoireHeld`, written by the render off the store, so the places the gate
     * hands out are places the player really has.
     */
    const b = sorcerer(5, 'bloodline-draconic');
    const ch = built(b);
    const cap = repertoireCap(mainCasting(ch)!, 1);
    expect(cap, 'fixture: a rank with places to fill').toBeGreaterThan(1);
    const arcaneOnly = Object.values(db.spells)
      .filter((s) => s.rank === 1 && !s.ritual && s.traditions.includes('arcane') && !s.traditions.includes('divine'))
      .map((s) => s.id)
      .slice(0, cap);
    expect(arcaneOnly, 'fixture: enough arcane-only 1st-rank spells to fill it').toHaveLength(cap);
    let play = initialPlay(ch, db);
    for (const id of arcaneOnly) play = addRepertoireSpell(play, SORC, 1, id, [], mainCasting(ch)?.grantedRepertoire?.[1] ?? []);
    expect(play.repertoireSpells?.[SORC]?.[1], 'fixture: the rank is full, all of it theirs').toHaveLength(cap);

    const after = save(b, play, sorcerer(5, 'bloodline-angelic')); // arcane → divine
    const shown = mainCasting(sheet(after))!;
    const granted = shown.grantedRepertoire?.[1] ?? [];
    expect((shown.repertoire?.[1] ?? []).filter((id) => !granted.includes(id)), 'fixture: nothing of theirs draws').toEqual([]);
    expect(chosenAt(shown, 1), 'the gate counts the full rank they hold').toBe(cap);
    expect(chosenAt(shown, 1) < repertoireCap(shown, 1), 'so it refuses, with the rank looking empty').toBe(false);
    // …and the report is about what is DRAWN, so an invisible spell never puts a chip on a rank the
    // player is looking at: "one over the limit — remove one" with nothing there to remove.
    expect(shown.overCap, 'nothing drawn is over anything').toBeUndefined();
    /*
     * ⛔ D5's OTHER SIDE, which this fix opened and did not close (refuter, 2026-09-22): the refusal
     * was hidden, not the spell. The rank said "Repertoire full (4 known)" beside a list holding
     * nothing of theirs, with no ✕ to free a place and no Add button at all — four spells counted,
     * invisible, and unreported, which is the same sentence D5 forbids read from the other end.
     * `hiddenAt` is that number, and the sheet's two cap sentences both carry it.
     */
    expect(hiddenAt(shown, 1), 'the whole rank is held and none of it drawn').toBe(cap);
    const tab = readFileSync('src/sheet/SpellsTab.tsx', 'utf8');
    expect(/const hiddenNote = \(rank: number\)/.test(tab), 'the sentence is computed in one place').toBe(true);
    expect(tab.match(/hiddenNote\(/g)?.length, 'and called on BOTH cap sentences, nowhere else').toBe(2);
    expect(
      /Repertoire full \(\$\{repCap\(rank\)\} known\)`\) \+ hiddenNote\(rank\)/.test(tab),
      'the rank note says how many of them cannot be drawn',
    ).toBe(true);
    expect(/hiddenNote\(picking\.rank\) \+/.test(tab), 'and so does the refused Add row').toBe(true);
  });

  it('repertoire: where nothing is hidden, the cap sentences say nothing extra', () => {
    // The other leg — the note is a report of a state, not decoration on every full rank.
    const b = sorcerer(5, 'bloodline-draconic');
    const ch = built(b);
    const cap = repertoireCap(mainCasting(ch)!, 1);
    const arcane = Object.values(db.spells)
      .filter((s) => s.rank === 1 && !s.ritual && s.traditions.includes('arcane'))
      .map((s) => s.id)
      .filter((id) => !(mainCasting(ch)?.grantedRepertoire?.[1] ?? []).includes(id))
      .slice(0, cap);
    let play = initialPlay(ch, db);
    for (const id of arcane) play = addRepertoireSpell(play, SORC, 1, id, [], mainCasting(ch)?.grantedRepertoire?.[1] ?? []);
    const shown = mainCasting(sheet(save(b, play)))!;
    expect(chosenAt(shown, 1), 'a full rank').toBe(cap);
    expect(hiddenAt(shown, 1), 'and every one of them on screen').toBe(0);
  });

  it('repertoire: a pick the build LATER GRANTS survives the next unrelated write, and comes back theirs', () => {
    /*
     * ⛔ THE ONE THAT DESTROYED A PICK, and it was the WRITER, not the Save (refuter, 2026-09-22).
     * D2 says a grant is never stored; ordinary play can still put one there, because a spell the
     * player bought can BECOME a grant at the next build edit. `storedRank` filtered the grants out
     * of the STORED list as well as out of the build's fallback, so the very next add or remove
     * anywhere at that rank rewrote the rank without it: one unrelated click and `fear` was in no
     * build, no grant and no store — permanently, and with the player never seeing it go.
     *
     * The strip belongs on the fallback alone, which is the only path that can put a grant IN. The
     * store keeps the pick; the render de-duplicates so it draws once; the count treats it as the
     * grant it currently is (a grant has never spent a place); swap the grant away and it is theirs
     * again, drawn and counted.
     */
    const b = sorcerer(5, 'bloodline-angelic');
    const ch = built(b);
    const granted = mainCasting(ch)?.grantedRepertoire?.[1] ?? [];
    expect(granted, 'fixture: their bloodline does not grant fear').not.toContain('fear');
    const play = addRepertoireSpell(initialPlay(ch, db), SORC, 1, 'fear', [], granted);
    expect(play.repertoireSpells?.[SORC]?.[1]).toEqual(['fear']);

    const after = save(b, play, sorcerer(5, 'bloodline-draconic')); // whose sorcerous gift IS fear
    expect(mainCasting(after.character)?.grantedRepertoire?.[1], 'fixture: the new bloodline grants it').toContain('fear');
    expect(after.play.repertoireSpells?.[SORC]?.[1], 'the Save deletes nothing — it is still their pick').toEqual(['fear']);
    const shown = mainCasting(sheet(after))!;
    expect((shown.repertoire?.[1] ?? []).filter((id) => id === 'fear'), 'and it is drawn exactly once').toEqual(['fear']);
    expect(chosenAt(shown, 1), 'counted as the grant it now is — a grant spends no place').toBe(0);
    // THE CLICK THAT USED TO DELETE IT: an ordinary Add of another spell, exactly as SpellsTab's
    // `pick` makes it (own = what the render draws minus the grants, granted = the fresh grants).
    const ownNow = (shown.repertoire?.[1] ?? []).filter((id) => !(shown.grantedRepertoire?.[1] ?? []).includes(id));
    // On BOTH traditions, so the swap back is the only thing under test — a spell only the draconic
    // list holds would go undrawn on the angelic one for a reason that has nothing to do with this.
    const shared = Object.values(db.spells).find(
      (s) => s.rank === 1 && !s.ritual && s.traditions.includes('arcane') && s.traditions.includes('divine'),
    )!.id;
    const next = addRepertoireSpell(after.play, SORC, 1, shared, ownNow, shown.grantedRepertoire?.[1] ?? []);
    expect(next.repertoireSpells?.[SORC]?.[1], 'the unrelated add must not take their spell with it').toEqual([
      'fear',
      shared,
    ]);
    // …and the same for a remove, which walks the same `storedRank`.
    const gone = removeRepertoireSpell(next, SORC, 1, shared, ownNow, shown.grantedRepertoire?.[1] ?? []);
    expect(gone.repertoireSpells?.[SORC]?.[1]).toEqual(['fear']);

    // Swap the bloodline back: no grant covers it now, and it is their own pick again — drawn, and
    // counted against their cap, which is what "theirs again" has to mean.
    const back = save(sorcerer(5, 'bloodline-draconic'), next, b);
    const backShown = mainCasting(sheet(back))!;
    expect(backShown.repertoire?.[1], 'their two spells, plus the angelic grant').toEqual(
      expect.arrayContaining(['fear', shared]),
    );
    expect(chosenAt(backShown, 1), 'both of them count now').toBe(2);
  });

  it('repertoire: a pick the build grants and then withdraws can put the rank OVER, and it is reported', () => {
    /*
     * The tail of the case above, and the reason it is safe to keep the pick in the store: the place
     * the grant freed can be spent while the grant covers it, so withdrawing the grant can leave the
     * rank one over its cap. That is a build edit producing an over-cap rank — D5's own case — so
     * every spell is drawn and the chip says so, rather than one of them being quietly dropped.
     */
    const b = sorcerer(5, 'bloodline-angelic');
    const ch = built(b);
    const cap = repertoireCap(mainCasting(ch)!, 1);
    // On both lists, so the swap moves only the GRANT — a spell off the divine list would be undrawn
    // at the end for an unrelated reason, and the report counts what is drawn.
    const fill = Object.values(db.spells)
      .filter(
        (s) =>
          s.rank === 1 &&
          !s.ritual &&
          s.id !== 'fear' &&
          s.traditions.includes('arcane') &&
          s.traditions.includes('divine'),
      )
      .map((s) => s.id)
      .slice(0, cap);
    expect(fill, 'fixture: enough shared spells to fill the rank beside the grant').toHaveLength(cap);
    expect(db.spells['fear']?.traditions, 'fixture: fear draws on either bloodline').toContain('divine');

    // They buy `fear` while nothing grants it, then the bloodline swaps to the one that DOES: their
    // pick is covered by the grant and spends no place, so the gate lets them fill the rank beside it.
    const play = addRepertoireSpell(initialPlay(ch, db), SORC, 1, 'fear', [], []);
    const mid = save(b, play, sorcerer(5, 'bloodline-draconic'));
    const midShown = mainCasting(sheet(mid))!;
    expect(midShown.grantedRepertoire?.[1], 'fixture: the draconic gift IS fear').toContain('fear');
    expect(chosenAt(midShown, 1), 'the grant covers it, so the rank is empty of their own').toBe(0);
    let filled = mid.play;
    for (const id of fill)
      filled = addRepertoireSpell(filled, SORC, 1, id, [], midShown.grantedRepertoire?.[1] ?? []);
    expect(filled.repertoireSpells?.[SORC]?.[1]).toHaveLength(cap + 1);

    const after = save(sorcerer(5, 'bloodline-draconic'), filled, b); // the grant goes again
    const shown = mainCasting(sheet(after))!;
    expect(shown.repertoire?.[1], 'nothing is hidden to make the number fit').toEqual(
      expect.arrayContaining(['fear', ...fill]),
    );
    expect(shown.overCap?.find((o) => o.rank === 1)?.by, 'the chip, not a delete').toBe(1);
  });

  it('repertoire: an add or a remove at a rank with a HIDDEN stored spell keeps the hidden spell', () => {
    /*
     * The other half of the reversal. The render hides what the fresh build no longer offers, and the
     * writer must not be able to destroy what the render is hiding: Manage-spells used to hand the
     * store the whole list it was showing, so an unrelated click wrote the hidden spells away.
     *
     * The writers now name ONE id. Whatever else is in the store is none of that click's business.
     */
    const b = sorcerer(8, 'bloodline-angelic');
    const ch = built(b);
    // A spell on BOTH lists, so the bloodline swap does not hide it — and not a grant of either
    // bloodline, or it would not be the player's to remove.
    const SHARED = Object.values(db.spells).find(
      (s) => s.rank === 4 && !s.ritual && s.traditions.includes('divine') && s.traditions.includes('arcane'),
    )!.id;
    const stored = ['air-walk', 'anathematic-reprisal', 'cloak-of-light', SHARED];
    const play = setRepertoireRank(initialPlay(ch, db), SORC, 4, stored);
    const after = save(b, play, sorcerer(8, 'bloodline-draconic')); // divine → arcane
    const shown = mainCasting(sheet(after))?.repertoire?.[4] ?? [];
    expect(shown, 'fixture: the divine-only spells are hidden').not.toContain('air-walk');
    expect(shown, 'fixture: this one is on both lists, so it is showing').toContain(SHARED);
    const granted = mainCasting(sheet(after))?.grantedRepertoire?.[4] ?? [];
    expect(granted, 'fixture: and it is the player\'s own, not a grant').not.toContain(SHARED);
    // The player, looking at that list, removes the one spell it does show (SpellsTab `removeKnown`).
    const removed = removeRepertoireSpell(after.play, SORC, 4, SHARED, shown.filter((id) => !granted.includes(id)), granted);
    expect(removed.repertoireSpells?.[SORC]?.[4], 'their three are still there').toEqual([
      'air-walk',
      'anathematic-reprisal',
      'cloak-of-light',
    ]);
    // …and an ADD, the other write, keeps them too while taking the new spell (SpellsTab `pick`).
    const added = addRepertoireSpell(after.play, SORC, 4, 'wall-of-fire', shown.filter((id) => !granted.includes(id)), granted);
    expect(added.repertoireSpells?.[SORC]?.[4]).toEqual(expect.arrayContaining([...stored, 'wall-of-fire']));
    // Switch the bloodline back and every one of them is on the sheet again.
    const undone = save(sorcerer(8, 'bloodline-draconic'), added, b);
    expect(mainCasting(sheet(undone))?.repertoire?.[4]).toEqual(expect.arrayContaining(stored));
  });

  it('repertoire: a GRANT is never written into the store, and is drawn all the same', () => {
    /*
     * ⛔ D2. A grant is a rule, not a pick — *"can't be removed in play"* — so the writers strip it
     * and renderRepertoire re-injects the FRESH build's grants on top at every render. The store used
     * to take whatever the sheet was showing, grants included, and then the Save wrote MORE of them
     * in: a muse swapped away and back left `fear` in the player's own store for ever, drawn,
     * castable, spending one of their three places at the cap, and impossible to tell from a spell
     * they had chosen for themselves.
     */
    const b = bard(3, { 1: ['soothe'] }, {}, 'enigma');
    const ch = built(b);
    const shown = mainCasting(applyPlayState(ch, initialPlay(ch, db), db))?.repertoire?.[1] ?? [];
    expect(shown, 'fixture: the enigma muse grants sure strike, and it is drawn').toContain('sure-strike');
    const granted = mainCasting(ch)?.grantedRepertoire?.[1] ?? [];
    const own = shown.filter((id) => !granted.includes(id));
    // The player adds one spell on the sheet, looking at that list.
    const play = addRepertoireSpell(initialPlay(ch, db), 'bard-casting', 1, 'charm', own, granted);
    expect(play.repertoireSpells?.['bard-casting']?.[1], 'the store holds the PLAYER\'S picks, alone').toEqual([
      'soothe',
      'charm',
    ]);
    expect(mainCasting(sheet({ character: ch, play }))?.repertoire?.[1], 'and the grant is drawn on top').toEqual([
      'sure-strike',
      'soothe',
      'charm',
    ]);
    // …and a remove is the same: it cannot write a grant in either.
    const back = removeRepertoireSpell(play, 'bard-casting', 1, 'charm', ['soothe', 'charm'], granted);
    expect(back.repertoireSpells?.['bard-casting']?.[1]).toEqual(['soothe']);
    // A Save writes none in either, at any level of the round trip.
    const round = save(bard(4, { 1: ['soothe'] }, {}, 'warrior'), save(b, play, bard(4, { 1: ['soothe'] }, {}, 'warrior')).play, b);
    expect(round.play.repertoireSpells?.['bard-casting']?.[1], 'swapped away and back, still theirs alone').toEqual([
      'soothe',
      'charm',
    ]);
    expect(mainCasting(sheet(round))?.repertoire?.[1], 'and the muse they have now grants, as a rule').toEqual([
      'sure-strike',
      'soothe',
      'charm',
    ]);
  });

  it('repertoire: a plain removal still removes', () => {
    const b = bard(3, { 1: ['soothe', 'fear'] });
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, ['soothe', 'fear', 'charm']);
    const after = removeRepertoireSpell(play, 'bard-casting', 1, 'fear', ['soothe', 'fear', 'charm']);
    expect(after.repertoireSpells?.['bard-casting']?.[1]).toEqual(['soothe', 'charm']);
    expect(mainCasting(sheet({ character: built(b), play: after }))?.repertoire?.[1]).not.toContain('fear');
  });

  it('repertoire: a rank whose cap merely SHRANK keeps drawing every one of them (8 → 7 → 8)', () => {
    /*
     * The far commoner level correction, and the one the cap used to destroy. A rank that VANISHES
     * was already protected (nothing renders it, so nothing deletes it); a rank that merely loses one
     * slot was TRIMMED at Save time, and nothing put the spell back on the way up — so the player
     * ended on the build they started from, with every pick legal in it, and one pick gone.
     *
     * An 8th-level angelic sorcerer has four 4th-rank slots and three at 7th. The trim ran on the
     * down-Save and `cloak-of-light` never came back. The cap moved to the renderer, which stopped
     * the delete — and then Manage-spells wrote the drawn list back over the store. So it is gone
     * from here too: over the cap is a state only a build edit produces, and every spell in it is the
     * player's own.
     */
    const OWN4 = ['air-walk', 'anathematic-reprisal', 'bloodspray-curse', 'cloak-of-light'];
    const b8 = sorcerer(8, 'bloodline-angelic');
    const ch8 = built(b8);
    expect(mainCasting(ch8)?.slots?.[4]?.max, 'fixture: four 4th-rank slots at 8th level').toBe(4);
    expect(mainCasting(built(sorcerer(7, 'bloodline-angelic')))?.slots?.[4]?.max, 'fixture: three at 7th').toBe(3);
    expect(mainCasting(ch8)?.grantedRepertoire?.[4], 'fixture: the bloodline grants one on top').toEqual([
      'divine-wrath',
    ]);
    // What the sheet stores when the player fills the rank is the OVERLAID list, grant included.
    const play = setRepertoireRank(initialPlay(ch8, db), SORC, 4, ['divine-wrath', ...OWN4]);
    expect(mainCasting(sheet({ character: ch8, play }))?.repertoire?.[4], 'fixture: all four fit').toEqual([
      'divine-wrath',
      ...OWN4,
    ]);
    const down = save(b8, play, sorcerer(7, 'bloodline-angelic')); // the level was wrong
    expect(mainCasting(sheet(down))?.repertoire?.[4], 'three places — and four of the player\'s spells').toEqual([
      'divine-wrath',
      ...OWN4,
    ]);
    expect(down.play.repertoireSpells?.[SORC]?.[4], 'and NOTHING of the player\'s is deleted').toEqual([
      'divine-wrath',
      ...OWN4,
    ]);
    const back = save(sorcerer(7, 'bloodline-angelic'), down.play, b8); // …and corrected
    expect(mainCasting(sheet(back))?.repertoire?.[4], 'the slot came back, and so did the spell').toEqual([
      'divine-wrath',
      ...OWN4,
    ]);
  });

  it('repertoire: a subclass change that moves the TRADITION takes the off-list spells off the sheet', () => {
    /*
     * The other half of ⑥'s legality, and the one nothing asked. `optionsFor` offers a spontaneous
     * caster `traditionSpellsByRank`, i.e. `s.traditions.includes(entry.tradition)` — so swapping an
     * angelic sorcerer (divine) for a draconic one (arcane) leaves every divine-only spell in the
     * repertoire rendered and castable off a list the sorcerer is not on. It is asked at RENDER,
     * where the content database is, and it is not a delete: swap the bloodline back and the
     * collection is whole.
     */
    const DIVINE_ONLY = ['air-walk', 'anathematic-reprisal', 'cloak-of-light'];
    for (const id of DIVINE_ONLY)
      expect(db.spells[id]?.traditions, `fixture: ${id} is divine and not arcane`).toEqual(
        expect.not.arrayContaining(['arcane']),
      );
    const SHARED = Object.values(db.spells).find(
      (s) => s.rank === 4 && !s.ritual && s.traditions.includes('divine') && s.traditions.includes('arcane'),
    )!.id;
    const b = sorcerer(8, 'bloodline-angelic');
    const ch = built(b);
    expect(mainCasting(ch)?.tradition).toBe('divine');
    const play = setRepertoireRank(initialPlay(ch, db), SORC, 4, ['divine-wrath', ...DIVINE_ONLY, SHARED]);
    const after = save(b, play, sorcerer(8, 'bloodline-draconic'));
    const rep = mainCasting(sheet(after))?.repertoire?.[4] ?? [];
    expect(mainCasting(sheet(after))?.tradition, 'fixture: the swap moved the caster to arcane').toBe('arcane');
    for (const id of DIVINE_ONLY) expect(rep, `${id} is on no list this sorcerer casts from`).not.toContain(id);
    expect(rep, 'a spell on BOTH lists is still the player\'s').toContain(SHARED);
    expect(rep, 'and the grant the sorcerer has NOW arrives').toContain('fly');
    expect(after.play.repertoireSpells?.[SORC]?.[4], 'nothing was deleted — swap back and it is all there').toEqual(
      expect.arrayContaining(DIVINE_ONLY),
    );
    const undone = save(sorcerer(8, 'bloodline-draconic'), after.play, b);
    expect(mainCasting(sheet(undone))?.repertoire?.[4], 'back on the divine list, back on the sheet').toEqual(
      expect.arrayContaining(DIVINE_ONLY),
    );
  });

  it('repertoire: a rule that WIDENS the list switches the tradition test off, it does not narrow it', () => {
    /* The tradition half is machine-readable only while nothing has widened the list. Mysterious
     * Repertoire — *"one spell in your spell repertoire not on the divine spell list"* — is kept as a
     * RULE rather than ~1,500 expanded ids, and SpellsTab's picker reads it; renderRepertoire does
     * not. Answering narrower than the picker would hide a spell the picker itself offered, so one of
     * these in play turns the tradition test off entirely. */
    const oracle14 = (feat?: string): BuildState =>
      ({
        ...oracle(14, {}),
        subclassId: 'flames',
        ...(feat ? { featPicks: { '14:class:0': feat } } : {}),
      }) as unknown as BuildState;
    const ARCANE_ONLY = Object.values(db.spells).find(
      (s) => s.rank === 4 && !s.ritual && s.traditions.includes('arcane') && !s.traditions.includes('divine'),
    )!.id;
    const withIt = oracle14('mysterious-repertoire');
    expect(built(withIt).spellListTraditions?.length, 'fixture: the feat widens the list as a rule').toBeTruthy();
    const pick = (b: BuildState) =>
      mainCasting(
        sheet(save(b, setRepertoireRank(initialPlay(built(b), db), 'oracle-casting', 4, [ARCANE_ONLY]))),
      )?.repertoire?.[4] ?? [];
    expect(pick(withIt), 'the rule says the oracle may know one — so the app may not hide it').toContain(ARCANE_ONLY);
    expect(pick(oracle14()), 'and without it the same spell is on no list this oracle casts from').not.toContain(
      ARCANE_ONLY,
    );
  });

  it('repertoire: a class that knows MORE spells than it has slots keeps all of them', () => {
    /* Oracular Clarity — *"Add two common 10th-rank divine spells to your repertoire. You gain a
     * single 10th-rank spell slot"* — is the one record whose repertoire is wider than its slot
     * table, so a cap read off the slot count alone threw away one of the two spells the build
     * itself had just handed the character. */
    const rank10 = Object.values(db.spells)
      .filter((s) => s.rank === 10 && s.traditions.includes('divine'))
      .map((s) => s.id)
      .slice(0, 2);
    expect(rank10, 'fixture: two 10th-rank divine spells to choose').toHaveLength(2);
    const b = oracle(20, { 10: rank10 });
    const ch = built(b);
    expect(mainCasting(ch)?.slots?.[10]?.max, 'fixture: one 10th-rank slot').toBe(1);
    expect(mainCasting(ch)?.repertoire?.[10], 'fixture: two 10th-rank spells known').toEqual(rank10);
    const play = setRepertoireRank(initialPlay(ch, db), 'oracle-casting', 10, rank10);
    expect(mainCasting(sheet(save(b, play)))?.repertoire?.[10]).toEqual(rank10);

    /* …and it must not matter WHICH SURFACE chose them. The cap used to be `slots[rank].max` widened
     * by the BUILDER'S OWN FILL, so a rank the player filled on the SHEET had no fill to read: the
     * same two spells drew when the builder picked them and the second vanished when the sheet did.
     * `repertoireCounts` is what grants the second one, and nothing on the entry carries it. */
    const empty = oracle(20, {});
    const chEmpty = built(empty);
    expect(mainCasting(chEmpty)?.repertoire?.[10], 'fixture: the builder chose none of them').toEqual([]);
    const onSheet = setRepertoireRank(initialPlay(chEmpty, db), 'oracle-casting', 10, rank10);
    expect(mainCasting(sheet(save(empty, onSheet)))?.repertoire?.[10], 'both, exactly as above').toEqual(rank10);
  });

  it('repertoire: …and the SHEET can put a different one back after removing one of them', () => {
    /*
     * The other half, and the half the render could not reach: the ADD GATE read `slots[rank].max`,
     * which is 1 where the record prints 2, so an oracle who removed one of their two 10th-rank
     * spells could never fill the place again — `chosenAt` 1, cap 1, the Add button gone for good.
     * `repertoireMax` carries the number `repertoireCounts` gives the BUILDER's own picker.
     */
    const rank10 = Object.values(db.spells)
      .filter((s) => s.rank === 10 && s.traditions.includes('divine'))
      .map((s) => s.id)
      .slice(0, 3);
    expect(rank10, 'fixture: three to choose from, so there is a different one to put back').toHaveLength(3);
    const b = oracle(20, { 10: rank10.slice(0, 2) });
    const ch = built(b);
    expect(mainCasting(ch)?.slots?.[10]?.max, 'fixture: one 10th-rank slot').toBe(1);
    expect(mainCasting(ch)?.repertoireMax?.[10], 'fixture: and two 10th-rank spells known').toBe(2);
    const play = setRepertoireRank(initialPlay(ch, db), 'oracle-casting', 10, rank10.slice(0, 2));
    const full = mainCasting(sheet(save(b, play)))!;
    expect(repertoireCap(full, 10), 'the cap is the repertoire\'s, not the slot pool\'s').toBe(2);
    expect(chosenAt(full, 10) < repertoireCap(full, 10), 'full, so no Add — correctly').toBe(false);
    const after = removeRepertoireSpell(play, 'oracle-casting', 10, rank10[1], rank10.slice(0, 2), []);
    const one = mainCasting(applyPlayState(ch, after, db))!;
    expect(chosenAt(one, 10) < repertoireCap(one, 10), 'one place free, so the Add button is back').toBe(true);
    const refilled = addRepertoireSpell(after, 'oracle-casting', 10, rank10[2], [rank10[0]], []);
    expect(mainCasting(applyPlayState(ch, refilled, db))?.repertoire?.[10]).toEqual([rank10[0], rank10[2]]);
  });

  it('signature: a ★ is not DRAWN on a spell the collection is holding back — and is not deleted', () => {
    /* ⑦ unioned the player's stars onto the granted ones with no test of its own while ⑥ held
     * off-list entries back, so the two readers answered differently about the same spell: a star
     * could ride one the sheet was not drawing. Low harm (a spell that is not there is not castable)
     * but it is a stored pick rendered unchecked, which is how every other row here started. */
    const b = sorcerer(8, 'bloodline-angelic');
    const ch = built(b);
    let play = setRepertoireRank(initialPlay(ch, db), SORC, 4, ['divine-wrath', 'air-walk']);
    play = setSignatureSpells(play, SORC, ['air-walk']);
    expect(mainCasting(sheet({ character: ch, play }))?.signature, 'fixture: starred, and on the sheet').toContain(
      'air-walk',
    );
    const after = save(b, play, sorcerer(8, 'bloodline-draconic')); // divine → arcane
    expect(mainCasting(sheet(after))?.repertoire?.[4], 'fixture: the spell is held back').not.toContain('air-walk');
    expect(mainCasting(sheet(after))?.signature ?? [], 'so the ★ is not drawn either').not.toContain('air-walk');
    expect(after.play.signatureSpells?.[SORC], 'and the ★ itself is kept').toContain('air-walk');
    const undone = save(sorcerer(8, 'bloodline-draconic'), after.play, b);
    expect(mainCasting(sheet(undone))?.signature ?? [], 'back together').toContain('air-walk');
  });

  it('repertoire: a grant the fresh build has withdrawn is simply not re-injected', () => {
    /* A granted spell is a RULE, not a pick — *"can't be removed in play"* — and it is not stored, so
     * a muse that is gone stops granting by itself, with nothing deleted anywhere. This used to need
     * the previous character, a cap comparison and a delete, and it was wrong in both directions: the
     * old grant sat there castable when the rank had room, and the player's own last pick was the one
     * cut when it did not. */
    const b = bard(3, { 1: ['soothe', 'bless'] }, {}, 'enigma');
    const ch = built(b);
    expect(mainCasting(ch)?.grantedRepertoire?.[1], 'fixture: the enigma muse grants sure strike').toEqual([
      'sure-strike',
    ]);
    // What the player does on the sheet: they add one spell to the list they are looking at.
    const shown = mainCasting(applyPlayState(ch, initialPlay(ch, db), db))?.repertoire?.[1] ?? [];
    const granted = mainCasting(ch)?.grantedRepertoire?.[1] ?? [];
    const play = addRepertoireSpell(
      initialPlay(ch, db),
      'bard-casting',
      1,
      'charm',
      shown.filter((id) => !granted.includes(id)),
      granted,
    );
    const after = save(b, play, bard(3, { 1: ['soothe', 'bless'] }, {}, 'warrior'));
    const rep = mainCasting(sheet(after))?.repertoire?.[1] ?? [];
    expect(rep, 'a muse that is gone does not still grant its spell').not.toContain('sure-strike');
    expect(rep, 'the grant the bard has NOW').toContain('fear');
    expect(rep, 'and nothing of the player\'s was spent paying for the change').toContain('charm');
    expect([...rep].sort()).toEqual(['bless', 'charm', 'fear', 'soothe']);
    expect(after.play.repertoireSpells?.['bard-casting']?.[1], 'the store never held either grant').toEqual([
      'soothe',
      'bless',
      'charm',
    ]);
  });

  it('repertoire: the grant the fresh build still makes stands, with everything around it', () => {
    const b = bard(3, { 1: ['soothe', 'bless'] }, {}, 'enigma');
    const stored = ['soothe', 'bless', 'charm'];
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, stored);
    expect(mainCasting(sheet(save(b, play)))?.repertoire?.[1]).toEqual(['sure-strike', ...stored]);
  });

  it('repertoire: an OLD store that still holds a grant keeps it as the player\'s own pick', () => {
    /* The one residue of the change, stated rather than hidden. A store written before the writers
     * began stripping grants has the muse's spell in it as if the player had chosen it, and the Save
     * deletes nothing — so after a muse swap it draws for as long as it stays LEGAL (it is an occult
     * spell a bard may well have picked). One removal on the sheet is enough to be rid of it, and it
     * can never come back, because nothing writes a grant in any more. */
    const b = bard(3, { 1: ['soothe'] }, {}, 'enigma');
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, ['soothe', 'sure-strike']);
    const after = save(b, play, bard(3, { 1: ['soothe'] }, {}, 'warrior'));
    const rep = mainCasting(sheet(after))?.repertoire?.[1] ?? [];
    expect(rep, 'the grant the bard has NOW still arrives').toContain('fear');
    expect(rep, 'and a legal spell in the player\'s own store is nobody\'s to delete').toContain('sure-strike');
    const cleaned = removeRepertoireSpell(after.play, 'bard-casting', 1, 'sure-strike', ['soothe', 'sure-strike']);
    expect(cleaned.repertoireSpells?.['bard-casting']?.[1], 'and one click is enough').toEqual(['soothe']);
  });

  it('repertoire: a former grant the BUILDER also chose is a pick, not a dead grant', () => {
    // Both are the same id in the same list and only the build can tell them apart. Dropping it with
    // the muse would delete a spell the fresh build itself still lists.
    const b = bard(3, { 1: ['soothe', 'sure-strike'] }, {}, 'enigma');
    const play = setRepertoireRank(initialPlay(built(b), db), 'bard-casting', 1, ['soothe', 'sure-strike']);
    const after = save(b, play, bard(3, { 1: ['soothe', 'sure-strike'] }, {}, 'warrior'));
    expect(mainCasting(sheet(after))?.repertoire?.[1]).toContain('sure-strike');
  });

  /* ---- 4. the player's ★ signature picks ---- */

  it('signature: the build\'s granted stars move, a ★ on a spell still known stands', () => {
    const b = bard(3, { 1: ['soothe', 'fear'] }, { 1: ['soothe'] });
    const play = setSignatureSpells(initialPlay(built(b), db), 'bard-casting', ['fear']);
    const after = save(b, play, bard(3, { 1: ['soothe', 'fear'] }, { 1: ['fear'] }));
    expect(after.play.signatureSpells?.['bard-casting']).toEqual(['fear']);
    expect(mainCasting(sheet(after))?.signature).toContain('fear');
  });

  it('signature: a ★ on a spell the fresh repertoire no longer holds is not DRAWN — and is not deleted', () => {
    const b = bard(3, { 1: ['soothe', 'fear'], 2: ['blur'] });
    const play = setSignatureSpells(initialPlay(built(b), db), 'bard-casting', ['blur']);
    // The builder swaps blur out and the player has no sheet pick at that rank, so nothing knows it.
    const after = save(b, play, bard(3, { 1: ['soothe', 'fear'], 2: ['invisibility'] }));
    expect(mainCasting(sheet(after))?.signature ?? [], 'a ★ on a spell that is not there draws nowhere').not.toContain(
      'blur',
    );
    expect(after.play.signatureSpells?.['bard-casting'], 'and the Save deletes nothing').toEqual(['blur']);
    // …so swapping it back in brings the player's own ★ with it.
    expect(mainCasting(sheet(save(bard(3, { 1: ['soothe', 'fear'], 2: ['invisibility'] }), after.play, b)))?.signature)
      .toContain('blur');
  });

  it('signature: a ★ left on a spell the player REMOVED from the repertoire draws nowhere', () => {
    /*
     * ⑦'s second renderer, and the reason the ★ is tested at all: SpellsTab `signatureEchoIds` draws
     * a castable echo card of every starred spell at every higher rank with a slot pool, and tests
     * only the RANK. Star a spell, then remove it in Manage spells — `removeKnown` touches the
     * collection and never the stars — and the sheet showed a spell the bard does not know as
     * castable at every rank from 2 up.
     */
    const b = bard(5, { 1: ['soothe', 'fear'], 2: ['blur'], 3: ['haste'] });
    const ch = built(b);
    let play = toggleSignatureSpell(initialPlay(ch, db), 'bard-casting', 'blur', ['blur']);
    expect(mainCasting(applyPlayState(ch, play, db))?.signature, 'fixture: starred while known').toContain('blur');
    const shown = mainCasting(applyPlayState(ch, play, db))?.repertoire?.[2] ?? [];
    play = removeRepertoireSpell(play, 'bard-casting', 2, 'blur', shown);
    const live = mainCasting(applyPlayState(ch, play, db));
    expect(live?.repertoire?.[2], 'the spell is gone from the collection').not.toContain('blur');
    expect(live?.signature ?? [], 'so the ★ draws nowhere — and nothing echoes it').not.toContain('blur');
    expect(play.signatureSpells?.['bard-casting'], 'the ★ itself is still the player\'s').toContain('blur');
  });

  it('signature: the ★ writer stores the player\'s own stars alone', () => {
    // D2/D3 for ⑦: a RECORD-granted star is a rule (`signatureFixed`) and never enters the store, and
    // the write names one id, so a ★ the render is hiding is not swept away by starring another.
    const b = bard(5, { 1: ['soothe', 'fear'], 2: ['blur'] }, { 1: ['soothe'] });
    const ch = built(b);
    const live = mainCasting(applyPlayState(ch, initialPlay(ch, db), db));
    expect(live?.signatureFixed, 'fixture: the build granted one').toEqual(['soothe']);
    const play = toggleSignatureSpell(initialPlay(ch, db), 'bard-casting', 'blur', ['blur']);
    expect(play.signatureSpells?.['bard-casting'], 'the granted ★ is not written in').toEqual(['blur']);
    expect(mainCasting(applyPlayState(ch, play, db))?.signature, 'and both are drawn').toEqual(
      expect.arrayContaining(['soothe', 'blur']),
    );
    // A second ★ at another rank leaves the first alone; a third at the SAME rank replaces it.
    const two = toggleSignatureSpell(play, 'bard-casting', 'fear', ['soothe', 'fear']);
    expect(two.signatureSpells?.['bard-casting']).toEqual(['blur', 'fear']);
    const swapped = toggleSignatureSpell(two, 'bard-casting', 'soothe', ['soothe', 'fear']);
    expect(swapped.signatureSpells?.['bard-casting'], 'one ★ per rank').toEqual(['blur', 'soothe']);
  });

  /*
   * ⑦ D3's LAST WRITER — `starsAtRank`, the list the ★ writer displaces.
   *
   * SpellsTab computed it as `entry.repertoire[rank]`, the RENDERED list, so a stored ★ the render
   * was not drawing was never displaced by the next ★ at that rank. Both legs below produce TWO
   * signature spells at one rank with the store holding them both — and `signatureEchoIds` then
   * draws a second castable heightened echo card at every higher rank, which is a free signature
   * spell. The fix is the same shape the two repertoire writers already had: read the store.
   *
   * `star` is what SpellsTab now does, line for line.
   */
  const star = (play: PlayState, ch: Character, entryId: string, rank: number, id: string): PlayState => {
    const e = (applyPlayState(ch, play, db).spellcasting ?? []).find((x) => x.id === entryId)!;
    const granted = e.grantedRepertoire?.[rank] ?? [];
    const own = (e.repertoire?.[rank] ?? []).filter((x) => !granted.includes(x));
    const fixed = new Set(e.signatureFixed ?? []);
    return toggleSignatureSpell(play, entryId, id, starsAtRank(play, entryId, rank, own, granted).filter((x) => !fixed.has(x)));
  };

  it('signature: three clicks and no build edit cannot make two ★ at one rank', () => {
    /* ★ a spell, ✕ it (the ✕ leaves the star alone, on purpose), ★ another at the same rank, add the
     * first back. The store holds both stars and the rank files both spells, so ONE ★ PER RANK is the
     * render's answer — the later star is drawn and neither is deleted. The writer cannot answer it:
     * at the middle click the ✕ had already unfiled the first spell, and re-filing it is a click the
     * ★ writer never sees. */
    const b = bard(5, { 1: ['soothe'], 2: ['blur', 'mirror-image'] });
    const ch = built(b);
    let play = star(initialPlay(ch, db), ch, 'bard-casting', 2, 'blur');
    play = removeRepertoireSpell(play, 'bard-casting', 2, 'blur', ['blur', 'mirror-image'], []);
    play = star(play, ch, 'bard-casting', 2, 'mirror-image');
    play = addRepertoireSpell(play, 'bard-casting', 2, 'blur', [], []);
    expect(play.signatureSpells?.['bard-casting'], 'both stars are still the player\'s').toEqual([
      'blur',
      'mirror-image',
    ]);
    const live = mainCasting(applyPlayState(ch, play, db))!;
    expect(live.repertoire?.[2], 'fixture: both are drawn again').toEqual(expect.arrayContaining(['blur', 'mirror-image']));
    expect((live.signature ?? []).filter((id) => (live.repertoire?.[2] ?? []).includes(id)), 'one ★ per rank').toEqual([
      'mirror-image',
    ]);
    // …and the echo follows the drawn star alone: no second set of heightened cards above the rank.
    expect(signatureEchoIds(live, 3)).toEqual(['mirror-image']);
    // Re-starring the other is one click, and it displaces the first — nothing is stuck.
    const back = mainCasting(applyPlayState(ch, star(play, ch, 'bard-casting', 2, 'blur'), db))!;
    expect((back.signature ?? []).filter((id) => (back.repertoire?.[2] ?? []).includes(id))).toEqual(['blur']);
  });

  it('signature: a LOWER-rank spell kept at a higher rank yields THAT rank, and only that rank', () => {
    /*
     * ⛔ THE REGRESSION THIS PASS FIXED, both directions in one test (R2). A rank-1 spell filed under
     * the 3rd-rank header — the picker offers every rank up to the slot's — is the case where "the
     * rank the repertoire files it at" and "the spell's own rank in the database" differ, and for one
     * round `starsAtRank` counted BOTH. Measured through the rendered sheet: ★ a 1st-rank spell filed
     * at 3rd, then ★ anything at 1st, and the first star was deleted — silently, no chip, no confirm.
     */
    const b = bard(7, { 1: ['soothe'], 3: ['haste'] });
    const ch = built(b);
    let play = addRepertoireSpell(initialPlay(ch, db), 'bard-casting', 3, 'fear', ['haste'], []);
    expect(mainCasting(applyPlayState(ch, play, db))?.repertoire?.[3], 'fixture: a 1st-rank spell, filed at 3rd')
      .toContain('fear');
    play = star(play, ch, 'bard-casting', 3, 'fear');
    // …a ★ at ANOTHER rank leaves it alone: one star per rank means the rank it is FILED at.
    play = star(play, ch, 'bard-casting', 1, 'soothe');
    expect(play.signatureSpells?.['bard-casting'], 'two ranks, two stars, neither displaced').toEqual([
      'fear',
      'soothe',
    ]);
    // …and the 3rd rank still carries exactly one: starring haste there displaces fear, not soothe.
    play = star(play, ch, 'bard-casting', 3, 'haste');
    expect(play.signatureSpells?.['bard-casting'], 'the header rank carries one ★').toEqual(['soothe', 'haste']);
  });

  it('signature: the ECHO reads the same filing as the ★ writer, so neither can outrank the other', () => {
    /*
     * ⑦'s two renderers, pinned against each other. `signatureEchoIds` echoed from the spell's own
     * rank, which is what made the deleting clause above look necessary: a 1st-rank spell filed at 3rd
     * echoed from rank 2 up — below the rank the player is holding it at, and at a rank whose own ★ it
     * would then be competing with. The filing answers both.
     */
    const b = bard(7, { 1: ['soothe'], 3: ['haste'] });
    const ch = built(b);
    let play = addRepertoireSpell(initialPlay(ch, db), 'bard-casting', 3, 'fear', ['haste'], []);
    play = star(play, ch, 'bard-casting', 3, 'fear');
    const live = mainCasting(applyPlayState(ch, play, db))!;
    expect(live.signature, 'fixture: the ★ is drawn').toContain('fear');
    expect(signatureEchoIds(live, 2), 'no echo below the rank it is filed at').not.toContain('fear');
    expect(signatureEchoIds(live, 4), 'and an echo above it').toContain('fear');
  });

  it('signature: a ★ the BUILD is hiding still yields its rank to a new one', () => {
    /* The same hole reached the other way — a bloodline swap hides the starred spell instead of the
     * player removing it. The ★ is correctly not drawn while it is hidden; what must not happen is
     * it coming back beside the new one when the bloodline is swapped back. */
    const arcaneOnly = Object.values(db.spells)
      .filter((s) => s.rank === 1 && !s.ritual && s.traditions.includes('arcane') && !s.traditions.includes('divine'))
      .map((s) => s.id);
    const sharedList = Object.values(db.spells)
      .filter((s) => s.rank === 1 && !s.ritual && s.traditions.includes('arcane') && s.traditions.includes('divine'))
      .map((s) => s.id);
    const hidden = arcaneOnly[0];
    const kept = sharedList[0];
    const b = sorcerer(5, 'bloodline-draconic'); // arcane
    const ch = built(b);
    let play = addRepertoireSpell(initialPlay(ch, db), SORC, 1, hidden, [], mainCasting(ch)?.grantedRepertoire?.[1] ?? []);
    play = addRepertoireSpell(play, SORC, 1, kept, [], mainCasting(ch)?.grantedRepertoire?.[1] ?? []);
    play = star(play, ch, SORC, 1, hidden);

    const swapped = save(b, play, sorcerer(5, 'bloodline-angelic')); // divine — `hidden` is off the list
    const shownCh = swapped.character;
    expect(mainCasting(sheet(swapped))?.repertoire?.[1], 'fixture: the ★ed spell is hidden').not.toContain(hidden);
    expect(mainCasting(sheet(swapped))?.signature ?? [], 'so its ★ is not drawn').not.toContain(hidden);
    const after = star(swapped.play, shownCh, SORC, 1, kept);

    const backCh = save(sorcerer(5, 'bloodline-angelic'), after, b);
    const live = mainCasting(sheet(backCh))!;
    expect(live.repertoire?.[1], 'both spells are back').toEqual(expect.arrayContaining([hidden, kept]));
    expect((live.signature ?? []).filter((id) => db.spells[id]?.rank === 1), 'and exactly one ★ at the rank').toEqual([
      kept,
    ]);
  });

  it('signature: a ★ parked at a rank the fresh build has lost comes back with it (3 → 1 → 3)', () => {
    /* The collection at a missing rank is kept (above) — so the ★ on it must be too. Asking only the
     * FRESH repertoire what the bard knows answered "not blur" while blur was sitting right there in
     * the stored collection, and deleted the star for a render that never happened. The spell came
     * back with the level correction; the player's ★ did not, and nothing could bring it back. */
    const b3 = bard(3, { 1: ['soothe', 'fear'], 2: ['sound-body'] });
    const b1 = bard(1, { 1: ['soothe', 'fear'] });
    let play = setRepertoireRank(initialPlay(built(b3), db), 'bard-casting', 2, ['blur']);
    play = setSignatureSpells(play, 'bard-casting', ['blur']);
    const down = save(b3, play, b1); // the level was wrong
    expect(down.play.repertoireSpells?.['bard-casting']?.[2], 'the collection is kept…').toEqual(['blur']);
    expect(down.play.signatureSpells?.['bard-casting'], '…and so is the ★ on it').toEqual(['blur']);
    const back = save(b1, down.play, b3); // …and corrected
    // `sound-body` is the BUILD's own 2nd-rank pick, and nothing says the player took it off (they
    // never pressed ✕ — this fixture writes the store directly), so the correction brings it with it.
    expect(mainCasting(sheet(back))?.repertoire?.[2]).toEqual(['blur', 'sound-body']);
    expect(mainCasting(sheet(back))?.signature, 'the ★ came back with the spell it is on').toContain('blur');
  });

  /* ---- 5. the class resource values ---- */

  it('resources: the player\'s number survives the build\'s resource set moving under it', () => {
    // A tracked number is not a pick off a list, so it has no legality to lose: the merge lets the
    // player's value win at every key they hold, in both directions of the build change.
    const b = preparedCleric(3);
    const play = { ...initialPlay(built(b), db), resources: { rage: 1, 'infused-reagents': 2 } };
    const gained = save(b, play, ragingCleric(3)); // the fresh build now grants Rage
    expect(gained.play.resources?.rage, 'the default must not overwrite what the player is tracking').toBe(1);
    const lost = save(ragingCleric(3), play, b); // …and now it does not
    expect(lost.play.resources?.rage, 'nor may the app delete it').toBe(1);
    expect(lost.play.resources?.['infused-reagents']).toBe(2);
  });

  it('resources: one the fresh build introduces arrives at its default', () => {
    // The other half of the merge — the fresh build's answer fills in every key the player has none
    // for, which is how a new dedication's resource reaches the sheet at all.
    const b = preparedCleric(3);
    const play = { ...initialPlay(built(b), db), resources: { 'infused-reagents': 2 } };
    expect(built(ragingCleric(3)).classResources, 'fixture: the dedication brings Rage').toHaveProperty('rage');
    expect(save(b, play, ragingCleric(3)).play.resources).toEqual({ rage: 0, 'infused-reagents': 2 });
  });
});

/* ------------------------------------------------- the other two Save paths run the same function */

describe('the other paths that replace a stored character', () => {
  it('the GM edit sheet saves through the same lossless call', () => {
    // GmEditSheet.tsx onCreate is App.tsx's onCreate with `work` in place of the roster row — the
    // same buildCharacter → carryStoredOverrides → playForRebuild(play, built, prev) chain, which
    // `save()` above IS. Pinned as text so the two cannot drift apart unnoticed.
    const src = readFileSync('src/sheet/GmEditSheet.tsx', 'utf8');
    expect(src).toContain('carryStoredOverrides(built, w.character)');
    expect(src).toContain('playForRebuild(w.play, built, w.character)');
  });

  it('a stored pick is read with `!== undefined`, so an EMPTIED slot is never refilled', () => {
    /*
     * `prepared1` answers three different things — a spell id, `null` for "Leave slot empty", and
     * `undefined` for "no key, or the picker would not offer it" — and `??` collapses the first two.
     * The restricted-slot renderer did exactly that for a year; it is invisible only while every
     * record ships its restricted slots empty. A regex rather than another round of cases: the shape
     * `prepared1(…) ?? something` is the bug, wherever it appears.
     */
    const src = readFileSync('src/rules/play.ts', 'utf8').replace(/\r\n/g, '\n');
    expect(src, 'the PlayState reader was not found — this guard would pass vacuously').toContain('const prepared1 =');
    expect(src.match(/prepared1\([^)]*\)\s*\?\?/g), 'a stored `null` would fall through to the build\'s own spell').toBeNull();
  });

  it('ONE function decides what a slot may hold, and neither surface has a second one', () => {
    /*
     * The picker and the render used to be two implementations of the same rule, pinned against each
     * other by copying a line and asserting the copy. They drifted anyway — three rounds of it — so
     * the rule is one exported function and this guard is that there is no other.
     *
     * Read line-ending agnostic on purpose: this repo's files are mixed (play.ts and SpellsTab.tsx
     * are CRLF, this file is LF), and a source-reading guard must not go quietly vacuous the day one
     * of them is normalised.
     */
    const lf = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    const tab = lf('src/sheet/SpellsTab.tsx');
    const play = lf('src/rules/play.ts');
    for (const [name, src] of [['the picker', tab], ['the render', play]] as const)
      expect(src, `${name} must ask spellOptions`).toMatch(/from '(\.\.\/rules\/|\.\/)spellOptions'/);
    // The three pieces of the old duplicate, in both files: the ceiling, the book walk, the list test.
    for (const [name, src] of [['SpellsTab', tab], ['play.ts', play]] as const) {
      expect(src, `${name} computes a rank ceiling of its own`).not.toMatch(/const ceiling =/);
      expect(src, `${name} builds a book list of its own`).not.toMatch(/const fromBook =/);
      expect(src, `${name} tests the tradition itself`).not.toMatch(/traditions\.includes\(/);
    }
    // …and the module itself is pure: a React import there would put the render's answer behind a hook.
    const mod = lf('src/rules/spellOptions.ts');
    expect(mod, 'the shared module must stay outside React').not.toMatch(/from 'react'/);
    expect(mod).toMatch(/export function spellOptions/);
    // ⑦'s second renderer is the same shape of hazard: two readings of "what rank is this spell at"
    // is what deleted a player's ★ at another rank, so the filing lives beside the options and
    // SpellsTab draws what it returns.
    expect(mod, 'the echo and the ★ writer must share one filing').toMatch(/export function signatureEchoIds/);
    expect(tab, 'SpellsTab computes a signature spell\'s rank of its own').not.toMatch(/function signatureEchoIds/);
  });

  it('no comment in src/ points at a section that does not exist', () => {
    /*
     * ⛔ R4. Two comments gated a design deviation on "QUESTIONS FOR THE OWNER (2026-09-22) — read it
     * there before this ships", and no file in the repo had such a section: the only gate on the only
     * unapproved deviation was a dangling pointer, and the deviation would have shipped behind it.
     * The deviation is gone (R1) and both comments are plain statements of the rule; this is the guard
     * that a src comment never again defers to a place that has to exist and does not.
     */
    const files = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    expect(files.length, 'no source files were read — this guard would pass vacuously').toBeGreaterThan(50);
    const dangling = files.filter((f) => readFileSync('src/' + f, 'utf8').includes('QUESTIONS FOR THE OWNER'));
    expect(dangling, 'these defer to a section no file contains — state the rule instead').toEqual([]);
  });

  it('every field of PlayState is CLASSIFIED — mirrors a build answer, or records play', () => {
    /*
     * The recurring hole, three rounds running: a store that shadows something the build also decides
     * sits in PlayState with nothing in `reconcileBuildMirrors` aware of it, and the docblock's table
     * closes with "anything not in this table mirrors no build answer" — an enumeration nobody had
     * made. It was wrong about `preparedSpells[id#2]` (Spell Combination's second spell) and wrong
     * again about `preparedTactics`, `etchedRunes`, `dailyChoices` and `dailyItems`, all four of them
     * subsets of a build-derived list.
     *
     * So the claim is guarded instead of made. Every field of the interface must be named either in
     * that docblock — which is where a build answer's mirror is reasoned about — or in the list
     * below, which is a claim that the field records what HAPPENED in play and has no build answer to
     * shadow. Add a field to PlayState and this goes red until somebody says which it is.
     */
    // ⚠ LINE-ENDING AGNOSTIC. play.ts is CRLF and this file is LF; every `^`/`$` and every literal
    // below reads a normalised copy, so the guard cannot go vacuous on a file that gets normalised.
    const src = readFileSync('src/rules/play.ts', 'utf8').replace(/\r\n/g, '\n');
    const block = src.slice(src.indexOf('export interface PlayState {'));
    const fields = [...block.slice(0, block.search(/^\}/m)).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields.length, 'the PlayState block was not found — this guard would pass vacuously').toBeGreaterThan(30);

    // What happened in play. None of these is a pick off a list the build offers, so a rebuild has
    // nothing to hold them to and the spread in playForRebuild keeps them verbatim.
    const RECORDS_PLAY = [
      'damage', 'tempHp', 'tempHpFrom', 'shieldDamage', 'tempSpeed', 'appearance', 'heroPoints', 'mythicPoints',
      'xp', 'focusUsed', 'expendedSlots', 'slotsUsed', 'innateUsed', 'conditions', 'inventory', 'currency',
      'pinned', 'pinnedDescs', 'alchemyPrep', 'featUses', 'knownRituals', 'formulaPicks', 'formulaBookGranted',
      'notes', 'companionConditions', 'companionHp', 'companionModes', 'companions', 'details', 'activeModes',
      'activeStance',
    ];
    // The TABLE only, not the whole docblock: every mention inside it is a row header, so a field
    // cannot be counted as classified because some sentence of prose happens to use the word.
    const table = src.slice(src.indexOf(' * ① preparedSpells'), src.indexOf(' * The PREVIOUS character is consulted'));
    expect(table.length, 'the table was not found — this guard would pass vacuously').toBeGreaterThan(2000);
    expect(
      fields.filter((f) => !RECORDS_PLAY.includes(f) && !table.includes(f)),
      'unclassified: give it a row in the reconcileBuildMirrors table, or add it to RECORDS_PLAY above',
    ).toEqual([]);
    expect(RECORDS_PLAY.filter((f) => !fields.includes(f)), 'stale — no such field of PlayState').toEqual([]);
    expect(
      RECORDS_PLAY.filter((f) => table.includes(f)),
      'claimed to record play AND given a row as a build mirror — it cannot be both',
    ).toEqual([]);
  });

  it('the launch-time roster rebuild never touches the play overlay at all', () => {
    // rebuildRoster re-derives every character against the CURRENT engine + data. The player made no
    // build change, so nothing of theirs may be reconciled away — it must leave `play` alone.
    const b = flexCleric(3);
    const play = loadedPlay(built(b));
    const [row] = rebuildRoster([{ id: 'r0', character: built(b), build: b, play }], db);
    expect(row.play).toBe(play);
    expect(collected(sheet({ character: row.character, play: row.play! })).sort()).toEqual(['heal']);
  });
});
