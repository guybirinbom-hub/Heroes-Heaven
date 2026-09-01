/*
 * DOES OUR `actionCost` AGREE WITH AoN'S OWN ACTION BADGE?
 *
 * AoN's display tree states the answer outright. A record that IS an action carries
 * `{"t":"actions","string":"Single Action"}` in its title; one that is not carries a bare
 * `{"t":"actions"}` with no string. That is the publisher's own statement, and it is sharper than
 * anything inferred from prose.
 *
 * The mismatch that prompted this: Mercy and Cruelty are stored as 1-action feats. Both are Remaster
 * rewrites whose text is *"You can cast <spell> … using 2 actions instead of 1"* — the extra action is
 * spent on the SPELL, and the feat itself costs nothing. Their LEGACY printings were single-action
 * metamagics, which is where the 1 came from. AoN's badge says bare `actions` for both.
 *
 * ⚠ ONLY ONE DIRECTION IS EVIDENCE, and this is the whole reason to read this header.
 *
 * `string: "Single Action"` is AoN stating a cost. A BARE `{"t":"actions"}` is not AoN stating the
 * absence of one — it is equally what a page looks like when the scrape lost the glyph. Measured: the
 * bare-node direction produced 100 "findings", and spot-reading four of them killed it — `spell-parry`
 * carries a *Requirements* line (activities have those; passive feats do not), and so do others. The
 * archive is known to hold ~829 docs with damaged markup, and this is what that damage looks like from
 * here. Reporting those 100 would have been reporting a scraper defect as a data defect.
 *
 * So this reports the sound direction only:
 *   · WE SAY NONE, AoN SAYS ACTION — an action a player can never find on their turn (the defect
 *     test/action-costs.test.ts was written for; 58 records had it).
 *
 * For the opposite question — "is this stored as an action when it is really passive?" — the printed
 * TEXT is the instrument, not the badge. Mercy and Cruelty were settled that way: both are Remaster
 * rewrites reading *"You can cast <spell> … using 2 actions instead of 1"*, so the extra action is
 * spent on the spell and the feat costs nothing. Their LEGACY printings were single-action metamagics,
 * which is where our 1 came from.
 *
 *   node scripts/actioncost-vs-aon.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wgOwnsComparison } from './lib/wg-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));

const core = read('public/core.json');
const index = read('public/ast-index.json');

/*
 * Records the app HIDES cannot be experienced by a player, so an instrument must not report on them.
 * `wgOwnsComparison` below covers the `aon-` prefix mechanism; `NEAR_DUPLICATE_IDS` is a second one —
 * a curated list of records that are the same thing as a visible sibling under a name too different
 * for the automatic rules to pair. It lives in TypeScript and is applied at load, so it is read from
 * the source text here rather than from core.json, which does not carry it.
 */
const hiddenDuplicates = new Set();
{
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/data/index.ts'), 'utf8'); } catch { text = ''; }
  const start = text.indexOf('NEAR_DUPLICATE_IDS = new Set([');
  if (start >= 0) {
    const body = text.slice(start, text.indexOf('])', start));
    for (const m of body.matchAll(/^\s*'([^']+)',/gm)) hiddenDuplicates.add(m[1]);
  }
}

/* Bucket files are large and shared by thousands of slugs — parsed once each, not once per record.
 * Without this the script re-read and re-parsed the same megabytes ~10,000 times and did not finish. */
const bucketCache = new Map();
const bucketTree = (bucket) => {
  if (!bucketCache.has(bucket)) {
    let tree;
    try { tree = read(`public/ast/${bucket}.json`); } catch { tree = null; }
    bucketCache.set(bucket, tree);
  }
  return bucketCache.get(bucket);
};

/** The title's `actions` node, if the tree has one: `{t:'actions', string?:'Single Action'}`. */
function aonActionNode(slug) {
  const bucket = index[slug];
  if (!bucket) return undefined;
  const tree = bucketTree(bucket);
  if (!tree) return undefined;
  const doc = tree[slug];
  if (!doc) return undefined;
  const title = (doc.c ?? []).find((n) => n?.t === 'title');
  /*
   * ⚠ IS THIS EVEN OUR RECORD'S PAGE? The index is keyed by SLUG, so a name collision silently pairs
   * us with someone else's document and every difference then reads as a defect. `classFeatures/shield`
   * — the thaumaturge implement — landed on the SHIELD CANTRIP's page, whose badge says "Cantrip 1"
   * and which is of course a Single Action. The badge names what the page IS, so it also says when the
   * page is not ours: a feat or class feature is never a cantrip, a spell, an item or a creature.
   */
  const right = String(title?.right ?? '');
  if (/^(Cantrip|Spell|Focus|Item|Creature|Weapon|Armor|Rune)\b/i.test(right)) return undefined;
  return (title?.c ?? []).find((n) => n?.t === 'actions');
}

const STRING_TO_COST = {
  'single action': 1,
  'two actions': 2,
  'three actions': 3,
  'reaction': 'reaction',
  'free action': 'free',
};

const weSayAction = [];
const weSayNone = [];
let checked = 0;

for (const [bucket, recs] of Object.entries(core)) {
  if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
  if (!['feats', 'classFeatures', 'actions'].includes(bucket)) continue;
  for (const [id, rec] of Object.entries(recs)) {
    /* The same two sibling rules the parity comparers use: an `actions` record whose feat or class
     * feature shares its id defers to that sibling, and an `aon-` twin defers to the canonical record
     * of the same name — the twin is suppressed in the app and carries nothing by design. Ten of
     * these turned up here as "missing an action cost" on records no player can reach. */
    if (!wgOwnsComparison(core, bucket, id)) continue;
    if (hiddenDuplicates.has(id)) continue;
    const node = aonActionNode(id);
    if (!node) continue; // no tree, or a page whose title states nothing — no evidence either way
    checked++;
    const theirs = node.string ? STRING_TO_COST[String(node.string).toLowerCase()] ?? null : 'none';
    if (theirs === null) continue; // a wording this script has not been taught; not a finding
    const ours = rec.actionCost
      ? rec.actionCost.type === 'actions'
        ? rec.actionCost.value
        : rec.actionCost.type
      : 'none';
    const oursIsNone = ours === 'none' || ours === 'passive';

    /*
     * ⚠ THE STRUCTURAL DIFFERENCE THAT INFLATES BOTH LISTS, filtered out before anything is called a
     * defect. AoN puts a feature and the action it grants on ONE page. We split them: `classFeatures/
     * rage` is the passive record that grants `actions/rage`, and the action carries the cost. So:
     *
     *   · a record with no cost of its own is NOT missing one when a sibling record it grants holds
     *     it — `rage`, `shield-block`, `reactive-strike`, `hunt-prey` all read as gaps otherwise;
     *   · a record that carries a cost matching an action it grants is describing that action, which
     *     is how the dedications (`soulforger-dedication`, `beast-gunner-dedication`, …) turn up in
     *     the opposite list.
     *
     * Raw, the two lists came to 245. That number is a claim about our SCHEMA, not about the data.
     */
    const grantedIds = [...(rec.grantsActions ?? []), id];
    const grantedCosts = grantedIds.flatMap((g) =>
      /* The sibling may be an ACTION record or a FEAT: `classFeatures/shield-block` prints *"You gain
       * the Shield Block general feat, a reaction…"*, so the reaction is `feats/shield-block` and the
       * class feature is correctly passive. Looking in `actions` alone reported it as a gap. */
      [core.actions?.[g], g === id ? undefined : core.feats?.[g], bucket !== 'feats' ? core.feats?.[g] : undefined]
        .map((r) => r?.actionCost)
        .filter(Boolean)
        .map((a) => (a.type === 'actions' ? a.value : a.type))
        .filter((v) => v !== 'passive'),
    );
    const sameAs = (v) => grantedCosts.some((g) => g !== undefined && g === v);

    if (theirs === 'none' && !oursIsNone) {
      /* Kept only as context — see the header. A bare badge is not evidence of a missing cost. */
      if (!sameAs(ours)) weSayAction.push(`${bucket}/${id}  ours=${ours}`);
    } else if (theirs !== 'none' && oursIsNone) {
      if (!grantedCosts.some((g) => g !== undefined)) weSayNone.push(`${bucket}/${id}  AoN=${node.string}`);
    }
  }
}

console.log(`checked ${checked} record(s) whose AoN page carries an action badge.\n`);
console.log(`WE SAY NONE, AoN SAYS ACTION — ${weSayNone.length}   <- the work list`);
for (const l of weSayNone) console.log(`   ${l}`);
console.log(
  `\n(${weSayAction.length} record(s) carry a cost where AoN's badge is bare. NOT a work list: a bare` +
    `\n badge is also what a page looks like when the scrape lost the glyph — see the header.)`,
);

/* A guard, not a report — it runs in `npm run verify` and must fail the build. The work list was
 * driven to 0; anything that reappears is a record a player cannot find on their turn. */
if (weSayNone.length) process.exit(1);
