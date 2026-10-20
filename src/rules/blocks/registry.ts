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

/** The shared editor parts a Tweaks editor is put together from (decision 23). */
export const EDITOR_PARTS = ['target', 'number', 'bonusType', 'rank', 'record', 'text', 'level', 'reason'] as const;
export type EditorPart = (typeof EDITOR_PARTS)[number];

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
}

/** Where a kind is stored inside `Character.overrides`. A kind that wraps one of today's 10 keys reads
 *  and writes THAT key, plus `overrides.meta['<key>:<id>']` for reason / on / start level (checker C3), so
 *  an older app still sees it. Only the new number kinds live in `overrides.blocks`. */
export type BlockStorage =
  | { in: 'blocks' }
  | {
      in: 'legacy';
      key: 'allowedFeats' | 'addedFeats' | 'addedFeatures' | 'removedFeatIds' | 'attributes' | 'proficiencies' | 'addedLanguages' | 'addedSpells' | 'maxHp' | 'contentEdits';
    };

/** What a kind can point at: targets of one aspect (optionally only some kinds of stat), or records. */
export type BlockAccepts =
  | { aspect: TargetAspect; kinds: TargetKind[] }
  | { records: ('feats' | 'classFeatures' | 'languages' | 'spells')[] };

export interface BlockEditor {
  place: 'main' | 'advanced';
  /** The "Add a tweak" entries that open this editor (the look samples' kind buttons). */
  menus: string[];
  parts: EditorPart[];
  /** Parts shown only after "Advanced" is opened inside the editor (feature 6's bonus type). */
  advancedParts?: EditorPart[];
  /** The Tweaks screen has this editor (part B builds the screen). */
  built: boolean;
}

export interface BlockKindDef {
  id: string;
  family: BlockFamily;
  title: string;
  /** The stored shape's version. A newer stored version is kept untouched (item 13); an older one is
   *  migrated at read time only (spec item 3). */
  version: number;
  storage: BlockStorage;
  /** Two seams (item 7): shape blocks (and attribute scores) apply inside `buildCharacter`; number
   *  blocks through the term lists; text edits through the one content path. */
  seam: 'build' | 'derive' | 'content';
  slot: OrderSlot;
  accepts: BlockAccepts;
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

export const BLOCK_KINDS: BlockKindDef[] = [
  {
    id: 'number.add',
    family: 'number',
    title: 'Bonus or penalty',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'derive',
    slot: 'add',
    accepts: { aspect: 'number', kinds: [...SETTABLE_NUMBERS, 'max-hp'] },
    sources: ['book', 'tweak', 'homebrew'],
    // Item 10: the readers that move onto blocks, deeper copies included.
    bookFields: [
      'saveBonuses',
      'landSpeedBonus',
      'speedBonusType',
      'maxHpBonus',
      'passiveEffects.skills',
      'whileActive.landSpeedBonus',
      'whileActive.speedBonusType',
      'effectChoices.grant.passive.skills',
    ],
    line: (b) => bookOr(b, `${valueText(b.value)}${b.bonusType ? ` ${b.bonusType}` : ''}`),
    editor: { place: 'main', menus: ['Bonus or penalty'], parts: ['target', 'number', 'level', 'reason'], advancedParts: ['bonusType'], built: false },
    missing: 'show-broken',
    applies: 'not-yet',
    test: REGISTRY_TEST,
  },
  {
    // A +/- on an attribute changes the SCORE (spec item 8), at build time — its own kind so the
    // seam is fixed by the kind, not guessed from the target.
    id: 'attribute.add',
    family: 'attribute',
    title: 'Raise or lower an attribute score',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'build',
    slot: 'add',
    accepts: { aspect: 'score', kinds: ['score'] },
    sources: ['tweak', 'homebrew'],
    line: (b) => bookOr(b, valueText(b.value)),
    editor: { place: 'main', menus: ['Bonus or penalty'], parts: ['target', 'number', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'not-yet',
    test: REGISTRY_TEST,
  },
  {
    id: 'number.set',
    family: 'number',
    title: 'Set a number',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'derive',
    slot: 'set',
    accepts: { aspect: 'number', kinds: SETTABLE_NUMBERS },
    sources: ['tweak', 'homebrew'],
    line: (b) => bookOr(b, `set to ${typeof b.value === 'number' ? b.value : valueText(b.value)}`),
    editor: { place: 'main', menus: ['Set a number'], parts: ['target', 'number', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'not-yet',
    test: REGISTRY_TEST,
  },
  {
    id: 'number.atLeast',
    family: 'number',
    title: 'Set a number: at least N',
    version: 1,
    storage: { in: 'blocks' },
    seam: 'derive',
    slot: 'atLeast',
    accepts: { aspect: 'number', kinds: [...SETTABLE_NUMBERS, 'max-hp'] },
    sources: ['tweak', 'homebrew'],
    line: (b) => bookOr(b, `at least ${typeof b.value === 'number' ? b.value : valueText(b.value)}`),
    editor: { place: 'main', menus: ['Set a number'], parts: ['target', 'number', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'not-yet',
    test: REGISTRY_TEST,
  },
  {
    id: 'number.setMaxHp',
    family: 'number',
    title: 'Set maximum HP',
    version: 1,
    storage: { in: 'legacy', key: 'maxHp' },
    seam: 'derive',
    slot: 'set',
    accepts: { aspect: 'number', kinds: ['max-hp'] },
    sources: ['tweak'],
    line: (b) => `Tweak: set to ${typeof b.value === 'number' ? b.value : valueText(b.value)}${why(b)}`,
    editor: { place: 'main', menus: ['Set a number'], parts: ['number', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'attribute.set',
    family: 'attribute',
    title: 'Set an attribute score',
    version: 1,
    storage: { in: 'legacy', key: 'attributes' },
    seam: 'build',
    slot: 'set',
    accepts: { aspect: 'score', kinds: ['score'] },
    sources: ['tweak'],
    line: (b) => `Tweak: set to ${typeof b.value === 'number' ? b.value : valueText(b.value)}${why(b)}`,
    editor: { place: 'main', menus: ['Set a number'], parts: ['target', 'number', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'rank.atLeast',
    family: 'rank',
    title: 'Rank: at least',
    version: 1,
    storage: { in: 'legacy', key: 'proficiencies' },
    seam: 'build',
    slot: 'atLeast',
    accepts: { aspect: 'rank', kinds: RANK_TRACKS },
    sources: ['book', 'tweak', 'homebrew'],
    bookFields: ['trainedSkill', 'trainedLore'],
    line: (b) => bookOr(b, `at least ${b.rank ?? '?'}`),
    editor: { place: 'main', menus: ['Rank (skill, save…)', 'Add a Lore'], parts: ['target', 'rank', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'rank.exactly',
    family: 'rank',
    title: 'Rank: exactly',
    version: 1,
    storage: { in: 'legacy', key: 'proficiencies' },
    seam: 'build',
    slot: 'set',
    accepts: { aspect: 'rank', kinds: RANK_TRACKS },
    sources: ['tweak'],
    line: (b) => `Tweak: exactly ${b.rank ?? '?'}${why(b)}`,
    editor: { place: 'main', menus: ['Rank (skill, save…)'], parts: ['target', 'rank', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    // An old `overrides.proficiencies` entry with no "at least" / "exactly" recorded. Today's override
    // loop sets it with `=` (a later FEAT_GRANTS raise can still lift it). It is neither of the two new
    // kinds, so it is its own: no code can mistake it for an "exactly" and clamp it last (checker C2).
    // Part B sorts each one into atLeast or exactly at read time; no player writes this kind.
    id: 'rank.legacySet',
    family: 'rank',
    title: 'Rank set by the old Overrides (not sorted yet)',
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
    version: 1,
    storage: { in: 'legacy', key: 'addedFeats' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'main', menus: ['Give a feat'], parts: ['record', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'grant.language',
    family: 'grant',
    title: 'Add a language',
    version: 1,
    storage: { in: 'legacy', key: 'addedLanguages' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['languages'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'main', menus: ['Add a language'], parts: ['record', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'grant.spell',
    family: 'grant',
    title: 'Add a spell',
    version: 1,
    storage: { in: 'legacy', key: 'addedSpells' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['spells'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'main', menus: ['Add a spell'], parts: ['record', 'number', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    // Stored and listed from phase 1; making a given class feature work like a picked one is phase 3
    // (problem 3, Building blocks item 9).
    id: 'grant.classFeature',
    family: 'grant',
    title: 'Give a class feature',
    version: 1,
    storage: { in: 'legacy', key: 'addedFeatures' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['classFeatures'] },
    sources: ['tweak'],
    line: (b) => `Tweak: given${why(b)}`,
    editor: { place: 'advanced', menus: ['Give a class feature'], parts: ['record', 'level', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'remove.feat',
    family: 'remove',
    title: 'Remove a feat the build gave',
    version: 1,
    storage: { in: 'legacy', key: 'removedFeatIds' },
    seam: 'build',
    slot: 'replace',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    line: (b) => `Tweak: removed${why(b)}`,
    editor: { place: 'advanced', menus: ['Remove something'], parts: ['record', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'choice.allowAnyway',
    family: 'choice',
    title: 'Take anyway in a picker',
    version: 1,
    storage: { in: 'legacy', key: 'allowedFeats' },
    seam: 'build',
    slot: 'add',
    accepts: { records: ['feats'] },
    sources: ['tweak'],
    line: (b) => `Tweak: taken anyway${why(b)}`,
    editor: { place: 'advanced', menus: ['"Take anyway" in a picker'], parts: ['record', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
  {
    id: 'text.edit',
    family: 'text',
    title: "Change a feat's or class feature's name or text",
    version: 1,
    storage: { in: 'legacy', key: 'contentEdits' },
    seam: 'content',
    slot: 'replace',
    accepts: { records: ['feats', 'classFeatures'] },
    sources: ['tweak'],
    line: (b) => `Tweak: your text${why(b)}`,
    editor: { place: 'advanced', menus: ['Change a description or name'], parts: ['record', 'text', 'reason'], built: false },
    missing: 'show-broken',
    applies: 'legacy',
    test: REGISTRY_TEST,
  },
];

/**
 * Registry kinds not in Tweaks yet, each with the reason (decision 24): "the app's automatic check lists
 * every block that is not in Tweaks yet". A kind whose editor is not on the screen MUST be here; part B
 * removes each line as it builds that editor (the check fails on a line whose editor is built).
 */
const PART_B = 'Part B builds the Tweaks screen (decisions 26–29)';
export const STILL_TO_ADD: { id: string; why: string }[] = [
  { id: 'number.add', why: PART_B },
  { id: 'attribute.add', why: PART_B },
  { id: 'number.set', why: PART_B },
  { id: 'number.atLeast', why: PART_B },
  { id: 'number.setMaxHp', why: PART_B },
  { id: 'attribute.set', why: PART_B },
  { id: 'rank.atLeast', why: PART_B },
  { id: 'rank.exactly', why: PART_B },
  { id: 'rank.legacySet', why: "Never a new tweak: part B sorts each old entry into 'at least' or 'exactly' when it is read" },
  { id: 'grant.feat', why: PART_B },
  { id: 'grant.language', why: PART_B },
  { id: 'grant.spell', why: PART_B },
  { id: 'grant.classFeature', why: PART_B },
  { id: 'remove.feat', why: PART_B },
  { id: 'choice.allowAnyway', why: PART_B },
  { id: 'text.edit', why: PART_B },
];

const BY_ID = new Map(BLOCK_KINDS.map((k) => [k.id, k]));
export const blockKind = (id: string): BlockKindDef | undefined => BY_ID.get(id);
