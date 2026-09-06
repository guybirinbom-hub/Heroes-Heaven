/*
 * Queue every parity finding that needs the OWNER's ruling into work/owner-questions.json.
 *
 * Two kinds reach here, and both are cases where deciding would break the standing rule — verbatim:
 * *"if you think that the way wg does things is not according to the text then ask me dont make that
 * desion by yourself."*
 *
 *   · verdict ASK-OWNER            — the investigating agent saw the contradiction itself.
 *   · REFUTED with "ASK-OWNER"     — the agent proposed a fix and the adversarial verifier refused it
 *                                    BECAUSE the fix picks a side. Ten of the twelve refutations were
 *                                    this, which is the single clearest argument for the verify stage:
 *                                    left alone, those ten would have quietly settled ten questions
 *                                    that are not mine to settle.
 *
 * The question text is assembled from what the agents actually recorded — printed text, their
 * encoding, ours — rather than re-summarised, so what he rules on is what was found.
 *
 * ⚠ THE DESK NUMBER IS NOT MINTED HERE. This script used to `doc.open.push(...)` a bare entry, so a
 * question queued through it landed with no `n` — and the owner answers by NUMBER, so an unnumbered
 * entry is one he cannot rule on and test/owner-questions-numbering.test.ts fails on it. The append is
 * delegated to `appendQuestions` in scripts/add-owner-question.mjs (docs/wg-batch-pipeline.md §B, "the
 * existing writer — no sixth writer"): n = max over all four arrays ∪ rulings-numbering.json, plus one,
 * and a duplicate id is refused rather than merged.
 *
 *   node scripts/queue-owner-questions.mjs <findings.json> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendQuestions } from './add-owner-question.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const src = process.argv[2];
if (!src || src.startsWith('--')) { console.error('usage: node scripts/queue-owner-questions.mjs <findings.json> [--write]'); process.exit(2); }

const findings = JSON.parse(readFileSync(src, 'utf8'));
const PATH = join(ROOT, 'work/owner-questions.json');
const NUMBERS = join(ROOT, 'work/rulings-numbering.json');
const doc = JSON.parse(readFileSync(PATH, 'utf8'));
const num = JSON.parse(readFileSync(NUMBERS, 'utf8'));
doc.open ??= [];

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/* ⚠ Match the IDEA, not one spelling. A verifier that refuses a fix for settling a WG-vs-print
 * disagreement writes it several ways — "ASK-OWNER", "the owner's call", "the owner's decision",
 * "not ours to settle". Keyed on the literal token alone, four such refusals were silently dropped
 * from the queue on the first run: the questions would simply never have been asked. */
const RESERVED = /ASK-OWNER|owner'?s (?:call|decision|ruling)|not ours to (?:settle|decide)|reserved (?:for|to) the owner|settles a WG-vs-print/i;

/*
 * ⚠ AND ANCHOR "already fixed" AT THE START. A sibling classifier used /ALREADY FIXED/i anywhere in
 * the reason and matched the phrase inside "the duplicate is REAL and NOT ALREADY FIXED" — a
 * negation — which recorded clawdancer-dedication as MATCHES when its verifier had refused the fix
 * for settling an owner question. A verdict is the one thing that must never be inferred from a
 * substring that a "not" can precede.
 */
export const SAYS_ALREADY_FIXED = (reason) => /^\s*ALREADY FIXED\b/i.test(String(reason ?? ''));
const wanted = findings.filter(
  (f) => f.verdict === 'ASK-OWNER' || (f.verification && !f.verification.upheld && RESERVED.test(String(f.verification.reason))),
);

const entries = wanted.map((f) => {
  const refutedFor = f.verification && !f.verification.upheld ? f.verification.reason : null;
  return {
    id: f.id,
    batch: Number(f.batch),
    printed: clip(f.printedText || f.evidence, 700),
    theirs: clip(f.theyDeliver || '(see evidence)', 500),
    ours: clip(f.weDeliver || '(see evidence)', 500),
    question: clip(
      refutedFor
        ? `A fix was proposed and REFUSED on review because it picks a side in a WG-vs-print disagreement. The reviewer's reasoning: ${refutedFor}`
        : `Their encoding and the printed text disagree. ${f.evidence ?? ''}`,
      900,
    ),
  };
});

/* The allocator refuses an id already on the desk — which is this script's old `already++` case, and it
 * now covers `deferred` / `ruled` / `authorisedExceptions` too, not just `open`. */
const { added, refused } = appendQuestions(doc, entries, num);
for (const entry of added) console.log(`#${entry.n}  ${entry.id}  (batch ${entry.batch})`);
for (const r of refused) console.log(`  skipped — ${r}`);

doc.open.sort((a, b) => Number(a.batch) - Number(b.batch) || String(a.id).localeCompare(String(b.id)));
console.log(`${wanted.length} finding(s) need a ruling: ${added.length} added, ${refused.length} already queued.`);
console.log(`${doc.open.length} open question(s) total.`);
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(doc, null, 1) + '\n');
writeFileSync(NUMBERS, JSON.stringify(num, null, 1) + '\n');
console.log('written: work/owner-questions.json + work/rulings-numbering.json.');
