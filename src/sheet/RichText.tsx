import { type ReactNode } from 'react';
import type { DescRef } from '../rules/types';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* =========================================================================
 * Markdown-lite block model.
 *
 * The importer converts each Foundry HTML description into a compact markup: blank-line-separated
 * paragraphs, "---" dividers, "#"/"##"/"###" headings, "- "/"1. " lists, GFM "| … |" tables, and
 * "**bold**" / "*italic*" runs. The degree-of-success outcomes (Critical Success / Success /
 * Failure / Critical Failure) arrive as paragraphs led by a bold label and are rendered as
 * color-coded rows. parseBlocks() turns that markup into a block list; the renderer styles each.
 * ========================================================================= */

type DsTier = 'crit-success' | 'success' | 'failure' | 'crit-failure';
const DS_LABEL: Record<DsTier, string> = {
  'crit-success': 'Critical Success',
  success: 'Success',
  failure: 'Failure',
  'crit-failure': 'Critical Failure',
};
// Longest labels first so "Critical Success" wins over "Success".
const DS_MATCH: { tier: DsTier; re: RegExp }[] = [
  { tier: 'crit-success', re: /^\*\*Critical Success\*\*:?\s*/ },
  { tier: 'crit-failure', re: /^\*\*Critical Failure\*\*:?\s*/ },
  { tier: 'success', re: /^\*\*Success\*\*:?\s*/ },
  { tier: 'failure', re: /^\*\*Failure\*\*:?\s*/ },
];

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'ds'; tier: DsTier; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'hr' }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function splitCells(row: string): string[] {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** Parse markdown-lite into a block list. Pure (exported for tests). */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    para = [];
    if (!joined) return;
    const ds = DS_MATCH.find((d) => d.re.test(joined));
    if (ds) blocks.push({ kind: 'ds', tier: ds.tier, text: joined.replace(ds.re, '') });
    else blocks.push({ kind: 'p', text: joined });
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      flushPara();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      blocks.push({ kind: 'hr' });
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      blocks.push({ kind: 'h', level: h[1].length, text: h[2].trim() });
      continue;
    }
    // Table: a "| … |" row whose next line is a "| --- | --- |" separator.
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
      flushPara();
      const headers = splitCells(t);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        rows.push(splitCells(lines[j].trim()));
        j++;
      }
      blocks.push({ kind: 'table', headers, rows });
      i = j - 1;
      continue;
    }
    const li = t.match(/^[-*]\s+(.*)$/);
    if (li) {
      flushPara();
      const items = [li[1]];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].trim().match(/^[-*]\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        j++;
      }
      blocks.push({ kind: 'ul', items });
      i = j - 1;
      continue;
    }
    const oli = t.match(/^\d+\.\s+(.*)$/);
    if (oli) {
      flushPara();
      const items = [oli[1]];
      let j = i + 1;
      while (j < lines.length) {
        const m = lines[j].trim().match(/^\d+\.\s+(.*)$/);
        if (!m) break;
        items.push(m[1]);
        j++;
      }
      blocks.push({ kind: 'ol', items });
      i = j - 1;
      continue;
    }
    para.push(t);
  }
  flushPara();
  return blocks;
}

interface Ctx {
  byLabel: Map<string, DescRef>;
  re: RegExp | null;
  onOpen: (ref: DescRef) => void;
}

/** Turn referenced terms in a plain-text run into clickable links (word-boundary, longest-first). */
function linkify(text: string, ctx: Ctx, keyBase: string): ReactNode[] {
  if (!ctx.re) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  ctx.re.lastIndex = 0;
  while ((m = ctx.re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const before = start === 0 ? '' : text[start - 1];
    const after = end >= text.length ? '' : text[end];
    const boundaryOk = !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
    const ref = ctx.byLabel.get(m[0].toLowerCase());
    if (!boundaryOk || !ref) continue;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <button key={`${keyBase}-l${key++}`} type="button" className="desc-link" onClick={() => ctx.onOpen(ref!)}>
        {m[0]}
      </button>,
    );
    last = end;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : [text];
}

/** Render a text run with **bold** / *italic* emphasis and linkified references inside each part. */
function inline(text: string, ctx: Ctx, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...linkify(text.slice(last, m.index), ctx, `${keyBase}-t${k}`));
    if (m[1] != null) out.push(<strong key={`${keyBase}-b${k}`}>{linkify(m[1], ctx, `${keyBase}-bb${k}`)}</strong>);
    else out.push(<em key={`${keyBase}-i${k}`}>{linkify(m[2], ctx, `${keyBase}-ii${k}`)}</em>);
    last = re.lastIndex;
    k++;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), ctx, `${keyBase}-e`));
  return out;
}

function renderBlock(b: Block, ctx: Ctx, i: number): ReactNode {
  const key = `b${i}`;
  switch (b.kind) {
    case 'hr':
      return <hr className="rt-hr" key={key} />;
    case 'h':
      return (
        <div className={`rt-h rt-h${b.level}`} key={key}>
          {inline(b.text, ctx, key)}
        </div>
      );
    case 'ds':
      return (
        <div className={`rt-ds rt-ds-${b.tier}`} key={key}>
          <span className="rt-ds-label">{DS_LABEL[b.tier]}</span>
          <span className="rt-ds-text">{inline(b.text, ctx, key)}</span>
        </div>
      );
    case 'ul':
      return (
        <ul className="rt-ul" key={key}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it, ctx, `${key}-${j}`)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="rt-ol" key={key}>
          {b.items.map((it, j) => (
            <li key={j}>{inline(it, ctx, `${key}-${j}`)}</li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="rt-table-wrap" key={key}>
          <table className="rt-table">
            {b.headers.some(Boolean) && (
              <thead>
                <tr>
                  {b.headers.map((h, j) => (
                    <th key={j}>{inline(h, ctx, `${key}-h${j}`)}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, j) => (
                    <td key={j}>{inline(c, ctx, `${key}-${r}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return (
        <p className="rt-p" key={key}>
          {inline(b.text, ctx, key)}
        </p>
      );
  }
}

/**
 * Renders a description as formatted blocks (paragraphs, dividers, headings, lists, tables, and
 * color-coded degree-of-success rows), with referenced terms turned into clickable links that open
 * the recursive description popup. Plain prose with no markup renders as a single paragraph.
 */
export function RichText({
  text,
  refs,
  onOpen,
}: {
  text: string;
  refs?: DescRef[];
  onOpen: (ref: DescRef) => void;
}) {
  if (!text) return null;
  const byLabel = new Map<string, DescRef>();
  for (const r of refs ?? []) if (!byLabel.has(r.label.toLowerCase())) byLabel.set(r.label.toLowerCase(), r);
  const labels = [...new Set((refs ?? []).map((r) => r.label))].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const re = labels.length ? new RegExp('(' + labels.join('|') + ')', 'gi') : null;
  const ctx: Ctx = { byLabel, re, onOpen };
  const blocks = parseBlocks(text);
  return <>{blocks.map((b, i) => renderBlock(b, ctx, i))}</>;
}
