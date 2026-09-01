/*
 * GUARD: EVERY RECORD A PLAYER CAN OPEN MUST HAVE SOMETHING TO READ.
 *
 * A record with no text cannot be used at the table AND cannot be compared against Wanderer's Guide —
 * a parity read needs printed words to check an encoding against, so a textless record is a hole in
 * the audit as well as on the sheet. Two of them (Songbird's Brush, Merchant's Scale) stalled the
 * batch 1–4 parity read, which is what prompted measuring the class corpus-wide.
 *
 * ⚠ READ THIS BEFORE TRUSTING ANY "EMPTY DESCRIPTION" COUNT. Three different numbers came out of this
 * question and the first two were wrong, both because the instrument only knew one storage location:
 *
 *   6,438  records whose core-descriptions.json entry is empty. Almost meaningless — whole buckets
 *          (`rules`, `trait`, `archetype`, `bloodline`, `patron`, …) store NO plain description at all.
 *     389  the same count called "player-facing". Still wrong: `description` is the SEARCH + fallback
 *          field, and DISPLAY comes from the ast tree in public/ast/<bucket>.json. A record with an
 *          empty description usually reads perfectly well on the sheet.
 *     612  no description AND no ast — the real question. Of those, 455 are synthetic `modes` (their
 *          text lives on the parent item) and 151 are `treasure`: gems, art objects and trade goods
 *          that have no rules text in the book, only a price. Both are correct as they stand.
 *
 * So the genuine remainder is SIX records, four of which carry their rules in `note`. That is the
 * number this guard holds at. It fails when a NEW record arrives with nothing to read.
 *
 *   node scripts/readable-record-check.mjs           # guard
 *   node scripts/readable-record-check.mjs --list    # every record with nothing to read
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');
const astIndex = read('public/ast-index.json');

/* The ast payloads are split per bucket file and are the DISPLAY source; loaded lazily because most
 * records resolve on their description alone. */
const astCache = {};
const hasAst = (id) => {
  const file = astIndex[id];
  if (!file) return false;
  if (!(file in astCache)) {
    const p = join(ROOT, 'public/ast', `${file}.json`);
    astCache[file] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  }
  return Boolean(astCache[file][id]);
};

/*
 * EXEMPT, with the reason stated. Neither of these is a defect to be fixed later — both are records
 * that correctly have no prose of their own, and listing them by rule rather than by id means a new
 * gem or a new item mode does not trip the guard.
 */
const exempt = (bucket, rec) => {
  /* Synthetic toggle records generated per item (`item-addiction-suppressant-greater`, …). The mode is
   * a switch onto its parent item, and the parent carries the text. */
  if (bucket === 'modes') return 'synthetic mode — text lives on the parent item';
  /* Gems, art objects, trade goods. The book gives these a price and a name and nothing else; inventing
   * a description for a lump of amber would be writing rules, not restoring them. */
  if (bucket === 'items' && rec?.itemType === 'treasure') return 'treasure — priced valuable with no printed rules text';
  return null;
};

const bare = [];
for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [id, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;
    if (String(rec.description ?? '').trim()) continue;
    if (String(descs[bucket]?.[id]?.d ?? '').trim()) continue;
    if (hasAst(id)) continue;
    /* `note` is a real player-visible surface — the four bare stances state their whole rule in it. */
    if (String(rec.note ?? '').trim()) continue;
    if (exempt(bucket, rec)) continue;
    bare.push({ bucket, id, name: rec.name ?? id });
  }
}

/*
 * KNOWN, and each one read rather than counted:
 *
 *   splendid-pyschopomp-mask — a Foundry-era record with NO aonId; the Archives have no page for it
 *     under either spelling (they carry Psychopomp Mask, equipment-964, 5 gp Item 1 — a different
 *     item, not this 50 gp one). Its source is an adventure module, so there is nothing to recover
 *     from and nothing to verify against. Left alone deliberately: inventing prose for a rules record
 *     is worse than shipping none, because invented text reads as authoritative.
 *
 *   construct-companion — the companion's stat block is complete; what it lacks is the surrounding
 *     prose, which the Archives file separately as a rules page rather than on the companion itself.
 */
const KNOWN = new Set(['splendid-pyschopomp-mask', 'construct-companion']);

const unexpected = bare.filter((r) => !KNOWN.has(r.id));

if (LIST) {
  for (const r of bare) console.log(`${KNOWN.has(r.id) ? 'known  ' : 'NEW    '} ${r.bucket}/${r.id} — ${r.name}`);
  console.log(`\n${bare.length} record(s) with nothing to read (${unexpected.length} unexpected).`);
  process.exit(0);
}

if (unexpected.length) {
  console.error(`readable-record-check: ${unexpected.length} record(s) ship with nothing a player can read.\n`);
  for (const r of unexpected.slice(0, 40)) console.error(`   ${r.bucket}/${r.id} — ${r.name}`);
  console.error(
    '\nA record needs a description, an ast display tree, or a `note`. If it genuinely has no printed\n' +
      'rules text (a gem, a trade good), give it the right category so the exemption applies — do not\n' +
      'write prose for it. Recoverable text: node scripts/restore-empty-descriptions.mjs',
  );
  process.exit(1);
}
console.log(`readable-record-check: ok — every record has text, an ast, or a note (${KNOWN.size} known exceptions).`);
