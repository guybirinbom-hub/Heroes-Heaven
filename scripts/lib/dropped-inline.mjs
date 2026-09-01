/*
 * THE INLINE VALUES THE UPSTREAM CLEANER DROPPED — FINDING THEM, AND REPAIRING THEM.
 *
 * Foundry writes rules text with inline constructs: `@Damage[15d6]`, `@Template[cone|distance:60]`,
 * `@Check[reflex|basic]`. The cleaner upstream of our AoN export recovers the ones it can parse and
 * DELETES the rest, leaving the sentence around them intact. The result does not read as a broken
 * import; it reads as a rule, just one missing its numbers:
 *
 *     ours     "Each creature in a takes damage, with a save against your spell DC."
 *     Archives "Each creature in a 60-foot cone takes 15d6 damage, with a basic Reflex save …"
 *
 * A player has no way to know the area, the amount, or which save. Agonizing Rebuke surfaced the first
 * one; the sweep found 1,206 affected records, spells worst of all.
 *
 * HOW A REPAIR IS DERIVED SAFELY. Rather than pattern-matching each phrasing, this word-diffs our
 * sentence against its counterpart in the Archives and applies ONLY INSERTIONS — never a deletion,
 * never a substitution. Our links, formatting, action glyphs and any authored correction survive
 * untouched, and the worst case is a repair not made rather than our text overwritten by theirs.
 *
 * Five refusals keep a wrong number from ever being authored, because a confident wrong number is far
 * worse than a visible missing one:
 *   1. ALIGNMENT — a record often prints several damage sentences and only one lost its value, so the
 *      counterpart must be a clear best match on word overlap. Ties are refused.
 *   2. VOCABULARY — an inserted run must carry a digit or be recognisably a template/check phrase, and
 *      must not be AoN's header block ("Range 60 feet Target 1 creature") matched against our body.
 *   3. EDITION — the Archives' text is often the LEGACY printing even where we show the record as
 *      current, so the 1:1 renames are rewritten and alignment damage, which has none, is refused.
 *   4. NO ADJACENT DELETION — an insertion flanked by a deletion is half of a SUBSTITUTION, i.e. the
 *      two sentences genuinely disagree. Only insertions into otherwise-matching text are applied.
 *   5. UNIQUE ANCHOR — the repair is spliced back into our ORIGINAL markup between two anchor words,
 *      and is refused unless that anchor pair occurs exactly once.
 *
 * Both the repair script and the `npm run verify` guard import this, so a hole that the repairer would
 * confidently fill can never be shipped, and the two can never disagree about what counts as one.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT, NO_CLEAN_RENAME, toCurrentTerms } from './edition.mjs';

export const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';

const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\ufeff/, ''));

/** The holes the cleaner leaves. A record is only considered when one of these is visible in our text. */
const HOLES = [
  /\btakes?\s+damage\b/i,
  /\bregains?\s+Hit Points\b/i,
  /\bin an?\s+(?:takes?|must|is|are|you|each|that|,)\b/i,
  /\bwithin an?\s+(?:takes?|must|is|are)\b/i,
  /\bwith an?\s+(?:against|save against|DC)\b/i,
  /\battempts? an?\s+(?:against|save)\b/i,
  /\bmakes? an?\s+against\b/i,
  /* *"must succeed at a save against the higher of your class DC or spell DC"* — the same dropped
   * `@Check`, reached by a different verb. Found in Wild Witch's Armaments while reading batch 15,
   * which the four shapes above walked straight past. */
  /\bsucceeds?\s+at\s+an?\s+(?:save|check|DC)\b/i,
  /* A hole at the END of its clause — *"You disperse vital energy in a . This targets…"* (Heal and
   * Harm's deleted 30-foot emanation, batch 24). Every shape above requires a following WORD, so a
   * hole followed by punctuation was invisible to the prefilter. ⚠ Being visible is not yet being
   * repairable: the sentence splitter's ⟨N⟩ lookahead below matters too — without it the hole merged
   * into the previous clause and aligned against the wrong AoN sentence. heal/harm themselves were
   * repaired as backfill rows; the ~183 remaining records of this shape are an open work item. */
  /\b(?:in|within|into)\s+an?\s+[.,;]/i,
];

const SAFE_WORD = /^(?:\d|basic|reflex|fortitude|will|save|cone|burst|emanation|line|radius|cube|foot|feet|-?f(?:oo|ee)t|persistent|damage|hit|points)/i;
/*
 * A run carrying one of these is not a dropped inline value at all — it is AoN's HEADER block, matched
 * because our description happens to begin where their body does. Splicing "Range 60 feet Target 1
 * living creature" into the middle of a sentence passes a digit test and is still nonsense.
 */
const HEADERISH = /^(?:range|target|targets|area|duration|source|traditions|cast|trigger|requirements?|frequency|prerequisites?|defense|saving|pg\.?|level|price|usage|bulk|access|craft)$/i;
const trusted = (run) =>
  run.length <= 5 &&
  !run.some((w) => HEADERISH.test(w.replace(/[^A-Za-z.]/g, ''))) &&
  (run.some((w) => /\d/.test(w)) || run.every((w) => SAFE_WORD.test(w)));

export const plain = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, ' ').replace(/\s+/g, ' ').trim();

/*
 * Semicolons split too: a battle-form stat block is one grammatical sentence hundreds of words long,
 * which both starves the alignment of signal and squares into an LCS matrix big enough to exhaust the
 * heap. Splitting on `;` cuts it into the clauses that actually correspond one-to-one.
 */
/* ⟨N⟩ opens a sentence too: our stored text renders action glyphs as ⟨1⟩/⟨2⟩/⟨3⟩ blocks ("…restored
 * by 8.\n\n⟨3⟩ (concentrate) You disperse…"), and without it in the lookahead the whole glyph block
 * merged into the previous clause — so a hole there aligned against the wrong AoN sentence and the
 * repair scored below trust (measured on heal/harm, batch 24). */
const sentences = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z“"(*⟨])|(?<=;)\s+/g).filter(Boolean);
const MAX_CELLS = 250_000; // an alignment bigger than this is not a sentence pair worth trusting

const tok = (s) => plain(s).split(/\s+/).filter(Boolean);
const key = (w) => w.toLowerCase().replace(/[^a-z0-9+-]/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const words = (s) => new Set(plain(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);
const overlap = (a, b) => {
  const A = words(a);
  const B = words(b);
  if (!A.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / A.size;
};

/** Word-level LCS, returned as an edit script of {op:'='|'-'|'+', word, ai}. */
const diff = (a, b) => {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = key(a[i]) === key(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (key(a[i]) === key(b[j])) { out.push({ op: '=', word: a[i], ai: i }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: '-', word: a[i], ai: i }); i++; }
    else { out.push({ op: '+', word: b[j], ai: i }); j++; }
  }
  while (i < n) out.push({ op: '-', word: a[i], ai: i++ });
  while (j < m) out.push({ op: '+', word: b[j++], ai: n }); // trailing insertions have no right anchor
  return out;
};

/**
 * Every repair the Archives support confidently, plus every site refused and why.
 * Returns `null` when the mirror is absent, so callers can skip rather than fail on a machine
 * that does not have it.
 */
export const findDroppedInline = (ROOT, { only } = {}) => {
  if (!existsSync(MIRROR)) return null;

  const core = read(join(ROOT, 'public/core.json'));
  const descs = read(join(ROOT, 'public/core-descriptions.json'));

  const byId = new Map();
  for (const cat of readdirSync(MIRROR)) {
    let files = [];
    try { files = readdirSync(join(MIRROR, cat)); } catch { continue; }
    for (const f of files) if (f.endsWith('.json')) byId.set(f.replace(/\.json$/, ''), join(MIRROR, cat, f));
  }
  const textCache = new Map();
  const aonText = (aonId) => {
    if (textCache.has(aonId)) return textCache.get(aonId);
    const p = aonId ? byId.get(aonId) : null;
    let out = '';
    if (p) try { out = String(read(p).text ?? '').replace(/\s+/g, ' ').trim(); } catch { out = ''; }
    if (textCache.size < 4000) textCache.set(aonId, out);
    return out;
  };

  const edits = [];
  const refused = [];
  /* How many records the alignment actually RAN on — the number that says whether a clean sweep was a
   * clean sweep or a filter that quietly excluded everything. */
  let examined = 0;

  for (const bucket of Object.keys(descs)) {
    for (const [id, entry] of Object.entries(descs[bucket] ?? {})) {
      if (only && id !== only) continue;
      const ours = String(entry?.d ?? '');
      /*
       * The HOLES list is a PREFILTER, not the definition of the defect — every shape on it was added
       * because something found it, which means the list is exactly as complete as my imagination.
       * `DROPPED_INLINE_ALL=1` runs the alignment over every record instead, so the sweep can find the
       * phrasings nobody has thought of yet. Slow, and the right way to re-measure the class.
       */
      if (!ours || (!process.env.DROPPED_INLINE_ALL && !HOLES.some((re) => re.test(plain(ours))))) continue;
      const rec = core[bucket]?.[id];
      const theirs = aonText(rec?.aonId);
      if (!theirs) continue;
      examined++;
      const isCurrent = CURRENT.has(String(rec?.edition ?? 'neutral'));
      const theirSents = sentences(theirs);

      let next = ours;
      const sites = [];
      for (const ourSent of sentences(ours)) {
        if (!HOLES.some((re) => re.test(plain(ourSent)))) continue;

        /* 1. ALIGNMENT */
        const scored = theirSents.map((t) => ({ t, score: overlap(ourSent, t) })).sort((a, b) => b.score - a.score);
        if (!scored.length || scored[0].score < 0.6) { refused.push({ where: `${bucket}/${id}`, why: 'no counterpart sentence' }); continue; }
        if (scored[1] && scored[1].score > scored[0].score - 0.1) { refused.push({ where: `${bucket}/${id}`, why: 'ambiguous counterpart' }); continue; }

        const ourTok = tok(ourSent);
        const theirTok = tok(scored[0].t);
        if ((ourTok.length + 1) * (theirTok.length + 1) > MAX_CELLS) { refused.push({ where: `${bucket}/${id}`, why: 'clause too long to align safely' }); continue; }
        const script = diff(ourTok, theirTok);

        /* Group consecutive insertions into runs, each tagged with its neighbouring ops. */
        const runs = [];
        for (let k = 0; k < script.length; k++) {
          if (script[k].op !== '+') continue;
          const start = k;
          while (k + 1 < script.length && script[k + 1].op === '+') k++;
          runs.push({ run: script.slice(start, k + 1).map((e) => e.word), before: script[start - 1], after: script[k + 1] });
        }

        let sent = ourSent;
        for (const r of runs) {
          /* 2. VOCABULARY */
          if (!trusted(r.run)) continue;
          /* 3. EDITION */
          if (isCurrent && r.run.some((w) => NO_CLEAN_RENAME.test(w.replace(/[^A-Za-z]/g, '')))) {
            refused.push({ where: `${bucket}/${id}`, why: 'alignment damage has no 1:1 remaster equivalent', run: r.run.join(' ') });
            continue;
          }
          const run = isCurrent ? toCurrentTerms(r.run) : r.run;
          /* 4. NO ADJACENT DELETION */
          if (r.before?.op === '-' || r.after?.op === '-') { refused.push({ where: `${bucket}/${id}`, why: 'sentences disagree, not a dropped value', run: run.join(' ') }); continue; }
          if (!r.before || !r.after) { refused.push({ where: `${bucket}/${id}`, why: 'no anchor on both sides', run: run.join(' ') }); continue; }

          /*
           * 5. UNIQUE ANCHOR. The middle is deliberately BOUNDED and unambiguous — every alternative
           * consumes at least one character and the run is capped. An earlier ambiguous middle
           * backtracked hard enough on a failed match to exhaust the heap. The lookarounds stop a
           * one-letter anchor like "a" matching inside "damage".
           */
          const anchor = new RegExp(`(?<![A-Za-z0-9])(${esc(r.before.word)})((?:\\s|\\*|_|<[^>]*>){0,24})(${esc(r.after.word)})(?![A-Za-z0-9])`, 'g');
          const hits = sent.match(anchor);
          if (!hits || hits.length !== 1) { refused.push({ where: `${bucket}/${id}`, why: `anchor occurs ${hits?.length ?? 0}×, not once`, run: run.join(' ') }); continue; }
          sent = sent.replace(anchor, `$1 ${run.join(' ')}$2$3`);
          sites.push({ run: run.join(' '), at: `${r.before.word} ▸ ${r.after.word}` });
        }
        if (sent !== ourSent) next = next.replace(ourSent, sent);
      }
      if (next !== ours) edits.push({ category: bucket, id, field: 'description', value: next, was: ours, sites });
    }
  }

  return { edits, refused, examined };
};
