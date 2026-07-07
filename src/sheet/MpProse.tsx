import { Fragment, useMemo, type ReactNode } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { autoRefs } from './autolink';
import { lookupRef } from './descref';
import { InfoTerm } from './InfoTerm';
import { MP_TERM_LABELS, mpTermDesc } from '../rules/monsterPartsGlossary';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Renders a line of Monster-Parts effect / rider prose with clickable term descriptions, reusing the
 * app's existing description-popup mechanism (InfoTerm → DescriptionModal, so every term is pinnable and
 * can drill into further references).
 *
 * Two term sources are linkified:
 *   • Imported CONTENT conditions + actions (off-guard, frightened, enfeebled, stupefied, …) — resolved
 *     from `content` via the same auto-link vocabulary every description uses, so descriptions never drift.
 *   • MP-SPECIFIC terms with no content entry (persistent damage, weakness, resistance, precision,
 *     hardness) — authored in monsterPartsGlossary.
 *
 * Matching is word-boundary, longest-label-first, first-match-wins; unmatched text renders plain.
 */
export function MpProse({ text, className }: { text: string; className?: string }) {
  const content = useContent();

  const { re, contentByLabel } = useMemo(() => {
    const contentRefs: DescRef[] = content ? autoRefs(content) : [];
    const byLabel = new Map<string, DescRef>();
    for (const r of contentRefs) if (!byLabel.has(r.label.toLowerCase())) byLabel.set(r.label.toLowerCase(), r);
    const labels = [...new Set([...MP_TERM_LABELS, ...contentRefs.map((r) => r.label)])]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);
    return { re: labels.length ? new RegExp('(' + labels.join('|') + ')', 'gi') : null, contentByLabel: byLabel };
  }, [content]);

  const nodes: ReactNode[] = [];
  if (!re) {
    nodes.push(text);
  } else {
    let last = 0;
    let key = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const before = start === 0 ? '' : text[start - 1];
      const after = end >= text.length ? '' : text[end];
      const boundaryOk = !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
      if (!boundaryOk) continue;
      const lc = m[0].toLowerCase();
      const mpTerm = mpTermDesc(lc);
      const contentRef = !mpTerm ? contentByLabel.get(lc) : undefined;
      const node = contentRef && content ? lookupRef(content, contentRef) : null;
      if (!mpTerm && !node) continue;
      if (start > last) nodes.push(text.slice(last, start));
      if (mpTerm) {
        nodes.push(
          <InfoTerm key={`mp${key++}`} title={mpTerm.title} description={mpTerm.description}>
            {m[0]}
          </InfoTerm>,
        );
      } else if (node) {
        nodes.push(
          <InfoTerm
            key={`c${key++}`}
            title={node.title}
            description={node.description}
            descRefs={node.descRefs}
            descKey={node.key}
          >
            {m[0]}
          </InfoTerm>,
        );
      }
      last = end;
    }
    if (last < text.length) nodes.push(text.slice(last));
    if (nodes.length === 0) nodes.push(text);
  }

  return (
    <span className={className}>
      {nodes.map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </span>
  );
}
