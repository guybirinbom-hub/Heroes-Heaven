/*
 * Two alchemist feats that change an ITEM MODE rather than the character.
 *
 * Mutagens and elixirs ship as item-driven modes: `duration` is a printed string (the app has no
 * clock, so the player reads it and switches the mode off) and a mutagen's drawback is a genuine
 * negative modifier. Nothing could touch either, so both feats were inert.
 *
 * Wording quoted below, from the AoN mirror.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const FIXES = [
  {
    id: 'extend-elixir',
    // "When you consume one of your alchemical items that has the elixir and infused traits and a
    //  duration of 1 minute or longer, that elixir's duration is doubled."
    // The "one of YOUR alchemical items" and the Quick Alchemy 10-minute cap are the player's to
    // honour — nothing records who brewed a given elixir — so they are stated, not silently ignored.
    // `infused` is NOT matched on: it is not a printed trait, it is added when you brew the item
    // with your own infused reagents — no shipped elixir carries it, so matching on it would match
    // nothing and leave the feat inert with a field on it. The restriction moves into the note,
    // alongside the other one the app cannot check.
    value: [
      {
        match: { traits: ['elixir'], minDurationMinutes: 1 },
        doubleDuration: true,
        note: 'Extend Elixir doubled this duration. It applies only to an INFUSED elixir you created yourself, and an elixir made with Quick Alchemy still cannot exceed 10 minutes.',
      },
    ],
  },
  {
    id: 'perfect-mutagen',
    // "When under the effect of a mutagen you crafted, you do not suffer its drawback."
    value: [
      {
        match: { traits: ['mutagen'] },
        suppressNegativeModifiers: true,
        note: 'Perfect Mutagen: the drawback is suppressed. It applies only to a mutagen YOU crafted.',
      },
    ],
  },
];

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
for (const f of FIXES) {
  if (!core.feats[f.id]) {
    console.error(`${f.id} is not a feat in core.json — refusing to write.`);
    process.exit(1);
  }
  // The match must actually describe modes that ship, or the feat stays inert with a field on it.
  const hits = Object.values(core.modes ?? {}).filter((m) => {
    if (!m.fromItemId) return false;
    const traits = new Set(core.items[m.fromItemId]?.traits ?? []);
    return f.value[0].match.traits.every((t) => traits.has(t));
  });
  if (!hits.length) {
    console.error(`${f.id}: no shipped item mode matches ${JSON.stringify(f.value[0].match.traits)} — refusing to write.`);
    process.exit(1);
  }
  console.log(`${f.id}: matches ${hits.length} item modes (e.g. ${hits.slice(0, 3).map((m) => m.id).join(', ')})`);
  core.feats[f.id].modeAdjust = f.value;
  entries.push({ category: 'feats', id: f.id, field: 'modeAdjust', value: f.value });
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wrote ${entries.length} mode adjustments (backfill ${backfill.length} → ${next.length})`);
