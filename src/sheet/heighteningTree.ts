/**
 * Spell heightening on the PAGE TREE — card step 17, spells phase B (docs/card-design.md section 9 row 17;
 * section 5 rows "Heightening split + .applies rail" and "Damage arrow"; section 13: mechanics untouched).
 *
 * Phase A (step 16) drew the spell popup's stat rows from the page and kept the BODY on the description
 * string, because the heightening split, the `.applies` rail and the damage arrow read that string. This
 * file does the same three things on the spell's own Archives page tree, so the body can be the page:
 *
 *  - splitSpellTree: cuts the page's top-level "Heightened (…)" paragraphs out of the body, each with the
 *    blocks that follow it up to the next one (the lists printed under an entry: animal-feature,
 *    chromatic-ray, evolution-surge, forceful-hand …), dropping the rules between them; a sidebar printed
 *    after the entries (a title or heading, its prose, its table) closes the group and is `after`, drawn
 *    unrailed after the Heightening box. Two SEPARATE
 *    matchers: the psychic "Amp" column ("Amp …" and "Amp Heightened (+N)" paragraphs) becomes its own
 *    group, never ordinary heightening; a summon printed "Heightened As listed in the trait" with no
 *    parenthesis is an entry with no trigger (it never applies; measured 0 such paragraphs in the
 *    shipped spell trees on 2026-10-08 — every summon page now lists its levels, which stay entries).
 *    The header's lines the stat rows print and its where-to-get lines (S-printed, S-furniture) leave;
 *    what else it prints (the Source line, a PFS Note, a spoiler banner) is kept as the footer.
 *  - treeTrigger: heightenTrigger (src/rules/heightening.ts) reused on each entry's bold label.
 *  - injectTreeArrow: the damage arrow as ONE new inline node (`up-heighten`, drawn by AstRenderer.tsx
 *    as `<span class="up-heighten" data-ours>`), split into the first body text node that holds the base
 *    formula — the same pattern, the same "full formula, then dice only" order as the string lane's
 *    injectDamageArrow (moved here unchanged from SpellsTab.tsx so the parity script reads it).
 *
 * Which spells draw the tree body is decided by scripts/heighten-tree-parity.mjs: a spell whose applied
 * Heightened set would shrink at any cast rank, or whose inline damage arrow would disappear, stays on the
 * string lane (src/data/heighten-string-lane.json). The NUMBERS are not this file's: the heightened
 * damage is spellCard.ts arrowAt's value on both lanes (the engine's scaleDamage wherever a printed entry
 * backs it; the orchestrator's round-3 arrow rule), the area suffix rides on the stat row as in phase A.
 *
 * A plain .ts file (no JSX, no stylesheet), so the parity script and the card guard read it through jiti.
 */
import type { AstNode } from './astStore';
import { cardHeadUntil, leadOf, nodeLeads, textOf } from './astVisibility';
import { canonLabel } from './cardScope';
import { heightenTrigger } from '../rules/heightening';

/** A heightening trigger: "(+N)" relative to the base rank, "(Nth)" absolute. */
export type HeightenTriggerT = { type: 'rel' | 'abs'; n: number };

/** One entry of a group: its printed bold label, the trigger read off it (null = never applies), and the
 *  page's own blocks (the entry's paragraph and whatever the page prints under it). */
export interface TreeEntry {
  label: string;
  trigger: HeightenTriggerT | null;
  nodes: AstNode[];
}

/** A spell page cut for the popup. */
export interface SpellTree {
  /** Header lines the stat rows do not print and that are not where-to-get furniture: the Source line,
   *  a PFS Note, a spoiler banner (the card walk drops the banner as S-furniture). Drawn dimmed, last. */
  foot: AstNode[];
  /** The page body after the header: its first rule, the prose, minus the groups below and minus the
   *  rule(s) that only separated the prose from them. */
  body: AstNode[];
  /** The ordinary "Heightened (…)" entries, in printed order. */
  heightening: TreeEntry[];
  /** What the page prints after the entries that is not an entry's: a sidebar (its title or heading, its
   *  prose, its table — Dragon Form's "Monster Core Dragons", Detect Alignment's "Alignment Aura"). It
   *  describes the spell, never one rank of it, so it is drawn after the Heightening box, unrailed. */
  after: AstNode[];
  /** The psychic Amp group: the "Amp" paragraph(s) and the "Amp Heightened (+N)" entries. */
  amp: TreeEntry[];
}

/** The where-to-get header lines (section 2 rule 5c, S-furniture): leads, lower case. */
const WHERE_TO_GET = new Set([
  'traditions', 'tradition', 'deities', 'deity', 'domain', 'domains', 'bloodline', 'bloodlines', 'mystery', 'mysteries',
  'lesson', 'lessons', 'patron', 'patrons', 'patron theme', 'patron themes', 'spell list', 'spell lists',
]);
/** The labels the spell popup's stat rows own (spellCard.ts SPELL_ROW_LABELS, in the card vocabulary). A
 *  header line led only by these is the rows' business: drawn there, or — printed with no value — nowhere,
 *  exactly as in phase A. Kept here as a set so this file does not import spellCard.ts (which imports it). */
const ROW_LABELS: ReadonlySet<string> = new Set([
  'Cast', 'Trigger', 'Requirements', 'Cost', 'Secondary Casters', 'Primary Check', 'Secondary Checks', 'Range', 'Area', 'Targets',
  'Duration', 'Defense',
]);

const HEIGHTENED = /^Heightened\b/;
const AMP = /^Amp$/i;
const AMP_HEIGHTENED = /^Amp\s+Heightened\b/i;

/** The bold label an entry paragraph opens with, or ''. */
function labelOf(n: AstNode): string {
  return n.t === 'p' ? (leadOf(n) ?? '') : '';
}

/** Read an entry label's trigger with the string lane's own parser (heightenTrigger). "Amp Heightened
 *  (+2)" reads as "(+2)"; a bare "Heightened" (the summons' "As listed in the trait") has none. */
export function treeTrigger(label: string): HeightenTriggerT | null {
  return heightenTrigger(label.replace(/^Amp\s+/i, '').trim());
}

/** Does `entry` apply when a `base`-rank spell is cast at `rank`? heighteningApplies' rule, on a trigger. */
export function treeEntryApplies(entry: Pick<TreeEntry, 'trigger'>, base: number, rank: number): boolean {
  const t = entry.trigger;
  if (!t) return false;
  return t.type === 'rel' ? rank >= base + t.n : rank >= t.n;
}

/** A top-level block that opens the Amp group: a column whose first paragraph is led by "Amp" or "Amp
 *  Heightened", or such a paragraph on its own (never measured top-level; matched so it cannot slip into
 *  the prose). */
function isAmpBlock(n: AstNode): boolean {
  if (n.t === 'p') return AMP.test(labelOf(n)) || AMP_HEIGHTENED.test(labelOf(n));
  if (n.t !== 'column') return false;
  const first = (n.c || []).find((k) => textOf(k).trim());
  return !!first && first.t === 'p' && (AMP.test(labelOf(first)) || AMP_HEIGHTENED.test(labelOf(first)));
}

/** The Amp group's entries: each "Amp" / "Amp Heightened" paragraph with the blocks under it. */
function ampEntries(n: AstNode): TreeEntry[] {
  const kids = n.t === 'column' ? n.c || [] : [n];
  const out: TreeEntry[] = [];
  for (const k of kids) {
    const l = labelOf(k);
    if (k.t === 'p' && (AMP.test(l) || AMP_HEIGHTENED.test(l))) {
      out.push({ label: l, trigger: AMP_HEIGHTENED.test(l) ? treeTrigger(l) : null, nodes: [k] });
      continue;
    }
    if (!textOf(k).trim() && k.t !== 'ul' && k.t !== 'ol') continue;
    if (out.length) out[out.length - 1].nodes.push(k);
    else out.push({ label: '', trigger: null, nodes: [k] });
  }
  return out;
}

/** The header's footer lines: everything the header prints that is not a stat row (ROW_LABELS), not a
 *  where-to-get line, not the title or the traits — the Source line, a PFS Note, a spoiler banner. */
function footOf(head: AstNode[]): AstNode[] {
  const out: AstNode[] = [];
  const walk = (n: AstNode) => {
    if (n.t === 'title' || n.t === 'traits' || n.t === 'hr') return;
    if (n.t === 'row' || n.t === 'column') {
      for (const c of n.c || []) walk(c);
      return;
    }
    if (n.t === 'p') {
      if (!textOf(n).trim()) return;
      const leads = nodeLeads(n);
      if (leads.length && leads.every((l) => ROW_LABELS.has(canonLabel(l) ?? ''))) return;
      if (leads.length && leads.every((l) => WHERE_TO_GET.has(l.toLowerCase()))) return;
      out.push(n);
      return;
    }
    if (textOf(n).trim()) out.push(n);
  };
  for (const n of head) walk(n);
  return out;
}

/**
 * Cut a spell page into footer, body, Heightened entries and the Amp group. Returns null for a tree with
 * no rule (no header to place — cardHeadUntil's "never cut what we cannot place").
 */
export function splitSpellTree(tree: AstNode | undefined): SpellTree | null {
  const top = tree?.c ?? [];
  const until = cardHeadUntil(top);
  if (until < 0) return null;
  const foot = footOf(top.slice(0, until));
  const body: AstNode[] = [];
  const heightening: TreeEntry[] = [];
  const amp: TreeEntry[] = [];
  const after: AstNode[] = [];
  let inGroup = false;
  let inSidebar = false;
  for (const n of top.slice(until)) {
    if (isAmpBlock(n)) {
      amp.push(...ampEntries(n));
      continue;
    }
    const l = labelOf(n);
    if (n.t === 'p' && HEIGHTENED.test(l)) {
      inGroup = true;
      inSidebar = false;
      heightening.push({ label: l, trigger: treeTrigger(l), nodes: [n] });
      continue;
    }
    // A sidebar's title or heading closes the entry above it: the sidebar and everything under it (its
    // prose, its table) belong to the spell, not to that rank (section 5: an entry attaches only the
    // lists that follow it). Measured 2026-10-08: dragon-form, detect-alignment, aon-detect-alignment,
    // spiritual-attunement.
    if (inGroup && (n.t === 'title' || n.t === 'heading')) inSidebar = true;
    if (inSidebar) {
      if (n.t === 'hr' && !after.length) continue;
      after.push(n);
      continue;
    }
    if (inGroup) {
      // The rules between entries only separated them; anything else the page prints after an entry (a
      // list, its success degrees — transmigrate's 5th-rank ritual) is that entry's.
      if (n.t === 'hr') continue;
      heightening[heightening.length - 1].nodes.push(n);
      continue;
    }
    body.push(n);
  }
  // The rule(s) that closed the prose before the groups (the string lane drops its "---" the same way).
  while (body.length > 1 && body[body.length - 1].t === 'hr') body.pop();
  while (after.length && after[after.length - 1].t === 'hr') after.pop();
  return { foot, body, heightening, after, amp };
}

/* ---------------------------------------------------------------------------------------------- */
/* The damage arrow                                                                               */
/* ---------------------------------------------------------------------------------------------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** The patterns the arrow anchors on: the full base formula, then its dice part (the string lane's order). */
function arrowPatterns(baseFormula: string): RegExp[] {
  const dice = baseFormula.replace(/\s*[+-]\s*\d+$/, '');
  return (dice === baseFormula ? [baseFormula] : [baseFormula, dice]).map((pat) => {
    const body = escapeRe(pat).replace(/\\\+/g, '\\s*\\+\\s*');
    return new RegExp(`(?<![\\dd])(${body})(?![\\dd])`);
  });
}

/**
 * The string lane (unchanged, moved from SpellsTab.tsx): splice a highlighted "(→ heightened)" right after
 * the FIRST standalone occurrence of the base damage formula in the spell prose (the ⟦…⟧ markers become a
 * .up-heighten span in RichText). Tries the full formula then the dice-only part; leaves the text unchanged
 * when the formula isn't found (best-effort).
 */
export function injectDamageArrow(text: string, baseFormula: string, heightened: string): string {
  for (const re of arrowPatterns(baseFormula)) {
    if (re.test(text)) return text.replace(re, `$1 ⟦(→ ${heightened})⟧`);
  }
  return text;
}

/** The inline node the tree arrow is: AstRenderer.tsx draws it as `<span class="up-heighten" data-ours>`. */
export const ARROW_NODE = 'up-heighten';

/** Copy `nodes` with the first text node matching `re` (document order) split around the arrow. */
function spliceArrow(nodes: AstNode[], re: RegExp, arrow: string): AstNode[] | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.t === 'text') {
      const v = n.v ?? '';
      const m = re.exec(v);
      if (!m) continue;
      const end = m.index + m[0].length;
      const parts: AstNode[] = [{ ...n, v: v.slice(0, end) }, { t: 'text', v: ' ' }, { t: ARROW_NODE, v: arrow }];
      if (end < v.length) parts.push({ ...n, v: v.slice(end) });
      return [...nodes.slice(0, i), ...parts, ...nodes.slice(i + 1)];
    }
    if (n.c?.length) {
      const kids = spliceArrow(n.c, re, arrow);
      if (kids) return [...nodes.slice(0, i), { ...n, c: kids }, ...nodes.slice(i + 1)];
    }
  }
  return null;
}

/**
 * The tree arrow: `body` with "(→ heightened)" after the first body text node holding the base formula —
 * the full formula first, then its dice part, as the string lane tries them. `found: false` (the body is
 * returned as is) when no text node holds it; the popup then shows the arrow as an ours line instead of
 * losing it (section 5: electrified-crystal-ward, shadow-illusion).
 */
export function injectTreeArrow(body: AstNode[], baseFormula: string, heightened: string): { body: AstNode[]; found: boolean } {
  const arrow = `(→ ${heightened})`;
  for (const re of arrowPatterns(baseFormula)) {
    const out = spliceArrow(body, re, arrow);
    if (out) return { body: out, found: true };
  }
  return { body, found: false };
}

/** Does a body hold an anchor for the base formula? (The arrow's place does not depend on the rank.) */
export function treeHasArrowAnchor(body: AstNode[], baseFormula: string): boolean {
  return injectTreeArrow(body, baseFormula, '?').found;
}
