/**
 * A STORED ANSWER THE PICKER'S LIST DOES NOT OFFER, DRAWN BY NAME (Tweaks phase 2, WP9 step 4; plan C26's kept row,
 * C45's spirit; gold-set Q27).
 *
 * Every builder control finds its shown value by looking the stored answer up in its own rows. An answer the list
 * no longer offers (an import, an old save, a narrowed list, data that changed under a character) found nothing, so
 * the card read as the placeholder ("Choose…", "Choose a skill…") — while the engine might still be using that
 * answer. `withKeptAnswer` adds one greyed row per such stored value, AFTER the picker's own option builder, so the
 * control can show the answer by name and say what the sheet does with it.
 *
 * Why here and not beside `withCustomAnswer` in src/rules/build.ts: this is display only. Nothing in src/rules may
 * import it, so no engine reader (`featSkillChoiceValue`, `backgroundLorePicks`, `dailyChoicesFor`, the option
 * builders) can ever see a kept row. `withCustomAnswer` runs first; an allowCustom answer it already gave a row is
 * found among the rows and never gets a second one.
 *
 * Display only: it writes nothing, never clears or swaps the stored answer (UNKNOWN != EMPTY, C36), and a kept row is
 * never pickable as a new choice (`disabled`). Choosing another option replaces the answer as the picker always did.
 */
import { choiceGrantFor, FEAT_GRANTS } from '../rules/featGrants';

/** What the engine does with a stored value the list does not offer, measured per picker family (wp9-report.md). */
export type KeptHow =
  /** The engine reads the stored value with no list check (heritage resistance, the key attribute, …). */
  | { counts: true }
  /** The engine ignores it; `instead` names what the sheet uses in its place (the unanswered default), if anything. */
  | { counts: false; instead?: string }
  /** Depends on the record: the generic option lookups find nothing, but a record's own reader may read the word. */
  | { counts: 'maybe' };

/** The exact words, decided once for all eleven pickers. */
export const KEPT_WORDS = {
  counts: 'not on this list (still counts on your sheet)',
  ignored: 'not on this list (your sheet does not use it)',
  maybe: 'not on this list (your sheet may not use it)',
} as const;

/** The reason a kept row carries (the popup row's greyed reason; `aria-label` reads "<label> — <reason>"). */
export function keptReason(how: KeptHow): string {
  if (how.counts === true) return KEPT_WORDS.counts;
  if (how.counts === 'maybe') return KEPT_WORDS.maybe;
  return how.instead ? `${KEPT_WORDS.ignored.slice(0, -1)}; it uses ${how.instead} instead)` : KEPT_WORDS.ignored;
}

/** The whole line drawn under the control: "<label> — <reason>". */
export const keptWords = (label: string, how: KeptHow) => `${label} — ${keptReason(how)}`;

/** The fields a kept row adds. `kept` holds the whole line; `keptMark` is a slot for WP10's Tweak mark (unused now). */
export interface KeptFields {
  disabled: true;
  disabledReason: string;
  kept: string;
  keptMark?: unknown;
}

export interface KeptOpts {
  /** The vocabulary's own word for a value (skill / attribute / damage names, Lore subjects); default the raw value. */
  labelOf?: (value: string) => string;
  /** What the engine does with this off-list value. */
  how: (value: string) => KeptHow;
  /** WP10: a Tweak mark for the kept row. No tweak allows these values now, so no caller passes it. */
  mark?: unknown;
}

/** The stored values not among `rows`: each stored entry, and each part of a comma-joined multi-pick answer. */
export function keptValues(rows: readonly { value: string }[], stored: string | null | undefined | readonly (string | null | undefined)[]): string[] {
  const have = new Set(rows.map((r) => r.value));
  const out: string[] = [];
  const list = typeof stored === 'string' || stored == null ? [stored] : stored;
  for (const s of list) {
    if (!s || have.has(s)) continue;
    // A comma-joined answer ("forest,swamp"): each part on its own, as the engine's `choiceTokens` reads it.
    const parts = s.includes(',') ? s.split(',').map((p) => p.trim()).filter(Boolean) : [s];
    for (const p of parts) if (!have.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * `rows` plus one kept row per stored value not among them (see the file comment). No stored value, or every stored
 * value already a row: `rows` itself, unchanged.
 */
export function withKeptAnswer<T extends { value: string; label: string }>(
  rows: T[],
  stored: string | null | undefined | readonly (string | null | undefined)[],
  o: KeptOpts,
): (T | (T & KeptFields))[] {
  const missing = keptValues(rows, stored);
  if (!missing.length) return rows;
  const kept = missing.map((value) => {
    const label = o.labelOf?.(value) ?? value;
    const how = o.how(value);
    const row = { value, label, disabled: true as const, disabledReason: keptReason(how), kept: keptWords(label, how) };
    return (o.mark === undefined ? row : { ...row, keptMark: o.mark }) as unknown as T & KeptFields;
  });
  // The kept answer leads the list, as the C45 feat pickers put a stored off-list feat first.
  return [...kept, ...rows];
}

/**
 * What the engine does with an off-list answer to a record's own `choice` (a feat's, a class feature's, a heritage's,
 * an ancestry's, a granted feat's), measured in wp9-report.md:
 *   - a value the record's BOOK options hold (the list only narrowed it away: a limit, `distinct`, Sources) counts —
 *     the option-grant loops, `choiceTokens` and the feat row's label all look it up in the book options;
 *   - a record whose effect `FEAT_GRANTS[record].choiceGrants` keys by answer: `keyed` is the engine's own lookup
 *     (`choiceGrantFor`, which also accepts a legacy spelling) — a hit counts, a miss is ignored;
 *   - any other value matches no option: when the options carry grants nothing reads it (ignored); otherwise only a
 *     record's own by-value reader could (maybe).
 */
export function choiceKeptHow(
  def: { options?: readonly { value: string; grant?: unknown }[] } | undefined,
  keyed?: (value: string) => boolean,
): (value: string) => KeptHow {
  return (value) => {
    const book = def?.options ?? [];
    if (book.some((o) => o.value === value)) return { counts: true };
    if (keyed) return keyed(value) ? { counts: true } : { counts: false };
    if (book.some((o) => o.grant)) return { counts: false };
    return { counts: 'maybe' };
  };
}

/** The `keyed` argument of `choiceKeptHow` for a record id, or undefined when its effect is not keyed by answer. */
export function keyedByAnswer(recordId: string): ((value: string) => boolean) | undefined {
  const g = FEAT_GRANTS[recordId];
  return g?.choiceGrants ? (value) => !!choiceGrantFor(g, value) : undefined;
}

/** "zzz-gone" → "Zzz gone": a raw slug read as words; anything else as it is. */
export function slugWords(v: string): string {
  if (!/^[a-z0-9-]+$/.test(v)) return v;
  const s = v.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
