/*
 * A LINK TO A CLASS FEATURE OPENS THAT FEATURE, NOT THE CLASS IT IS PRINTED IN (package M, 2026-10-16).
 *
 * The bug, as the owner met it: the swashbuckler's page says "Confident Evasion", and AoN auto-links the
 * word "Evasion" to `class-feature-25` — the Core Rulebook alchemist's Evasion, which the app ships as
 * `classFeatures/evasion`. Tapping it opened the ALCHEMIST CLASS page. The shipped tree said
 * `{ ref: 'classes:alchemist', to: 'class-feature-25' }`.
 *
 * Why: the AST link resolver (resolveTo in scripts/import-core-v2.mjs) sends a link to a PRUNED document
 * (one the Archives mark `superseded_by`) to whatever replaced it — the right thing for a reprinted spell
 * or rule. But a class feature, a sidebar and an item's bonus line are SUB-PAGES: they have no page of their
 * own, they carry the url of the page they are printed on, and their `remaster_id` (from which the export
 * derives `superseded_by`) names the reprint of THAT page. class-feature-25 says `remaster_id: ["class-56"]`
 * — the Player Core 2 Alchemist class page, not a feature on it. scripts/lib/reprint.mjs already reads it
 * that way ("A cross-category link is therefore its page's link"), and import-core-v2's
 * `parentPagePointer` reads a sidebar's pointer the same way when it prunes; the link resolver was the one
 * reader that still followed it as the feature's own replacement.
 *
 * THE RULE (isPageLink): a pruned sub-page whose `superseded_by` names a document of ANOTHER category with
 * ANOTHER name is pointing at its page's reprint. Same category, or the same name (sidebar-2312 "Building
 * an Infiltration" -> the rules page of that name, which IS its prose reprinted), is a real replacement and
 * is followed as before. A spell replaced by a ritual (spell-377 Wish -> ritual-125 Wish) is not a
 * sub-page, so it is never touched here.
 *
 * WHAT SUCH A LINK OPENS INSTEAD (subPageRef), most authoritative first:
 *   1. the newest printing of the document ITSELF, by scripts/lib/reprint.mjs — the same rule (R12, with
 *      the owner's 2026-09-23 class-hop ruling) that decides which document a record is built from;
 *   2. the document's own record: its name's slug in its own bucket (a kept legacy record such as
 *      classFeatures/evasion), when that record ships;
 *   3. nothing: `ref: null`, which AstRenderer draws as inert text. Never the page hop. A link opens what it
 *      names or nothing — the hop is what sent "ability boost" in 119 links (104 backgrounds, seven class
 *      pages, the swashbuckler's among them) to the INVENTOR class (class-feature-1209 is the inventor's
 *      legacy Ability Boost, printed on class-19, which no record carries), and "hex" in 29 links, kingdom
 *      actions included, to the Witch class.
 *
 * Measured on the shipped trees before the fix (2026-10-16), 27 linked documents in all:
 *   • 13 now open the feature's own record (56 links): Evasion, Formula Book, Second Skin, Occult
 *     Spellcasting, Deific Weapon, Iron Will, Wizard Weapon Expertise, Heightened Senses, Swashbuckler's
 *     Style, Studious Spells and the three alchemist Perpetual features;
 *   • 8 ship no record and become inert text (173 links): Ability Boost (inventor), Hexes (witch), Divine /
 *     Primal / Arcane Spellcasting, Exalt, Deity and Cause, Divine Smite. The cost: a link such as "divine
 *     spellcasting" on the Cleric archetype page no longer opens the whole Cleric class page;
 *   • the 6 others are pages of their own replaced across categories (Wish, Miracle, Alter Reality, Primal
 *     Phenomenon and Glyph of Warding by rituals, the Ganzi ancestry by a feat), not sub-pages, and are
 *     untouched.
 * scripts/ast-link-carrier-check.mjs (in `npm run verify`) is the guard; scripts/repair-subpage-link-refs.mjs
 * repaired the shipped trees without a full `npm run data`; test/package-m-links-subpage.test.ts pins this
 * file's rule.
 *
 * Readers: scripts/import-core-v2.mjs (resolveTo) and scripts/repair-subpage-link-refs.mjs. Imported,
 * never copied.
 */
import { newestPrinting } from './reprint.mjs';

/** The kinds of Archives document that are printed ON another page (scripts/lib/reprint.mjs SUBPAGE). */
export const SUBPAGE_KINDS = new Set(['class-feature', 'sidebar', 'item-bonus']);

/**
 * The bucket each sub-page kind ships in — import-core-v2's CAT_BUCKET for `class-feature`, and its
 * camel-cased reference bucket for the other two. The repair script needs it without running the importer.
 */
export const SUBPAGE_BUCKET = { 'class-feature': 'classFeatures', sidebar: 'sidebar', 'item-bonus': 'itemBonus' };

/** The slug rule record keys are minted with (import-core-v2 `slug`, reprint.mjs `slugify`). */
const slugify = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * True when `doc`'s supersession pointer names the reprint of the page it is printed on, not its own.
 * `doc` and `byDoc` are export documents ({ category, name }); an unknown `byDoc` is never a page link
 * (nothing could be resolved through it anyway).
 */
export function isPageLink(doc, byDoc) {
  if (!doc || !byDoc || !SUBPAGE_KINDS.has(String(doc.category))) return false;
  if (String(byDoc.category) === String(doc.category)) return false;
  return slugify(doc.name) !== slugify(byDoc.name);
}

/**
 * The record a link to the pruned sub-page `to` opens in place of its page hop, as "bucket:slug", or null
 * when nothing of its own ships.
 *   own      { bucket, slug } — the document's own bucket and name slug (import-core-v2 supIdInfo[to])
 *   idMap    document id -> { bucket, slug } (public/idmap.json)
 *   live     ({ bucket, slug }) -> boolean: does that record ship
 *   reprints the scripts/lib/reprint.mjs index (optional: absent, step 1 is skipped)
 */
export function subPageRef(to, own, { idMap, live, reprints }) {
  const R = reprints ? newestPrinting(reprints, String(to)) : null;
  const paired = R ? idMap?.[R] : null;
  if (paired && live(paired)) return `${paired.bucket}:${paired.slug}`;
  if (own?.bucket && own?.slug && live(own)) return `${own.bucket}:${own.slug}`;
  return null;
}
