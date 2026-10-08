import type { ReactNode } from 'react';
import type { ContentDatabase, DescRef } from '../rules/types';
import type { AstNode } from './astStore';
import type { DescNode } from './descref';
import {
  META, cardFurnitureSectionEnd, cardHeadUntil, clean, isCardDimP, isCardFurnitureP, isCardFurnitureTitle, isMetaP, textOf,
  withoutItemLists,
} from './astVisibility';
import { scopeTree, type ScopedNode } from './cardScope';
import { sharedFeatureFallback } from '../rules/featureText';

/**
 * Types for the record card (docs/card-design.md sections 2, 4 and 6). A plain .ts file, so the
 * step-4 guard can import the same shapes through jiti (jiti cannot parse .tsx).
 *
 * Step 3 builds only `mode: 'browse'` with `chrome: 'popup'` — DescriptionModal's popup, unchanged.
 * The other modes, the embed chrome and the reserved props are declared here so later steps add
 * behaviour without reshaping the component's contract. Step 5 builds `mode: 'mine'` with
 * `chrome: 'popup'` (StatDetailModal's full text): `printed`, the footer and `fallbackText` are read.
 * Step 6 builds `mode: 'gm'` with `chrome: 'embed'` (CampaignTracker's HostPage, the GM screen page):
 * `record`, `content` and `onOpenRef` are read; no frame, no stack, nothing on the dismiss stack.
 * Step 9 (the Main-tab action popup, CARD_ON.actionDetail) reads `controls` and `headerActions`.
 * Step 10 (the strike popup, CARD_ON.strikeDetail) reads `leadControls`.
 * Step 14 (the item popup, CARD_ON.itemDetail) builds `chrome: 'inset'` and reads `stubs`.
 */

/** browse = today's search popup, never scoped; mine = the sheet's "what is yours"; gm = HostPage. */
export type CardMode = 'browse' | 'mine' | 'gm';
/**
 * popup = an overlay with its own header and close; embed = inside another page (HostPage); inset (card
 * step 14) = the card's BODY inside a surface's own popup frame — ItemDetail keeps its header (name, star,
 * edit, remove, close), its stat block, its controls and its phone Remove bar outside the scrolling body,
 * and the card draws the page (or the old text with its no-page line), the ours box and the footer where
 * the item's description was. A linked word opens the browse card over it, Back returning to the item.
 */
export type CardChrome = 'popup' | 'embed' | 'inset';

/** A record by identity: the card reads its name and text off the content, by {bucket, id}. */
export interface CardRecordRef {
  bucket: string;
  id: string;
}
/** A record by its words: homebrew and glossary pages, which have no Archives page of their own. */
export interface CardRecordText {
  title: string;
  text: string;
  /** The text is the homebrew editor's rich HTML. Step 3: rendered by the same fallback as today. */
  html?: boolean;
  refs?: DescRef[];
}
export type CardRecord = CardRecordRef | CardRecordText;

export const isRecordRef = (r: CardRecord): r is CardRecordRef =>
  typeof (r as CardRecordRef).bucket === 'string' && typeof (r as CardRecordRef).id === 'string';

/**
 * Everything the app adds to a card sits in ONE ours box after the body (section 4), each line
 * attributed to the record it came from. Kinds, in the design's words:
 */
export type OursKind =
  /** "Your choice: Fire — note". */
  | 'choice'
  /** Principles A and C; the ally-facing marker of Ruling F. */
  | 'mark'
  /** The note for a marked action cost (today only a row star). */
  | 'actionMark'
  /** The record's own note. */
  | 'note'
  /** enhancedBy, out of a print-styled stat row. */
  | 'enhancement'
  /** A spell note, as SpellsTab prints it today. */
  | 'spellNote'
  /** "At your level (7): 2d6", only where derive computes the value (card step 18: src/sheet/cardAtLevel.ts
   *  reads it off derive's Strikes for the records in cardScope.ts AT_LEVEL; never computed by the card). */
  | 'atYourLevel'
  /** upgradedBy / maxByLevel retunes of a use counter. */
  | 'usesRetune'
  /** "Your rank (trained): DC 15". */
  | 'skillTier'
  /** Critical specialization, only where the page prints none. */
  | 'critSpec'
  /** Strike's fist / blast / natural-attack blurbs. */
  | 'blurb'
  /** desk #158 "Remastered as". */
  | 'remastered'
  /** desk #152 empty note. */
  | 'empty'
  /** "Not from the Archives — our text" (section 7's no-page footer). */
  | 'noPage'
  /**
   * Card step 8: the player's Overrides edit of this record's text ("Change an existing feat/feature",
   * BuildOverrides.contentEdits, applied by build.ts applyOverrides). Shown wherever the card draws the
   * Archives page instead of the edited text, so the edit is never silently lost.
   */
  | 'override'
  /**
   * Card step 8: a homebrew record's typed Trigger / Requirements / Frequency / Access field
   * (types.ts Feat.trigger …, written by homebrewSchemas.ts), drawn as a use line above the body —
   * marked ours, never styled as print. `label` carries the line's label.
   */
  | 'useLine';

export const OURS_KINDS: readonly OursKind[] = [
  'choice', 'mark', 'actionMark', 'note', 'enhancement', 'spellNote', 'atYourLevel',
  'usesRetune', 'skillTier', 'critSpec', 'blurb', 'remastered', 'empty', 'noPage',
  'override', 'useLine',
];

export interface OursLine {
  kind: OursKind;
  /** The record this line comes from (another feat's marker names that feat). */
  from?: { bucket: string; id: string; name: string };
  /** A use line's label ("Trigger", "Frequency" …); the other kinds leave it unset. */
  label?: string;
  text: string;
}

/** The words of one ours line as the box prints them (attribution, label, text) — what a search over a
 *  row's ours lines matches, so the box and the search read the same string. */
export const oursLineText = (l: OursLine): string =>
  `${l.from ? `${l.from.name}: ` : ''}${l.label ? `${l.label} ` : ''}${l.text}`;

/**
 * What a 'mine' card is scoped by (section 6). Browse never scopes. Card step 13a reads `level`,
 * `classId`, `subclassId` and the three ownership sets below (src/sheet/cardScope.ts scopeTree).
 * Every ownership set is OPTIONAL and an absent one means UNKNOWN, never "owns nothing" (UNKNOWN ≠
 * EMPTY): with it absent, a section gated on ownership follows the level rule alone, so it is shown
 * once the character's level reaches it.
 */
export interface CardScope {
  level: number;
  classId?: string;
  subclassId?: string;
  picks?: Record<string, string>;
  ranks?: Record<string, number>;
  /** The class-choice option ids the character owns at its level (Character.classChoices ids). */
  owned?: string[];
  /**
   * Thaumaturge implements, as build.ts pushBenefit decided them (Character.classChoices): `owned` the
   * implements (initiate benefit), `adept` / `paragon` the implements whose adept / paragon benefit the
   * build granted. Absent = UNKNOWN (no implement pick on the character).
   */
  implements?: { owned: string[]; adept: string[]; paragon: string[] };
  /**
   * Kineticist kinetic elements (air, earth, fire, metal, water, wood) from the gate picks, forks
   * included; `single` is the element of a SINGLE gate (exactly one element taken at level 1), absent
   * for a dual gate. Absent = UNKNOWN (no gate pick on the character).
   */
  elements?: { owned: string[]; single?: string };
  /** Inventor innovation type ('armor' | 'weapon' | 'construct' | 'light-mortar'). Absent = UNKNOWN. */
  innovation?: string;
}

/** Section 2 rule 1: the card's props. */
export interface RecordCardProps {
  /** The record, by {bucket, id} or by its words. Exactly one of `record` / `node`. */
  record?: CardRecord;
  /**
   * A description-stack node handed over as-is: today's browse callers (DescriptionModal's `root`).
   * The card never rebuilds it, so the pin it stores and the title it matches are the caller's own
   * object. Steps 7a/19 move callers to `record` ids.
   */
  node?: DescNode;
  mode: CardMode;
  chrome: CardChrome;
  /** Reserved for 'mine' (step 5+). */
  scope?: CardScope;
  /** Reserved: the surface's stat rows (step 5+). */
  stats?: ReactNode;
  /**
   * 'mine' only (card step 5): the labels the surface's own stat rows print — the PRINTED SET that
   * replaces hideMeta (section 2 rule 4.2, plan F1). A page header line is left off only when its label
   * is in this set. Absent = empty: every labelled page line shows (StatDetailModal prints no rows).
   */
  printed?: readonly string[];
  /**
   * Controls above the text — use counters, Cast-at, item choices (section 2 rule 4.3). Card step 9
   * draws them on the 'mine' NO-PAGE lane, between the TrustMarker and the old text (the action popup's
   * trait chips: a page draws its own chips in its header). The page lane has no slot above its body
   * yet — AstRenderer owns that markup — so a page-lane control (Strike's Attack / Damage, step 10; the
   * item controls, step 14) needs that slot first; nothing is drawn there today. Card step 10 built that
   * slot as `leadControls` below (AstRenderer `lead`), leaving this prop's lane as it was.
   */
  controls?: ReactNode;
  /**
   * Card step 10: controls that stay above the text on EVERY lane of a 'mine' card — over the page (first
   * in its body), in the loading placeholder and above the no-page text — because the player uses them
   * whether or not the page is drawn: Strike's Attack bonus and Damage (each a button into its breakdown)
   * and its gated critical specialization. `controls` stays the no-page lane's own (FeatCard's sub-line,
   * trait chips and field Prerequisites row would repeat a page's header).
   */
  leadControls?: ReactNode;
  /**
   * Extra buttons in the header, before Back / pin / close, on the record the surface opened (the
   * stack's first node) only: a page opened from a link inside the card is a browse card (section 6).
   * Card step 9: the action popup's own cost glyph (data-ours), skill label, prepare toggle and action pin.
   */
  headerActions?: ReactNode;
  /**
   * Card step 14 (section 2 rule 6): draw the page's embedded page stubs on a 'mine' card (src/sheet/
   * astStubs.ts — one level deep, a visited set). ItemDetail's card sets it, so a weapon or armor shows
   * its group's specialization effect; the other mine cards leave it off (Strike keeps its gate). The
   * browse card resolves the stubs of an item page without being asked (astStubs.ts STUB_HOST_BUCKETS).
   */
  stubs?: boolean;
  /** Reserved: a tree transform (heightening, step 17). */
  transform?: (node: AstNode) => AstNode;
  /** The ours box, after the body. */
  ours?: OursLine[];
  /** 'mine': text shown (marked as ours, desk #152) when the record has no page and no description. */
  fallbackText?: string;
  /** Extra footer content, after the RemasteredLine, inside the scrolling body. */
  footer?: ReactNode;
  /**
   * Chrome 'popup': dismiss the WHOLE popup chain — the X, Escape, and clicking outside. Every popup
   * caller passes it. Chrome 'embed' has no exit (the host window owns the frame) and omits it.
   */
  onExit?: () => void;
  /**
   * Chrome 'embed' (card step 6): where a linked word or the "Remastered as" name opens. An embedded page
   * has no stack to drill into, so the host opens it (HostPage: the GM's own description popup).
   */
  onOpenRef?: (bucket: string, id: string) => void;
  /**
   * Chrome 'embed': the host's content database, read for the record. The campaign tracker holds its
   * own (CampaignTracker's `content` prop) and is not always mounted under the app's ContentContext.
   */
  content?: ContentDatabase;
  /** When given, Back shows at the first level too and calls this (returns to the popup this opened from). */
  onBackToSource?: () => void;
}

/* ------------------------------------------------------------------------------------------------ */
/* Card step 20 — the row preview (docs/card-design.md section 4 "Row previews", section 5 row       */
/* "Row previews"): a pure function of the card's FIRST OWN BODY PARAGRAPH, so a row's one-line       */
/* preview is the first prose line its 'mine' popup draws — one source, never the old import beside   */
/* the page. Ours markers are a tag on the row (FeatsTab), never inside the sentence.                 */
/*                                                                                                    */
/* "First own body paragraph" = the first plain prose paragraph of the popup body. Not it: use and    */
/* dimmed lines (Trigger, Frequency, Prerequisites, Source …), headings, tables, lists, sidebars      */
/* (aside), degree-of-success rows, an Activate line, furniture, a closed fold, and the ours box.     */
/* test/card-details.test.tsx renders the REAL popup for every feat, class feature, item and spell    */
/* and requires its first such <p> to equal this function's answer — the walk below mirrors           */
/* AstRenderer's card Blocks / renderBlock and RichText's parseBlocks / inline, and that test is what */
/* keeps the mirror honest (a plain .ts file: no JSX, so jiti can import it).                         */
/* ------------------------------------------------------------------------------------------------ */

/** The lane a 'mine' card draws a record's body on: its page tree, or its text (no page of its own). */
export type PreviewLane = { tree: AstNode } | { text: string };

/**
 * Which lane RecordCard's 'mine' popup draws (RecordCard.tsx PopupRecordCard): a class feature the
 * viewer's class shares whose page is another class's — or that has no page — is drawn from its text cut
 * to the viewer's class paragraph (featureText.ts sharedFeatureFallback, card step 12); a record whose
 * page tree arrived is drawn from that tree, item lists cut and scoped to the character (scopeTree);
 * anything else from its own text. `tree` is the tree useAstNode resolves (astVisibility recordTree:
 * the slice, none for a not-own page, else variantSection); `text` the node's description.
 */
export function cardPreviewLane(r: { bucket: string; id: string; text: string; tree?: AstNode; scope?: CardScope; content?: ContentDatabase | null }): PreviewLane {
  if (r.content && r.bucket === 'classFeatures' && r.scope?.classId) {
    const shared = sharedFeatureFallback(r.id, r.scope.classId, r.tree ? textOf(r.tree) : undefined, r.content);
    if (shared !== null) return { text: shared };
  }
  return r.tree ? { tree: scopeTree(withoutItemLists(r.tree), r.scope) } : { text: r.text };
}

/** The preview line of a lane: the card's first own body paragraph as plain text ('' when it has none). */
export function cardPreview(lane: PreviewLane): string {
  const s = 'tree' in lane ? treeFirst(lane.tree.c ?? [], true, false) : textFirst(lane.text);
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/* ---- THE LINES A PAGE'S GLYPHS SIT IN: one copy, read by AstRenderer's Blocks / renderBlock AND by the
 * preview walk below, so a row's preview and its popup can never disagree about where a line ends. ---- */

/** Node types that render as their own block — a container holding one of these renders its children as
 *  blocks (AstRenderer imports this set; it is not a copy). */
export const BLOCK_TYPES: ReadonlySet<string> = new Set([
  'p', 'title', 'heading', 'h2', 'h3', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'aside', 'row', 'column', 'document', 'doc', 'hr', 'center', 'spoilers',
]);
const PV_TIERS = new Set(['critical success', 'success', 'failure', 'critical failure']);
const firstKid = (p: AstNode) => (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
/** AstRenderer successTier: a degree-of-success row (drawn as a div, not a paragraph). */
function pvTier(p: AstNode): boolean {
  const f = firstKid(p);
  return !!f && f.t === 'b' && PV_TIERS.has(textOf(f).trim().toLowerCase().replace(/:$/, ''));
}
const drawsGlyph = (n: AstNode | undefined) => !!n && n.t === 'actions' && !!String(n.string || '').trim();

/** A block node that is really an inline continuation of the previous paragraph — an AoN artifact where a
 *  sentence was split at a <sup> or after a soft break. A `sup`/`sub`, or a `p` whose text opens with
 *  punctuation or a lowercase letter (never a real new paragraph, which starts capitalized).
 *
 *  bug 2026-09-12 #9: inline-glyph — an `actions` node counts too, when `next` carries the sentence on
 *  ("…for example, “" / ⟨reaction⟩ / " command.”" arrived as three sibling blocks). */
export function isInlineFrag(n: AstNode | undefined, next?: AstNode): boolean {
  if (!n) return false; // `next` past the end of the run
  if (n.t === 'sup' || n.t === 'sub') return true;
  if (n.t === 'actions') return isInlineFrag(next);
  if (n.t !== 'p') return false;
  const t = textOf(n).trim();
  return t.length > 0 && t.length < 400 && /^[,.;:)\]]|^[a-z]/.test(t);
}

/** A paragraph that can carry on a glyph's line: words, not a degree-of-success row, not a leaked markdown
 *  marker, not a "- " list line (classFeatures:aberrant-eidolon's next anatomy line starts its own). */
function isLineP(n: AstNode | undefined): n is AstNode {
  if (!n || n.t !== 'p') return false;
  const raw = textOf(n).trim();
  return !!raw && !pvTier(n) && !/^#{1,6}$/.test(raw) && !/^[-*_]{3,}$/.test(raw) && !/^-\s/.test(raw);
}
/** One space, where the parser dropped the one the page prints beside a glyph. */
const SPACE: AstNode = { t: 'text', v: ' ' };
const startsSpaced = (n: AstNode) => /^\s/.test(textOf(n));
const endsSpaced = (n: AstNode) => /\s$/.test(textOf(n));

/**
 * The blocks after the paragraph `nodes[i]` that the page prints on ITS line, in order (SPACE nodes where
 * the parser dropped the page's space beside a glyph). Two joins:
 *  - a continuation fragment (isInlineFrag): "…for example, “Activate" ⟨reaction⟩ " command.”";
 *  - a glyph after a line that does not end its sentence with a full stop, with the paragraph after it:
 *    an embedded activity's header "Transcendence" ⟨2⟩ "(Spirit, Transcendence) Flowing Spirit Strike; Effect…"
 *    (classFeatures:gleaming-blade, ikon-6), "Patron’s Claim" ⟨2⟩ "Frequency once per hour; …" (feat-5019).
 *    The AoN markdown holds every such glyph INSIDE its paragraph's line ("**Transcendence** <actions
 *    string="Two Actions" /> ([Spirit]…"); the tree's parser split it into three sibling blocks.
 * Measured 2026-10-08 over the shipped trees against the mirror's markdown (all 20,787 paired pages): 792
 * block-level glyphs drew on a line of their own, and the mirror prints all 792 inside a line; with this rule
 * and glyphLedLine the line before and after agree with the mirror for 788. The 4 others are list items
 * whose markdown keeps every item on one line (spells:kinetic-ram's "⟨1⟩ The spell targets…"); there the
 * glyph opens its item, as glyphLedLine draws it.
 * `frags` = the pieces after `nodes[i]`; `end` = the index after the line; `own` = how many of `frags` come
 * before the first glyph join — the continuation the parser split off `nodes[i]` itself (all of them when
 * no glyph join happens). hideMeta drops a META paragraph with its own continuation, as it always did, and
 * keeps what a glyph join brought onto its line (AstRenderer lineEl).
 */
export function lineFrags(nodes: AstNode[], i: number): { frags: AstNode[]; end: number; own: number } {
  const frags: AstNode[] = [];
  let own = -1;
  let last = nodes[i];
  let j = i + 1;
  while (j < nodes.length) {
    const n = nodes[j];
    if (isInlineFrag(n, nodes[j + 1])) {
      frags.push(n);
      if (n.t !== 'actions') last = n;
      j++;
      continue;
    }
    if (n.t === 'actions' && last.t !== 'actions' && !/\.\s*$/.test(textOf(last))) {
      const nx = nodes[j + 1];
      const before = !endsSpaced(last);
      if (own < 0) own = frags.length;
      if (drawsGlyph(n) && before) frags.push(SPACE);
      frags.push(n);
      j++;
      if (isLineP(nx)) {
        // A glyph that draws nothing still stands between two words: one space, not two.
        if (!startsSpaced(nx) && (drawsGlyph(n) || before)) frags.push(SPACE);
        frags.push(nx);
        last = nx;
        j++;
      }
      continue;
    }
    break;
  }
  return { frags, end: j, own: own < 0 ? frags.length : own };
}

/** A glyph that OPENS its line — "⟨1⟩ The target is launched 10 feet into the air…" (spells:banishing-touch,
 *  spell-2152, whose markdown prints `<actions string="Single Action" /> The target is launched…` as one
 *  line) — and the paragraph it leads, with that paragraph's own continuation. `lead` gives the line its
 *  class; `pieces` = the glyph, the paragraph and its continuation; `end` = the index after the line;
 *  `unit` = [from, to) of `pieces`: the paragraph and the continuation the parser split off it (lineFrags
 *  `own`). Null when the glyph draws nothing or no paragraph follows it (then it keeps the .ast-actline it
 *  always had). */
export function glyphLedLine(nodes: AstNode[], i: number): { lead: AstNode; pieces: AstNode[]; end: number; unit: [number, number] } | null {
  const nx = nodes[i + 1];
  if (!drawsGlyph(nodes[i]) || !isLineP(nx)) return null;
  const { frags, end, own } = lineFrags(nodes, i + 1);
  const from = startsSpaced(nx) ? 1 : 2;
  return { lead: nx, pieces: [nodes[i], ...(startsSpaced(nx) ? [] : [SPACE]), nx, ...frags], end, unit: [from, from + 1 + own] };
}

/** An "Activate" paragraph led by its bold label and followed by its glyph, drawn as ONE line with what the
 *  page prints after the glyph — "Activate ⟨1⟩ command; Frequency once per day; Effect…", the wand of hybrid
 *  form's "Activate Cast a Spell; This activation takes ⟨2⟩ if the spell normally takes ⟨1⟩ to cast…"
 *  (equipment-2280). Measured 2026-10-08: 2,216 such lines in the shipped trees, and the mirror's markdown
 *  prints words after the glyph on the same line for all 2,216. `rest` = the pieces after the glyph on that
 *  line; `end` = the index after the line. Null when `nodes[i]` is no Activate line. */
export function activateLine(nodes: AstNode[], i: number): { glyph: AstNode; rest: AstNode[]; end: number } | null {
  const n = nodes[i];
  const b0 = n?.t === 'p' ? firstKid(n) : undefined;
  if (!b0 || b0.t !== 'b' || !/^activate/i.test(textOf(b0).trim()) || nodes[i + 1]?.t !== 'actions') return null;
  const nx = nodes[i + 2];
  if (!isLineP(nx)) return { glyph: nodes[i + 1], rest: [], end: i + 2 };
  const { frags, end } = lineFrags(nodes, i + 2);
  return { glyph: nodes[i + 1], rest: [...(startsSpaced(nx) ? [] : [SPACE]), nx, ...frags], end };
}

/** A line's pieces as one inline run: a paragraph gives its children; a glyph, a sup/sub and a SPACE stay. */
export function lineInline(pieces: AstNode[]): AstNode[] {
  return pieces.flatMap((pp) => (pp.t === 'sup' || pp.t === 'sub' || pp.t === 'actions' || pp.t === 'text' ? [pp] : pp.c || []));
}

/** The bits of a GLYPH LINE, in order, or null. The page nests "Activate" ⟨1⟩ "(manipulate)" as
 *  row > [row > p "Activate", actions, row > p "(manipulate)"], which AoN lays out as one flex line. Read as
 *  blocks, every nested row is a `p` (a block type) and a block-level `actions` is a .ast-actline of its own,
 *  so the card drew three lines (the owner, 2026-10-08). A glyph line is a row with a drawn `actions` child
 *  whose every other child is a `p` of inline content or a row of the same, at any depth; any other block
 *  inside leaves it a layout row, drawn as before. Every path draws it so (the 'mine' card, the browse
 *  card the card guards read as the page, the legacy popups), and the row preview reads the same line
 *  ("Activate (manipulate)"). 1,914 rows on 1,904 shipped pages, 1,906 of them "Activate" lines
 *  (measured 2026-10-08 over public/ast). */
export function glyphLineLeaves(n: AstNode): AstNode[] | null {
  if (!(n.c || []).some(drawsGlyph)) return null;
  const out: AstNode[] = [];
  const walk = (r: AstNode): boolean => (r.c || []).every((c) => {
    if (c.t === 'row') return walk(c);
    if (c.t === 'actions' || (c.t === 'p' && !(c.c || []).some((k) => BLOCK_TYPES.has(k.t)))) {
      if (c.t === 'actions' ? String(c.string || '').trim() : textOf(c).trim()) out.push(c);
      return true;
    }
    return c.t === 'text' && !textOf(c).trim();
  });
  return walk(n) ? out : null;
}

/* ---- the page lane: AstRenderer's card walk (printed set empty — every surface a preview stands for) ---- */

/** What AstRenderer's Inline draws, as text: a line break is a space, an action glyph is left out. */
function pvInline(nodes: AstNode[]): string {
  return nodes.map((n) => (n.t === 'text' ? clean(n.v ?? '') : n.t === 'br' ? ' ' : n.t === 'actions' ? '' : pvInline(n.c || []))).join('');
}
const pvSome = (s: string) => (s.replace(/\s+/g, ' ').trim() ? s : null);

function treeFirst(nodes: AstNode[], top: boolean, inherited: boolean): string | null {
  const headUntil = top ? cardHeadUntil(nodes) : -1;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const head = top ? headUntil >= 0 && i < headUntil : inherited;
    if (isCardFurnitureTitle(n)) { i = cardFurnitureSectionEnd(nodes, i) - 1; continue; }
    if (n.t === 'p') {
      // An Activate line (activateLine) is drawn with a class (.ast-act), so it is never the first line.
      const act = activateLine(nodes, i);
      if (act) { i = act.end - 1; continue; }
      const raw = textOf(n).trim();
      const meta = isMetaP(n);
      const marker = /^#{1,6}$/.test(raw) || /^[-*_]{3,}$/.test(raw);
      if (raw && !pvTier(n) && !marker) {
        const { frags, end } = lineFrags(nodes, i);
        if (frags.length && (!meta || frags.some((f) => f.t === 'actions'))) {
          i = end - 1;
          if (isCardFurnitureP(n, head) || (n as ScopedNode).applies || isCardDimP(n) || meta) continue;
          const s = pvSome(pvInline(lineInline([n, ...frags])));
          if (s !== null) return s;
          continue;
        }
      }
      if (!raw || marker || isCardFurnitureP(n, head) || (n as ScopedNode).applies || meta || isCardDimP(n) || pvTier(n)) continue;
      const s = pvSome(pvInline(n.c || []));
      if (s !== null) return s;
      continue;
    }
    if (n.t === 'view') {
      const s = pvSome(pvInline(n.c || []));
      if (s !== null) return s;
      continue;
    }
    // A glyph that opens its line (glyphLedLine): the line takes its paragraph's class, as AstRenderer draws it.
    const led = n.t === 'actions' ? glyphLedLine(nodes, i) : null;
    if (led) {
      i = led.end - 1;
      const p = led.lead;
      if (isCardFurnitureP(p, head) || (p as ScopedNode).applies || isCardDimP(p) || isMetaP(p)) continue;
      const s = pvSome(pvInline(lineInline(led.pieces)));
      if (s !== null) return s;
      continue;
    }
    // A glyph row (glyphLineLeaves): ONE line, its first paragraph's class — "Activate (manipulate)".
    const leaves = n.t === 'row' ? glyphLineLeaves(n) : null;
    if (leaves) {
      const first = leaves.find((f) => f.t === 'p');
      if (!first || isCardFurnitureP(first, head) || isCardDimP(first) || isMetaP(first)) continue;
      const s = pvSome(leaves.map((f) => (f.t === 'actions' ? '' : pvInline(f.c || []))).join(' '));
      if (s !== null) return s;
      continue;
    }
    // Not a paragraph of the record's own prose (or drawn with a class: a use / dim row, a heading).
    if (['title', 'heading', 'hr', 'traits', 'actions', 'spoilers', 'ul', 'ol', 'table', 'aside', 'card-fold'].includes(n.t)) continue;
    const kids = n.c || [];
    const recurse = n.t === 'row' ? kids.some((c) => BLOCK_TYPES.has(c.t))
      : n.t === 'column' || n.t === 'document' || n.t === 'doc' || n.t === 'card-pointer' || kids.some((c) => BLOCK_TYPES.has(c.t));
    if (!recurse) continue;
    const s = treeFirst(kids, false, head);
    if (s !== null) return s;
  }
  return null;
}

/* ---- the text lane: DescBody's markdown (RichText parseBlocks / inline) and rich-HTML branches ---- */

/** DescBody.tsx HTML_TAG (not exported there): a description it draws as rich HTML, not markdown. */
const PV_HTML_TAG = /<(a|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|span|br|div|p|hr|mark)\b/i;
const PV_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', times: '×', deg: '°',
  hellip: '…', frac12: '½', frac14: '¼', frac34: '¾', plusmn: '±', minus: '−',
};
/** RichText decodeEntities + stripAonMarkers + the residual-tag strip (cleanRun). */
function pvCleanRun(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name: string) => PV_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/<%[^>]*%>([\s\S]*?)<%END>/g, '$1')
    .replace(/<%[^>]*%>/g, '')
    .replace(/<%END>/g, '')
    .replace(/<\/?[a-z][^>]*>/gi, '');
}
/** RichText inline, as text: emphasis markers go, a ⟦highlight⟧ keeps its words, a ⟨N⟩ glyph is left out. */
const pvMdInline = (s: string) => pvCleanRun(s).replace(/\*\*([^*]+)\*\*|\*([^*]+)\*|⟦([^⟧]+)⟧|⟨([^⟩]+)⟩/g, (_, b, i, h) => b ?? i ?? h ?? '');
const PV_DS = /^\*\*(?:Critical Success|Critical Failure|Success|Failure)\*\*:?\s*/;

/** RichText parseBlocks, stopping at the first paragraph that is prose — not a degree-of-success row, and
 *  not led by a bold use / Source label (the text lane's twin of the page lane's use rows). */
function textFirst(text: string): string | null {
  if (!text) return null;
  if (PV_HTML_TAG.test(text)) return htmlFirst(text);
  const lines = text.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = (): string | null => {
    if (!para.length) return null;
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    para = [];
    if (!joined || PV_DS.test(joined)) return null;
    const lead = /^\*\*([^*]+)\*\*/.exec(pvCleanRun(joined));
    if (lead && META.test(lead[1].trim())) return null;
    return pvSome(pvMdInline(joined));
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const isTable = t.startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-');
    if (!t || /^(-{3,}|\*{3,}|_{3,})$/.test(t) || /^(#{1,4})\s+(.*)$/.test(t) || isTable || /^[-*]\s+(.*)$/.test(t) || /^\d+\.\s+(.*)$/.test(t)) {
      const s = flush();
      if (s !== null) return s;
      if (isTable) { let j = i + 2; while (j < lines.length && lines[j].trim().startsWith('|')) j++; i = j - 1; }
      continue;
    }
    para.push(t);
  }
  return flush();
}

/** The rich-HTML branch (user-authored text): its first <p>, else the run before the first line break. */
function htmlFirst(html: string): string | null {
  const p = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  const run = p ? p[1] : html.split(/<br\s*\/?>|<\/?(?:div|h[1-6]|ul|ol|li|blockquote|hr|table)\b[^>]*>/i).find((x) => pvCleanRun(x).trim()) ?? '';
  return pvSome(pvCleanRun(run));
}
