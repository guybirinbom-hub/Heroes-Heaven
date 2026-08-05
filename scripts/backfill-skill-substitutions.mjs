/*
 * "You can use X instead of Y."
 *
 * A substitution swaps WHICH skill you roll, so it is not a bonus and could not be written as one.
 * 35 records carrying one did nothing; Chirurgeon's own record shipped a `dataWarning` admitting it.
 *
 * Every row is PARSED from the record's own description, never typed in — the pair AND the condition.
 * The condition matters more than the pair: Natural Medicine's text says in as many words that it
 * "doesn't replace Medicine for uses of the skill other than Treat Wounds or for feat
 * prerequisites", so a conditional substitution must never move the number on the sheet. Only an
 * unconditional one does, and only Chirurgeon's reads that way.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const SKILLS = [
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
  'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
];
const S = SKILLS.join('|');

/** "use X instead of Y to <condition>" / "use your X modifier instead of your Y modifier to <c>". */
const PAIR = new RegExp(
  `use (?:an? |your |a )?(?:acting |\\w+ )?(${S})(?:[^.]{0,30}?)(?:instead of|in place of|rather than) (?:your |the )?(${S})`,
  'gi',
);
/** Chirurgeon: "use your proficiency rank in X for anything that requires a proficiency rank in Y". */
const RANK_FOR = new RegExp(
  `proficiency rank in (${S})[^.]{0,40}?requires? a proficiency rank in (${S})`,
  'i',
);

const clean = (r) => String(r.description ?? '').replace(/<[^>]+>/g, ' ').replace(/statistic=\w+/g, ' ').replace(/\s+/g, ' ');

/** The clause following the pair, trimmed to the condition it names. */
function conditionAfter(text, idx) {
  const rest = text.slice(idx);
  const m = rest.match(/^[^.]*?\b(to|when|while|for)\b([^.]{3,90})/i);
  if (!m) return undefined;
  const w = `${m[1]}${m[2]}`.replace(/\s+/g, ' ').trim().replace(/[,;]$/, '');
  return w.length > 4 ? w : undefined;
}

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const rows = [];
const skipped = [];

for (const coll of ['feats', 'classFeatures', 'heritages', 'items']) {
  for (const [id, rec] of Object.entries(core[coll] ?? {})) {
    const text = clean(rec);
    const subs = [];

    const rank = text.match(RANK_FOR);
    if (rank && rank[1].toLowerCase() !== rank[2].toLowerCase()) {
      // No `when` — this is the broad form, and the only one allowed to move a number.
      subs.push({ use: rank[1].toLowerCase(), forSkill: rank[2].toLowerCase() });
    }

    PAIR.lastIndex = 0;
    let m;
    while ((m = PAIR.exec(text))) {
      const use = m[1].toLowerCase();
      const forSkill = m[2].toLowerCase();
      // A pair naming the same skill twice is the regex straddling two clauses, not a substitution.
      if (use === forSkill) continue;
      if (subs.some((s) => s.use === use && s.forSkill === forSkill)) continue;
      const when = conditionAfter(text, m.index + m[0].length);
      if (!when) {
        // Every non-Chirurgeon substitution in this data is conditional. One with no readable
        // condition is a parse failure, not a broad substitution — writing it unconditionally would
        // silently raise a skill everywhere.
        skipped.push(`${coll}/${id}: "${use} instead of ${forSkill}" — no condition found, not written`);
        continue;
      }
      subs.push({ use, forSkill, when });
    }

    if (!subs.length) continue;
    rec.skillSubstitutions = subs;
    entries.push({ category: coll, id, field: 'skillSubstitutions', value: subs });
    rows.push(`${coll}/${id}: ${subs.map((s) => `${s.use}→${s.forSkill}${s.when ? ` (${s.when.slice(0, 40)})` : ' [UNCONDITIONAL]'}`).join('; ')}`);
  }
}

if (skipped.length) console.warn(`SKIPPED (${skipped.length}):\n  ` + skipped.join('\n  '));
if (!entries.length) {
  console.error('nothing parsed — refusing to write.');
  process.exit(1);
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`\nwrote ${entries.length} records (backfill ${backfill.length} → ${next.length})`);
for (const r of rows) console.log('  ' + r);
