import { useState } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { DescriptionModal } from './DescriptionModal';

/** A description is treated as rich HTML (user-authored, from the item editor) if it carries any
 *  HTML tag; otherwise it's curated markdown and RichText parses + auto-linkifies it. */
const HTML_TAG = /<(a|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|span|br|div|p|hr|mark)\b/i;

/** Strip script/style, inline event handlers, and javascript: URLs from user-authored HTML. */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(href|src)\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '');
}

/**
 * Renders an inline description with its cross-references linkified; clicking a link opens the
 * recursive description popup (with Back). Drop-in replacement for `<p>{description}</p>` in
 * detail views. Accepts both curated markdown and user-authored rich HTML.
 */
export function DescBody({
  description,
  descRefs,
  className = 'sd-desc',
  onExit,
}: {
  description?: string;
  descRefs?: DescRef[];
  className?: string;
  /** When this description lives inside a popup, pass that popup's close so a drilled-in description
   *  popup can offer "Back" (to here) and have its X / click-outside close the whole stack. */
  onExit?: () => void;
  /** @deprecated RichText now emits block elements, so the container is always a div. */
  as?: 'p' | 'div';
}) {
  const content = useContent();
  const [node, setNode] = useState<DescNode | null>(null);
  if (!description) return null;

  // Rich-HTML path: render the authored HTML directly, with .ref-link anchors made clickable
  // (each carries data-ref-key/data-ref-id pointing at a content entry to pop up).
  if (HTML_TAG.test(description)) {
    const open = (key: string, id: string) => {
      const map = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[key];
      const e = map?.[id];
      if (e) setNode({ title: e.name, description: e.description ?? '', descRefs: e.descRefs, key });
    };
    return (
      <>
        <div
          className={className + ' rich-html'}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(description) }}
          onClick={(ev) => {
            const a = (ev.target as HTMLElement).closest?.('.ref-link') as HTMLElement | null;
            if (a?.dataset.refKey && a.dataset.refId) {
              ev.preventDefault();
              open(a.dataset.refKey, a.dataset.refId);
            }
          }}
        />
        {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
      </>
    );
  }

  // Markdown path (curated SRD content): RichText parses emphasis/tables and auto-linkifies refs.
  return (
    <>
      <div className={className}>
        <RichText
          text={description}
          refs={descRefs}
          onOpen={(ref: DescRef) => {
            const n = content ? lookupRef(content, ref) : null;
            if (n) setNode(n);
          }}
        />
      </div>
      {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
    </>
  );
}
