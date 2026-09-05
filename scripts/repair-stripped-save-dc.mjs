/*
 * THE STRIPPED SAVE DC — a third class of value the upstream cleaner deleted.
 *
 * AoN prints *"Each creature must attempt a DC 25 Will save."* (equipment-513, Unmemorable Mantle).
 * We ship *"Each creature must attempt a save."* — no DC, no save type, so the player has nothing to
 * roll against and no way to know the number ever existed. Same `@Check[will|dc:25]` cleaner as the
 * `@Damage` holes, a different survivor: here the DELETION LEAVES A GRAMMATICAL SENTENCE, which is
 * why the sweep in scripts/lib/dropped-inline.mjs walked past it — 109 item descriptions carry it.
 *
 * WHY NOT JUST WIDEN scripts/lib/dropped-inline.mjs? Its HOLES prefilter already lists
 * `attempts? an? save`, and it still found nothing here: its sentence splitter did not break before
 * the `---` rule that item descriptions use, so the mantle's hole sentence swallowed the whole degrees
 * block and aligned against the WRONG mirror sentence (measured: 0.75 against "Critical Success …",
 * 0.31 against the real counterpart). ⚠ THAT SPLITTER IS NOW FIXED (batch 29 follow-up: the lib splits
 * before `---`), and the fix made 66 more records repairable through the lib's own alignment — but the
 * two passes still see different things, because this one is driven by what the ARCHIVES print
 * (`DC \d+ … save`) rather than by a hole shape in OUR text, and it carries the rung refusal below
 * that the lib has no notion of. Keep both; they disagree in useful directions.
 *
 * HOW A REPAIR IS DERIVED SAFELY — the same discipline as the dropped-inline lib, locally:
 *   1. CONTEXT ANCHOR — the three words before the mirror's "DC" must occur exactly once in our text,
 *      followed within four words by the same save/check word. One occurrence or nothing.
 *   2. SUBSEQUENCE ONLY — what we have between the anchor and "save" must be a strict SUBSEQUENCE of
 *      what the Archives have there. Equal ⇒ already correct, left alone. Anything else ⇒ refused:
 *      the two texts genuinely disagree and a confident wrong DC is worse than a visible missing one.
 *   3. NOT SOMEBODY ELSE'S RUNG — AoN gives every rung of an item family the SAME document, whose
 *      body is the BASE rung's text; a greater rung's own DC appears only in its rung line, and every
 *      house phrases that differently ("the Will save DC is 28", "The DC for the activation is 30",
 *      "the save DC increases to 32", "with a DC of 29"). Worse, the rungs often share ONE aonId
 *      (all four Banners of Creeping Death are equipment-3903, whose text names DC 19/26/32/42), so
 *      the document cannot tell us which rung we are. Any record whose doc names more than one DC is
 *      therefore refused — that is the unmemorable-mantle-greater/major trap, caught by measurement
 *      rather than by the name skiplist below, at the cost of also refusing the BASE rungs, which a
 *      later rung-aware pass can pick up from the refusal list. Two sites sharing a context but
 *      printing different DCs are refused for the same reason: whichever ran first would win.
 *   4. NO MARKUP CROSSED — the span we rewrite must be plain words in the RAW description, so no
 *      link, emphasis or glyph of ours can be eaten by the splice.
 *
 * Nothing here writes core-descriptions.json: it emits a SPEC of description overlay rows and the
 * orchestrator applies them (anything written straight into public/ dies at the next `npm run data`).
 *
 *   node scripts/repair-stripped-save-dc.mjs            # report only
 *   node scripts/repair-stripped-save-dc.mjs --write     # …and write work/.b029-rows-dc.json
 *
 * The count this measures is the baseline of the stripped-save-DC ratchet in
 * scripts/dropped-inline-check.mjs; applying this script's rows drives that baseline to zero.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';

/* The three Unmemorable Mantle rungs are authored by hand elsewhere in this batch (their DCs are
 * 25 / 28 / 38 and only the base rung's number is in the body text) — see finding
 * unmemorable-mantle#save-dc. Refusal 3 would catch the greater and major rungs anyway. */
const HAND_AUTHORED = new Set(['unmemorable-mantle', 'unmemorable-mantle-greater', 'unmemorable-mantle-major']);

const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\ufeff/, ''));

export const plain = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/* What the Archives print where our text has a hole. "basic" rides along with the save type. */
const CHECK = /\bDC (\d+)((?:\s+(?:basic|Fortitude|Reflex|Will|Perception))*)\s+(saves?|saving throws?|checks?)\b/gi;
/* Every number the doc attaches to a DC, however the rung line phrases it (refusal 3). */
const DC_NUMBER = /\bDC\b[^.;]{0,30}?(\d+)/gi;
/* The sibling class, measured here and repaired by scripts/repair-stripped-skill-links.mjs. */
const FOOT = /\b\d+-foot\b/g;
/* ⚠ OUR TEXT DOES NOT ALWAYS USE AN ASCII HYPHEN. Three descriptions print "20‐foot" (U+2010) or
 * "5–foot" (en dash) — perfectly correct text that a raw `includes('20-foot')` calls a hole. The
 * comparison below therefore folds every dash to `-` on BOTH sides; the value written out is never
 * touched. (Measured: airy-step, unfolding-wind-crash, and one other were false positives.) */
export const dashFold = (s) => s.replace(/[‐‑‒–—−]/g, '-');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '[\\s*_]+';

/**
 * Restore the tokens the cleaner deleted from ONE site.
 *
 * @param raw     our description, markup and all
 * @param ctx     the three words preceding the DC in the Archives, e.g. "must attempt a"
 * @param middle  what the Archives have between them and the save word, e.g. "DC 25 Will"
 * @param word    the save word as the Archives write it, e.g. "save"
 * @returns {{ next: string, inserted: string } | { skip: string } | { refuse: string }}
 */
export const repairSite = (raw, ctx, middle, word) => {
  const ctxWords = ctx.split(/\s+/).filter(Boolean);
  if (ctxWords.length < 2) return { refuse: 'context too short to anchor' };
  /* 1. CONTEXT ANCHOR + 4. NO MARKUP CROSSED — the middle may only be plain words. */
  const re = new RegExp(
    `((?<![A-Za-z0-9])${ctxWords.map(esc).join(SEP)}${SEP})((?:[A-Za-z0-9-]+[ \\t]+){0,4})(${esc(word)})(?![A-Za-z0-9])`,
    'gi',
  );
  const hits = [...raw.matchAll(re)];
  if (hits.length !== 1) return { refuse: `anchor occurs ${hits.length}×, not once` };
  const [whole, prefix, ours, saveWord] = hits[0];

  /* 2. SUBSEQUENCE ONLY. */
  const oursTok = ours.split(/\s+/).filter(Boolean);
  const theirsTok = middle.split(/\s+/).filter(Boolean);
  const low = (t) => t.toLowerCase();
  let i = 0;
  for (const t of theirsTok) if (i < oursTok.length && low(oursTok[i]) === low(t)) i++;
  if (i !== oursTok.length) return { refuse: `ours "${ours.trim()}" is not a subsequence of "${middle}"` };
  if (oursTok.length === theirsTok.length) return { skip: 'already carries the printed DC' };

  return {
    next: raw.replace(whole, `${prefix}${theirsTok.join(' ')} ${saveWord}`),
    inserted: theirsTok.join(' '),
    was: oursTok.join(' '),
  };
};

export const mirrorIndex = () => {
  const byId = new Map();
  for (const cat of readdirSync(MIRROR)) {
    let files = [];
    try { files = readdirSync(join(MIRROR, cat)); } catch { continue; }
    for (const f of files) if (f.endsWith('.json')) byId.set(f.slice(0, -5), join(MIRROR, cat, f));
  }
  return byId;
};

/** Every record the Archives let us repair confidently, plus every site refused and why. */
export const findStrippedSaveDc = (root = ROOT) => {
  if (!existsSync(MIRROR)) return null;
  const core = read(join(root, 'public/core.json'));
  const descs = read(join(root, 'public/core-descriptions.json'));
  const byId = mirrorIndex();

  const edits = [];
  const refused = [];
  const footHoles = [];
  let examined = 0;

  for (const [bucket, recs] of Object.entries(descs)) {
    for (const [id, entry] of Object.entries(recs ?? {})) {
      const raw = String(entry?.d ?? '');
      if (!raw) continue;
      const file = core[bucket]?.[id]?.aonId ? byId.get(core[bucket][id].aonId) : null;
      if (!file) continue;
      let doc = null;
      try { doc = read(file); } catch { continue; }
      const theirs = plain(doc.text);
      if (!theirs) continue;

      /*
       * The "<N>-foot" strip the hairpin shows — *"a 10-foot burst"* shipped as *"a burst"*
       * (hairpin-of-blooming-flowers#burst-text, batch 28). MEASURE ONLY in this pass: the same
       * anchor test as a save DC, so a record only counts when our sentence is there and the size
       * token is not — a record-level "mirror says -foot, we never do" count is four times larger
       * and mostly edition drift.
       */
      const ourPlain = plain(raw);
      for (const m of theirs.matchAll(FOOT)) {
        const ctx = theirs.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-3);
        if (ctx.length < 3) continue;
        const hits = [...ourPlain.matchAll(new RegExp(`(?<![A-Za-z0-9])${esc(ctx.join(' '))}\\s+((?:\\S+\\s+){0,6})`, 'gi'))];
        if (hits.length !== 1) continue; // no unique counterpart in our text — says nothing either way
        if (!dashFold(hits[0][1]).includes(m[0])) { footHoles.push(`${bucket}/${id}`); break; }
      }

      const sites = [...theirs.matchAll(CHECK)];
      if (!sites.length) continue;
      examined++;

      if (HAND_AUTHORED.has(id)) { refused.push({ where: `${bucket}/${id}`, why: 'hand-authored in this batch (see unmemorable-mantle#save-dc)' }); continue; }

      /* 3. NOT SOMEBODY ELSE'S RUNG. */
      const dcNumbers = new Set([...theirs.matchAll(DC_NUMBER)].map((m) => m[1]));
      if (dcNumbers.size > 1) {
        refused.push({ where: `${bucket}/${id}`, why: `doc names ${dcNumbers.size} DCs (${[...dcNumbers].join('/')}) — which one is this rung's is not decidable from the doc` });
        continue;
      }
      const contextOf = (m) => theirs.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-3).join(' ');
      const byCtx = new Map();
      for (const m of sites) {
        const k = contextOf(m).toLowerCase();
        if (!byCtx.has(k)) byCtx.set(k, new Set());
        byCtx.get(k).add(m[1]);
      }
      if ([...byCtx.values()].some((s) => s.size > 1)) { refused.push({ where: `${bucket}/${id}`, why: 'two sites share a context but print different DCs' }); continue; }

      let next = raw;
      const done = [];
      for (const m of sites) {
        const ctx = contextOf(m);
        const middle = `DC ${m[1]}${m[2]}`.replace(/\s+/g, ' ').trim();
        const r = repairSite(next, ctx, middle, m[3]);
        if (r.skip) continue;
        if (r.refuse) { refused.push({ where: `${bucket}/${id}`, why: r.refuse, run: middle }); continue; }
        next = r.next;
        done.push({ run: r.inserted, at: `${ctx} ▸ ${m[3]}`, was: r.was });
      }
      if (next !== raw) edits.push({ category: bucket, id, field: 'description', value: next, sites: done });
    }
  }
  return { edits, refused, footHoles, examined };
};

/* Run as a script, not when imported by the test. (Windows: process.argv[1] is a `C:\…` path, so
 * comparing it to import.meta.url needs pathToFileURL, not string surgery.) */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findStrippedSaveDc();
  if (!found) { console.log(`stripped-save-dc: SKIPPED — no AoN mirror at ${MIRROR}`); process.exit(0); }
  const { edits, refused, footHoles, examined } = found;

  const perBucket = {};
  for (const e of edits) perBucket[e.category] = (perBucket[e.category] ?? 0) + 1;
  console.log(`stripped-save-dc: ${examined} record(s) whose Archives text prints a DC; ${edits.length} repairable, ${refused.length} site(s) refused.`);
  console.log(`   per bucket: ${Object.entries(perBucket).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`);
  for (const e of edits.slice(0, 40)) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(40)} ${s.at.replace(' ▸ ', ` [+ ${s.run}] `)}`);
  if (edits.length > 40) console.log(`   …and ${edits.length - 40} more record(s)`);
  console.log(`\n   refused:`);
  for (const r of refused.slice(0, 30)) console.log(`   ${r.where.padEnd(40)} ${r.why}${r.run ? ` (${r.run})` : ''}`);
  if (refused.length > 30) console.log(`   …and ${refused.length - 30} more`);
  console.log(`\nstripped "<N>-foot" area class (measure only, no fix in this pass): ${footHoles.length} description(s) — e.g. ${footHoles.slice(0, 5).join(', ')}`);

  if (process.argv.includes('--write')) {
    const spec = {
      findings: [
        {
          id: 'stripped-save-dc',
          backfillRows: edits.map((e) => ({
            category: e.category,
            id: e.id,
            field: 'description',
            value: e.value,
            why: `AoN prints "${e.sites[0].run} ${e.sites[0].at.split(' ▸ ')[1]}" here and our import dropped it, so the player had no DC to roll against (finding unmemorable-mantle#save-dc; restored by scripts/repair-stripped-save-dc.mjs, insertions only).`,
          })),
          note: `${edits.length} description(s) repaired by insertion of the printed DC/save type; ${refused.length} site(s) refused (see the script's report). The three Unmemorable Mantle rungs are hand-authored by the data agent.`,
        },
      ],
    };
    writeFileSync(join(ROOT, 'work/.b029-rows-dc.json'), JSON.stringify(spec, null, 2));
    console.log(`\nwrote work/.b029-rows-dc.json (${edits.length} row(s))`);
  } else {
    console.log('\n(dry run — pass --write to emit work/.b029-rows-dc.json; the orchestrator applies the rows)');
  }
}
