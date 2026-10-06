import type { OursLine } from './cardModel';

/**
 * The ours box (docs/card-design.md section 4): ONE box after the body, marked `data-ours`, each line
 * attributed to the record it came from. Card step 8 puts it on today's FeatDetail; it draws the same
 * markup as RecordCard's own box (RecordCard.tsx OursBox, which another lane owns and this file leaves
 * alone), so the two read alike and the card can adopt this one later.
 *
 * Every line is plain text — nothing the app adds is ever HTML spliced into a page's words — so a pick,
 * a marker or a note can never switch a markdown body into the rich-HTML lane (the kineticist gates'
 * raw `| --- |` once a junction was picked, T3).
 */
export function OursBox({ lines }: { lines: OursLine[] | undefined }) {
  if (!lines || lines.length === 0) return null;
  return (
    <div className="card-ours" data-ours="">
      {lines.map((l, i) => (
        <p key={`${l.kind}:${i}`} className={`sd-ours card-ours-${l.kind}`} data-ours-kind={l.kind}>
          {l.from ? <span className="card-ours-from">{l.from.name}: </span> : null}
          {l.label ? <strong>{l.label}</strong> : null}
          {l.label ? ' ' : null}
          {l.text}
        </p>
      ))}
    </div>
  );
}

/**
 * Use lines of OURS (card step 8, section 7 "Homebrew"): a homebrew record's typed Trigger / Requirements
 * / Frequency / Access, drawn above the body where rule 4.2 puts use lines — but marked `data-ours` and
 * styled as our words (.sd-ours), never as a printed line, because the book never printed them.
 */
export function OursUseLines({ lines }: { lines: OursLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="card-uselines" data-ours="">
      {lines.map((l, i) => (
        <p key={`${l.label ?? ''}:${i}`} className="sd-ours card-ours-useLine" data-ours-kind="useLine">
          {l.label ? <strong>{l.label}</strong> : null}
          {l.label ? ' ' : null}
          {l.text}
        </p>
      ))}
    </div>
  );
}
