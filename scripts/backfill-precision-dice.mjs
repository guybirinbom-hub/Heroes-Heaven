/*
 * Three feats hand over the Sneak Attack class feature and then immediately cap its damage.
 *
 * `grantsClassFeatures: ['sneak-attack']` made them work at all — before that they granted nothing.
 * But the damage is computed from the ROGUE's progression (1d6 → 4d6 by level), so each of these
 * over-granted the moment the character passed 5th level: a 17th-level fighter with Butterfly's
 * Sting rolled 4d6 for a feat whose text is "You don't increase the number of dice as you gain
 * levels".
 *
 * Every number below is parsed from the feat's own sentence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};
const text = (id) => {
  const f = core.feats[id];
  if (!f) fail(`feats/${id} does not ship`);
  return String(f.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const entries = [];
const add = (id) => {
  const t = text(id);
  if (!(core.feats[id].grantsClassFeatures ?? []).includes('sneak-attack')) {
    fail(`${id} no longer grants sneak-attack — this override would apply to nothing`);
  }
  if (!/Sneak Attack class feature/i.test(t)) fail(`${id} no longer grants the Sneak Attack class feature`);

  // "except it deals 1d4 damage, increasing to 1d6 at 6th level"
  const ramp = t.match(/deals? (\d+)(d\d+)\s*(?:precision\s*)?damage,? increasing to (\d+)?(d\d+) at (\d+)(?:st|nd|rd|th) level/i);
  // "you deal 1d6 precision damage regardless of your level" / "1d6 … don't increase the number of dice"
  const flat = t.match(/deals? (\d+)(d\d+)/i);

  let value;
  if (ramp) {
    value = { dice: Number(ramp[1]), die: ramp[2], upgradeAt: { level: Number(ramp[5]), die: ramp[4] } };
  } else if (flat) {
    value = { dice: Number(flat[1]), die: flat[2] };
  } else {
    // No damage stated at all — the feat just caps the SCALING ("You don't increase the number of
    // dice as you gain levels"), so it stays at the base one die.
    if (!/don.t increase the number of dice/i.test(t)) {
      fail(`${id} states neither its own damage nor that the dice stop scaling — do not guess`);
    }
    value = { dice: 1, die: 'd6' };
  }

  core.feats[id].precisionDice = value;
  entries.push({ category: 'feats', id, field: 'precisionDice', value });
  console.log(`  ${id.padEnd(22)} ${JSON.stringify(value)}`);
};

add('butterflys-sting');
add('shadow-sneak-attack');
add('sneak-attacker');

if (entries.length !== 3) fail(`only ${entries.length} of 3 resolved`);

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wired ${entries.length} precision overrides (backfill ${backfill.length} → ${next.length})`);
