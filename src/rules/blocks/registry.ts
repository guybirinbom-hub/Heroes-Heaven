/*
 * THE BLOCK REGISTRY — every kind of building block, defined in one place.
 *
 * Design: docs/overrides-redesign.md, decisions 22–25 and "Building blocks" items 1–14. Every change to
 * a character, from a book or from the player, is made of the same blocks: "+1 to Athletics", "Stealth
 * at least expert", "give this feat". A tweak is a block the player wrote; feats, features and items
 * will hold the same blocks in the big re-implementation; homebrew is the third author (item 14).
 *
 * The full list of kinds — built, still to add, or shaped by a ruling — is `catalog.json` beside this
 * file. A kind with status "built" there has an entry here, and an entry here has a "built" row there;
 * `scripts/blocks-check.mjs` (in `npm run verify`) fails on any mismatch.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * HOW TO ADD A BLOCK (decision 23: adding one later must be easy)
 *
 * Case 1 — a new block on a target that already has a term list (the usual case):
 *   1. Add ONE entry to BLOCK_KINDS below: id, family, version, storage, seam, slot, accepts, line,
 *      editor (put together from EDITOR_PARTS; place 'main' or 'advanced'), missing, applies, test —
 *      and a STILL_TO_ADD line with its reason until its editor is on the Tweaks screen.
 *   2. Set its catalog.json row to status "built" with "registry": true (same family, place and
 *      bookFields as the entry).
 *   3. Write its test (the file named in `test`; the id must appear in an it()/describe() title), and
 *      add it to the generic step test so a +1 (or one rank step) moves the derived number by exactly
 *      that much.
 *   No new screen code: the Tweaks editor is assembled from the entry's parts.
 *
 * Case 2 — a new target (a statistic no block could point at before):
 *   1. Add the TargetKind member and its TARGETS row(s) in targets.ts (aspect, owner, detail, phase).
 *   2. Add the code that reads its term list: a derive-time number gets a `<stat>Terms(...)` builder
 *      beside its derive function, read by BOTH the derive function and explain.ts (item 5) — never a
 *      second hand-built breakdown; a build-time rank or score gets its seam in `buildCharacter`.
 *   3. List the target under `accepts` of each kind that should reach it, and add it to the generic
 *      step test fixture.
 *
 * Case 3 — a new build-time hook (a block that changes the build itself, not a number):
 *   1. Add a seam inside `buildCharacter` (build.ts), at the place its slot belongs (item 8: an "at
 *      least" floor is seeded before the skill-increase loop; an "exactly" clamp runs last, after every
 *      `maxRank` raise).
 *   2. Add the entry with `seam: 'build'`, and a test that builds a fixture with and without the block.
 *
 * New editor parts only when no shared part fits (add the name to EDITOR_PARTS and build the part once).
 * Never store a block as a Mode (item 6): tweak blocks live inside `overrides`, so they travel with the
 * character to the GM, the party card and the tracker.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import type { ProficiencyRank } from '../types';
import type { TargetAspect, TargetKind } from './targets';

export type BlockFamily =
  | 'number'
  | 'rank'
  | 'attribute'
  | 'grant'
  | 'choice'
  | 'spellcasting'
  | 'remove'
  | 'text'
  | 'marker'
  | 'note'
  | 'limit'
  | 'gate'
  | 'defense'
  | 'sense'
  | 'movement'
  | 'strike'
  | 'companion'
  | 'item'
  | 'structure';

/** Who wrote a block. 'homebrew' is RESERVED in phase 1 (item 14): nothing writes it yet, and feature
 *  29 ("Save as homebrew", phase 4) connects it. A reader must still accept it, so a homebrew block
 *  written by a later app version is kept and shown, never dropped. */
export type SourceKind = 'book' | 'tweak' | 'homebrew';
export const SOURCE_KINDS: SourceKind[] = ['book', 'tweak', 'homebrew'];
export const RESERVED_SOURCE_KINDS: SourceKind[] = ['homebrew'];

/** Where a number block sits in its stat's order (spec item 6): set → at least → add; a battle form
 *  replaces the whole number. A rank "exactly" is a set at the end of the build (item 8). */
export type OrderSlot = 'set' | 'atLeast' | 'add' | 'replace';

/** The shared editor parts a Tweaks editor is put together from (decision 23). Tweaks phase 2 (Choices,
 *  work/tweaks-phase2-notes/plan.md section 2b) adds the picker, place, rule, count, question, answer and
 *  options parts; the Tweaks page draws them from WP2 on. */
export const EDITOR_PARTS = ['target', 'number', 'bonusType', 'rank', 'record', 'text', 'level', 'reason', 'picker', 'place', 'rule', 'count', 'question', 'answer', 'options'] as const;
export type EditorPart = (typeof EDITOR_PARTS)[number];

/*
 * Tweaks phase 2 (Choices): the CLOSED SETS the seven choice kinds store (plan section 4, decision C3). A value
 * a later version adds to one of them (a new picker, place, category, rule, question, lane or boost set) is
 * read as 'newer-version' and kept untouched (stored.ts); a value of the wrong type is 'unreadable'. The six
 * attributes are a fixed set no later version grows: an attribute outside them is unreadable, never newer.
 * WP13 (re-scoped 2026-10-25): each set holds only what this version BUILT. The values a deferred work package
 * owns (a skill increase taken anyway past its cap, lock or short list — WP12; a class-choice, tactic or rune place
 * removed — WP15-WP17) come after the record rebuild: a block holding one reads as made in a newer version.
 */
/** The pickers "Take anyway" reaches beyond the feat picker (`choice.allowAnywayAnyPicker`, C19). */
export const ANY_PICKERS = ['heritage', 'background', 'deity', 'subclass', 'spell', 'sanctification'] as const;
/** The rules "Pick from any list" lifts (`choice.anyList`, C22; one block per rule). */
export const ANY_LIST_RULES = ['list', 'level', 'onlyAtLevel'] as const;
/** The places "Add a place" adds (`choice.addPlace`, C14). */
export const ADD_PLACES = ['feat', 'skillIncrease', 'boost'] as const;
/** The places "Remove a place" removes (`remove.choicePlace`, C17 / C47). */
export const REMOVE_PLACES = ['feat', 'skillIncrease', 'boost'] as const;
/** A feat place's category (an extra place's key is `<level>:extra<category>:<n>`, C8). */
export const FEAT_PLACE_CATEGORIES = ['ancestry', 'class', 'general', 'skill', 'archetype', 'impulse', 'mythic', 'bonus'] as const;
/** The printed skill-increase lanes a removal names. */
export const REMOVE_SKILL_LANES = ['main', 'bonus', 'background'] as const;
/** The boost sets a removed boost place sits in (ancestryBoosts, backgroundBoosts, levelBoosts, attributeBoosts). */
export const BOOST_SETS = ['ancestry', 'background', 'free', 'level'] as const;
/** The questions "Change an answer" and "Edit a list" name (plan section 4b). */
export const ANSWER_QUESTIONS = ['skillSlot', 'backgroundSkill', 'subclassSkill', 'backgroundLore', 'choice', 'heritageResistance', 'keyAttribute'] as const;
/** The six attributes (a fixed set: an attribute outside it is unreadable, C3 rev 3 s7). */
export const ATTRIBUTE_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinalWord = (n: unknown): string => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? (ORDINALS[n] ?? `${n + 1}th`) : '?');
const BOOST_SET_WORDS: Record<string, string> = { ancestry: 'ancestry boost', background: 'background boost', free: 'free boost at level 1' };

/**
 * A choice place in plain words ("class feat place at level 4", "skill increase at level 5 (bonus)",
 * "attribute boost at level 10 (second)") — the one wording the Tweaks rows, the breakdown lines and the
 * Wanderer's Guide list share. `p` is a block's stored fields (an addPlace or a remove.choicePlace).
 * undefined for a place this version has no words for (`checkChoiceKinds` fails on one a kind accepts).
 * WP13: the class-choice, tactic and rune places (WP15-WP17) get their words with their work packages.
 */
export function placeWords(p: Record<string, unknown> | undefined): string | undefined {
  if (!p) return undefined;
  const at = typeof p.level === 'number' ? ` at level ${p.level}` : '';
  switch (p.place) {
    case 'feat': {
      // A removed slot past the first of its kind at its level says which (Dual Class's second class slot).
      const nth = typeof p.ordinal === 'number' && p.ordinal > 0 ? `${ordinalWord(p.ordinal)} ` : '';
      return `${nth}${typeof p.category === 'string' ? p.category : '?'} feat place${at}`;
    }
    case 'skillIncrease':
      return `skill increase${at}${typeof p.lane === 'string' && p.lane !== 'main' ? ` (${p.lane})` : ''}`;
    case 'boost': {
      const which = typeof p.index === 'number' ? ` (${ordinalWord(p.index)})` : '';
      if (typeof p.set === 'string' && p.set !== 'level') return `${BOOST_SET_WORDS[p.set] ?? `${p.set} boost`}${which}`;
      return `attribute boost${at}${which}`;
    }
    default:
      return undefined;
  }
}

/** A rule a choice tweak lifts, in plain words; undefined for a rule this version has no words for.
 *  WP13: a skill increase's cap, lock and short list (WP12) get their words with their work package. */
export function ruleWords(rule: unknown): string | undefined {
  switch (rule) {
    case 'list':
      return "the feat place's list";
    case 'level':
      return "the feat's level";
    case 'onlyAtLevel':
      return "the feat's only level";
    default:
      return undefined;
  }
}

/** A number that grows: today's `maxHpBonus` shape, and a printed formula (`landSpeedBonus: '5 + …'`). */
export type BlockValue = number | { perLevel?: number; flat?: number; perArchetypeFeat?: number; archetype?: string } | { formula: string };

export interface BlockSource {
  kind: SourceKind;
  /** The record id for a book block (`feats/peerless-form`); the stored key for a tweak. */
  id: string;
  /** Display name for the breakdown ("Peerless Form"). */
  name?: string;
}

/** When a block counts. Book-only gates reuse today's shapes (item 2): `whileActive.state`, the
 *  `EffectChoice` gates, `LimitedUses` come in later phases as their own catalog rows. */
export interface BlockGate {
  /** A `whileActive.state` value — the block counts only while that state is on (rage, panache). */
  whileState?: string;
  /** The character level the block starts at (feature 4's start level). */
  startLevel?: number;
}

/**
 * One block, as every reader sees it, whoever wrote it.
 *
 * `key` is FIXED: it stays the same after a data update, so feature 51 (switch off one bonus) and
 * decision 7 ("this and what it gave") can point at it later. A book block keys as record id + field +
 * target (`feats/peerless-form#saveBonuses@save:fortitude`); a tweak keys by its stored `<key>:<id>`
 * (`proficiencies:stealth`, `blocks:t3`). A repeat of the same key gets `~2`, `~3` (checker C15).
 */
export interface BlockInstance {
  kind: string;
  version: number;
  key: string;
  source: BlockSource;
  /** A TargetRef key (targets.ts) — number, rank and score blocks. */
  target?: string;
  /** A record id — grant, remove, allow and text blocks. */
  record?: string;
  value?: BlockValue;
  rank?: ProficiencyRank;
  /** A PF2e bonus type. Absent = untyped: a tweak +/- always adds (decision 15). */
  bonusType?: 'status' | 'circumstance' | 'item';
  /** Kind-specific extras that already exist in the stored shape (a given feat's level and category, a
   *  given spell's rank, a set's `baseline`). */
  params?: Record<string, unknown>;
  on: boolean;
  gate?: BlockGate;
  reason?: string;
  /** The stored entry cannot be read (a rank spelled 'Expert', a score that is not a number). It is
   *  still listed — shown broken with Remove, never skipped (decision 13; UNKNOWN ≠ EMPTY) — and never
   *  applied. The text says what is wrong. */
  broken?: string;
  /** An old-key entry stamped by an import (`meta.source: 'import'`, plan B B11): it was the character's
   *  own content before Tweaks existed, so it ignores the master switch (spec 2) — its own on/off still
   *  counts. Read from a meta whose `of` matches only. */
  imported?: true;
  /** An old-key entry moved from the old Overrides by the Builder-open stamp (`meta.moved`, decision 19,
   *  plan B B11 / B26): it keeps feeding the build's readers what the old `=` fed them until the player
   *  edits it (the writer drops the flag on the first edit). Read from a meta whose `of` matches only. */
  moved?: true;
  /** An old-key entry whose meta a NEWER app wrote in a shape this version does not know (a rank `mode`
   *  other than "at least" / "exactly"). The text says what it is. It is kept exactly as stored, never
   *  sorted at read time and never re-stamped (blocks/migrate.ts, blocks/save.ts), applied the way this
   *  version applies an old entry it cannot sort (today's `=`, plan B B2), and listed read-only on the
   *  Tweaks page under "Made in a newer version". Read from a meta whose `of` matches only. */
  newer?: string;
}

/** Where a kind is stored inside `Character.overrides`. A kind that wraps one of today's 10 keys reads
 *  and writes THAT key, plus `overrides.meta['<key>:<id>']` for reason / on / start level (checker C3), so
 *  an older app still sees it. Only the new number kinds and the phase-2 choice kinds live in
 *  `overrides.blocks`. */
export type BlockStorage =
  | { in: 'blocks' }
  | {
      in: 'legacy';
      key: 'allowedFeats' | 'addedFeats' | 'addedFeatures' | 'removedFeatIds' | 'attributes' | 'proficiencies' | 'addedLanguages' | 'addedSpells' | 'maxHp' | 'contentEdits';
    };

/** What a kind can point at: targets of one aspect (optionally only some kinds of stat), or records — and,
 *  for the phase-2 choice kinds, the pickers "Take anyway" reaches, the choice places a place tweak adds or
 *  removes, or the questions an answer tweak names (plan WP1). Each list is that field's closed set (C3). */
export type BlockAccepts =
  | { aspect: TargetAspect; kinds: TargetKind[] }
  | { records: ('feats' | 'classFeatures' | 'languages' | 'spells')[] }
  | { pickers: readonly string[] }
  | { places: readonly string[] }
  | { questions: readonly string[] };

export interface BlockEditor {
  place: 'main' | 'advanced';
  /** The "Add a tweak" entries that open this editor (the look samples' kind buttons). */
  menus: string[];
  parts: EditorPart[];
  /** Parts shown only after "Advanced" is opened inside the editor (feature 6's bonus type). */
  advancedParts?: EditorPart[];
  /** The chooser label when one menu holds two or more kinds for the same target ("Set to" / "At least",
   *  "At least" / "Exactly"; plan B, B19). Required on every kind that shares a menu with another kind
   *  accepting the same target kind — `checkBlocks` fails without it, or on two equal labels. */
  option?: string;
  /** The Tweaks screen has this editor (part B builds the screen). */
  built: boolean;
}

/**
 * The Tweaks page's list headings (decision 29; plan B, B19), in the order the page shows them. Every kind
 * names its own `group`; `checkBlocks` fails on a group not listed here. The rows a newer app wrote (or this
 * version cannot read) are listed last, under NEWER_TWEAKS_GROUP.
 */
export const TWEAK_GROUPS = ['Numbers', 'Ranks', 'Feats', 'Choices', 'Class features', 'Languages', 'Spells', 'Text'] as const;
export type TweakGroup = (typeof TWEAK_GROUPS)[number];
export const NEWER_TWEAKS_GROUP = 'Made in a newer version';

export interface BlockKindDef {
  id: string;
  family: BlockFamily;
  title: string;
  /** The Tweaks page heading its rows are listed under (TWEAK_GROUPS; plan B, B19). */
  group: TweakGroup;
  /** The stored shape's version. A newer stored version is kept untouched (item 13); an older one is
   *  migrated at read time only (spec item 3). */
  version: number;
  storage: BlockStorage;
  /** Two seams (item 7): shape blocks (and attribute scores) apply inside `buildCharacter`; number
   *  blocks through the term lists; text edits through the one content path. */
  seam: 'build' | 'derive' | 'content';
  slot: OrderSlot;
  accepts: BlockAccepts;
  /** Phase 2: the closed set of a choice kind's `rule` field (C3), each with its words (`ruleWords`). */
  rules?: readonly string[];
  /** Who may author it. Book kinds list the record fields their book blocks are read from (item 10). */
  sources: SourceKind[];
  bookFields?: string[];
  /** The breakdown wording (spec item 7): "Tweak: +1 (reason)", "Tweak: set to 20 (reason)". */
  line: (b: BlockInstance) => string;
  /** The Tweaks editor, or null for a kind no player writes. Until the editor is on the screen
   *  (`built: true`), or when it is null, the id must be on STILL_TO_ADD with a reason (decision 24). */
  editor: BlockEditor | null;
  /** Decision 13: a block whose record or target is missing shows with "Remove" and "Point to
   *  another" and is never dropped. The only allowed value, written per entry so a new kind states it. */
  missing: 'show-broken';
  /** How the block reaches the character today: through the block seams ('blocks'), still through
   *  today's Overrides code that reads the old key directly ('legacy'), or not yet at all ('not-yet').
   *  `scripts/blocks-check.mjs` prints the not-yet ones. */
  applies: 'blocks' | 'legacy' | 'not-yet';
  /** The test file that covers it; the check requires the file to exist and to name the id. */
  test: string;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
const why = (b: BlockInstance) => (b.reason ? ` (${b.reason})` : '');
const valueText = (v: BlockValue | undefined): string => {
  if (typeof v === 'number') return signed(v);
  if (!v) return '';
  if ('formula' in v) return v.formula;
  const parts: string[] = [];
  if (v.flat) parts.push(signed(v.flat));
  if (v.perLevel) parts.push(`${signed(v.perLevel)} per level`);
  if (v.perArchetypeFeat) parts.push(`${signed(v.perArchetypeFeat)} per ${v.archetype ?? 'archetype'} feat`);
  return parts.join(', ');
};
/** A book block's line is its record's name (today's breakdown wording); a tweak's says "Tweak:". */
const bookOr = (b: BlockInstance, tweak: string): string =>
  b.source.kind === 'book' ? (b.source.name ?? b.source.id) : `Tweak: ${tweak}${why(b)}`;

/** Every number target of phase 1 except the two whose "set" wraps an old key of its own. */
const SETTABLE_NUMBERS: TargetKind[] = ['ac', 'save', 'perception', 'skill', 'class-dc', 'initiative', 'spell-attack', 'spell-dc', 'speed'];
/** The tracks `overrides.proficiencies` can hold (build.ts's override loop). A casting entry's own rank
 *  is NOT one of them: stored there it would become a fake skill; it is phase 5 (feature 49). */
const RANK_TRACKS: TargetKind[] = ['skill', 'save', 'perception', 'class-dc', 'weapon', 'armor'];
const REGISTRY_TEST = 'test/blocks-registry.test.ts';
/** The applying kinds' own tests (part A, Building blocks items 4–6). */
const SET_POOLING_TEST = 'test/blocks-set-pooling.test.ts';
const GENERIC_STEP_TEST = 'test/blocks-generic-step.test.ts';
/** The rank seams' own test (Building blocks item 8); the generic step test covers each rank kind too. */
const RANK_SEAMS_TEST = 'test/blocks-rank-seams.test.ts';
/** Tweaks phase 2: the choice kinds' store / read / round-trip test (plan WP1). */
const P2_STORE_TEST = 'test/tweaks-p2-store.test.ts';

export const BLOCK_KINDS: BlockKindDef[] = [
  {
    id: 'number.add',
    family: 'number',
    title: 'Bonus or penalty',
    group: 'Numbers',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'derive',
    slot: 'add',
    accepts: { aspect: 'number', kinds: [...SETTABLE_NUMBERS, 'max-hp'] },
    sources: ['book', 'tweak', 'homebrew'],
    // Item 10: the fields whose READERS moved onto book blocks (blocks/book.ts), deeper copies included.
    // `scripts/blocks-check.mjs` fails on a read of any of them outside book.ts (check.ts
    // checkBookFieldReaders), so no field has two code paths.
    bookFields: [
      'saveBonuses',
      'landSpeedBonus',
      'speedBonusType',
      'speedBonusAllSpeeds',
      'maxHpBonus',
      'passiveEffects.skills',
      'whileActive.landSpeedBonus',
      'whileActive.speedBonusType',
      'whileActive.speedBonusAllSpeeds',
      'effectChoices.grant.passive.skills',
    ],
    line: (b) => bookOr(b, `${valueText(b.value)}${b.bonusType ? ` ${b.bonusType}` : ''}`),
    editor: { place: 'main', menus: ['Bonus or penalty'], parts: ['target', 'number', 'level', 'reason'], advancedParts: ['bonusType'], built: true },
    missing: 'show-broken',
    // Tweak blocks reach the term lists in derive.ts through blocks/active.ts (spec items 6–8); the book
    // fields above reach them as book blocks (blocks/book.ts, item 10) — saves, Speeds, max HP and the
    // item skill bonuses/penalties read `bookBlocksOf`, never the fields.
    applies: 'blocks',
    test: GENERIC_STEP_TEST,
  },
  {
    // A +/- on an attribute changes the SCORE (spec item 8), at build time — its own kind so the
    // seam is fixed by the kind, not guessed from the target.
    id: 'attribute.add',
    family: 'attribute',
    title: 'Raise or lower an attribute score',
    group: 'Numbers',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'add',
    accepts: { aspect: 'score', kinds: ['score'] },
    sources: ['tweak', 'homebrew'],
    line: (b) => bookOr(b, valueText(b.value)),
    editor: { place: 'main', menus: ['Bonus or penalty'], parts: ['target', 'number', 'level', 'reason'], built: true },
    missing: 'show-broken',
    // Applied to the score inside buildCharacter (build.ts, after the legacy attribute set).
    applies: 'blocks',
    test: GENERIC_STEP_TEST,
  },
  {
    id: 'number.set',
    family: 'number',
    title: 'Set a number',
    group: 'Numbers',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'derive',
    slot: 'set',
    accepts: { aspect: 'number', kinds: SETTABLE_NUMBERS },
    sources: ['tweak', 'homebrew'],
    line: (b) => bookOr(b, `set to ${typeof b.value === 'number' ? b.value : valueText(b.value)}`),
    editor: { place: 'main', menus: ['Set a number'], parts: ['target', 'number', 'level', 'reason'], option: 'Set to', built: true },
    missing: 'show-broken',
    // blocks/terms.ts resolveTerms — THE ONE "SET AND POOLING" RULE.
    applies: 'blocks',
    test: SET_POOLING_TEST,
  },
  {
    // Before number.atLeast on purpose (plan B WP7): "Set a number" → Maximum HP opens on its first kind in
    // registry order that accepts the target (the shared-menu rule), and "Set to" is that menu's default
    // for every other number too.
    id: 'number.setMaxHp',
    family: 'number',
    title: 'Set maximum HP',
    group: 'Numbers',
    version: 1,
    storage: { in: 'legacy', key: 'maxHp' },
    seam: 'derive',
    slot: 'set',
    accepts: { aspect: 'number', kinds: ['max-hp'] },
    sources: ['tweak'],
    line: (b) => `Tweak: set to ${typeof b.value === 'number' ? b.value : valueText(b.value)}${why(b)}`,
    editor: { place: 'main', menus: ['Set a number'], parts: ['number', 'level', 'reason'], option: 'Set to', built: true },
    missing: 'show-broken',
    // Plan B WP3 (spec 2 case C): a 'set' term of the max-HP list (blocks/active.ts `activeNumberBlocks` /
    // `maxHpTweakTerms`), so a max-HP mode, a Con mode and Drained apply on top; deriveMaxHp has no early return.
    applies: 'blocks',
    test: 'test/tweaks-max-hp-set.test.ts',
  },
  {
    id: 'number.atLeast',
    family: 'number',
    title: 'Set a number: at least N',
    group: 'Numbers',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'derive',
    slot: 'atLeast',
    accepts: { aspect: 'number', kinds: [...SETTABLE_NUMBERS, 'max-hp'] },
    sources: ['tweak', 'homebrew'],
    line: (b) => bookOr(b, `at least ${typeof b.value === 'number' ? b.value : valueText(b.value)}`),
    editor: { place: 'main', menus: ['Set a number'], parts: ['target', 'number', 'level', 'reason'], option: 'At least', built: true },
    missing: 'show-broken',
    // blocks/terms.ts resolveTerms — acts as a set only when the permanent part is below N.
    applies: 'blocks',
    test: SET_POOLING_TEST,
  },
  {
    id: 'attribute.set',
    family: 'attribute',
    title: 'Set an attribute score',
    group: 'Numbers',
    version: 1,
    storage: { in: 'legacy', key: 'attributes' },
    seam: 'build',
    slot: 'set',
    accepts: { aspect: 'score', kinds: ['score'] },
    sources: ['tweak'],
    line: (b) => `Tweak: set to ${typeof b.value === 'number' ? b.value : valueText(b.value)}${why(b)}`,
    editor: { place: 'main', menus: ['Set a number'], parts: ['target', 'number', 'level', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: build.ts's attribute seam reads blocks/active.ts `liveAttributeSets` (switch, on/off,
    // start level); the Builder's lock icon reads the same accessor.
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  {
    id: 'rank.atLeast',
    family: 'rank',
    title: 'Rank: at least',
    group: 'Ranks',
    version: 1,
    storage: { in: 'legacy', key: 'proficiencies' },
    seam: 'build',
    slot: 'atLeast',
    accepts: { aspect: 'rank', kinds: RANK_TRACKS },
    sources: ['book', 'tweak', 'homebrew'],
    // Item 10: a background's printed training is read as book blocks (blocks/book.ts
    // backgroundTrainings) by the build, the Builder card and the skill timeline. The tweak side is an
    // `overrides.proficiencies` entry whose meta says mode 'atLeast' (stored.ts sorts it).
    bookFields: ['trainedSkill', 'trainedLore'],
    line: (b) => bookOr(b, `at least ${b.rank ?? '?'}`),
    editor: { place: 'main', menus: ['Rank (skill, save…)', 'Add a Lore'], parts: ['target', 'rank', 'level', 'reason'], option: 'At least', built: true },
    missing: 'show-broken',
    // Item 8, the rank seams in buildCharacter, read through blocks/active.ts `rankTweaks`: a skill or
    // Lore floor seeded before the skill-increase loop (start level inside the loop); a save,
    // Perception, class DC, weapon or armor floor with maxRank at the old override loop.
    applies: 'blocks',
    test: RANK_SEAMS_TEST,
  },
  {
    id: 'rank.exactly',
    family: 'rank',
    title: 'Rank: exactly',
    group: 'Ranks',
    version: 1,
    storage: { in: 'legacy', key: 'proficiencies' },
    seam: 'build',
    slot: 'set',
    accepts: { aspect: 'rank', kinds: RANK_TRACKS },
    sources: ['tweak'],
    line: (b) => `Tweak: exactly ${b.rank ?? '?'}${why(b)}`,
    // 'Add a Lore' too (plan B WP6): a Lore you add can be held "exactly" as well as raised "at least".
    editor: { place: 'main', menus: ['Rank (skill, save…)', 'Add a Lore'], parts: ['target', 'rank', 'level', 'reason'], option: 'Exactly', built: true },
    missing: 'show-broken',
    // Item 8: ONE clamp just before buildCharacter's Character literal, after every maxRank raise
    // (blocks/active.ts `rankTweaks`). Its limit (checker C16) is written beside the clamp.
    applies: 'blocks',
    test: RANK_SEAMS_TEST,
  },
  {
    // An old `overrides.proficiencies` entry with no "at least" / "exactly" recorded. Today's override
    // loop sets it with `=` (a later FEAT_GRANTS raise can still lift it). It is neither of the two new
    // kinds, so it is its own: no code can mistake it for an "exactly" and clamp it last (checker C2).
    // Part B sorts each one into atLeast or exactly at read time (blocks/migrate.ts, build.ts
    // `legacyRankSort`); what is left here is the entry the sort cannot take (B2: an unreadable rank, a key
    // that names no rank track, a bare `lore:Lore`), still today's `=`. No player writes this kind.
    id: 'rank.legacySet',
    family: 'rank',
    title: 'Old rank, kept as it was',
    group: 'Ranks',
    version: 1,
    storage: { in: 'legacy', key: 'proficiencies' },
    seam: 'build',
    slot: 'set',
    accepts: { aspect: 'rank', kinds: RANK_TRACKS },
    sources: ['tweak'],
    line: (b) => `Tweak: set to ${b.rank ?? '?'}${why(b)}`,
    editor: null,
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'grant.feat',
    family: 'grant',
    title: 'Give a feat',
    group: 'Feats',
    version: 1,
    storage: { in: 'legacy', key: 'addedFeats' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'main', menus: ['Give a feat'], parts: ['record', 'level', 'reason'], built: true },
    missing: 'show-broken',
    // Case D (Building blocks item 9): read through blocks/stored.ts `activeGivenFeats` (on, not broken,
    // start level max(level, meta.from), master switch) and src/rules/heldFeats.ts, which every rules
    // walker that read `featPicks` alone now asks — a given feat works like the same feat picked.
    applies: 'blocks',
    test: 'test/given-feat-like-picked.test.ts',
  },
  {
    id: 'grant.language',
    family: 'grant',
    title: 'Add a language',
    group: 'Languages',
    version: 1,
    storage: { in: 'legacy', key: 'addedLanguages' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['languages'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'main', menus: ['Add a language'], parts: ['record', 'level', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: blocks/active.ts `liveGivenLanguages`.
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  {
    id: 'grant.spell',
    family: 'grant',
    title: 'Add a spell',
    group: 'Spells',
    version: 1,
    storage: { in: 'legacy', key: 'addedSpells' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['spells'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'main', menus: ['Add a spell'], parts: ['record', 'number', 'level', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: blocks/active.ts `liveGivenSpells` (the "Added spells" entry in build.ts, the Rituals
    // section in SpellsTab.tsx).
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  {
    // Stored and listed from phase 1; making a given class feature work like a picked one is phase 3
    // (problem 3, Building blocks item 9).
    id: 'grant.classFeature',
    family: 'grant',
    title: 'Give a class feature',
    group: 'Class features',
    version: 1,
    storage: { in: 'legacy', key: 'addedFeatures' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['classFeatures'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'advanced', menus: ['Give a class feature'], parts: ['record', 'level', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: blocks/active.ts `liveGivenFeatures` (listed from max(stored level, start level)).
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  {
    id: 'remove.feat',
    family: 'remove',
    title: 'Remove a feat the build gave',
    group: 'Feats',
    version: 1,
    storage: { in: 'legacy', key: 'removedFeatIds' },
    seam: 'build',
    slot: 'replace',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    line: (b) => `Tweak: removed${why(b)}`,
    editor: { place: 'advanced', menus: ['Remove something'], parts: ['record', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: blocks/active.ts `liveRemovedFeatIds` (build.ts's removal reads and heldFeats.ts).
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  {
    id: 'choice.allowAnyway',
    family: 'choice',
    title: 'Take anyway in a picker',
    // Tweaks phase 2, C2: one family under one heading — every "Take anyway" and choice tweak is a Choice.
    group: 'Choices',
    version: 1,
    storage: { in: 'legacy', key: 'allowedFeats' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    line: (b) => `Tweak: taken anyway${why(b)}`,
    editor: { place: 'advanced', menus: ['"Take anyway" in a picker'], parts: ['record', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: blocks/active.ts `isAllowedAnyway` (the Builder's re-validation warning and picker).
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  {
    id: 'text.edit',
    family: 'text',
    title: "Change a feat's or class feature's name or text",
    group: 'Text',
    version: 1,
    storage: { in: 'legacy', key: 'contentEdits' },
    seam: 'content',
    slot: 'replace',
    accepts: { records: ['feats', 'classFeatures'] },
    sources: ['tweak'],
    line: (b) => `Tweak: your text${why(b)}`,
    editor: { place: 'advanced', menus: ['Change a description or name'], parts: ['record', 'text', 'reason'], built: true },
    missing: 'show-broken',
    // Plan B WP2: the one content path (blocks/content.ts `contentFor`) lays blocks/active.ts
    // `liveContentEdits` over the database.
    applies: 'blocks',
    test: REGISTRY_TEST,
  },
  /*
   * ─── Tweaks phase 2: the seven choice kinds (work/tweaks-phase2-notes/plan.md, WP1; decisions C1–C4) ───
   * Each lives in `overrides.blocks` (stored.ts reads it with its own field list and closed sets), has no start
   * level (C31: no 'level' part), and is read only through blocks/active.ts's choice accessors. WP1 stored, read,
   * round-tripped and printed all seven; WP4-WP14 built five. WP13 (re-scoped 2026-10-25): the two kinds nothing
   * applies yet (`applies: 'not-yet'`, `built: false`, STILL_TO_ADD) come after the record rebuild, and until then a
   * stored one reads as made in a newer version (stored.ts): kept as it is, never shown as a working tweak.
   */
  {
    id: 'choice.allowAnywayAnyPicker',
    family: 'choice',
    title: 'Take anyway in another picker',
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'add',
    accepts: { pickers: ANY_PICKERS },
    sources: ['tweak'],
    bookFields: [],
    line: (b) => {
      const p = b.params ?? {};
      if (p.picker === 'sanctification') return `Tweak: ${typeof p.value === 'string' ? p.value : '?'} allowed anyway${why(b)}`;
      return `Tweak: taken anyway${why(b)}`;
    },
    // Section 2b: the answer part is drawn for a sanctification only. WP4 opened the menu: heritage, background,
    // deity, subclass, spell and sanctification. WP13: a skill increase taken anyway (its place and rule parts, its
    // cap / locked / narrowed rules) is WP12, after the record rebuild — no picker, rule or part of it is here.
    editor: { place: 'advanced', menus: ['"Take anyway" in another picker'], parts: ['picker', 'record', 'answer', 'reason'], built: true },
    missing: 'show-broken',
    applies: 'blocks',
    test: P2_STORE_TEST,
  },
  {
    id: 'choice.anyList',
    family: 'choice',
    title: 'Pick a feat from any list',
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['feats'] },
    rules: ANY_LIST_RULES,
    sources: ['tweak'],
    bookFields: [],
    line: (b) => `Tweak: allowed past ${ruleWords(b.params?.rule) ?? 'its rule'}${why(b)}`,
    // WP5: `slotTakes` / `pickableFeats` lift each live block's rule (featSlots.ts `slotRefusal`, featPickGrants.ts
    // `pickRefusal`); the pickers' "Search every feat" + "Allow here" and the Tweaks page Add both write it.
    editor: { place: 'advanced', menus: ['Pick from any list'], parts: ['record', 'rule', 'reason'], built: true },
    missing: 'show-broken',
    applies: 'blocks',
    test: 'test/tweaks-p2-any-list.test.tsx',
  },
  {
    // Decision 17 / C2: "Fleet twice" (a take cap) is its own rule, seam and pause effect, so its own kind.
    id: 'choice.moreTakes',
    family: 'choice',
    title: 'Take a feat more times',
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    bookFields: [],
    line: (b) => {
      const n = typeof b.params?.times === 'number' ? b.params.times : 1;
      return `Tweak: may be taken ${n} more time${n === 1 ? '' : 's'}${why(b)}`;
    },
    // WP8: `takesAllowed` (featGrants.ts) raises the take cap at the featPicks loop, `slotRefusal` and `slotKept`, and
    // `givenCopyCounts` lets a given feat count beside a slot copy (round 4, F1); the slot and place pickers' "Take
    // again" and the Tweaks page Add both write it (one block per feat, D1).
    editor: { place: 'advanced', menus: ['Take a feat more times'], parts: ['record', 'count', 'reason'], built: true },
    missing: 'show-broken',
    applies: 'blocks',
    test: 'test/tweaks-p2-more-takes.test.ts',
  },
  {
    id: 'choice.addPlace',
    family: 'choice',
    title: 'Add a choice place',
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'add',
    accepts: { places: ADD_PLACES },
    sources: ['tweak'],
    bookFields: [],
    line: (b) => `Tweak: extra ${placeWords(b.params) ?? 'place'}${why(b)}`,
    // C31: no start level — the place part holds the place's own level. tweaks p2 WP7: built for the extra FEAT place
    // (the level page's "Add a place" and its place card, this menu). WP11: the extra skill increase and boost places
    // (carriers: build.ts's tweak lane and `collectBoosts`, both through blocks/active.ts `liveCarriers`), their cards,
    // and this menu's place kind and answer part.
    editor: { place: 'main', menus: ['Add a place'], parts: ['place', 'answer', 'reason'], built: true },
    missing: 'show-broken',
    applies: 'blocks',
    test: 'test/tweaks-p2-place-card.test.tsx',
  },
  {
    id: 'remove.choicePlace',
    family: 'remove',
    title: 'Remove a choice place',
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'replace',
    accepts: { places: REMOVE_PLACES },
    sources: ['tweak'],
    bookFields: [],
    line: (b) => `Tweak: removed ${placeWords(b.params) ?? 'a place'}${why(b)}`,
    // tweaks p2 WP6: a printed feat slot. WP14: a printed skill increase (main, bonus, background lane) and a boost
    // place (ancestry, background, free, a level set) — build.ts's skill loop and `collectBoosts` through
    // blocks/active.ts `removedSkillIncreasePlaces` / `countingBoostPicks`. WP13: a class-choice place (WP16), a tactic
    // or a rune place (WP17) come after the record rebuild; a stored one reads as made in a newer version.
    editor: { place: 'advanced', menus: ['Remove a place'], parts: ['place', 'reason'], built: true },
    missing: 'show-broken',
    applies: 'blocks',
    test: 'test/tweaks-p2-remove-place.test.tsx',
  },
  {
    id: 'choice.changeAnswer',
    family: 'choice',
    title: 'Answer a choice outside its list',
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'replace',
    accepts: { questions: ANSWER_QUESTIONS },
    sources: ['tweak'],
    bookFields: [],
    line: (b) => `Tweak: answered ${typeof b.params?.value === 'string' ? b.params.value : '?'}, outside the list${why(b)}`,
    editor: { place: 'advanced', menus: ['Change an answer'], parts: ['question', 'answer', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'not-yet',
    test: P2_STORE_TEST,
  },
  {
    id: 'choice.editOptions',
    family: 'choice',
    title: "Edit a choice's list",
    group: 'Choices',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'replace',
    accepts: { questions: ANSWER_QUESTIONS },
    sources: ['tweak'],
    // C38: no book field moves onto this kind (it reads none as a block).
    bookFields: [],
    line: (b) => {
      const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
      const parts = [...list(b.params?.add).map((s) => `+ ${s}`), ...list(b.params?.remove).map((s) => `− ${s}`)];
      return `Tweak: list edited${parts.length ? ` (${parts.join(', ')})` : ''}${why(b)}`;
    },
    editor: { place: 'advanced', menus: ['Edit a list'], parts: ['question', 'options', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'not-yet',
    test: P2_STORE_TEST,
  },
];

/** A phase-2 choice kind: stored in `overrides.blocks` and pointing at no number target (pickers, places,
 *  questions or records). Every other `blocks` kind is a number kind on an aspect. */
export const isChoiceKind = (def: BlockKindDef | undefined): boolean => !!def && def.storage.in === 'blocks' && !('aspect' in def.accepts);

/**
 * Registry kinds not in Tweaks yet, each with the reason (decision 24): "the app's automatic check lists
 * every block that is not in Tweaks yet". A kind whose editor is not on the screen MUST be here; the check
 * fails on a line whose editor is built. Plan B WP7 built every phase-1 editor (src/builder/tweaks/
 * TweakEditor.tsx, assembled from each entry's parts); test/tweaks-screen-registry.test.tsx checks that every
 * built kind's menus are really on the Tweaks page and open exactly its parts.
 */
export const STILL_TO_ADD: { id: string; why: string }[] = [
  { id: 'rank.legacySet', why: "Never a new tweak: part B sorts each old entry into 'at least' or 'exactly' when it is read" },
  // Tweaks phase 2: registered, not applied and not on the Tweaks page — each line names the work package that
  // builds its editor and its seam. WP13 (re-scoped 2026-10-25): both wait for the record rebuild; until then a
  // stored one reads as made in a newer version (stored.ts), kept as it is.
  { id: 'choice.changeAnswer', why: 'Comes after the record rebuild: WP10 builds "Change an answer"' },
  { id: 'choice.editOptions', why: 'Comes after the record rebuild: WP9 steps 1-3 build "Edit a list"' },
];

const BY_ID = new Map(BLOCK_KINDS.map((k) => [k.id, k]));
export const blockKind = (id: string): BlockKindDef | undefined => BY_ID.get(id);
