/**
 * The spell popup's card model — card step 16, spells phase A (docs/card-design.md section 9 row 16;
 * section 5 rows "Spell stat rows from fields; our Defense wording", "Area suffix", "Cast-at"; section 13:
 * cards first, mechanics untouched).
 *
 * SpellDetail's stat rows come from the record's Archives PAGE instead of the stored fields: the page
 * header's labelled lines, in printed order, under the card vocabulary (Saving Throw reads as Defense,
 * Target / Target(s) as Targets). The stored fields stay exactly as they are — the engine reads them;
 * the card only stops PRINTING them where the page prints its own line (an EXTRA field row, like Buzzing
 * Servants' Area, is not shown while a page exists). The field rows are the fallback only when the spell
 * has no tree, or its tree is not a spell / ritual page.
 *
 * The BODY stays the description string in phase A (the damage arrow and the heightening split read it;
 * phase B, step 17, moves it to the tree). `stripPrintedPreamble` removes from that string only what the
 * rows now print: a leading bold "**Area** …" line, or the scraped plain "Name / Source … pg. N / Cast … /
 * Area …" header — each label line only when the rows printed that label; the scrape's name, spoiler,
 * Source and where-to-get lines (S-furniture) go with it. Nothing inside a sentence is touched.
 *
 * Card step 17 (spells phase B, row 17): the body, the Heightened entries and the Amp group come from
 * the page tree (heighteningTree.ts splitSpellTree) — `body: 'tree'` — for every spell page except those
 * the parity gate keeps on the string lane (src/data/heighten-string-lane.json, written by
 * scripts/heighten-tree-parity.mjs from heightenParity below: the applied Heightened set must not shrink
 * at any cast rank, the inline damage arrow must not disappear — unless the page is a NEWER printing than
 * the string, owner rule R12: heightenGate below). The string fields above stay for those
 * spells, for spells with no page, and while the page loads.
 *
 * A plain .ts file with no JSX and no stylesheet: the guard (scripts/lib/card-scope.mjs, through jiti)
 * models the spell popup with `spellCardModel` — the SAME functions SpellDetail renders with.
 */
import type { AstNode } from './astStore';
import type { Spell } from '../rules/types';
import { cardHeadUntil, clean, textOf } from './astVisibility';
import { canonLabel } from './cardScope';
import { addDice, heightenSteps, heightenTrigger, heighteningApplies, scaleArea, scaleDamage, splitHeightening } from '../rules/heightening';
import {
  injectDamageArrow,
  splitSpellTree,
  treeEntryApplies,
  treeHasArrowAnchor,
  type HeightenTriggerT,
  type SpellTree,
  type TreeEntry,
} from './heighteningTree';
import HEIGHTEN_STRING_LANE_JSON from '../data/heighten-string-lane.json';

/** The labels a spell popup prints as stat rows, in the card vocabulary (cardScope LABEL_ALIASES). */
export const SPELL_ROW_LABELS = [
  'Cast',
  'Trigger',
  'Requirements',
  'Cost',
  'Secondary Casters',
  'Primary Check',
  'Secondary Checks',
  'Range',
  'Area',
  'Targets',
  'Duration',
  'Defense',
] as const;
export type SpellRowLabel = (typeof SPELL_ROW_LABELS)[number];
const ROW_SET: ReadonlySet<string> = new Set(SPELL_ROW_LABELS);

/** One labelled line of the page header: its canonical label, the label as printed, and its value. */
export interface PageStatLine {
  label: SpellRowLabel;
  printedAs: string;
  value: string;
}

/** The page's title badge ("Spell 3", "Focus 5", "Cantrip 1", "Ritual 4"). */
export function pageBadge(tree: AstNode | undefined): string {
  const title = (tree?.c ?? []).find((n) => n.t === 'title');
  return String(title?.right ?? '').trim();
}

/** Is this tree a spell or ritual page? 8 spell records' trees are a feat, rules or hazard page instead
 *  (measured on the shipped public/ast/spells.json.gz: Spell 1,225, Focus 508, Ritual 164, Cantrip 119,
 *  Feat 6, Rules 1, Hazard 1) — those keep the field rows. */
export function isSpellPage(tree: AstNode | undefined): boolean {
  return /^(?:spell|focus|cantrip|ritual)\b/i.test(pageBadge(tree));
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A block's segments: every bold run that opens it (at its start, or after a ";") starts a segment;
 *  everything after it, up to the next such run, is that segment's value. The same opening rule as
 *  astVisibility nodeLeads. */
function segmentsOf(p: AstNode): { lead: string; value: string }[] {
  const out: { lead: string; value: string }[] = [];
  let before = '';
  let cur: { lead: string; value: string } | null = null;
  const add = (s: string) => {
    before += s;
    if (cur) cur.value += s;
  };
  const visit = (k: AstNode) => {
    if (k.t === 'b') {
      const t = textOf(k);
      if (t.trim() && (!before.trim() || /;\s*$/.test(before))) {
        if (cur) cur.value = cur.value.replace(/;\s*$/, '');
        cur = { lead: squash(t).replace(/[:：]$/, '').trim(), value: '' };
        out.push(cur);
        before = '';
        return;
      }
      add(t);
      return;
    }
    if (k.t === 'text') return add(clean(k.v ?? ''));
    if (k.t === 'br') return add(' ');
    for (const c of k.c || []) visit(c);
  };
  for (const c of p.c || []) visit(c);
  return out.map((s) => ({ lead: s.lead, value: squash(s.value).replace(/;$/, '').trim() }));
}

/**
 * The page header's labelled lines, in printed order: every line before the page's first rule whose
 * label is in the spell row vocabulary. The where-to-get lines (Traditions, Deities, Domain, Bloodline,
 * Mystery, Lesson, Patron, Spell Lists), Source, PFS Note and anything else are not rows. A page with no
 * rule has no header (cardHeadUntil: never cut what we cannot place) and so no rows.
 */
export function pageStatLines(tree: AstNode | undefined): PageStatLine[] {
  const top = tree?.c ?? [];
  const until = cardHeadUntil(top);
  if (until < 0) return [];
  const out: PageStatLine[] = [];
  const walk = (n: AstNode) => {
    if (n.t === 'title' || n.t === 'traits') return;
    if (n.t === 'p') {
      for (const s of segmentsOf(n)) {
        const c = canonLabel(s.lead);
        if (c && ROW_SET.has(c)) out.push({ label: c as SpellRowLabel, printedAs: s.lead, value: s.value });
      }
      return;
    }
    for (const c of n.c || []) walk(c);
  };
  for (const n of top.slice(0, until)) walk(n);
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* stripPrintedPreamble                                                                           */
/* ---------------------------------------------------------------------------------------------- */

const BOLD_LEAD = /^\*\*([^*]+)\*\*/;
/** Header labels in a scraped plain header (case-sensitive: header labels are capitalised). */
const PLAIN_LABEL = /(?:^|[\s;])(Secondary Casters|Primary Check|Secondary Checks|Saving Throw|Target\(s\)|Targets|Target|Requirements|Requirement|Cast|Cost|Range|Area|Duration|Defense|Trigger)(?=\s)/g;
const PLAIN_OPEN = /^(Secondary Casters|Primary Check|Secondary Checks|Saving Throw|Target\(s\)|Targets|Target|Requirements|Requirement|Cast|Cost|Range|Area|Duration|Defense|Trigger)\s/;
/** S-furniture inside a scraped header: the where-to-get lines (section 2 rule 5c). */
const WHERE_TO_GET = /^(?:Traditions?|Deities|Deity|Domains?|Bloodlines?|Mysteries|Mystery|Lessons?|Patron Themes?|Patrons?|Spell Lists?)\s/;
const SPOILER = /^May contain spoilers\b/i;
const SOURCE_LINE = /^Source\s.*\bpg\.?\s*\d+/;
/** The scrape's mark (card-scope.mjs plainHeaderLabels uses the same test). */
const SCRAPED = /\bSource\s.{1,120}?\bpg\.?\s*\d+/;
const slugOf = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');

/**
 * The description string with the preamble the stat rows now print taken off its front.
 *  - Leading bold label lines ("**Area** 1 cubic foot", "**Trigger** …"): a line goes when every
 *    vocabulary label it opens with is in `printed`; a line naming a label the rows did not print stays.
 *    When every one went, the "---" rule that closed the preamble goes too.
 *  - A scraped plain header (a "Source … pg. N" line in the first 160 characters): its name line,
 *    spoiler banner, Source line and where-to-get lines go (S-furniture); each label line goes only when
 *    the rows printed all its labels. The header ends at the first line that is none of these.
 * Returns the string byte-identical when nothing is removed.
 */
export function stripPrintedPreamble(md: string, printed: ReadonlySet<string>, name?: string): string {
  if (!md) return md;
  const lines = md.split('\n');
  let changed = false;

  // 1. Leading bold label lines.
  {
    let i = 0;
    let dropped = 0;
    let kept = 0;
    const keep: string[] = [];
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) { keep.push(lines[i]); continue; }
      const m = BOLD_LEAD.exec(l);
      const c = m ? canonLabel(m[1]) : null;
      if (!c || !ROW_SET.has(c)) break;
      const labels = [...l.matchAll(/\*\*([^*]+)\*\*/g)].map((x) => canonLabel(x[1])).filter((x): x is string => !!x && ROW_SET.has(x));
      if (labels.every((x) => printed.has(x))) dropped++;
      else { kept++; keep.push(lines[i]); }
    }
    if (dropped) {
      let rest = lines.slice(i);
      if (!kept) {
        // The rule that closed the preamble, with the blank lines around it.
        let j = 0;
        while (j < rest.length && !rest[j].trim()) j++;
        if (j < rest.length && /^-{3,}$/.test(rest[j].trim())) {
          j++;
          while (j < rest.length && !rest[j].trim()) j++;
          rest = rest.slice(j);
        }
      }
      lines.splice(0, lines.length, ...(kept ? keep : []), ...rest);
      changed = true;
    }
  }

  // 2. A scraped plain header.
  if (SCRAPED.test(lines.join('\n').slice(0, 160))) {
    const nextFilled = (from: number) => {
      for (let k = from; k < lines.length; k++) if (lines[k].trim()) return lines[k].trim();
      return '';
    };
    const out: string[] = [];
    let i = 0;
    let dropped = 0;
    for (; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l) { out.push(lines[i]); continue; }
      if (i === 0 && !PLAIN_OPEN.test(l)) {
        const nx = nextFilled(1);
        if ((name && slugOf(l) === slugOf(name)) || SPOILER.test(nx) || SOURCE_LINE.test(nx)) { dropped++; continue; }
      }
      if (SPOILER.test(l) || SOURCE_LINE.test(l) || WHERE_TO_GET.test(l)) { dropped++; continue; }
      if (PLAIN_OPEN.test(l)) {
        const labels = [...l.matchAll(PLAIN_LABEL)].map((x) => canonLabel(x[1])).filter((x): x is string => !!x);
        if (labels.length && labels.every((x) => printed.has(x))) { dropped++; continue; }
        out.push(lines[i]);
        continue;
      }
      break;
    }
    if (dropped) {
      const rest = [...out, ...lines.slice(i)];
      let j = 0;
      while (j < rest.length && !rest[j].trim()) j++;
      lines.splice(0, lines.length, ...rest.slice(j));
      changed = true;
    }
  }

  if (!changed) return md;
  let k = 0;
  while (k < lines.length && !lines[k].trim()) k++;
  return lines.slice(k).join('\n');
}

/* ---------------------------------------------------------------------------------------------- */
/* The model the popup renders and the guard judges                                               */
/* ---------------------------------------------------------------------------------------------- */

/** The field rows the popup printed before step 16 (SpellsTab.tsx spellStatRows — injected, because
 *  it lives in a .tsx file jiti cannot parse). */
export type FieldRows = [string, string | undefined][];

/** A duration cast ("1 hour") prints as words; every other cost is the action glyph. */
export function castWords(spell: Pick<Spell, 'cast'>): string {
  const c = spell.cast;
  return c && c.type === 'duration' ? c.text : '';
}

export interface SpellCardModel {
  /** 'page' = rows from the spell's own page; 'field' = no tree, or a tree that is not a spell page. */
  lane: 'page' | 'field';
  /** The rows as [label, value], in printed order. Cast is always first-or-in-place; its value is the
   *  page's Cast words (or the field's duration words) — the popup draws the glyph beside it. */
  rows: [string, string][];
  /** The labels the rows printed (what stripPrintedPreamble may take off the body). */
  printed: ReadonlySet<string>;
  /** The body string (the heightening split's base, preamble stripped) and the Heightened entries. */
  base: string;
  heightening: string[];
  /** Card step 17: 'tree' = the popup draws the body, the Heightened entries and the Amp group from the
   *  page (`tree`); 'string' = the description string (`base` / `heightening`) as in phase A — no spell
   *  page, a page with no rule, or a spell the parity gate keeps on src/data/heighten-string-lane.json. */
  body: 'tree' | 'string';
  /** The page cut (heighteningTree.ts splitSpellTree), only on the tree body. */
  tree?: SpellTree;
  /** The tree the popup draws on the tree body, in reading order — body, Heightened entries, Amp group,
   *  footer — for the card guard (scripts/lib/card-scope.mjs judges it as the popup's blocks). */
  drawn?: AstNode;
}

/** The generated lane file (scripts/heighten-tree-parity.mjs --write): `ids` = the spells kept on the
 *  string lane, `missing` = what each one's page prints no Heightened line for, `reprints` = the spells whose
 *  page is a NEWER printing than the string (they draw the page; the older printing's Heightened lines are
 *  kept as the evidence the gate re-reads). */
export interface HeightenStringLaneFile {
  ids: string[];
  missing?: Record<string, string[]>;
  reprints?: Record<string, ReprintEvidence>;
}
const LANE_FILE = HEIGHTEN_STRING_LANE_JSON as HeightenStringLaneFile;

/** Card step 17: the spells the heighten-tree parity gate keeps on the string lane (generated by
 *  scripts/heighten-tree-parity.mjs --write; shrink-only, checked both ways by test/card-spell-tree.test.tsx). */
export const HEIGHTEN_STRING_LANE: ReadonlySet<string> = new Set(LANE_FILE.ids);

/** The marked footer of a spell kept on the string lane: the text is our older import, and the reason is
 *  the line its (same-printing) Archives page does not print. Null for any spell not on the string lane. */
export function stringLaneFooter(id: string, file: HeightenStringLaneFile = LANE_FILE): string | null {
  if (!file.ids.includes(id)) return null;
  const missing = file.missing?.[id] ?? [];
  return `Text from our older import: this spell's Archives page prints no Heightened line for ${missing.length ? missing.join(' or ') : 'what this text heightens'}`;
}

/** The page cut a spell's tree body would draw, ignoring the parity list: a spell / ritual page with a
 *  rule to place its header (the parity gate's candidates). */
export function spellTreeCandidate(spell: Pick<Spell, 'id'>, tree: AstNode | undefined): SpellTree | null {
  if (!tree || !isSpellPage(tree) || !spell.id || spell.id.startsWith('hb-')) return null;
  return splitSpellTree(tree);
}

/** The drawn tree, in the popup's reading order (see SpellCardModel.drawn). */
export function spellDrawnTree(t: SpellTree): AstNode {
  return { t: 'doc', c: [...t.body, ...t.heightening.flatMap((e) => e.nodes), ...t.after, ...t.amp.flatMap((e) => e.nodes), ...t.foot] };
}

/** The page lane's rows: the page's labelled lines, with a Cast row first when the page prints none
 *  (a remastered page carries its cost as the title glyph). A label the page prints with nothing after
 *  it (fungal-exhalation's bare "Target", 1 of 2016 pages) draws no row — an empty labelled row says
 *  nothing; Cast stays, because its glyph is its value. */
export function pageRows(lines: PageStatLine[], spell: Pick<Spell, 'cast'>): [string, string][] {
  const rows: [string, string][] = lines.filter((l) => l.label === 'Cast' || l.value.trim()).map((l) => [l.label, l.value]);
  if (!lines.some((l) => l.label === 'Cast')) rows.unshift(['Cast', castWords(spell)]);
  return rows;
}

/** The field lane's rows: exactly the rows spellStatRows printed (Cast always, the rest when set). */
export function fieldRows(rows: FieldRows, spell: Pick<Spell, 'cast'>): [string, string][] {
  return rows.filter(([k, v]) => k === 'Cast' || v).map(([k, v]) => [k, k === 'Cast' ? castWords(spell) : (v ?? '')]);
}

/**
 * The spell popup as the card renders it, for the guard (card-scope.mjs's spellDetail surface): which
 * lane the rows come from, the rows, and the body string the popup draws (the damage arrow is a
 * heightened-rank insertion inside [data-ours]-style spans and is not modelled here).
 */
export function spellCardModel(
  spell: Spell,
  tree: AstNode | undefined,
  statRows: FieldRows,
  stringLane: ReadonlySet<string> = HEIGHTEN_STRING_LANE,
): SpellCardModel {
  const lane: 'page' | 'field' = tree && isSpellPage(tree) ? 'page' : 'field';
  const rows = lane === 'page' ? pageRows(pageStatLines(tree), spell) : fieldRows(statRows, spell);
  const printed = new Set(rows.map(([k]) => k));
  const { base, heightening } = splitHeightening(spell.description || '');
  const model: SpellCardModel = { lane, rows, printed, base: stripPrintedPreamble(base, printed, spell.name), heightening, body: 'string' };
  // Card step 17: the body comes from the page unless the parity gate keeps the spell on the string lane.
  const cut = lane === 'page' && !stringLane.has(spell.id) ? spellTreeCandidate(spell, tree) : null;
  if (cut) Object.assign(model, { body: 'tree', tree: cut, drawn: spellDrawnTree(cut) });
  return model;
}

/* ---------------------------------------------------------------------------------------------- */
/* A record printed inside a bigger page of another category (card step 17, round 3 ruling)       */
/* ---------------------------------------------------------------------------------------------- */

/** The title of the page a spell record's tree is, when that page is NOT a spell / ritual page (a feat, a
 *  rules entry, a hazard: the 6 litanies / judgements, aon-misdirection, aon-dread-aura, measured on the
 *  shipped public/ast/spells.json.gz) — the record is printed inside that page. Null for a spell page, no
 *  tree, or a homebrew id. */
export function printedInsideTitle(spell: Pick<Spell, 'id'>, tree: AstNode | undefined): string | null {
  if (!tree || isSpellPage(tree) || !spell.id || spell.id.startsWith('hb-')) return null;
  const title = (tree.c ?? []).find((n) => n.t === 'title');
  if (!title) return null;
  const line = (title.c ?? []).find((n) => n.t === 'p') ?? title;
  return squash(textOf(line)) || null;
}

/** The ours footer such a record carries until the spells surface draws page slices (the orchestrator's
 *  round-3 ruling): its text is the string, our older import. Null when the record is not printed inside
 *  another page. */
export function printedInsideFooter(spell: Pick<Spell, 'id'>, tree: AstNode | undefined): string | null {
  const title = printedInsideTitle(spell, tree);
  return title ? `Printed inside ${title} — text from our older import` : null;
}

/* ---------------------------------------------------------------------------------------------- */
/* The arrow's printed backing (card step 17, round 3 ruling)                                     */
/* ---------------------------------------------------------------------------------------------- */

/** One Heightened entry of the text the player reads, as the arrow rule needs it: its trigger and its words
 *  after the "Heightened (…)" label (so the label's own "+1" is never read as a printed increment). */
export interface ReadEntry {
  trigger: HeightenTriggerT | null;
  text: string;
}

/** The Heightened entries of what the popup draws: the page's on the tree body, the string's otherwise.
 *  Never the Amp group (an "Amp Heightened" entry applies only when the spell is amped). */
export function readEntries(model: Pick<SpellCardModel, 'body' | 'tree' | 'heightening'>): ReadEntry[] {
  const words = (s: string) => squash(s).replace(/^\s*(?:Amp\s+)?Heightened\b\s*(?:\([^)]*\))?/i, '').trim();
  if (model.body === 'tree' && model.tree) return model.tree.heightening.map((e) => ({ trigger: e.trigger, text: words(e.nodes.map(textOf).join(' ')) }));
  return model.heightening.map((h) => ({ trigger: heightenTrigger(h), text: words(h.replace(/\]\([^)]*\)/g, ']').replace(/\*\*/g, '')) }));
}

/** Does an entry's text print an increment (a dice formula / a number of damage, or an area's feet)? */
function printsDice(text: string, incr: string): boolean {
  const body = incr.replace(/\s+/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\+/g, '\\s*\\+\\s*');
  return new RegExp(`(?<![\\dd])${body}(?![\\dd])`).test(text);
}
function printsFeet(text: string, feet: number): boolean {
  return new RegExp(`(?<!\\d)${feet}(?:-| )(?:foot|feet)\\b`).test(text);
}

/** The heightened values the popup draws at one cast rank. */
export interface ArrowAt {
  /** The damage arrow's value / the area suffix's feet the popup draws (null = nothing at this rank). */
  damage: string | null;
  area: number | null;
  /** The engine's own values (scaleDamage / scaleArea, public/core.json's heightening — never changed). */
  engineDamage: string | null;
  engineArea: number | null;
  /** Set when the drawn values count the steps the page's own entries grant rather than the engine's
   *  interval (the page prints no "(+N)" at the engine's interval: work/card-step17-heighten-reprint-drift.json). */
  printedSteps?: boolean;
}

/**
 * The orchestrator's round-3 ruling (step 17, generalising must-fix (a)): an inline arrow (damage or area)
 * or an area suffix is drawn ONLY when a printed Heightened entry of the text the player reads (readEntries:
 * the page on the tree body; the string otherwise) applies at the cast rank and backs it.
 *  - The page prints the engine's interval (fireball's "(+1)" for the engine's every +1) or the engine is a
 *    fixed table: the numbers are the engine's (scaleDamage / scaleArea), drawn at the ranks an entry applies.
 *  - The engine heightens at an interval the page does not print (engine or reprint drift): the drawn value
 *    is the engine's own increment counted as often as the page's entries grant it at this rank — a "(+N)"
 *    once per N ranks, an "(Nth)" once from rank N — and only from entries that print that increment; so the
 *    arrow says what the page says (wall-of-ice, 5th rank, "(+2) … increases by 1d6": no arrow at 6th,
 *    "(→ 3d6)" at 7th). A page that prints no Heightened line (sea-of-thought's newer printing) backs
 *    nothing: no arrow, no suffix.
 * The engine's numbers are untouched; every spell where the drawn value is not the engine's is listed in
 * the drift file (scripts/heighten-tree-parity.mjs `displaySuppressed` / `displayFromPrint`).
 */
export function arrowAt(spell: Spell, model: Pick<SpellCardModel, 'body' | 'tree' | 'heightening'>, rank: number): ArrowAt {
  const engineDamage = scaleDamage(spell, rank);
  const engineArea = scaleArea(spell, rank);
  const out: ArrowAt = { damage: null, area: null, engineDamage, engineArea };
  const base = spell.rank;
  if (rank <= base) return out;
  const entries = readEntries(model);
  if (!entries.some((e) => treeEntryApplies(e, base, rank))) return out;
  const h = spell.heightening;
  if (h?.type === 'interval' && !entries.some((e) => e.trigger?.type === 'rel' && e.trigger.n === h.interval)) {
    // The page does not print the engine's interval: count the steps the page's own entries grant at this
    // rank — a "(+N)" entry once per N ranks above the base (heightenSteps, the engine's own counting), an
    // "(Nth)" entry once from rank N — each only when it prints the engine's increment.
    const stepsBy = (prints: (text: string) => boolean) =>
      entries
        .filter((e) => e.trigger && prints(e.text))
        .reduce((k, e) => k + (e.trigger!.type === 'rel' ? heightenSteps(Math.max(1, base), rank, e.trigger!.n) : rank >= e.trigger!.n ? 1 : 0), 0);
    const kd = h.damageIncr && spell.baseDamage ? stepsBy((t) => printsDice(t, h.damageIncr!)) : 0;
    const ka = h.areaIncr && spell.baseArea ? stepsBy((t) => printsFeet(t, h.areaIncr!)) : 0;
    if (kd > 0) out.damage = addDice(spell.baseDamage!, h.damageIncr!, kd);
    if (ka > 0) out.area = spell.baseArea!.value + h.areaIncr! * ka;
    out.printedSteps = true;
    return out;
  }
  return { ...out, damage: engineDamage, area: engineArea };
}

/** Per spell, over every cast rank above its base: the ranks where the engine heightens a value the popup
 *  does not draw (withheld), and the ranks where the drawn value is not the engine's (counted at the printed
 *  interval). The parity script writes it into the drift file (`displaySuppressed`, `displayFromPrint`);
 *  test/card-spell-tree.test.tsx re-derives it over the corpus and asserts the file. */
export interface ArrowDisplayDrift {
  damage: number[];
  area: number[];
}
export function arrowDisplayDrift(spell: Spell, model: Pick<SpellCardModel, 'body' | 'tree' | 'heightening'>): {
  suppressed: ArrowDisplayDrift;
  fromPrint: Record<string, { damage?: [string | null, string | null]; area?: [number | null, number | null] }>;
} {
  const suppressed: ArrowDisplayDrift = { damage: [], area: [] };
  const fromPrint: Record<string, { damage?: [string | null, string | null]; area?: [number | null, number | null] }> = {};
  for (const r of castRanksAbove(spell.rank)) {
    const a = arrowAt(spell, model, r);
    if (a.engineDamage != null && a.damage == null) suppressed.damage.push(r);
    if (a.engineArea != null && a.area == null) suppressed.area.push(r);
    const d = a.damage != null && a.damage !== a.engineDamage;
    const ar = a.area != null && a.area !== a.engineArea;
    if (d || ar) fromPrint[r] = { ...(d ? { damage: [a.damage, a.engineDamage] as [string, string | null] } : {}), ...(ar ? { area: [a.area, a.engineArea] as [number, number | null] } : {}) };
  }
  return { suppressed, fromPrint };
}

/* ---------------------------------------------------------------------------------------------- */
/* The heighten-tree parity gate (card step 17)                                                   */
/* ---------------------------------------------------------------------------------------------- */

/** The cast ranks a popup can show above a spell's base: base+1 … 10 (a cantrip / rank-0 spell from 1). */
export function castRanksAbove(base: number): number[] {
  const out: number[] = [];
  for (let r = Math.max(1, base + 1); r <= 10; r++) out.push(r);
  return out;
}

const triggerKey = (t: { type: string; n: number } | null) => (t ? `${t.type}:${t.n}` : '');

/** An entry's words after its "Heightened (…)" label, lower case, letters and digits only: the string
 *  entry's first paragraph (markdown link targets and bold marks dropped) and the tree entry's own
 *  paragraph read the same when they print the same sentence. */
const LABEL_HEAD = /^\s*(?:Amp\s+)?Heightened\b\s*(?:\([^)]*\))?/i;
const wordsOf = (s: string) => (s.replace(LABEL_HEAD, '').toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
export function stringEntryWords(entry: string): string {
  const first = entry.split(/\n\s*\n/)[0] ?? '';
  return wordsOf(first.replace(/\]\([^)]*\)/g, ']').replace(/\*\*/g, ''));
}
export function treeEntryWords(entry: Pick<TreeEntry, 'nodes'>): string {
  return wordsOf(textOf(entry.nodes[0] ?? { t: 'p' }));
}

/** One spell's parity: per cast rank, the applying Heightened entries on each lane, and the damage arrow's
 *  anchor on each lane. A string entry is held by an applying tree entry with the same trigger, or — when
 *  the page prints the same sentence under another label ("(+1)" for the string's "(10th)" on a 9th-rank
 *  spell) — with the same words. `stay` = the tree would lose something the string lane shows. */
export interface HeightenParity {
  id: string;
  /** Ranks at which some applying string entry has no applying tree entry (same trigger, else same words). */
  shrinks: number[];
  /** Ranks at which the tree applies MORE entries than the string lane (entries the string never split). */
  gains: number[];
  /** The string entries (as the string prints them) that some cast rank applies and the tree does not hold,
   *  in printed order. */
  lost: string[];
  /** The string entries / tree entries / Amp group entries counted. */
  stringEntries: number;
  treeEntries: number;
  ampEntries: number;
  /** Damage arrow: the spell heightens its damage at some rank (scaleDamage), and where each lane anchors it. */
  arrow: boolean;
  arrowString: boolean;
  arrowTree: boolean;
  /** An arrow the string lane draws inline and the tree cannot place (the tree would box it instead). */
  arrowLost: boolean;
  stay: boolean;
}

/**
 * The parity of one spell, or null when the spell has no tree body candidate (no spell page, or a page
 * with no rule): it stays on the string lane by construction and is not listed. The string lane is
 * exactly what SpellDetail drew before step 17 — spellCardModel's `base` / `heightening` (the split of the
 * description, the printed preamble stripped), with heighteningApplies at `rank > base`; the tree lane is
 * splitSpellTree's entries with treeEntryApplies at the same ranks. The numbers (scaleDamage) are the same
 * function on both lanes; only the anchor of the arrow can differ.
 */
export function heightenParity(spell: Spell, tree: AstNode | undefined, statRows: FieldRows): HeightenParity | null {
  const cut = spellTreeCandidate(spell, tree);
  if (!cut) return null;
  const str = spellCardModel(spell, tree, statRows, new Set([spell.id]));
  const base = spell.rank;
  const shrinks: number[] = [];
  const gains: number[] = [];
  const lostEntries = new Set<string>();
  for (const r of castRanksAbove(base)) {
    const want = str.heightening
      .filter((h) => r > base && heighteningApplies(h, base, r))
      .map((h) => ({ entry: h, key: triggerKey(heightenTrigger(h)), words: stringEntryWords(h) }));
    const have = cut.heightening
      .filter((e) => r > base && treeEntryApplies(e, base, r))
      .map((e) => ({ key: triggerKey(e.trigger), words: treeEntryWords(e) }));
    // Two passes over a pool: the same trigger first, then the same words (each tree entry holds one).
    const pool = [...have];
    const rest = want.filter((w) => {
      const at = pool.findIndex((h) => h.key === w.key);
      if (at < 0) return true;
      pool.splice(at, 1);
      return false;
    });
    let lost = false;
    for (const w of rest) {
      const at = w.words ? pool.findIndex((h) => h.words === w.words) : -1;
      if (at < 0) {
        lost = true;
        lostEntries.add(w.entry);
      } else pool.splice(at, 1);
    }
    if (lost) shrinks.push(r);
    if (have.length > want.length) gains.push(r);
  }
  const arrow = !!spell.baseDamage && castRanksAbove(base).some((r) => scaleDamage(spell, r) != null);
  const arrowString = arrow && injectDamageArrow(str.base, spell.baseDamage!, '?') !== str.base;
  const arrowTree = arrow && treeHasArrowAnchor(cut.body, spell.baseDamage!);
  const arrowLost = arrowString && !arrowTree;
  return {
    id: spell.id,
    shrinks,
    gains,
    lost: str.heightening.filter((h) => lostEntries.has(h)),
    stringEntries: str.heightening.length,
    treeEntries: cut.heightening.length,
    ampEntries: cut.amp.length,
    arrow,
    arrowString,
    arrowTree,
    arrowLost,
    stay: shrinks.length > 0 || arrowLost,
  };
}

/** The parity of every spell with a tree body candidate, sorted by id. */
export function heightenParityAll(
  spells: Record<string, Spell>,
  trees: Record<string, AstNode | undefined>,
  statRowsOf: (s: Spell) => FieldRows,
): HeightenParity[] {
  const out: HeightenParity[] = [];
  for (const id of Object.keys(spells).sort()) {
    const p = heightenParity(spells[id], trees[id], statRowsOf(spells[id]));
    if (p) out.push(p);
  }
  return out;
}

/** An older printing the spell's page replaces (scripts/lib/reprint.mjs, the Archives' own legacy_id /
 *  remaster_id link): `from` the older document, `to` the page's, `entries` the older printing's Heightened
 *  lines as it prints them. */
export interface ReprintEvidence {
  from: string;
  to: string;
  entries: string[];
}

/** The label a string entry names in a footer: its trigger as printed ("(+1)", "(5th)"), else its words. */
export function heightenLabel(entry: string): string {
  const m = /^\W*(?:Amp\s+)?Heightened\b\**\s*(\([^)]*\))/i.exec(entry);
  return m ? m[1] : stringEntryWords(entry).split(' ').slice(0, 6).join(' ');
}

/** What the gate decided, per failing spell (owner ruling R12: the newest printing wins, whole). */
export interface HeightenGate {
  /** (b) The page is the SAME printing the string was imported from and prints no line for an entry the
   *  string carries: the spell keeps the string body, its footer naming what the page omits. */
  stringLane: { id: string; missing: string[] }[];
  /** (a) The page is a NEWER printing than the string (the string's lost entries are the older printing's
   *  own Heightened lines): the page wins, the spell draws the tree, and the drift is listed for the rebuild
   *  lane (work/card-step17-heighten-reprint-drift.json). */
  reprintDrift: { id: string; from: string; to: string; lost: string[] }[];
}

/**
 * The gate over the parity result. A spell that fails parity is REPRINT DRIFT when its page replaces an
 * older printing (`reprintsOf` — the Archives' link, never a name guess) and every string entry the page
 * does not hold is printed, word for word, among that older printing's Heightened lines: the string was
 * imported from the printing the page replaced, and the page wins. Otherwise the page is the same printing
 * and genuinely omits a line, and the spell stays on the string lane. An inline arrow the tree cannot place
 * with no lost entry stays on the string lane too.
 */
export function heightenGate(parity: readonly HeightenParity[], reprintsOf: (id: string) => readonly ReprintEvidence[]): HeightenGate {
  const gate: HeightenGate = { stringLane: [], reprintDrift: [] };
  for (const p of parity) {
    if (!p.stay) continue;
    const printedIn = (e: ReprintEvidence) => p.lost.every((l) => e.entries.some((x) => stringEntryWords(x) === stringEntryWords(l)));
    const older = p.lost.length > 0 ? reprintsOf(p.id).find(printedIn) : undefined;
    if (older) gate.reprintDrift.push({ id: p.id, from: older.from, to: older.to, lost: p.lost });
    else gate.stringLane.push({ id: p.id, missing: [...p.lost.map(heightenLabel), ...(p.arrowLost ? ['its heightened damage'] : [])] });
  }
  return gate;
}

/** The two-way check of src/data/heighten-string-lane.json against the gate: an id that fails parity but
 *  is neither listed nor reprint drift (STRING-LANE-UNLISTED), a listed id that now passes, has no
 *  candidate or is reprint drift (STRING-LANE-STALE), a reprint-drift id that no longer fails parity
 *  (REPRINT-DRIFT-STALE). */
export function stringLaneProblems(listed: readonly string[], parity: readonly HeightenParity[], reprints: readonly string[] = []): string[] {
  const out: string[] = [];
  const set = new Set(listed);
  const drift = new Set(reprints);
  const failing = new Set(parity.filter((p) => p.stay).map((p) => p.id));
  const stay = new Set([...failing].filter((id) => !drift.has(id)));
  for (const id of stay) if (!set.has(id)) out.push(`${id}|STRING-LANE-UNLISTED`);
  for (const id of set) if (!stay.has(id)) out.push(`${id}|STRING-LANE-STALE`);
  for (const id of drift) if (!failing.has(id)) out.push(`${id}|REPRINT-DRIFT-STALE`);
  return out.sort();
}
