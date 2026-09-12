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
 * ⚠ AND IT DID — batch 035 opened on 27 of them, twenty-one records that had arrived from the
 * Impossible Magic / Battlecry! scrapes since. Dispositions, all recorded rather than counted away:
 * 20 got the paragraph off their own AoN page (work/.b035-created-desc-readable-records.json); 5
 * itemBonus carriers and 2 `source` books went to the two new RULE-BASED exemptions below, each of
 * which is conditioned on a shape and tested in test/batch035-red-readable-records.test.ts. Nothing
 * was added to KNOWN: that set is for a record with no recoverable page at all.
 *
 *   node scripts/readable-record-check.mjs           # guard
 *   node scripts/readable-record-check.mjs --list    # every record with nothing to read
 */
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');
const astIndex = read('public/ast-index.json');

/* The ast payloads are split per bucket file and are the DISPLAY source; loaded lazily because most
 * records resolve on their description alone. */
/*
 * ⚠ KNOWN INSTRUMENT WEAKNESS, measured in batch 035: this lookup is keyed by the BARE id, with no
 * bucket, so a record whose slug is also some OTHER bucket's slug reads as covered by that record's
 * display tree. Four real holes were hiding behind it — `follower/medic` behind the Medic ARCHETYPE,
 * `follower/scout` behind the Scout exploration activity, `grimFascination/bone` behind an item and
 * `grimFascination/spirit` behind the barbarian Spirit instinct. All four were given their printed
 * text (work/.b035-created-desc-readable-records.json), which removes the dependence rather than the
 * blindness.
 *
 * Making the lookup bucket-strict was measured before it was rejected: 1,574 records currently
 * resolve through an ast FILE whose name differs from their bucket (itemBonus←items 715, runes←items
 * 155, rules←categoryPage 118, trait←ancestries 50 …), because public/ast/*.json are GROUPED display
 * files and were never per-bucket. A strict check would open a 1,574-record red on a false premise.
 * Closing it properly needs the ast index to carry each entry's bucket, which is a data-stage change.
 */
/* The tracked, shipped tree is `public/ast/<bucket>.json.gz`; the raw `.json` beside it is gitignored
 * importer output. Reading the raw file first made the verdict depend on what the last local regen
 * left behind (2026-09-12: a regen that was never committed made 12 records "readable" here and
 * nowhere else), so the .gz is read first and the raw file only stands in where no .gz exists. */
const astCache = {};
const hasAst = (id) => {
  const file = astIndex[id];
  if (!file) return false;
  if (!(file in astCache)) {
    const gz = join(ROOT, 'public/ast', `${file}.json.gz`);
    const raw = join(ROOT, 'public/ast', `${file}.json`);
    astCache[file] = existsSync(gz)
      ? JSON.parse(gunzipSync(readFileSync(gz)).toString('utf8'))
      : existsSync(raw) ? JSON.parse(readFileSync(raw, 'utf8')) : {};
  }
  return Boolean(astCache[file][id]);
};

/**
 * The four surfaces a record can carry text on, in one place so the exemption rules below can ask the
 * same question about a DIFFERENT record (the parent an item bonus hangs off) that the scan asks
 * about this one. `note` is a real player-visible surface — the four bare stances state their whole
 * rule in it.
 */
export const readable = (bucket, id, rec, descsFile = descs) =>
  Boolean(
    String(rec?.description ?? '').trim() ||
      String(descsFile?.[bucket]?.[id]?.d ?? '').trim() ||
      hasAst(id) ||
      String(rec?.note ?? '').trim(),
  );

/*
 * EXEMPT, with the reason stated. None of these is a defect to be fixed later — all are records that
 * correctly have no prose of their own, and listing them by rule rather than by id means a new gem, a
 * new item mode, a new item bonus or next month's adventure path does not trip the guard.
 *
 * ⚠ An exemption that swallows a real hole is worse than the red it hides, so every rule here is a
 * SHAPE the record must actually have — never a bucket name on its own where the bucket can also hold
 * records with printed rules of their own.
 */
export const exempt = (bucket, rec, id, db = core, descsFile = descs) => {
  /* Synthetic toggle records generated per item (`item-addiction-suppressant-greater`, …). The mode is
   * a switch onto its parent item, and the parent carries the text. */
  if (bucket === 'modes') return 'synthetic mode — text lives on the parent item';
  /* Gems, art objects, trade goods. The book gives these a price and a name and nothing else; inventing
   * a description for a lump of amber would be writing rules, not restoring them. */
  if (bucket === 'items' && rec?.itemType === 'treasure') return 'treasure — priced valuable with no printed rules text';
  /*
   * batch 035 premise: equipment-3055 "Over millennia, these mysterious, intricately cut gemstones have been hoarded by mystics and fanatics hoping to discover their secrets."
   *
   * (Verifier, batch 035: the id was `equipment-3055-4734-bonus-1716` — a real mirror doc, but filed
   * under `item-bonus/`, and test-flip-audit.mjs derives a premise's folder by stripping the trailing
   * `-<digits>`, so that id resolves to nothing. Repointed at the parent ITEM page, which carries the
   * same clause verbatim and is the page the exemption is actually about.)
   *
   * The SAME `modes` shape, measured rather than assumed: all 723 itemBonus ids are also `items` ids,
   * and the 718 that pass this guard today pass on the PARENT ITEM's ast tree — the itemBonus record
   * is a synthetic carrier for one bonus value scraped off an item page whose prose (quoted above,
   * from the aeon stone page these five hang on) is stored under `items`. Writing a second copy of
   * the item's text onto the carrier would ship the same paragraph twice.
   *
   * Conditioned on the parent being readable, not on the bucket: an item bonus whose parent item is
   * missing or itself bare is a genuine hole and still fails here.
   */
  if (bucket === 'itemBonus' && readable('items', id, db?.items?.[id], descsFile)) return 'item bonus — synthetic carrier; text lives on the parent item';
  /*
   * batch 035 premise: source-370 "**Product Line** Adventures"
   *
   * A `source` record is a BOOK, not a rules record: the Archives page for one carries a product-page
   * link, a release date, a product line and a source group — the four fields quoted above — and no
   * rules text at all, because the rules are the thousands of records that cite it. The bucket exists
   * so the per-character book filter has something to list. Every future adventure and rulebook lands
   * here, which is exactly why this is a rule and not two more ids.
   */
  if (bucket === 'source') return 'source — a book entry, not a rules record';
  return null;
};

const bare = [];
for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [id, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;
    if (readable(bucket, id, rec)) continue;
    if (exempt(bucket, rec, id)) continue;
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

/* The scan is module scope so a test can import `readable` / `exempt`; only the REPORT is CLI-only.
 * Without this the import would print and then process.exit() out of the test runner. (Windows hands
 * argv[1] back as a `C:\…` path, so comparing it to import.meta.url needs pathToFileURL.) */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
