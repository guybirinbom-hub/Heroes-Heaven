/*
 * THE STRIPPED FLAT-CHECK DC — a ninth class of value the upstream cleaner deleted.
 *
 * AoN prints *"If a reaction would disrupt your spellcasting action, attempt a DC 15 flat check."*
 * (feat-2857, Steady Spellcasting (Magus)). We shipped *"…attempt a check."* — no DC and no "flat",
 * so the player cannot tell what to roll (batch P02 finding steady-spellcasting-magus). Its legacy
 * sibling (feat-4602, Steady Spellcasting) lost the whole run to the stripped-link hole instead:
 * *"…attempt a . If you succeed…"*.
 *
 * WHY scripts/repair-stripped-save-dc.mjs NEVER SAW IT: that pass keys on what the Archives print,
 * `DC <n> [basic|Fortitude|Reflex|Will|Perception]* save|check`, and "flat" is not one of the words
 * it lets sit between the number and "check". So every "DC <n> flat check" in print went unmeasured,
 * and scripts/lib/dropped-inline.mjs's hole prefilter does not list "attempt a check" either. This
 * script is that pass for the flat check, reusing its matcher (repairSite) so the two can never
 * disagree about what counts as a safe insertion.
 *
 * TWO SHAPES, each repaired by INSERTION ONLY (deleting the inserted run gives our text back):
 *   A. THE SURVIVING SENTENCE — "attempt a check" / "attempt a flat check": repairSite's contract.
 *      Context anchor once, what we have between the anchor and "check" a STRICT subsequence of
 *      "DC <n> flat", no markup crossed.
 *   B. THE TERMINAL HOLE — "attempt a ." where the de-linkifier ate the whole run. Repaired only when
 *      the Archives' own sentence ENDS right after "check" (so the "." we kept is theirs too) and the
 *      anchor followed by " ." occurs exactly once in our raw text.
 *
 * REFUSALS (a confident wrong DC is worse than a visible missing one):
 *   - the doc names more than one DC — the same rung trap as the save-DC pass (every rung of an item
 *     family shares one AoN document whose body is the base rung's text);
 *   - two sites share a context but print different DCs;
 *   - the sentence we would repair already carries a "DC <n>" of its own (e.g. "a flat check (DC 11)")
 *     — inserting would print the number twice;
 *   - anything repairSite refuses.
 *
 * Nothing here writes core-descriptions.json or effect-backfill.json: --write emits a SPEC of
 * description overlay rows (work/.bP02-rows-repair.json, see buildSpec) that the orchestrator applies.
 *
 *   node scripts/repair-flat-check-dc.mjs            # report only
 *   node scripts/repair-flat-check-dc.mjs --write     # …and write the spec
 *
 * The count of confident repairs is the FLAT_DC_BASELINE ratchet in scripts/dropped-inline-check.mjs;
 * applying this script's rows drives it to zero.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIRROR, plain, mirrorIndex, repairSite } from './repair-stripped-save-dc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '[\\s*_]+';

/* What the Archives print: "DC 15 flat check". */
const FLAT = /\bDC (\d+) flat (checks?)\b/gi;
/* Every number the doc attaches to a DC (the rung refusal). */
const DC_NUMBER = /\bDC\b[^.;]{0,30}?(\d+)/gi;
/* Cheap prefilter on OUR text: a site can only exist where we still say "check" or kept a hole. */
const MAY_HAVE_SITE = /\bchecks?\b|\b(?:a|an) \.(?=\s|$)/i;

/**
 * Shape B — the terminal hole. `ctx` is the Archives' words before "DC", `run` the whole printed run
 * ("DC 15 flat check"). Only called when the Archives' sentence ends right after the run.
 * @returns {{ next: string, inserted: string } | { refuse: string }}
 */
export const repairTerminalHole = (raw, ctx, run) => {
  const ctxWords = ctx.split(/\s+/).filter(Boolean);
  if (ctxWords.length < 2) return { refuse: 'context too short to anchor' };
  const re = new RegExp(`((?<![A-Za-z0-9])${ctxWords.map(esc).join(SEP)})[ \\t]+\\.(?=\\s|$)`, 'gi');
  const hits = [...raw.matchAll(re)];
  if (hits.length !== 1) return { refuse: `terminal-hole anchor occurs ${hits.length}×, not once` };
  const [whole, prefix] = hits[0];
  return { next: raw.replace(whole, `${prefix} ${run}.`), inserted: run };
};

/** The sentence of `raw` that holds `needle` (case-insensitive), or '' — used for the "already has a DC" refusal. */
const sentenceAround = (raw, needleRe) => {
  const m = needleRe.exec(raw);
  if (!m) return '';
  const start = Math.max(raw.lastIndexOf('. ', m.index), raw.lastIndexOf('\n', m.index)) + 1;
  const endDot = raw.indexOf('.', m.index + m[0].length);
  return raw.slice(start, endDot < 0 ? raw.length : endDot + 1);
};

/**
 * Repair every flat-check site of ONE description against the Archives' plain text.
 * @returns {{ next: string, sites: {run:string, at:string, shape:string}[], refused: {why:string, run?:string}[] }}
 */
export const repairFlatChecks = (raw, theirs) => {
  const refused = [];
  const sites = [];
  const found = [...theirs.matchAll(FLAT)];
  if (!found.length) return { next: raw, sites, refused };

  const dcNumbers = new Set([...theirs.matchAll(DC_NUMBER)].map((m) => m[1]));
  if (dcNumbers.size > 1) {
    refused.push({ why: `doc names ${dcNumbers.size} DCs (${[...dcNumbers].join('/')}) — which one belongs at each site is not decidable from the doc` });
    return { next: raw, sites, refused };
  }
  const contextOf = (m) => theirs.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-3).join(' ');
  const byCtx = new Map();
  for (const m of found) {
    const k = contextOf(m).toLowerCase();
    if (!byCtx.has(k)) byCtx.set(k, new Set());
    byCtx.get(k).add(m[1]);
  }
  if ([...byCtx.values()].some((s) => s.size > 1)) {
    refused.push({ why: 'two sites share a context but print different DCs' });
    return { next: raw, sites, refused };
  }

  let next = raw;
  for (const m of found) {
    const ctx = contextOf(m);
    const run = `DC ${m[1]} flat ${m[2]}`;
    const ctxRe = new RegExp(`(?<![A-Za-z0-9])${ctx.split(/\s+/).map(esc).join(SEP)}`, 'i');
    const here = sentenceAround(next, ctxRe);
    if (new RegExp(`\\bDC\\s*${m[1]}\\b`).test(here)) continue; // already carries it
    if (/\bDC\s*\d+/.test(here)) { refused.push({ why: 'our sentence already prints a different DC', run }); continue; }

    const r = repairSite(next, ctx, `DC ${m[1]} flat`, m[2]);
    if (r.next) { next = r.next; sites.push({ run: r.inserted, at: `${ctx} ▸ ${m[2]}`, shape: 'surviving sentence' }); continue; }
    if (r.skip) continue;

    /* Shape B only when the Archives' sentence ends at the check word. */
    if (theirs.slice(m.index + m[0].length).startsWith('.')) {
      const t = repairTerminalHole(next, ctx, run);
      if (t.next) { next = t.next; sites.push({ run, at: `${ctx} ▸ .`, shape: 'terminal hole' }); continue; }
      refused.push({ why: `${r.refuse}; ${t.refuse}`, run });
      continue;
    }
    refused.push({ why: r.refuse, run });
  }
  return { next, sites, refused };
};

/** Every record the Archives let us repair confidently, plus every site refused and why. */
export const findStrippedFlatDc = (root = ROOT) => {
  if (!existsSync(MIRROR)) return null;
  const core = read(join(root, 'public/core.json'));
  const descs = read(join(root, 'public/core-descriptions.json'));
  const byId = mirrorIndex();
  const edits = [];
  const refused = [];
  let examined = 0;
  for (const [bucket, recs] of Object.entries(descs)) {
    for (const [id, entry] of Object.entries(recs ?? {})) {
      const raw = String(entry?.d ?? '');
      if (!raw || !MAY_HAVE_SITE.test(raw)) continue;
      const aonId = core[bucket]?.[id]?.aonId;
      const file = aonId ? byId.get(aonId) : null;
      if (!file) continue;
      let doc = null;
      try { doc = read(file); } catch { continue; }
      const theirs = plain(doc.text);
      if (!theirs || !/\bflat check/i.test(theirs)) continue;
      examined++;
      const r = repairFlatChecks(raw, theirs);
      for (const f of r.refused) refused.push({ where: `${bucket}/${id}`, ...f });
      if (r.next !== raw) edits.push({ category: bucket, id, field: 'description', value: r.next, was: raw, sites: r.sites, aonId });
    }
  }
  return { edits, refused, examined };
};

export const SPEC_OUT = 'work/.bP02-rows-repair.json';

/**
 * The spec the orchestrator applies. A record that already has a pathless description row in
 * scripts/data/effect-backfill.json gets `supersedes: true` — and its value is repaired FROM THAT ROW'S
 * text, so the superseded prose is carried whole and only the flat-check run is added to it.
 * (apply-parity-fixes.mjs refuses an undeclared replacement; a value derived from the shipped `d`
 * while the overlay says something else would silently drop the older row's edit.)
 */
export const buildSpec = (root = ROOT) => {
  const found = findStrippedFlatDc(root);
  if (!found) return null;
  const bf = read(join(root, 'scripts/data/effect-backfill.json'));
  const overlay = Array.isArray(bf) ? bf : bf.rows ?? [];
  const byId = mirrorIndex();
  const rows = [];
  const skipped = [];
  for (const e of found.edits) {
    const prior = overlay.find((r) => r.category === e.category && r.id === e.id && r.field === 'description' && !('path' in r));
    let value = e.value;
    let sites = e.sites;
    if (prior && prior.value !== e.was) {
      const r = repairFlatChecks(String(prior.value ?? ''), plain(read(byId.get(e.aonId)).text));
      if (r.next === prior.value) { skipped.push(`${e.category}/${e.id}: its overlay row differs from the shipped text and carries no repairable site`); continue; }
      value = r.next;
      sites = r.sites;
    }
    const row = {
      category: e.category,
      id: e.id,
      field: 'description',
      value,
      why: `AoN prints "${sites[0].run}" on ${e.aonId} here and our import dropped it, so the player could not tell what to roll (finding steady-spellcasting-magus; restored by scripts/repair-flat-check-dc.mjs, insertions only).`,
    };
    if (prior) row.supersedes = true;
    rows.push(row);
  }
  return {
    spec: {
      findings: [{
        id: 'steady-spellcasting-magus',
        backfillRows: rows,
        note: `${rows.length} description(s) repaired by INSERTION of the flat-check DC the Archives print (feats/steady-spellcasting-magus, feat-2857, is the finding; the other ${rows.length - 1} are the same stripped-@Check class, measured by the FLAT_DC_BASELINE ratchet in scripts/dropped-inline-check.mjs). ${rows.filter((r) => r.supersedes).length} supersede an existing description row whose text they carry whole. ${found.refused.length} site(s) refused (several DCs in one doc, or no unique anchor) — see the script's report.`,
      }],
    },
    skipped,
  };
};

/* Run as a script, not when imported by the check or the test. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = findStrippedFlatDc();
  if (!found) { console.log(`flat-check-dc: SKIPPED — no AoN mirror at ${MIRROR}`); process.exit(0); }
  const { edits, refused, examined } = found;
  console.log(`flat-check-dc: ${examined} record(s) whose Archives text prints a flat check; ${edits.length} repairable, ${refused.length} site(s) refused.`);
  for (const e of edits) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(40)} ${s.at.replace(' ▸ ', ` [+ ${s.run}] `)}  (${s.shape}, ${e.aonId})`);
  console.log('\n   refused:');
  for (const r of refused.slice(0, 40)) console.log(`   ${r.where.padEnd(40)} ${r.why}${r.run ? ` (${r.run})` : ''}`);
  if (refused.length > 40) console.log(`   …and ${refused.length - 40} more`);

  if (process.argv.includes('--write')) {
    const { spec, skipped } = buildSpec();
    for (const s of skipped) console.log(`   skipped ${s}`);
    writeFileSync(join(ROOT, SPEC_OUT), JSON.stringify(spec, null, 2));
    console.log(`\nwrote ${SPEC_OUT} (${spec.findings[0].backfillRows.length} row(s))`);
  } else {
    console.log('\n(dry run — pass --write to emit the spec; the orchestrator applies the rows)');
  }
}
