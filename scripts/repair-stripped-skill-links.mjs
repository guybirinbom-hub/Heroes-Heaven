/*
 * THE STRIPPED LINK QUERY STRING, and THE STRIPPED "<N>-foot" AREA — two more classes of value the
 * import deleted, both restored the same way: align our sentence with its counterpart in the Archives
 * and put back ONLY the tokens that went missing, never the mirror's sentence.
 *
 * 1. THE `skill=` ARTEFACT. AoN writes an action reference as a link — `[High Jump](…?skill=acrobatics)`
 *    — and an importer collapsed it to THE SLUG PLUS ITS QUERY STRING. Graceful Leaper (feat-6243)
 *    shipped as
 *
 *        ours  "…when making a high-jump skill=acrobatics or long-jump skill=acrobatics."
 *        AoN   "…when making a High Jump or Long Jump."
 *
 *    The reader is shown a URL fragment where the rule should be. 18 descriptions carry it (graceful
 *    leaper is repaired by hand in this batch), and the same collapse left `traits=` and `dc=` behind
 *    elsewhere — *"(escape show-dc=all dc=28)"* for *"(Escape DC 28)"* (Binding Snare, equipment-1122),
 *    *"the feint traits=arcane,illusion,visual gains"* for *"The Feint gains"* (Distracting Spellstrike).
 *
 * 2. THE "<N>-foot" STRIP. The cleaner took the size AND the noun it qualified, leaving a grammatical
 *    article with nothing after it — *"in a centered on you"* for *"in a 20-foot burst centered on
 *    you"*. 500 descriptions carry it (items 302, feats 136, spells 45, classFeatures 12, actions 4,
 *    familiarAbilities 2). Ratcheted in scripts/dropped-inline-check.mjs.
 *
 * HOW A REPAIR IS DERIVED SAFELY — the same discipline as scripts/repair-stripped-save-dc.mjs:
 *   1. ALIGNMENT — our sentence must have ONE clear counterpart in the mirror document (word overlap
 *      ≥ 0.5, and clear of the runner-up). No counterpart ⇒ no repair.
 *   2. EVIDENCE, NOT INVENTION — the replacement is the text the ALIGNED MIRROR SENTENCE prints, found
 *      by matching the slug's own words in order. Title-casing the slug ourselves would author
 *      "Disable Device" where the game says "Disable a Device"; nothing is written that the Archives
 *      do not print, and the mirror's own capitalisation is what lands.
 *   3. INSERTION / SUBSTITUTION ONLY AT THE ARTEFACT — everything outside the artefact run is copied
 *      character for character, so our links, glyphs and authored corrections survive untouched.
 *   4. NO MARKUP CROSSED — a run overlapping an HTML tag or a `[text](url)` link target is skipped, so
 *      no splice can eat markup, and a query string inside a real URL is never mistaken for the defect.
 *   5. NOT SOMEBODY ELSE'S ROW — every id already carried by work/.b029-rows.json or
 *      work/.b029-rows-dc.json is skipped, and so is every record scripts/lib/dropped-inline.mjs
 *      repairs confidently: two rows for one description would race, and the applier refuses collisions.
 *
 * Nothing here writes core-descriptions.json or effect-backfill.json: it emits a SPEC of description
 * overlay rows and the orchestrator applies them.
 *
 *   node scripts/repair-stripped-skill-links.mjs            # report only
 *   node scripts/repair-stripped-skill-links.mjs --write     # …and write work/.b029-rows-skill.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MIRROR, plain, mirrorIndex, dashFold } from './repair-stripped-save-dc.mjs';
import { sentences, findDroppedInline } from './lib/dropped-inline.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\ufeff/, ''));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '[\\s*_]+';

/* ── ALIGNMENT ──────────────────────────────────────────────────────────────────────────────── */

const words = (s) => new Set(plain(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a, b) => {
  const A = words(a);
  const B = words(b);
  if (!A.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / A.size;
};

/** The mirror sentence that is unambiguously the counterpart of `ourSent`, or null. */
export const counterpart = (ourSent, theirSents) => {
  const scored = theirSents.map((t) => ({ t, score: overlap(ourSent, t) })).sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 0.5) return null;
  if (scored[1] && scored[1].score > scored[0].score - 0.05) return null;
  return scored[0].t;
};

/* ── 1. THE QUERY-STRING ARTEFACT ───────────────────────────────────────────────────────────── */

/*
 * A slug word followed by one or more `key=value` parameters. The slug must lead: every occurrence
 * measured has one ("escape show-dc=all dc=28", "aid skill=occultism traits=auditory,linguistic"), and
 * without that requirement the pattern would also match the query string of a genuine URL.
 *
 * ⚠ A comma may only appear BETWEEN values ("traits=auditory,linguistic"). Letting the value class end
 * on one swallows OUR sentence's comma — *"track skill=religion, or track skill=survival"* — and the
 * repair then deletes the punctuation along with the artefact.
 *
 * The parameter name is deliberately open: `skill=` is the shape the finding named, and the same
 * collapse also left `traits=`, `dc=`, `show-dc=`, `statistic=`, `options=` and `variant=` behind
 * (46 descriptions in total, against the 18 a `skill=` grep finds).
 */
const VALUE = "[A-Za-z0-9_'-]+(?:,[A-Za-z0-9_'-]+)*";
const ART_SRC = `(?<![A-Za-z0-9-])([a-z][a-z0-9]*(?:-[a-z0-9]+)*)((?:[ \\t]+[a-z][a-z-]*=${VALUE})+)`;
export const ARTEFACT = new RegExp(ART_SRC, 'g');
export const hasArtefact = (s) => new RegExp(ART_SRC).test(s);

/* Small words the slug drops but the printed name keeps: "disable-device" is *Disable a Device*,
 * "make-an-impression" is *Make an Impression*. At most one between consecutive slug words. */
const FILLER = '(?:\\s+(?:a|an|the|of|to))?';

const wordBefore = (s, i) => (String(s).slice(0, i).match(/([A-Za-z0-9]+)[^A-Za-z0-9]*$/) ?? [])[1] ?? '';
const wordAfter = (s, i) => (String(s).slice(i).match(/^[^A-Za-z0-9]*([A-Za-z0-9]+)/) ?? [])[1] ?? '';
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * The text the mirror sentence prints AT THIS POSITION for this slug (plus its DC, when the artefact
 * carries one). Returns null when the sentence does not print it there — a slug we cannot evidence in
 * place is left visible, because a URL fragment on the page is better than the wrong rule.
 *
 * ⚠ PRESENCE IN THE SENTENCE IS NOT EVIDENCE — the name has to be in the SAME PLACE. Hellbreaker
 * Dedication (feat-8534) is the proof: our text is *"you can attempt a recall-knowledge
 * skill=devil-lore, … check"*, the mirror sentence is *"you can attempt a Devil Lore, Hellknight Lore,
 * or Society check to Recall Knowledge about one enemy"* — the link text is the SKILL name, and the
 * "Recall Knowledge" a presence test happily finds belongs to the tail of the sentence. Anchoring on
 * the words either side ("a …" vs "to …") refuses it instead of authoring the wrong action three times.
 *
 * @param prev / @param next  the words either side of the artefact in OUR text
 */
export const printedLink = (slug, dc, mirrorSentence, prev, next) => {
  const parts = slug.split('-').filter(Boolean);
  if (!parts.length) return null;
  const body = parts.map(esc).join(`${FILLER}\\s+`);
  /* Case-INSENSITIVE search, capitalisation-SENSITIVE acceptance: the slug is lowercase and the
   * printed name is not, so matching must ignore case — but an action name is a proper noun in AoN's
   * text, so a lowercase hit is the same word used as prose ("attempt to escape the grab"), not the
   * link text, and is not evidence. */
  const re = new RegExp(`(?<![A-Za-z])${body}${dc ? `\\s+DC\\s+${esc(dc)}` : ''}(?![A-Za-z])`, 'gi');
  let hits = [...String(mirrorSentence).matchAll(re)].filter((m) => /^[A-Z]/.test(m[0]));
  hits = hits.filter((m) => same(wordBefore(mirrorSentence, m.index), prev));
  /* Two candidates with the same left anchor — Impressive Performance prints "you can Make an
   * Impression using…" and "you can Make an Impression targeting…" — are separated on the right. */
  if (hits.length > 1) hits = hits.filter((m) => same(wordAfter(mirrorSentence, m.index + m[0].length), next));
  return hits.length === 1 ? hits[0][0].replace(/\s+/g, ' ') : null;
};

/** Character ranges a splice must never touch: HTML tags and `[text](url)` link targets. */
const markupRanges = (raw) => {
  const out = [];
  for (const re of [/<[^>]*>/g, /\]\([^)]*\)/g]) for (const m of raw.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
};

/*
 * The clause an artefact sits in — what gets aligned against the mirror. It breaks on `;` and on a
 * line end as well as on `.!?`, matching the shared splitter in scripts/lib/dropped-inline.mjs: AoN's
 * own sentences are split there too, so a clause that runs past a semicolon has no counterpart of the
 * same size and the overlap score collapses (measured on Distracting Toss, feat-6157, whose "…and
 * Feint against it; you can attempt this Feint even if…" is two mirror sentences and was one of ours).
 */
const clauseAround = (raw, i) => {
  const before = raw.slice(0, i).search(/[.!?;\n][^.!?;\n]*$/);
  const after = raw.slice(i).search(/[.!?;\n]/);
  return raw.slice(before < 0 ? 0 : before + 1, after < 0 ? raw.length : i + after + 1);
};

/**
 * Restore the printed link text over every query-string artefact in `raw`.
 *
 * @param raw    our description, markup and all
 * @param mirror the aligned Archives sentence — the only source of replacement text. Pass the ARRAY of
 *               the mirror document's sentences instead and each artefact is aligned against its own
 *               clause, so a record printing several rules cannot borrow another rule's link text.
 * @returns {{ next: string, sites: {was: string, now: string}[], refused: string[] }}
 */
export const repairArtefacts = (raw, mirror) => {
  const sites = [];
  const refused = [];
  const mirrorFor = (i) => (Array.isArray(mirror) ? counterpart(clauseAround(raw, i), mirror) : mirror);

  /*
   * A DANGLING TAIL first: Expert Disassembly (feat-6408) ends *"…to Disable a Device or Pick a Lock.
   * pick-a-lock skill=crafting disable-device skill=crafting"* — the sentence is already complete and
   * correct, and the artefacts are the collapsed links appended after it. Replacing them would print
   * the two action names twice; the repair is to DELETE the tail. Only a tail made of nothing but
   * artefacts, after a full stop, at the very end of the description, qualifies.
   */
  let next = raw.replace(
    new RegExp(`(?<=[.!?])(?:\\s*${ART_SRC})+\\s*$`),
    (whole) => { sites.push({ was: whole.replace(/\s+/g, ' ').trim(), now: '(deleted — the sentence before it already prints these names)' }); return ''; },
  );

  const banned = markupRanges(next);
  const hits = [...next.matchAll(ARTEFACT)];
  /* Right to left, so an earlier match's offsets stay valid after a later one is spliced. */
  for (const m of hits.reverse()) {
    if (banned.some(([a, b]) => m.index < b && m.index + m[0].length > a)) { refused.push(`${m[0]} — inside markup`); continue; }
    const params = new Map([...m[2].matchAll(new RegExp(`([a-z][a-z-]*)=(${VALUE})`, 'g'))].map((p) => [p[1], p[2]]));
    const dc = params.get('dc') ?? null;
    const mirrorSentence = mirrorFor(m.index);
    if (!mirrorSentence) { refused.push(`${m[0]} — no unambiguous counterpart sentence`); continue; }
    /* The anchors come from the ORIGINAL text: right-to-left splicing leaves offsets left of the
     * cursor untouched, and reading them off `next` would let a name this pass just inserted stand in
     * as evidence for the one before it. */
    const text = printedLink(m[1], dc, mirrorSentence, wordBefore(raw, m.index), wordAfter(raw, m.index + m[0].length));
    if (!text) { refused.push(`${m[0]} — the aligned sentence does not print it in this position`); continue; }
    next = next.slice(0, m.index) + text + next.slice(m.index + m[0].length);
    sites.push({ was: m[0], now: text });
  }
  sites.reverse();
  return { next, sites, refused };
};

/* ── 2. THE "<N>-foot" AREA ─────────────────────────────────────────────────────────────────── */

const norm = (w) => dashFold(String(w)).toLowerCase().replace(/[^a-z0-9-]/g, '');

/**
 * Put the mirror's "<N>-foot <noun>" back where our text has the bare article.
 *
 * @param raw   our description, markup and all
 * @param ctx   the three mirror words before the size, e.g. ["ground","in","a"]
 * @param tail  the mirror tokens from the size onward, e.g. ["20-foot","burst","surrounding","the"]
 * @returns {{ next: string, inserted: string } | { skip: string } | { refuse: string }}
 */
export const restoreFootRun = (raw, ctx, tail) => {
  if (ctx.length < 3 || !tail.length || !/^\d+-foot$/i.test(norm(tail[0]))) return { refuse: 'not a size token' };
  const re = new RegExp(`(?<![A-Za-z0-9])${ctx.map(esc).join(SEP)}(?![A-Za-z0-9])`, 'g');
  const hits = [...raw.matchAll(re)];
  if (hits.length !== 1) return { refuse: `context "${ctx.join(' ')}" occurs ${hits.length}×, not once` };

  const end = hits[0].index + hits[0][0].length;
  const after = raw.slice(end);
  const lead = after.match(/^\s*/)[0];
  const rest = after.slice(lead.length);

  /* Where does the mirror's run stop? At the first of our own surviving words. Punctuation-only
   * tokens carry no signal, so the search looks past at most one of them ("a , and for 1 round"). */
  const ourNext = rest.split(/\s+/).filter(Boolean).slice(0, 2).map(norm).find(Boolean);
  if (!ourNext) return { refuse: 'nothing of ours survives after the article to stop the run at' };
  const k = tail.slice(0, 4).findIndex((t) => norm(t) === ourNext);
  if (k < 0) return { refuse: `no unambiguous stopping point — "${ourNext}" is not in "${tail.slice(0, 4).join(' ')}"` };
  if (k === 0) return { skip: 'already carries the printed size' };

  /* Drop the punctuation the mirror attached to the last token — ours already has its own. */
  const run = tail.slice(0, k).map((t, i) => (i === k - 1 ? t.replace(/[.,;:)]+$/, '') : t));
  if (run.some((t) => !norm(t))) return { refuse: 'run contains a punctuation-only token' };

  const glue = /^[,.;:)]/.test(rest) ? '' : lead || ' ';
  return { next: `${raw.slice(0, end)} ${run.join(' ')}${glue}${rest}`, inserted: run.join(' ') };
};

/* ── THE SWEEP ──────────────────────────────────────────────────────────────────────────────── */

/** Ids already carried by another agent's rows this batch — a second row would race with theirs. */
const claimedIds = () => {
  const out = new Set();
  for (const f of ['work/.b029-rows.json', 'work/.b029-rows-dc.json']) {
    const p = join(ROOT, f);
    if (!existsSync(p)) continue;
    for (const finding of read(p).findings ?? []) for (const r of finding.backfillRows ?? []) if (r?.id) out.add(r.id);
  }
  return out;
};

const FOOT = /\b\d+-foot\b/g;

export const sweep = () => {
  if (!existsSync(MIRROR)) return null;
  const core = read(join(ROOT, 'public/core.json'));
  const descs = read(join(ROOT, 'public/core-descriptions.json'));
  const byId = mirrorIndex();

  const skip = claimedIds();
  /* scripts/lib/dropped-inline.mjs already repairs 25 of the "<N>-foot" holes through its own
   * insertion-only alignment (its HOLES prefilter gained the shape in this batch). Those records are
   * its rows to author, not ours. */
  const lib = findDroppedInline(ROOT);
  for (const e of lib?.edits ?? []) skip.add(e.id);

  const artefacts = { edits: [], refused: [], seen: 0 };
  const feet = { edits: [], refused: [], seen: 0 };

  for (const [bucket, recs] of Object.entries(descs)) {
    for (const [id, entry] of Object.entries(recs ?? {})) {
      const raw = String(entry?.d ?? '');
      if (!raw) continue;
      const artefactHere = hasArtefact(raw);
      const file = core[bucket]?.[id]?.aonId ? byId.get(core[bucket][id].aonId) : null;
      if (!file) continue;
      let doc = null;
      try { doc = read(file); } catch { continue; }
      const theirs = plain(doc.text);
      if (!theirs) continue;
      const theirSents = sentences(theirs);

      if (artefactHere) {
        artefacts.seen++;
        if (skip.has(id)) artefacts.refused.push({ where: `${bucket}/${id}`, why: 'another row this batch already claims this record' });
        else {
          const r = repairArtefacts(raw, theirSents);
          for (const why of r.refused) artefacts.refused.push({ where: `${bucket}/${id}`, why });
          if (r.next !== raw) artefacts.edits.push({ category: bucket, id, field: 'description', value: r.next, sites: r.sites });
        }
      }

      /* The foot pass anchors on the MIRROR's own context, so it needs no hole prefilter of ours. */
      const theirTok = theirs.split(/\s+/).filter(Boolean);
      const footAt = theirTok.map((t, i) => (FOOT.test(t) ? ((FOOT.lastIndex = 0), i) : -1)).filter((i) => i >= 0);
      if (!footAt.length) continue;
      feet.seen++;
      if (skip.has(id)) continue;
      let next = raw;
      const done = [];
      for (const i of footAt) {
        if (i < 3) continue;
        const r = restoreFootRun(next, theirTok.slice(i - 3, i), theirTok.slice(i, i + 6));
        if (r.skip) continue;
        if (r.refuse) { feet.refused.push({ where: `${bucket}/${id}`, why: r.refuse }); continue; }
        next = r.next;
        done.push({ at: theirTok.slice(i - 3, i).join(' '), run: r.inserted });
      }
      if (next !== raw) feet.edits.push({ category: bucket, id, field: 'description', value: next, sites: done });
    }
  }
  return { artefacts, feet, libEdits: lib?.edits.length ?? 0 };
};

/* Run as a script, not when imported by the test (Windows: argv[1] is a `C:\…` path). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const found = sweep();
  if (!found) { console.log(`stripped-skill-links: SKIPPED — no AoN mirror at ${MIRROR}`); process.exit(0); }
  const { artefacts, feet, libEdits } = found;

  const per = (edits) => {
    const b = {};
    for (const e of edits) b[e.category] = (b[e.category] ?? 0) + 1;
    return Object.entries(b).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
  };

  console.log(`query-string artefacts: ${artefacts.seen} description(s) carry one; ${artefacts.edits.length} repairable, ${artefacts.refused.length} site(s) refused.`);
  console.log(`   per bucket: ${per(artefacts.edits)}`);
  for (const e of artefacts.edits) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(38)} "${s.was}" → "${s.now}"`);
  console.log(`   refused:`);
  for (const r of artefacts.refused) console.log(`   ${r.where.padEnd(38)} ${r.why}`);

  console.log(`\n"<N>-foot" areas: ${feet.seen} description(s) whose mirror prints one; ${feet.edits.length} repairable, ${feet.refused.length} site(s) refused (${libEdits} record(s) left to scripts/repair-dropped-inline.mjs).`);
  console.log(`   per bucket: ${per(feet.edits)}`);
  for (const e of feet.edits.slice(0, 30)) for (const s of e.sites) console.log(`   ${(e.category + '/' + e.id).padEnd(38)} ${s.at} ▸ [+ ${s.run}]`);
  if (feet.edits.length > 30) console.log(`   …and ${feet.edits.length - 30} more record(s)`);
  const why = new Map();
  for (const r of feet.refused) { const k = r.why.replace(/"[^"]*"/g, '"…"').replace(/\d+×/, 'N×'); why.set(k, (why.get(k) ?? 0) + 1); }
  console.log(`   refused:`);
  for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(5)}  ${k}`);

  if (process.argv.includes('--write')) {
    const spec = {
      findings: [
        {
          id: 'stripped-skill-links',
          backfillRows: artefacts.edits.map((e) => ({
            category: e.category,
            id: e.id,
            field: 'description',
            value: e.value,
            why: `An importer collapsed AoN's action links to their slug plus query string, so this description printed "${e.sites[0].was}" where the Archives print "${e.sites[0].now}" (finding graceful-leaper; restored by scripts/repair-stripped-skill-links.mjs from the aligned mirror sentence, artefact spans only).`,
          })),
          note: `${artefacts.edits.length} description(s) had a collapsed link ("<slug> skill=…/traits=…/dc=…") replaced with the text the aligned Archives sentence prints; ${artefacts.refused.length} site(s) refused. graceful-leaper is repaired by hand elsewhere in this batch.`,
        },
        {
          id: 'stripped-foot-areas',
          backfillRows: feet.edits.map((e) => ({
            category: e.category,
            id: e.id,
            field: 'description',
            value: e.value,
            why: `The import deleted the area size and its noun, so the rule read "${e.sites[0].at} …" with nothing after the article; AoN prints "${e.sites[0].at} ${e.sites[0].run}" (restored by scripts/repair-stripped-skill-links.mjs, insertion only).`,
          })),
          note: `${feet.edits.length} description(s) regained a "<N>-foot <noun>" area the import deleted; the rest of the ratcheted class in scripts/dropped-inline-check.mjs could not be anchored unambiguously (see the script's refusal table).`,
        },
      ],
    };
    writeFileSync(join(ROOT, 'work/.b029-rows-skill.json'), JSON.stringify(spec, null, 2));
    console.log(`\nwrote work/.b029-rows-skill.json (${artefacts.edits.length} + ${feet.edits.length} row(s))`);
  } else {
    console.log('\n(dry run — pass --write to emit work/.b029-rows-skill.json; the orchestrator applies the rows)');
  }
}
