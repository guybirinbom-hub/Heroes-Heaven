import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { DescriptionModal } from './DescriptionModal';
import { sanitize } from './sanitizeHtml';
import { htmlWithAutoDir } from './autoDir';
import { RemasteredLine, clickPoint, type RemasteredAs } from './RemasteredLine';
import type { OpenAt } from './cardModel';

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

/* desk #158 — the "Remastered as" link. Lives in RemasteredLine.tsx (DescriptionModal needs it too, and
 * this file already imports DescriptionModal); re-exported for ItemDetail, FeatDetail and SpellsTab. */
export { remasteredAsOf, type RemasteredAs } from './RemasteredLine';

/**
 * Renders an inline description with its cross-references linkified; clicking a link opens the
 * recursive description popup (with Back). Drop-in replacement for `<p>{description}</p>` in
 * detail views. Accepts both curated markdown and user-authored rich HTML.
 *
 * It never draws an Archives page. A record's page is drawn by the card (RecordCard, and SpellDetail's
 * spell card); DescBody is the card's no-page lane (docs/card-design.md section 7) and the text lane of
 * the player's notes. Card step 22 (section 9 row 22) removed its page branch — `astKey` / `astId`, the
 * tree drawn with `hideMeta`, the loading placeholder — once every surface that reached it (FeatDetail,
 * ItemDetail, StatDetailModal's full text, the Main-tab action popup) drew its record's 'mine' card.
 * scripts/card-only-check.mjs keeps it that way.
 */
export function DescBody({
  description,
  descRefs,
  className = 'sd-desc',
  onExit,
  dirAuto,
  remasteredAs,
  emptyNote,
  onOpenRecord,
}: {
  description?: string;
  descRefs?: DescRef[];
  className?: string;
  /** Item 7 — open a linked record the HOST's way instead of in this component's own popup: the
   *  tracker window's no-page lane (RecordCard chrome 'window') opens it as another tracker window, at
   *  the point the link was clicked (`at` — the link's own box when the keyboard made the click,
   *  RemasteredLine's clickPoint). A popup drawn inside a window would
   *  sit in that window's stacking context, under any window above it. Absent = the popup, as before. */
  onOpenRecord?: (bucket: string, id: string, at?: OpenAt) => void;
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
}) {
  const content = useContent();
  const [node, setNode] = useState<DescNode | null>(null);
  /** Open another record's description in the recursive popup — what a .ref-link click does — or, with
   *  `onOpenRecord`, the host's way. */
  const openRecord = (bucket: string, slug: string, at?: OpenAt) => {
    if (onOpenRecord) return onOpenRecord(bucket, slug, at);
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[slug];
    if (rec) setNode({ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug });
  };
  /* The markdown lane's links (RichText) hand back only the reference, not the click: the point is
   * caught on the way down (capture phase, before the link's own handler) for `onOpenRecord` — the
   * link's own box when the keyboard made the click (clickPoint). */
  const clickedAt = useRef<OpenAt | undefined>(undefined);
  const catchPoint = onOpenRecord
    ? (e: ReactMouseEvent) => {
        clickedAt.current = clickPoint(e, (e.target as Element).closest?.('a, button') ?? null);
      }
    : undefined;
  /* desk #158 — "Remastered as <name>", on every branch below, because a legacy record usually DOES
   * have text. Marked `sd-ours`: the book never printed this line, we did. */
  const remastered = remasteredAs ? <RemasteredLine ra={remasteredAs} onOpen={openRecord} /> : null;
  // Sanitizing (and, for notes, direction-tagging) parses the whole string, so do it once per value
  // rather than on every render — a long note re-renders on each keystroke of its title. Skipped
  // entirely unless the rich-HTML branch below is the one that will run.
  const richHtml = useMemo(
    () =>
      description && isRichHtml(description, dirAuto)
        ? dirAuto
          ? htmlWithAutoDir(sanitize(description))
          : sanitize(description)
        : '',
    [description, dirAuto],
  );

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
    const open = (key: string, id: string, at: OpenAt) => {
      if (onOpenRecord) return onOpenRecord(key, id, at);
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
              open(a.dataset.refKey, a.dataset.refId, clickPoint(ev, a));
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
      <div className={className} onClickCapture={catchPoint}>
        <RichText
          text={description}
          refs={descRefs}
          onOpen={(ref: DescRef) => {
            const n = content ? lookupRef(content, ref) : null;
            const at = clickedAt.current;
            clickedAt.current = undefined;
            if (n && onOpenRecord) {
              if (n.key && n.slug) onOpenRecord(n.key, n.slug, at);
              return;
            }
            if (n) setNode(n);
          }}
        />
        {remastered}
      </div>
      {node && <DescriptionModal root={node} onClose={() => setNode(null)} onExit={onExit} backToSource={!!onExit} />}
    </>
  );
}
