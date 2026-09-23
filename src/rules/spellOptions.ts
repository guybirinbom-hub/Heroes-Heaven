/*
 * WHAT THIS SLOT'S PICKER OFFERS — asked once, by everybody.
 *
 * This is SpellsTab's `optionsFor`, moved here whole and with no React in it, because two surfaces
 * have to agree about it and had two implementations:
 *
 *   · the PICKER (Manage spells) decides what the player may choose into a slot, an opening or a rank;
 *   · the RENDER (applyPlayState) decides whether a pick the player made earlier is still drawn.
 *
 * They are the same question. While they were two functions they answered differently — the render
 * asked a rank ceiling the picker did not, the picker read a curriculum's `allowed` list the render
 * reconstructed out of a spellbook, and three rounds of case-by-case fixes closed one gap each and
 * opened the next. So the rule lives in ONE function with two callers, and a source-reading guard in
 * test/bug-builder-save-lossless.test.ts pins that SpellsTab computes no options of its own.
 *
 * ⛔ WHAT THIS FUNCTION IS NOT ALLOWED TO DO: narrow the list below what the picker offers. A pick the
 * picker itself offered must draw, or the app silently eats a legal choice. Everything it cannot read
 * — a rule that widens the list (Fey Caller's illusions, Mysterious Repertoire's whole tradition), a
 * curriculum written as prose, a book that failed to build — therefore answers "cannot say" and
 * OFFERS, never "not on the list".
 *
 * The one thing kept out of it is the DEDUPE each caller does afterwards (a repertoire does not offer
 * what that rank already knows; a cantrip opening does not offer a cantrip another opening holds).
 * That is not legality: it is a list of what you already have, and folding it in here would make the
 * render refuse every pick it is drawing.
 */
import type { Character, ContentDatabase, RestrictedSlot, Spell, SpellcastingEntry, Tradition } from './types';
import { listValues } from '../data';

/** Everything the answer depends on. `restrictedSlots` defaults to the entry's own — the SHEET passes
 *  the list it is SHOWING instead, which includes the slots a toggled MODE grants (a lit Candle of
 *  Invocation), because those exist on no stored character and a lookup by id would miss them. */
export interface SpellOptionCtx {
  character: Character;
  entry: SpellcastingEntry;
  content: ContentDatabase;
  restrictedSlots?: RestrictedSlot[];
}

/**
 * Does a rule that opens a WHOLE TRADITION reach this spell — "one spell in your spell repertoire not
 * on the divine spell list" (Mysterious Repertoire), a fey gift's illusions. Kept as a rule rather
 * than ~1,500 expanded ids on every saved character.
 */
export function spellOpenedBy(w: { traditions: Tradition[] | 'any'; traits?: string[] }, s: Spell): boolean {
  const onTradition = w.traditions === 'any' || s.traditions.some((t) => w.traditions.includes(t));
  return onTradition && (!w.traits?.length || w.traits.some((t) => (s.traits ?? []).includes(t)));
}

export interface TraditionPool {
  /** Spells of exactly that rank (rank 0 is the cantrip list). */
  byRank: Record<number, Spell[]>;
  /** Spells of rank 1..N, sorted — what a slot of rank N may hold. */
  upTo: Record<number, Spell[]>;
}

/*
 * The list is ~2,000 spells wide and is built by scanning the whole database, which was fine while
 * only a React `useMemo` asked for it and is not once the RENDER asks too (applyPlayState runs on
 * every sheet render, for every entry). Cached per content database, under the only things the answer
 * depends on: the entry's own id and tradition, and the character's list rules.
 */
const poolCache = new WeakMap<ContentDatabase, Map<string, TraditionPool>>();

/** The spells this entry's tradition offers, by rank — feat additions, opened traditions and a
 *  replaced list included. */
export function traditionPool(character: Character, entry: SpellcastingEntry, content: ContentDatabase): TraditionPool {
  const key = JSON.stringify([
    entry.id,
    entry.tradition,
    !!character.hideLegacy,
    character.spellListAdditions?.['*'] ?? null,
    character.spellListAdditions?.[entry.id] ?? null,
    character.spellListTraditions ?? null,
    character.spellListReplacement ?? null,
  ]);
  let perContent = poolCache.get(content);
  if (!perContent) poolCache.set(content, (perContent = new Map()));
  const hit = perContent.get(key);
  if (hit) return hit;

  const byRank: Record<number, Spell[]> = {};
  const hideLegacy = character.hideLegacy;
  // "Add Illusory Disguise, Illusory Object, and Illusory Scene to your spell list" (Fey Caller;
  // Dragon Arcana adds ten). Those spells are not in the entry's tradition, so a strict tradition
  // filter offered nothing and the feat was inert. They still cost a repertoire slot to learn.
  const added = new Set([
    ...(character.spellListAdditions?.['*'] ?? []),
    ...(character.spellListAdditions?.[entry.id] ?? []),
  ]);
  // …and whole traditions opened by a rule rather than a list — "one spell in your spell repertoire
  // not on the divine spell list" (Mysterious Repertoire).
  const openTraditions = (character.spellListTraditions ?? []).filter((w) => !w.entryId || w.entryId === entry.id);
  const openedBy = (s: Spell) => openTraditions.some((w) => spellOpenedBy(w, s));
  // A class archetype may REPLACE the list rather than widen it — "Replace your spell list with the
  // elemental spell list … your actual magical tradition is unchanged". So this stands in for the
  // tradition test; everything else (feat additions, opened traditions) still applies on top.
  const rep = character.spellListReplacement;
  const repActive = !!rep && (!rep.entryId || rep.entryId === entry.id);
  const onList = (s: Spell): boolean => {
    if (!rep || !repActive) return s.traditions.includes(entry.tradition);
    // Only a spell that is on SOME list can be on a replaced one. Focus spells, rituals and the
    // class-granted cantrips (bard compositions, witch hexes, psychic amps) all carry no tradition,
    // which is exactly what kept them out of the ordinary picker for free.
    if (!s.traditions.length) return !!s.spellLists?.includes(rep.list);
    if (s.spellLists?.includes(rep.list)) return true;
    // "Any spell that shares one or more traits with those in your elemental philosophy, and doesn't
    // have any traits that aren't in your elemental philosophy."
    if (!rep.anyTrait.length) return false;
    const t = s.traits ?? [];
    return t.some((x) => rep.anyTrait.includes(x)) && !t.some((x) => rep.excludeTraits.includes(x));
  };
  for (const s of listValues(content, content.spells)) {
    const e = (s as { edition?: string }).edition;
    if (e === 'superseded') continue; // renamed/outdated half of a remaster change — always hidden
    if (hideLegacy && (e === 'legacy' || e === 'legacy-era')) continue; // per-character Hide legacy data
    if (onList(s) || added.has(s.id) || openedBy(s)) (byRank[s.rank] ??= []).push(s);
  }
  const upTo: Record<number, Spell[]> = {};
  let acc: Spell[] = [];
  for (let r = 1; r <= 10; r++) {
    if (byRank[r]) acc = acc.concat(byRank[r]);
    upTo[r] = acc.slice().sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }
  const pool = { byRank, upTo };
  perContent.set(key, pool);
  return pool;
}

/**
 * THE FUNCTION. Spells this entry may put into a slot / opening / rank right now.
 *
 * `restrictedId` names a restricted slot (a curriculum slot, Sin Reservoir, Spell Combination, a lit
 * candle's); the `#2` suffix is Spell Combination's second spell and names the same slot.
 *
 * Order, and it matters: the RANK CEILING first — on every slot, `allowed` list or not — then the
 * list. The ceiling reads the spell's own rank from the content database, which is why an 8th-rank
 * curriculum spell could sit in a 2nd-rank Sin Reservoir slot for as long as the render reconstructed
 * ranks out of the caster's spellbook instead.
 */
export function spellOptions(ctx: SpellOptionCtx, rank: number, restrictedId?: string): Spell[] {
  const { character, entry, content } = ctx;
  // A restricted slot offers ONLY its allowed list — that is the entire point of the lane. When the
  // restriction is prose the engine can't check (a wizard's curriculum), `allowed` is absent and the
  // slot falls through to the normal options with the sentence shown beside it.
  const rs = restrictedId
    ? (ctx.restrictedSlots ?? entry.restrictedSlots)?.find((s) => s.id === restrictedId.replace(/#2$/, ''))
    : undefined;
  // A combination slot caps what it may hold BELOW its own rank ("each spell in the combination must
  // be 2 or more spell ranks below the slot's rank"), so the ceiling is the slot's, not the rank
  // being prepared.
  const ceiling = Math.min(rank, rs?.maxRank ?? rank);
  if (rs?.allowed?.length) {
    return rs.allowed
      .map((id) => content.spells[id])
      .filter((s): s is Spell => !!s && s.rank <= ceiling)
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }
  /* desk 155: flexible-book-casters — a caster WITH A BOOK offers the book and nothing else, whether
   * the entry prepares into slots or holds a collection. A flexible wizard, witch or magus casts
   * spontaneous-shaped, and print is explicit that the source does not change: *"Select these spells
   * from the same source as normal, such as from a spellbook for a wizard"* (archetype-99).
   *
   * Two ways the book says "cannot say" rather than "nothing is allowed", and both are the same rule:
   * a book that cannot answer must never take the player's picks with it.
   *   · an EMPTY book — one that failed to build — falls through to the tradition;
   *   · a book with NO RANK-0 LIST does too, at rank 0. The engine keeps a caster's cantrips in
   *     `entry.cantrips` and fills the spellbook off the SLOT table, which starts at rank 1, so
   *     asking the book about a cantrip answered "nothing" for every wizard, witch and magus alive —
   *     an empty Prepare-a-cantrip picker, and (once the render started asking this question) every
   *     prepared cantrip gone from the sheet. */
  const fromBook = (): Spell[] | null => {
    if (!entry.spellbook || !Object.values(entry.spellbook).some((ids) => ids.length)) return null;
    if (ceiling === 0) {
      const c0 = (entry.spellbook[0] ?? []).map((id) => content.spells[id]).filter((s): s is Spell => !!s);
      return c0.length ? c0 : null;
    }
    const out: Spell[] = [];
    for (let r = 1; r <= ceiling; r++)
      for (const id of entry.spellbook[r] ?? []) {
        const sp = content.spells[id];
        if (sp) out.push(sp);
      }
    return out;
  };
  const listed = (): Spell[] => {
    const book = fromBook();
    if (book) return book;
    const pool = traditionPool(character, entry, content);
    return (ceiling === 0 ? pool.byRank[0] : pool.upTo[ceiling]) ?? [];
  };
  /* LEARNED SPELLS ARE ON THE LIST, FOR EVERY CASTER SHAPE. Days of the character's time and a
   * critical success bought this spell; the only question here is which list it joined.
   *
   * A caster WITH A BOOK has it merged into the book by applyPlayState — that IS their repository —
   * so the book branch above already offers it. A REPERTOIRE caster's stays in `entry.learned` by
   * print (*"If you have a spell repertoire… it's not automatically added since you can only know a
   * limited number of spells. Instead, you can select it when you add or swap spells"*) and was
   * therefore on NO list this function read: a bard could learn a spell off another tradition's
   * scroll and never be offered it, and the docblock row for ⑩ claimed the merge covered them.
   * Under the ordinary ceiling like everything else, and never past a restricted slot's `allowed`
   * list, which returns above. */
  const withLearned = (list: Spell[]): Spell[] => {
    const have = new Set(list.map((s) => s.id));
    const extra: Spell[] = [];
    for (const ids of Object.values(entry.learned ?? {}))
      for (const id of ids) {
        const sp = content.spells[id];
        if (sp && sp.rank <= ceiling && !have.has(sp.id)) {
          have.add(sp.id);
          extra.push(sp);
        }
      }
    return extra.length ? [...list, ...extra] : list;
  };
  const base = withLearned(listed());
  if (ceiling !== 0) return base;
  /* A CANTRIP OPENING also offers every cantrip the character already KNOWS, whatever list it came
   * from. Adapted Cantrip buys one from another tradition on purpose ("gain a cantrip from a
   * tradition other than your own"), so holding the opening to the tradition alone meant that the
   * moment its opening was re-prepared the cantrip was off the sheet AND off the picker — gone for
   * good, from one ordinary click. `cantripPool` is the BUILD's list, kept by the overlay so this
   * answer is the same on both surfaces. */
  const have = new Set(base.map((s) => s.id));
  const own = (entry.cantripPool ?? entry.cantrips ?? [])
    .filter((id) => !have.has(id))
    .map((id) => content.spells[id])
    .filter((s): s is Spell => !!s && s.rank === 0);
  return own.length ? [...base, ...own] : base;
}

/** Would that picker offer THIS spell — the render's half of the same question. */
export function offersSpell(ctx: SpellOptionCtx, rank: number, id: string, restrictedId?: string): boolean {
  return spellOptions(ctx, rank, restrictedId).some((s) => s.id === id);
}

/**
 * ⛔ THE ONE READING OF "WHAT RANK IS THIS SPELL AT" — the rank the repertoire FILES it at.
 *
 * Not the spell's own rank out of the content database. The picker offers every spell up to the
 * slot's rank, so a 1st-rank spell may legitimately sit at the 3rd-rank header, and the two readings
 * then disagree — which is how a ★ writer reading the second one deleted the player's star at the
 * other rank (R2, 2026-09-22). `starsAtRank` (play.ts) asks this of the STORED rank it is editing;
 * `signatureEchoIds` asks it of the rendered entry. One filing, two callers.
 */
export function filedRank(repertoire: Record<number, string[]> | undefined, id: string): number | undefined {
  for (const [rank, ids] of Object.entries(repertoire ?? {})) if (ids.includes(id)) return Number(rank);
  return undefined;
}

/**
 * Ids of a spontaneous entry's signature spells that should ECHO (display-only, starred) at `rank`:
 * a signature spell can be cast — heightened — from any slot of its base rank OR HIGHER, so it
 * appears at every higher rank that has a slot pool. Returns [] for rank 0 (cantrips never echo),
 * for ranks with no slot pool, and skips a spell already repertoired at that rank. The spell stays
 * repertoired only at its base rank; echoes never touch the data model or the known-spell count.
 *
 * ⚠ "Base rank" is `filedRank` — where this repertoire keeps the spell. It used to be the spell's own
 * rank, which echoed a 1st-rank spell filed at 3rd from rank 2 up, i.e. below the rank the player is
 * holding it at, and made the ★ writer and the echo disagree about which rank a star belongs to. A
 * star on a spell the repertoire does not list at all is filed nowhere and echoes nowhere — which is
 * the same answer applyPlayState gives when it declines to draw that ★ (it files the drawn stars by
 * rank through this same function).
 *
 * (Here rather than in SpellsTab because it is the second renderer of ⑦ and shares the filing above;
 * it takes no React and the sheet only draws what it returns.)
 */
export function signatureEchoIds(entry: SpellcastingEntry, rank: number): string[] {
  if (rank <= 0 || !entry.slots?.[rank]?.max) return [];
  const here = entry.repertoire?.[rank] ?? [];
  return (entry.signature ?? []).filter((id) => {
    const base = filedRank(entry.repertoire, id);
    return base !== undefined && base < rank && !here.includes(id);
  });
}

/** Player-chosen spells a rank is DRAWING — granted ones (bloodline, patron, conscious mind) never
 *  count. What the sheet shows, which is not always what the player holds: see `chosenAt`. */
const drawnAt = (entry: SpellcastingEntry, rank: number): number => {
  const granted = entry.grantedRepertoire?.[rank] ?? [];
  return (entry.repertoire?.[rank] ?? []).filter((id) => !granted.includes(id)).length;
};

/**
 * Player-chosen spells a rank HOLDS — what the add gate counts.
 *
 * `repertoireHeld` is the store's own count, written by the render, and it includes the picks the
 * fresh build is currently hiding. Counting the drawn list instead is how the SHEET could put a rank
 * over its cap all by itself: hide four with a subclass swap, and a rank that still held four looked
 * empty to the gate, which handed out four more places. Where the player has never touched the rank
 * there is nothing stored and the build's own list is what they hold.
 */
export function chosenAt(entry: SpellcastingEntry, rank: number): number {
  return entry.repertoireHeld?.[rank] ?? drawnAt(entry, rank);
}

/**
 * D5, THE OTHER SIDE OF THE CAP: places the rank HOLDS that it is not DRAWING.
 *
 * The gate counts the store and the list draws only what the fresh build's own picker offers, so a
 * bloodline swapped from arcane to divine leaves a sorcerer reading "Repertoire full (4 known)"
 * beside a list of nothing, with no ✕ to free a place and no Add button — a refusal with its cause
 * off screen, which is the "never hidden" half of D5 broken on the other side of the number. The
 * count is right (see chosenAt); what was missing is the sentence, so the sheet prints this beside
 * the rank instead of leaving the player to guess at four spells they cannot see.
 */
export function hiddenAt(entry: SpellcastingEntry, rank: number): number {
  return Math.max(0, chosenAt(entry, rank) - drawnAt(entry, rank));
}

/**
 * What the player HOLDS at each rank of a stored repertoire, grants stripped — `repertoireHeld`.
 *
 * The strip is of GRANTS, not of the store: an id that is both stored (the player bought it) and
 * granted by the fresh build is drawn as the grant — locked, no ✕ — and a grant has never counted
 * against the cap, so counting it as one of their places would charge them for a place they can
 * neither see nor free. Withdraw the grant and it is their own pick again, counted again, and if
 * that puts the rank over its cap the chip says so (`overCapOf`) — which is the whole D5 shape.
 * ⚠ The store itself keeps it either way; `storedRank` strips grants off the build's fallback only.
 */
export function heldCounts(built: SpellcastingEntry, stored: Record<number, string[]>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const rank of Object.keys(built.repertoire ?? {}).map(Number)) {
    const granted = built.grantedRepertoire?.[rank] ?? [];
    const list = stored[rank];
    out[rank] = list ? list.filter((id) => !granted.includes(id)).length : drawnAt(built, rank);
  }
  return out;
}

/** A flexible collection is one FLAT pool over ranks 1–9 (the 10th-rank capstone slot is outside it —
 *  owner ruling #102), so what it has spent is the sum. */
export function collectionUsed(entry: SpellcastingEntry): number {
  let n = 0;
  for (let r = 1; r <= 9; r++) n += chosenAt(entry, r);
  return n;
}

/**
 * How many spells this rank may hold — the ADD GATE, and the only place a cap is enforced.
 *
 * It refuses an add, which costs the player nothing they already had. It is never applied to what is
 * DRAWN: read renderRepertoire in play.ts for why hiding an over-cap spell was a delete on a delay.
 *
 * *"you must select at least one 1st-level spell for your collection each time you prepare"* — while
 * no 1st-rank spell is collected, one place of a flexible collection is reserved and cannot be spent
 * on a higher rank.
 */
export function repertoireCap(entry: SpellcastingEntry, rank: number): number {
  const size = entry.spellCollection;
  if (size !== undefined && rank >= 1 && rank <= 9) {
    const floorHeld = chosenAt(entry, 1) === 0 && rank !== 1 ? 1 : 0;
    // Expressed per rank because every caller compares it against this rank's count: what this rank
    // already holds, plus whatever is left in the shared pool.
    return chosenAt(entry, rank) + Math.max(0, size - collectionUsed(entry) - floorHeld);
  }
  // `repertoireMax` first: two records print a repertoire wider than their slot table (the oracle's
  // two 10th-rank spells over one slot, the summoner's five over four), and reading the slot count
  // alone let the builder fill the rank while the SHEET refused to put a different spell back.
  return entry.repertoireMax?.[rank] ?? entry.slots?.[rank]?.max ?? Infinity;
}

/**
 * OVER THE CAP — REPORTED, NEVER HIDDEN.
 *
 * `shown` is the entry the sheet draws, `built` the fresh build's own answer. The report counts what
 * is DRAWN, because it is a sentence the player reads next to a list they are looking at: telling
 * them a rank is one over while the spell in question is one the build is hiding would be an
 * instruction they cannot carry out.
 *
 * A build edit is the only thing that can produce the state — a level entered wrong and corrected, a
 * subclass swapped, a cap that shrank under a rank that was full. The sheet's own Add gate cannot:
 * it counts what the store HOLDS (`chosenAt`, on `repertoireHeld`), hidden picks included, so the
 * places it hands out are places the player really has. Every spell in the report is the player's
 * own, so the render draws them all and says so.
 *
 * The floor is the BUILD'S OWN COUNT, not the cap: a build may hand the player more than the cap
 * (that is what `repertoireMax` is for, and a record can print one wider still), and reporting the
 * build's own gift as an error would put a chip on a character nobody has edited.
 */
export function overCapOf(
  shown: SpellcastingEntry,
  built: SpellcastingEntry,
): { rank: number; by: number }[] | undefined {
  if (!shown.repertoire) return undefined;
  const drawnUsed = (e: SpellcastingEntry) => {
    let n = 0;
    for (let r = 1; r <= 9; r++) n += drawnAt(e, r);
    return n;
  };
  const out: { rank: number; by: number }[] = [];
  const size = shown.spellCollection;
  if (size !== undefined) {
    // rank 0 stands for the FLAT pool — a collection is full as a pool, not at a rank.
    const by = drawnUsed(shown) - Math.max(size, drawnUsed(built));
    if (by > 0) out.push({ rank: 0, by });
  }
  for (const rank of Object.keys(shown.repertoire).map(Number)) {
    if (size !== undefined && rank >= 1 && rank <= 9) continue; // counted in the pool above
    const cap = shown.repertoireMax?.[rank] ?? shown.slots?.[rank]?.max;
    if (cap === undefined) continue;
    const by = drawnAt(shown, rank) - Math.max(cap, drawnAt(built, rank));
    if (by > 0) out.push({ rank, by });
  }
  return out.length ? out : undefined;
}
