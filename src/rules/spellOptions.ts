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
import { entrySourceOn } from './sources';

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
  /* THE RENDER'S LIST FOR A BOOK CASTER IS THE BOOK *AND* THE TRADITION — never narrower than it was.
   *
   * What a book caster may ADD is its book (desk 155: *"Select these spells from the same source as
   * normal, such as from a spellbook for a wizard"*, archetype-99; owner's bug 2026-10-14: a magus
   * could prepare cantrips that are not in their spellbook) — and that narrowing lives in
   * `pickerSpellOptions`, the ADD side, alone. This function also answers the RENDER ("is the pick
   * already stored still drawn?"), and a book that REPLACED the tradition here took the player's picks
   * with it, three ways:
   *   · a cantrip prepared on the sheet before the picker was held to the book (every wizard, witch
   *     and magus, whose openings offered the whole tradition until 2026-10-14);
   *   · a cantrip the player prepared, hidden the moment they LEARNED one — Learn a Spell merges a
   *     learned cantrip into `spellbook[0]`, and a rank-0 book list used to REPLACE the tradition
   *     (measured: learn daze, and the opening holding shield rendered "Empty cantrip");
   *   · a leveled spell the builder has since taken out of the book.
   * So the book is UNIONED onto the tradition here: a stored pick on the caster's tradition (within
   * the ceiling) keeps being drawn, castable, with the sheet's "Not in your spellbook" marker
   * (`notInBookOf`). Order: at rank 0 the tradition's own order first (unchanged for a book with no
   * rank-0 list); at rank 1+ the book's order first, which is exactly the order the picker shows. */
  const listed = (): Spell[] => {
    const pool = traditionPool(character, entry, content);
    const trad = (ceiling === 0 ? pool.byRank[0] : pool.upTo[ceiling]) ?? [];
    const ids = ceiling === 0 ? [...(entry.bookCantrips ?? []), ...(entry.spellbook?.[0] ?? [])] : bookIdsUpTo(entry, ceiling);
    // A cantrip opening holds cantrips only (a 4th-rank spell parked in one is not drawn); a leveled
    // slot reads the book by the RANK IT IS FILED AT, exactly as it always has.
    const book = ids.map((id) => content.spells[id]).filter((s): s is Spell => !!s && (ceiling !== 0 || s.rank === 0));
    if (!book.length) return trad;
    if (ceiling === 0) {
      const have = new Set(trad.map((s) => s.id));
      const extra = book.filter((s) => !have.has(s.id) && !!have.add(s.id));
      return extra.length ? [...trad, ...extra] : trad;
    }
    const have = new Set<string>();
    const uniqueBook = book.filter((s) => !have.has(s.id) && !!have.add(s.id));
    return [...uniqueBook, ...trad.filter((s) => !have.has(s.id))];
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
  /* A spell a record added AT ITS RANK ONLY — Adaptive Adept: *"you don't gain access to the heightened
   * versions of that spell, meaning you can't prepare them if you prepare spells"* (feat-4481) — is left
   * out of a higher slot. buildCharacter lists a spell there only when nothing the entry prepares from
   * already offers it (its tradition or a replaced list, a deity's spells, an opened tradition). */
  if (ceiling !== 0) {
    const atRankOnly = entry.noHeighten;
    return atRankOnly?.length ? base.filter((s) => !(atRankOnly.includes(s.id) && s.rank < ceiling)) : base;
  }
  /* A CANTRIP OPENING also offers every cantrip the character already KNOWS, whatever list it came
   * from. Adapted Cantrip buys one from another tradition on purpose ("gain a cantrip from a
   * tradition other than your own"), so holding the opening to the tradition alone meant that the
   * moment its opening was re-prepared the cantrip was off the sheet AND off the picker — gone for
   * good, from one ordinary click. `cantripPool` is the BUILD's list, kept by the overlay so this
   * answer is the same on both surfaces.
   *
   * …plus the cantrips a FEAT put in this entry (`spellSources` — Adapted Cantrip's): on a prepared
   * class whose openings the player has filled, that cantrip is an option and not in `cantrips`
   * (build.ts, the Adapted Cantrip grant), and the list addition that offers it is subject to Hide
   * legacy above — so a legacy answer (acid splash) prepared in an opening drew "Empty cantrip"
   * (checker finding, 2026-10-15). Rank 0 only, below, like the rest of this list. */
  const have = new Set(base.map((s) => s.id));
  const own = [...(entry.cantripPool ?? entry.cantrips ?? []), ...Object.keys(entry.spellSources ?? {})]
    // …once: with an opening free the build ALSO puts the feat's cantrip in `cantrips`.
    .filter((id) => !have.has(id) && !!have.add(id))
    .map((id) => content.spells[id])
    .filter((s): s is Spell => !!s && s.rank === 0);
  return own.length ? [...base, ...own] : base;
}

/** Would that picker offer THIS spell — the render's half of the same question. */
export function offersSpell(ctx: SpellOptionCtx, rank: number, id: string, restrictedId?: string): boolean {
  return spellOptions(ctx, rank, restrictedId).some((s) => s.id === id);
}

/**
 * Every spell this entry already HOLDS or a record names for it — what the sheet's pickers keep whatever its book.
 *
 * Cantrips (the openings, the build's pool, the granted and traded ones), the spellbook, the repertoire (its
 * grants too), learned spells, what the slots and restricted slots hold today, signature spells, and the spells a
 * feat adds to the list by name (Fey Caller's illusions: a record's own list, never narrowed).
 */
export function spellsHeldBy(character: Character, entry: SpellcastingEntry): Set<string> {
  const out = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id) out.add(id);
  };
  for (const id of [...entry.cantrips, ...(entry.cantripPool ?? []), ...(entry.grantedCantrips ?? []), ...(entry.bookCantrips ?? [])]) add(id);
  for (const id of [...(entry.tradedCantrips ?? []), ...(entry.cantripSlots ?? [])]) add(id);
  for (const rec of [entry.spellbook, entry.repertoire, entry.grantedRepertoire, entry.learned])
    for (const ids of Object.values(rec ?? {})) for (const id of ids) add(id);
  for (const slots of Object.values(entry.prepared ?? {})) for (const s of slots) add(s.spellId);
  for (const rs of entry.restrictedSlots ?? []) {
    add(rs.spellId);
    add(rs.spellId2);
  }
  for (const id of entry.signature ?? []) add(id);
  for (const id of [...(character.spellListAdditions?.['*'] ?? []), ...(character.spellListAdditions?.[entry.id] ?? [])]) add(id);
  return out;
}

/**
 * THE SHEET PICKER'S LIST: `spellOptions` narrowed to the character's books — desk #170, owner 2026-09-30: "yes the
 * player sources should aplly to everything he has accses to".
 *
 * `books` is the character's enabledBookSet. A spell whose book is off is left out unless the entry already holds
 * it or a record names it (`spellsHeldBy`); a spell with no book always stays (entrySourceOn). A restricted slot's
 * `allowed` list is the granting record's own list (a curriculum, Sin Reservoir) and is never narrowed — except the
 * ids a TRAIT search of the whole database put there (`allowedByTrait`, Master Summoner), which follow the books
 * like any other list (restrictedAllowedOnBooks).
 *
 * ⛔ The RENDER never asks this. applyPlayState keeps asking `spellOptions` / `offersSpell`, which read no book, so
 * a prepared or repertoire spell from a book switched off since is still drawn and never pruned; this list only
 * decides what may be ADDED, and it is always a subset of what the render draws (the rule in this file's header).
 *
 * `keep` is the ASKING opening's own pick today (a cantrip opening, a Spell Blending traded one): a book caster's
 * cantrip picker keeps it on offer in that opening alone — see `bookAllows`.
 */
export function pickerSpellOptions(
  ctx: SpellOptionCtx,
  rank: number,
  restrictedId: string | undefined,
  books: Set<string>,
  keep?: string | null,
): Spell[] {
  const all = spellOptions(ctx, rank, restrictedId);
  const rs = restrictedId
    ? (ctx.restrictedSlots ?? ctx.entry.restrictedSlots)?.find((s) => s.id === restrictedId.replace(/#2$/, ''))
    : undefined;
  if (rs?.allowed?.length) {
    const ok = new Set(restrictedAllowedOnBooks(ctx, rs, books));
    return all.filter((s) => ok.has(s.id));
  }
  /* …and a BOOK caster adds ONLY out of its book (owner's bug 2026-10-14: "magus (and other spellbook
   * casters) can prepare spells that aren't in their spellbook"). The render list above is the book
   * AND the tradition, so nothing already drawn is lost; this is the add side alone, and it is the
   * same list for every opening that adds — the Prepare-a-cantrip opening, Spell Blending's traded
   * cantrip openings, an ordinary slot, a restricted slot with no list of its own, a collection —
   * plus, in a cantrip opening, that opening's own pick (`keep`). */
  const inBook = bookAllows(ctx.entry, Math.min(rank, rs?.maxRank ?? rank), keep);
  const held = spellsHeldBy(ctx.character, ctx.entry);
  return all.filter((s) => (!inBook || inBook.has(s.id)) && (entrySourceOn(books, s) || held.has(s.id)));
}

/** The book's leveled ids filed at ranks 1..ceiling, in the book's own order. */
function bookIdsUpTo(entry: SpellcastingEntry, ceiling: number): string[] {
  const out: string[] = [];
  for (let r = 1; r <= ceiling; r++) out.push(...(entry.spellbook?.[r] ?? []));
  return out;
}

/**
 * A BOOK caster's CANTRIPS — what print fills its openings from (*"you can prepare … five cantrips each
 * morning from the spells in your spellbook"*, class-feature-793). Null for an entry with no book of
 * cantrips: `bookCantrips` is written only by buildCharacter's two book branches — a class book and an
 * archetype book (Wizard, Witch, Magus, Necromancer, Hedge Mage, Spellshot Dedication: *"a spellbook with
 * four common arcane cantrips … You can prepare two cantrips each day from your spellbook"*) — so every
 * other caster's openings keep their tradition. Held as one set:
 *   · `bookCantrips` — the builder's book (its first ones are the standing preparation);
 *   · `spellbook[0]` / `learned[0]` — cantrips added with Learn a Spell (merged into the book in play);
 *   · `grantedCantrips` — a record's rank-0 grant;
 *   · the BUILD's own list (`cantripPool`, or `cantrips` before the overlay) — Adapted Cantrip's pick,
 *     which *"you can choose … when you prepare your cantrips"*.
 */
export function bookCantripIds(entry: SpellcastingEntry): Set<string> | null {
  if (!entry.bookCantrips) return null;
  return new Set([
    ...entry.bookCantrips,
    ...(entry.spellbook?.[0] ?? []),
    ...(entry.learned?.[0] ?? []),
    ...(entry.grantedCantrips ?? []),
    ...(entry.cantripPool ?? entry.cantrips),
  ]);
}

/**
 * A BOOK caster's leveled spells — every rank of the book (Learn a Spell's are merged into it) and
 * `learned`.
 *
 * Null ("cannot say": the picker offers the tradition) only where no book was BUILT. An empty book the
 * build made — `bookCantrips` is written only by buildCharacter's class and archetype book branches, so
 * its presence says the book was built — is an empty book, and an empty set: nothing to ADD at rank 1+
 * until the builder puts a spell in it. Lane C3 (2026-10-15): that empty book read as "cannot say",
 * so a fresh wizard or magus with no leveled book picks was offered its whole tradition at every rank
 * on the sheet — the owner's bug (2026-10-14) still reachable. The archetype books (Wizard … Spellshot
 * Dedication, ArchetypeBook) follow the same rule: a fighter whose wizard dedication's spellbook holds
 * no 1st-rank spell is offered none to prepare, and is told to add some in the builder. What is DRAWN is
 * unchanged: the render asks `spellOptions`, whose list is the book AND the tradition, so a pick stored
 * earlier keeps drawing, marked "Not in your spellbook" (`notInBookOf`).
 */
export function bookLeveledIds(entry: SpellcastingEntry): Set<string> | null {
  const filled = !!entry.spellbook && Object.values(entry.spellbook).some((ids) => ids.length);
  if (!filled && !entry.bookCantrips) return null;
  const out = new Set<string>();
  for (const [r, ids] of Object.entries(entry.spellbook ?? {})) if (Number(r) > 0) for (const id of ids) out.add(id);
  for (const [r, ids] of Object.entries(entry.learned ?? {})) if (Number(r) > 0) for (const id of ids) out.add(id);
  return out;
}

/** What the book lets an opening of this ceiling ADD, or null where no book answers. At rank 0 the
 *  ASKING opening's own pick today (`keep`) is kept on offer (desk #170's keep): a cantrip prepared
 *  before the picker was held to the book stays until the player changes that opening themselves.
 *  That opening's ONLY — every opening's off-book pick offered in every opening (Spell Blending's
 *  traded ones included) let a legacy off-book cantrip be copied into a new opening, which is the
 *  owner's bug again in a narrower shape (lane C1 check, 2026-10-14). */
function bookAllows(entry: SpellcastingEntry, ceiling: number, keep?: string | null): Set<string> | null {
  if (ceiling !== 0) return bookLeveledIds(entry);
  const book = bookCantripIds(entry);
  if (!book) return null;
  if (keep) book.add(keep);
  return book;
}

/**
 * NOT IN THE BOOK — REPORTED, NEVER HIDDEN (the `overCapOf` shape).
 *
 * The spells a book caster's entry is DRAWING that its book does not hold: a cantrip prepared on the
 * sheet before the openings were held to the book, a leveled spell the builder has since taken out
 * of it. Every one stays drawn and castable — a pick the player stored is never hidden — and the
 * sheet marks it "Not in your spellbook — add it in the builder" (`notInBookNote`). Written by
 * applyPlayState onto the overlaid entry, `entry.notInBook`.
 *
 * A restricted slot with its own `allowed` list (a curriculum, Studious Spells) is that record's rule,
 * not the book's, and a grant is a rule too, so neither is judged here. An empty book "cannot say" only
 * where no class built it (`bookLeveledIds`): a class book that is empty holds none of what is drawn.
 */
export function notInBookOf(entry: SpellcastingEntry): string[] | undefined {
  const out = new Set<string>();
  const cantrips = bookCantripIds(entry);
  if (cantrips)
    for (const id of [...(entry.cantripSlots ?? []), ...(entry.tradedCantrips ?? [])]) if (id && !cantrips.has(id)) out.add(id);
  const leveled = bookLeveledIds(entry);
  if (leveled) {
    for (const slots of Object.values(entry.prepared ?? {}))
      for (const s of slots) if (s.spellId && !s.traded && !leveled.has(s.spellId)) out.add(s.spellId);
    for (const rs of entry.restrictedSlots ?? []) {
      if (rs.allowed?.length || rs.spontaneous) continue;
      for (const id of [rs.spellId, rs.spellId2]) if (id && !leveled.has(id)) out.add(id);
    }
    if (entry.spellCollection !== undefined)
      for (const [r, ids] of Object.entries(entry.repertoire ?? {})) {
        const granted = entry.grantedRepertoire?.[Number(r)] ?? [];
        for (const id of ids) if (!granted.includes(id) && !leveled.has(id)) out.add(id);
      }
  }
  return out.size ? [...out] : undefined;
}

/**
 * A restricted slot's `allowed` ids as the character's books see them — desk #170. The granting record's own named
 * list stays whole; an id a trait search found (`allowedByTrait`) stays only when its book is on, it has no book,
 * or the entry already holds it (`spellsHeldBy`, which counts what every restricted slot holds today). Both the
 * picker and the spontaneous "extra cast" card read this, so the card never names a spell the picker would refuse.
 */
export function restrictedAllowedOnBooks(ctx: SpellOptionCtx, rs: RestrictedSlot, books: Set<string>): string[] {
  const allowed = rs.allowed ?? [];
  if (!rs.allowedByTrait?.length) return allowed;
  const byTrait = new Set(rs.allowedByTrait);
  const held = spellsHeldBy(ctx.character, ctx.entry);
  return allowed.filter((id) => {
    if (!byTrait.has(id) || held.has(id)) return true;
    const sp = ctx.content.spells[id];
    return !sp || entrySourceOn(books, sp);
  });
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
  // …less the places a sorcerer's gift takes (`grantedPlaces`): the gate counts the player's OWN
  // picks, grants stripped, so the allowance it compares them with has to be stripped the same way.
  return Math.max(0, (entry.repertoireMax?.[rank] ?? entry.slots?.[rank]?.max ?? Infinity) - grantedPlaces(entry, rank));
}

/** The CLASS record's grants at `rank` (0 = cantrips) — not what a FEAT granted beside them (`spellSources`:
 *  Adaptive Adept's 1st-rank spell is in `grantedRepertoire` too). Read as the sorcerer's gift, a feat's
 *  spell made a second "only one of these 2" gift chip and note (checker finding, 2026-10-15). */
const grantsAt = (entry: SpellcastingEntry, rank: number): string[] =>
  ((rank === 0 ? entry.grantedCantrips : entry.grantedRepertoire?.[rank]) ?? []).filter((id) => !entry.spellSources?.[id]);

/**
 * How many of the player's places at `rank` (0 = cantrips) the class's OWN gift takes — the sorcerer's
 * sorcerous gift, which print counts INSIDE the allowance (`grantsCountInside`). Zero for every other
 * entry, whose grants ride on top.
 *
 * ONE place, however many ids the record lists there. Print gives one gift per rank — *"an additional
 * spell and cantrip from your bloodline"*, *"your first new spell is always the sorcerous gift spell for
 * that rank"* (class-62).
 *
 * ⚠ Three bloodline records list every VARIANT's gift at some ranks (`variantGiftCount`): draconic one per
 * dragon tradition at 2nd, 5th and 8th; elemental one per element at cantrip, 1st, 3rd and 6th; genie one
 * per genie type at 2nd, 5th and 8th. Print gives the chosen variant's alone, and the data cannot say
 * which that is: the option's `grantedSpells` is one flat list, `dragonChoice` names each dragon's
 * tradition but not its gifts, elemental and genie carry no choice at all, and only the description
 * prose pairs each gift with its variant. So the gifts are drawn, every one saying only one of them is
 * the character's (`variantGiftNote`), and together they take the ONE place print gives.
 *
 * Lane C3 tried one place per listed gift for one round, and it was worse (C3 check round 1): a draconic
 * or genie sorcerer had no place of its own at 2nd/5th/8th, an elemental none at cantrip/1st/3rd/6th,
 * every print-correct pick there was marked over with "remove one", and removing one never cleared the
 * marker — following it deleted correct picks while the wrong gifts stayed. Extra spells drawn for free
 * cost the player nothing they own; a refused add and a false "remove one" do. The fix that settles it is
 * data: each variant's gifts by rank, and element and genie-type questions in the builder.
 * (Phoenix listed two at 2nd only because its 4th-rank gift, Cleanse Affliction, is a 2nd-rank spell;
 * the bloodline's grant ladder, `classFeatures/bloodline.grantedSpells`, now files it at 4th.)
 *
 * Lane C2 (2026-10-14). The build used to keep the sorcerer's count by slicing the player's picks off
 * behind the gift, the builder offered the full count, and the sheet's gate treated the gift as free —
 * three answers to one rule, and the first one hid picks. This is the one answer: the builder's caps
 * (`ownPlacesBeside`), this gate and `overCapOf` all subtract it, and the build draws every pick.
 */
export function grantedPlaces(entry: SpellcastingEntry, rank: number): number {
  return entry.grantsCountInside && grantsAt(entry, rank).length ? 1 : 0;
}

/**
 * How many gifts the record lists at `rank` (0 = cantrips) when it lists ONE PER VARIANT — more than one
 * where print gives one (`grantedPlaces`). 0 at every other rank and for any entry without
 * `grantsCountInside`. Measured lane C4 (2026-10-15): draconic (one per dragon tradition, 2nd/5th/8th),
 * elemental (one per element: cantrip, 1st, 3rd, 6th) and genie (one per genie type, 2nd/5th/8th) — the
 * record does not say which is the character's, so every one is drawn and each says so
 * (`variantGiftNote`). A gift id listed twice (elemental's Chain Lightning, air and metal) is one.
 */
export function variantGiftCount(entry: SpellcastingEntry | undefined, rank: number): number {
  if (!entry?.grantsCountInside) return 0;
  const n = new Set(grantsAt(entry, rank)).size;
  return n > 1 ? n : 0;
}

/**
 * The BUILDER's side of `grantedPlaces`: how many chips a row of `count` places may hold when its chips
 * are `picks`. A pick that IS one of the record's gift ids is not one of the player's own on the sheet
 * (`drawnAt` strips grants), so it is given its place back here — the row's count and the sheet's
 * (own picks, grants stripped, against the allowance less the gift) are then the same number. `entry`
 * is buildCharacter's own class entry; `count` itself for any entry without `grantsCountInside`.
 */
export function ownPlacesBeside(entry: SpellcastingEntry | undefined, rank: number, count: number, picks: readonly string[]): number {
  if (!entry?.grantsCountInside) return count;
  const granted = grantsAt(entry, rank);
  return Math.max(0, count - grantedPlaces(entry, rank) + picks.filter((id) => granted.includes(id)).length);
}

/** What a FEAT made known in a REPERTOIRE at `rank` (1+) beside the row's `picks` — Adaptive Adept's
 *  1st-rank spell (`grantedRepertoire` + `spellSources`). The builder draws them as LOCKED chips with a
 *  line saying they use none of the row's places: `grantsAt` keeps them out of the gift chips, and a spell
 *  drawn nowhere in the row is one a player may spend a place learning again (checker finding,
 *  2026-10-15). [] for a cantrip row and for a prepared or book entry (a list option, or `bookGrantChips`). */
export function featRepertoireGrants(entry: SpellcastingEntry | undefined, rank: number, picks: readonly string[]): { id: string; from: string }[] {
  if (!entry || entry.type !== 'spontaneous' || !entry.repertoire || entry.spellCollection !== undefined || rank < 1) return [];
  return (entry.grantedRepertoire?.[rank] ?? [])
    .filter((id) => !!entry.spellSources?.[id] && !picks.includes(id))
    .map((id) => ({ id, from: entry.spellSources![id] }));
}

/** The gift ids the builder draws as LOCKED chips in a row whose chips are `picks` — the record's grants
 *  the player did not also pick. [] for any entry without `grantsCountInside`. */
export function giftChipIds(entry: SpellcastingEntry | undefined, rank: number, picks: readonly string[]): string[] {
  if (!entry?.grantsCountInside) return [];
  return grantsAt(entry, rank).filter((id) => !picks.includes(id));
}

/**
 * What a RECORD wrote into a dedication's BOOK at `rank` (0 = its cantrips) — the builder's locked chips
 * beside the player's own picks, each with the record that wrote it. A lesson's *"your familiar learns
 * Spirit Link"* (Basic Lesson under Basic Witchcraft), Expanded Necromancy's *"Add the grisly growths spell
 * to your dirge"* (feat-9132), Peer Past the Hedge's detect magic: buildCharacter puts each IN the book
 * (`grantIntoBook`) and marks it in `grantedRepertoire` / `spellSources`. None of them is one of the
 * places the player chooses — print adds them on top — so the row's count never includes them. A spell the
 * player also picked is theirs (`picks`) and is not drawn twice. [] for an entry with no book.
 *
 * `andAbove`: the book's LAST row also takes the grants at ranks the book has no row for yet — a Witch
 * Dedication with only Basic Witch Spellcasting whose Major Lesson teaches Raise Dead (6th rank) has rows
 * to 3rd, and the spell would otherwise be drawn in no row at all (checker finding 2026-10-15). Each carries
 * its `rank`, so the row can say which.
 */
export function bookGrantChips(
  entry: SpellcastingEntry | undefined,
  rank: number,
  picks: readonly string[],
  andAbove = false,
): { id: string; rank: number; from?: string }[] {
  if (!entry?.bookNoun) return [];
  const ranks = andAbove
    ? Object.keys(entry.grantedRepertoire ?? {}).map(Number).filter((r) => r >= rank).sort((a, b) => a - b)
    : [rank];
  return ranks.flatMap((r) => {
    const page = r === 0 ? entry.bookCantrips : entry.spellbook?.[r];
    return (entry.grantedRepertoire?.[r] ?? [])
      .filter((id) => !picks.includes(id) && !!page?.includes(id))
      .map((id) => ({ id, rank: r, ...(entry.spellSources?.[id] ? { from: entry.spellSources[id] } : {}) }));
  });
}

/** How many cantrip OPENINGS a prepared entry shows: its cap, or one per own stored pick when the build
 *  draws more (a save made under a larger cap, `cantripCapWas`) — an opening is what draws a prepared
 *  cantrip, so fewer would hide one. The play overlay (which also opens one the player prepared on the
 *  sheet past the cap) and the sheet's Prepare panel both size by this. */
export function cantripOpenings(entry: SpellcastingEntry): number {
  const granted = entry.grantedCantrips ?? [];
  return Math.max(entry.cantripCap ?? entry.cantrips.length, entry.cantrips.filter((id) => !granted.includes(id)).length);
}

/**
 * A `grantsCountInside` entry's cantrips OVER its allowance — the player's own, gift stripped, past
 * `cantripCap` less the gift's one place. Only a builder that offered the full five beside the gift
 * can produce it (every saved sorcerer from before lane C2 that filled its row), and the cantrips are
 * the player's own, so the sheet draws every one and says so — the `overCapOf` shape, for the one list
 * a spontaneous caster cannot edit on the sheet.
 *
 * A cantrip a FEAT put in the pool (`spellSources`: Adapted Cantrip's, written only when the player had
 * not picked it themselves) is not one of the player's own either — the same set deriveBuildFromCharacter
 * leaves out of the build it reads back. Counted, a sorcerer with Adapted Cantrip read "One too many —
 * … remove one in the builder" beside a builder that offered exactly the places it filled (feat-4474:
 * *"replace one of your cantrips known with the chosen spell"*; 2026-10-15).
 *
 * Any other class entry whose cap Dual Class made smaller (`cantripCapWas`: the bonus now feeds the
 * other class) counts the same way, without the gift: what is DRAWN past `cantripCap` — so a cantrip the
 * player empties out of an opening on the sheet takes its note with it. 0 everywhere else.
 */
export function cantripsOverOf(entry: SpellcastingEntry): number {
  if (entry.cantripCap === undefined) return 0;
  if (!entry.grantsCountInside && entry.cantripCapWas === undefined) return 0;
  const granted = entry.grantedCantrips ?? [];
  const fromFeats = entry.spellSources ?? {};
  const own = entry.cantrips.filter((id) => !granted.includes(id) && !(id in fromFeats)).length;
  if (!entry.grantsCountInside) return Math.max(0, own - entry.cantripCap);
  return Math.max(0, own - Math.max(0, entry.cantripCap - grantedPlaces(entry, 0)));
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
    const max = shown.repertoireMax?.[rank] ?? shown.slots?.[rank]?.max;
    if (max === undefined) continue;
    const cap = Math.max(0, max - grantedPlaces(shown, rank));
    /* The floor is the build's own count — except where the class's gift counts inside the allowance
     * (`grantsCountInside`): there the build draws nothing of its own beyond the player's builder
     * picks, so its count past the cap is the player's over-pick, not a gift, and it is reported. */
    const by = drawnAt(shown, rank) - (shown.grantsCountInside ? cap : Math.max(cap, drawnAt(built, rank)));
    if (by > 0) out.push({ rank, by });
  }
  return out.length ? out : undefined;
}
