/*
 * "You gain a halcyon cantrip and a 1st-rank halcyon spell" — Shattered Sacrament and Cascade
 * Bearer's Spellcasting. Both were inert: nothing added a cantrip or a known spell to an ARCHETYPE
 * spellcasting entry, and Cascade Bearer's also widens the halcyon list to divine and occult (that
 * half lives in casterArchetypes.ts, since the tradition set belongs to the archetype).
 *
 * Values are checked against each feat's own printed text before anything is written.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};

const GRANTS = [
  {
    id: 'shattered-sacrament',
    entryId: 'halcyon-speaker-dedication-casting',
    // "You gain a halcyon cantrip and a 1st-rank halcyon spell."
    needs: /You gain a halcyon cantrip and a 1st-rank halcyon spell/i,
    note: 'When you cast a halcyon spell you may choose divine instead of arcane or primal — pick the tradition at the table; the entry itself stays on its chosen list.',
  },
  {
    id: 'cascade-bearers-spellcasting',
    entryId: 'magaambyan-attendant-dedication-casting',
    // "You gain a halcyon cantrip and a halcyon 1st-rank spell."
    needs: /You gain a halcyon cantrip and a halcyon 1st-rank spell/i,
    // Only the CANTRIP here. The Attendant has no 1st-rank slot of its own, so this feat IS its
    // schedule — the rank lives in casterArchetypes.ts `customUnlocks`. Writing byRank as well
    // granted the slot twice, which is the same double-grant Advanced Domain was caught doing.
    slot: false,
    note: null,
  },
];

let added = 0;
let replaced = 0;
for (const g of GRANTS) {
  const f = db.feats[g.id];
  if (!f) fail(`${g.id} does not exist`);
  const t = plain(f.description);
  if (!g.needs.test(t)) fail(`${g.id}: "a halcyon cantrip and a 1st-rank halcyon spell" not found in its text`);
  const value = { entryId: g.entryId, cantrips: 1, ...(g.slot === false ? {} : { byRank: { 1: 1 } }) };
  const put = (field, v) => {
    const i = rows.findIndex((r) => r.category === 'feats' && r.id === g.id && r.field === field && !r.path);
    if (v === null) {
      if (i >= 0) {
        rows.splice(i, 1);
        replaced++;
      }
      return;
    }
    if (i >= 0) {
      rows[i] = { category: 'feats', id: g.id, field, value: v };
      replaced++;
    } else {
      rows.push({ category: 'feats', id: g.id, field, value: v });
      added++;
    }
  };
  put('spellSlotBonus', value);
  if (g.note) put('note', g.note);
  // Both shipped a warning saying the app could not do this. It can now.
  put('dataWarning', null);
}

writeFileSync(BF, JSON.stringify(rows, null, 2) + '\n');
console.log(`effect-backfill: +${added} added, ${replaced} replaced/removed`);
