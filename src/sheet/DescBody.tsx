import { useMemo, useState } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { DescriptionModal } from './DescriptionModal';
import { sanitize } from './sanitizeHtml';
import { htmlWithAutoDir } from './autoDir';
import { AstRenderer } from './AstRenderer';
import { useAstNode, withoutItemLists } from './useAst';

/** A description is treated as rich HTML (user-authored, from the item editor) if it carries any
 *  HTML tag; otherwise it's curated markdown and RichText parses + auto-linkifies it. */
const HTML_TAG = /<(a|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|span|br|div|p|hr|mark)\b/i;
/**
 * `<table>` counts as rich HTML only for user-authored content (`dirAuto`, i.e. what our own
 * contentEditable editors wrote). Owner: "tables don't work in the notes" — a note that is ONLY a
 * table missed the rich branch, fell through to the markdown renderer and had its tags stripped by
 * cleanRun, so the cells came out as a run of naked text.
 *
 * It is deliberately NOT in HTML_TAG itself: several curated rules descriptions (the Kingmaker
 * kingdom/army pages) are markdown-lite that happens to embed a raw `<table>`, and routing those to
 * the HTML renderer would print their "##" headings and {@action} links literally.
 */
const isRichHtml = (s: string, dirAuto?: boolean) => HTML_TAG.test(s) || (!!dirAuto && /<table\b/i.test(s));

/**
 * desk #158 — the reprint that ships beside a record built from the older printing.
 *
 * Written by the data chain (scripts/lib/reprint.mjs shippedTwin -> build-map.mjs -> stamp-aonid.mjs),
 * never by hand, and guarded by scripts/reprint-check.mjs.
 *
 * ⚠ DECLARED HERE, NOT IN src/rules/types.ts, only because that file is being edited in another lane
 * right now. It belongs beside the record types — move it there when they are free, and drop the casts
 * at the three call sites (ItemDetail, FeatDetail, SpellsTab).
 */
export type RemasteredAs = { bucket: string; id: string; name: string };

/** Read that link off a record when the caller holds a view model rather than the record itself. */
export function remasteredAsOf(content: unknown, ref: { bucket?: string; id?: string }): RemasteredAs | undefined {
  if (!ref.bucket || !ref.id) return undefined;
  return (content as Record<string, Record<string, { remasteredAs?: RemasteredAs }> | undefined> | null)?.[ref.bucket]?.[ref.id]?.remasteredAs;
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
  astKey,
  astId,
  dirAuto,
  remasteredAs,
  emptyNote,
}: {
  description?: string;
  descRefs?: DescRef[];
  className?: string;
  /** desk #158: this record is the older printing and its reprint ships as its own record — the popup
   *  says so and links to it. */
  remasteredAs?: RemasteredAs;
  /** desk #152: what to print when the record has no rules text AND no archive page, instead of
   *  rendering nothing at all. Marked as ours, so nobody reads it as printed text. Opt-in per call
   *  site: an empty NOTE or an empty spell heightening is silence on purpose, not a blank book entry. */
  emptyNote?: string;
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
  /** Open another record's description in the recursive popup — what a .ref-link click does. */
  const openRecord = (bucket: string, slug: string) => {
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[slug];
    if (rec) setNode({ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug });
  };
  /* desk #158 — "Remastered as <name>", on every branch below, because a legacy record usually DOES
   * have text. Marked `sd-ours`: the book never printed this line, we did. */
  const remastered = remasteredAs ? (
    <p className="sd-ours sd-remastered">
      Remastered as{' '}
      <a
        className="ref-link"
        href="#"
        onClick={(e) => { e.preventDefault(); openRecord(remasteredAs.bucket, remasteredAs.id); }}
      >
        {remasteredAs.name}
      </a>
    </p>
  ) : null;
  // Sanitizing (and, for notes, direction-tagging) parses the whole string, so do it once per value
  // rather than on every render — a long note re-renders on each keystroke of its title. Skipped
  // entirely unless the rich-HTML branch below is the one that will run.
  const useRich = !astId || (!ast && !astLoading);
  const richHtml = useMemo(
    () =>
      useRich && description && isRichHtml(description, dirAuto)
        ? dirAuto
          ? htmlWithAutoDir(sanitize(description))
          : sanitize(description)
        : '',
    [useRich, description, dirAuto],
  );

  // Ast path — the new-data description prose (meta hidden; links open the recursive ast popup).
  if (ast && astId) {
    return (
      <>
        <div className={className}>
          {/* bug 2026-09-15: item popup — `withoutItemLists` cuts the page's appended "Specific Magic
              Armor/Weapons/Shields" link lists. It sits HERE, on the path every detail view of a thing
              the character already HAS reads through, rather than in `useAstNode`: the search popup
              (DescriptionModal) reads the same tree straight from the hook and keeps its lists, because
              there the player is looking for another item. */}
          <AstRenderer node={withoutItemLists(ast)} bodyOnly hideMeta selfRef={`${astBucket}:${astId}`} onOpenRef={openRecord} />
          {remastered}
        </div>
        {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
      </>
    );
  }

  // The record HAS an ast that's still loading: show a quiet placeholder rather than flashing the plain-text
  // fallback (which, for armor/weapons, prints the stat line as prose and looks like a duplicate stat block).
  if (astLoading && astId) return <div className={className + ' ast-loading'} aria-busy="true" />;

  /*
   * desk #152 — NO RULES TEXT AND NO PAGE. Owner, 2026-09-12: the popup says so, "the marked line
   * lives in the SHEET, not in a description field … all 244 empty-description items at once, by
   * rule". Measured on the shipped artefact: 243 items carry no description, 89 of them still render
   * an archive page above, so 154 popups reach this line. The printed price / Bulk / Hands line items
   * merchants-scale already ships is untouched — it is rendered by ItemDetail, not here.
   */
  if (!description) {
    if (!emptyNote && !remastered) return null;
    return (
      <>
        <div className={className}>
          {emptyNote ? <p className="sd-ours sd-unprinted">{emptyNote}</p> : null}
          {remastered}
        </div>
        {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
      </>
    );
  }

  // Rich-HTML path: render the authored HTML directly, with .ref-link anchors made clickable
  // (each carries data-ref-key/data-ref-id pointing at a content entry to pop up).
  if (isRichHtml(description, dirAuto)) {
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
        {remastered}
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
        {remastered}
      </div>
      {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
    </>
  );
}
