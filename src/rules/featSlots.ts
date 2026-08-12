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
import type { BuildState } from './build';
import { backgroundGrantedFeats, resolveBackground } from './build';
import { maxTakes } from './featGrants';
import { elementTraitsOf, impulseAllowedFor } from './kineticElements';
import { mythicSlotAllows } from './mythic';
import type { ContentDatabase, Feat, FeatCategory } from './types';

export interface FeatSlotRef {
  level: number;
  category: FeatCategory;
  idx: number;
}

/** The featPicks key for a slot — "level:category:idx" (mirrors the builder's slotKey). */
export const featSlotKey = (p: FeatSlotRef) => `${p.level}:${p.category}:${p.idx}`;

/**
 * Feats eligible for a given slot: right category + level, not already taken as many times as it may
 * be (once for most feats; up to maxTakes() for a repeatable one like Armor Proficiency), and — for
 * ancestry/class feats — gated to the chosen ancestry/class by trait. `content` decides the pool:
 * pass the source-FILTERED db for what the picker offers, or the FULL db to judge slot-validity
 * independently of source books.
 */
export function eligibleFeatsForSlot(build: BuildState, content: ContentDatabase, p: FeatSlotRef): Feat[] {
  const currentKey = featSlotKey(p);
  // Count takes in OTHER slots; a feat is hidden here once those already reach its cap. A repeatable
  // feat therefore stays offered until the whole build holds maxTakes() copies of it.
  const taken = new Map<string, number>();
  for (const [k, v] of Object.entries(build.featPicks)) if (v && k !== currentKey) taken.set(v, (taken.get(v) ?? 0) + 1);
  for (const granted of backgroundGrantedFeats(resolveBackground(build, content), build.backgroundSkillChoice)) {
    taken.set(granted, (taken.get(granted) ?? 0) + 1);
  }
  return Object.values(content.feats).filter((f) => {
    // Skip `aon-` scrapes that duplicate a canonical feat of the same name — they would offer the
    // SAME feat twice in one picker. They stay in the db, so a feat already picked still resolves.
    if (content.duplicateIds?.has(f.id)) return false;
    if (f.level > p.level) return false;
    if ((taken.get(f.id) ?? 0) >= maxTakes(f)) return false;
    // Free Archetype slot: any archetype feat (these are stored as class-category feats carrying the
    // 'archetype' trait, so match on the trait rather than the category).
    if (p.category === 'archetype') return f.traits.includes('archetype');
    /*
     * Mythic slot. NOT simply "any mythic-trait feat", which broke the printed rule three ways:
     *   - the 12th-level slot MUST buy a destiny dedication ("they must use their extra feat to take
     *     the 12th-level destiny feat for a mythic destiny"), and offered every mythic feat instead;
     *   - a slot above 12 offered feats belonging to destinies the character does not have, so one
     *     could accumulate a second — "Characters can have only one mythic destiny";
     *   - Mortal Herald, which its own rules page names as a destiny, ships with no `mythic` trait,
     *     so the 14th destiny was unreachable from the one slot the rules say must buy it.
     */
    if (p.category === 'mythic') return mythicSlotAllows(f, p.level, build.mythicDestiny, content);
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
     * Flexibility prints "up to 18th level" rather than 19.
     */
    if (p.category === 'bonus') {
      if (!f.traits.includes('fighter')) return false;
      return f.level <= (p.level === 20 ? 18 : p.level - 1);
    }
    // A general feat slot may take any qualifying SKILL feat (skill feats are a subset of general
    // feats). The reverse is not true — a skill slot takes only skill feats.
    if (f.category !== p.category && !(p.category === 'general' && f.category === 'skill')) return false;
    // An ancestry slot takes your ancestry's feats — AND, if you took a VERSATILE heritage, that
    // heritage's own feats. A versatile heritage (nephilim, dragonblood, dhampir, …) has
    // `ancestryId: null` and its feats carry the HERITAGE's trait, not an ancestry's. Gating on
    // ancestryId alone made several hundred perfectly-modelled feats unreachable by anyone: this
    // file did not contain the word "heritage" at all.
    if (p.category === 'ancestry' && build.ancestryId) {
      const her = build.heritageId ? content.heritages[build.heritageId] : undefined;
      const ok =
        f.traits.includes(build.ancestryId) ||
        (her?.versatile && f.traits.includes(her.id)) ||
        // …and a heritage that opens ANOTHER ancestry's list: "you can select elf, half-elf, and
        // human feats whenever you gain an ancestry feat" (half-elf, half-orc).
        (her?.extraAncestryFeatTraits ?? []).some((t) => f.traits.includes(t)) ||
        // UNIVERSAL ANCESTRY — a feat ANY ancestry may take (the six Impossible Lands fey feats).
        // The trait IS that rule and belongs to no ancestry, so a gate that only ever asked "does
        // this carry my ancestry's trait" could never admit one.
        f.traits.includes('universal-ancestry');
      if (!ok) return false;
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
      return false;
    // Kineticist impulses are gated to the elements of your kinetic gate (incl. elements gained via
    // Fork the Path, and the ones an ARCHETYPE kineticist named on their dedication).
    //
    // No class check: `elementTraitsOf` is empty for anyone with no elements, and `impulseAllowedFor`
    // then admits everything, so the guard the class check used to provide is the element list itself.
    // Keeping the check would have re-created the bug it was written beside — an archetype kineticist
    // has elements and was skipped by it.
    if (f.traits.includes('impulse') && !impulseAllowedFor(f.traits, elementTraitsOf(build, build.level))) return false;
    return true;
  });
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
}): HiddenFeatMatches | null {
  const q = opts.query.trim().toLowerCase();
  if (!q) return null;
  const sources: Feat[] = [];
  let archetype = 0;
  let campaign = 0;
  let invalid = 0;
  for (const f of opts.allFeats) {
    if (opts.shownIds.has(f.id)) continue;
    if (!`${f.name}\n${f.description}`.toLowerCase().includes(q)) continue;
    if (!opts.slotEligibleIds.has(f.id)) {
      invalid++;
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
      const book = f.source?.book?.trim();
      if (book && !opts.enabledBooks.has(book)) sources.push(f);
      else invalid++; // unexpected residue — count it honestly rather than dropping it
    }
  }
  const total = sources.length + archetype + campaign + invalid;
  if (total === 0) return null;
  sources.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return { sources, archetype, campaign, invalid, total };
}
