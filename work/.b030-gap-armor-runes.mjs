/*
 * batch 030, gap-engine lane: MEASURE the specific-magic-armour builtInRunes lane.
 *
 * The engine builder shipped the readers (deriveAc's acItem floor and resilientSaveBonus's, both on
 * `builtInRunes` — src/rules/derive.ts) plus ONE row, items/rusting-carapace, and filed the rest as
 * "DATA STILL NEEDED … needs its own measured lane". This is that measurement.
 *
 * Ground truth is the AoN mirror, not a guess off our own text:
 *   - the lane is exactly `item_subcategory === "Specific Magic Armor"`;
 *   - `base_item` names the mundane armour the entry is built on ("Leather Lamellar"), which ANCHORS
 *     the "+N …" phrase to the armour itself. Without that anchor a bare /\+[1-4]/ scan also matches
 *     "you gain a +1 circumstance bonus to AC" (rusting-carapace's own second sentence) and every
 *     other in-text bonus, which is how a lane like this ships wrong rows.
 *
 * Only the FUNDAMENTAL runes are read — potency and resilient — because those are the two the
 * readers implement. Property runes named in the same phrase (fortification, glamered, invisibility,
 * deathless…) are deliberately left out: ArmorRunes.property has no builtIn reader, so a row would
 * be dead data.
 *
 * Usage: node work/.b030-gap-armor-runes.mjs [--json <out>]
 */
import fs from 'node:fs';
import path from 'node:path';

const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/equipment';
const core = JSON.parse(fs.readFileSync('public/core.json', 'utf8'));
const descs = JSON.parse(fs.readFileSync('public/core-descriptions.json', 'utf8')).items;

/** Mirror docs of the lane, keyed by their AoN id ("equipment-1853"). */
const byAonId = new Map();
for (const f of fs.readdirSync(MIRROR)) {
  const raw = JSON.parse(fs.readFileSync(path.join(MIRROR, f), 'utf8'));
  const d = raw._source ?? raw;
  if (d.item_subcategory === 'Specific Magic Armor') byAonId.set(f.replace(/\.json$/, ''), d);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** RESILIENT_TIER (src/rules/attachments.ts:57) — the printed word → the ArmorRunes tier. */
const TIER = { resilient: 'resilient', greater: 'greater', major: 'major', mythic: 'mythic' };

/**
 * The fundamental runes printed in an entry's own name-phrase, or null.
 * `+2 greater resilient glamered dawnsilver breastplate` → { potency: 2, resilient: 'greater' }.
 */
function printedRunes(text, baseNames) {
  for (const base of baseNames) {
    // …up to five words of runes/materials between the potency and the base armour, and the mirror
    // writes the phrase in italics as often as not, so asterisks are part of the gap.
    const re = new RegExp(`\\+([1-4])((?:[ *]+[A-Za-z'’-]+){0,5}?)[ *]+${esc(base)}\\b`, 'i');
    const m = text.match(re);
    if (!m) continue;
    const mid = (m[2] ?? '').toLowerCase();
    // "a +1 circumstance bonus to AC" can never reach here (the base name anchors it), but a
    // defensive check costs one line and the whole lane rides on this phrase being the item's name.
    if (/\b(bonus|penalty|circumstance|status|item bonus)\b/.test(mid)) continue;
    const r = mid.match(/(?:\b(greater|major|mythic)\b[ *]+)?\bresilient\b/);
    const out = { potency: Number(m[1]) };
    if (r) out.resilient = TIER[r[1] ?? 'resilient'];
    return out;
  }
  return null;
}

const rows = [];
const skipped = [];
for (const [id, it] of Object.entries(core.items)) {
  if (!it || it.itemType !== 'armor') continue;
  const doc = it.aonId ? byAonId.get(it.aonId) : undefined;
  if (!doc) continue;
  /*
   * The base armour NAME is the anchor, and the entry's OWN description is the text.
   *
   * Not the mirror's `text`: AoN files a whole variant family in ONE document (Victory Plate and
   * Victory Plate (Greater); the four Wisp Chains; the five Plates of Yled), and its opening sentence
   * names the BASE variant's runes only — reading it for every member gives the greater a +1 where
   * it prints +2. Our records are per-variant and their descriptions carry each variant's own
   * sentence, which is why the family head trap does not reach this lane.
   *
   * Both spellings of the base are tried: the mirror's ("Studded Leather Armor") and the same name
   * without its trailing "Armor", which is how half the printed sentences write it.
   */
  const bases = [...new Set((doc.base_item ?? []).flatMap((b) => [b, b.replace(/\s+Armor$/i, '')]))].sort(
    (a, b) => b.length - a.length,
  );
  // …and NO fallback to the mirror's text when a record has no description of its own: that is
  // exactly the family-head trap above (greater-mitigation-mail and greater-reactive-mail each read
  // the base variant's "+1 resilient chain mail" that way, and both print more). A record with no
  // per-variant sentence is skipped and reported, never guessed.
  let text = String(descs[id]?.d ?? '');
  /*
   * …and a description that is a raw AoN PAGE DUMP rather than the entry's own sentence is skipped
   * too. Two duplicate records ship one (greater-mitigation-mail, greater-reactive-mail — the
   * suffix-form mitigation-mail-greater / reactive-mail-greater are the live ones), and what a dump
   * carries is the FAMILY HEAD's opening sentence: reading it gives a "greater" entry the base
   * variant's +1 where it prints +2. The page header is the tell.
   */
  if (/\bSource\b[\s\S]{0,120}\bUsage\b[\s\S]{0,80}\bBase Armor\b/.test(text.slice(0, 400))) text = '';
  const runes = bases.length ? printedRunes(text, bases) : null;
  if (!runes) {
    skipped.push({ id, base: bases[0] ?? '(none)', head: text.replace(/\s+/g, ' ').slice(0, 110) });
    continue;
  }
  if (it.builtInRunes) {
    skipped.push({ id, base: bases[0], head: 'ALREADY HAS builtInRunes ' + JSON.stringify(it.builtInRunes) });
    continue;
  }
  rows.push({ id, name: it.name, aonId: it.aonId, base: bases[0], value: runes, quote: quoteOf(text, runes) });
}

/** The verbatim printed phrase the row is authored from, for the row's `why`. */
function quoteOf(text, runes) {
  const i = text.indexOf(`+${runes.potency}`);
  return text
    .slice(Math.max(0, i - 40), i + 90)
    .replace(/\s+/g, ' ')
    .trim();
}

/*
 * Rows another batch-030 spec already claims are DROPPED, not re-emitted: the applier hard-refuses
 * two rows on the same record+field, and items/rusting-carapace is the engine builder's own row
 * (work/.b030-rows-engine.json). Its value there — {potency:1} — is what this measurement derives
 * independently, which is the cross-check that the parser reads the same thing a human did.
 */
const claimed = new Set();
for (const s of JSON.parse(fs.readFileSync('work/.b030-specs.json', 'utf8'))) {
  const spec = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  for (const f of spec.findings ?? []) for (const r of f.backfillRows ?? []) claimed.add(`${r.category}/${r.id}/${r.field}`);
}
const mine = rows.filter((r) => !claimed.has(`items/${r.id}/builtInRunes`));

const out = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
if (out) fs.writeFileSync(out, JSON.stringify(mine, null, 1));
console.log(`already claimed by another spec: ${rows.length - mine.length}`);
console.log(`lane docs: ${byAonId.size}   rows: ${rows.length}   with resilient: ${rows.filter((r) => r.value.resilient).length}`);
console.log(`skipped (no printed fundamental rune, or already carries one): ${skipped.length}`);
/*
 * --spec: emit the batch-030 row spec itself, in the shape the driver's applier reads.
 *
 * Two rows are hand-authored beside the measured ones, both for records the anchor cannot reach:
 * items/slithermaws-bane, whose sentence names ELVEN CHAIN (itself a magic armour, and one our data
 * files as itemType "equipment") rather than its base_item "Chain Shirt"; and the Bands of Force
 * talisman flag, which is this lane's sibling gap line and shares no field with anything else.
 */
if (process.argv.includes('--spec')) {
  const specOut = process.argv[process.argv.indexOf('--spec') + 1];
  const armourRows = [
    ...mine.map((r) => ({
      category: 'items',
      id: r.id,
      field: 'builtInRunes',
      value: r.value,
      why: `AoN ${r.aonId} (Specific Magic Armor, base ${r.base}) prints the fundamental rune in the entry's own name: "${r.quote}". deriveAc's acItem and resilientSaveBonus (src/rules/derive.ts) floor the etched runes with builtInRunes, so without this row the wearer is a full potency step short of the book value.`,
    })),
    {
      category: 'items',
      id: 'slithermaws-bane',
      field: 'builtInRunes',
      value: { potency: 2, resilient: 'greater' },
      why: 'AoN equipment-3700: "This suit of +2 greater resilient elven chain was worn by the elven hero Kyloss Syndar." Hand-authored rather than measured: the sentence names Elven Chain, not the base_item "Chain Shirt", and items/elven-chain ships as itemType "equipment" so no armour-name anchor reaches it either.',
    },
  ];
  const spec = {
    findings: [
      {
        id: 'rusting-carapace#potency',
        note: `The LANE half of the confirmed finding — its proposal ends "and the same for the other 111 specific magic armors as a lane", and the engine builder filed that lane as DATA STILL NEEDED. ${armourRows.length} rows, measured by work/.b030-gap-armor-runes.mjs against the AoN mirror's "Specific Magic Armor" subcategory with base_item as the anchor and each record's OWN description as the text. items/rusting-carapace is deliberately absent: it is the engine spec's row, and this measurement independently derives the same {potency:1} for it. Fundamental runes only — ArmorRunes.property has no builtIn reader, so a property-rune row would be dead data.`,
        backfillRows: armourRows,
      },
      {
        id: 'bands-of-force#talismans',
        note: 'The gap line\'s data half. `affixHostAs` (new on ItemBase, src/rules/types.ts) is read by affixHostType() in src/rules/attachments.ts, which planAffix and both UI host gates now route through. One field, no existing row on this record to supersede — the engine spec\'s bands-of-force row is on `passiveEffects`, a different field.',
        backfillRows: [
          {
            category: 'items',
            id: 'bands-of-force',
            field: 'affixHostAs',
            value: 'armor',
            why: 'AoN equipment-3058: "You can affix talismans to the bands as though they were light armor." The bands ship as itemType "equipment", so planAffix rejected every talisman outright.',
          },
        ],
      },
    ],
  };
  fs.writeFileSync(specOut, JSON.stringify(spec, null, 1));
  console.log(`spec written: ${specOut} (${armourRows.length + 1} rows)`);
}

if (process.argv.includes('--show')) {
  for (const r of mine) console.log(`${r.id}  ${JSON.stringify(r.value)}  «${r.quote}»`);
  console.log('--- skipped ---');
  for (const s of skipped) console.log(`${s.id}  [${s.base}]  ${s.head}`);
}
