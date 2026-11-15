/*
 * ONE CONTENT PATH (docs/overrides-redesign.md, Building blocks item 7; plan checker fixes C1 and C9).
 *
 * A character's `overrides.contentEdits` (the old Overrides "edit a feat's / class feature's fields",
 * the `text.edit` kind of the registry) is a SHALLOW overlay of whole field values onto records of the
 * shared content database. Until 2026-10-20 every caller ran that overlay itself (App.tsx twice,
 * Builder.tsx, GmEditSheet.tsx twice, rebuild.ts), and every surface that did not — the party card, the
 * tracker row, the read-only party viewer, the roster card, the GM tracker's HP writes — derived the
 * character against RAW content: a player whose edit changed a feat's numbers (a `maxHpBonus`, a
 * `saveBonuses`) saw one max HP on the sheet while the GM's tracker, the card and the HP the GM wrote
 * back (pcSheetTruth `sheetWithVitals`: damage = max − current) used another.
 *
 * Now `contentFor(db, host)` is the ONE door, and the derive boundary calls it with the character (or
 * build) ITSELF — `{ overrides, options }`, plan B B13 — so a caller cannot skip it:
 *   - `buildCharacter` and `deriveBuildFromCharacter` (rules/build.ts), from `build` / `c`;
 *   - `applyPlayState` (rules/play.ts) — so `livePlay` (sheet/memberSheets.ts) too;
 *   - `deriveMaxHp` (rules/derive.ts) — so `initialPlay`, the roster card and pcSheetTruth's max-HP
 *     readers (`maxHpOf` → `vitalsFromSheet` → `sheetWithVitals`, the GM_EDITS_PC_HP write) too;
 *   - `computeSummary` (sheet/partySummary.ts) — so `memberSummary` / `memberCardSummary` too;
 *   - `computePcStats` (integration/computePcStats.ts) — so `sheetPcStats` too.
 * The hosts that hand a whole sheet its database (App.tsx `sheetContent`, GmEditSheet.tsx `sheetContent`,
 * the party viewer in PartyMembers.tsx, Builder.tsx `ovContent`, transfer.ts `exportWg`) call it
 * themselves, because every derive function inside the sheet reads the database it was given.
 * `applyOverrides` below is module-private, and scripts/blocks-check.mjs (src/rules/blocks/check.ts
 * `checkContentPath`) fails when the name appears anywhere but here.
 *
 * ORDER WITH THE CARRIED RECORDS (commit c1acf8f, src/data/carried.ts — owner ruling 2026-10-20):
 *   1. the view first — `ownContent(content, savedChar)` on this device's own character,
 *      `foreignContent(content, sheet)` on anyone else's — the custom records the sheet carries;
 *   2. then `contentFor(view, host)` on top.
 * Why that order: the overlay patches only ids the database HOLDS, so a player's edit of their own
 * homebrew feat, which on a GM's device exists only as a carried copy, reaches that device only when the
 * carried record is already in the view; and a foreign view lets the carried copy WIN over the viewer's
 * record, so a carried merge laid AFTER the edits would draw the un-edited copy over the player's edit.
 * Because the derive boundary applies the edits last, every surface gets this order even when it passes
 * the plain view. Both layers are memoised on object identity, so the composed database is the same
 * object on every render.
 *
 * NEVER COLLECT `carried` FROM THIS DATABASE. `collectCarried` / `withCarriedAttached` (data/carried.ts)
 * read the VIEW, before the edits: the carried copy is the record as its owner authored it, and the
 * edits travel in `overrides.contentEdits` and are laid over it again on every device. A carried copy
 * collected from here would bake one character's edit into the record every other character reads.
 *
 * THE SWITCH AND EACH EDIT'S OWN ON/OFF (plan B, WP2 / B13): the edits laid over are the host's LIVE ones
 * (`liveContentEdits`, blocks/active.ts — the one reader): none while the Tweaks master switch is off, and
 * none that is paused (`overrides.meta['contentEdits:<bucket>/<id>'].on === false`, checker C3). A text
 * edit has no start level (B25). That is why the door takes the HOST (`{ overrides, options }`, a
 * Character or a BuildState), never the bare overrides object: the switch is `options.overridesEnabled`.
 *
 * ⚠ contentFor cannot UN-apply an edit. A database it made (`MADE`), or one that already holds an edit's
 * values (`alreadyApplied`), is returned as it is — so a host must never hand the derive boundary a
 * database edited for ANOTHER switch / on-off state. Every memo that calls contentFor therefore keys on
 * the host's `options` too, not only on its `overrides` (App.tsx `sheetContent`, Builder.tsx `ovContent`,
 * GmEditSheet.tsx `sheetContent`); and `setTweaksSwitch` (blocks/write.ts) always writes a NEW overrides
 * object, so a memo keyed on `overrides` alone also refreshes on the switch.
 */
import type { BuildOverrides, CharacterOptions, ContentDatabase } from '../types';
import { liveContentEdits } from './active';

type ContentEdits = NonNullable<BuildOverrides['contentEdits']>;
/** The two buckets an edit can patch, in the overlay's order. */
const EDIT_MAPS = ['feats', 'classFeatures'] as const;
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** The host's live edits when they patch anything, else null (an empty `contentEdits` changes nothing). */
function editsOf(host: { overrides?: BuildOverrides; options?: CharacterOptions } | null | undefined): ContentEdits | null {
  // A bare overrides object handed in place of the host would silently drop every edit (its
  // `.overrides` is absent). tsc refuses it in src/; the scripts and tests it never sees are refused here.
  // tweaks-ok: developer TypeError for a coding mistake (contentFor called with the overrides object)
  if (host && 'contentEdits' in host) throw new TypeError('contentFor(db, host): pass the character or build ({ overrides, options }), not its overrides object');
  const e = liveContentEdits(host);
  if (!isRec(e)) return null;
  return EDIT_MAPS.some((m) => isRec(e[m]) && Object.keys(e[m] as Rec).length > 0) ? e : null;
}

/**
 * The raw overlay — a SHALLOW, whole-value patch of feat and class-feature fields onto the shared
 * database WITHOUT mutating it (the database is an ~18 MB cached singleton shared by every character):
 * it only ever spreads into new objects, and an edit of an id the database does not hold is skipped.
 * Module-private on purpose: `contentFor` is the only caller (see the header and the blocks guard).
 */
function applyOverrides(base: ContentDatabase, edits: ContentEdits): ContentDatabase {
  const next: ContentDatabase = { ...base };
  const featEdits = isRec(edits.feats) && Object.keys(edits.feats).length ? edits.feats : null;
  const featureEdits = isRec(edits.classFeatures) && Object.keys(edits.classFeatures).length ? edits.classFeatures : null;
  if (featEdits) {
    const m = { ...base.feats };
    for (const [id, patch] of Object.entries(featEdits)) if (m[id]) m[id] = { ...m[id], ...patch };
    next.feats = m;
  }
  if (featureEdits) {
    const m = { ...base.classFeatures };
    for (const [id, patch] of Object.entries(featureEdits)) if (m[id]) m[id] = { ...m[id], ...patch };
    next.classFeatures = m;
  }
  return next;
}

/** The same field value: the very value, or (an object or array) the same JSON — a patch read back from
 *  storage, or cloned by `deriveBuildFromCharacter`, is a new object holding the same edit. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Would laying `edits` over `db` change nothing? True when every patched field of every record `db`
 * holds already has that value (an own property, `sameValue`) — `db` is then a database these edits (or
 * a copy of them) were already laid over, maybe copied on the way (the sheet's `playerFacingContent`, the
 * Builder's source filter): a view of a view adds nothing, and it stays the same object.
 */
function alreadyApplied(db: ContentDatabase, edits: ContentEdits): boolean {
  for (const map of EDIT_MAPS) {
    const patches = edits[map];
    if (!isRec(patches)) continue;
    const recs = db[map] as unknown as Rec | undefined;
    for (const [id, patch] of Object.entries(patches)) {
      const rec = recs?.[id];
      if (!isRec(rec) || !isRec(patch)) continue; // the overlay skips both too
      for (const k of Object.keys(patch)) if (!Object.prototype.hasOwnProperty.call(rec, k) || !sameValue(rec[k], patch[k])) return false;
    }
  }
  return true;
}

/** A database `contentFor` made → the edits object it was made with. */
const MADE = new WeakMap<object, object>();
/** Checker C9: base database → the `contentEdits` object → the database for them. Weak on both, so a
 *  re-merged database or an edited character (every edit writes a new `contentEdits`) drops its entry. */
const CACHE = new WeakMap<object, WeakMap<object, ContentDatabase>>();

/**
 * THE content path: `db` with the host's own LIVE `overrides.contentEdits` laid over it (`host` = the
 * Character or BuildState itself: `{ overrides, options }`).
 *
 * - No live edits (absent, empty buckets, the switch off, every edit paused) → `db` itself.
 * - The same `db` and the same live edits object (`liveContentEdits` is memoised per contentEdits × meta,
 *   per switch state) → the same database object on every call (C9), so every memo downstream keyed on
 *   the database's identity (bookBlocksOf, the sheet's tabs) stays warm.
 * - Idempotent: a database these edits were already laid over (by this function, or copied from one) is
 *   returned as it is, so the derive boundary may call it on a database its host already prepared.
 * - Stacking stays as the old overlay had it: other edits laid over a prepared database patch on top.
 *
 * `db` is the character's VIEW (carried records first — see the header for the order and why).
 */
export function contentFor(db: ContentDatabase, host: { overrides?: BuildOverrides; options?: CharacterOptions } | null | undefined): ContentDatabase {
  const edits = editsOf(host);
  if (!edits || !db) return db;
  if (MADE.get(db) === edits) return db;
  let byEdits = CACHE.get(db);
  const hit = byEdits?.get(edits);
  if (hit) return hit;
  const out = alreadyApplied(db, edits) ? db : applyOverrides(db, edits);
  if (!byEdits) CACHE.set(db, (byEdits = new WeakMap()));
  byEdits.set(edits, out);
  if (out !== db) MADE.set(out, edits);
  return out;
}
