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
import { kineticistElements, resolveBackground } from './build';
import type { ContentDatabase, Feat, FeatCategory } from './types';

export interface FeatSlotRef {
  level: number;
  category: FeatCategory;
  idx: number;
}

/** The featPicks key for a slot — "level:category:idx" (mirrors the builder's slotKey). */
export const featSlotKey = (p: FeatSlotRef) => `${p.level}:${p.category}:${p.idx}`;

/**
 * Feats eligible for a given slot: right category + level, not already taken in another slot
 * (a feat can only be taken once), and — for ancestry/class feats — gated to the chosen
 * ancestry/class by trait. `content` decides the pool: pass the source-FILTERED db for what the
 * picker offers, or the FULL db to judge slot-validity independently of source books.
 */
export function eligibleFeatsForSlot(build: BuildState, content: ContentDatabase, p: FeatSlotRef): Feat[] {
  const currentKey = featSlotKey(p);
  const taken = new Set<string>();
  for (const [k, v] of Object.entries(build.featPicks)) if (v && k !== currentKey) taken.add(v);
  const granted = resolveBackground(build, content)?.grantedFeatId;
  if (granted) taken.add(granted);
  return Object.values(content.feats).filter((f) => {
    if (f.level > p.level) return false;
    if (taken.has(f.id)) return false;
    // Free Archetype slot: any archetype feat (these are stored as class-category feats carrying the
    // 'archetype' trait, so match on the trait rather than the category).
    if (p.category === 'archetype') return f.traits.includes('archetype');
    // Mythic slot: any mythic-trait feat (callings + mythic destiny feats) at or below this level.
    if (p.category === 'mythic') return f.traits.includes('mythic');
    // A general feat slot may take any qualifying SKILL feat (skill feats are a subset of general
    // feats). The reverse is not true — a skill slot takes only skill feats.
    if (f.category !== p.category && !(p.category === 'general' && f.category === 'skill')) return false;
    if (p.category === 'ancestry' && build.ancestryId && !f.traits.includes(build.ancestryId)) return false;
    // Class slots take your class's feats OR any archetype feat (multiclass/archetypes). Dual Class
    // also accepts the second class's feats.
    if (
      p.category === 'class' &&
      build.classId &&
      !f.traits.includes(build.classId) &&
      !(build.variantRules?.dualClass && build.classId2 && f.traits.includes(build.classId2)) &&
      !f.traits.includes('archetype')
    )
      return false;
    // Kineticist impulses are gated to the elements of your kinetic gate (incl. elements gained via
    // Fork the Path): an impulse feat is only available if it carries one of your elements.
    if ((build.classId === 'kineticist' || (build.variantRules?.dualClass && build.classId2 === 'kineticist')) && f.traits.includes('impulse')) {
      const elements = kineticistElements(build, build.level).map((id) => id.replace(/-gate$/, ''));
      if (elements.length && !f.traits.some((t) => elements.includes(t))) return false;
    }
    // Fighter Combat/Improved Flexibility bonus slots take a fighter feat of level ≤8 (L9 slot) / ≤14 (L15).
    if (p.category === 'bonus' && build.classId === 'fighter' && (!f.traits.includes('fighter') || f.level > p.level - 1))
      return false;
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
      (!opts.kingmakerEnabled && /kingmaker/i.test(f.source?.book ?? ''))
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
