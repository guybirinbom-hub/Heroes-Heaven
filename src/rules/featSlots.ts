/*
 * Feat-slot eligibility + "why is my feat missing?" classification.
 *
 * The builder's feat pickers offer only feats that are legal for the slot AND come from the
 * character's enabled source books (plus campaign toggles). That's correct, but it used to be
 * silent: a player searching for a feat they KNOW exists (it shows in the Overrides add-feat
 * picker, which browses the FULL content) got "Nothing matches" with no explanation.
 * `findHiddenFeatMatches` computes the honest diff for the picker's search box: which matching
 * feats exist in the full content but are hidden here, and WHY (disabled source book / behind the
 * class-slot Archetypes toggle / behind a campaign toggle / simply not valid for this slot).
 */
import { searchMatches } from '../data/searchRank';
import type { BuildState } from './build';
import { backgroundGrantedFeats, kineticSlotAllows, levelGrants, loreKey, resolveBackground } from './build';
import { anyListLifts, heldBackPlaceKeys, heldBackPlaceWords, placeLiveForKey, removedPlaceKeys } from './blocks/active';
import { categoryWords, levelWords, liftedAll, notOursWords, onlyAtWords, refusal, type SlotRefusal, type SlotRule } from './choiceRefusal';
import { takesAllowed } from './featGrants';
import { heldFeatIds, heldFeatSlots, slotCategoryOf } from './heldFeats';
import { mythicSlotAllows } from './mythic';
import { SLOT_KEYED, SLOT_PREFIX, VARIANT_KEYED, VARIANT_SLOT } from './slotKey';
import type { ContentDatabase, Feat, FeatCategory, ProficiencyKey } from './types';
import { SKILLS } from './types';
import { skillAbility } from './derive';
import { entrySourceOn } from './sources';

/**
 * Which SKILL a skill feat is for, read off its prerequisites — *"trained in Deception"*.
 *
 * PF2e never states this as a field; the prerequisite line is the only place a skill feat says which
 * skill it belongs to, and the clause that needs the answer (Skillful Lessons' *"an Int-, Wis- or
 * Cha-based skill"*) is written in those terms. A feat naming none is not "for" any skill — Assurance
 * and Dubious Knowledge apply to whatever you have — and returns an empty list rather than a guess.
 */
function skillKeysOfFeat(f: Feat): ProficiencyKey[] {
  const out = new Set<ProficiencyKey>();
  for (const p of f.prerequisites ?? []) {
    for (const m of String(p).matchAll(/(?:trained|expert|master|legendary)\s+in\s+([A-Z][A-Za-z]*)(\s+Lore)?/g)) {
      const name = m[1].toLowerCase();
      const lore = m[2] ? loreKey(name) : null;
      if (lore) out.add(lore);
      else if ((SKILLS as readonly string[]).includes(name)) out.add(name as ProficiencyKey);
    }
  }
  return [...out];
}

export type { SlotRefusal, SlotRule };

export interface FeatSlotRef {
  level: number;
  /** The BOOK category: an extra place's `extraclass` key reads 'class' (`slotRefOf`, C10). */
  category: FeatCategory;
  idx: number;
  /** The stored slot key (WP7, C10): an extra place's `<level>:extra<category>:<n>`, which `featSlotKey` cannot
   *  rebuild from the three fields. Absent: `featSlotKey(p)`. */
  key?: string;
  /** An extra feat place (`choice.addPlace`), not a book slot. */
  place?: boolean;
}

/** The featPicks key for a slot — "level:category:idx" (mirrors the builder's slotKey). */
export const featSlotKey = (p: FeatSlotRef) => `${p.level}:${p.category}:${p.idx}`;

/**
 * A slot key read as a place (Tweaks phase 2, WP7, C10): `4:class:0` → the book slot; `4:extraclass:483920` → the
 * extra class place at 4 (`place: true`, its `n` as `idx`, the BOOK category). `key` is the slot part of `key`.
 * null: not a slot key. With `slotCategoryOf` (heldFeats.ts) the one reader of a key's category: `fitsSlot`,
 * `slotBookRefusals` and `moveTargetFor` build their ref here, so a place's pick fits its own place and is never
 * counted as taken elsewhere by itself.
 */
export function slotRefOf(key: string): (FeatSlotRef & { key: string; place: boolean }) | null {
  const m = SLOT_PREFIX.exec(key);
  if (!m) return null;
  // A SLOT_PREFIX match always has a category, so slotCategoryOf always answers.
  const category = slotCategoryOf(m[0]) as FeatCategory;
  return { level: Number(m[1]), category, idx: Number(m[3]), key: m[0], place: category !== m[2] };
}

/**
 * Put `featId` in the slot `key` (or empty it with null) — the ONE feat placement (Tweaks phase 2, C44): the
 * Builder's `setFeat` and every phase-2 write that places a feat (Take anyway, Allow here, Take again, an extra
 * place's pick) go through it. A new feat invalidates the old slot's sub-choice — INCLUDING a multi-pick one,
 * whose answers live at `<slot>#0..#n`, not at the bare slot key. Deleting only the bare key left Splinter
 * Faith's four answers behind: swap it out of a slot and back in and the player got "nature, pain, zeal,
 * death" — four domains they never picked for this feat, one of them the *"up to one domain that isn't on
 * either list"* (feat-7596). The feat's own embedded choice ("choose a domain", "choose an energy type") is
 * left UNSET: a pre-filled picker doesn't read as a question (Domain Initiate arrived with a domain the player
 * never chose, and the focus spell that came with it was a surprise). Pure: returns a new build.
 */
export function withFeat<B extends Pick<BuildState, 'featPicks' | 'featChoices'>>(b: B, key: string, featId: string | null): B {
  const featPicks = { ...b.featPicks };
  const featChoices = { ...b.featChoices };
  for (const k of Object.keys(featChoices)) {
    if (k === key || k.startsWith(`${key}#`)) delete featChoices[k];
  }
  if (featId) featPicks[key] = featId;
  else delete featPicks[key];
  return { ...b, featPicks, featChoices };
}

/** One level's feat-slot list, exactly as the Builder's level page draws it (same arguments). The feats
 *  taken — a slot Ultimate Flexibility adds — include the ones given through Tweaks (case D, decision D4:
 *  every `levelGrants` caller that passes taken feats reads `heldFeatIds`). The STORAGE view (WP7, C9, C11): a
 *  paused extra place holding Ultimate Flexibility keeps its bonus slot drawn, so a pause never moves a slot. */
const slotListAt = (b: BuildState, content: ContentDatabase, level: number, taken = heldFeatIds(b, undefined, { includePaused: true })) =>
  levelGrants(level, b.classId, content, b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, taken).featSlots;

/** The slot key of the `ordinal`th printed `category` slot at `level`, as that level's page draws it; null when it
 *  draws fewer (a removal or an "Add a place" target that is not drawn: "Not in use", C29). */
export function printedSlotKey(b: BuildState, content: ContentDatabase, level: number, category: string, ordinal: number): string | null {
  const at = slotsOf(slotListAt(b, content, level), category)[ordinal];
  return at === undefined ? null : `${level}:${category}:${at}`;
}

/** One printed feat slot as a place "Remove a place" names (C17): its level, category and nth-of-its-category. */
export interface PrintedFeatPlace {
  key: string;
  level: number;
  category: FeatCategory;
  ordinal: number;
}
/** Every printed feat slot from level 1 to the character's level, in page order. */
export function printedFeatPlaces(b: BuildState, content: ContentDatabase): PrintedFeatPlace[] {
  const taken = heldFeatIds(b, undefined, { includePaused: true });
  const out: PrintedFeatPlace[] = [];
  for (let level = 1; level <= b.level; level++) {
    const list = slotListAt(b, content, level, taken);
    list.forEach((category, i) => out.push({ key: `${level}:${category}:${i}`, level, category, ordinal: slotsOf(list, category).indexOf(i) }));
  }
  return out;
}

/** The printed feat slots a LIVE "Remove a place" removes, as slot keys (C17): each removal's (level, category,
 *  ordinal) read against the level's slot list as drawn now, so it follows its slot across every slot toggle. */
export function removedSlotKeys(b: BuildState, content: ContentDatabase): ReadonlySet<string> {
  return removedPlaceKeys(b, (level) => slotListAt(b, content, level));
}

/** Every level's feat-slot list (the storage view's taken feats, as `slotListAt`: no slot moves on a pause, C11). */
function featSlotLists(b: BuildState, content: ContentDatabase): FeatCategory[][] {
  const taken = heldFeatIds(b, undefined, { includePaused: true });
  return Array.from({ length: 20 }, (_, i) => slotListAt(b, content, i + 1, taken));
}

/** Every feat category some level 1–20 of this character's slot lists draws (Tweaks phase 2 WP7, C13: an extra
 *  impulse, mythic or bonus place is offered only to a character whose own book places draw one). */
export function drawnSlotCategories(b: BuildState, content: ContentDatabase): ReadonlySet<FeatCategory> {
  return new Set(featSlotLists(b, content).flat());
}

/** Every build map whose keys START with a slot key (the pick and every answer made under it), and a slot key at
 *  the start of a key — both in slotKey.ts, a leaf (the write door refuses a tweak holding a slot key, C32; the
 *  Character.tweakKept writer reads the same maps, C46). The `#`-variant maps (VARIANT_KEYED) live there too. */
export { SLOT_KEYED, SLOT_PREFIX };
const moveVariantSlot = (k: string, move: (slot: string) => string) => k.replace(VARIANT_SLOT, (_, s: string) => `#${move(s)}`);
/** The order `levelGrants` pushes a level's slots in. A test holds every level list to it. */
export const SLOT_ORDER: FeatCategory[] = ['ancestry', 'class', 'skill', 'general', 'bonus', 'impulse', 'archetype', 'mythic'];
/** Where a category sits in a level's list: [class, skill, archetype, mythic] → mythic at [3]. */
const slotsOf = (list: readonly FeatCategory[], cat: string) => list.flatMap((c, i) => (c === cat ? [i] : []));
/** How many slots come before the block of category `r` (its SLOT_ORDER index) — where it is, or would be. */
const before = (list: readonly FeatCategory[], r: number) => list.filter((c) => SLOT_ORDER.indexOf(c) < r).length;
/**
 * The slot a key means: the nth slot of its category at its level. A drawn key is its place among that
 * category's slots; a key no slot draws counts from where the category's block is, or would be. Never
 * the index itself — that is a position in the WHOLE level list, which Paragon, Dual Class, Free
 * Archetype and Mythic all move.
 */
export const ordinalOf = (list: readonly FeatCategory[], cat: string, idx: number) => {
  const live = slotsOf(list, cat).indexOf(idx);
  return live >= 0 ? live : idx - before(list, SLOT_ORDER.indexOf(cat as FeatCategory));
};

/**
 * The picks a change takes the slot from: drawn in `prev` as the nth slot of their category at their
 * level, where `next` — WITHOUT these picks — has fewer than n+1 of them, or has that slot but its own
 * picker would no longer take the feat there while it took it in `prev`. Turning Free Archetype,
 * Mythic, Ancestry Paragon or Dual Class off names exactly these in its confirm (`requestRulesChange`)
 * and removes them on the player's yes. That ordinal is what `rekeyFeatSlots` carries every other pick
 * by, so a drawn pick is either in this list or still in a drawn slot that takes it. Lowest level first.
 *
 * The second half is Dual Class: with it on, both class slots at a level take both classes' feats, so
 * a rogue feat can sit in the fighter's FIRST slot. Counting positions alone named the fighter feat in
 * the second slot and left the rogue feat in a slot that now refuses it, looking like a normal pick.
 *
 * Worked out until nothing more goes, because a feat can carry a slot: Ultimate Flexibility in the
 * second-class slot adds a bonus slot at 20th, so Dual Class off takes that bonus slot too, and the
 * feat in it is named beside Ultimate Flexibility. Read off `next` as handed over, the bonus slot was
 * still drawn (the feat about to go was still in its picks) and its feat lost its slot unnamed.
 */
export function picksLosingSlot(prev: BuildState, next: BuildState, content: ContentDatabase): [string, string][] {
  const was = featSlotLists(prev, content);
  const drawn = Object.entries(prev.featPicks ?? {}).flatMap(([k, v]) => {
    const m = SLOT_PREFIX.exec(k);
    if (!v || m?.[0] !== k) return [];
    const nth = slotsOf(was[Number(m[1]) - 1] ?? [], m[2]).indexOf(Number(m[3]));
    return nth >= 0 ? [{ k, v, lvl: Number(m[1]), cat: m[2], nth }] : [];
  });
  const gone = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    const kept = { ...next, featPicks: Object.fromEntries(Object.entries(next.featPicks ?? {}).filter(([k]) => !gone.has(k))) };
    const now = featSlotLists(kept, content);
    for (const d of drawn) {
      if (gone.has(d.k)) continue;
      const slots = slotsOf(now[d.lvl - 1] ?? [], d.cat);
      // Kept: its slot is still drawn and still takes it — or never took it, which is not this change's doing.
      if (d.nth < slots.length && (fitsSlot(kept, content, d.k, `${d.lvl}:${d.cat}:${slots[d.nth]}`) || !fitsSlot(prev, content, d.k, d.k))) continue;
      gone.add(d.k);
      grew = true;
    }
  }
  return drawn
    .filter((d) => gone.has(d.k))
    .map((d): [string, string] => [d.k, d.v])
    .sort(([a], [z]) => parseInt(a) - parseInt(z));
}

/**
 * Would the slot's own picker take the feat at `from` in slot `to`? The test `eligibleFeatsForSlot`
 * lists by — the one the picker's "not valid for this slot" count uses — asked of the build with the
 * feat already moved, so its old key is not counted as a take of it. `from === to` asks whether the
 * slot a pick sits in takes it. A feat the content no longer has is never taken.
 */
export function fitsSlot(b: BuildState, content: ContentDatabase, from: string, to: string): boolean {
  const id = b.featPicks?.[from];
  const f = id ? content.feats[id] : undefined;
  // Through `slotRefOf` (WP7, C10): an extra place is asked as its BOOK category with its own stored key, so a
  // filled extra class place takes its feat (read raw, `extraclass` refused every feat).
  const ref = slotRefOf(to);
  if (!f || !ref || ref.key !== to) return false;
  const featPicks = { ...b.featPicks };
  delete featPicks[from];
  featPicks[to] = f.id;
  return slotTakes({ ...b, featPicks }, content, ref)(f);
}

/**
 * Where "Move to slot" puts a feat with no slot: the first EMPTY slot of its kind at its level that
 * takes it (`fitsSlot`). A slot of its kind that would refuse it is never offered — moving a rogue feat
 * left over from a changed second class into the fighter's own class slot turned a flagged feat into a
 * pick that looked legitimate. A slot a live "Remove a place" removes is never offered (WP6, C17): it is not
 * drawn. An extra place's pick (WP7, C8/C10) is never moved into a book slot: it is drawn in its own place's card,
 * and with no readable block it stays a feat with no slot (Remove only), as on every older app. null: no such
 * slot, so the row offers Remove only.
 */
export function moveTargetFor(b: BuildState, content: ContentDatabase, from: string): string | null {
  const ref = slotRefOf(from);
  if (!ref || ref.key !== from || ref.place) return null;
  const removed = removedSlotKeys(b, content);
  for (const i of slotsOf(slotListAt(b, content, ref.level), ref.category)) {
    const to = `${ref.level}:${ref.category}:${i}`;
    if (!removed.has(to) && !b.featPicks[to] && fitsSlot(b, content, from, to)) return to;
  }
  return null;
}

/**
 * Swap everything keyed under two slot keys: the pick and every answer made under it (SLOT_KEYED).
 * The Builder's "Move to slot" for a feat with no slot (to the slot `moveTargetFor` names): the feat takes the empty slot with its own
 * answers, and whatever a cleared slot left there (`setFeat` clears only `featChoices`) takes the old
 * key — nothing is merged into the moved feat, and nothing is dropped.
 */
export function swapSlotKeys(b: BuildState, x: string, y: string): Partial<BuildState> {
  const swap = (k: string) => {
    const m = SLOT_PREFIX.exec(k)?.[0];
    return m === x ? y + k.slice(x.length) : m === y ? x + k.slice(y.length) : k;
  };
  const swapSlot = (s: string) => (s === x ? y : s === y ? x : s);
  const maps = [...new Set<keyof BuildState>([...SLOT_KEYED, ...VARIANT_KEYED])];
  return Object.fromEntries(
    maps
      .filter((f) => b[f])
      .map((f) => [f, Object.fromEntries(Object.entries(b[f] as Record<string, unknown>).map(([k, v]) => [moveVariantSlot(swap(k), swapSlot), v]))]),
  );
}

/**
 * Keep every pick in ITS slot when a change moves the slots under it.
 *
 * A slot key is `<level>:<category>:<index in that level's slot list>` — every saved character uses
 * it, so it stays. But the index is a position in a list other choices build: Free Archetype pushes
 * 'archetype' BEFORE 'mythic', so turning it off moved a level-2 mythic slot from 2:mythic:3 to
 * 2:mythic:2 and the mythic feat was left under a key no slot draws — still on the sheet, gone from
 * the Builder, its slot shown empty. The same shift comes from Ancestry Paragon (ancestry slots at
 * the front), Dual Class / a second class (a second class slot), the fighter's Ultimate Flexibility
 * pick (a bonus slot before archetype/mythic at 20th), a class change, and a campaign's defaults
 * changing several at once.
 *
 * So after ANY change, each slot-keyed answer is moved from its place in `prev`'s list to the slot
 * with the same (level, category, ordinal within that category) in `next`'s. Nothing is ever dropped
 * here: a toggle turned off removes the picks that lose their slot through its confirm, on the
 * player's yes (`picksLosingSlot`, `requestRulesChange`) — before this runs.
 *
 * Nothing is moved into ANOTHER slot either. A pick with no slot in `next` (Ultimate Flexibility
 * removed, a second class changed, a key v0.1.40 stranded — it had no re-keying, so Free Archetype,
 * Paragon or Dual Class off left the picks after the removed slot one index too far) keeps a key that
 * means "the nth slot of this category": where its slot would sit, after every category `levelGrants`
 * puts before it (SLOT_ORDER), plus its ordinal. It moves with that spot like any drawn pick, and
 * meanwhile the Builder lists it at its level as a feat with no slot, with Remove and Move to slot.
 *
 * It IS back in that slot, with no dialog, when a change draws the slot again — but only when the
 * slot's own picker takes it there (`fitsSlot`). A dedication v0.1.40 left at 2:archetype:2 is back in
 * the free slot on Free Archetype on, so turning it off again names it and removes it; a mythic feat
 * v0.1.40 left behind on Mythic off is back on Mythic on. One the slot would refuse (a rogue feat from
 * a second class since changed, when a ranger's slot comes back at that position) steps past the drawn
 * slots and stays a feat with no slot. A key sitting BEFORE its category's block (a slot v0.1.40 added
 * ahead of it) keeps its key; when a change draws that key again (Paragon off), the same test decides.
 *
 * A pick whose slot is still drawn keeps it even when that slot no longer takes it (a second class
 * changed under a rogue feat in the fighter's slot): nothing is written for it, and the Builder flags
 * it in its slot as not valid there, from the live build, whatever change or save put it there.
 *
 * Picks with no slot, then answers under a key that holds NO pick (a cleared slot keeps its spell,
 * Lore and effect answers, because `setFeat` clears only `featChoices`) and keys of a category no
 * level lists, move last. Each takes the key it would have had; if another now holds that key, or it
 * is a drawn slot that would refuse the pick, it steps to the next free index of its own category
 * that no slot draws, so no two keys' answers are ever merged.
 */
export function rekeyFeatSlots(prev: BuildState, next: BuildState, content: ContentDatabase): BuildState {
  if (prev === next) return next;
  const was = featSlotLists(prev, content);
  const now = featSlotLists(next, content);
  if (JSON.stringify(was) === JSON.stringify(now)) return next;
  // No class on one side: there is no slot list to read a key against, so nothing moves.
  if (!was.some((l) => l.length) || !now.some((l) => l.length)) return next;

  const bases = new Set<string>();
  for (const f of SLOT_KEYED) for (const k of Object.keys(next[f] ?? {})) {
    const m = SLOT_PREFIX.exec(k);
    if (m) bases.add(m[0]);
  }
  const to = new Map<string, string>();
  // [base, the key it would have] for every pick `next` draws no slot for…
  const rest: [string, string][] = [];
  // …and for every answer that holds no pick, or has an unknown category.
  const stale: [string, string][] = [];
  for (const base of bases) {
    const [, lvl, cat, idx] = SLOT_PREFIX.exec(base)!;
    const r = SLOT_ORDER.indexOf(cat as FeatCategory);
    if (r < 0) {
      stale.push([base, base]);
      continue;
    }
    const p = was[Number(lvl) - 1] ?? [];
    const n = now[Number(lvl) - 1] ?? [];
    const slots = slotsOf(n, cat);
    const live = slotsOf(p, cat).indexOf(Number(idx));
    const nth = ordinalOf(p, cat, Number(idx));
    const want = nth < 0 ? base : `${lvl}:${cat}:${nth < slots.length ? slots[nth] : before(n, r) + nth}`;
    if (!next.featPicks?.[base]) stale.push([base, want]);
    else if (nth >= 0 && nth < slots.length && (live >= 0 || fitsSlot(next, content, base, want))) to.set(base, want);
    else rest.push([base, want]);
  }
  const claimed = new Set(to.values());
  const collide: [string, string][] = [];
  // A pick no slot drew in `prev`, whose key `next` draws, that the slot's own picker would refuse.
  const refused = (base: string, want: string) => {
    const [, lvl, cat, idx] = SLOT_PREFIX.exec(want)!;
    return !!next.featPicks?.[base] && slotsOf(now[Number(lvl) - 1] ?? [], cat).includes(Number(idx)) && !fitsSlot(next, content, base, want);
  };
  for (const [base, want] of [...rest, ...stale]) {
    if (claimed.has(want) || refused(base, want)) {
      collide.push([base, want]);
      continue;
    }
    to.set(base, want);
    claimed.add(want);
  }
  for (const [base, want] of collide) {
    const [, lvl, cat, idx] = SLOT_PREFIX.exec(want)!;
    // Past the drawn slots too: stepping into an empty one would put the pick (or its left-over
    // answers) in a slot nobody chose it for.
    const drawn = slotsOf(now[Number(lvl) - 1] ?? [], cat);
    let j = Number(idx);
    while (claimed.has(`${lvl}:${cat}:${j}`) || drawn.includes(j)) j++;
    to.set(base, `${lvl}:${cat}:${j}`);
    claimed.add(`${lvl}:${cat}:${j}`);
  }
  if ([...to].every(([a, b]) => a === b)) return next;

  const out: BuildState = { ...next };
  const moveSlot = (s: string) => to.get(s) ?? s;
  for (const f of SLOT_KEYED) {
    const map = next[f];
    if (!map) continue;
    out[f] = Object.fromEntries(
      Object.entries(map).map(([k, v]) => {
        const m = SLOT_PREFIX.exec(k);
        return [moveVariantSlot(m ? to.get(m[0])! + k.slice(m[0].length) : k, moveSlot), v];
      }),
    );
  }
  // A later taking's answer keyed by its granting slot after `#` (VARIANT_KEYED) moves with that slot.
  if (next.grantedFeatChoices) {
    out.grantedFeatChoices = Object.fromEntries(Object.entries(next.grantedFeatChoices).map(([k, v]) => [moveVariantSlot(k, moveSlot), v]));
  }
  return out;
}

/** The Adopted Ancestry feat id — the one pick that widens somebody else's ancestry-feat slot. */
const ADOPTED_ANCESTRY = 'adopted-ancestry';

/**
 * The ancestries Adopted Ancestry has opened, at or below `level`.
 *
 * Read from BOTH stores because the feat arrives two ways: picked in a general slot, where the answer
 * is `featChoices[slotKey]`; or GRANTED — As in Life, So in Death grants it — and a granted feat's
 * sub-choice lives in `grantedFeatChoices`, keyed by the granted feat.
 *
 * An ancestry id IS the trait its feats carry: measured across all 50 ancestries in core.json, every
 * id matches at least one feat trait, so no id-to-trait table is needed and none can go stale.
 *
 * Level-gated on the slot the feat sits in, so adopting an ancestry at 15th does not retroactively
 * widen the 1st-level ancestry slot. A feat GIVEN through Tweaks counts the same way (case D): its answer
 * under `override:adopted-ancestry`, from its start level.
 */
export function adoptedAncestryIds(build: BuildState, content: ContentDatabase, level: number): string[] {
  const out: string[] = [];
  const push = (v: string | undefined) => {
    // The character's OWN ancestry is never a legal answer to "choose ANOTHER ancestry", and adding it
    // here would be a no-op that reads as though the feat did something.
    if (v && content.ancestries[v] && v !== build.ancestryId && !out.includes(v)) out.push(v);
  };
  for (const { slotKey, featId, level: at } of heldFeatSlots(build, level)) {
    if (featId !== ADOPTED_ANCESTRY) continue;
    if (at > level) continue;
    push(build.featChoices?.[slotKey]);
  }
  push(build.grantedFeatChoices?.[ADOPTED_ANCESTRY]);
  return out;
}

/**
 * Feats eligible for a given slot: right category + level, not already taken as many times as it may
 * be (once for most feats; up to maxTakes() for a repeatable one like Armor Proficiency), and — for
 * ancestry/class feats — gated to the chosen ancestry/class by trait. `content` decides the pool:
 * pass the source-FILTERED db for what the picker offers, or the FULL db to judge slot-validity
 * independently of source books.
 */
export function eligibleFeatsForSlot(build: BuildState, content: ContentDatabase, p: FeatSlotRef): Feat[] {
  const takes = slotTakes(build, content, p);
  // Skip `aon-` scrapes that duplicate a canonical feat of the same name — they would offer the
  // SAME feat twice in one picker. They stay in the db, so a feat already picked still resolves
  // (and `fitsSlot` still finds it taken by its slot).
  return Object.values(content.feats).filter((f) => !content.duplicateIds?.has(f.id) && takes(f));
}

/**
 * Does slot `p` take feat f? The one test behind the picker's list and `fitsSlot`. Tweaks phase 2 (WP5, C22): the
 * book's refusals (`slotRefusal`) less what a LIVE "Pick from any list" lifts (`anyListLifts`) — taken only when
 * every refusal can be lifted AND is. A character with no such tweak gets exactly the book's answer
 * (test/tweaks-p2-slot-sweep.test.ts holds every slot of the sweep characters to the pre-WP5 lists).
 */
function slotTakes(build: BuildState, content: ContentDatabase, p: FeatSlotRef): (f: Feat) => boolean {
  const refuse = slotRefusal(build, content, p);
  const lifts = anyListLifts(build);
  return (f) => liftedAll(refuse(f), lifts.get(f.id));
}

/**
 * EVERY rule slot `p` refuses feat f for (Tweaks phase 2, WP5, C22) — an empty list is the book's "yes". The same
 * tests `slotTakes` always ran, in the same order: the level, "only at 1st level" and the cap first, then the
 * place's list — ONE `list` refusal, with the words of the first test that fails (a general feat in a class slot
 * is "A general feat, not a class feat", never also "Not a Fighter feat"). A fighter bonus slot's own level cap is
 * the `level` rule; a mythic or impulse slot's rule is `slotRule`, not liftable (C18: `mythicSlotAllows` and
 * `kineticSlotAllows` mix the list with the one-destiny and element rules).
 */
export function slotRefusal(build: BuildState, content: ContentDatabase, p: FeatSlotRef): (f: Feat) => SlotRefusal[] {
  const listTest = slotListTest(build, content, p);
  // The slot's own stored key (WP7, C10): an extra place's `<level>:extra<category>:<n>` is not `featSlotKey(p)`.
  const taken = takenElsewhere(build, content, p.key ?? featSlotKey(p));
  const levelCap = p.category === 'bonus' ? (p.level === 20 ? 18 : p.level - 1) : p.level;
  return (f) => {
    const out: SlotRefusal[] = [];
    if (f.level > levelCap) out.push(refusal('level', levelWords(f.level, levelCap)));
    if (f.onlyAtLevel != null && p.level !== f.onlyAtLevel) out.push(refusal('onlyAtLevel', onlyAtWords(f.onlyAtLevel)));
    // The cap is the book's plus a LIVE "Take a feat more times" (WP8, C23: `takesAllowed`, the featPicks loop's own).
    const cap = takesAllowed(f.id, content, build, f);
    if ((taken.all.get(f.id) ?? 0) >= cap) {
      // WP7 step 6b (finding 18): the copy that makes the cap sits in an extra place that does not count now.
      const at = (taken.live.get(f.id) ?? 0) < cap ? taken.heldBack.get(f.id) : undefined;
      // `heldBack`'s key is the place's own slot key: its words follow that place's own block (paused vs Tweaks off).
      out.push(refusal('taken', at === undefined ? TAKEN_WORDS : heldBackPlaceWords(build, at)));
    }
    const list = listTest(f);
    if (list) out.push(list);
    return out;
  };
}

/** How many times each feat is held OUTSIDE slot `currentKey`: `all` in the STORAGE view (WP7, C9: a paused extra
 *  place's copy still takes the cap, or resuming it would break the pick), `live` in the live view, and `heldBack`
 *  the slot key of the first held-back place holding it (the refusal's words). */
interface TakenElsewhere {
  all: Map<string, number>;
  live: Map<string, number>;
  heldBack: Map<string, string>;
}
/** The "Already taken" refusal's words when the copy that makes the cap counts now (a copy held back only by a paused
 *  extra place has `heldBackPlaceWords` instead): the one "Already taken" row "Take again" is offered on (WP8, D4). */
export const TAKEN_WORDS = 'Already taken';

/**
 * How many copies of `featId` the build holds against its take cap (Tweaks phase 2, WP8): exactly what
 * `slotRefusal`'s "Already taken" counts — every feat slot and extra place in the STORAGE view (a paused place's copy
 * is still the player's, C9), a given feat no slot holds, a background's granted feat. The one counter behind the
 * Tweaks row's "taken N of M" and the count's floor (never below the copies used), so the two cannot disagree.
 */
export function featCopiesHeld(build: BuildState, content: ContentDatabase, featId: string): number {
  return takenElsewhere(build, content, '').all.get(featId) ?? 0;
}

function takenElsewhere(build: BuildState, content: ContentDatabase, currentKey: string): TakenElsewhere {
  // Count takes in OTHER slots; a feat is hidden here once those already reach its cap. A repeatable
  // feat therefore stays offered until the whole build holds maxTakes() copies of it.
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  const all = new Map<string, number>();
  // …and a feat GIVEN through Tweaks is held too (case D): it counts against its cap like a pick in
  // another slot. Never this slot's own key — a given feat's `override:<id>` key is no slot.
  // WP8 round 4 (F1): `feats` — a given copy beside a slot copy counts while a live "Take a feat more times" leaves
  // room (`givenCopyCounts`, the given-feat rule buildCharacter reads), with the feat's own book cap.
  const stored = heldFeatSlots(build, undefined, { includePaused: true, feats: content.feats });
  for (const { slotKey: k, featId: v } of stored) if (k !== currentKey) bump(all, v);
  const granted = backgroundGrantedFeats(resolveBackground(build, content), build.backgroundSkillChoice);
  for (const id of granted) bump(all, id);
  // No held-back place (every character without a paused extra place): the two views are one list.
  if (!heldBackPlaceKeys(build).size) return { all, live: all, heldBack: new Map() };
  const live = new Map<string, number>();
  const heldBack = new Map<string, string>();
  for (const { slotKey: k, featId: v } of heldFeatSlots(build, undefined, { feats: content.feats })) if (k !== currentKey) bump(live, v);
  for (const id of granted) bump(live, id);
  for (const e of stored) {
    if (e.via === 'slot' && e.slotKey !== currentKey && !placeLiveForKey(build, e.slotKey) && !heldBack.has(e.featId)) heldBack.set(e.featId, e.slotKey);
  }
  return { all, live, heldBack };
}

/*
 * The level and "only at" rules (`slotRefusal`, above): a feat's level is a FLOOR. "**Special** You can select this
 * feat only at 1st level." is an equality: 28 records print that clause and nothing in the app could say it, so
 * Bestial Manifestation — a permanent unarmed attack chosen once — was offerable in a 5th, 9th, 13th or 17th-level
 * ancestry slot. 27 of the 28 are authored. `nocturnal-grippli` is NOT: it ships as category `general`, and general
 * slots start at 3rd, so an equality on 1 would make it takeable in no slot at all. scripts/scan-choice-sets.mjs
 * carries it as an EXEMPT row with that reason.
 */

/** Slot `p`'s LIST test — category, ancestry, class, the archetype / bonus / mythic / impulse places: the first
 *  refusal, or null. The level and the cap are `slotRefusal`'s. */
function slotListTest(build: BuildState, content: ContentDatabase, p: FeatSlotRef): (f: Feat) => SlotRefusal | null {
  // An extra impulse place (WP7, C10) is not one of the gate's bound pair: it takes either element's impulse
  // (`anyElement`); its `idx` is its 6-digit n, no ordinal. A book slot asks exactly as before.
  const impulseNth = p.category === 'impulse' && !p.place ? ordinalOf(slotListAt(build, content, p.level), 'impulse', p.idx) : -1;
  const kinetic = p.place ? { anyElement: true } : undefined;
  // Read once per slot, not once per feat the picker asks about.
  let adopted: string[] | undefined;
  const adoptedHere = () => (adopted ??= adoptedAncestryIds(build, content, p.level));
  const list = (words: string) => refusal('list', words);
  return (f) => {
    // Free Archetype slot: any archetype feat (these are stored as class-category feats carrying the
    // 'archetype' trait, so match on the trait rather than the category).
    if (p.category === 'archetype') return f.traits.includes('archetype') ? null : list('Not an archetype feat');
    /*
     * Mythic slot. NOT simply "any mythic-trait feat", which broke the printed rule three ways:
     *   - the 12th-level slot MUST buy a destiny dedication ("they must use their extra feat to take
     *     the 12th-level destiny feat for a mythic destiny"), and offered every mythic feat instead;
     *   - a slot above 12 offered feats belonging to destinies the character does not have, so one
     *     could accumulate a second — "Characters can have only one mythic destiny";
     *   - Mortal Herald, which its own rules page names as a destiny, ships with no `mythic` trait,
     *     so the 14th destiny was unreachable from the one slot the rules say must buy it.
     */
    if (p.category === 'mythic') return mythicSlotAllows(f, p.level, build.mythicDestiny, content) ? null : refusal('slotRule', 'Not a feat this mythic place takes');
    /*
     * Fighter Combat Flexibility (L9) / Improved Flexibility (L15) / Ultimate Flexibility (L20).
     *
     * These SHORT-CIRCUIT the category test, exactly as archetype and mythic slots do, because "you
     * gain a fighter feat" means a fighter feat — which ships as category 'class'. Matching category
     * against 'bonus' offered NOTHING: the 14 records that happen to carry category 'bonus' are not
     * fighter feats, and the 70 fighter feats of 8th level or lower are all category 'class'. Both
     * flexibility slots were unfillable.
     *
     * The cap is the slot's level minus one (≤8 at 9, ≤14 at 15) except at 20, where Ultimate
     * Flexibility prints "up to 18th level" rather than 19 — `slotRefusal`'s level rule for this place.
     */
    if (p.category === 'bonus') return f.traits.includes('fighter') ? null : list('Not a fighter feat');
    /*
     * A KINETIC GATE slot takes an impulse feat — and a DUAL gate binds one slot to each element:
     * *"select two 1st-level impulse feats, one with the trait of the first element and one with the
     * trait of the other."* Offering both elements in both slots would let a dual-gate kineticist take
     * two impulses of the same element, which that sentence forbids. A single gate's two slots both take
     * its one element: *"select two 1st-level impulse feats that have that element's trait."*
     *
     * The FIRST impulse slot takes the first element: its place among the impulse slots at its level
     * (`ordinalOf`). It was the slot's index in the whole level list modulo two, so Ancestry Paragon's
     * second ancestry slot or Dual Class's second class slot in front of the pair swapped the elements:
     * correctly placed impulses were flagged, and Paragon off named and removed both.
     *
     * The elements are the GATE's, read at the slot's level: an element forked in at a Gate's Threshold
     * made the list three long (or two for a single gate) and moved the binding the same way.
     */
    if (p.category === 'impulse') {
      /* SHORT-CIRCUITS the category test below, exactly as the archetype, mythic and bonus slots do:
       * an impulse feat ships as category 'class', so matching category against 'impulse' offers
       * nothing and the slot would be unfillable. The element rules (`kineticSlotAllows`, build.ts)
       * ask `impulseAllowedFor` too: without it a single gate offered all six elements. The rebuild
       * from a character asks the same function before it slots an imported impulse. */
      return kineticSlotAllows(f.traits, build, p, impulseNth, kinetic) ? null : refusal('slotRule', 'Not an impulse this gate place takes');
    }
    /*
     * A CLASS slot takes an ARCHETYPE feat. RAW an archetype feat is bought with a class feat, so a
     * class slot that refused them made every archetype unreachable from the slot that pays for it.
     */
    if (p.category === 'class' && f.category === 'archetype' && f.traits.includes('archetype')) return null;
    /*
     * A class feature may NARROW a skill-feat slot rather than grant it. The investigator's Skillful
     * Lessons gives bonus skill feats, and *"the feat must be one for an Intelligence-, Wisdom-, or
     * Charisma-based skill, or for the skill you gained from your methodology."*
     *
     * Applied while LISTING, because that is where the restriction is felt: the printed rule is about
     * which feats the slot may hold. A feat that names no skill at all (Assurance, Dubious Knowledge)
     * stays legal — the clause restricts which skill a skill feat may be FOR, and a feat that is for
     * no particular skill is not excluded by it.
     */
    // The class's narrowing is of ITS OWN skill-feat slots at those levels; an extra skill place a tweak adds is not
    // one of them (WP7: each place category offers that category's list).
    const restrict = content.classes[build.classId ?? '']?.restrictedSkillFeatLevels;
    if (restrict && p.category === 'skill' && !p.place && restrict.levels.includes(p.level)) {
      const named = skillKeysOfFeat(f);
      if (named.length) {
        const allowed = new Set<string>(restrict.skills ?? []);
        if (restrict.abilities?.length) {
          for (const s of SKILLS) if (restrict.abilities.includes(skillAbility(s))) allowed.add(s);
        }
        /*
         * *"…or the trained skill from your swashbuckler's STYLE"* / *"…or for the skill you gained from
         * your METHODOLOGY"* — which skill is legal depends on a pick the character made, so no static
         * `skills` list can hold it. `includeSubclassGrantedSkills` shipped declared (types.ts) and
         * authored (swashbuckler) but READ NOWHERE, so the swashbuckler's allowed set was {acrobatics}
         * alone: a Braggart could not spend a Stylish Tricks slot on an Intimidation feat, which is the
         * one thing the printed rule reserves that slot for. Wanderer's Guide narrows neither half.
         */
        if (restrict.includeSubclassGrantedSkills) {
          const restrictCls = content.classes[build.classId ?? ''];
          const restrictSub = restrictCls?.subclass?.options.find((o) => o.id === build.subclassId);
          for (const s of restrictSub?.grants?.skills ?? []) allowed.add(s);
        }
        if (!named.some((k) => allowed.has(k))) return list("Not for one of this place's skills");
      }
    }
    // A general feat slot may take any qualifying SKILL feat (skill feats are a subset of general
    // feats). The reverse is not true — a skill slot takes only skill feats.
    if (f.category !== p.category && !(p.category === 'general' && f.category === 'skill'))
      return list(categoryWords(f.category, p.category));
    // An ancestry slot takes your ancestry's feats — AND, if you took a VERSATILE heritage, that
    // heritage's own feats. A versatile heritage (nephilim, dragonblood, dhampir, …) has
    // `ancestryId: null` and its feats carry the HERITAGE's trait, not an ancestry's. Gating on
    // ancestryId alone made several hundred perfectly-modelled feats unreachable by anyone: this
    // file did not contain the word "heritage" at all.
    if (p.category === 'ancestry' && build.ancestryId) {
      const her = build.heritageId ? content.heritages[build.heritageId] : undefined;
      const ok =
        f.traits.includes(build.ancestryId) ||
        /*
         * A versatile heritage's feats are matched by its id AND by its own traits. Five heritages
         * ship an importer-prefixed id — aon-aasimar, aon-ifrit, aon-tiefling, aon-aphorite,
         * aon-ganzi — while their feats carry the bare trait (aasimar, ifrit, tiefling, …), so the
         * id test matched NOTHING and 66 ancestry feats were reachable by no character at all:
         * aasimar 20, ifrit 23, tiefling 16 (Beastbrood among them), aphorite 5, ganzi 2.
         * Nephilim passed only because its id and its trait are the same string.
         *
         * Measured over all 22 versatile heritages before writing this: adding the traits gains
         * exactly those 66 and changes nothing else. Hungerseed is NOT one of them — its own id
         * matches 11 feats and its `oni` trait matches none — and `geniekin` (Suli) and
         * `amphibious` (Undine) are likewise carried by zero feats, so none of the three moves.
         */
        (her?.versatile && (f.traits.includes(her.id) || (her.traits ?? []).some((t) => f.traits.includes(t)))) ||
        // ADOPTED ANCESTRY — "You can select ancestry feats from the ancestry you chose, in addition
        // to your character's own ancestry." The pick was recorded and widened nothing, at any level.
        adoptedHere().some((a) => f.traits.includes(a)) ||
        // …and a heritage that opens ANOTHER ancestry's list: "you can select elf, half-elf, and
        // human feats whenever you gain an ancestry feat" (half-elf, half-orc).
        (her?.extraAncestryFeatTraits ?? []).some((t) => f.traits.includes(t)) ||
        // UNIVERSAL ANCESTRY — a feat ANY ancestry may take (the six Impossible Lands fey feats).
        // The trait IS that rule and belongs to no ancestry, so a gate that only ever asked "does
        // this carry my ancestry's trait" could never admit one.
        f.traits.includes('universal-ancestry');
      if (!ok) return list(notOursWords(f, content.ancestries, build.ancestryId));
    }
    // Class slots take your class's feats OR any archetype feat (multiclass/archetypes). Dual Class
    // also accepts the second class's feats.
    //
    // …and a DEVIANT or AFTERMATH ability, once the GM has switched them on. Dark Archive grants
    // both as class feats and their records carry no class trait at all ("GMs can use the rules here
    // to GRANT these so-called deviant abilities to their players"; aftermath is "special abilities
    // gained after exposure to the weird and deadly"), so all 41 were readable and un-takeable.
    //
    // …and the four PERVASIVE MAGIC feats, which belong to the Secrets of Magic variant where every
    // character picks up minor spellcasting. They are a variant-rule ladder, not class feats, so they
    // ride that toggle rather than a class trait.
    if (
      p.category === 'class' &&
      build.classId &&
      !f.traits.includes(build.classId) &&
      !(build.variantRules?.dualClass && build.classId2 && f.traits.includes(build.classId2)) &&
      !f.traits.includes('archetype') &&
      !(build.deviantEnabled && (f.traits.includes('deviant') || f.traits.includes('aftermath'))) &&
      !(build.variantRules?.pervasiveMagic && f.traits.includes('pervasive-magic'))
    )
      return list(notOursWords(f, content.classes, build.classId));
    // Kineticist impulses are gated to the elements of your kinetic gate (incl. elements gained via
    // Fork the Path, and the ones an ARCHETYPE kineticist named on their dedication).
    //
    // No class check: `elementTraitsOf` is empty for anyone with no elements, and `impulseAllowedFor`
    // then admits everything, so the guard the class check used to provide is the element list itself.
    // Keeping the check would have re-created the bug it was written beside — an archetype kineticist
    // has elements and was skipped by it.
    return kineticSlotAllows(f.traits, build, p, impulseNth) ? null : refusal('slotRule', 'An impulse of an element you have no gate for');
  };
}

/**
 * Every rule the slot `to` refuses the feat at `from` for, read as `fitsSlot` reads it (the build with the feat
 * moved) and WITHOUT any tweak — the book's own words for a filled card (WP5: the paused mark, the book note). null:
 * no such feat, or `to` is not a slot key.
 */
export function slotBookRefusals(b: BuildState, content: ContentDatabase, from: string, to: string = from): SlotRefusal[] | null {
  const id = b.featPicks?.[from];
  const f = id ? content.feats[id] : undefined;
  const ref = slotRefOf(to);
  if (!f || !ref || ref.key !== to) return null;
  const featPicks = { ...b.featPicks };
  delete featPicks[from];
  featPicks[to] = f.id;
  return slotRefusal({ ...b, featPicks }, content, ref)(f);
}

export interface HiddenFeatMatches {
  /** Slot-valid feats hidden ONLY because their source book is disabled — revealable by enabling
   *  the book, so the picker renders them greyed with the book's name. Sorted level→name. */
  sources: Feat[];
  /** Slot-valid archetype feats hidden behind the class-slot "Archetypes" toggle. */
  archetype: number;
  /** Slot-valid feats hidden by a campaign toggle (Mythic / Kingmaker) on the Setup page. */
  campaign: number;
  /** Matches that can never appear in this slot (wrong type, level too high, already taken). */
  invalid: number;
  /** `invalid` split by the rule that refuses each (its first `slotRefusal`; WP5), when `refusalOf` was given.
   *  A feat refused for no rule (the "unexpected residue" below) counts under none. */
  invalidByRule?: Partial<Record<SlotRule, number>>;
  /** Of `invalid`, the feats "Take again" would be offered for under "Search every feat" (`takeAgainOf`; WP8). */
  takeAgain?: number;
  total: number;
}

/**
 * Classify the feats that match a picker search but are hidden from the current feat-slot picker.
 * `query` is matched against name+description — the same haystack as the picker's search box — so
 * the reported counts agree with what the visible search does. Returns null for an empty query or
 * when nothing relevant is hidden.
 */
export function findHiddenFeatMatches(opts: {
  query: string;
  /** The FULL (override-applied, source-unfiltered) feat pool — what the Overrides picker browses. */
  allFeats: Feat[];
  /** Ids the picker is currently offering (post source-filter + archetype toggle). */
  shownIds: Set<string>;
  /** Ids valid for this slot when judged against the FULL pool. */
  slotEligibleIds: Set<string>;
  /** The character's enabled source books (see enabledBookSet). */
  enabledBooks: Set<string>;
  mythicEnabled?: boolean;
  kingmakerEnabled?: boolean;
  deviantEnabled?: boolean;
  pervasiveMagic?: boolean;
  /** True for a class slot with the Archetypes toggle off. */
  archetypesHidden: boolean;
  /** The slot's book refusals (`slotRefusal`): splits `invalid` by rule (WP5). */
  refusalOf?: (f: Feat) => readonly SlotRefusal[];
  /** Would the picker offer "Take again" for this feat (WP8)? Counted into `takeAgain` for the note's pointer. */
  takeAgainOf?: (f: Feat) => boolean;
}): HiddenFeatMatches | null {
  const q = opts.query.trim().toLowerCase();
  if (!q) return null;
  const sources: Feat[] = [];
  let archetype = 0;
  let campaign = 0;
  let invalid = 0;
  let takeAgain = 0;
  const byRule: Partial<Record<SlotRule, number>> = {};
  const countRule = (f: Feat) => {
    const rule = opts.refusalOf?.(f)[0]?.rule;
    if (rule) byRule[rule] = (byRule[rule] ?? 0) + 1;
    if (opts.takeAgainOf?.(f)) takeAgain++;
  };
  for (const f of opts.allFeats) {
    if (opts.shownIds.has(f.id)) continue;
    // bug 2026-09-13: search-rank — the SAME rule the picker's own filter uses (FilterableSelect's
    // text field), or this note would count "water skin" as zero hidden matches while the picker
    // itself is showing rows for it.
    // …including the names the feat's page was printed under before (filterSpecs.ts `searchText`).
    if (!searchMatches(q, f.name, [f.description, ...(f.legacyNames ?? [])].join('\n'))) continue;
    if (!opts.slotEligibleIds.has(f.id)) {
      invalid++;
      countRule(f);
    } else if (
      // Mirrors applyContentToggles: these stay hidden even with every source book enabled.
      (!opts.mythicEnabled && f.traits.includes('mythic')) ||
      (!opts.kingmakerEnabled && /kingmaker/i.test(f.source?.book ?? '')) ||
      (!opts.deviantEnabled && (f.traits.includes('deviant') || f.traits.includes('aftermath'))) ||
      (!opts.pervasiveMagic && f.traits.includes('pervasive-magic'))
    ) {
      campaign++;
    } else if (opts.archetypesHidden && f.traits.includes('archetype')) {
      // Check the archetype-toggle reason BEFORE the disabled-book reason: an archetype feat from a
      // non-Core book, viewed in a class slot with Archetypes OFF, would otherwise be reported as
      // "enable book…" — but enabling the book can't reveal it (the archetype filter still hides it).
      // Tell the user to enable Archetypes, which is the actual gate.
      archetype++;
    } else {
      if (!entrySourceOn(opts.enabledBooks, f)) sources.push(f);
      else invalid++; // unexpected residue — count it honestly rather than dropping it
    }
  }
  const total = sources.length + archetype + campaign + invalid;
  if (total === 0) return null;
  sources.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { sources, archetype, campaign, invalid, ...(opts.refusalOf ? { invalidByRule: byRule } : {}), ...(opts.takeAgainOf ? { takeAgain } : {}), total };
}
