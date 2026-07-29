/*
 * Fills in `Feat.limitedUses` from each feat's printed **Frequency** line.
 *
 * NO agents were needed: "Frequency once per day" is a structured pattern, so it is parsed
 * deterministically and the result is re-checkable by rerunning this script. Agents are for judgement
 * calls, not for reading a fixed grammar.
 *
 * DELIBERATELY SKIPPED — "once per 10 minutes" and friends (75 feats). Those are COOLDOWNS, not a
 * daily budget: modelling one as a 1/day pool would tell the player they had spent their only use for
 * the day when the rules let them go again ten minutes later. Being wrong in the restrictive direction
 * is still being wrong. `limitedUses` has no multi-unit period, so they stay untracked and visible as
 * printed text.
 *
 * Usage: node scripts/apply-feat-uses.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const PATH = 'public/core.json';
const db = JSON.parse(readFileSync(PATH, 'utf8'));

const strip = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const WORDS = { one: 1, once: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, ten: 10 };
const PERIODS = /^(round|turn|minute|hour|day|week|month)$/;

const stats = { applied: 0, cooldown: 0, unparsed: 0, noFrequency: 0, skippedExisting: 0 };
const unparsed = [];

for (const [id, rec] of Object.entries(db.feats ?? {})) {
  const text = strip(rec.description);
  const m = text.match(/\*\*Frequency\*\*\s*([^*]{0,60}?)(?:\s*\*\*|\s*---|$)/i);
  if (!m) { stats.noFrequency++; continue; }
  if (rec.limitedUses) { stats.skippedExisting++; continue; }
  const line = m[1].trim().toLowerCase();

  // A cooldown ("once per 10 minutes") names a WAIT, not an allowance. Recognise it explicitly so it
  // is skipped on purpose rather than falling through to the unparsed pile.
  if (/\b(?:per|every)\s+\d+\s+\w+/.test(line)) { stats.cooldown++; continue; }

  // "once per day", "twice per day", "3 times per day", "three times a day"
  const mm = line.match(/^(once|twice|thrice|one|two|three|four|five|six|ten|\d+)\s*(?:times?\s*)?(?:per|a)\s+([a-z]+)/);
  if (!mm) { stats.unparsed++; unparsed.push(`${id}: "${line.slice(0, 44)}"`); continue; }

  const max = /^\d+$/.test(mm[1]) ? Number(mm[1]) : WORDS[mm[1]];
  const per = mm[2].replace(/s$/, '');
  if (!max || max <= 0 || !PERIODS.test(per)) { stats.unparsed++; unparsed.push(`${id}: "${line.slice(0, 44)}"`); continue; }

  rec.limitedUses = { max, per };
  stats.applied++;
}

console.log(`feats: applied ${stats.applied} · cooldown-skipped ${stats.cooldown} · unparsed ${stats.unparsed} · already had one ${stats.skippedExisting} · no Frequency line ${stats.noFrequency}`);
if (unparsed.length) { console.log('UNPARSED:'); unparsed.slice(0, 10).forEach((u) => console.log('  ' + u)); }
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(db)); // minified — pretty-printing this file once cost 4 MB
console.log('\nwritten:', PATH);
