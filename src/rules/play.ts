/*
 * Play state — the mutable, in-play runtime layer.
 *
 * buildCharacter() is pure: it turns build choices into a derived Character, and
 * it re-runs from scratch whenever the build is edited. So anything that changes
 * DURING PLAY (damage taken, hero points spent, XP gained) must live OUTSIDE the
 * built character, or an edit would wipe it. PlayState is that layer: stored
 * alongside the build, overlaid onto the snapshot at render time, and untouched
 * by a rebuild.
 *
 * HP lost is stored as `damage` (not a current value) so that if max HP later
 * changes — a Con boost, a level-up — the character stays as hurt as they were,
 * rather than the current value silently desyncing from the new max.
 */
import type { AbilityId, ActiveCondition, Character, CharacterAppearance, CharacterDetails, CharacterImage, Coins, CompanionConfig, ContentDatabase, InventoryItem, ItemDesignation, ItemImbuement, ItemPassiveEffects, ItemMonsterPart, ModeDef, NotePage, PinnedDesc, PreparedSlot, RestrictedSlot, SpellcastingEntry } from './types';
import { resolveRestrictedSlots } from './restrictedSlots';
import { deriveMaxHp, deriveBulk, dailyChoiceGrants, ownedFeatureIds } from './derive';
import { FORMULA_BOOK_ITEM_ID, formulaBooks, grantsFormulaBook, withFormula } from './formulaBook';
import { adjustModes } from './modes';
import { monsterPartApex } from './monsterParts';
import { dyingDeathThreshold } from './conditions';
import { coinsToCp, cpToCoins } from './wealth';

/** The maximum hero points a character can hold (the rail shows three pips). */
export const MAX_HERO_POINTS = 3;
export const MAX_MYTHIC_POINTS = 3;

export interface PlayState {
  /** HP lost from max; current = max - damage, clamped to [0, max]. */
  damage: number;
  /** Temporary HP (a separate pool that absorbs damage first). */
  tempHp: number;
  /**
   * The mode id whose battle form granted the CURRENT temporary HP pool, when one did.
   *
   * Ownership, not bookkeeping: without it, leaving a form would either strand 40 temporary Hit Points
   * the character no longer has, or delete a pool that came from somewhere else entirely. Cleared the
   * moment the player sets the pool themselves or spends it, because from then on it is not the
   * form's to take back.
   */
  tempHpFrom?: string;
  /** Damage dealt to the wielded shield's HP (Shield Block / repair); clamped to its max. */
  shieldDamage?: number;
  /** Temporary land-Speed override in feet; when set, the sheet shows + highlights this
   *  in place of the derived Speed until it's reset to the default. */
  tempSpeed?: number;
  /** In-play appearance overrides (portrait, avatar crop, gallery, accent), merged over the build's.
   *  See CharacterAppearance. */
  appearance?: CharacterAppearance;
  /** Hero points currently held, 0..MAX_HERO_POINTS. */
  heroPoints: number;
  /** Mythic points currently held, 0..MAX_MYTHIC_POINTS (only meaningful when the character is mythic). */
  mythicPoints?: number;
  /** Total experience points toward the next level. */
  xp: number;
  /** Focus points spent; current = focus.max - focusUsed. */
  focusUsed: number;
  /** Prepared slots that have been cast, keyed `${entryId}:${rank}:${slotIndex}`. */
  expendedSlots: Record<string, boolean>;
  /** Spontaneous slot-pool usage (count per rank), keyed `${entryId}:${rank}`. */
  slotsUsed: Record<string, number>;
  /** Innate spells cast today (1/day each), keyed `${entryId}:${spellId}`; refilled on rest. */
  innateUsed?: Record<string, boolean>;
  /** Conditions currently affecting the character. */
  conditions: ActiveCondition[];
  /** In-play inventory; when set, it overrides the build's gear (so the sheet can add/drop/equip). */
  inventory?: InventoryItem[];
  /** In-play wallet; when set, it overrides the build's starting currency. */
  currency?: Coins;
  /** Pinned/favorited activity keys (Main-tab favorites). */
  pinned: string[];
  /** Favorited description popups (starred from any description page). */
  pinnedDescs?: PinnedDesc[];
  /** Class signature resource values by id (Rage 0/1, Infused Reagents count, …). */
  resources?: Record<string, number>;
  /** Alchemist: infused alchemical items on hand (itemId → quantity) — Advanced Alchemy daily prep +
   *  Quick Alchemy. Rendered as a usable list; using one decrements its quantity. */
  alchemyPrep?: Record<string, number>;
  /**
   * Answers to choices re-made at daily preparations, keyed `${recordId}:${flag}` — Environmental
   * Adaptability's cold-or-heat, Mask of Power's spell. Play state rather than build state because
   * they are chosen afresh each morning and must be able to change without editing the character.
   * An entry persisting across a rest is exactly what the "reuse my last pick" setting relies on.
   */
  dailyChoices?: Record<string, string>;
  /**
   * The temporary item each `dailyTemporaryItems` slot holds today (a scroll's spell id, or an item
   * id), keyed by slot. Like `dailyChoices` these persist across a rest so the player can keep
   * yesterday's picks — the items themselves are temporary, but the ANSWER is the thing worth
   * keeping, and re-picking three scrolls every morning would be worse than confirming them.
   */
  dailyItems?: Record<string, string>;
  /**
   * Uses SPENT against a feat's `limitedUses`, keyed by feat id. Feats with "once per day" had no
   * tracking at all — only items did — so the player had to remember them. Reset by rest() alongside
   * focus points and spell slots; sub-daily periods (round/turn/minute/hour) reset there too, since
   * a rest is the coarsest boundary the sheet models.
   */
  featUses?: Record<string, number>;
  /** Rituals the character has LEARNED in play, by spell id. Rituals are tradition-less by rule, so
   *  148 of the 151 are on no spell list and had no route onto the sheet except Setup → Overrides —
   *  the rule-BREAKING panel — for an ordinary thing a character does. */
  knownRituals?: string[];
  /**
   * Formula-book grant slots already spent, `slotKey` → the item id written into the book.
   *
   * The SPENT LEDGER, and the reason it is here rather than on the book: a formula grant is a
   * ONE-TIME WRITE. Once a slot appears here it never offers itself again, so destroying the book —
   * which destroys `InventoryItem.formulas` with it — loses the formulas permanently instead of
   * letting the granting record hand them over a second time.
   */
  formulaPicks?: Record<string, string>;
  /** Set once the character has been handed the formula book their records grant, so deleting that
   *  book is a decision the app respects rather than one it undoes on the next mutation. */
  formulaBookGranted?: boolean;
  /* An item's "choose one of N" answer lives on the INVENTORY INSTANCE (InventoryItem.effectChoices),
   * not here, so two copies of the same item can differ. */
  /** Notes pages; when set, overrides the build's notes (so the sheet can edit them). */
  notes?: NotePage[];
  /** Conditions on each companion, keyed by companion id. */
  companionConditions?: Record<string, ActiveCondition[]>;
  /** Tracked HP per companion: damage taken + temp HP (current = max − damage), by companion id. */
  companionHp?: Record<string, { damage: number; temp: number }>;
  /** Ids of active modes per companion, keyed by companion id (mirrors `activeModes` for the PC). */
  companionModes?: Record<string, string[]>;
  /** In-play companions; when set, overrides the build's (so the Companions tab can add/remove). */
  companions?: CompanionConfig[];
  /** In-play edits to bio fields (alignment, age, appearance, …), merged over the build's details. */
  details?: Partial<CharacterDetails>;
  /** Ids of active modes (toggleable modifier sets); resolved against content.modes. */
  activeModes?: string[];
  /** Slug of the single active stance (exclusive by construction); resolved against content.stances. */
  activeStance?: string;
  /** In-play preparation overrides for prepared casters, keyed `${entryId}:${rank}:${slotIndex}`.
   *  A spell id replaces the build's prepared spell; null = a deliberately emptied slot;
   *  an absent key keeps the build's preparation. */
  preparedSpells?: Record<string, string | null>;
  /** In-play repertoire override for spontaneous casters: entryId → rank → known spell ids. */
  repertoireSpells?: Record<string, Record<number, string[]>>;
  /** In-play signature-spell override for spontaneous casters: entryId → spell ids. */
  signatureSpells?: Record<string, string[]>;
  /** Spells added by the Learn a Spell activity: entryId → rank → spell ids. Permanent knowledge
   *  rather than a daily choice, so this survives both a night's rest and a rebuild. */
  learnedSpells?: Record<string, Record<number, string[]>>;
  /** Commander tactics prepared today (subset of the folio, up to preparedMax); reset on rest. */
  preparedTactics?: string[];
  /**
   * Spell Blending trades made during this morning's preparation, per spellcasting entry.
   *
   * A ledger of references, not a rewritten slot table: slot counts stay build-derived, and a trade
   * only names which indices it consumed. That is what keeps `preparedSpells`/`expendedSlots` — both
   * keyed by slot INDEX — pointing at the same slots they always did.
   */
  spellTrades?: Record<string, SpellTrade[]>;
  /** Restricted slots whose rank the player chooses at daily preparations (Sin Reservoir), keyed by
   *  the slot's own id. What is prepared INTO them rides in `preparedSpells` under the same id. */
  restrictedSlotRanks?: Record<string, number>;
}

/** One Spell Blending trade: `indices` slots of rank `from` spent for a bonus slot of rank `to`
 *  (or, when `to` is CANTRIP_TRADE, for two additional cantrips). */
export interface SpellTrade {
  from: number;
  to: number;
  /** The exact source slots consumed — stored so the marking is stable across renders. */
  indices: number[];
}

/** A toggleable per-item carry state. */
export type ItemFlag = 'worn' | 'equipped' | 'invested';

/** The sheet's play-state mutation dispatcher. Every call is its own undo step UNLESS the caller
 *  passes a `coalesceTag`: rapid successive calls sharing the same tag (scrubbing a +/- stepper,
 *  typing into a per-keystroke field) merge into ONE step. Distinct actions must stay untagged so
 *  they never merge (equip + rest must be two Ctrl+Zs). */
export type PlayUpdater = (fn: (play: PlayState) => PlayState, coalesceTag?: string) => void;

/** Stable key for one prepared slot (entry + rank + slot index). */
export const preparedKey = (entryId: string, rank: number, slotIndex: number) => `${entryId}:${rank}:${slotIndex}`;
/** Stable key for a spontaneous rank's slot pool. */
export const poolKey = (entryId: string, rank: number) => `${entryId}:${rank}`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The value of a (valued) condition in a list, or 0 if absent. */
const condVal = (list: ActiveCondition[] | undefined, id: string): number => (list ?? []).find((c) => c.id === id)?.value ?? 0;

/** A fresh, undamaged play state (one hero point, as a new day begins). */
export function emptyPlay(): PlayState {
  return { damage: 0, tempHp: 0, heroPoints: 1, mythicPoints: MAX_MYTHIC_POINTS, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [] };
}

/**
 * Seed a play state from a built character's starting values, so the first in-play
 * edit continues from where the build left off (full HP, the granted hero point,
 * an unspent focus pool, no slots cast).
 */
export function initialPlay(ch: Character, content: ContentDatabase): PlayState {
  const max = deriveMaxHp(ch, content);
  const expendedSlots: Record<string, boolean> = {};
  const slotsUsed: Record<string, number> = {};
  const innateUsed: Record<string, boolean> = {};
  for (const e of ch.spellcasting ?? []) {
    if (e.prepared)
      for (const [rankStr, slots] of Object.entries(e.prepared))
        slots.forEach((s, i) => {
          if (s.expended) expendedSlots[preparedKey(e.id, Number(rankStr), i)] = true;
        });
    if (e.slots)
      for (const [rankStr, pool] of Object.entries(e.slots))
        if (pool.used) slotsUsed[poolKey(e.id, Number(rankStr))] = pool.used;
    // Seed already-cast innate spells (e.g. from a Wanderer's Guide import) so the first play
    // mutation doesn't silently reset them — applyPlayState treats play.innateUsed as authoritative.
    for (const spellId of e.innateUsed ?? []) innateUsed[`${e.id}:${spellId}`] = true;
  }
  return {
    damage: clamp(max - ch.hitPoints.current, 0, max),
    tempHp: Math.max(0, ch.hitPoints.temp),
    heroPoints: clamp(ch.heroPoints, 0, MAX_HERO_POINTS),
    mythicPoints: clamp(ch.mythicPoints ?? MAX_MYTHIC_POINTS, 0, MAX_MYTHIC_POINTS),
    xp: Math.max(0, ch.xp),
    focusUsed: ch.focus ? clamp(ch.focus.max - ch.focus.current, 0, ch.focus.max) : 0,
    expendedSlots,
    slotsUsed,
    ...(Object.keys(innateUsed).length ? { innateUsed } : {}),
    conditions: (ch.conditions ?? []).map((c) => ({ ...c })),
    inventory: (ch.inventory ?? []).map((i) => ({ ...i })),
    currency: { ...ch.currency },
    pinned: ch.pinned ?? [],
    pinnedDescs: ch.pinnedDescs ? ch.pinnedDescs.map((d) => ({ ...d })) : [],
    resources: { ...(ch.classResources ?? {}) },
    notes: (ch.notes ?? []).map((p) => ({ ...p })),
    companions: (ch.companions ?? []).map((c) => ({ ...c })),
    // The build's formula picks are already inside the book this copied, so they seed as SPENT —
    // reconcileFormulaBook must not write them a second time.
    ...(ch.formulaPicks ? { formulaPicks: { ...ch.formulaPicks } } : {}),
  };
}

/** The attribute raised by the first INVESTED regular apex item in the inventory (item.apexAttribute,
 *  from the Foundry apex data), or null. Investiture is the gate — a carried-but-uninvested apex item
 *  does nothing — and only the first qualifying item applies (one apex item at a time). */
export function itemApex(inventory: InventoryItem[] | undefined, content: ContentDatabase): AbilityId | null {
  for (const inv of inventory ?? []) {
    if (!inv.invested) continue;
    const apex = content.items[inv.itemId]?.apexAttribute;
    if (apex) return apex;
  }
  return null;
}

/** Overlay the in-play runtime values onto a freshly-built (snapshot) character. */
export function applyPlayState(ch: Character, play: PlayState | undefined, content: ContentDatabase): Character {
  if (!play) return ch;
  // A regular apex item (an invested item with an apexAttribute, e.g. Belt of Giant Strength) raises
  // one attribute (to 18, or +2 if already 18+). Bump it on the overlaid character so it ripples
  // through every derived stat (HP, saves, skills…). Only one apex item works at a time — the first
  // wins. Under Automatic Bonus Progression, apex items grant NO attribute benefit (build.ts already
  // applies the ABP attribute apex at level 17), so this overlay must do nothing — otherwise it
  // double-boosts.
  const abpOn = !!ch.variantRules?.abp;
  // Regular apex item OR a Monster-Parts apex-property item (Str/Dex/Con/Int/Wis/Cha at property level
  // 17+). Only one apex works at a time — the regular apex item wins if both are present. Under ABP,
  // apex items grant no attribute benefit (build.ts applied the ABP attribute apex), so skip both.
  const apexInv = play.inventory ?? ch.inventory;
  const apexAbility = abpOn
    ? null
    : itemApex(apexInv, content) ?? (ch.variantRules?.monsterParts ? monsterPartApex(apexInv, ch.level) : null);
  if (apexAbility) {
    const score = ch.abilities[apexAbility];
    ch = { ...ch, abilities: { ...ch.abilities, [apexAbility]: score >= 18 ? score + 2 : 18 } };
  }
  // Tolerate play states persisted before these fields existed (forward migration).
  const expended = play.expendedSlots ?? {};
  const used = play.slotsUsed ?? {};
  const focusUsed = play.focusUsed ?? 0;
  let conditions = play.conditions ?? ch.conditions;
  // Carrying more than your Bulk limit applies the Encumbered condition (clumsy 1, −10 ft Speed) —
  // unless the "Ignore Bulk Limit" option is on. Derived from the live inventory so it tracks gear.
  if (!ch.options?.ignoreBulk && !conditions.some((c) => c.id === 'encumbered')) {
    const bulk = deriveBulk({ ...ch, inventory: play.inventory ?? ch.inventory }, content);
    if (bulk.encTotal > bulk.encumberedAt) conditions = [...conditions, { id: 'encumbered' }];
  }
  // Max HP must reflect the overlaid conditions (Drained lowers it), so the
  // damage clamp below uses the same max the sheet will display.
  const max = deriveMaxHp({ ...ch, conditions }, content);
  // A mode grant with no `entryId` lands on the character's own slot caster, the same default the
  // build-time applier uses.
  const mainCasterId = (ch.spellcasting ?? []).find((e) => e.type === 'spontaneous' || e.type === 'prepared')?.id;
  const spellcasting = (ch.spellcasting ?? []).map((e) => {
    let out = e;
    const isMainCaster = e.id === mainCasterId;
    if (e.prepared) {
      const prepared: Record<number, PreparedSlot[]> = {};
      // Spell Blending. Stale trades are dropped rather than applied: investing a Ring of Wizardry or
      // levelling up changes the slot arrays in PLAY, without ever passing through playForRebuild, so
      // a recorded index can outlive the slot it named.
      const trades = (play.spellTrades?.[e.id] ?? []).filter(
        (t) => e.prepared?.[t.from] && t.indices.every((i) => i < (e.prepared?.[t.from]?.length ?? 0)) && (t.to === CANTRIP_TRADE || !!e.prepared?.[t.to]),
      );
      const tradedAt = new Map<number, Set<number>>();
      for (const t of trades) {
        const set = tradedAt.get(t.from) ?? new Set<number>();
        for (const i of t.indices) set.add(i);
        tradedAt.set(t.from, set);
      }
      for (const [rankStr, slots] of Object.entries(e.prepared)) {
        const rank = Number(rankStr);
        const spent = tradedAt.get(rank);
        prepared[rank] = slots.map((s, i) => {
          const key = preparedKey(e.id, rank, i);
          const override = play.preparedSpells?.[key];
          // A traded slot is not a slot you have today: it renders greyed and casts nothing.
          if (spent?.has(i)) return { ...s, spellId: null, expended: false, traded: true };
          return { ...s, spellId: override !== undefined ? override : s.spellId, expended: !!expended[key] };
        });
      }
      // Bonus slots are APPENDED, so no existing index moves. Their key comes from the source rank,
      // not their position, so removing another trade cannot renumber them.
      for (const t of trades) {
        if (t.to === CANTRIP_TRADE || !prepared[t.to]) continue;
        const key = bonusSlotKey(e.id, t.to, t.from);
        prepared[t.to] = [
          ...prepared[t.to],
          { spellId: play.preparedSpells?.[key] ?? null, expended: !!expended[key], bonusFrom: t.from },
        ];
      }
      out = { ...out, prepared };
      // "trade any spell slot for two additional cantrips" — openings on the OVERLAY only, never on
      // the stored character, so the builder's known-cantrip cap survives a round-trip untouched.
      // Keyed at rank 0, which prepared slots never use, so the keys cannot collide with a real slot.
      const extra = trades.filter((t) => t.to === CANTRIP_TRADE).length * CANTRIPS_PER_TRADE;
      if (extra) {
        out = {
          ...out,
          tradedCantrips: Array.from({ length: extra }, (_, i) => play.preparedSpells?.[cantripTradeKey(e.id, i)] ?? null),
        };
      }
    }
    if (e.slots) {
      const slots: Record<number, { max: number; used: number }> = {};
      for (const [rankStr, pool] of Object.entries(e.slots)) {
        const rank = Number(rankStr);
        slots[rank] = { ...pool, used: clamp(used[poolKey(e.id, rank)] ?? 0, 0, pool.max) };
      }
      out = { ...out, slots };
    }
    if (e.repertoire) {
      const repOverride = play.repertoireSpells?.[e.id];
      let repertoire = e.repertoire;
      if (repOverride) {
        repertoire = {};
        for (const rankStr of Object.keys(e.repertoire)) {
          const rank = Number(rankStr);
          repertoire[rank] = repOverride[rank] ?? e.repertoire[rank];
        }
      }
      /*
       * The player's ★ picks ADD to the record's granted signature spells; they never replace them.
       * This was `play.signatureSpells?.[e.id] ?? e.signature`, so the moment the entry had a stored
       * list at all, the authored one stopped being consulted — a granted signature ("you treat the
       * field of life halcyon spell as a signature spell", an animist's whole apparition repertoire)
       * was shadowed permanently, including any the record gained afterwards. A grant is a rule, not
       * a preference; only the player's own half is theirs to edit.
       */
      const granted = e.signature ?? [];
      const chosen = play.signatureSpells?.[e.id];
      out = {
        ...out,
        repertoire,
        signature: chosen ? [...new Set([...granted, ...chosen])] : e.signature,
        signatureFixed: granted.length ? granted : undefined,
      };
    }
    /*
     * Learn a Spell. "A spell you learn is added to your repository of spells, such as a spellbook for
     * a wizard… If you have a spell repertoire, such as a bard, it's not automatically added since you
     * can only know a limited number of spells. Instead, you can select it when you add or swap spells."
     *
     * So a spellbook caster's learned spells are merged into the spellbook — that IS the repository, and
     * merging is what makes them preparable — while a repertoire caster's stay in `learned`, offered to
     * the repertoire picker rather than silently pushed past the known-spells cap.
     */
    const learned = play.learnedSpells?.[e.id];
    if (learned && Object.values(learned).some((ids) => ids.length > 0)) {
      out = { ...out, learned };
      if (out.spellbook) {
        const spellbook: Record<number, string[]> = { ...out.spellbook };
        for (const [rankStr, ids] of Object.entries(learned)) {
          const rank = Number(rankStr);
          const have = spellbook[rank] ?? [];
          spellbook[rank] = [...have, ...ids.filter((id) => !have.includes(id))];
        }
        out = { ...out, spellbook };
      }
    }
    if (e.font) {
      out = {
        ...out,
        font: { ...e.font, expended: Array.from({ length: e.font.slots }, (_, i) => !!expended[`${e.id}:font:${i}`]) },
      };
    }
    // A lit Candle of Invocation grants its two slots through a MODE, because the item's own
    // spellSlotBonus only fires for invested items and a candle is a consumable you light. Resolved
    // here rather than at build time for the same reason: the toggle is play state.
    const modeSlots: RestrictedSlot[] = [];
    for (const [i, mid] of (play.activeModes ?? []).entries()) {
      const g = content.modes[mid]?.spellSlotBonus;
      if (!g?.restricted) continue;
      const target = g.entryId ?? (isMainCaster ? e.id : null);
      if (target !== e.id) continue;
      modeSlots.push(...resolveRestrictedSlots(g.restricted, e, ch.level, `m${i}`, undefined, content));
    }
    const baseRestricted = [...(e.restrictedSlots ?? []), ...modeSlots];
    if (baseRestricted.length) {
      const resolved = baseRestricted.map((s) => {
        // The chosen rank is stored under the slot's OWN id, so re-picking one slot's rank cannot
        // disturb another's — the same reasoning as the bonus slots keyed off their source rank.
        const picked = play.restrictedSlotRanks?.[s.id];
        const moved = picked != null && picked !== s.rank && (s.rankOptions ?? []).includes(picked);
        const rank = moved ? picked : s.rank;
        // Moving the slot empties it: what was prepared there was chosen for the old rank and may
        // be a spell the slot can no longer hold.
        const spellId = moved ? null : play.preparedSpells?.[s.id] ?? s.spellId;
        // A Spell Combination slot holds a SECOND spell, stored under a `#2` key so it rides the same
        // preparedSpells map (and the same rank-move clearing) as the first.
        const spellId2 = s.pairs ? (moved ? null : play.preparedSpells?.[`${s.id}#2`] ?? s.spellId2 ?? null) : undefined;
        return { ...s, rank, spellId, ...(s.pairs ? { spellId2 } : {}), expended: !!expended[s.id] };
      });
      out = { ...out, restrictedSlots: resolved };
      /*
       * A group that CONVERTS rather than adds — Master Summoner: "you can designate one of your
       * spell slots to become two summoning slots of the same spell rank". The ordinary slot it
       * spends is deducted HERE rather than at build time, because a rank-choice group can be moved
       * at daily preparations and the cost has to follow the group to its new rank.
       */
      const cost: Record<number, number> = {};
      for (const s of resolved) if (s.costsSlot) cost[s.rank] = (cost[s.rank] ?? 0) + s.costsSlot;
      for (const [rankStr, n] of Object.entries(cost)) {
        const rank = Number(rankStr);
        if (out.slots?.[rank]) {
          const pool = out.slots[rank];
          out = { ...out, slots: { ...out.slots, [rank]: { ...pool, max: Math.max(0, pool.max - n) } } };
        } else if (out.prepared?.[rank]) {
          out = { ...out, prepared: { ...out.prepared, [rank]: out.prepared[rank].slice(0, Math.max(0, out.prepared[rank].length - n)) } };
        }
      }
    }
    if (e.type === 'innate') {
      const used = play.innateUsed ?? {};
      out = { ...out, innateUsed: Object.keys(used).filter((k) => used[k] && k.startsWith(`${e.id}:`)).map((k) => k.slice(e.id.length + 1)) };
    }
    return out;
  });
  // Spells BORROWED this morning (Loaner Spell). They cannot come from the build — the answer is
  // re-made nightly — so they are appended to the innate entry here, or given one of their own when
  // the character has no innate spells at all.
  {
    const borrowed: { spellId: string; uses: number }[] = [];
    for (const g of dailyChoiceGrants({ ...ch, dailyChoices: play.dailyChoices }, content))
      for (const s of g.innateSpells ?? []) if (content.spells[s.spellId]) borrowed.push({ spellId: s.spellId, uses: s.usesPerDay ?? 1 });
    if (borrowed.length) {
      const i = spellcasting.findIndex((e) => e.id === 'innate-casting');
      const base: SpellcastingEntry =
        i >= 0
          ? spellcasting[i]
          : {
              id: 'innate-casting',
              name: 'Innate spells',
              type: 'innate',
              tradition: spellcasting[0]?.tradition ?? 'arcane',
              keyAbility: spellcasting[0]?.keyAbility ?? 'cha',
              proficiency: spellcasting[0]?.proficiency ?? 'trained',
              cantrips: [],
              repertoire: {},
            };
      const repertoire: Record<number, string[]> = { ...(base.repertoire ?? {}) };
      const innateUses = { ...(base.innateUses ?? {}) };
      const spellSources = { ...(base.spellSources ?? {}) };
      for (const b of borrowed) {
        const rank = content.spells[b.spellId].rank ?? 0;
        if (rank <= 0) continue;
        if (!(repertoire[rank] ??= []).includes(b.spellId)) repertoire[rank].push(b.spellId);
        if (b.uses !== 1) innateUses[b.spellId] = b.uses;
        spellSources[b.spellId] = 'Borrowed today';
      }
      const merged = { ...base, repertoire, ...(Object.keys(innateUses).length ? { innateUses } : {}), spellSources };
      if (i >= 0) spellcasting[i] = merged;
      else spellcasting.push(merged);
    }
  }
  /*
   * Share Eidolon Magic: "You can cast the innate spells your eidolon gained from Magical Understudy,
   * Magical Adept, and Magical Master. You and your eidolon share the same daily uses of these."
   *
   * Built here rather than at build time because half the answer lives in PLAY state — the eidolon's
   * cantrips are chosen on the Companions tab — and because "the same daily uses" means ONE pool: the
   * spells join the summoner's own innate entry, whose uses the sheet already tracks. Until now the
   * eidolon's magic existed only on its stat block and on two feats marked "Recorded only".
   */
  if (ch.feats?.some((f) => f.featId === 'share-eidolon-magic')) {
    const eidolon = (play.companions ?? ch.companions ?? []).find((c) => c.kind === 'eidolon');
    const cantrips = (eidolon?.eidolon?.cantrips ?? []).filter((id): id is string => !!id && !!content.spells[id]);
    const leveled = (ch.eidolonInnateSpells ?? []).filter((id) => content.spells[id]);
    if (cantrips.length || leveled.length) {
      const i = spellcasting.findIndex((e) => e.id === 'innate-casting');
      const base: SpellcastingEntry =
        i >= 0
          ? spellcasting[i]
          : {
              id: 'innate-casting',
              name: 'Innate spells',
              type: 'innate',
              tradition: spellcasting[0]?.tradition ?? 'arcane',
              keyAbility: spellcasting[0]?.keyAbility ?? 'cha',
              proficiency: spellcasting[0]?.proficiency ?? 'trained',
              cantrips: [],
              repertoire: {},
            };
      const repertoire: Record<number, string[]> = { ...(base.repertoire ?? {}) };
      const spellSources = { ...(base.spellSources ?? {}) };
      for (const id of leveled) {
        const rank = content.spells[id].rank ?? 0;
        if (rank <= 0) continue;
        if (!(repertoire[rank] ??= []).includes(id)) repertoire[rank].push(id);
        spellSources[id] = "Eidolon's magic";
      }
      for (const id of cantrips) spellSources[id] = "Eidolon's magic";
      const merged = {
        ...base,
        cantrips: [...new Set([...(base.cantrips ?? []), ...cantrips])],
        repertoire,
        spellSources,
      };
      if (i >= 0) spellcasting[i] = merged;
      else spellcasting.push(merged);
    }
  }
  // Languages recalled at DAILY PREPARATIONS (Ancestral Linguistics), overlaid the same way the
  // borrowed spell above is. They cannot come from the build — the answer is re-made nightly — and
  // they MUST not: the sentence that grants one continues "Since this knowledge is temporary, you
  // can't use it as a prerequisite for a permanent character option", and the built character is what
  // a prerequisite would be read from. Kept as their own list too, so the pills can say it lapses
  // instead of rendering identically to a language you actually know.
  const dailyLanguages = [
    ...new Set(
      dailyChoiceGrants({ ...ch, dailyChoices: play.dailyChoices }, content)
        .flatMap((g) => g.grantsLanguages ?? [])
        .filter((id) => content.languages?.[id] && !(ch.languages ?? []).includes(id)),
    ),
  ];
  const focus = ch.focus ? { ...ch.focus, current: clamp(ch.focus.max - focusUsed, 0, ch.focus.max) } : ch.focus;
  return {
    ...ch,
    xp: Math.max(0, play.xp),
    heroPoints: clamp(play.heroPoints, 0, MAX_HERO_POINTS),
    mythicPoints: clamp(play.mythicPoints ?? MAX_MYTHIC_POINTS, 0, MAX_MYTHIC_POINTS),
    hitPoints: {
      ...ch.hitPoints,
      current: clamp(max - play.damage, 0, max),
      temp: Math.max(0, play.tempHp),
    },
    shieldDamage: Math.max(0, play.shieldDamage ?? 0),
    speedOverride: play.tempSpeed,
    conditions,
    inventory: play.inventory ?? ch.inventory,
    // An item bought in PLAY can carry a "choose one of N" whose answer lives in play state, so the
    // picked option's item bonuses are merged here. buildCharacter already does the same for items in
    // build.inventory; without this half, a question asked on the sheet could never change anything.
    resolvedItemPassives: resolvePlayItemPassives(ch, play, content),
    currency: play.currency ?? ch.currency,
    pinned: play.pinned ?? ch.pinned ?? [],
    pinnedDescs: play.pinnedDescs ?? ch.pinnedDescs ?? [],
    classResources: play.resources ?? ch.classResources ?? {},
    alchemyPrep: play.alchemyPrep ?? ch.alchemyPrep,
    dailyChoices: play.dailyChoices ?? ch.dailyChoices,
    ...(dailyLanguages.length ? { languages: [...(ch.languages ?? []), ...dailyLanguages], dailyLanguages } : {}),
    dailyItems: play.dailyItems ?? ch.dailyItems,
    featUses: play.featUses ?? ch.featUses,
    formulaPicks: play.formulaPicks ?? ch.formulaPicks,
    ...(play.knownRituals?.length ? { knownRituals: play.knownRituals } : {}),
    notes: play.notes ?? ch.notes,
    companionConditions: play.companionConditions ?? ch.companionConditions ?? {},
    companionHp: play.companionHp ?? ch.companionHp ?? {},
    companions: play.companions ?? ch.companions,
    details: play.details ? { ...ch.details, ...play.details } : ch.details,
    appearance: play.appearance ? { ...ch.appearance, ...play.appearance } : ch.appearance,
    // A feat can CHANGE a mode before anything reads it (Extend Elixir doubles the duration, Perfect
    // Mutagen drops the drawback). Applied here, where a mode id becomes the live object, so every
    // reader downstream sees the adjusted version instead of each one having to remember to adjust.
    // Class FEATURES rewrite modes too — Blessed Swiftness and the regalia benefits each add a line
    // to an aura they did not create (Principle C) — and their ids live in ownedFeatureIds, never in
    // ch.feats, so leaving them out made those records write-only.
    activeModes: adjustModes(
      (play.activeModes ?? []).map((id) => content.modes[id]).filter(Boolean),
      ch.feats ?? [],
      content,
      ownedFeatureIds(ch, content),
    ),
    activeStance: play.activeStance && content.stances?.[play.activeStance] ? play.activeStance : undefined,
    companionModes: Object.fromEntries(
      Object.entries(play.companionModes ?? {}).map(([cid, ids]) => [cid, ids.map((id) => content.modes[id]).filter(Boolean)]),
    ),
    focus,
    spellcasting,
    commanderTactics: ch.commanderTactics
      ? {
          ...ch.commanderTactics,
          prepared: (play.preparedTactics ?? [])
            .filter((id) => ch.commanderTactics!.folio.includes(id))
            .slice(0, ch.commanderTactics.preparedMax),
        }
      : ch.commanderTactics,
  };
}

/** Apply N damage: temp HP soaks first, the remainder becomes real damage.
 *  `deathBase` is the dying value at which this character dies before Doomed is applied — 5 with
 *  Diehard, else 4. Pass `character.dyingThreshold`. */
export function applyDamage(play: PlayState, amount: number, max: number, deathBase = 4): PlayState {
  const n = Math.max(0, Math.round(amount));
  const soaked = Math.min(play.tempHp, n);
  const toHp = n - soaked;
  const damage = clamp(play.damage + toHp, 0, max);
  const tempHp = play.tempHp - soaked;
  // A pool spent to nothing is no longer the form's to take back — otherwise leaving the form would
  // "remove" temporary Hit Points that are already gone, which is harmless today and a live bug the
  // moment anything else writes to the pool.
  let next: PlayState = { ...play, tempHp, ...(tempHp === 0 ? { tempHpFrom: undefined } : {}), damage, conditions: play.conditions ?? [] };
  // Reduced to 0 HP → knocked out and Dying (PF2e). The Dying value gained is
  // 1 + your Wounded value (or +1 if already Dying); a single blow ≥ 2× max HP is
  // instant death. The Dying tracker / Heal then drive recovery.
  if (n > 0 && max > 0 && max - damage <= 0) {
    const deathAt = dyingDeathThreshold(condVal(next.conditions, 'doomed'), deathBase);
    const dying = condVal(next.conditions, 'dying');
    const value =
      n >= 2 * max ? deathAt : dying > 0 ? Math.min(deathAt, dying + 1) : Math.min(deathAt, 1 + condVal(next.conditions, 'wounded'));
    next = setCondition(next, 'dying', value);
  }
  return next;
}

/** Heal N HP (reduces damage; never refills temp HP — that's a separate grant). */
export function applyHeal(play: PlayState, amount: number, max: number): PlayState {
  const n = Math.max(0, Math.round(amount));
  const damage = clamp(play.damage - n, 0, max);
  let next: PlayState = { ...play, damage, conditions: play.conditions ?? [] };
  // Restored to 1+ HP while Dying → you lose Dying and become Wounded (recoverFromDying
  // applies the Dying→Wounded bump; manual clears do not).
  if (n > 0 && max - damage >= 1 && condVal(next.conditions, 'dying') > 0) {
    next = { ...next, conditions: recoverFromDying(next.conditions) };
  }
  return next;
}

/** Set current HP directly to a value (clicking the HP number to edit it), clamped to [0, max]. */
export function setHp(play: PlayState, value: number, max: number): PlayState {
  return { ...play, damage: clamp(max - Math.round(value), 0, max) };
}

/** Set hero points directly (clicking the pips), clamped to the legal range. */
export function setHeroPoints(play: PlayState, value: number): PlayState {
  return { ...play, heroPoints: clamp(value, 0, MAX_HERO_POINTS) };
}

export function setMythicPoints(play: PlayState, value: number): PlayState {
  return { ...play, mythicPoints: clamp(value, 0, MAX_MYTHIC_POINTS) };
}

/** Set the temporary-HP pool directly (never negative). Clears the battle-form claim on it: once the
 *  player has typed a number in, leaving the form must not wipe what they set. */
export function setTempHp(play: PlayState, value: number): PlayState {
  return { ...play, tempHp: Math.max(0, Math.round(value)), tempHpFrom: undefined };
}

/** Set damage dealt to the wielded shield, clamped to [0, maxHp]. Current shield HP =
 *  maxHp − shieldDamage. (A night's rest does NOT repair a shield — that needs Repair.) */
export function setShieldDamage(play: PlayState, value: number, maxHp: number): PlayState {
  return { ...play, shieldDamage: clamp(Math.round(value), 0, maxHp) };
}

/** Set a temporary land-Speed override in feet (Hasted, Slowed, difficult terrain, …).
 *  Pass undefined (or a negative) to clear it and return to the default Speed. */
export function setTempSpeed(play: PlayState, value: number | undefined): PlayState {
  if (value == null || value < 0) {
    const { tempSpeed: _drop, ...rest } = play;
    return rest;
  }
  return { ...play, tempSpeed: Math.round(value) };
}

/** Add XP (never negative). */
export function addXp(play: PlayState, amount: number): PlayState {
  return { ...play, xp: Math.max(0, play.xp + Math.round(amount)) };
}

/** Set the XP total directly (never negative). */
export function setXp(play: PlayState, value: number): PlayState {
  return { ...play, xp: Math.max(0, Math.round(value)) };
}

/** Toggle a single prepared slot between cast (expended) and ready. */
export function toggleExpended(play: PlayState, key: string): PlayState {
  const expendedSlots = { ...play.expendedSlots };
  if (expendedSlots[key]) delete expendedSlots[key];
  else expendedSlots[key] = true;
  return { ...play, expendedSlots };
}

/** Set how many slots of a spontaneous rank pool are spent, clamped to [0, max]. */
export function setSlotsUsed(play: PlayState, key: string, used: number, max: number): PlayState {
  return { ...play, slotsUsed: { ...play.slotsUsed, [key]: clamp(used, 0, max) } };
}

/** Toggle whether a 1/day innate spell has been cast today (key `${entryId}:${spellId}`). */
export function toggleInnateCast(play: PlayState, entryId: string, spellId: string): PlayState {
  const key = `${entryId}:${spellId}`;
  const innateUsed = { ...(play.innateUsed ?? {}) };
  if (innateUsed[key]) delete innateUsed[key];
  else innateUsed[key] = true;
  return { ...play, innateUsed };
}

/** Prepare (or clear) the spell in a single prepared slot, in play. `null` empties the
 *  slot; the slot's expended flag is reset, since it's freshly prepared. */
/** Prepare a spell into a restricted slot (Creed Magic, Sin Reservoir, a Candle of Invocation).
 *  These are keyed by the slot's own stable id rather than by rank+index, because the rank can move. */
export function setRestrictedSpell(play: PlayState, slotId: string, spellId: string | null): PlayState {
  const preparedSpells = { ...(play.preparedSpells ?? {}), [slotId]: spellId };
  const expendedSlots = { ...play.expendedSlots };
  delete expendedSlots[slotId];
  return { ...play, preparedSpells, expendedSlots };
}

/** Learn or forget a ritual (the Rituals section's picker). */
export function toggleKnownRitual(play: PlayState, spellId: string): PlayState {
  const have = play.knownRituals ?? [];
  return { ...play, knownRituals: have.includes(spellId) ? have.filter((x) => x !== spellId) : [...have, spellId] };
}

/** Move a restricted slot to a different rank at daily preparations. Empties it — see the overlay. */
export function setRestrictedRank(play: PlayState, slotId: string, rank: number): PlayState {
  const preparedSpells = { ...(play.preparedSpells ?? {}) };
  delete preparedSpells[slotId];
  delete preparedSpells[`${slotId}#2`]; // a paired slot's second spell moves rank with the first
  const expendedSlots = { ...play.expendedSlots };
  delete expendedSlots[slotId];
  return { ...play, restrictedSlotRanks: { ...(play.restrictedSlotRanks ?? {}), [slotId]: rank }, preparedSpells, expendedSlots };
}

export function setPreparedSpell(
  play: PlayState,
  entryId: string,
  rank: number,
  slotIndex: number,
  spellId: string | null,
  /** The slot itself, when it may be a Spell Blending bonus slot — those are keyed by the rank they
   *  were traded from rather than by position, so their spell survives undoing another trade. */
  slot?: PreparedSlot,
): PlayState {
  const key = slotKeyOf(entryId, rank, slotIndex, slot);
  const preparedSpells = { ...(play.preparedSpells ?? {}), [key]: spellId };
  const expendedSlots = { ...play.expendedSlots };
  delete expendedSlots[key];
  return { ...play, preparedSpells, expendedSlots };
}

/** Revert all in-play preparation changes for one entry back to the build's defaults. */
export function resetPreparedEntry(play: PlayState, entryId: string): PlayState {
  const prefix = `${entryId}:`;
  const preparedSpells = { ...(play.preparedSpells ?? {}) };
  const expendedSlots = { ...play.expendedSlots };
  for (const k of Object.keys(preparedSpells)) if (k.startsWith(prefix)) delete preparedSpells[k];
  for (const k of Object.keys(expendedSlots)) if (k.startsWith(prefix)) delete expendedSlots[k];
  // Trades are part of this morning's preparation too. Leaving them would restore the default spells
  // into slots the wizard traded away, and leave the bonus slots sitting there empty.
  const spellTrades = { ...(play.spellTrades ?? {}) };
  delete spellTrades[entryId];
  return { ...play, preparedSpells, expendedSlots, spellTrades };
}

/* =========================================================================
 * SPELL BLENDING (wizard arcane thesis)
 *
 * "During your daily preparations, you can trade two spell slots of the same spell rank for a bonus
 * spell slot of up to 2 spell ranks higher than the traded spell slots. You can exchange as many
 * spell slots as you have available. Bonus spell slots must be of a spell rank you can normally cast,
 * and each bonus spell slot must be of a different spell rank. You can also trade any spell slot for
 * two additional cantrips, though you can't trade more than one spell slot at a time for additional
 * cantrips in this way."
 *
 * The ledger lives in PlayState because trading is a daily-preparation act, like every sibling
 * (preparedSpells, dailyChoices, preparedTactics). Slot COUNTS stay build-derived; a trade only
 * references (rank, index) into them.
 * ========================================================================= */

/** The cantrip trade is recorded with `to: 0` — there is no rank-0 slot, so it cannot collide. */
export const CANTRIP_TRADE = 0;
/** "you can also trade ANY spell slot for two additional cantrips" — one slot in, two cantrips out. */
export const CANTRIPS_PER_TRADE = 2;

/** Key for a bonus slot. Derived from the SOURCE rank, never from its position in the array, so
 *  removing a different trade cannot renumber it and move its prepared spell. Unique because the
 *  rules allow at most one bonus slot per rank. */
export const bonusSlotKey = (entryId: string, rank: number, from: number) => `${entryId}:${rank}:b${from}`;

/** Key for a traded-cantrip opening. Rank 0 has no prepared slots, so this can never collide. */
export const cantripTradeKey = (entryId: string, index: number) => `${entryId}:0:c${index}`;

/** The key for one slot of a rendered prepared entry — a bonus slot carries its own. */
export const slotKeyOf = (entryId: string, rank: number, index: number, slot?: PreparedSlot): string =>
  slot?.bonusFrom != null ? bonusSlotKey(entryId, rank, slot.bonusFrom) : preparedKey(entryId, rank, index);

export const tradesFor = (play: PlayState, entryId: string): SpellTrade[] => play.spellTrades?.[entryId] ?? [];

/** How many slots a trade consumes: two for a bonus slot, one for the cantrip trade. */
export const tradeCost = (to: number) => (to === CANTRIP_TRADE ? 1 : 2);

/**
 * The trades currently in force, read back off the OVERLAID entry.
 *
 * The sheet is handed the already-overlaid character and never sees PlayState — and the overlay
 * carries everything needed: a bonus slot records the rank it came from, and the cantrip openings are
 * a list. Reading it back means the modal and the slot grid cannot disagree about what was traded.
 */
export function entryTrades(entry: SpellcastingEntry): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const [rankStr, slots] of Object.entries(entry.prepared ?? {})) {
    for (const s of slots) if (s.bonusFrom != null) out.push({ from: s.bonusFrom, to: Number(rankStr) });
  }
  // The cantrip trade leaves no bonus slot behind — only its openings.
  for (let i = 0; i < Math.floor((entry.tradedCantrips?.length ?? 0) / CANTRIPS_PER_TRADE); i++) {
    out.push({ from: -1, to: CANTRIP_TRADE });
  }
  return out;
}

/** Indices of `rank`'s real slots that no trade has consumed (bonus slots are never tradeable). */
export function untradedIndices(entry: SpellcastingEntry, rank: number): number[] {
  return (entry.prepared?.[rank] ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.traded && s.bonusFrom == null)
    .map(({ i }) => i);
}

/**
 * Why this trade is illegal, or null when it is allowed.
 *
 * Returned as a sentence so the modal can show it as the disabled reason — `addSpellTrade` refusing
 * silently would look like a frozen button.
 */
export function spellTradeError(entry: SpellcastingEntry, from: number, to: number): string | null {
  const prepared = entry.prepared;
  if (!prepared) return 'This caster has no prepared slots.';
  const existing = entryTrades(entry);
  if (!prepared[from]?.length) return `You have no rank-${from} slots.`;

  const cost = tradeCost(to);
  const free = untradedIndices(entry, from).length;
  if (free < cost) return `That needs ${cost} untraded rank-${from} slot${cost === 1 ? '' : 's'} — you have ${free}.`;

  if (to === CANTRIP_TRADE) {
    // "you can't trade more than one spell slot at a time for additional cantrips in this way"
    if (existing.some((t) => t.to === CANTRIP_TRADE)) return 'You can only trade one slot for cantrips.';
    return null;
  }
  if (to <= from) return 'A bonus slot must be of a higher rank than the slots you trade.';
  if (to > from + 2) return 'A bonus slot can be at most 2 ranks higher than the slots you trade.';
  // "Bonus spell slots must be of a spell rank you can normally cast" — read from the entry's own
  // slot table rather than a hand-written maximum, so the app agrees with itself by construction.
  if (!prepared[to]) return `You can't cast rank-${to} spells yet.`;
  // "each bonus spell slot must be of a different spell rank"
  if (existing.some((t) => t.to === to)) return `You already have a bonus rank-${to} slot.`;
  return null;
}

/** Trade two slots of `from` for a bonus slot of `to` (or one slot for two cantrips when `to` is 0).
 *  `entry` is the OVERLAID entry the sheet is showing, so its traded marks are already in place. */
export function addSpellTrade(play: PlayState, entry: SpellcastingEntry, from: number, to: number): PlayState {
  if (spellTradeError(entry, from, to)) return play;
  // Consume from the END, so the slots a player is most likely to have prepared keep their indices.
  const free = untradedIndices(entry, from);
  const indices = free.slice(-tradeCost(to)).sort((a, b) => a - b);

  // A traded slot keeps its index, so anything saved against it would still render — a spell in a
  // slot the wizard no longer has, or a spent pip on a slot that is gone.
  const preparedSpells = { ...(play.preparedSpells ?? {}) };
  const expendedSlots = { ...play.expendedSlots };
  for (const i of indices) {
    const k = preparedKey(entry.id, from, i);
    delete preparedSpells[k];
    delete expendedSlots[k];
  }
  const spellTrades = { ...(play.spellTrades ?? {}) };
  spellTrades[entry.id] = [...tradesFor(play, entry.id), { from, to, indices }];
  return { ...play, preparedSpells, expendedSlots, spellTrades };
}

/** Undo the trade that produced the bonus slot of rank `to` (or the cantrip trade, when 0). */
export function removeSpellTrade(play: PlayState, entryId: string, to: number): PlayState {
  const kept = tradesFor(play, entryId).filter((t) => t.to !== to);
  const spellTrades = { ...(play.spellTrades ?? {}) };
  if (kept.length) spellTrades[entryId] = kept;
  else delete spellTrades[entryId];
  // The bonus slot is going away; anything prepared into it goes with it.
  const preparedSpells = { ...(play.preparedSpells ?? {}) };
  const expendedSlots = { ...play.expendedSlots };
  for (const t of tradesFor(play, entryId)) {
    if (t.to !== to) continue;
    const k = bonusSlotKey(entryId, t.to, t.from);
    delete preparedSpells[k];
    delete expendedSlots[k];
  }
  return { ...play, preparedSpells, expendedSlots, spellTrades };
}

/** Extra cantrips the trade grants today (2 per traded slot, and at most one such trade). */
export const tradedCantripCount = (play: PlayState, entryId: string): number =>
  tradesFor(play, entryId).filter((t) => t.to === CANTRIP_TRADE).length * CANTRIPS_PER_TRADE;

/** Fill (or clear) one of the cantrip openings bought with the cantrip trade. */
export function setTradedCantrip(play: PlayState, entryId: string, index: number, spellId: string | null): PlayState {
  return { ...play, preparedSpells: { ...(play.preparedSpells ?? {}), [cantripTradeKey(entryId, index)]: spellId } };
}

/** Set a spontaneous caster's known spells for one rank, in play. */
export function setRepertoireRank(play: PlayState, entryId: string, rank: number, ids: string[]): PlayState {
  const repertoireSpells = { ...(play.repertoireSpells ?? {}) };
  repertoireSpells[entryId] = { ...(repertoireSpells[entryId] ?? {}), [rank]: ids };
  return { ...play, repertoireSpells };
}

/** Set a spontaneous caster's signature spell ids, in play. */
export function setSignatureSpells(play: PlayState, entryId: string, ids: string[]): PlayState {
  return { ...play, signatureSpells: { ...(play.signatureSpells ?? {}), [entryId]: ids } };
}

/** Record a spell learned with the Learn a Spell activity. Idempotent — learning it twice is a no-op. */
export function learnSpell(play: PlayState, entryId: string, rank: number, spellId: string): PlayState {
  const cur = play.learnedSpells?.[entryId]?.[rank] ?? [];
  if (cur.includes(spellId)) return play;
  return {
    ...play,
    learnedSpells: {
      ...(play.learnedSpells ?? {}),
      [entryId]: { ...(play.learnedSpells?.[entryId] ?? {}), [rank]: [...cur, spellId] },
    },
  };
}

/** Undo a Learn a Spell (a mis-click, or the GM ruling the check failed after all). Empty ranks and
 *  empty entries are pruned so the saved play state doesn't accumulate `{}`s. */
export function unlearnSpell(play: PlayState, entryId: string, rank: number, spellId: string): PlayState {
  const cur = play.learnedSpells?.[entryId]?.[rank] ?? [];
  if (!cur.includes(spellId)) return play;
  const forEntry: Record<number, string[]> = { ...(play.learnedSpells?.[entryId] ?? {}) };
  const next = cur.filter((id) => id !== spellId);
  if (next.length) forEntry[rank] = next;
  else delete forEntry[rank];
  const all = { ...(play.learnedSpells ?? {}) };
  if (Object.keys(forEntry).length) all[entryId] = forEntry;
  else delete all[entryId];
  return { ...play, learnedSpells: all };
}

/** Revert in-play repertoire + signature changes for one entry to the build's defaults. */
export function resetRepertoire(play: PlayState, entryId: string): PlayState {
  const repertoireSpells = { ...(play.repertoireSpells ?? {}) };
  const signatureSpells = { ...(play.signatureSpells ?? {}) };
  delete repertoireSpells[entryId];
  delete signatureSpells[entryId];
  return { ...play, repertoireSpells, signatureSpells };
}

/** Set focus points spent, clamped to [0, focus.max]. */
export function setFocusUsed(play: PlayState, used: number, max: number): PlayState {
  return { ...play, focusUsed: clamp(used, 0, max) };
}

// --- array-level condition logic (shared by the character + each companion) ---

function condAdd(list: ActiveCondition[], id: string, value?: number): ActiveCondition[] {
  if (list.some((c) => c.id === id)) return list;
  return [...list, value != null ? { id, value: Math.max(1, Math.round(value)) } : { id }];
}

/** Remove a condition from the list. This is a plain removal — it does NOT apply the
 *  Dying→Wounded bump, so that manually clearing a misapplied Dying (a misclick, or a
 *  GM removing it) doesn't wrongly add Wounded. The bump is reserved for genuine
 *  recovery (heal to 1+ HP), via recoverFromDying. */
function condRemove(list: ActiveCondition[], id: string): ActiveCondition[] {
  return list.filter((c) => c.id !== id);
}

/** Recover from Dying by being restored to 1+ HP: lose Dying and gain Wounded 1 (or
 *  +1 to an existing Wounded). Per PF2e, you become Wounded any time you lose Dying by
 *  recovering — distinct from a manual clear, which uses condRemove and does not bump. */
function recoverFromDying(list: ActiveCondition[]): ActiveCondition[] {
  let out = list.filter((c) => c.id !== 'dying');
  if (out.some((c) => c.id === 'wounded')) out = out.map((c) => (c.id === 'wounded' ? { ...c, value: (c.value ?? 1) + 1 } : c));
  else out = [...out, { id: 'wounded', value: 1 }];
  return out;
}

function condSet(list: ActiveCondition[], id: string, value: number): ActiveCondition[] {
  if (value <= 0) return condRemove(list, id);
  return list.map((c) => (c.id === id ? { ...c, value: Math.round(value) } : c));
}

/**
 * Nudge a valued condition by `delta`, reading the CURRENT value out of the state being updated.
 *
 * The stepper used to compute the new number from the value its last render saw and pass it as an
 * absolute — so two taps landing in the same frame both computed "3 + 1" and the second wrote the 4 the
 * first had already written. Frightened would sit still while you jabbed at it. Resolving the delta in
 * here means every tap counts however fast they arrive.
 */
export function stepConditionValue(play: PlayState, id: string, delta: number): PlayState {
  const cur = play.conditions.find((c) => c.id === id)?.value ?? 1;
  return setConditionValue(play, id, cur + delta);
}

/** The companion-scoped {@link stepConditionValue}. */
export function stepCompanionConditionValue(play: PlayState, compId: string, id: string, delta: number): PlayState {
  const cur = (play.companionConditions?.[compId] ?? []).find((c) => c.id === id)?.value ?? 1;
  return withCompanionConditions(play, compId, (l) => condSet(l, id, cur + delta));
}

/** Gain a condition (no-op if already present). `value` is 1+ for valued ones. */
export function addCondition(play: PlayState, id: string, value?: number): PlayState {
  return { ...play, conditions: condAdd(play.conditions, id, value) };
}

/** Remove a condition (Dying→Wounded handled). */
export function removeCondition(play: PlayState, id: string): PlayState {
  return { ...play, conditions: condRemove(play.conditions, id) };
}

/** Set a valued condition's value; a value of 0 or less removes it. */
export function setConditionValue(play: PlayState, id: string, value: number): PlayState {
  return { ...play, conditions: condSet(play.conditions, id, value) };
}

/** Set a valued condition to an exact value, ADDING it if absent (unlike
 *  setConditionValue, which only updates one already present). A value of 0 or
 *  less removes it (a plain removal — no Dying→Wounded bump; that's recovery-only). */
export function setCondition(play: PlayState, id: string, value: number): PlayState {
  if (value <= 0) return removeCondition(play, id);
  return play.conditions.some((c) => c.id === id)
    ? setConditionValue(play, id, value)
    : addCondition(play, id, value);
}

// --- companion conditions (tracked per companion id) ---

function withCompanionConditions(play: PlayState, compId: string, fn: (list: ActiveCondition[]) => ActiveCondition[]): PlayState {
  const map = play.companionConditions ?? {};
  return { ...play, companionConditions: { ...map, [compId]: fn(map[compId] ?? []) } };
}

export function addCompanionCondition(play: PlayState, compId: string, id: string, value?: number): PlayState {
  return withCompanionConditions(play, compId, (l) => condAdd(l, id, value));
}

export function removeCompanionCondition(play: PlayState, compId: string, id: string): PlayState {
  return withCompanionConditions(play, compId, (l) => condRemove(l, id));
}

export function setCompanionConditionValue(play: PlayState, compId: string, id: string, value: number): PlayState {
  return withCompanionConditions(play, compId, (l) => condSet(l, id, value));
}

/** Toggle a mode active/inactive on a single companion (mirrors {@link toggleMode} for the PC, including
 *  exclusive-group handling). */
export function toggleCompanionMode(play: PlayState, compId: string, id: string, modeDefs?: Record<string, ModeDef>): PlayState {
  const map = play.companionModes ?? {};
  const active = map[compId] ?? [];
  if (active.includes(id)) return { ...play, companionModes: { ...map, [compId]: active.filter((m) => m !== id) } };
  let next = [...active, id];
  const group = modeDefs?.[id]?.exclusiveGroup;
  if (group) next = next.filter((mid) => mid === id || modeDefs?.[mid]?.exclusiveGroup !== group);
  return { ...play, companionModes: { ...map, [compId]: next } };
}

// --- in-play companion roster (add / remove / configure from the Companions tab) ---

/** A fresh companion id (cmp-N) that won't collide with existing ids. */
function nextCompanionId(list: CompanionConfig[]): string {
  const max = list.reduce((m, c) => Math.max(m, Number(/(\d+)$/.exec(c.id)?.[1] ?? -1)), -1);
  return `cmp-${max + 1}`;
}

/** Add a companion in play (id assigned). */
export function addPlayCompanion(play: PlayState, cfg: Omit<CompanionConfig, 'id'>): PlayState {
  const list = play.companions ?? [];
  return { ...play, companions: [...list, { ...cfg, id: nextCompanionId(list) }] };
}

/** Remove a companion (and any tracked conditions/HP on it) in play. */
export function removePlayCompanion(play: PlayState, id: string): PlayState {
  const companionConditions = { ...(play.companionConditions ?? {}) };
  delete companionConditions[id];
  const companionHp = { ...(play.companionHp ?? {}) };
  delete companionHp[id];
  const companionModes = { ...(play.companionModes ?? {}) };
  delete companionModes[id];
  return { ...play, companions: (play.companions ?? []).filter((c) => c.id !== id), companionConditions, companionHp, companionModes };
}

/* ---- per-companion HP (vehicles/siege weapons track damage; creatures show current/max too) ---- */

function patchCompanionHp(play: PlayState, id: string, patch: Partial<{ damage: number; temp: number }>): PlayState {
  const map = play.companionHp ?? {};
  const cur = map[id] ?? { damage: 0, temp: 0 };
  return { ...play, companionHp: { ...map, [id]: { ...cur, ...patch } } };
}
/** Deal `amount` damage to a companion (temp HP soaks first); current = max − damage. */
export function applyCompanionDamage(play: PlayState, id: string, amount: number, max: number): PlayState {
  const cur = play.companionHp?.[id] ?? { damage: 0, temp: 0 };
  const n = Math.max(0, Math.round(amount));
  const soaked = Math.min(cur.temp, n);
  return patchCompanionHp(play, id, { temp: cur.temp - soaked, damage: clamp(cur.damage + (n - soaked), 0, max) });
}
/** Heal a companion `amount` HP (reduces tracked damage). */
export function applyCompanionHeal(play: PlayState, id: string, amount: number, max: number): PlayState {
  const cur = play.companionHp?.[id] ?? { damage: 0, temp: 0 };
  return patchCompanionHp(play, id, { damage: clamp(cur.damage - Math.max(0, Math.round(amount)), 0, max) });
}
/** Set a companion's current HP directly (clicking the number), clamped to [0, max]. */
export function setCompanionHp(play: PlayState, id: string, value: number, max: number): PlayState {
  return patchCompanionHp(play, id, { damage: clamp(max - Math.round(value), 0, max) });
}
/** Set a companion's temp-HP pool (never negative). */
export function setCompanionTempHp(play: PlayState, id: string, value: number): PlayState {
  return patchCompanionHp(play, id, { temp: Math.max(0, Math.round(value)) });
}

/** Buy a vehicle / siege weapon (or any companion) — deduct the character's coins, then add it. */
export function buyCompanion(play: PlayState, cfg: Omit<CompanionConfig, 'id'>, price: Coins | undefined): PlayState {
  if (price && !canAfford(play.currency, price)) return play;
  const next = price ? { ...play, currency: cpToCoins(coinsToCp(play.currency) - coinsToCp(price)) } : play;
  return addPlayCompanion(next, cfg);
}

/** Merge a patch into a companion in play (name / type / maturity / abilities). */
export function updatePlayCompanion(play: PlayState, id: string, patch: Partial<CompanionConfig>): PlayState {
  return { ...play, companions: (play.companions ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Patch the inventory array of one companion (helper for the companion-gear mutators below). */
function patchCompanionInventory(
  play: PlayState,
  compId: string,
  fn: (inv: InventoryItem[]) => InventoryItem[],
): PlayState {
  return {
    ...play,
    companions: (play.companions ?? []).map((c) => (c.id === compId ? { ...c, inventory: fn(c.inventory ?? []) } : c)),
  };
}

/** Add a (free) item to a companion's gear. */
export function addCompanionItem(play: PlayState, compId: string, itemId: string): PlayState {
  return patchCompanionInventory(play, compId, (inv) => [...inv, { instanceId: nextInstanceId(inv), itemId, quantity: 1 }]);
}

/** Buy an item for a companion — deduct the character's coins, then add it. */
export function buyCompanionItem(play: PlayState, compId: string, itemId: string, price: Coins | undefined): PlayState {
  if (!canAfford(play.currency, price)) return play;
  const remaining = cpToCoins(coinsToCp(play.currency) - coinsToCp(price));
  return addCompanionItem({ ...play, currency: remaining }, compId, itemId);
}

/** Remove one of a companion's items. */
export function removeCompanionItem(play: PlayState, compId: string, instanceId: string): PlayState {
  return patchCompanionInventory(play, compId, (inv) => inv.filter((i) => i.instanceId !== instanceId));
}

/** Set the quantity of a companion's item (min 1). */
export function setCompanionItemQty(play: PlayState, compId: string, instanceId: string, qty: number): PlayState {
  return patchCompanionInventory(play, compId, (inv) =>
    inv.map((i) => (i.instanceId === instanceId ? { ...i, quantity: Math.max(1, Math.round(qty)) } : i)),
  );
}

/** Toggle a worn/equipped/invested flag on a companion's item. */
export function toggleCompanionItemFlag(play: PlayState, compId: string, instanceId: string, flag: ItemFlag): PlayState {
  return patchCompanionInventory(play, compId, (inv) => inv.map((i) => (i.instanceId === instanceId ? { ...i, [flag]: !i[flag] } : i)));
}

/** Replace a companion's whole gear list. */
export function setCompanionInventory(play: PlayState, compId: string, inventory: InventoryItem[]): PlayState {
  return patchCompanionInventory(play, compId, () => inventory);
}

/**
 * Run a CHARACTER inventory action against a COMPANION's pack.
 *
 * Every inventory mutator in this file — add, remove, requantify, equip, attach a rune, move into a
 * container — is written against `play.inventory`. Rather than maintain a second, thinner set of them
 * for companions (which is how the companion's gear ended up a flat list that couldn't do containers or
 * runes), this lends the companion's pack to `play.inventory` for the duration of one action and puts
 * the result back on the companion afterwards.
 *
 * Anything else the action touched stays where it landed: buying gear for a companion is supposed to
 * come out of the OWNER's purse, and `out.currency` does exactly that.
 */
export function onCompanionInventory(play: PlayState, compId: string, fn: (p: PlayState) => PlayState): PlayState {
  const comp = (play.companions ?? []).find((c) => c.id === compId);
  if (!comp) return play;
  const out = fn({ ...play, inventory: comp.inventory ?? [] });
  return setCompanionInventory({ ...out, inventory: play.inventory }, compId, out.inventory ?? []);
}

/** Set one bio/details field in play (merged over the build's details by applyPlayState).
 *  An empty string clears the field. */
export function setDetail(play: PlayState, key: keyof CharacterDetails, value: string): PlayState {
  const details = { ...(play.details ?? {}) };
  if (value === '') delete details[key];
  else details[key] = value;
  return { ...play, details };
}

/** Set (or clear, with null) the character's profile image. `dataUrl` is the compressed (synced) copy;
 *  `ref` keys the matching on-device sharp copy (installed app) — pass it so display can find the sharp
 *  copy, or omit/undefined for the compressed-only case. `avatar` is the square crop the player framed
 *  for small displays; omitting it clears any previous crop, since it belonged to the old image.
 *  Stored in the in-play appearance overlay. */
export function setPortrait(play: PlayState, dataUrl: string | null, ref?: string, avatar?: string): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  if (dataUrl === null) {
    delete appearance.portrait;
    delete appearance.portraitRef;
    delete appearance.avatar;
  } else {
    appearance.portrait = dataUrl;
    if (ref) appearance.portraitRef = ref;
    else delete appearance.portraitRef;
    if (avatar) appearance.avatar = avatar;
    else delete appearance.avatar;
  }
  return { ...play, appearance };
}

/** Re-frame the profile image's square avatar without touching the image itself (the "Reframe" action
 *  on the Details page). null restores the plain centre crop. */
export function setAvatar(play: PlayState, avatar: string | null): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  if (avatar) appearance.avatar = avatar;
  else delete appearance.avatar;
  return { ...play, appearance };
}

/** A gallery id that won't collide with the ones already in use. */
export function nextImageId(gallery: CharacterImage[] | undefined): string {
  const max = (gallery ?? []).reduce((m, g) => Math.max(m, Number(/(\d+)$/.exec(g.id)?.[1] ?? -1)), -1);
  return `img-${max + 1}`;
}

/** Add a picture to the gallery (the character's images OTHER than the profile one). */
export function addGalleryImage(play: PlayState, img: string, ref?: string): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  const gallery = [...(appearance.gallery ?? [])];
  gallery.push({ id: nextImageId(gallery), img, ...(ref ? { portraitRef: ref } : {}) });
  appearance.gallery = gallery;
  return { ...play, appearance };
}

/** Drop a gallery picture. The sharp on-device copy is left alone — an eager delete would break undo;
 *  the startup GC reclaims it once no character references its ref (see data/portraitStore). */
export function removeGalleryImage(play: PlayState, id: string): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  const gallery = (appearance.gallery ?? []).filter((g) => g.id !== id);
  if (gallery.length) appearance.gallery = gallery;
  else delete appearance.gallery;
  return { ...play, appearance };
}

/** Label a gallery picture (empty string clears the caption). */
export function setGalleryCaption(play: PlayState, id: string, caption: string): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  appearance.gallery = (appearance.gallery ?? []).map((g) =>
    g.id === id ? (caption.trim() ? { ...g, caption } : (({ caption: _drop, ...rest }) => rest)(g)) : g,
  );
  return { ...play, appearance };
}

/**
 * Promote a gallery picture to be the profile image; the outgoing profile image takes its place in the
 * gallery, so nothing is lost and the total number of images doesn't change.
 *
 * The avatar crop is dropped: it framed a region of the OLD image and means nothing on the new one.
 * The caller re-frames (or accepts the centre crop) afterwards.
 */
export function makeProfileImage(play: PlayState, id: string): PlayState {
  const appearance = { ...(play.appearance ?? {}) };
  const gallery = [...(appearance.gallery ?? [])];
  const i = gallery.findIndex((g) => g.id === id);
  if (i < 0) return play;
  const incoming = gallery[i];
  const outgoing = appearance.portrait
    ? { id: incoming.id, img: appearance.portrait, ...(appearance.portraitRef ? { portraitRef: appearance.portraitRef } : {}) }
    : undefined;
  if (outgoing) gallery[i] = outgoing;
  else gallery.splice(i, 1);
  appearance.portrait = incoming.img;
  if (incoming.portraitRef) appearance.portraitRef = incoming.portraitRef;
  else delete appearance.portraitRef;
  delete appearance.avatar;
  if (gallery.length) appearance.gallery = gallery;
  else delete appearance.gallery;
  return { ...play, appearance };
}

/** A fresh instanceId that won't collide with existing `inv-N` ids. */
function nextInstanceId(inv: InventoryItem[]): string {
  const max = inv.reduce((m, i) => Math.max(m, Number(/(\d+)$/.exec(i.instanceId)?.[1] ?? -1)), -1);
  return `inv-${max + 1}`;
}

/** Kits that, when acquired, expand into a container holding their contents instead of a single
 *  opaque item — e.g. Adventurer's Pack becomes a worn Backpack holding the bedroll, rope, rations,
 *  torches, etc. (RAW pack contents). Add new packs here; each `container` + `itemId` is a content slug. */
const KIT_CONTENTS: Record<string, { container: string; items: { itemId: string; quantity?: number }[] }> = {
  'adventurers-pack': {
    container: 'backpack',
    items: [
      { itemId: 'bedroll' },
      { itemId: 'chalk', quantity: 10 },
      { itemId: 'flint-and-steel' },
      { itemId: 'rope' },
      { itemId: 'rations', quantity: 2 },
      { itemId: 'soap' },
      { itemId: 'torch', quantity: 5 },
      { itemId: 'waterskin' },
    ],
  },
};

/** Add one of `itemId` to the inventory (worn/equipped state defaulted by the caller). A KIT item
 *  (Adventurer's Pack) instead adds its container + each content item nested inside it. */
export function addInventoryItem(play: PlayState, itemId: string, init?: Partial<InventoryItem>): PlayState {
  const kit = KIT_CONTENTS[itemId];
  if (kit) {
    let inv = play.inventory ?? [];
    const containerInstanceId = nextInstanceId(inv);
    inv = [...inv, { instanceId: containerInstanceId, itemId: kit.container, quantity: 1, worn: true }];
    for (const c of kit.items) {
      inv = [...inv, { instanceId: nextInstanceId(inv), itemId: c.itemId, quantity: c.quantity ?? 1, containerInstanceId }];
    }
    return { ...play, inventory: inv };
  }
  const inv = play.inventory ?? [];
  return {
    ...play,
    inventory: [...inv, { instanceId: nextInstanceId(inv), itemId, quantity: 1, ...init }],
  };
}

/** Remove an inventory item by instance. */
export function removeInventoryItem(play: PlayState, instanceId: string): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? [])
      .filter((i) => i.instanceId !== instanceId)
      // Anything affixed to the removed item comes loose rather than dangling.
      .map((i) => (i.attachedTo === instanceId ? { ...i, attachedTo: null } : i)),
  };
}

/** Affix an attachment (talisman/spellheart/banner) onto a host item; it stops being separately worn/carried. */
export function attachItem(play: PlayState, attachmentId: string, hostId: string): PlayState {
  const inv = play.inventory ?? [];
  const src = inv.find((i) => i.instanceId === attachmentId);
  const attached = { attachedTo: hostId, worn: false, equipped: false, invested: false, containerInstanceId: undefined };
  // A stack of consumable talismans (quantity > 1): peel ONE off and affix it, leaving the rest as a
  // loose stack — exactly like the rune-etch path. Affixing the whole instance would lock the other
  // N-1 units inside the affixed item, making them inaccessible.
  if (src && (src.quantity ?? 1) > 1) {
    return {
      ...play,
      inventory: [
        ...inv.map((i) => (i.instanceId === attachmentId ? { ...i, quantity: src.quantity - 1 } : i)),
        { ...src, instanceId: nextInstanceId(inv), quantity: 1, ...attached },
      ],
    };
  }
  return {
    ...play,
    inventory: inv.map((i) => (i.instanceId === attachmentId ? { ...i, ...attached } : i)),
  };
}

/** Peel an attachment off its host (it becomes a loose carried item again). */
export function detachItem(play: PlayState, attachmentId: string): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => (i.instanceId === attachmentId ? { ...i, attachedTo: null } : i)),
  };
}

/** Set an item's quantity (minimum 1). */
export function setItemQuantity(play: PlayState, instanceId: string, qty: number): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) =>
      i.instanceId === instanceId ? { ...i, quantity: Math.max(1, Math.round(qty)) } : i,
    ),
  };
}

/**
 * Consume one of a consumable.
 *
 * Drops the quantity by one, and removes the item outright when that was the last of them — a potion
 * you just drank should not linger in the pack at quantity 1. If the item has a mode (an elixir whose
 * effect runs for a while), using it switches that mode on, which is the only way an item mode is
 * ever activated: they are hidden from the Modes panel.
 */
export function useConsumable(play: PlayState, instanceId: string, modeDefs?: Record<string, ModeDef>): PlayState {
  const inv = (play.inventory ?? []).find((i) => i.instanceId === instanceId);
  if (!inv) return play;
  const next = inv.quantity > 1 ? setItemQuantity(play, instanceId, inv.quantity - 1) : removeInventoryItem(play, instanceId);
  const mode = Object.values(modeDefs ?? {}).find((m) => m.fromItemId === inv.itemId);
  if (!mode) return next;
  // Already running (a second dose of the same elixir) — leave it on rather than toggling it off.
  if ((next.activeModes ?? []).includes(mode.id)) return next;
  return toggleMode(next, mode.id, modeDefs);
}

/**
 * Switch a NON-consumable item's mode on or off — a Devilwing Badge, a Paradigm Cube, an activated
 * shield. The item is not spent, so quantity is untouched.
 *
 * Item modes are deliberately hidden from the Modes panel because they belong to their item rather
 * than to the player's own list, and the only way to switch one on was the consumable "Use one"
 * button. That left 72 shipped modes with no route to the sheet at all: the effect was modelled, the
 * item was in the inventory, and nothing could turn it on.
 */
export function toggleItemMode(play: PlayState, instanceId: string, modeDefs?: Record<string, ModeDef>): PlayState {
  const inv = (play.inventory ?? []).find((i) => i.instanceId === instanceId);
  if (!inv) return play;
  const mode = Object.values(modeDefs ?? {}).find((m) => m.fromItemId === inv.itemId);
  return mode ? toggleMode(play, mode.id, modeDefs) : play;
}

/**
 * Mark (or unmark) an item as the character's innovation, weapon implement, bonded item, ikon or
 * rune source. EXCLUSIVE: a designation moves rather than duplicating, because a character has one
 * innovation, and two items both claiming it would apply the same modifications twice.
 */
export function setItemDesignation(play: PlayState, instanceId: string, kind: ItemDesignation, on: boolean): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      const has = (i.designations ?? []).includes(kind);
      if (i.instanceId === instanceId) {
        const next = on ? [...new Set([...(i.designations ?? []), kind])] : (i.designations ?? []).filter((d) => d !== kind);
        return next.length ? { ...i, designations: next } : (({ designations: _drop, ...rest }) => rest)(i);
      }
      if (!on || !has) return i;
      // Another item held it — take it away, so the designation names exactly one thing.
      const next = (i.designations ?? []).filter((d) => d !== kind);
      return next.length ? { ...i, designations: next } : (({ designations: _drop, ...rest }) => rest)(i);
    }),
  };
}

/** Toggle a per-item carry flag (worn / equipped / invested). */
export function toggleItemFlag(play: PlayState, instanceId: string, flag: ItemFlag): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      if (i.instanceId !== instanceId) return i;
      const on = !i[flag];
      // Wielding / wearing / investing an item pulls it OUT of any container into the Equipped section —
      // you can't hold or wear something stowed in a backpack. (Matches drag-to-Equipped, which clears
      // containerInstanceId too.) The Equipped section only lists "loose" items, so without this a
      // container item would stay hidden in its backpack even after you equipped it.
      return on ? { ...i, [flag]: true, containerInstanceId: undefined } : { ...i, [flag]: false };
    }),
  };
}

/** Merge a partial update into one inventory item (used by drag-and-drop to relocate an
 *  item between Equipped / Carried / a container — sets carry flags + containerInstanceId). */
export function updateInventoryItem(play: PlayState, instanceId: string, patch: Partial<InventoryItem>): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => (i.instanceId === instanceId ? { ...i, ...patch } : i)),
  };
}

// ───────────────────────── Formula book ─────────────────────────

/** Write a formula into a book. A no-op when the book already holds it or is at its 100 limit. */
export function addFormula(play: PlayState, bookInstanceId: string, itemId: string): PlayState {
  const book = (play.inventory ?? []).find((i) => i.instanceId === bookInstanceId);
  const next = book && withFormula(book.formulas, itemId);
  return next ? updateInventoryItem(play, bookInstanceId, { formulas: next }) : play;
}

/** Tear a formula out of a book. It is a reference, so nothing else changes. */
export function removeFormula(play: PlayState, bookInstanceId: string, itemId: string): PlayState {
  const book = (play.inventory ?? []).find((i) => i.instanceId === bookInstanceId);
  if (!book?.formulas?.includes(itemId)) return play;
  return updateInventoryItem(play, bookInstanceId, { formulas: book.formulas.filter((id) => id !== itemId) });
}

/**
 * Answer a grant's empty slot: the formula goes into the book AND the slot is marked spent.
 *
 * The two halves are deliberately in different places — see PlayState.formulaPicks. Marking happens
 * even when the write does not (a full book, a formula already known), because the player made the
 * choice, and a slot that survived being answered would let the same grant be spent twice.
 */
export function pickFormula(play: PlayState, bookInstanceId: string, slotKey: string, itemId: string): PlayState {
  return { ...addFormula(play, bookInstanceId, itemId), formulaPicks: { ...(play.formulaPicks ?? {}), [slotKey]: itemId } };
}

/**
 * Fold what the BUILDER decided into the book the character is carrying — once, and only once.
 *
 * The builder cannot reach play state, so its picks and the formula book it grants arrive here as
 * plain build output. Every entry it has not seen before is copied into the live book and then
 * recorded as spent; every entry it has seen is skipped. That is what makes the grant a one-time
 * write: after this has run, losing the book leaves nothing to copy back, and the record that
 * granted the formulas has already been marked as having done so.
 *
 * Idempotent, so it can sit on the play-state seeding path and run on every mutation.
 */
export function reconcileFormulaBook(play: PlayState, ch: Character, content: ContentDatabase): PlayState {
  let out = play;
  // The book itself. Granted only while the character has never been given one — a player who threw
  // their formula book away is not handed a fresh one on the next tap.
  if (!out.formulaBookGranted) {
    const grants = grantsFormulaBook([
      ...(ch.feats ?? []).map((f) => f.featId),
      ...ownedFeatureIds(ch, content),
    ]);
    if (grants) {
      if (!formulaBooks(out.inventory, content).length && content.items[FORMULA_BOOK_ITEM_ID]) {
        out = addInventoryItem(out, FORMULA_BOOK_ITEM_ID);
      }
      out = { ...out, formulaBookGranted: true };
    }
  }
  const unseen = Object.entries(ch.formulaPicks ?? {}).filter(([key]) => !(key in (out.formulaPicks ?? {})));
  if (!unseen.length) return out;
  const book = formulaBooks(out.inventory, content)[0];
  for (const [, itemId] of unseen) if (book) out = addFormula(out, book.instanceId, itemId);
  return { ...out, formulaPicks: { ...(out.formulaPicks ?? {}), ...Object.fromEntries(unseen) } };
}

// ───────────────────────── Monster Parts (variant rule) ─────────────────────────

/** Set (or clear, with undefined) an item's Monster-Parts blob (its refined/imbued gear state). An item
 *  uses EITHER monster parts OR runes/materials — never both — so switching to Monster-Parts mode clears
 *  its runes, and switching off drops the blob. Refine/imbue values are set FREELY (reference-only, no
 *  spending): the character's harvested monster-part inventory items are just an informational reference. */
export function setItemMonsterPart(
  play: PlayState,
  instanceId: string,
  monsterPart: InventoryItem['monsterPart'] | undefined,
): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      if (i.instanceId !== instanceId) return i;
      const next: InventoryItem = { ...i };
      if (monsterPart) {
        next.monsterPart = monsterPart;
        delete next.runes; // either/or: a Monster-Parts item ignores its runes/material.
      } else {
        delete next.monsterPart;
      }
      return next;
    }),
  };
}

/** Set an item's refine value FREELY (no deduction). Ensures a blob of the given `kind` exists (creating
 *  one for an auto-kind item that has none yet) and clears the item's runes (either/or). */
export function setItemRefineValue(
  play: PlayState,
  instanceId: string,
  kind: ItemMonsterPart['kind'],
  refineValue: number,
): PlayState {
  const inv = (play.inventory ?? []).find((i) => i.instanceId === instanceId);
  const blob: ItemMonsterPart = inv?.monsterPart ?? { kind, refineValue: 0, imbuements: [] };
  return setItemMonsterPart(play, instanceId, { ...blob, kind, refineValue: Math.max(0, Math.round(refineValue)) });
}

/** Replace an item's imbuement list FREELY (no deduction). A no-op if the item has no monster-part blob. */
export function setItemImbuements(play: PlayState, instanceId: string, imbuements: ItemImbuement[]): PlayState {
  const inv = (play.inventory ?? []).find((i) => i.instanceId === instanceId);
  if (!inv?.monsterPart) return play;
  return setItemMonsterPart(play, instanceId, { ...inv.monsterPart, imbuements });
}

/** Set (or clear, with undefined) an item's use-tracker — max uses + whether it refills on rest. */
export function setItemCharges(
  play: PlayState,
  instanceId: string,
  charges: { current: number; max: number; resetsOnRest?: boolean } | undefined,
): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) => {
      if (i.instanceId !== instanceId) return i;
      const next = { ...i };
      if (charges) next.charges = charges;
      else delete next.charges;
      return next;
    }),
  };
}

/** Spend (positive delta) or restore (negative) item uses, clamped to [0, max]. */
export function useItemCharge(play: PlayState, instanceId: string, delta = 1): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) =>
      i.instanceId === instanceId && i.charges
        ? { ...i, charges: { ...i.charges, current: clamp(i.charges.current - delta, 0, i.charges.max) } }
        : i,
    ),
  };
}

/** Set one of an item's counters (by id) — used by the per-counter +/- use trackers. */
export function setItemCounter(
  play: PlayState,
  instanceId: string,
  counterId: string,
  value: { current: number; max: number; resetsOnRest?: boolean },
): PlayState {
  return {
    ...play,
    inventory: (play.inventory ?? []).map((i) =>
      i.instanceId === instanceId ? { ...i, counters: { ...i.counters, [counterId]: value } } : i,
    ),
  };
}

/** Set the wallet directly (Manage Coins editor). */
export function setCurrency(play: PlayState, currency: Coins): PlayState {
  return { ...play, currency };
}

/** Prepare/unprepare a Commander tactic for the day (capped at preparedMax; over-cap toggles no-op). */
export function toggleTactic(play: PlayState, tacticId: string, preparedMax: number): PlayState {
  const cur = play.preparedTactics ?? [];
  if (cur.includes(tacticId)) return { ...play, preparedTactics: cur.filter((id) => id !== tacticId) };
  if (cur.length >= preparedMax) return play; // already at capacity — ignore
  return { ...play, preparedTactics: [...cur, tacticId] };
}

/** Pin/unpin an activity by its key (Main-tab favorites). */
export function togglePin(play: PlayState, key: string): PlayState {
  const pinned = play.pinned ?? [];
  return { ...play, pinned: pinned.includes(key) ? pinned.filter((k) => k !== key) : [...pinned, key] };
}

/** Stable identity for a pinned description: its source-map name + lowercased title. The map name
 *  disambiguates cross-map name collisions (a feat + a same-named spell). Entries pinned before the
 *  `key` discriminator existed have no key and fall back to title-only matching. */
export function descId(n: { key?: string; title: string }): string {
  return `${n.key ?? ''}:${n.title.toLowerCase()}`;
}

/** Pin/unpin a description popup (starred from a description page), keyed by source-map + title. */
export function togglePinnedDesc(play: PlayState, node: PinnedDesc): PlayState {
  const list = play.pinnedDescs ?? [];
  const id = descId(node);
  const exists = list.some((d) => descId(d) === id);
  return {
    ...play,
    pinnedDescs: exists
      ? list.filter((d) => descId(d) !== id)
      : [...list, { title: node.title, description: node.description, descRefs: node.descRefs, key: node.key }],
  };
}

/**
 * Activate/deactivate a mode by id. When activating a mode that belongs to an exclusiveGroup,
 * any already-active mode in the same group is turned off first (e.g. only one bard composition
 * or rage state at a time). Pass `modeDefs` (content.modes) to enable the exclusivity check.
 */
export function toggleMode(play: PlayState, id: string, modeDefs?: Record<string, ModeDef>): PlayState {
  const active = play.activeModes ?? [];
  const form = modeDefs?.[id]?.battleForm;
  const grantedTemp = form?.tempHp ?? 0;
  if (active.includes(id)) {
    const off: PlayState = { ...play, activeModes: active.filter((m) => m !== id) };
    // The form's temporary Hit Points end with the form — but only the ones it actually granted. A
    // pool the player typed in, or one already spent to 0, is not this mode's to remove. A STACKING
    // form gave back only its own share, so it takes back only that share (never below zero, because
    // the pool may already have soaked damage).
    if (play.tempHpFrom !== id) return off;
    return { ...off, tempHp: form?.tempHpStacks ? Math.max(0, play.tempHp - grantedTemp) : 0, tempHpFrom: undefined };
  }
  let next = [...active, id];
  const group = modeDefs?.[id]?.exclusiveGroup;
  if (group) {
    next = next.filter((mid) => mid === id || modeDefs?.[mid]?.exclusiveGroup !== group);
  }
  const on: PlayState = { ...play, activeModes: next };
  /*
   * "You gain 40 temporary Hit Points." Applied here because switching the mode on IS entering the
   * form, and the field was otherwise authored on seven records and read by nothing.
   *
   * RAISES ONLY. PF2e: "If you gain temporary Hit Points when you already have some, choose whether to
   * keep the ones you have or the new ones" — the app cannot ask mid-toggle, and silently lowering a
   * bigger pool would destroy Hit Points the character has. Keeping the larger one is the choice that
   * can never be wrong for the player, and it leaves `tempHpFrom` unset, so leaving the form will not
   * remove a pool this form never granted.
   *
   * `tempHpStacks` is the one printed exception — see the field.
   */
  if (!grantedTemp) return on;
  if (form?.tempHpStacks) return { ...on, tempHp: play.tempHp + grantedTemp, tempHpFrom: id };
  return grantedTemp > play.tempHp ? { ...on, tempHp: grantedTemp, tempHpFrom: id } : on;
}

/** Enter a stance by slug, or exit it (pass the same slug again, or null). Exclusive by construction —
 *  storing a single slug means entering one stance always replaces the previous. */
export function setActiveStance(play: PlayState, slug: string | null): PlayState {
  if (!slug || play.activeStance === slug) return { ...play, activeStance: undefined };
  return { ...play, activeStance: slug };
}

/** Alchemist: set the on-hand quantity of an infused item (0 removes it). Used by the Advanced Alchemy
 *  prep list (+/−, use) and Quick Alchemy. */
export function setAlchemyItem(play: PlayState, itemId: string, qty: number): PlayState {
  const prep = { ...(play.alchemyPrep ?? {}) };
  if (qty <= 0) delete prep[itemId];
  else prep[itemId] = Math.round(qty);
  return { ...play, alchemyPrep: prep };
}

/** Alchemist Quick Alchemy: spend one Versatile Vial to make an infused item on the fly. No-op at 0
 *  vials. (The daily loadout is set via Advanced Alchemy without spending vials.) */
export function quickAlchemy(play: PlayState, itemId: string, currentVials: number, maxVials: number): PlayState {
  if (currentVials < 1) return play;
  const spent = setResource(play, 'versatile-vials', currentVials - 1, maxVials);
  const prep = { ...(spent.alchemyPrep ?? {}) };
  prep[itemId] = (prep[itemId] ?? 0) + 1;
  return { ...spent, alchemyPrep: prep };
}

/** Set a class-resource counter to a value, clamped to [0, max]. */
export function setResource(play: PlayState, id: string, value: number, max: number): PlayState {
  return { ...play, resources: { ...(play.resources ?? {}), [id]: clamp(Math.round(value), 0, max) } };
}

/** Flip a class-resource toggle (0/1) on/off. */
export function toggleResource(play: PlayState, id: string): PlayState {
  const cur = (play.resources ?? {})[id] ?? 0;
  return { ...play, resources: { ...(play.resources ?? {}), [id]: cur ? 0 : 1 } };
}

/** A fresh notes-page id that won't collide with existing `note-N` ids. */
export function nextNoteId(notes: NotePage[]): string {
  const max = notes.reduce((m, p) => Math.max(m, Number(/(\d+)$/.exec(p.id)?.[1] ?? -1)), -1);
  return `note-${max + 1}`;
}

/**
 * Add a blank notes page.
 *
 * New pages are PRIVATE by default. A note is where a player writes the thing they'd rather not have
 * read over their shoulder — a suspicion about an NPC, a plan, a secret the GM handed them alone —
 * and a default of "visible to the whole party" leaks it before the player knows there was a switch
 * to find. Sharing is one click on the lock; un-sharing after the fact isn't.
 */
export function addNotePage(play: PlayState, icon = 'ti-note', color?: string): PlayState {
  const notes = play.notes ?? [];
  return {
    ...play,
    notes: [...notes, { id: nextNoteId(notes), title: 'New page', content: '', icon, private: true, ...(color ? { color } : {}) }],
  };
}

/** Remove a notes page by id. */
export function removeNotePage(play: PlayState, id: string): PlayState {
  return { ...play, notes: (play.notes ?? []).filter((p) => p.id !== id) };
}

/**
 * Move a notes page to a new index (drag-to-reorder, and the context menu's up/down).
 * `to` is clamped and an unknown id is a no-op, so a stale drag can't drop a page out of the array
 * or duplicate it.
 */
export function moveNotePage(play: PlayState, id: string, to: number): PlayState {
  const notes = play.notes ?? [];
  const from = notes.findIndex((p) => p.id === id);
  if (from < 0) return play;
  const target = Math.max(0, Math.min(notes.length - 1, to));
  if (target === from) return play;
  const next = notes.slice();
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return { ...play, notes: next };
}

/** Merge a partial update into a notes page (title, content, icon, color, private). */
export function updateNotePage(play: PlayState, id: string, patch: Partial<NotePage>): PlayState {
  return { ...play, notes: (play.notes ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/** Whether the wallet covers a price (free/undefined prices are always affordable). */
export function canAfford(currency: Coins | undefined, price: Coins | undefined): boolean {
  return coinsToCp(price) <= coinsToCp(currency);
}

/** Buy an item: deduct its price from the wallet and add it. No-op if unaffordable. */
export function buyItem(play: PlayState, itemId: string, price: Coins | undefined): PlayState {
  if (!canAfford(play.currency, price)) return play;
  const remaining = cpToCoins(coinsToCp(play.currency) - coinsToCp(price));
  return addInventoryItem({ ...play, currency: remaining }, itemId);
}

/**
 * Reconcile a play state after the build is edited/rebuilt. The rebuild re-derives spell preparation
 * and class resources from the new choices, so we drop those (re-seeded from the new character) and
 * refill usage counters (slots/focus). Genuine in-play progress is KEPT: damage, temp HP, hero points,
 * XP, conditions, pins, notes, companion state — AND the player's actual inventory + currency (real
 * progress, not build-derived; left undefined for a character that never touched inventory in play so
 * the rebuilt build gear still seeds correctly).
 */
export function playForRebuild(play: PlayState): PlayState {
  return {
    damage: play.damage,
    tempHp: play.tempHp,
    shieldDamage: play.shieldDamage,
    tempSpeed: play.tempSpeed,
    heroPoints: play.heroPoints,
    mythicPoints: play.mythicPoints,
    xp: play.xp,
    conditions: play.conditions ?? [],
    pinned: play.pinned ?? [],
    pinnedDescs: play.pinnedDescs,
    companionConditions: play.companionConditions,
    companionHp: play.companionHp,
    companionModes: play.companionModes,
    companions: play.companions,
    details: play.details,
    appearance: play.appearance,
    activeModes: play.activeModes,
    notes: play.notes,
    // Keep the player's real gear + wallet across the edit: items bought/looted and gold spent are
    // genuine progress, not build-derived. (Undefined falls back to the rebuilt build gear for a
    // character that never managed inventory in play, so fresh builds still seed correctly.) Spell
    // prep / repertoire / signature and class resources ARE re-derived from the new build, so omitted.
    inventory: play.inventory,
    currency: play.currency,
    // Learning a spell costs an hour per rank and real gold; it is knowledge the character now has,
    // not a preparation, so it outlives a rebuild the same way bought gear does.
    learnedSpells: play.learnedSpells,
    // A formula grant is spent once. Dropping this ledger on a rebuild would re-open every slot the
    // character had already answered, which is exactly the re-granting point 9 forbids.
    formulaPicks: play.formulaPicks,
    formulaBookGranted: play.formulaBookGranted,
    expendedSlots: {},
    slotsUsed: {},
    focusUsed: 0,
  };
}

/** Apply a full night's rest to a condition list. A night's rest is the day's big recovery, so it
 *  removes Fatigued, Wounded, AND Dying (you survive/recover overnight — without this, Dying and
 *  Wounded picked up from dropping to 0 HP would linger forever, since a night's HP recovery often
 *  won't reach full). Doomed and Drained step down by 1 (removed at 0). Other conditions persist
 *  (their durations aren't tracked, so the player clears those manually). */
function restConditions(list: ActiveCondition[], steps = 1): ActiveCondition[] {
  const out: ActiveCondition[] = [];
  for (const c of list) {
    if (c.id === 'fatigued' || c.id === 'wounded' || c.id === 'dying') continue;
    if (c.id === 'doomed' || c.id === 'drained') {
      // `steps` is 1 by RAW; Bolstered Recovery doubles "the amount by which condition values are
      // reduced from a full night's rest", which was hardcoded here.
      const v = (c.value ?? 1) - Math.max(1, steps);
      if (v > 0) out.push({ ...c, value: v });
      continue;
    }
    out.push(c);
  }
  return out;
}

/**
 * A full night's rest + daily preparations, per PF2e — NOT a full heal. You regain Hit
 * Points equal to your level × your Constitution modifier (minimum 1); temp HP clears;
 * spell slots, the focus pool, and daily-use class resources refresh; Fatigued, Wounded, and
 * Dying are removed, and Doomed and Drained step down by 1. Hero points are session-based and
 * untouched. XP carries over.
 */
export function rest(
  play: PlayState,
  opts: {
    level: number;
    conMod: number;
    initialResources?: Record<string, number>;
    modeDefs?: Record<string, ModeDef>;
    /** Character.restRecovery — Fast Recovery doubles the HP, Bolstered Recovery the condition steps
     *  as well. Both were hardcoded to 1 here, so neither feat changed a night's sleep. */
    restRecovery?: { hpMultiplier: number; conditionSteps: number };
  },
): PlayState {
  const hpMult = Math.max(1, opts.restRecovery?.hpMultiplier ?? 1);
  const recovered = Math.max(0, opts.level) * Math.max(1, opts.conMod) * hpMult;
  const damage = Math.max(0, play.damage - recovered);
  const companionConditions = play.companionConditions
    ? Object.fromEntries(Object.entries(play.companionConditions).map(([k, v]) => [k, restConditions(v)]))
    : play.companionConditions;
  // Creature companions fully recover overnight; vehicles & siege weapons need Repair, not rest.
  const companionHp = play.companionHp
    ? Object.fromEntries(
        Object.entries(play.companionHp).map(([id, hp]) => {
          const kind = (play.companions ?? []).find((c) => c.id === id)?.kind;
          return [id, kind === 'vehicle' || kind === 'siege' ? hp : { damage: 0, temp: 0 }];
        }),
      )
    : play.companionHp;
  // Refill tracked item uses that reset on daily preparations (wands, staves, per-day items) —
  // both the legacy single `charges` and each `counters` entry flagged resetsOnRest.
  const inventory = play.inventory
    ? play.inventory.map((i) => {
        let next = i;
        if (i.charges?.resetsOnRest) next = { ...next, charges: { ...i.charges, current: i.charges.max } };
        if (i.counters && Object.values(i.counters).some((c) => c.resetsOnRest)) {
          next = {
            ...next,
            counters: Object.fromEntries(
              Object.entries(i.counters).map(([id, c]) => [id, c.resetsOnRest ? { ...c, current: c.max } : c]),
            ),
          };
        }
        // Battleforger lasts "until your next daily preparations" — this IS that moment. Clearing it
        // here is what keeps it temporary rather than a permanent rune the player never etched.
        if (next.battleforged) next = { ...next, battleforged: undefined };
        return next;
      })
    : play.inventory;
  return {
    ...play,
    damage,
    tempHp: 0,
    focusUsed: 0,
    // Mythic points are a SESSION resource, not a daily one — the comment here used to say the
    // opposite. "Mythic Points last for only a single session… Each mythic character starts the
    // session with 3" (War of Immortals p.76), and the printed ways to regain them are slaying a
    // mythic foe, completing a mythic deed and following your Calling's edicts — never resting.
    //
    // Refilled here anyway, because Rest is the only session boundary this app has and a player who
    // rests has almost certainly ended a session. The pips stay clickable for the mid-session
    // regains, and the rail states the real rule so the app is not teaching a wrong one.
    mythicPoints: MAX_MYTHIC_POINTS,
    expendedSlots: {},
    slotsUsed: {},
    innateUsed: {},
    // Per-day feat uses refill with everything else. dailyChoices deliberately does NOT reset here —
    // it is the answer you keep, which is what the "reuse my last pick" setting relies on.
    featUses: {},
    conditions: restConditions(play.conditions ?? [], opts.restRecovery?.conditionSteps),
    companionConditions,
    companionHp,
    resources: opts.initialResources ?? play.resources,
    inventory,
    // An elixir you drank yesterday is not still running. Item modes clear overnight unless their
    // printed duration outlasts a night ("until your next daily preparations"), which is exactly the
    // rest that would otherwise wipe them. Modes the player toggled themselves are left alone —
    // those are theirs to manage.
    activeModes: (play.activeModes ?? []).filter((id) => {
      const def = opts.modeDefs?.[id];
      return !def?.fromItemId || def.survivesRest;
    }),
  };
}

/**
 * Item bonuses from a play-bought item's answered "choose one of N", merged over whatever the build
 * already resolved.
 *
 * buildCharacter resolves effectChoices for items in `build.inventory`, but equipment is bought on
 * the SHEET, so anything acquired in play was never seen by that pass. This closes the other half.
 * Only the picked option's `passive` block is applied — the same subset buildCharacter uses for
 * items — so the two paths cannot disagree about what an item choice may grant.
 */
function resolvePlayItemPassives(
  ch: Character,
  play: PlayState,
  content: ContentDatabase,
): Record<string, ItemPassiveEffects> | undefined {
  const inv = play.inventory ?? ch.inventory ?? [];
  if (!inv.length) return ch.resolvedItemPassives;
  let out: Record<string, ItemPassiveEffects> | undefined;
  for (const it of inv) {
    const choices = content.items[it.itemId]?.effectChoices;
    if (!choices?.length) continue;
    for (const ch2 of choices) {
      const picked = it.effectChoices?.[ch2.id];
      if (!picked) continue;
      const grant = (ch2.options ?? []).find((o) => o.value === picked)?.grant;
      if (!grant?.passive) continue;
      out ??= { ...(ch.resolvedItemPassives ?? {}) };
      const cur = (out[it.itemId] ??= {});
      for (const [k, v] of Object.entries(grant.passive)) {
        if (k === 'skills') cur.skills = { ...cur.skills, ...(v as Record<string, number>) };
        else if (Array.isArray(v)) (cur as Record<string, unknown[]>)[k] = [...((cur as Record<string, unknown[]>)[k] ?? []), ...v];
        else (cur as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out ?? ch.resolvedItemPassives;
}
