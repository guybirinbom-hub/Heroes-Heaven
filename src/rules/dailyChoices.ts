/*
 * Choices re-made at DAILY PREPARATIONS.
 *
 * Most feat choices are settled once, when you take the feat, and belong to the build. A smaller set
 * is re-chosen every morning — "During your daily preparations, choose to be protected from severe
 * cold or severe heat" (Environmental Adaptability), "choose Fear, Phantom Pain, or Sure Strike"
 * (Mask of Power). Those answers are PLAY state: they change nightly and must be changeable without
 * editing the character.
 *
 * A record opts in with `choice.daily = true`; everything here is driven by that flag, so wiring a
 * new feat is a data edit, not a code edit.
 */
import type { Character, ContentDatabase, SourceInfo } from './types';
import { entrySourceOn } from './sources';
import { askedAtDailyPrep, dailyChoiceKey, effectiveChoiceOptions, narrowChoiceOptions, ownedDailyChoiceRecords as ownedRecords } from './derive';
import { openChoiceOptions } from './openChoice';

export { askedAtDailyPrep, dailyChoiceKey, qualifiesForOption } from './derive';

export interface DailyChoice {
  /** Storage key in PlayState.dailyChoices — `${recordId}:${flag}`. */
  key: string;
  recordId: string;
  recordName: string;
  prompt: string;
  /** 'array' renders option chips; 'text' renders a field (Quick Study's Lore subject, Call Gun's
   *  bonded weapon); 'open' renders a searchable list resolved from content — Aroden's Innovation
   *  picks "a general feat of 3rd level or lower", which is far too many for chips. */
  kind: 'array' | 'text' | 'open';
  /** `note` is the right-hand hint the source already computes — a language’s rarity, a spell’s
   *  rank. It is kept OFF `label` so `dailyChoiceLabel` still returns the bare name for the
   *  "reusing yesterday’s answers" summary; the picker appends it itself. */
  options: { value: string; label: string; description?: string; note?: string }[];
  /** The record's own caveat about its OWN answer — "temporary, so it can't be a prerequisite".
   *  `FeatChoiceDef.note` has always carried this and it reached nobody: the Rest sheet had no field
   *  to render it in, so seven "until you prepare again" records stated their most important rule to
   *  no one. Read by CharacterSheet.tsx's daily-pick block. */
  note?: string;
}



/**
 * The content map an OPEN daily choice's answer is a record of, for the Sources filter below. Only the kinds a
 * player picks from a book: a language is open by rarity and region (it stays out of the Sources, see
 * CHOOSABLE_SOURCE_MAPS), and every `own-*` kind offers what the character already holds.
 */
const OPEN_CHOICE_BOOK_MAP: Partial<Record<string, 'spells' | 'feats' | 'items' | 'heritages' | 'ancestries' | 'backgrounds'>> = {
  spell: 'spells',
  feat: 'feats',
  weapon: 'items',
  heritage: 'heritages',
  ancestry: 'ancestries',
  background: 'backgrounds',
};

/**
 * Every daily-preparation choice this character has to make, deduped by key.
 *
 * `opts.enabled` (the character's enabledBookSet): desk sources-apply-to-everything (owner, 2026-09-30: "yes the
 * player sources should aplly to everything he has accses to") — an OPEN choice's list (a daily spell, feat,
 * weapon …) offers only records whose book is on, like the Builder's pickers; a record with no book always stays
 * (entrySourceOn), and so does this morning's stored answer, so switching a book off never blanks a pick the
 * character made. Left out, nothing is filtered (the Builder passes its own already-filtered content).
 */
export function dailyChoicesFor(c: Character, db: ContentDatabase, opts?: { enabled?: Set<string> }): DailyChoice[] {
  const seen = new Set<string>();
  const out: DailyChoice[] = [];
  const enabled = opts?.enabled;
  for (const rec of ownedRecords(c, db)) {
    const def = rec.choice;
    // 'domains'/'skills' resolve against the BUILD, not the morning, so they never belong at rest —
    // askedAtDailyPrep spells that out, and is the SAME predicate the builder uses to decide what to
    // stop asking, so the two can never disagree and strand a choice between them.
    if (!def || !askedAtDailyPrep(def)) continue;
    // A question that starts at a printed level — Experimental Spellshaping's daily spellshape pick:
    // *"Starting at 4th level, during your daily preparations…"* — is not asked before it.
    if (def.minLevel != null && c.level < def.minLevel) continue;
    const options =
      def.kind === 'array'
        ? // Plus whatever another owned record adds to this menu — Radiant Armament's astral and
          // brilliant runes belong on the blessed armament's list, not on a list of their own.
          //
          // …then narrowed to what the character actually qualifies for. Haunting Memories offers a
          // given skill under exactly ONE of its two branches depending on where that skill stands,
          // so an untrained skill cannot be taken straight to master.
          //
          // Through the SAME funnel the builder uses (ruling Q9), so a narrowing authored on a record
          // works whichever of the two paths asks the question. `narrowChoiceOptions` subsumes the
          // `qualifiesForOption` filter this line used to spell out; the greyed "already owned" state
          // it can also produce has no daily case today, and a morning row is a chip rather than a
          // list with room for a reason, so those are dropped rather than rendered inert.
          narrowChoiceOptions(rec.id, def, effectiveChoiceOptions(rec.id, def, c, db), c, db).filter((o) => !o.disabled)
        : def.kind === 'open'
          ? openChoiceOptions(def.from, db, { character: c })
              // A grant the applier will THROW AWAY must not be offered as a live control.
              // `applyPlayState` drops a `grantLanguage` answer the character already knows, so
              // leaving Common and Elven on an elf's morning list rendered two options that did
              // nothing when picked — Q27’s exact complaint ("there isn’t any point in showing
              // them — the user is just annoyed"), whose scope is "every picker in the app".
              // REMOVED rather than greyed because a language you already speak is wasted for the
              // WHOLE career (Q21 / Principle Q) — there is no later level that makes it worthwhile
              // — and because this screen already drops its inert options one branch above.
              // Gated on `grantLanguage`, so the non-granting language picker (Settlement
              // Scholastics) keeps its full list.
              /* ⚠ …EXCEPT a language TODAY'S OWN ANSWER granted. This runs against the applyPlayState
               * output, whose `languages` already contains this morning's pick — so the filter removed
               * the answer from its own option list. The `<select>` then found no matching `<option>`
               * and rendered the placeholder every morning while the answer was still stored, and the
               * reuse summary printed "not set" while the Details tab showed the language: two screens
               * contradicting each other, which is Q27's exact complaint. `dailyLanguages` is exactly
               * the set granted by today's daily choices, so exempting it keeps the answer selectable
               * while a permanently-known language stays hidden. */
              .filter(
                (o) =>
                  !(
                    def.from?.type === 'language' &&
                    def.from?.grantLanguage &&
                    c.languages?.includes(o.id) &&
                    !c.dailyLanguages?.includes(o.id)
                  ),
              )
              // desk sources-apply-to-everything (2026-09-30): a record from a book this character has off is
              // not offered (opts.enabled above), unless it is the stored answer; one with no book always is.
              .filter((o) => {
                const m = enabled ? OPEN_CHOICE_BOOK_MAP[def.from?.type ?? ''] : undefined;
                if (!enabled || !m) return true;
                const r = (db[m] as Record<string, { source?: SourceInfo; homebrewSourceId?: string }> | undefined)?.[o.id];
                return !r || entrySourceOn(enabled, r) || c.dailyChoices?.[dailyChoiceKey(rec.id, def.flag)] === o.id;
              })
              .map((o) => ({ value: o.id, label: o.name, description: o.description, ...(o.note ? { note: o.note } : {}) }))
          : [];
    // An array/open choice with nothing to offer is malformed or unresolvable — skip it rather than
    // render an empty row the player can't answer (and which would block "Prepare for the day").
    if (def.kind !== 'text' && !options.length) continue;
    const key = dailyChoiceKey(rec.id, def.flag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, recordId: rec.id, recordName: rec.name, prompt: def.prompt, kind: def.kind, options, ...(def.note ? { note: def.note } : {}) });
  }
  return out;
}

/** The choices with no stored answer yet — what "reuse" still has to ask for the first time. */
export function unansweredDailyChoices(choices: DailyChoice[], stored: Record<string, string> | undefined): DailyChoice[] {
  return choices.filter((ch) => !stored?.[ch.key]);
}

/**
 * What this morning's answers actually GRANT.
 *
 * Until now a daily choice was recorded and nothing more — the Rest sheet collected the answer and no
 * sheet number moved, so "habituate your skin against this type of injury" was a note. An answer
 * grants only while it is the stored one, so tomorrow's pick replaces today's rather than stacking.
 *
 * Reads the CHOICE DEFINITIONS rather than the raw store, so an answer left behind by a record the
 * character no longer owns grants nothing.
 */
/** Human-readable label for a stored answer ("Severe heat"), or null when unset/stale. */
export function dailyChoiceLabel(choice: DailyChoice, stored: Record<string, string> | undefined): string | null {
  const value = stored?.[choice.key];
  if (!value) return null;
  // Free text is its own label — there is no option list to look it up in.
  if (choice.kind === 'text') return value;
  // A stored value can go stale if the record's options change; show nothing rather than a raw slug.
  return choice.options.find((o) => o.value === value)?.label ?? null;
}
