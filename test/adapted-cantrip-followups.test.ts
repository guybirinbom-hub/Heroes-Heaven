import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay, preparedCantripKey, prepareCantripOpening, setPreparedCantrip, type PlayState } from '../src/rules/play';
import { openChoiceOptions } from '../src/rules/openChoice';
import { cantripsOverOf, ownPlacesBeside } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, ContentDatabase, SpellcastingEntry } from '../src/rules/types';

/**
 * ADAPTED CANTRIP — the follow-ups to c720191 (2026-10-15), the engine half.
 *
 * Print, Pathfinder Player Core (feat-4474): *"Choose one cantrip from a magical tradition other than
 * your own. If you prepare spells, you can choose this spell when you prepare your cantrips, in addition
 * to your other options. If you have a spell repertoire, replace one of your cantrips known with the
 * chosen spell."*
 *
 * c720191 made a prepared class keep every opening; four independent checks left these behind, each
 * measured on the code before this file:
 *   1. the builder's note told EVERY caster "your class cantrip budget is one lower";
 *   2. a sorcerer (its bloodline cantrip counted inside its five) drew the adapted cantrip as "One too
 *      many … remove one in the builder" — `cantripsOverOf` counted the feat's cantrip as a pick;
 *   3. an opening showing a stand-in (the pick another opening's adapted cantrip pushed out) did not
 *      store it, so re-preparing the opening that held the adapted cantrip flipped it back;
 *   5. the feat's picker offered 51 cantrips with no tradition at all (allegro, a composition) —
 *      not "from a magical tradition".
 * (4, Learn a Spell, is a screen and lives in the -ui file.)
 *
 * MUTATION-PROVED legs plant the old shape in memory (restored in `finally`, or on a clone) and show the
 * assertion reads it.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const gated = content({ trustGate: true });
const CORE = enabledBookSet(undefined);

const pc = (d: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST adapted cantrip',
    level,
    classId,
    subclassId: d.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(d.backgrounds)[0],
    keyAbility: d.classes[classId]?.keyAbility?.[0] ?? null,
    ...over,
  }) as BuildState;
const withAdapted = (b: BuildState, answer: string): BuildState =>
  ({ ...b, featPicks: { ...b.featPicks, '1:ancestry:0': 'adapted-cantrip' }, featChoices: { ...b.featChoices, '1:ancestry:0': answer } }) as BuildState;
const entryOf = (ch: Character, classId: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === `${classId}-casting`)!;
/** Common Player Core cantrips on `tradition`, in a fixed order — the player's own picks. */
const onTradition = (d: ContentDatabase, tradition: string) =>
  Object.values(d.spells)
    .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(tradition as never))
    .map((s) => s.id)
    .sort();

describe('1 · the builder note says what print says for BOTH kinds of caster', () => {
  const PREPARED = /If you prepare spells, you keep every cantrip opening: this cantrip is one more option when you prepare your cantrips\./;
  const REPERTOIRE = /If you have a spell repertoire, it replaces one of your cantrips known\./;
  /** The old note's claim, true for no prepared caster and (trust gate: the -1 is off) for nobody in the app. */
  const OLD = /budget is one lower/i;
  const saysPrint = (note: string | undefined) => PREPARED.test(note ?? '') && REPERTOIRE.test(note ?? '') && !OLD.test(note ?? '');

  // mutation-proof
  it('the shipped record (both content databases) carries the two printed cases and no count', () => {
    for (const d of [db, gated]) expect(saysPrint(d.feats['adapted-cantrip'].choice?.note), d === db ? 'ungated' : 'trust-gated').toBe(true);
    // The planted bad case: the note before this fix.
    const choice = db.feats['adapted-cantrip'].choice!;
    const saved = choice.note;
    choice.note =
      "Cast as a spell of your class's tradition, from your class's own pool, spell attack and DC. It REPLACES one of your cantrips known, so your class cantrip budget is one lower — pick the cantrip you are giving up by simply not choosing it.";
    try {
      expect(saysPrint(choice.note), 'the guard reads the old note as wrong').toBe(false);
    } finally {
      choice.note = saved;
    }
  });

  it('the overlay row and the lane script that authored it say the same, so a re-run cannot bring the old note back', () => {
    const rows = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as { category: string; id: string; field?: string; path?: unknown[]; value?: { note?: string } }[];
    const row = rows.filter((r) => r.category === 'feats' && r.id === 'adapted-cantrip' && r.field === 'choice' && !r.path?.length);
    expect(row).toHaveLength(1);
    expect(row[0].value?.note).toBe(db.feats['adapted-cantrip'].choice?.note);
    const lane = readFileSync('scripts/apply-innate-cantrip-lane.mjs', 'utf8');
    expect(lane.includes(JSON.stringify(row[0].value?.note)), 'apply-innate-cantrip-lane.mjs writes the same note').toBe(true);
    // …and nowhere the old one as a value (its comment may quote the old claim; the value may not).
    expect(/note:\s*"[^"]*budget is one lower/i.test(lane), 'and nowhere the old one').toBe(false);
  });
});

describe("2 · a sorcerer's adapted cantrip is not one of its own picks past the allowance", () => {
  /** A 1st-level sorcerer with every place the builder offers filled, and Adapted Cantrip (electric arc). */
  const sorcerer = (d: ContentDatabase, extra = 0) => {
    const plain = pc(d, 'sorcerer', 1, { keyAbility: 'cha' });
    const probe = entryOf(buildCharacter(plain, d), 'sorcerer');
    const gift = probe.grantedCantrips ?? [];
    const cap = entryOf(buildCharacter(withAdapted(plain, 'electric-arc'), d), 'sorcerer').cantripCap!;
    const places = ownPlacesBeside(probe, 0, cap, []);
    const picks = onTradition(d, probe.tradition).filter((id) => !gift.includes(id) && id !== 'electric-arc').slice(0, places + extra);
    return { gift, places, picks, entry: entryOf(buildCharacter(withAdapted({ ...plain, cantrips: picks } as BuildState, 'electric-arc'), d), 'sorcerer') };
  };

  // mutation-proof
  it('the builder-full sorcerer is 0 over — ungated (cap one lower) and in the app (trust gate: the -1 is off)', () => {
    for (const d of [db, gated]) {
      const s = sorcerer(d);
      const label = d === db ? 'ungated' : 'trust-gated';
      expect(s.entry.grantsCountInside, `${label}: fixture — the gift counts inside`).toBe(true);
      expect(s.gift.length, `${label}: fixture — one gift cantrip`).toBe(1);
      expect(s.entry.cantrips, `${label}: the adapted cantrip is drawn`).toContain('electric-arc');
      expect(s.entry.spellSources?.['electric-arc'], label).toBe('Adapted Cantrip');
      expect(cantripsOverOf(s.entry), `${label}: nothing over`).toBe(0);
      // The planted bad case: the same entry without the feat's attribution — the count before the fix.
      expect(cantripsOverOf({ ...s.entry, spellSources: undefined }), `${label}: the old count read one over`).toBe(1);
    }
  });

  it('control: a save with one OWN pick too many is still reported', () => {
    for (const d of [db, gated]) expect(cantripsOverOf(sorcerer(d, 1).entry), d === db ? 'ungated' : 'trust-gated').toBe(1);
  });
});

describe('3 · a stand-in opening is stored on the player’s own edit, never on load', () => {
  const sheetOf = (ch: Character, play: PlayState) => applyPlayState(ch, play, db);
  const KEY = (i: number) => preparedCantripKey('cleric-casting', i);
  /** An old save: four picks (the old builder's cap), electric arc from Adapted Cantrip in the 5th opening,
   *  and the player had prepared electric arc by hand in opening 3 before c720191 gave the 5th back. */
  const own = onTradition(db, 'divine').slice(0, 4);
  const swap = onTradition(db, 'divine').find((id) => !own.includes(id))!;
  const ch = buildCharacter(withAdapted(pc(db, 'cleric', 1, { keyAbility: 'wis', cantrips: own }), 'electric-arc'), db);
  const byHand = setPreparedCantrip(initialPlay(ch, db), 'cleric-casting', 3, 'electric-arc');

  it('the overlay names the stand-in opening and the opening it depends on', () => {
    const e = entryOf(sheetOf(ch, byHand), 'cleric');
    expect(e.cantripSlots, 'fixture: the 5th opening shows what electric arc pushed out').toEqual([...own.slice(0, 3), 'electric-arc', own[3]]);
    expect(e.cantripStandIns).toEqual([{ at: 4, from: 3 }]);
    // Without a stand-in there is nothing to mark. (Loading stores nothing: applyPlayState returns a
    // character, never a play state — the -ui file shows the Prepare panel calls no writer on load.)
    expect(entryOf(sheetOf(ch, initialPlay(ch, db)), 'cleric').cantripStandIns ?? []).toEqual([]);
  });

  // mutation-proof
  it('re-preparing the opening that holds electric arc keeps the stand-in where it was (it flipped back to electric arc)', () => {
    const shown = entryOf(sheetOf(ch, byHand), 'cleric');
    const after = prepareCantripOpening(byHand, shown, 3, swap);
    expect(after.preparedSpells?.[KEY(4)], 'the stand-in is stored with the edit').toBe(own[3]);
    expect(after.preparedSpells?.[KEY(3)]).toBe(swap);
    expect(entryOf(sheetOf(ch, after), 'cleric').cantripSlots, 'nothing the player saw moves').toEqual([...own.slice(0, 3), swap, own[3]]);
    // The planted bad case: the writer the picker used before — only the edited opening is stored.
    const old = setPreparedCantrip(byHand, 'cleric-casting', 3, swap);
    expect(entryOf(sheetOf(ch, old), 'cleric').cantripSlots?.[4], 'the old writer flips it back').toBe('electric-arc');
  });

  it('a stand-in the player edits is stored as the edit, and a stored choice is never overwritten', () => {
    const shown = entryOf(sheetOf(ch, byHand), 'cleric');
    const edited = prepareCantripOpening(byHand, shown, 4, swap);
    expect(edited.preparedSpells?.[KEY(4)]).toBe(swap);
    expect(Object.keys(edited.preparedSpells ?? {}).sort()).toEqual([KEY(3), KEY(4)]);
    // A stale render (the 5th was stored meanwhile): the store wins over the render's stand-in.
    const meanwhile = setPreparedCantrip(byHand, 'cleric-casting', 4, null);
    expect(prepareCantripOpening(meanwhile, shown, 3, swap).preparedSpells?.[KEY(4)]).toBeNull();
  });

  // mutation-proof
  it('an edit to ANOTHER opening stores only that edit, so a later builder swap still reaches the stand-in', () => {
    /* Checker finding, 2026-10-15: storing every stand-in on any edit wrote a choice the player never
     * made, and it outranked their later builder swap of that cantrip. */
    const shown = entryOf(sheetOf(ch, byHand), 'cleric');
    const after = prepareCantripOpening(byHand, shown, 0, swap);
    expect(Object.keys(after.preparedSpells ?? {}).sort(), 'the edit and the earlier choice, nothing else').toEqual([KEY(0), KEY(3)]);
    // The player then swaps own[3] for another cantrip in the builder: the stand-in follows the build.
    const other = onTradition(db, 'divine').find((id) => !own.includes(id) && id !== swap)!;
    const rebuilt = buildCharacter(withAdapted(pc(db, 'cleric', 1, { keyAbility: 'wis', cantrips: [...own.slice(0, 3), other] }), 'electric-arc'), db);
    expect(entryOf(sheetOf(rebuilt, after), 'cleric').cantripSlots?.[4], 'the builder swap reaches the 5th opening').toBe(other);
    // The planted bad case: a stand-in marked as depending on the edited opening is stored, and then
    // the removed cantrip outranks the builder swap.
    const eager = prepareCantripOpening(byHand, { ...shown, cantripStandIns: [{ at: 4, from: 0 }] }, 0, swap);
    expect(entryOf(sheetOf(rebuilt, eager), 'cleric').cantripSlots?.[4], 'stored, it hides the swap').toBe(own[3]);
  });

  it('control: with no stand-in it stores exactly what the old writer stored', () => {
    const fresh = initialPlay(ch, db);
    const shown = entryOf(sheetOf(ch, fresh), 'cleric');
    expect(prepareCantripOpening(fresh, shown, 2, swap)).toEqual(setPreparedCantrip(fresh, 'cleric-casting', 2, swap));
  });
});

describe('5 · the picker offers only cantrips FROM a magical tradition', () => {
  const from = db.feats['adapted-cantrip'].choice!.from;
  const offered = (classId: string) => openChoiceOptions(from, db, { character: buildCharacter(pc(db, classId, 1), db) }).map((o) => o.id);

  // mutation-proof
  it('allegro (a composition, no tradition) is gone; every option names a tradition the caster does not cast', () => {
    for (const classId of ['sorcerer', 'cleric', 'wizard', 'druid', 'fighter']) {
      const ids = offered(classId);
      const own = new Set(buildCharacter(pc(db, classId, 1), db).spellcasting.filter((e) => e.type === 'prepared' || e.type === 'spontaneous').map((e) => e.tradition));
      // An arcane caster's list is short (14 measured: arcane covers most cantrips), never empty.
      expect(ids.length, `${classId}: still a list`).toBeGreaterThan(5);
      expect(ids, classId).not.toContain('allegro');
      for (const id of ids) {
        const t = db.spells[id].traditions ?? [];
        expect(t.length, `${classId}: ${id} has a tradition`).toBeGreaterThan(0);
        expect(t.some((x) => own.has(x)), `${classId}: ${id} is off every tradition it casts`).toBe(false);
      }
    }
    expect(offered('sorcerer'), 'control: an arcane/primal cantrip for an occult sorcerer').toContain('electric-arc');
    // The planted bad case: allegro WITH a tradition is offered, so the leg reads the traditions field.
    const allegro = db.spells.allegro;
    const saved = allegro.traditions;
    allegro.traditions = ['primal'] as never;
    try {
      expect(offered('sorcerer'), 'the same record with a tradition is offered').toContain('allegro');
    } finally {
      allegro.traditions = saved;
    }
    expect(offered('sorcerer')).not.toContain('allegro');
  });

  it('a stored answer is kept in its own picker (keep what you hold), says it is not allowed, and is offered to no one else', () => {
    const ch = buildCharacter(pc(db, 'sorcerer', 1), db);
    const kept = openChoiceOptions(from, db, { character: ch, keep: ['allegro', 'electric-arc'] });
    // Q27, unpickable must look unpickable: the kept answer print no longer allows says so…
    expect(kept.find((o) => o.id === 'allegro')?.note).toBe('Cantrip · not from a magical tradition other than your own — choose again');
    // …and a kept answer that IS allowed reads like any other option.
    expect(kept.find((o) => o.id === 'electric-arc')?.note).toBe('Cantrip');
    expect(openChoiceOptions(from, db, { character: ch, keep: [] }).map((o) => o.id)).not.toContain('allegro');
  });
});
