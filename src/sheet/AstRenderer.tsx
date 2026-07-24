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
import './ast.css';

/* ---------- text hygiene: strip AoN template artifacts + markdown backslash-escapes ---------- */
function clean(s: string): string {
  let out = String(s == null ? '' : s);
  if (out.indexOf('<%') !== -1) out = out.replace(/<%[^>]*?>/g, '').replace(/ {2,}/g, ' ');
  // Strip HTML tags that leaked into the text as literal characters — AoN artifacts like `</ br>`, `<br>`,
  // `<i>` that the parser didn't consume. Left in, they render as visible "</ br>" garbage.
  if (out.indexOf('<') !== -1)
    out = out.replace(/<\/?\s*(?:br|hr|p|div|span|i|b|em|strong|sup|sub|ul|ol|li|table|tr|td|th|a)\b[^>]*>/gi, ' ').replace(/ {2,}/g, ' ');
  if (out.indexOf('\\') !== -1) out = out.replace(/\\([!-/:-@[-`{-~])/g, '$1');
  return out;
}
function textOf(n: AstNode | undefined): string {
  if (!n) return '';
  if (n.t === 'text') return clean(n.v ?? '');
  return (n.c || []).map(textOf).join('');
}

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

interface Ctx { selfRef?: string; onOpenRef: (bucket: string, slug: string) => void; }

/** The engine/importer slug for a name — must match import-core-v2's slug() so a trait chip's label
 *  resolves to its shipped `trait` record (e.g. "Dwarf" → trait:dwarf). */
function refSlug(s: string): string {
  return String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
/** A trait chip → its "trait" reference bucket slug (traits are shipped as a reference bucket, so clicking a
 *  chip opens the trait's rules — matching the archives app, where every trait chip is a link). */
function traitRef(label: string): string {
  return refSlug(label);
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

/* ---------- meta line (bold label + value: Source/Range/Prerequisites/…) ---------- */
const META = /^(source|traditions?|deities|range|area|defense|target|targets|duration|cast|trigger|requirements?|prerequisites?|price|usage|bulk|access|frequency|cost|craft requirements)/i;
function isMetaP(p: AstNode): boolean {
  if (p.t !== 'p') return false;
  const first = (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
  return !!first && first.t === 'b' && META.test(textOf(first).trim());
}
function isSourceP(p: AstNode): boolean {
  const first = (p.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
  return !!first && first.t === 'b' && textOf(first).trim().toLowerCase() === 'source';
}

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
                .map((cell, j) =>
                  cell.t === 'th'
                    ? <th key={j}><Kids node={cell} ctx={ctx} /></th>
                    : <td key={j}><Kids node={cell} ctx={ctx} /></td>,
                )}
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
 * a full class/ancestry page renders in full, not just its loose paragraphs. `hideMeta` drops only the
 * Source/Range/… meta lines (detail views show their own stat block) — flavor prose is NEVER dimmed.
 */
function Blocks({ nodes, ctx, hideMeta, kb = 'b' }: { nodes: AstNode[]; ctx: Ctx; hideMeta?: boolean; kb?: string }): ReactNode {
  const out: ReactNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const key = `${kb}.${i}`;
    if (n.t === 'p') {
      const bold0 = (n.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
      // Activate—X immediately followed by an <actions> glyph → one inline (unboxed) activation line.
      if (bold0 && bold0.t === 'b' && /^activate/i.test(textOf(bold0).trim()) && nodes[i + 1]?.t === 'actions') {
        out.push(<p key={key} className="ast-act"><Kids node={n} ctx={ctx} /> <Glyph str={nodes[i + 1].string} /></p>);
        i++;
        continue;
      }
      // Reunite a sentence the parser split across sibling blocks by inline <sup>/continuation fragments
      // (AoN artifact: "…Fortitude" / sup"(F)" / ", Reflex" / sup"(R)" / … each became its own block, so
      // they stacked one-per-line). Greedily fold following sup/sub + continuation-p nodes into one <p>.
      const raw = textOf(n).trim();
      if (raw && !isMetaP(n) && !successTier(n) && !/^#{1,6}$/.test(raw) && !/^[-*_]{3,}$/.test(raw)) {
        let j = i + 1;
        const frags: AstNode[] = [];
        while (j < nodes.length && isInlineFrag(nodes[j])) { frags.push(nodes[j]); j++; }
        if (frags.length) {
          const combined: AstNode[] = [n, ...frags].flatMap((pp) => (pp.t === 'sup' || pp.t === 'sub' ? [pp] : pp.c || []));
          out.push(<p key={key}>{combined.map((c, ci) => <Inline key={ci} node={c} ctx={ctx} k={ci} />)}</p>);
          i = j - 1;
          continue;
        }
      }
    }
    const el = renderBlock(n, ctx, hideMeta, key);
    if (el != null) out.push(el);
  }
  return <>{out}</>;
}

/** A block node that is really an inline continuation of the previous paragraph — an AoN artifact where a
 *  sentence was split at a <sup> or after a soft break. A `sup`/`sub`, or a `p` whose text opens with
 *  punctuation or a lowercase letter (never a real new paragraph, which starts capitalized). */
function isInlineFrag(n: AstNode): boolean {
  if (n.t === 'sup' || n.t === 'sub') return true;
  if (n.t !== 'p') return false;
  const t = textOf(n).trim();
  return t.length > 0 && t.length < 400 && /^[,.;:)\]]|^[a-z]/.test(t);
}

function renderBlock(n: AstNode, ctx: Ctx, hideMeta: boolean | undefined, key: string): ReactNode {
  switch (n.t) {
    case 'traits':
      return null; // shown as chips in the header
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
      if (isMetaP(n)) return hideMeta ? null : <div key={key} className={'ast-meta' + (isSourceP(n) ? ' src' : '')}><Kids node={n} ctx={ctx} /></div>;
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
      return hideMeta ? null : <div key={key} className="ast-meta src"><Kids node={n.c && n.c[0] ? n.c[0] : n} ctx={ctx} /></div>;
    case 'ul':
    case 'ol': {
      const items = (n.c || []).filter((c) => c.t === 'li');
      if (!items.length) return null;
      const inner = items.map((li, i) => <li key={i}><Blocks nodes={li.c || []} ctx={ctx} hideMeta={hideMeta} kb={`${key}.${i}`} /></li>);
      return n.t === 'ol' ? <ol key={key} className="ast-list">{inner}</ol> : <ul key={key} className="ast-list">{inner}</ul>;
    }
    case 'table':
      return <TableEl key={key} node={n} ctx={ctx} />;
    case 'aside':
      return <aside key={key} className="ast-aside"><Blocks nodes={n.c || []} ctx={ctx} hideMeta={hideMeta} kb={key} /></aside>;
    case 'row': {
      const kids = n.c || [];
      // A row that holds BLOCK children (columns, a TABLE, paragraphs, lists…) is a layout/content row —
      // render those as blocks. (A row wrapping a table was the bug that mashed the whole exemplars table
      // into one inline run.) Only a row of purely inline bits is a compact "A; B; C" stat line.
      if (kids.some((c) => BLOCK_TYPES.has(c.t))) return <Blocks key={key} nodes={kids} ctx={ctx} hideMeta={hideMeta} kb={key} />;
      const parts = kids.filter((f) => textOf(f).trim());
      if (!parts.length) return null;
      return hideMeta ? null : <div key={key} className="ast-meta">{parts.map((f, m) => <Fragment key={m}>{m > 0 ? '; ' : ''}<Kids node={f} ctx={ctx} /></Fragment>)}</div>;
    }
    case 'column':
    case 'document':
    case 'doc':
      return <Blocks key={key} nodes={n.c || []} ctx={ctx} hideMeta={hideMeta} kb={key} />;
    case 'view':
      return <p key={key}><Kids node={n} ctx={ctx} /></p>;
    default:
      // Any other container (raw <h2>/<center>/<a> wrappers, etc.): if it holds BLOCK children, recurse as
      // blocks so its paragraphs/lists/tables/headings render properly (a raw <h2> on the Human page wraps
      // the whole Ethnicities section) instead of being flattened into one inline run. Otherwise it's an
      // inline node — render its children inline.
      return (n.c || []).some((c) => BLOCK_TYPES.has(c.t))
        ? <Blocks key={key} nodes={n.c || []} ctx={ctx} hideMeta={hideMeta} kb={key} />
        : <Fragment key={key}><Kids node={n} ctx={ctx} /></Fragment>;
  }
}

/** Node types that render as their own block — used to decide whether an unrecognized container should
 *  recurse as blocks (preserving paragraph/heading/table structure) or render inline. */
const BLOCK_TYPES = new Set([
  'p', 'title', 'heading', 'h2', 'h3', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr',
  'aside', 'row', 'column', 'document', 'doc', 'hr', 'center', 'spoilers',
]);

/** Render the doc's body faithfully (see Blocks). */
function DocBody({ top, ctx, hideMeta }: { top: AstNode[]; ctx: Ctx; hideMeta?: boolean }): ReactNode {
  return <Blocks nodes={top} ctx={ctx} hideMeta={hideMeta} kb="d" />;
}

/**
 * Full description popup content for one record's ast — header (name + action glyph + badge),
 * AoN-ordered colour-coded trait chips, then the meta + prose body. Slots into HH's popup chrome.
 */
export function AstRenderer({ node, selfRef, onOpenRef, bodyOnly, hideMeta, headerControls }: {
  node: AstNode;
  /** "bucket:slug" of the open record, so its self-links render as plain text */
  selfRef?: string;
  onOpenRef: (bucket: string, slug: string) => void;
  /** render only the meta+prose body (no popup chrome) — for embedding inside a detail/stat view */
  bodyOnly?: boolean;
  /** drop the Source/Range/… meta lines (detail views show their own stat block) */
  hideMeta?: boolean;
  /** controls (Back / pin / close) rendered at the right of the header, when the popup owns the chrome */
  headerControls?: ReactNode;
}): ReactNode {
  const ctx: Ctx = { selfRef, onOpenRef };
  const top = node.c || [];
  if (bodyOnly) return <div className="ast-body ast-embed"><DocBody top={top} ctx={ctx} hideMeta={hideMeta} /></div>;
  const title = top.find((n) => n.t === 'title' && Number(n.level || 1) <= 1) || top.find((n) => n.t === 'title');
  const name = title ? textOf(title.c?.find((x) => x.t === 'link' || x.t === 'text') || title) : '';
  const badge = title?.right;
  // action glyph hoisted from the title
  let cost: AstNode | undefined;
  if (title) (function find(x: AstNode) { if (cost) return; if (x.t === 'actions' && String(x.string || '').trim()) cost = x; (x.c || []).forEach(find); })(title);
  // trait chips
  const traitsNode = top.find((n) => n.t === 'traits');
  const traitLabels = traitsNode ? (traitsNode.c || []).map((t) => t.label || textOf(t)).filter(Boolean) as string[] : [];

  return (
    <div className="ast-pop">
      <div className="ast-bar" />
      <div className="ast-head">
        {name && <span className="ast-name">{name}</span>}
        {cost && <Glyph str={cost.string} head />}
        {(badge || headerControls) && (
          <span className="ast-head-right">
            {badge && <span className="ast-badge">{badge}</span>}
            {headerControls && <span className="ast-controls">{headerControls}</span>}
          </span>
        )}
      </div>
      {traitLabels.length > 0 && (
        <div className="ast-traits">
          {sortTraits(traitLabels).map((tn, i) => {
            const kind = traitKind(tn);
            const cls = 'ast-tr' + (kind ? ' ast-tr-' + kind : '');
            // Every trait chip is a link to its trait rules (traits are a shipped reference bucket), the way
            // the archives app renders them. A trait HH doesn't ship simply no-ops (openRef guards).
            return (
              <a key={i} className={cls + ' ast-tr-link'} role="button" tabIndex={0}
                 onClick={(e) => { e.preventDefault(); ctx.onOpenRef('trait', traitRef(tn)); }}
                 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onOpenRef('trait', traitRef(tn)); } }}>
                {tn}
              </a>
            );
          })}
        </div>
      )}
      <div className="ast-body"><DocBody top={top} ctx={ctx} hideMeta={hideMeta} /></div>
    </div>
  );
}
