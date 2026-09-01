/*
 * GUARD: AN INNATE SPELL WHOSE TEXT STATES A FREQUENCY MUST CARRY ONE.
 *
 * *"You can cast Ventriloquism ONCE PER DAY as a 1st-rank occult innate spell."* Distant Cackle's grant
 * shipped with no `usesPerDay`, and an innate spell with no frequency is castable AT WILL — the single
 * most valuable thing a feat can give, handed over by an omission. It reads as fine on the sheet, which
 * is why it survived: the spell is there, the tradition is right, and only the limit is missing.
 *
 * Found in batch 15's residual read. The mirror of it — a frequency we invent that the text does not
 * state — is checked too, because that direction quietly takes something away from the player.
 *
 *   node scripts/innate-frequency-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

/* "once per day", "twice per day", "three times per day", "N times per day". */
const PER_DAY = /\b(once|twice|thrice|three times|four times|\d+ times)\s+per\s+day\b/i;
const AT_WILL = /\bat will\b/i;

const missing = [];
const spurious = [];
for (const bucket of Object.keys(core)) {
  for (const [id, rec] of Object.entries(core[bucket] ?? {})) {
    const grants = rec?.innateSpells;
    if (!Array.isArray(grants) || !grants.length) continue;
    const d = String(descs[bucket]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!d) continue;

    const saysPerDay = PER_DAY.test(d);
    const saysAtWill = AT_WILL.test(d);
    /* A record may grant several spells on different terms ("Bless once per day, and Light at will"),
     * so only the unambiguous cases are judged: the text states ONE of the two and every grant should
     * agree with it. */
    if (saysPerDay === saysAtWill) continue;

    for (const g of grants) {
      const limited = g.usesPerDay != null || g.atWill === false;
      const unlimited = g.atWill === true || (g.usesPerDay == null && g.atWill == null);
      /* A cantrip is at-will by its nature and states no frequency of its own. */
      if ((core.spells?.[g.spellId]?.traits ?? []).includes('cantrip')) continue;
      if (saysPerDay && unlimited) missing.push(`${bucket}/${id} — "${PER_DAY.exec(d)[0]}" but ${g.spellId} is granted with no limit (castable at will)`);
      if (saysAtWill && limited) spurious.push(`${bucket}/${id} — text says "at will" but ${g.spellId} is capped at ${g.usesPerDay}`);
    }
  }
}

const bad = [...missing, ...spurious];
if (!bad.length) {
  console.log('innate-frequency: ok — every innate grant matches the frequency its text states');
  process.exit(0);
}
console.log(`innate-frequency: FAIL — ${bad.length} grant(s) disagree with their own text:\n`);
for (const b of bad.slice(0, 40)) console.log(`   ${b}`);
if (bad.length > 40) console.log(`   …and ${bad.length - 40} more`);
process.exit(1);
