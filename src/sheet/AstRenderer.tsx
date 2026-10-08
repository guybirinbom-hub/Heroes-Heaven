/**
 * Renders the AoN `ast` render tree in Heroes Heaven's approved description-popup styling
 * (migration Step 1). A faithful React port of the design-approved mockup + the archives' Ast.tsx
 * semantics: action glyphs, AoN-ordered colour-coded trait chips, compact dimmed meta, author-vs-auto
 * links, degree-of-success colouring, unboxed Activate, and <%…%> / markdown-escape hygiene.
 *
 * Cross-links carry a resolved `ref` ("bucket:slug"); clicking one calls onOpenRef. A link whose
 * target is the open document (self-link) renders as plain text; a link into an unshipped category
 * (ref === null) renders as inert styled text.
 */
import { Fragment, type ReactNode } from 'react';
import type { AstNode } from './astStore';
import { useContent } from './ContentContext';
import { openExternal } from '../platform';
/* Card step 1: the text hygiene (clean, textOf) and the meta predicates (META, isMetaP, isSourceP,
 * STAT_LABELS, isMetaishBlock) live in astVisibility.ts, a plain .ts file the card's guard imports
 * through jiti, so the guard and this renderer read one copy. */
import { clean, textOf, isMetaP, isSourceP } from './astVisibility';
/* Card step 5: the 'mine' card's cuts (printed set, furniture, dim lines) — the same functions the guard
 * models the card with (scripts/lib/card-scope.mjs). Reached only through the `card` prop; the browse
 * path never reads them. (Card step 22 removed the third path, `hideMeta`, the held-record popup body
 * every 'mine' card replaced.) */
import {
  cardDropsMetaP, cardDropsPrintedP, cardFurnitureSectionEnd, cardHeadUntil, cardRowParts, cardStatHeadMask, isCardDimP, isCardFurnitureP,
  isCardFurnitureTitle, type CardWalk,
} from './astVisibility';
/* Card step 13a: the level folds' node types (card-fold, card-pointer, `applies`), made only by
 * src/sheet/cardScope.ts scopeTree for a 'mine' card — a stored tree never carries them, so the browse
 * path never meets them. */
import { FOLD_LABEL, type ScopedNode } from './cardScope';
/* Card step 14: an embedded page stub resolved by astStubs.ts (made only where a card switches it on —
 * a stored tree's stubs are empty, so every other path draws them as nothing, as before). */
import type { StubbedNode } from './astStubs';
/* The lines a page's glyphs sit in (a split sentence, an activity header, a glyph that opens its line, an
 * Activate line, a glyph row) live in cardModel.ts, a plain .ts file, so the row preview (cardPreview) reads
 * the very same lines this renderer draws — one copy. */
import { BLOCK_TYPES, activateLine, glyphLedLine, glyphLineLeaves, lineFrags, lineInline } from './cardModel';
import './ast.css';

/** The Archives of Nethys; a page's own address (`/Rules.aspx?ID=1503`) is stamped on its tree root by
 *  scripts/stamp-ast-urls.mjs. */
const AON = 'https://2e.aonprd.com';

/* ---------- action cost -> the digit the Pathfinder action font renders (1/2/3, 4 free, 5 reaction) ---------- */
const DIGIT: Record<string, string> = {
  'single action': '1', 'one action': '1', 'two actions': '2', 'three actions': '3',
  'free action': '4', reaction: '5', '1 action': '1', '2 actions': '2', '3 actions': '3',
};
function Glyph({ str, head }: { str?: string; head?: boolean }): ReactNode {
  const s = String(str || '').trim().toLowerCase();
  if (!s) return null;
  const cls = 'ast-ag' + (head ? ' head' : '');
  const d = DIGIT[s];
  if (d) return <span className={cls} title={str}>{d}</span>;
  const p = s.split(/\s+(?:to|or)\s+/);
  if (p.length === 2 && DIGIT[p[0]] && DIGIT[p[1]])
    return <span className={cls} title={str}>{DIGIT[p[0]]}<span className="ast-ag-to">to</span>{DIGIT[p[1]]}</span>;
  return <span className={cls}>{str}</span>;
}

/* ---------- trait chip kind/order (AoN buckets: rarity, alignment, size, rest) ---------- */
const RK: Record<string, string> = { uncommon: 'uncommon', rare: 'rare', unique: 'unique' };
const SIZE = new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
const ALIGN = new Set(['lawful', 'chaotic', 'good', 'evil']);
function traitKind(name: string): string {
  const k = name.trim().toLowerCase();
  if (RK[k]) return RK[k];
  if (SIZE.has(k)) return 'size';
  if (ALIGN.has(k)) return 'align';
  return '';
}
const RANK: Record<string, number> = { uncommon: 0, rare: 0, unique: 0, align: 1, size: 2 };
function sortTraits(ts: string[]): string[] {
  return ts.slice().sort((a, b) => {
    const ra = RANK[traitKind(a)]; const rb = RANK[traitKind(b)];
    return (ra == null ? 3 : ra) - (rb == null ? 3 : rb);
  });
}

interface Ctx {
  selfRef?: string;
  onOpenRef: (bucket: string, slug: string) => void;
  /** Does this "bucket:slug" actually ship? A link whose target is absent rendered as a clickable
   *  anchor whose click did nothing — 3,692 of them, led by classFeatures:anathema (617 times) and
   *  actions:command (601). Absent ⇒ assume everything resolves, which is the old behaviour. */
  hasRef?: (bucket: string, slug: string) => boolean;
  /** Card step 14b: inside an embedded page ([data-stub]) — its trait chips draw where the page prints
   *  them (the host's own chips are the popup header's). */
  inStub?: boolean;
}

/** The engine/importer slug for a name — must match import-core-v2's slug() so a trait chip's label
 *  resolves to its shipped `trait` record (e.g. "Dwarf" → trait:dwarf). */
function refSlug(s: string): string {
  return String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** A trait chip → its "trait" reference bucket slug (traits are shipped as a reference bucket, so clicking a
 *  chip opens the trait's rules — matching the archives app, where every trait chip is a link).
 *
 *  A weapon trait is printed WITH ITS PARAMETER — "Deadly d8", "Versatile P", "Thrown 20 ft." — and
 *  the rules record is the bare trait. Slugging the whole label produced trait:deadly-d8, which ships
 *  nowhere, so tapping the most tappable chips on a weapon did nothing. Falls back to the base word.
 */
function traitRef(label: string, has?: (bucket: string, slug: string) => boolean): string {
  const full = refSlug(label);
  if (!has || has('trait', full)) return full;
  /*
   * Strip the parameter and try the bare trait. The printed forms vary more than they look:
   *   deadly-d8 · fatal-1d12 · two-hand-d10 · two-hand-1d8   (a die, with or without a count)
   *   versatile-p · modular-b-p-or-s                         (damage letters)
   *   thrown-20-ft · thrown-20-feet · volley-30-ft           (a distance)
   *   capacity-3 · reload-1 · additive-2 · hefty-2           (a bare number)
   *   twin-sheath · jousting-d6 · scatter-10-ft
   * Candidates are tried in order and accepted only if the bare trait actually ships.
   */
  const candidates = [
    full.replace(/-\d*d\d+$/, ''),
    full.replace(/-\d+(?:-(?:ft|feet))?$/, ''),
    full.replace(/-[a-z](?:-(?:or-)?[a-z])*$/, ''),
    full.replace(/-\d+(?:-(?:ft|feet))?-.*$/, ''),
    full.split('-')[0],
  ];
  for (const c of candidates) if (c && c !== full && has('trait', c)) return c;
  return full;
}

/** A page's trait chips, AoN-ordered and colour-coded (the popup header's; card step 14b also draws an
 *  embedded page's own, inside its [data-stub], with `className` added). */
function TraitChips({ labels, ctx, className }: { labels: string[]; ctx: Ctx; className?: string }): ReactNode {
  if (!labels.length) return null;
  return (
    <div className={'ast-traits' + (className ? ' ' + className : '')}>
      {sortTraits(labels).map((tn, i) => {
        const kind = traitKind(tn);
        const cls = 'ast-tr' + (kind ? ' ast-tr-' + kind : '');
        // Every trait chip links to its trait rules (traits are a shipped reference bucket), the
        // way the archives app renders them — but ONLY when the target ships. The inline-link path
        // has always fallen back to an inert style for a missing target; this one did not, so 484
        // chips across 439 pages looked and behaved like buttons (hover state, keyboard focus) and
        // did nothing on click. Looking clickable and doing nothing is worse than looking inert.
        const slug = traitRef(tn, ctx.hasRef);
        if (ctx.hasRef && !ctx.hasRef('trait', slug))
          return <span key={i} className={cls + ' ast-tr-dead'}>{tn}</span>;
        return (
          <a key={i} className={cls + ' ast-tr-link'} role="button" tabIndex={0}
             onClick={(e) => { e.preventDefault(); ctx.onOpenRef('trait', slug); }}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onOpenRef('trait', slug); } }}>
            {tn}
          </a>
        );
      })}
    </div>
  );
}
/** The chip labels of a `traits` node. */
function traitLabelsOf(traitsNode: AstNode | undefined): string[] {
  return traitsNode ? (traitsNode.c || []).map((t) => t.label || textOf(t)).filter(Boolean) as string[] : [];
}

/* ---------- inline rendering ---------- */
function Inline({ node, ctx, k }: { node: AstNode; ctx: Ctx; k: number }): ReactNode {
  switch (node.t) {
    case 'text': return <Fragment key={k}>{clean(node.v ?? '')}</Fragment>;
    case 'b': return <strong key={k}><Kids node={node} ctx={ctx} /></strong>;
    case 'i': return <em key={k}><Kids node={node} ctx={ctx} /></em>;
    case 'sup': return <sup key={k}><Kids node={node} ctx={ctx} /></sup>;
    case 'sub': return <sub key={k}><Kids node={node} ctx={ctx} /></sub>;
    case 'br': return <Fragment key={k}> </Fragment>;
    case 'actions': return <Glyph key={k} str={node.string} />;
    case 'link': {
      const label = <Kids node={node} ctx={ctx} />;
      if (node.ref && node.ref === ctx.selfRef) return <Fragment key={k}>{label}</Fragment>; // self-suppress
      if (node.ref) {
        const [bucket, slug] = node.ref.split(':');
        // A target that does not ship falls through to the dead style below, which is what ref:null
        // already does. Looking clickable and doing nothing is worse than looking inert.
        if (ctx.hasRef && !ctx.hasRef(bucket, slug))
          return <span key={k} className={'ast-lk-dead' + (node.auto ? ' auto' : '')}>{label}</span>;
        return (
          <a key={k} className={'ast-lk' + (node.auto ? ' auto' : '')} role="button" tabIndex={0}
             onClick={(e) => { e.preventDefault(); ctx.onOpenRef(bucket, slug); }}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onOpenRef(bucket, slug); } }}>
            {label}
          </a>
        );
      }
      return <span key={k} className={'ast-lk-dead' + (node.auto ? ' auto' : '')}>{label}</span>; // unshipped target
    }
    case 'xlink': // external URL (no in-app entry) — show its text, styled as an external reference
      return <span key={k} className="ast-lk-ext" title={String(node.url ?? '')}><Kids node={node} ctx={ctx} /></span>;
    case 'up-heighten':
      // Card step 17: the heightened damage arrow "(→ 10d6)" that src/sheet/heighteningTree.ts
      // injectTreeArrow splits into a spell page's prose — ours, never the page's (section 4: one of the two
      // inline insertions, `<span class="up-heighten" data-ours>`). A stored tree never carries this node.
      return <span key={k} className="up-heighten" data-ours="">{node.v}</span>;
    default: return <Fragment key={k}><Kids node={node} ctx={ctx} /></Fragment>;
  }
}
function Kids({ node, ctx }: { node: AstNode; ctx: Ctx }): ReactNode {
  return (node.c || []).map((c, i) => <Inline key={i} node={c} ctx={ctx} k={i} />);
}

/* ---------- degree-of-success outcome line ---------- */
const TIERS: Record<string, string> = { 'critical success': 'crit-success', success: 'success', failure: 'failure', 'critical failure': 'crit-failure' };
function successTier(p: AstNode): { kind: string; label: string; idx: number } | null {
  const idx = (p.c || []).findIndex((x) => !(x.t === 'text' && !textOf(x).trim()));
  const first = idx >= 0 ? (p.c as AstNode[])[idx] : undefined;
  if (!first || first.t !== 'b') return null;
  const t = textOf(first).trim().toLowerCase().replace(/:$/, '');
  return TIERS[t] ? { kind: TIERS[t], label: textOf(first).trim(), idx } : null;
}

/* meta line (bold label + value: Source/Range/Prerequisites/…) — isMetaP / isSourceP / isMetaishBlock
   are in astVisibility.ts (card step 1). */

/* A title node holds its text inside a <p>; unwrap it to inline content for a heading. */
function titleInline(n: AstNode): AstNode[] {
  return (n.c || []).flatMap((c) => (c.t === 'p' ? (c.c || []) : [c]));
}

/* A faithful table (AoN thead/tbody/tr/th/td). Header cells stay <th>; wrapped so a wide table scrolls
   inside the popup instead of forcing it wider. */
function TableEl({ node, ctx }: { node: AstNode; ctx: Ctx }): ReactNode {
  const rows: AstNode[] = [];
  (function collect(n: AstNode) {
    for (const c of n.c || []) {
      if (c.t === 'tr') rows.push(c);
      else if (c.t === 'thead' || c.t === 'tbody' || c.t === 'tfoot') collect(c);
    }
  })(node);
  if (!rows.length) return null;
  return (
    <div className="ast-tablewrap">
      <table className="ast-table">
        <tbody>
          {rows.map((tr, i) => (
            <tr key={i}>
              {(tr.c || [])
                .filter((c) => c.t === 'td' || c.t === 'th')
                .map((cell, j) => {
                  // The ast carries colspan/rowspan (288 and 62 cells, mostly the class advancement
                  // tables) and this dropped them, so every merged row rendered a cell short and the
                  // columns after it slid left.
                  const span = (v: unknown) => {
                    const n = Number(v);
                    return Number.isFinite(n) && n > 1 ? n : undefined;
                  };
                  const attrs = { colSpan: span(cell.colspan), rowSpan: span(cell.rowspan) };
                  return cell.t === 'th'
                    ? <th key={j} {...attrs}><Kids node={cell} ctx={ctx} /></th>
                    : <td key={j} {...attrs}><Kids node={cell} ctx={ctx} /></td>;
                })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Render a RUN of block nodes faithfully — every AoN node type (headings, tables, lists, asides, nested
 * documents, degree-of-success, unboxed Activate, meta lines). Recurses into row/column/document/aside so
 * a full class/ancestry page renders in full, not just its loose paragraphs. Flavor prose is NEVER dimmed.
 */
function Blocks({ nodes, ctx, kb = 'b', lead, card, headUntil, statMask }: { nodes: AstNode[]; ctx: Ctx; kb?: string; lead?: boolean; card?: CardWalk; headUntil?: number; statMask?: readonly boolean[] }): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const key = `${kb}.${i}`;
    /* Card step 5 ('mine' card only): at the top of the body, a block before the page's first rule is
     * header (`cw.head`); nested runs inherit their container's. The S-furniture "<X> leads to…" section
     * leaves with its heading and the link paragraph under it. Card step 14: `statMask` (astVisibility.ts
     * cardStatHeadMask) adds a variant section's own stat header for the printed-set drops (`statHead`). */
    const cw: CardWalk | undefined = card && headUntil !== undefined
      ? { printed: card.printed, head: headUntil >= 0 && i < headUntil, ...(statMask ? { statHead: !!statMask[i] } : {}) }
      : card;
    if (cw && isCardFurnitureTitle(n)) { i = cardFurnitureSectionEnd(nodes, i) - 1; continue; }
    /* Card step 14b: a run of an archetype page's feat stubs draws as ONE compact linked list. */
    if (isListStub(n)) {
      // An empty stub inside the run (a repeat the visited set drew as nothing) does not split the list.
      let j = i;
      while (isListStub(nodes[j]) || isBareStub(nodes[j])) j++;
      while (j > i && !isListStub(nodes[j - 1])) j--;
      out.push(<ul key={key} className="ast-list ast-stub-list" data-stub-list="">{nodes.slice(i, j).filter(isListStub).map((m, k) => <StubListItem key={k} node={m as StubbedNode} ctx={ctx} />)}</ul>);
      i = j - 1;
      continue;
    }
    /* bug 2026-09-12 #8: popup-divider — a rule with NOTHING above it.
     *
     * An AoN page is <stat header> <hr> <prose>. A popup that leaves the whole header out (the pre-card
     * detail popups did, through `hideMeta`, removed in card step 22; a 'mine' card does where its
     * surface's stat rows printed every header line) made the page's separator the FIRST thing in the
     * body: a line under the title bar with its own .7em margin above and below and nothing to separate.
     * Measured on the shipped artefact: 18,667 of 24,964 pages opened that way in the hideMeta path (0 in
     * the modal path, where the Source/stat lines do render above it — that popup is unchanged).
     *
     * `lead` is "nothing has been rendered before this run"; with an empty `out` this hr is the first
     * thing on screen. A divider is only a divider when it divides. */
    if (n.t === 'hr' && lead && !out.length) continue;
    if (n.t === 'p') {
      // Activate—X immediately followed by an <actions> glyph → one inline (unboxed) activation line, with
      // what the page prints after the glyph on the same line (cardModel.ts activateLine).
      const act = activateLine(nodes, i);
      if (act) {
        out.push(<p key={key} className="ast-act"><Kids node={n} ctx={ctx} /> <Glyph str={act.glyph.string} />{lineInline(act.rest).map((c, ci) => <Inline key={ci} node={c} ctx={ctx} k={ci} />)}</p>);
        i = act.end - 1;
        continue;
      }
      // Reunite a sentence the parser split across sibling blocks by inline <sup>/continuation fragments
      // (AoN artifact: "…Fortitude" / sup"(F)" / ", Reflex" / sup"(R)" / … each became its own block, so
      // they stacked one-per-line), and an activity header split at its glyph ("Transcendence" ⟨2⟩
      // "(Spirit, Transcendence) …"). cardModel.ts lineFrags says which following blocks share the line.
      const raw = textOf(n).trim();
      const meta = isMetaP(n);
      if (raw && !successTier(n) && !/^#{1,6}$/.test(raw) && !/^[-*_]{3,}$/.test(raw)) {
        const { frags, end: j } = lineFrags(nodes, i);
        /* A META line joins the fold ONLY to collect a split-out glyph — 78 rows in the modal path: 4
         * "Range ⟨1⟩ shortbow …" stat rows and 74 "Craft Requirements Supply a casting of ⟨2⟩ …" wand
         * lines, meta either way, so the glyph is never stranded below its label. It stays out of it
         * otherwise: the 3 other meta lines with a continuation include trait:asura, whose Source line is
         * followed by its flavour text, and folding that would dim a paragraph of prose into the source
         * line. "flavor prose is NEVER dimmed" is this renderer's rule; the glyph rows are not prose. */
        if (frags.length && (!meta || frags.some((f) => f.t === 'actions'))) {
          i = j - 1;
          const el = lineEl(n, [n, ...frags], key, ctx, cw);
          if (el != null) out.push(el);
          continue;
        }
      }
    }
    // A glyph that opens its line ("⟨1⟩ The target is launched 10 feet…", cardModel.ts glyphLedLine): one
    // line with its paragraph, drawn as that paragraph's line. Without one it keeps its .ast-actline.
    const led = n.t === 'actions' ? glyphLedLine(nodes, i) : null;
    if (led) {
      i = led.end - 1;
      const el = lineEl(led.lead, led.pieces, key, ctx, cw);
      if (el != null) out.push(el);
      continue;
    }
    const el = renderBlock(n, ctx, key, lead && !out.length, cw);
    if (el != null) out.push(el);
  }
  /* Rendered nothing ⇒ render NOTHING, not an empty fragment. A container whose children all drop out
   * (a `column` holding only a Source line without "pg. N", whose line the old hideMeta popup dropped)
   * was still an entry in the caller's `out`, so it counted as "something above" and kept the hr after
   * it: 32 pages — actions/tumbling-swipe, items/conundrum-spectacles, items/secret-keepers-mask and its
   * variants… — still opened on a rule. A 'mine' card's printed-set drops empty a container the same way. */
  return out.length ? <>{out}</> : null;
}

/** One reunited LINE (cardModel.ts lineFrags / glyphLedLine): `pieces` drawn inline, styled as its `lead`
 *  paragraph. Card step 5: on a card it follows the card's rules — left out only as furniture or S-printed
 *  (card step 14: for any header line, META or not), otherwise drawn whole at full weight (a dim label dims
 *  it). Elsewhere (browse) a reunited meta row keeps the meta branch's styling. */
function lineEl(lead: AstNode, pieces: AstNode[], key: string, ctx: Ctx, cw: CardWalk | undefined): ReactNode {
  const meta = isMetaP(lead);
  const kids = lineInline(pieces).map((c, ci) => <Inline key={ci} node={c} ctx={ctx} k={ci} />);
  if (cw) {
    if (isCardFurnitureP(lead, cw.head) || cardDropsPrintedP(lead, cw)) return null;
    return <p key={key} className={(lead as ScopedNode).applies ? 'card-applies' : isCardDimP(lead) ? 'card-dim' : meta ? 'card-use' : undefined}>{kids}</p>;
  }
  return meta
    ? <div key={key} className={'ast-meta' + (isSourceP(lead) ? ' src' : '')}>{kids}</div>
    : <p key={key}>{kids}</p>;
}

/** A paragraph without its leading bold label (the META / printed label a line opens on) — what a dropped
 *  label leaves behind; the paragraph itself when it opens on no bold label. */
function withoutLabel(p: AstNode): AstNode {
  const c = p.c || [];
  const i = c.findIndex((x) => !(x.t === 'text' && !textOf(x).trim()));
  return i >= 0 && c[i].t === 'b' ? { ...p, c: c.slice(i + 1) } : p;
}
/** An inline piece that draws something: words, or a glyph with a cost. */
const drawsWords = (c: AstNode): boolean => (c.t === 'actions' ? !!String(c.string || '').trim() : !!textOf(c).trim());

/** A container that renders as its children — and as nothing at all when they all render nothing, so it
 *  never stands in for content above a divider (see the end of Blocks). */
function subBlocks(props: Parameters<typeof Blocks>[0], key: string): ReactNode {
  const inner = Blocks(props);
  return inner == null ? null : <Fragment key={key}>{inner}</Fragment>;
}

/* isInlineFrag (bug 2026-09-12 #9, inline-glyph: a continuation fragment, a split-out glyph included) moved
 * to cardModel.ts with lineFrags, which it feeds. Its old claim — "a glyph that ENDS the run, or is followed
 * by a real new paragraph, is an ability heading's cost and keeps its block line" — did not survive the
 * mirror: every one of the 792 block-level glyphs still drawn alone on 2026-10-08 sits INSIDE a line of the
 * page's markdown ("**Call Gun** <actions string="Single Action" /> ([magical]…"), so lineFrags and
 * glyphLedLine draw them inline. */

function renderBlock(n: AstNode, ctx: Ctx, key: string, lead?: boolean, card?: CardWalk): ReactNode {
  switch (n.t) {
    case 'traits':
      // Shown as chips in the header — the host page's. Card step 14b: an embedded page's own chips draw
      // where it prints them, inside its [data-stub] (they are not the host record's traits).
      return ctx.inStub ? <TraitChips key={key} labels={traitLabelsOf(n)} ctx={ctx} className="ast-stub-traits" /> : null;
    case 'title': {
      const lvl = Number(n.level ?? 1);
      if (lvl <= 1) return null; // the page name is the popup header
      const cls = lvl === 2 ? 'ast-h2' : 'ast-h3';
      const inner = titleInline(n);
      if (!inner.length) return null;
      return (
        <div key={key} className={cls}>
          <span className="ast-hname">{inner.map((c, i) => <Inline key={i} node={c} ctx={ctx} k={i} />)}</span>
          {n.right ? <span className="ast-hbadge">{String(n.right)}</span> : null}
        </div>
      );
    }
    case 'heading':
      return <div key={key} className={Number(n.level ?? 2) <= 1 ? 'ast-h2' : 'ast-h3'}><span className="ast-hname"><Kids node={n} ctx={ctx} /></span></div>;
    case 'hr':
      return <hr key={key} className="ast-hr" />;
    case 'p': {
      const raw = textOf(n).trim();
      if (!raw) return null;
      // A leaked markdown marker on its own (`##`, `---`, `***`) — drop it rather than print the symbols.
      if (/^#{1,6}$/.test(raw) || /^[-*_]{3,}$/.test(raw)) return null;
      // Card step 5: every labelled page line shows once, in the page's words, at full weight —
      // unless it is furniture, or a header line the surface's own stat rows printed (S-printed).
      if (card) {
        if (isCardFurnitureP(n, card.head)) return null;
        // Card step 14: a header line outside META whose every label the stat rows printed ("Damage 1d10 S"
        // under the item popup's own Damage row) leaves too — S-printed, as a META line does below.
        if (cardDropsPrintedP(n, card)) return null;
        // Card step 13a: an impulse "Level (+N)" / "Level (Nth)" entry that applies at the character's
        // level is highlighted — a class on the page's own paragraph; not a word changes.
        if ((n as ScopedNode).applies) return <p key={key} className="card-applies"><Kids node={n} ctx={ctx} /></p>;
        if (isMetaP(n)) return cardDropsMetaP(n, card) ? null : <p key={key} className={isCardDimP(n) ? 'card-dim' : 'card-use'}><Kids node={n} ctx={ctx} /></p>;
        if (isCardDimP(n)) return <p key={key} className="card-dim"><Kids node={n} ctx={ctx} /></p>;
      }
      if (isMetaP(n)) return <div key={key} className={'ast-meta' + (isSourceP(n) ? ' src' : '')}><Kids node={n} ctx={ctx} /></div>;
      const t = successTier(n);
      if (t) {
        const rest = (n.c || []).slice(t.idx + 1).map((c, i) => <Inline key={i} node={c} ctx={ctx} k={i} />);
        return <div key={key} className={'ast-ds ast-ds-' + t.kind}><span className="ast-ds-lbl">{t.label}</span> {rest}</div>;
      }
      return <p key={key}><Kids node={n} ctx={ctx} /></p>;
    }
    case 'actions':
      return String(n.string || '').trim() ? <div key={key} className="ast-actline"><Glyph str={n.string} /></div> : null;
    case 'spoilers':
      if (card) return null; // S-furniture: a spoiler banner is navigation, not the record's rules
      return <div key={key} className="ast-meta src"><Kids node={n.c && n.c[0] ? n.c[0] : n} ctx={ctx} /></div>;
    case 'ul':
    case 'ol': {
      const items = (n.c || []).filter((c) => c.t === 'li');
      if (!items.length) return null;
      const inner = items.map((li, i) => <li key={i}><Blocks nodes={li.c || []} ctx={ctx} kb={`${key}.${i}`} card={card} /></li>);
      return n.t === 'ol' ? <ol key={key} className="ast-list">{inner}</ol> : <ul key={key} className="ast-list">{inner}</ul>;
    }
    case 'table':
      return <TableEl key={key} node={n} ctx={ctx} />;
    case 'aside':
      return <aside key={key} className="ast-aside"><Blocks nodes={n.c || []} ctx={ctx} kb={key} card={card} /></aside>;
    case 'row': {
      // A layout row is never dropped whole (card step 5: a 'mine' card recurses into it; the old hideMeta
      // popup body that dropped a leading Source/stat row left in card step 22).
      const kids = n.c || [];
      // A glyph line (glyphLineLeaves): ONE line, the glyph inline, as AoN's flex row draws it — the element
      // and class renderBlock 'p' gives its label's paragraph alone (an "Activate" line is a plain <p>).
      const leaves = glyphLineLeaves(n);
      if (leaves) {
        const fi = leaves.findIndex((f) => f.t === 'p');
        const first = fi >= 0 ? leaves[fi] : undefined;
        const meta = !!first && isMetaP(first);
        const draw = (ls: AstNode[]) => ls.map((f, m) => <Fragment key={m}>{m > 0 ? ' ' : ''}{f.t === 'actions' ? <Glyph str={f.string} /> : <Kids node={f} ctx={ctx} />}</Fragment>);
        /* A paragraph the surface leaves out never takes the glyph and the other words of the line along:
         * the row's PRINTED label leaves alone (with every label printed the row "Activate ⟨1⟩ (manipulate)"
         * still draws "⟨1⟩ (manipulate)", as the three blocks did before the row became one line); a later
         * printed paragraph and card furniture leave as the whole paragraph they are — what each one did
         * as a block of its own. */
        if (card) {
          const ls = leaves.flatMap((f, m): AstNode[] => {
            if (f.t !== 'p') return [f];
            if (isCardFurnitureP(f, card.head)) return [];
            if (cardDropsPrintedP(f, card)) return m === fi ? [withoutLabel(f)] : [];
            return [f];
          }).filter(drawsWords);
          if (!ls.length) return null;
          return <p key={key} className={first && isCardDimP(first) ? 'card-dim' : meta ? 'card-use' : undefined}>{draw(ls)}</p>;
        }
        if (meta) return <div key={key} className={'ast-meta' + (isSourceP(first!) ? ' src' : '')}>{draw(leaves)}</div>;
        return <p key={key}>{draw(leaves)}</p>;
      }
      // A row that holds BLOCK children (columns, a TABLE, paragraphs, lists…) is a layout/content row —
      // render those as blocks. (A row wrapping a table was the bug that mashed the whole exemplars table
      // into one inline run.) Only a row of purely inline bits is a compact "A; B; C" stat line.
      if (kids.some((c) => BLOCK_TYPES.has(c.t))) return subBlocks({ nodes: kids, ctx, kb: key, lead, card }, key);
      const parts = kids.filter((f) => textOf(f).trim());
      if (card) {
        // Card step 5: filtered per bold-label segment (S-printed), the rest drawn at full weight.
        const keep = cardRowParts(parts, card);
        if (!keep.length) return null;
        return <p key={key} className={keep.every(isCardDimP) ? 'card-dim' : 'card-use'}>{keep.map((f, m) => <Fragment key={m}>{m > 0 ? '; ' : ''}<Kids node={f} ctx={ctx} /></Fragment>)}</p>;
      }
      if (!parts.length) return null;
      return <div key={key} className="ast-meta">{parts.map((f, m) => <Fragment key={m}>{m > 0 ? '; ' : ''}<Kids node={f} ctx={ctx} /></Fragment>)}</div>;
    }
    case 'column':
      // Its children as blocks (the leading Source + stat column of an armor / weapon / gear page included:
      // a 'mine' card judges its lines one by one against the surface's printed set).
      return subBlocks({ nodes: n.c || [], ctx, kb: key, lead, card }, key);
    case 'document':
    case 'doc': {
      // Card step 14 (section 2 rule 6): a stub resolved by src/sheet/astStubs.ts resolveStubs carries the
      // page it embeds (`stubOf`) — another record's page, drawn inline as AoN draws it, inside a wrapper
      // that names it ([data-stub]). A stub nobody resolved stays empty and draws nothing, as before.
      const sn = n as StubbedNode;
      // Card step 14b: a stub drawn as its name (no record's page answers it), or a lone compact list entry
      // (Blocks draws a run of them as one list).
      if (sn.stubKind === 'name') return <StubName key={key} node={sn} ctx={ctx} />;
      if (sn.stubKind === 'list') return <ul key={key} className="ast-list ast-stub-list" data-stub-list=""><StubListItem node={sn} ctx={ctx} /></ul>;
      const from = sn.stubOf;
      if (!from) return subBlocks({ nodes: n.c || [], ctx, kb: key, lead, card }, key);
      // Card step 14b (orchestrator ruling, round 3): an embedded page is drawn AS PRINTED — the card walk
      // (S-furniture cuts, dim / use classes, the host's printed-set drops) does not reach inside it, so
      // its spoiler banner and its "click here" line stay on a mine card as they do on browse. It is
      // another record's page, not the character's.
      const inner = Blocks({ nodes: n.c || [], ctx: { ...ctx, inStub: true }, kb: key });
      return inner == null ? null : <div key={key} className="ast-stub" data-stub={from}>{inner}</div>;
    }
    case 'view':
      return <p key={key}><Kids node={n} ctx={ctx} /></p>;
    case 'card-fold':
      // Card step 13a: a folded run of later-level / not-owned sections (made only for a 'mine' card).
      return card ? <CardFoldEl key={key} node={n} ctx={ctx} card={card} kb={key} /> : null;
    case 'card-pointer':
      // Card step 13a: the subclass section a pointer row shows ("listed in your cause"), print from
      // the subclass page named in data-pointer.
      return card ? <div key={key} className="card-pointer" data-pointer={(n as ScopedNode).pointerFrom}><Blocks nodes={n.c || []} ctx={ctx} kb={key} card={card} /></div> : null;
    default:
      // Any other container (raw <h2>/<center>/<a> wrappers, etc.): if it holds BLOCK children, recurse as
      // blocks so its paragraphs/lists/tables/headings render properly (a raw <h2> on the Human page wraps
      // the whole Ethnicities section) instead of being flattened into one inline run. Otherwise it's an
      // inline node — render its children inline.
      return (n.c || []).some((c) => BLOCK_TYPES.has(c.t))
        ? subBlocks({ nodes: n.c || [], ctx, kb: key, lead, card }, key)
        : <Fragment key={key}><Kids node={n} ctx={ctx} /></Fragment>;
  }
}

/**
 * Card step 13a (docs/card-design.md section 3; owner ruling Q1 = A): a run of sections the character
 * does not have yet, as src/sheet/cardScope.ts FUTURE_TREATMENT says —
 *  - 'fold': ONE closed, dimmed line "At higher levels (k)" (or "Other options (k)" for an option the
 *    build does not have) that opens on a tap or the keyboard (a <details>/<summary>); the folded text
 *    stays in the DOM. The line is ours (data-ours); the wrapper carries data-fold for the guard.
 *  - 'hide': nothing drawn — a marker element (data-fold, no text) stays where the run was.
 *  - 'grey': the text in place, dimmed.
 */
function CardFoldEl({ node, ctx, card, kb }: { node: AstNode; ctx: Ctx; card: CardWalk; kb: string }): ReactNode {
  const f = node as ScopedNode;
  const reason = f.foldReason ?? 'future';
  const count = f.foldIds?.length ?? 0;
  if (f.treatment === 'hide') return <span className="card-fold-hidden" data-fold={reason} data-fold-count={count} hidden />;
  const body = <Blocks nodes={f.c || []} ctx={ctx} kb={kb} card={card} />;
  if (f.treatment === 'grey') return <div className="card-fold-grey card-dim" data-fold={reason}>{body}</div>;
  return (
    <details className="card-fold" data-fold={reason}>
      <summary className="card-fold-line" data-ours="">{FOLD_LABEL[reason]} ({count})</summary>
      <div className="card-fold-body">{body}</div>
    </details>
  );
}

/**
 * Card step 14b (docs/card-design.md section 2 rule 6): the stubs drawn without a page body, made only by
 * src/sheet/astStubs.ts resolveStubs (a stored tree never carries `stubKind`). The name is a link that
 * opens the record's card (the same anchor a page cross-link draws, through Inline) when a record exists
 * for it, else plain text. Each element names what it draws in `data-stub` — the record's page
 * ("bucket:slug") for a list entry that resolved, "aon:<id>" for a stub no record's page answers — so a
 * reader (test/card-parity.test.tsx SKIP_SEL) reads past it as it does past an embedded page.
 */
function stubLabel(node: StubbedNode, ctx: Ctx): ReactNode {
  const text: AstNode = { t: 'text', v: node.stubName ?? '' };
  return node.stubLink ? <Inline node={{ t: 'link', ref: node.stubLink, c: [text] }} ctx={ctx} k={0} /> : <Inline node={text} ctx={ctx} k={0} />;
}
function StubListItem({ node, ctx }: { node: StubbedNode; ctx: Ctx }): ReactNode {
  return (
    <li className="ast-stub-item" data-stub={node.stubOf ?? `aon:${node.id}`}>
      {stubLabel(node, ctx)}
      {node.stubRight ? <> <span className="ast-hbadge">{node.stubRight}</span></> : null}
    </li>
  );
}
function StubName({ node, ctx }: { node: StubbedNode; ctx: Ctx }): ReactNode {
  return (
    <div className={(Number(node.level ?? 2) <= 2 ? 'ast-h2' : 'ast-h3') + ' ast-stub-name'} data-stub={`aon:${node.id}`}>
      <span className="ast-hname">{stubLabel(node, ctx)}</span>
      {node.stubRight ? <span className="ast-hbadge">{node.stubRight}</span> : null}
    </div>
  );
}
const isListStub = (n: AstNode | undefined) => !!n && (n.t === 'document' || n.t === 'doc') && (n as StubbedNode).stubKind === 'list';
/** An embedded stub nothing resolved: it draws nothing. */
const isBareStub = (n: AstNode | undefined) => !!n && (n.t === 'document' || n.t === 'doc') && !(n.c && n.c.length) && !(n as StubbedNode).stubKind;

/* glyphLineLeaves (a glyph ROW drawn as one line) and BLOCK_TYPES (the node types that render as their own
 * block) live in cardModel.ts, imported above, so the row preview reads the same lines. */

/** Render the doc's body faithfully (see Blocks). */
function DocBody({ top, ctx, card }: { top: AstNode[]; ctx: Ctx; card?: CardWalk }): ReactNode {
  /* `lead` starts true here and only here: this run IS the top of the popup body, so a divider it
   * reaches before anything else has nothing above it (bug #8). */
  if (card) return <Blocks nodes={top} ctx={ctx} kb="d" lead card={card} headUntil={cardHeadUntil(top)} statMask={cardStatHeadMask(top)} />;
  return <Blocks nodes={top} ctx={ctx} kb="d" lead />;
}

/**
 * Full description popup content for one record's ast — header (name + action glyph + badge),
 * AoN-ordered colour-coded trait chips, then the meta + prose body. Slots into HH's popup chrome.
 */
export function AstRenderer({ node, selfRef, onOpenRef, bodyOnly, card, headerControls, footer, lead }: {
  node: AstNode;
  /** "bucket:slug" of the open record, so its self-links render as plain text */
  selfRef?: string;
  onOpenRef: (bucket: string, slug: string) => void;
  /** render only the meta+prose body (no popup chrome) — for embedding inside a detail/stat view */
  bodyOnly?: boolean;
  /** Card step 5 — a 'mine' card: the surface's printed set (docs/card-design.md section 2 rules 4–5;
   *  it replaced the old `hideMeta` drop, which card step 22 removed). Every labelled page line shows
   *  unless its label is printed; furniture leaves; Source / Archetype / Access / Craft Requirements /
   *  PFS Note are dimmed. */
  card?: { printed: ReadonlySet<string> };
  /** controls (Back / pin / close) rendered at the right of the header, when the popup owns the chrome */
  headerControls?: ReactNode;
  /** a line of ours after the page's prose, inside the scrolling body (desk #158's "Remastered as …") */
  footer?: ReactNode;
  /** Card step 10 — the 'mine' card's controls that stay above the page (RecordCard leadControls:
   *  Strike's Attack / Damage and its gated critical specialization), first inside the scrolling body.
   *  Absent = nothing drawn, so every other popup's markup is unchanged. */
  lead?: ReactNode;
}): ReactNode {
  // A link's target must actually ship, or it renders inert rather than as a button that does nothing.
  const content = useContent();
  const hasRef = content
    ? (bucket: string, slug: string) => !!(content as unknown as Record<string, Record<string, unknown> | undefined>)[bucket]?.[slug]
    : undefined;
  const ctx: Ctx = { selfRef, onOpenRef, hasRef };
  const top = node.c || [];
  const cw: CardWalk | undefined = card ? { printed: card.printed, head: false } : undefined;
  if (bodyOnly) return <div className="ast-body ast-embed"><DocBody top={top} ctx={ctx} card={cw} />{footer}</div>;
  const title = top.find((n) => n.t === 'title' && Number(n.level || 1) <= 1) || top.find((n) => n.t === 'title');
  const name = title ? textOf(title.c?.find((x) => x.t === 'link' || x.t === 'text') || title) : '';
  const badge = title?.right;
  // action glyph hoisted from the title
  let cost: AstNode | undefined;
  if (title) (function find(x: AstNode) { if (cost) return; if (x.t === 'actions' && String(x.string || '').trim()) cost = x; (x.c || []).forEach(find); })(title);
  // trait chips
  const traitLabels = traitLabelsOf(top.find((n) => n.t === 'traits'));
  // The page on the Archives, where the record came from.
  const aonUrl = /^\/\w+\.aspx/.test(String(node.url ?? '')) ? AON + node.url : '';

  return (
    <div className="ast-pop">
      <div className="ast-bar" />
      <div className="ast-head">
        {name && <span className="ast-name">{name}</span>}
        {cost && <Glyph str={cost.string} head />}
        {(badge || headerControls || aonUrl) && (
          <span className="ast-head-right">
            {badge && <span className="ast-badge">{badge}</span>}
            {aonUrl && (
              <a className="ast-aon" href={aonUrl} target="_blank" rel="noreferrer"
                 title="Open this page on Archives of Nethys" aria-label="Open on Archives of Nethys"
                 onClick={(e) => { e.stopPropagation(); void openExternal(e, aonUrl); }}>
                <i className="ti ti-external-link" aria-hidden="true" />
              </a>
            )}
            {headerControls && <span className="ast-controls">{headerControls}</span>}
          </span>
        )}
      </div>
      <TraitChips labels={traitLabels} ctx={ctx} />
      <div className="ast-body">{lead}<DocBody top={top} ctx={ctx} card={cw} />{footer}</div>
    </div>
  );
}
