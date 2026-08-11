import { useMemo, useState } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { DescriptionModal } from './DescriptionModal';
import { sanitize } from './sanitizeHtml';
import { htmlWithAutoDir } from './autoDir';
import { AstRenderer } from './AstRenderer';
import { useAstNode } from './useAst';

/** A description is treated as rich HTML (user-authored, from the item editor) if it carries any
 *  HTML tag; otherwise it's curated markdown and RichText parses + auto-linkifies it. */
const HTML_TAG = /<(a|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|span|br|div|p|hr|mark)\b/i;

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
  astKey,
  astId,
  dirAuto,
}: {
  description?: string;
  descRefs?: DescRef[];
  className?: string;
  /** Give each block its own reading direction (see autoDir.ts). For content the USER wrote, which can
   *  be in a right-to-left language; imported game text is always English, so this is opt-in. */
  dirAuto?: boolean;
  /** When this description lives inside a popup, pass that popup's close so a drilled-in description
   *  popup can offer "Back" (to here) and have its X / click-outside close the whole stack. */
  onExit?: () => void;
  /** @deprecated RichText now emits block elements, so the container is always a div. */
  as?: 'p' | 'div';
  /** The record's bucket + slug — when its ast exists, the description renders from the new pipeline
   *  (prose only; the detail view keeps its own stat block) instead of the legacy markdown. */
  astKey?: string;
  astId?: string;
}) {
  const content = useContent();
  const [node, setNode] = useState<DescNode | null>(null);
  const { node: ast, bucket: astBucket, loading: astLoading } = useAstNode(astKey, astId);
  // Sanitizing (and, for notes, direction-tagging) parses the whole string, so do it once per value
  // rather than on every render — a long note re-renders on each keystroke of its title. Skipped
  // entirely unless the rich-HTML branch below is the one that will run.
  const useRich = !astId || (!ast && !astLoading);
  const richHtml = useMemo(
    () =>
      useRich && description && HTML_TAG.test(description)
        ? dirAuto
          ? htmlWithAutoDir(sanitize(description))
          : sanitize(description)
        : '',
    [useRich, description, dirAuto],
  );

  // Ast path — the new-data description prose (meta hidden; links open the recursive ast popup).
  if (ast && astId) {
    const openRef = (bucket: string, slug: string) => {
      const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[slug];
      if (rec) setNode({ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug });
    };
    return (
      <>
        <div className={className}>
          <AstRenderer node={ast} bodyOnly hideMeta selfRef={`${astBucket}:${astId}`} onOpenRef={openRef} />
        </div>
        {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
      </>
    );
  }

  // The record HAS an ast that's still loading: show a quiet placeholder rather than flashing the plain-text
  // fallback (which, for armor/weapons, prints the stat line as prose and looks like a duplicate stat block).
  if (astLoading && astId) return <div className={className + ' ast-loading'} aria-busy="true" />;

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
          dangerouslySetInnerHTML={{ __html: richHtml }}
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
