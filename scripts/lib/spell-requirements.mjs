/*
 * A SPELL'S PRINTED "Requirements" LINE, AS A DISPLAY-ONLY FIELD (package I, I6d, 2026-10-18).
 *
 * The Archives print a Requirements line above some spells' body — Thunderous Strike (spell-2885)
 * "You’re wielding a melee weapon in two hands.", Deity's Strike (spell-2673) "You have a deity." — and
 * carry it on the document as `data.requirement`. The popup's PAGE lane already shows it (the page's own
 * stat lines, src/sheet/spellCard.ts). The FIELD lane — no page loaded, a homebrew copy, a spell with no
 * page — showed it nowhere: `Spell` had no field (batch P02 parked it, turbulent-tide#requirements).
 *
 * So scripts/import-core-v2.mjs fills `requirements` on every spell record from its OWN page before the
 * overlay is applied (an overlay row can still override it), and src/sheet/SpellsTab.tsx spellStatRows
 * prints it. Read straight from the page every run, so a refreshed page carries its new wording with it.
 * Nothing computes with it — no effect lane, no total; the trust gate covers effects only.
 *
 * Guarded by scripts/spell-print-lines-check.mjs `requirements` (npm run verify) and
 * test/spell-requirements.test.ts.
 */
import { stripHandlebars, unlink } from './aon-plain.mjs';

/**
 * The page's Requirements text, tidied for a stat row: AoN's `{{creatureFamilies 395 "dragon"}}` template and
 * `[label](/url)` links keep their label, whitespace collapses (a stripped link leaves a double space:
 * spell-2063 "You are in  clinging shadows stance ."), and the space a link leaves before punctuation goes.
 * '' when the page prints none.
 */
export function requirementsText(raw) {
  if (raw == null) return '';
  const s = Array.isArray(raw) ? raw.map((x) => String(x ?? '')).join(' ') : String(raw);
  return unlink(stripHandlebars(s))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/**
 * Set `requirements` on every spell record whose own page (`pageOf(id, rec)` — the export document, or
 * null) prints one; delete it where the page prints none, so a page that drops the line drops the field.
 * Returns the counts, for the importer's log.
 */
export function fillSpellRequirements(spells, pageOf) {
  let set = 0;
  let cleared = 0;
  for (const [id, rec] of Object.entries(spells ?? {})) {
    if (!rec || typeof rec !== 'object') continue;
    const line = requirementsText(pageOf(id, rec)?.data?.requirement);
    if (line) {
      rec.requirements = line;
      set++;
    } else if ('requirements' in rec) {
      delete rec.requirements;
      cleared++;
    }
  }
  return { set, cleared };
}
