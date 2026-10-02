/**
 * What of a page tree a popup shows — the pure half of the description renderer.
 *
 * Card step 1 (docs/card-design.md section 2 rule 1, section 9 row 1): the predicates that decide which
 * tree nodes are "meta" (AstRenderer.tsx) and the two cuts that trim a stored tree to one record
 * (useAst.ts) live here, in a plain .ts file with no JSX and no stylesheet import, because jiti cannot
 * parse .tsx and the card's guard (scripts/card-truth-check.mjs, step 4) must import the SAME functions
 * the card renders with — a check that re-implements them can drift from the screen.
 *
 * Moved verbatim; AstRenderer.tsx and useAst.ts import from here. test/card-noop.test.tsx proves the
 * move byte-equal on 600 seeded records.
 */
import type { AstNode } from './astStore';

/* ---------- text hygiene: strip AoN template artifacts + markdown backslash-escapes ---------- */
export function clean(s: string): string {
  let out = String(s == null ? '' : s);
  if (out.indexOf('<%') !== -1) out = out.replace(/<%[^>]*?>/g, '').replace(/ {2,}/g, ' ');
  // Strip HTML tags that leaked into the text as literal characters — AoN artifacts like `</ br>`, `<br>`,
  // `<i>` that the parser didn't consume. Left in, they render as visible "</ br>" garbage.
  if (out.indexOf('<') !== -1)
    out = out.replace(/<\/?\s*(?:br|hr|p|div|span|i|b|em|strong|sup|sub|ul|ol|li|table|tr|td|th|a)\b[^>]*>/gi, ' ').replace(/ {2,}/g, ' ');
  if (out.indexOf('\\') !== -1) out = out.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return out;
}
export function textOf(n: AstNode | undefined): string {
  if (!n) return '';
  if (n.t === 'text') return clean(n.v ?? '');
  return (n.c || []).map(textOf).join('');
}

/* ---------- meta line (bold label + value: Source/Range/Prerequisites/…) ---------- */
export const META = /^(source|traditions?|deities|range|area|defense|target|targets|duration|cast|trigger|requirements?|prerequisites?|price|usage|bulk|access|frequency|cost|craft requirements)/i;
export function isMetaP(p: AstNode): boolean {
  if (p.t !== 'p') return false;
  const first = (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
  return !!first && first.t === 'b' && META.test(textOf(first).trim());
}
export function isSourceP(p: AstNode): boolean {
  const first = (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
  return !!first && first.t === 'b' && textOf(first).trim().toLowerCase() === 'source';
}

/** A leading META/STAT layout block (a Source line, or a compact stat line with several item/armor/weapon
 *  fields) — the kind a DETAIL view already shows in its own stat panel, so `hideMeta` drops it to avoid a
 *  duplicate stat block. Scoped to row/column LAYOUT nodes so it never touches prose paragraphs. */
export const STAT_LABELS = /\b(?:AC Bonus|Dex Cap|Check Penalty|Speed Penalty|Strength|Bulk|Group|Category|Hardness|Hit Points|HP|BT|Damage|Hands|Reload|Ammunition|Capacity|Range|Price|Usage|Craft Requirements)\b/gi;
export function isMetaishBlock(n: AstNode): boolean {
  const t = textOf(n);
  // A Source-led header block is ALWAYS meta — even when a long PFS Note or Favored-Weapon deity list is
  // appended (those pushed it past a length cap and leaked into detail views).
  if (/^\s*Source\b/i.test(t) && /\bpg\.?\s*\d/i.test(t)) return true;
  if (t.length > 500) return false; // otherwise a long block is prose/content (e.g. an effect table), keep it
  return (t.match(STAT_LABELS) || []).length >= 2; // a compact stat line (≥2 fields)
}

/* ---------- the tree cuts (useAst.ts reads every stored tree through these) ---------- */

/** The importer's slug rule, so a node with only a title can still find its ast (id = slug of name). */
export const astSlug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Raw text of a node — only ever fed to astSlug, which drops everything but letters and digits, so
 *  it deliberately skips the `clean()` template hygiene above. */
const flatText = (n: AstNode): string => (n.t === 'text' ? n.v ?? '' : (n.c ?? []).map(flatText).join(''));

const isSection = (n: AstNode) => n.t === 'title' && Number(n.level ?? 1) === 2;

/**
 * bug 2026-09-12 #6: variant-list — cut a family page down to the ONE variant that was asked for.
 *
 * An AoN family page is a single document shared by every variant record inside it: the ast stored
 * under `magic-wand-2nd-rank-spell` IS the whole "Magic Wand" page, so the popup of the wand a
 * character is holding listed all nine ranks ("Magic Wand (1st-rank Spell) Item 3 … (9th-rank Spell)
 * Item 19") under its description, and the search popup for one rank did the same. Measured on the
 * shipped artefact: 3,068 of 7,537 item asts are such pages (plus 362 itemBonus, 3 siegeWeapons and
 * 1 classFeature).
 *
 * A top-level level-2 section whose title slugs to the record's OWN slug is that record's block, and
 * proves the document is a family page. Keep the shared header + prose that precedes the first
 * section, keep that one block, drop every sibling, and retitle the page after the variant so the
 * popup header reads "Magic Wand (2nd-rank Spell) · Item 5" rather than the family's "Magic Wand ·
 * Item 3+". No matching section — an ordinary record, or the family HEAD, whose page IS the overview
 * — returns the node untouched.
 */
export function variantSection(node: AstNode, slug: string): AstNode {
  const top = node.c ?? [];
  let sections = 0;
  let first = -1;
  let mine = -1;
  for (let i = 0; i < top.length; i++) {
    if (!isSection(top[i])) continue;
    sections++;
    if (first < 0) first = i;
    if (mine < 0 && astSlug(flatText(top[i])) === slug) mine = i;
  }
  if (mine < 0 || sections < 2) return node;
  let end = top.length;
  for (let i = mine + 1; i < top.length; i++) if (isSection(top[i])) { end = i; break; }
  // The family's own level-1 title is dropped — the variant's title takes its place (and its badge).
  const shared = top.slice(0, first).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1));
  return { ...node, c: [{ ...top[mine], level: 1 }, ...shared, ...top.slice(mine + 1, end)] };
}

/**
 * bug 2026-09-15: item popup — the appended "every OTHER item built on this one" list.
 *
 * Owner, on the Full Plate popup: *"specific magic armor doesn't need to be in the item card — the
 * user has the item, he is not searching for more items; he does need the crit specialization rules."*
 *
 * An AoN armor/weapon/shield page ends with a level-2 section that is nothing but a comma-separated
 * run of links to every specific magic item built on that base. Measured on the shipped artefact
 * (public/ast/items.json): 143 pages carry one, under exactly three headings — "Specific Magic
 * Weapons" (111), "Specific Magic Armor" (23), "Specific Magic Shields" (9) — always a TOP-LEVEL
 * level-2 title, never nested, and no other bucket has one. Cutting the section takes everything under
 * it up to the next level-2 title; on all 143 pages that leaves neither a trailing rule nor an empty
 * body.
 *
 * Matched by HEADING, not by "a paragraph that is only links": the rules sections beside these —
 * "Armor Specialization Effects", "Critical Specialization Effects" — are exactly what the owner asked
 * to keep, and so is the item's own text.
 *
 * Applied in DescBody (the popup for a record the character HAS), never inside `useAstNode` — the
 * search popup goes through DescriptionModal, where the player IS browsing for more items.
 */
const ITEM_LIST_SECTION = /^\s*Specific\s+(Magic\s+)?(Armou?rs?|Weapons?|Shields?)\b/i;

export function withoutItemLists(node: AstNode): AstNode {
  const top = node.c ?? [];
  const keep: AstNode[] = [];
  let dropping = false;
  for (const n of top) {
    // A level-2 title opens a section and closes the one before it, so the flag flips on every section
    // — which is what stops the cut at the next heading instead of eating the rest of the page.
    if (isSection(n)) dropping = ITEM_LIST_SECTION.test(flatText(n));
    if (!dropping) keep.push(n);
  }
  return keep.length === top.length ? node : { ...node, c: keep };
}
