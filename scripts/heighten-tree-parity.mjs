/*
 * HEIGHTEN TREE PARITY — the gate of card step 17 (docs/card-design.md section 9 row 17, spells phase B;
 * section 5 rows "Heightening split + .applies rail" and "Damage arrow"; section 8 rule 6: shrink-only,
 * two-way checked). Writes src/data/heighten-string-lane.json and work/card-step17-heighten-reprint-drift.json.
 *
 * Step 17 moves the spell popup's BODY from the description string to the spell's own Archives page tree
 * (src/sheet/heighteningTree.ts splitSpellTree). The owner's bar: "don't break spell heightening". So, for
 * EVERY spell with a tree body candidate (a spell / ritual page with a rule), this compares what the two
 * lanes show at every cast rank above the spell's base (base+1 … 10):
 *   - the applying Heightened entries: the string lane's (splitHeightening + heighteningApplies, exactly
 *     what SpellDetail drew before) against the tree lane's (splitSpellTree + treeEntryApplies) — the tree
 *     must hold every string entry that applies: an applying tree entry with the same trigger ("+1",
 *     "5th"), or else with the same words (the page's "(+1)" for the string's "(10th)" on a 9th-rank spell,
 *     the same sentence; spellCard.ts heightenParity);
 *   - the damage arrow: where the string lane anchors "(→ X)" (injectDamageArrow on the stripped body) and
 *     where the tree lane would (injectTreeArrow on the body nodes). The VALUE is scaleDamage on both lanes
 *     — one function — so no number can move; only the anchor can be lost.
 *
 * A spell that fails parity is then one of two things (spellCard.ts heightenGate; the orchestrator's ruling
 * on owner rule R12, "the newest printing wins, whole"):
 *   (a) REPRINT DRIFT — its page is a NEWER printing than the text the string was imported from: the page
 *       replaces an older document (scripts/lib/reprint.mjs, the Archives' own legacy_id / remaster_id link,
 *       read from the export — never a name guess) and every entry the page no longer holds is printed in
 *       that older document's Heightened lines. The page wins: the spell draws the TREE, and it is listed in
 *       work/card-step17-heighten-reprint-drift.json with the entries the string had that the page no longer
 *       prints and the engine's heightening fields in public/core.json that now disagree with print (for the
 *       rebuild lane — the engine's numbers are not touched here; mechanics are out of scope).
 *   (b) a SAME-PRINTING page that genuinely omits a Heightened line the string carries: the spell stays on the
 *       string lane (src/data/heighten-string-lane.json `ids`), its footer naming the missing line (`missing`).
 * The drift file also lists, as `engineDrift`, every tree-lane spell whose page prints a "(+N)" interval the
 * engine's interval heightening does not use (celestial-brand: the page's "(+1)", the engine's 2), or whose page
 * prints only "(Nth)" entries that grant fewer steps than the engine's interval (draw-the-lightning).
 * Round 3 (the orchestrator's arrow rule, spellCard.ts arrowAt): an arrow or area suffix is drawn only where a
 * printed Heightened entry of the text the player reads applies at the cast rank and backs it. Each drift
 * entry carries `displaySuppressed` (the ranks the popup withholds what the engine computes) and
 * `displayFromPrint` (the ranks the popup draws the page's count instead of the engine's); a spell that
 * withholds or re-counts an arrow without a drift entry fails --write and --check. `notOwnPage` lists the
 * spell records whose tree is a page of another category (printed inside it; an ours footer says so).
 *
 * The same functions run in test/card-spell-tree.test.tsx over the whole corpus, which asserts the file
 * equals the gate both ways (the reprint evidence it re-reads is the file's `reprints`, checked here against
 * the export), and that no tree-lane spell loses an entry the same printing prints, or an arrow.
 *
 *   npx jiti scripts/heighten-tree-parity.mjs           # counts + what would change
 *   npx jiti scripts/heighten-tree-parity.mjs --write   # write both files
 *   npx jiti scripts/heighten-tree-parity.mjs --check   # exit 1 when the lane file is not the gate (two-way)
 *   npx jiti scripts/heighten-tree-parity.mjs --list    # every failing spell with its verdict
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from './card-truth-check.mjs';
import { loadReprintIndex, newestPrinting } from './lib/reprint.mjs';
import {
  arrowDisplayDrift,
  heightenGate,
  heightenParityAll,
  printedInsideTitle,
  spellCardModel,
  spellTreeCandidate,
  stringLaneProblems,
} from '../src/sheet/spellCard.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'src/data/heighten-string-lane.json';
const DRIFT = 'work/card-step17-heighten-reprint-drift.json';
const argv = process.argv.slice(2);

const content = loadContent(ROOT);
const trees = JSON.parse(gunzipSync(readFileSync(join(ROOT, 'public/ast/spells.json.gz'))).toString('utf8'));
// A candidate is a page-lane spell, whose stat rows come from the page: the field rows never reach the gate.
const parity = heightenParityAll(content.spells ?? {}, trees, () => []);
const failing = parity.filter((p) => p.stay);

// The reprint relation: the app's own map (scripts/reprint-check.mjs reads the same index), inverted so a
// page's document names every older document whose newest printing it is.
const index = loadReprintIndex(undefined, { text: true });
const olderOf = new Map();
for (const old of index.next.keys()) {
  const newest = newestPrinting(index, old);
  if (newest) (olderOf.get(newest) ?? olderOf.set(newest, []).get(newest)).push(old);
}
/** The older document's Heightened lines, as it prints them ("**Heightened (5th)** The spell …"). */
const heightenedLines = (docId) =>
  String(index.docs.get(docId)?.text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\W*Heightened\b/.test(l));
const evidenceOf = (id) => {
  const to = trees[id]?.aon;
  return to ? [...(olderOf.get(to) ?? [])].sort().map((from) => ({ from, to, entries: heightenedLines(from) })) : [];
};
const gate = heightenGate(parity, evidenceOf);
const reprintIds = gate.reprintDrift.map((d) => d.id);

/* ---- the engine's heightening fields against the page (listed only; the engine is not touched) ---- */
const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const textOfNode = (n) => (n.t === 'text' ? (n.v ?? '') : (n.c ?? []).map(textOfNode).join(''));
const entryText = (e) => e.nodes.map(textOfNode).join(' ').replace(/\s+/g, ' ').trim();
function engineDisagrees(spell, cut) {
  const h = spell.heightening;
  const page = cut.heightening;
  const labels = page.map((e) => e.label).join(', ') || 'no Heightened line';
  if (!h) return page.some((e) => e.trigger) ? [`the engine has no heightening; the page prints ${labels}`] : [];
  const out = [];
  if (h.type === 'interval') {
    if (!page.some((e) => e.trigger?.type === 'rel' && e.trigger.n === h.interval)) out.push(`the engine heightens every +${h.interval}; the page prints ${labels}`);
  } else if (h.type === 'fixed') {
    for (const [lvl, val] of Object.entries(h.levels ?? {})) {
      const L = Number(lvl);
      const e = page.find((x) => x.trigger?.type === 'abs' && x.trigger.n === L);
      if (!e) {
        out.push(`the engine heightens at ${ord(L)}; the page prints no (${ord(L)}) entry`);
        continue;
      }
      const text = entryText(e);
      const nums = [...new Set(JSON.stringify(val).match(/\d+/g) ?? [])];
      if (nums.some((x) => !new RegExp(`(?<!\\d)${x}(?!\\d)`).test(text))) out.push(`the engine's ${ord(L)} ${JSON.stringify(val)}; the page's (${ord(L)}) entry prints "${text}"`);
    }
  }
  return out;
}
const docMeta = (d) => ({ doc: d, book: index.docs.get(d)?.book ?? '', release: index.docs.get(d)?.release_date ?? '' });
const reprintDrift = gate.reprintDrift.map((d) => {
  const sp = content.spells[d.id];
  const cut = spellTreeCandidate(sp, trees[d.id]);
  return {
    id: d.id,
    old: docMeta(d.from),
    new: docMeta(d.to),
    stringOnly: d.lost,
    pageEntries: cut.heightening.map(entryText),
    engine: sp.heightening ?? null,
    engineDisagrees: engineDisagrees(sp, cut),
  };
});
/* ---- the arrow rule (the orchestrator's round-3 ruling; spellCard.ts arrowAt) ----
 * An arrow or an area suffix is drawn only where a printed Heightened entry of the text the player reads
 * applies at the cast rank and backs it. Over EVERY spell, as the popup models it: the ranks where the engine
 * heightens a value the popup withholds (`displaySuppressed`) and the ranks where the drawn value counts the
 * steps the page's entries grant instead of the engine's interval (`displayFromPrint`, rank → [shown,
 * engine]). Every spell with either must be a drift entry — a new one enters only through the drift file. */
const display = new Map();
for (const id of Object.keys(content.spells ?? {}).sort()) {
  const sp = content.spells[id];
  const d = arrowDisplayDrift(sp, spellCardModel(sp, trees[id], []));
  if (d.suppressed.damage.length || d.suppressed.area.length || Object.keys(d.fromPrint).length) display.set(id, d);
}

const stringIds = new Set(gate.stringLane.map((s) => s.id));
const engineDrift = [];
for (const p of parity) {
  if (stringIds.has(p.id)) continue; // still on the string lane: the page is not what the player reads
  if (reprintIds.includes(p.id)) continue; // listed under reprintDrift
  const sp = content.spells[p.id];
  if (sp.heightening?.type !== 'interval') continue;
  const cut = spellTreeCandidate(sp, trees[p.id]);
  const rel = cut.heightening.filter((e) => e.trigger?.type === 'rel');
  if (rel.some((e) => e.trigger.n === sp.heightening.interval)) continue;
  // The page prints another "(+N)" (celestial-brand), or only "(Nth)" entries whose steps the popup draws
  // differently from the engine's interval (draw-the-lightning: "(8th)" on a 4th-rank spell, the engine
  // every +1).
  if (!rel.length && !display.has(p.id)) continue;
  engineDrift.push({
    id: p.id,
    page: docMeta(trees[p.id].aon),
    older: [...(olderOf.get(trees[p.id]?.aon) ?? [])].sort().map((d) => ({ ...docMeta(d), heightened: heightenedLines(d) })),
    pageEntries: cut.heightening.filter((e) => e.trigger).map(entryText),
    engine: sp.heightening,
    engineDisagrees: engineDisagrees(sp, cut),
  });
}

const withDisplay = (e) => ({
  ...e,
  displaySuppressed: display.get(e.id)?.suppressed ?? { damage: [], area: [] },
  displayFromPrint: display.get(e.id)?.fromPrint ?? {},
});
const driftIds = new Set([...reprintDrift.map((d) => d.id), ...engineDrift.map((d) => d.id)]);
const displayUnlisted = [...display.keys()].filter((id) => !driftIds.has(id));

/* ---- records printed inside a bigger page of another category (round-3 ruling) ---- */
const notOwnPage = Object.keys(content.spells ?? {})
  .sort()
  .map((id) => ({ id, page: trees[id]?.aon ?? null, title: printedInsideTitle(content.spells[id], trees[id]) }))
  .filter((e) => e.title);

/* ---- report ---- */
const file = JSON.parse(readFileSync(join(ROOT, FILE), 'utf8'));
const problems = stringLaneProblems(file.ids ?? [], parity, Object.keys(file.reprints ?? {}));
const n = (f) => parity.filter(f).length;
const spells = Object.keys(content.spells ?? {}).length;
console.log(`heighten tree parity: ${spells} spells, ${parity.length} with a tree body candidate (${spells - parity.length} without: no spell page, or no rule).`);
console.log(`  entries: ${n((p) => p.stringEntries > 0)} spells split entries on the string lane, ${n((p) => p.treeEntries > 0)} on the tree; ${n((p) => p.ampEntries > 0)} carry an Amp group (${parity.reduce((s, p) => s + p.ampEntries, 0)} Amp paragraphs).`);
console.log(`  applied set: ${n((p) => p.shrinks.length > 0)} shrink at some rank; ${n((p) => p.gains.length > 0)} apply more entries on the tree at some rank.`);
console.log(`  arrow: ${n((p) => p.arrow)} spells heighten their damage; anchored inline by the string ${n((p) => p.arrowString)}, by the tree ${n((p) => p.arrowTree)}; lost by the tree ${n((p) => p.arrowLost)}; boxed on the tree (no inline anchor) ${n((p) => p.arrow && !p.arrowTree)}: ${parity.filter((p) => p.arrow && !p.arrowTree).map((p) => p.id).join(', ')}.`);
console.log(`  fail parity: ${failing.length} — reprint drift (the page is a newer printing; draws the tree) ${gate.reprintDrift.length}: ${reprintIds.join(', ')}; same printing, a line the page omits (string lane) ${gate.stringLane.length}: ${[...stringIds].join(', ')}.`);
console.log(`  engine drift (a page "(+N)" the engine's interval does not use, tree lane): ${engineDrift.length}: ${engineDrift.map((e) => e.id).join(', ')}.`);
console.log(`  stay on the string lane: ${gate.stringLane.length}; draw the tree: ${parity.length - gate.stringLane.length}.`);
console.log(`  arrow rule: ${display.size} spells where the popup withholds or re-counts an engine value: ${[...display.keys()].join(', ')}; not a drift entry: ${displayUnlisted.length}${displayUnlisted.length ? ` (${displayUnlisted.join(', ')})` : ''}.`);
for (const [id, d] of display) console.log(`   ${id}: withheld damage at ${d.suppressed.damage.join('/') || '-'}, area at ${d.suppressed.area.join('/') || '-'}; from print ${JSON.stringify(d.fromPrint)}`);
console.log(`  printed inside another page (the not-own-page footer): ${notOwnPage.length}: ${notOwnPage.map((e) => `${e.id} (${e.page})`).join(', ')}.`);
const reason = (p) => [p.shrinks.length ? `applied set shrinks at ${p.shrinks.join('/')}` : '', p.arrowLost ? 'inline arrow lost' : ''].filter(Boolean).join('; ');
if (argv.includes('--list')) {
  for (const d of gate.reprintDrift) console.log(`   REPRINT ${d.id}: ${d.from} -> ${d.to}; the page no longer prints ${d.lost.map((l) => JSON.stringify(l.slice(0, 80))).join(', ')}`);
  for (const s of gate.stringLane) {
    const doc = trees[s.id]?.aon;
    console.log(`   STRING  ${s.id}: ${reason(parity.find((p) => p.id === s.id))}; its page ${doc} replaces ${(olderOf.get(doc) ?? []).join(', ') || 'no older printing'}; prints no Heightened line for ${s.missing.join(' or ')}`);
  }
}

const laneOut = {
  _generated: `scripts/heighten-tree-parity.mjs --write — never hand-edit. ids: the spells whose page tree would show fewer applying Heightened entries at some cast rank (or lose the inline damage arrow) than the description string while being the SAME printing; SpellDetail draws their body from the string (src/sheet/spellCard.ts spellCardModel) with a footer naming what the page prints no Heightened line for (missing). reprints: the spells whose page is a NEWER printing than the string (owner rule R12, the page wins: they draw the tree), with the older printing's Heightened lines as the gate's evidence; the full drift is ${DRIFT}. test/card-spell-tree.test.tsx checks it both ways`,
  _counts: { spells, candidates: parity.length, failing: failing.length, stay: gate.stringLane.length, reprintDrift: gate.reprintDrift.length, tree: parity.length - gate.stringLane.length },
  ids: gate.stringLane.map((s) => s.id),
  reasons: Object.fromEntries(gate.stringLane.map((s) => [s.id, reason(parity.find((p) => p.id === s.id))])),
  missing: Object.fromEntries(gate.stringLane.map((s) => [s.id, s.missing])),
  reprints: Object.fromEntries(gate.reprintDrift.map((d) => [d.id, evidenceOf(d.id).find((e) => e.from === d.from)])),
};

if (argv.includes('--write')) {
  writeFileSync(join(ROOT, FILE), JSON.stringify(laneOut, null, 1) + '\n');
  const driftOut = {
    _generated: `scripts/heighten-tree-parity.mjs --write — card step 17. reprintDrift: spells whose Archives page is a newer printing than the text the string lane was imported from; the page wins (they draw the tree), and this lists, for the rebuild lane, the heightening entries the string had that the page no longer prints (stringOnly) and the engine's heightening fields in public/core.json that now disagree with print (engineDisagrees). engineDrift: tree-lane spells whose engine heightens at an interval the page does not print (the page prints another "(+N)", or only "(Nth)" entries that grant fewer steps). On both, per the orchestrator's round-3 ruling (src/sheet/spellCard.ts arrowAt): displaySuppressed = the cast ranks at which the popup withholds the damage arrow / area suffix the engine computes, because no printed Heightened entry of the page the player reads backs it; displayFromPrint = rank -> [the value the popup draws, counted by the page's own entries; the engine's value]. notOwnPage: spell records whose tree is a page of another category (they are printed inside it); the popup keeps the string with an ours footer "Printed inside <title> — text from our older import" until the spells surface draws page slices. The engine's numbers are NOT changed by step 17 (mechanics out of scope)`,
    reprintDrift: reprintDrift.map(withDisplay),
    engineDrift: engineDrift.map(withDisplay),
    notOwnPage,
  };
  writeFileSync(join(ROOT, DRIFT), JSON.stringify(driftOut, null, 1) + '\n');
  console.log(`heighten tree parity: wrote ${FILE}: ${gate.stringLane.length} on the string lane, ${gate.reprintDrift.length} reprint drift; wrote ${DRIFT}: ${reprintDrift.length} reprint drift, ${engineDrift.length} engine drift, ${display.size} with the arrow withheld or re-counted, ${notOwnPage.length} printed inside another page.`);
  if (displayUnlisted.length) {
    console.log(`heighten tree parity: ${displayUnlisted.length} spells withhold or re-count an arrow without a drift entry: ${displayUnlisted.join(', ')}`);
    process.exitCode = 1;
  }
} else {
  const same = JSON.stringify({ ...laneOut, _generated: '' }) === JSON.stringify({ ...file, _generated: '' });
  console.log(`heighten tree parity: the file lists ${file.ids?.length ?? 0} on the string lane and ${Object.keys(file.reprints ?? {}).length} reprints; ${problems.length} problems; the file ${same ? 'equals' : 'DIFFERS FROM'} the gate's output.`);
  for (const p of problems.slice(0, 60)) console.log(`   ${p}`);
  if (problems.length > 60) console.log(`   … and ${problems.length - 60} more`);
  const driftFile = JSON.parse(readFileSync(join(ROOT, DRIFT), 'utf8'));
  const displayOf = (list) => Object.fromEntries((list ?? []).map((e) => [e.id, [e.displaySuppressed, e.displayFromPrint]]));
  const want = displayOf([...reprintDrift.map(withDisplay), ...engineDrift.map(withDisplay)]);
  const have = displayOf([...(driftFile.reprintDrift ?? []), ...(driftFile.engineDrift ?? [])]);
  const driftSame = JSON.stringify(want) === JSON.stringify(have) && JSON.stringify(driftFile.notOwnPage ?? []) === JSON.stringify(notOwnPage);
  console.log(`heighten tree parity: the drift file's displaySuppressed / displayFromPrint / notOwnPage ${driftSame ? 'equal' : 'DIFFER FROM'} the rule's output; ${displayUnlisted.length} withheld without a drift entry.`);
  if (argv.includes('--check') && (problems.length || !same || !driftSame || displayUnlisted.length)) process.exitCode = 1;
}
