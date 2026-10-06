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
import { canonLabel } from './cardScope';
import NOT_OWN_PAGE_JSON from '../data/not-own-page.json';
import PAGE_SLICES_JSON from '../data/page-slices.json';

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
  if (sections < 2) return node;
  if (mine < 0) mine = widerSectionMatch(node, slug);
  if (mine < 0) return node;
  let end = top.length;
  for (let i = mine + 1; i < top.length; i++) if (isSection(top[i])) { end = i; break; }
  // The family's own level-1 title is dropped — the variant's title takes its place (and its badge).
  const shared = top.slice(0, first).filter((n) => !(n.t === 'title' && Number(n.level ?? 1) <= 1));
  return { ...node, c: [{ ...top[mine], level: 1 }, ...shared, ...top.slice(mine + 1, end)] };
}

/**
 * Card step 12 (F5, docs/card-design.md section 9 row 12; docs/display-truth-plan.md F5): the record's
 * own level-2 section when its title does not slug to the record's slug exactly. Four looser keys, tried
 * in order, each accepted only when EXACTLY ONE section of the page qualifies (two or more → no cut:
 * a wrong cut is worse than the whole page). All of them on the slug with a leading "aon-" removed:
 *   (a) that bare slug itself — the importer's prefix for a record whose canonical twin holds the bare
 *       slug ("aon-1st-rank-scroll" → the Magic Scroll page's "1st-rank Scroll");
 *   (b) the same words in any order, "of" / "the" dropped ("aether-marbles-greater" → "Greater Aether
 *       Marbles");
 *   (c) a section of two or more words, every one a word of the record's name and at least one not a
 *       word of the page title (so the family's unnamed base grade "Olfactory Obfuscator" never stands
 *       in for "Olfactory Obfuscator (Lesser)", and a combination weapon's one-word "Melee" / "Ranged"
 *       mode section never retitles "Axe Musket (Melee)"), only on the record's FAMILY page:
 *       the page title is the record's bracketed qualifier ("Adept Benefit (Amulet)" on the Amulet page
 *       → "Adept Benefit", not "Initiate Benefit" or "Paragon Benefit") or the record's name without its
 *       qualifier ("Energy Breath Potion (Acid, Greater)" on the Energy Breath Potion page → "Energy
 *       Breath Potion (Greater)"; "Demon Bone Tiles (Pusk)" → "Pusk Bone Tiles"). The hook reads a slug,
 *       never the name, so "qualifier" is the slug's tail and "name without it" the slug's head;
 *       scripts/lib/shared-page-census.mjs ruleCWithoutQualifier lists every (c) cut whose record NAME
 *       is not "<page title> (…)" or "… (<page title>)";
 *   (d) the same words with at most two letters of spelling slack in all, the same number of words (two
 *       or more: a one-word "Dragonet" is not the "Dragon" section) and the same digits (AoN's "Peshspine Grenade (Greater)" for our "Peshpine Grenade (Greater)",
 *       "Greater Mat of Resilence", "Treats (Standard)").
 * (a) and (b) are the plan's F5 wording; (c)'s "or the name without its qualifier" and (d) are the two
 * shapes the refuters' census counted in its −290 (45 + 8 items) that the narrower wording leaves out.
 * Returns the section's index in node.c, or -1.
 */
const SECTION_STOP_WORDS = new Set(['of', 'the']);
const sectionWords = (s: string): string[] => astSlug(s).split('-').filter((w) => w && !SECTION_STOP_WORDS.has(w));
const wordBag = (s: string): string => sectionWords(s).sort().join(' ');

export function widerSectionMatch(node: AstNode, slug: string): number {
  return widerSectionRule(node, slug).i;
}

/** widerSectionMatch with the key that decided: 'a' | 'b' | 'c' | 'd', or null (no section / ambiguous). */
export function widerSectionRule(node: AstNode, slug: string): { i: number; rule: 'a' | 'b' | 'c' | 'd' | null } {
  const none = { i: -1, rule: null };
  const top = node.c ?? [];
  const secs: Array<{ i: number; key: string }> = [];
  for (let i = 0; i < top.length; i++) if (isSection(top[i])) secs.push({ i, key: astSlug(flatText(top[i])) });
  if (secs.length < 2) return none;
  // A key with one hit decides; a key with two or more stops the search (ambiguous → no cut).
  const decide = (hits: Array<{ i: number }>, rule: 'a' | 'b' | 'c' | 'd') =>
    (hits.length === 1 ? { i: hits[0].i, rule } : hits.length > 1 ? none : null);
  const bare = slug.replace(/^aon-/, '');
  // (a)
  if (bare !== slug) {
    const a = decide(secs.filter((s) => s.key === bare), 'a');
    if (a) return a;
  }
  const bag = wordBag(bare);
  if (!bag) return none;
  // (b)
  const b = decide(secs.filter((s) => wordBag(s.key) === bag), 'b');
  if (b) return b;
  // (c)
  const t1 = top.find((n) => n.t === 'title' && Number(n.level ?? 1) <= 1);
  const page = t1 ? astSlug(flatText(t1)) : '';
  if (page && bare.length > page.length + 1 && (bare.endsWith('-' + page) || bare.startsWith(page + '-'))) {
    const nameWords = new Set(sectionWords(bare));
    const pageWords = new Set(sectionWords(page));
    const c = decide(secs.filter((s) => {
      const w = sectionWords(s.key);
      return w.length >= 2 && w.every((x) => nameWords.has(x)) && w.some((x) => !pageWords.has(x));
    }), 'c');
    if (c) return c;
  }
  // (d)
  const n = bag.split(' ').length;
  if (n < 2) return none;
  const digits = bag.replace(/\D/g, '');
  return decide(secs.filter((s) => {
    const sb = wordBag(s.key);
    return sb.split(' ').length === n && sb.replace(/\D/g, '') === digits && editDistanceAtMost2(sb, bag);
  }), 'd') ?? none;
}

/** Levenshtein distance <= 2 (the census's spelling slack: "Peshpine" / "Peshspine", "Resilience" /
 *  "Resilence", "Treat" / "Treats"). */
function editDistanceAtMost2(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= 2;
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

/* ---------- card step 5: what a 'mine' card leaves out, dims, or keeps ----------
 *
 * docs/card-design.md section 2 rules 4–5 and section 13. A 'mine' card (the sheet's own popups) no
 * longer drops the page's header with `hideMeta`: the surface's PRINTED SET replaces it. Every labelled
 * page line shows — Trigger, Frequency, Requirements, Prerequisites, Access, Cost … — each in the page's
 * words, at full weight, in the page's order, unless the surface's own stat rows printed that label
 * (S-printed). A row/column block is never dropped whole: it recurses. Only S-furniture leaves text out
 * on its own: spoiler banners, the "<X> leads to…" section, Related Feats lists, short "Click here for
 * the full rules…" / "… can be found here" lines, and the Class / Parent header labels. Kept but DIMMED:
 * the Source line, the Archetype label, Access, Craft Requirements and the PFS Note.
 *
 * These are the ONLY copy of those rules: AstRenderer.tsx draws with them, and the guard
 * (scripts/lib/card-scope.mjs, through jiti) models the card with them. No rule acts inside a sentence:
 * each one keeps or leaves out a whole block.
 */

/** The walk state of a 'mine' card: the surface's printed set, and "this block sits before the page's
 *  first rule" (the stat header of `<header> <hr> <prose>`). */
export interface CardWalk {
  printed: ReadonlySet<string>;
  head: boolean;
}

/** The bold run a block opens with (its label), or null — the same "first non-blank child" test as
 *  isMetaP / isSourceP. */
export function leadOf(p: AstNode): string | null {
  const first = (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
  if (!first || first.t !== 'b') return null;
  return textOf(first).replace(/\s+/g, ' ').trim().replace(/[:：]$/, '').trim();
}

/** Every bold run that OPENS a segment of a block — at its start, or after a ";" ("Price 3 gp; Bulk L"
 *  is led by Price and Bulk). */
export function nodeLeads(n: AstNode): string[] {
  const out: string[] = [];
  let before = '';
  const visit = (k: AstNode) => {
    if (k.t === 'b') {
      const t = textOf(k);
      if (t.trim() && (!before.trim() || /;\s*$/.test(before))) {
        out.push(t.replace(/\s+/g, ' ').trim().replace(/[:：]$/, '').trim());
        before = '';
      } else before += t;
      return;
    }
    if (k.t === 'text') { before += clean(k.v ?? ''); return; }
    if (k.t === 'br') { before += ' '; return; }
    if (k.t === 'actions') { before += String(k.string ?? '').trim(); return; }
    for (const c of k.c || []) visit(c);
  };
  for (const c of n.c || []) visit(c);
  return out;
}

/** Kept but dimmed on a 'mine' card (section 2 rule 5): the Source line, the Archetype label, Access,
 *  Craft Requirements and the PFS Note. */
export const CARD_DIM_LEAD = /^(?:source|archetypes?|access|craft requirements|pfs note)$/i;
export function isCardDimP(p: AstNode): boolean {
  const l = dimLeadOf(p);
  return !!l && CARD_DIM_LEAD.test(l);
}

/** The label a block opens with, looked for through the italic / view wrappers it may sit in. Every PFS
 *  Note on the shipped trees is wrapped (measured over 8 buckets: `p > i > view > b` 954, `p > view > b`
 *  1, `p > i > b` 2), so leadOf alone never saw one and the note drew at full weight. Only a wrapper that
 *  OPENS the block is entered, so a bold word inside italic prose is never a label. */
export function dimLeadOf(p: AstNode): string | null {
  let n: AstNode | undefined = p;
  for (let depth = 0; n && depth < 4; depth++) {
    const l = leadOf(n);
    if (l !== null) return l;
    const first: AstNode | undefined = (n.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
    n = first && (first.t === 'i' || first.t === 'em' || first.t === 'view') ? first : undefined;
  }
  return null;
}

/** Index of the page's first top-level rule; blocks before it are the stat header. -1 = no rule, so
 *  nothing counts as header and the printed set leaves nothing out (never cut what we cannot place). */
export function cardHeadUntil(top: AstNode[]): number {
  return top.findIndex((n) => n.t === 'hr');
}

/** "Halfling Luck leads to..." — the navigation section's heading (a level-2 title on 986 pages). */
export function isCardFurnitureTitle(n: AstNode): boolean {
  return (n.t === 'title' || n.t === 'heading') && /\bleads to\b\.{0,3}\s*$/i.test(textOf(n).trim());
}
/** A furniture section runs from its heading up to the next heading (one link paragraph on all 986). */
export function cardFurnitureSectionEnd(nodes: AstNode[], i: number): number {
  let j = i + 1;
  while (j < nodes.length && nodes[j].t !== 'title' && nodes[j].t !== 'heading') j++;
  return j;
}

/** A furniture LINE: a short "Click here for the full rules on …" / "… can be found here" line (452
 *  lines, all 80 characters or fewer — the 5 longer matches are sentences inside prose and stay), a
 *  Related Feats / Related Bloodlines list, or — in the header only — a Class / Parent page label. */
export function isCardFurnitureP(p: AstNode, head: boolean): boolean {
  if (p.t !== 'p') return false;
  const t = textOf(p).replace(/\s+/g, ' ').trim();
  if (t.length <= 80 && /\bclick here\b|\bcan be found here\b/i.test(t)) return true;
  if (/^Related (?:Feats|Bloodlines?)\b/i.test(t)) return true;
  const l = leadOf(p);
  return head && !!l && /^(?:class|parent)$/i.test(l);
}

/** S-printed: a META header line whose every label the surface's stat rows printed, and only before
 *  the first rule. With an empty printed set (StatDetailModal) this never drops anything. */
export function cardDropsMetaP(p: AstNode, walk: CardWalk): boolean {
  if (!walk.head || !isMetaP(p)) return false;
  const leads = nodeLeads(p);
  return leads.length > 0 && leads.every((l) => {
    const c = canonLabel(l);
    return !!c && walk.printed.has(c);
  });
}

/** An inline-only stat row ("A; B; C"), filtered per bold-label segment: a part whose label the surface
 *  printed leaves (S-printed, header only); every other part stays. */
export function cardRowParts(parts: AstNode[], walk: CardWalk): AstNode[] {
  if (!walk.head) return parts;
  return parts.filter((f) => {
    const l = leadOf(f);
    const c = l ? canonLabel(l) : null;
    return !(c && walk.printed.has(c));
  });
}

/** Does the page print a Source line anywhere? (the card's footer shows our Source only when it does not) */
export function treeHasSource(node: AstNode): boolean {
  let found = false;
  (function walk(n: AstNode) {
    if (found) return;
    if (n.t === 'p' && isSourceP(n)) { found = true; return; }
    for (const c of n.c || []) walk(c);
  })(node);
  return found;
}

/* ---------- card step 12: which tree a record reads (F6 not-own-page, F6b page slices) ----------
 *
 * docs/card-design.md section 9 row 12, section 2 rule 2 (d), section 13 ("raised bar on no own page
 * records"). Two generated lists decide what a record whose page is not its own reads, and both are
 * checked two ways by the card guard (scripts/lib/card-scope.mjs, S2-NOT-OWN) against the census they
 * come from (scripts/lib/shared-page-census.mjs):
 *   - src/data/page-slices.json (scripts/page-slices.mjs): records with no page of their own that LIVE
 *     INSIDE a bigger Archives page (an action printed inside its feat, an inventor modification inside
 *     its innovation, a research field's Field Discovery, a family variant), and records whose shared
 *     page holds a section carrying their whole name (a wand rank's "(4th-Rank Spell)") — they read THAT
 *     paragraph / section / run, cut out of the bigger page at display time;
 *   - src/data/not-own-page.json (scripts/not-own-page.mjs): records whose shared page, after the F5
 *     cut, is still not their own and which have no slice — they read NO tree, so every popup falls back
 *     to their own text.
 * A record on neither reads its own tree through variantSection. useAstNode (src/sheet/useAst.ts) and the
 * guard's readTree both go through recordTree.
 */

/** One record's slice of a bigger page: the page (bucket + slug), the path of child indexes from the
 *  page root to the anchor node, the anchor's own words (checked at display time: a regenerated page
 *  whose anchor moved yields no tree, never a wrong cut) and what the anchor is:
 *   - 'page'    the whole page — only where the page IS the record's text (no line of it is another
 *               record's: an action whose feat is the action, an instinct page — census foreignLines);
 *   - 'section' a title / heading and the `n` nodes after it;
 *   - 'variant' a level-2 section of a family page, the family's shared header before the first section
 *               kept (exactly what variantSection shows a record of that page): "Hag Eye (Smokey)" with
 *               the Hag Eye prose, never Frightful or Oracular; with `also`, the record's further sections
 *               of the page follow under their own titles (a hollow puzzle box's grade, then "Hollow");
 *   - 'block'   a bold-led paragraph and the `n - 1` sibling lines that continue it (its action glyph, its
 *               Frequency / Effect lines, and prose that IS the record's text);
 *   - 'item'    one bullet of a run-together list (bulletItems);
 *   - 'run'     `n` consecutive units (top-level nodes, a list's items counting one each — pageUnits) whose
 *               words are the record's, for a record printed inside a page with no anchor of its own
 *               (Air Gate's junctions on the Air element page, Dragon Breath inside Dragon Form's list);
 *               titled with the record's name (`title`), since the run has no heading; a run of the record's
 *               OWN page (`head`) carries that page's header in front (traits, stat column, Source);
 *   - 'line'    a family page whose variants are lines, not sections ("Animal: …", "Fury: …" on the Instinct
 *               Crown page; "Acid …", "Cold …" items of the Drake Rifle list): the page with the other
 *               variants' lines (`drop`) left out, titled with the record's name — the family's shared text
 *               and the record's own line, as 'variant' does for a page of sections.
 *  A paragraph's or bullet's title is its own bold lead, so the lead is taken off the first line (withoutLead):
 *  the card never reads "Second Doctrine (3rd)Second Doctrine (3rd) Your proficiency rank …".
 *  Where a slice ends is decided when the map is generated, from the record's own text
 *  (scripts/lib/shared-page-census.mjs computePageSlices), and stored as `n`: the screen only cuts. */
export interface PageSlice {
  bucket: string;
  page: string;
  path: number[];
  anchor: string;
  kind: 'page' | 'section' | 'variant' | 'block' | 'item' | 'run' | 'line';
  /** kind 'item': the index, in the paragraph's children, of the bold run that opens the bullet. */
  seg?: number;
  /** 'section' / 'variant': nodes kept after the title; 'block': nodes from the anchor on; 'run': units. */
  n?: number;
  /** kind 'run' / 'line': the card's title. */
  title?: string;
  /** kind 'line': the other variants' lines (paths, as `path`) dropped from the page. */
  drop?: number[][];
  /** kind 'variant': the record's further level-2 sections of the same family page, in page order after the
   *  first, each drawn under its own title — a name carrying several qualifiers, each a section ("Puzzle Box
   *  (Simple) (Hollow)": its "Puzzle Box (Simple)" grade section, then "Puzzle Box (Hollow)"). */
  also?: Array<{ path: number[]; anchor: string; n: number }>;
  /** kind 'run' on the record's OWN page: the page's header (its traits and leading stat column / Source
   *  line, up to and with the first rule) is drawn in front of the run, as the page prints it. */
  head?: boolean;
}

const NOT_OWN_PAGE = new Set<string>((NOT_OWN_PAGE_JSON as { ids?: string[] }).ids ?? []);
const PAGE_SLICES: Record<string, PageSlice> = (PAGE_SLICES_JSON as unknown as { slices?: Record<string, PageSlice> }).slices ?? {};
const SLICE_BUCKETS = new Map<string, string[]>();
for (const k of Object.keys(PAGE_SLICES)) {
  const at = k.indexOf(':');
  const slug = k.slice(at + 1);
  SLICE_BUCKETS.set(slug, [...(SLICE_BUCKETS.get(slug) ?? []), k.slice(0, at)]);
}

export const isNotOwnPage = (bucket: string, slug: string): boolean => NOT_OWN_PAGE.has(`${bucket}:${slug}`);
export const pageSliceOf = (bucket: string, slug: string): PageSlice | undefined => PAGE_SLICES[`${bucket}:${slug}`];
/** A slug-only read (no bucket key, not in the page index): the one bucket whose record of that slug has
 *  a slice, or undefined when none or several do. */
export function sliceBucketOf(slug: string): string | undefined {
  const b = SLICE_BUCKETS.get(slug);
  return b && b.length === 1 ? b[0] : undefined;
}

export const titleLevel = (n: AstNode): number => Number(n.level ?? (n.t === 'heading' ? 3 : 1));
export const isTitleNode = (n: AstNode): boolean => n.t === 'title' || n.t === 'heading';
/** The structural end of a section opened by `sib[i]`: the next title / heading of the same or a higher
 *  level (exclusive), or the end of the siblings. */
export function sectionEnd(sib: AstNode[], i: number): number {
  const lvl = titleLevel(sib[i]);
  let end = i + 1;
  while (end < sib.length && !(isTitleNode(sib[end]) && titleLevel(sib[end]) <= lvl)) end++;
  return end;
}

/** A page as a run of units: each top-level node, except a list, whose items count one unit each. */
export interface PageUnit { node: AstNode; path: number[] }
export function pageUnits(page: AstNode): PageUnit[] {
  const out: PageUnit[] = [];
  (page.c ?? []).forEach((n, i) => {
    if ((n.t === 'ul' || n.t === 'ol') && (n.c ?? []).length) (n.c ?? []).forEach((li, j) => out.push({ node: li, path: [i, j] }));
    else out.push({ node: n, path: [i] });
  });
  return out;
}
/** A run's anchor: the first 60 characters of its first unit's words. */
export const runAnchor = (n: AstNode): string => flatText(n).replace(/\s+/g, ' ').trim().slice(0, 60);

/** The anchor a node offers a slice: a title / heading by its words, a paragraph or list item by the bold
 *  run it opens with (after an optional "- " bullet: the innovation pages print "- **Advanced
 *  Rangefinder (Ranged Only)** …"). */
export function anchorOf(n: AstNode): { text: string; kind: 'page' | 'section' | 'block' } | null {
  if (n.t === 'title' || n.t === 'heading') {
    const text = flatText(n).replace(/\s+/g, ' ').trim();
    return text ? { text, kind: n.t === 'title' && titleLevel(n) <= 1 ? 'page' : 'section' } : null;
  }
  if (n.t !== 'p' && n.t !== 'li') return null;
  const kids = n.c ?? [];
  let k = 0;
  while (k < kids.length && kids[k].t === 'text' && /^[\s\-–—•]*$/.test(kids[k].v ?? '')) k++;
  const first = kids[k];
  if (!first || first.t !== 'b') return null;
  const text = flatText(first).replace(/\s+/g, ' ').trim().replace(/[:.]$/, '').trim();
  return text ? { text, kind: 'block' } : null;
}

/** The bullets of a paragraph whose list lost its line breaks in the scrape: "- **First Doctrine (1st)**
 *  You gain … feat. - **Second Doctrine (3rd)** Your proficiency rank …" (every doctrine of a cleric
 *  doctrine page, every modification of an innovation page, in ONE paragraph). A bullet opens at a bold
 *  run that follows a "- " marker at the paragraph's start or after a space. Two or more make a list;
 *  each bullet is a printed list item, so a slice of one never cuts a sentence. */
const BULLET_END = /(?:^|\s)[-–•]\s*$/;
export function bulletItems(p: AstNode): Array<{ seg: number; text: string }> {
  if (p.t !== 'p') return [];
  const kids = p.c ?? [];
  const out: Array<{ seg: number; text: string }> = [];
  for (let k = 0; k < kids.length; k++) {
    if (kids[k].t !== 'b' || k === 0) continue;
    const prev = kids[k - 1];
    if (prev.t !== 'text' || !BULLET_END.test(prev.v ?? '')) continue;
    const text = flatText(kids[k]).replace(/\s+/g, ' ').trim().replace(/[:.]$/, '').trim();
    if (text) out.push({ seg: k, text });
  }
  return out.length >= 2 ? out : [];
}

/** A bold-led line without its lead (the blank / bullet text before it, the bold run, and the ":" / "." and
 *  spaces after it) — the line under a title made of that lead. Undefined when nothing is left (a line that
 *  was only its title: "Activate—Drake Shot" before its glyph). A line not led by a bold run is returned as is. */
export function withoutLead(n: AstNode): AstNode | undefined {
  const kids = n.c ?? [];
  let k = 0;
  while (k < kids.length && kids[k].t === 'text' && /^[\s\-–—•]*$/.test(kids[k].v ?? '')) k++;
  if (kids[k]?.t !== 'b') return n;
  const rest = kids.slice(k + 1);
  if (rest[0]?.t === 'text') rest[0] = { ...rest[0], v: String(rest[0].v ?? '').replace(/^[\s:.]+/, '') };
  const left = rest.filter((x) => !(x.t === 'br' || (x.t === 'text' && !String(x.v ?? '').trim())));
  return left.length ? { ...n, c: rest } : undefined;
}

/** The node at a path of child indexes, or undefined. */
const nodeAt = (root: AstNode, path: number[]): AstNode | undefined => {
  let node: AstNode | undefined = root;
  for (const i of path) node = node?.c?.[i];
  return node;
};

/**
 * Cut a record's slice out of the bigger page (PageSlice says what each kind keeps; the extent `n` was
 * decided from the record's own text when the map was generated). The anchor becomes the card's level-1
 * title (a paragraph's title is its own bold words; a run's is the record's name), as variantSection
 * retitles a family page. Undefined when the path no longer lands on the anchor's words, or the extent
 * runs past the page — a regenerated page yields no tree, never a wrong cut.
 */
export function sliceOf(page: AstNode, s: PageSlice): AstNode | undefined {
  const { c: _drop, ...rest } = page;
  void _drop;
  const n = s.n ?? 0;
  if (s.kind === 'run') {
    const us = pageUnits(page);
    const at = us.findIndex((u) => u.path.length === s.path.length && u.path.every((x, k) => x === s.path[k]));
    if (at < 0 || n < 1 || at + n > us.length || runAnchor(us[at].node) !== s.anchor) return undefined;
    const body: AstNode[] = [];
    let openList = -1;
    for (const u of us.slice(at, at + n)) {
      if (u.path.length === 2) {
        // Consecutive items of one list stay one list.
        if (openList === u.path[0]) (body[body.length - 1].c as AstNode[]).push(u.node);
        else body.push({ ...(page.c ?? [])[u.path[0]], c: [u.node] });
        openList = u.path[0];
      } else {
        body.push(u.node);
        openList = -1;
      }
    }
    if (!s.head) return { ...rest, c: [{ t: 'title', level: 1, c: [{ t: 'text', v: s.title ?? '' }] }, ...body] };
    // A run of the record's OWN page carries the page's header in front, as the page prints it: the top-level
    // nodes before the run up to and with the page's first rule; on a page with no rule before the run, its
    // leading traits and stat / Source lines. The page's level-1 title is retitled with the record's name
    // (its badge and action glyphs kept, as kind 'line' does).
    const top = page.c ?? [];
    const start = us[at].path[0];
    const hr = top.findIndex((x) => x.t === 'hr');
    let end = 0;
    if (hr >= 0 && hr < start) end = hr + 1;
    else while (end < start && ((top[end].t === 'title' && titleLevel(top[end]) <= 1) || top[end].t === 'traits' || isMetaP(top[end]) || isMetaishBlock(top[end]))) end++;
    const t1 = top.slice(0, end).find((x) => x.t === 'title' && titleLevel(x) <= 1);
    const title: AstNode = t1
      ? { ...t1, c: [{ t: 'text', v: s.title ?? '' }, ...(t1.c ?? []).filter((x) => x.t === 'actions')] }
      : { t: 'title', level: 1, c: [{ t: 'text', v: s.title ?? '' }] };
    return { ...rest, c: [title, ...top.slice(0, end).filter((x) => x !== t1), ...body] };
  }
  if (s.kind === 'line') {
    // The family page less the other variants' lines (top-level paragraphs, or items of a top-level list).
    const own = nodeAt(page, s.path);
    const drops = s.drop ?? [];
    if (!own || runAnchor(own) !== s.anchor || !drops.length || s.path.length > 2) return undefined;
    if (drops.some((d) => d.length < 1 || d.length > 2 || !nodeAt(page, d) || d.join('.') === s.path.join('.'))) return undefined;
    const gone = new Set(drops.map((d) => d.join('.')));
    let titled = false;
    const body = (page.c ?? []).flatMap((n, i): AstNode[] => {
      if (gone.has(`${i}`)) return [];
      if (!titled && n.t === 'title' && titleLevel(n) <= 1) {
        titled = true;
        return [{ ...n, c: [{ t: 'text', v: s.title ?? '' }, ...(n.c ?? []).filter((x) => x.t === 'actions')] }];
      }
      if ((n.t === 'ul' || n.t === 'ol') && n.c) {
        const c = n.c.filter((_, j) => !gone.has(`${i}.${j}`));
        return c.length ? [{ ...n, c }] : [];
      }
      return [n];
    });
    return titled ? { ...rest, c: body } : undefined;
  }
  let parent: AstNode | undefined;
  let node: AstNode | undefined = page;
  for (const i of s.path) { parent = node; node = node?.c?.[i]; }
  if (!node) return undefined;
  if (s.kind === 'item') {
    // One bullet of a run-together list: from its bold run to the next bullet's marker (dropped).
    const items = bulletItems(node);
    const at = items.findIndex((x) => x.seg === s.seg);
    if (at < 0 || items[at].text !== s.anchor) return undefined;
    const kids = node.c ?? [];
    const next = items[at + 1];
    const part = kids.slice(items[at].seg, next ? next.seg : kids.length);
    if (next) {
      const last = part[part.length - 1];
      part[part.length - 1] = { ...last, v: String(last.v ?? '').replace(/\s*[-–•]\s*$/, '') };
    }
    // The bullet's bold run IS the title: the line under it starts after it.
    const line = withoutLead({ ...node, c: part });
    return { ...rest, c: [{ t: 'title', level: 1, c: [{ t: 'text', v: s.anchor }] }, ...(line ? [line] : [])] };
  }
  const a = anchorOf(node);
  if (!a || a.text !== s.anchor || a.kind !== (s.kind === 'variant' ? 'section' : s.kind)) return undefined;
  if (s.kind === 'page') return page;
  if (!parent) return undefined;
  const sib = parent.c ?? [];
  const i = s.path[s.path.length - 1];
  if (s.kind === 'section' || s.kind === 'variant') {
    if (i + 1 + n > sib.length) return undefined;
    const title: AstNode = { ...node, t: 'title', level: 1 };
    const body = sib.slice(i + 1, i + 1 + n);
    if (s.kind === 'section') return { ...rest, c: [title, ...body] };
    // A family page's shared header + prose (before its first level-2 section), its level-1 title dropped.
    if (parent !== page || !isSection(node)) return undefined;
    const first = sib.findIndex(isSection);
    const shared = sib.slice(0, first).filter((x) => !(x.t === 'title' && Number(x.level ?? 1) <= 1));
    // The record's further sections (`also`), in page order, each under its own (level-2) title; each must
    // still be a section with its anchor's words and lie after the one before, or the slice gives no tree.
    const more: AstNode[] = [];
    let after = i + n;
    for (const x of s.also ?? []) {
      const k = x.path.length === 1 ? x.path[0] : -1;
      const sec = sib[k];
      if (k <= after || !sec || !isSection(sec) || anchorOf(sec)?.text !== x.anchor || x.n < 0 || k + 1 + x.n > sib.length) return undefined;
      more.push(sec, ...sib.slice(k + 1, k + 1 + x.n));
      after = k + x.n;
    }
    return { ...rest, c: [title, ...shared, ...body, ...more] };
  }
  // The paragraph's bold lead IS the title: the anchor line keeps only what follows it.
  const title: AstNode = { t: 'title', level: 1, c: [{ t: 'text', v: a.text }] };
  const line = withoutLead(node);
  if (parent.t === 'ul' || parent.t === 'ol') return { ...rest, c: [title, ...(line ? [{ ...parent, c: [line] }] : [])] };
  if (n < 1 || i + n > sib.length) return undefined;
  return { ...rest, c: [title, ...(line ? [line] : []), ...sib.slice(i + 1, i + n)] };
}

/** The tree a record reads, as useAstNode resolves it: its slice of a bigger page; none when its page is
 *  listed as not its own; else its own tree through the variantSection cut. `treeOf` reads a stored tree. */
export function recordTree(bucket: string, slug: string, treeOf: (bucket: string, slug: string) => AstNode | undefined): AstNode | undefined {
  const s = pageSliceOf(bucket, slug);
  if (s) {
    const p = treeOf(s.bucket, s.page);
    return p ? sliceOf(p, s) : undefined;
  }
  if (isNotOwnPage(bucket, slug)) return undefined;
  const t = treeOf(bucket, slug);
  return t ? variantSection(t, slug) : undefined;
}
