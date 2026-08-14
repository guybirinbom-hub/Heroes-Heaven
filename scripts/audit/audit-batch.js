export const meta = {
  name: 'feat-audit-batch',
  description: 'The audit, one level-ordered batch — extract requirements from text, then check the app delivers them on BOTH halves (what the builder asks, what the sheet does)',
  phases: [
    { title: 'Requirements', detail: 'text only, clause by clause, 5 feats per reader' },
    { title: 'Verify', detail: 'each feat compared against what the app actually asks AND does' },
  ],
}

const R = 'C:/trying ai 2/pf2e codex/'
const LANES = `${R}docs/mechanic-lanes.md`
const ANSWERS = `${R}docs/gold-set-answers.md`
const EXEMPLARS = `${R}scripts/audit/tier-exemplars.json`
/* The MERGED pack: scripts/feat-evidence.mjs (the sheet half) and scripts/builder-evidence.mjs (the
 * builder half) joined per feat by scripts/merge-evidence.mjs. Until 2026-08-12 this pointed at the
 * sheet half alone, so a feat whose picker offered the wrong options — or asked a question nothing
 * reads — had no way to read as anything but correct. Regenerate with:
 *   npx jiti scripts/feat-evidence.mjs && npx jiti scripts/builder-evidence.mjs && node scripts/merge-evidence.mjs
 * The merge REFUSES to run over a stale half, so a green run of it is also a freshness guarantee. */
/* THE WORK LIST IS A PARAMETER.
 *
 * audit-500.js is FROZEN: it always audits the same 500 feats, because a defect rate is only
 * comparable against itself. This file is that same instrument with the sample handed in, so the
 * level-ordered run (batch-001, batch-002, …) asks the identical questions and cannot drift from it.
 * Every prompt, schema and phase below is byte-identical to audit-500.js — it is derived from it by
 * scratchpad/derive-audit-batch.mjs, not hand-copied.
 *
 *   Workflow({ scriptPath, args: { sample:   'scripts/audit/batch-001.json',
 *                                  evidence: 'scripts/audit/batch-001-evidence.json',
 *                                  total:    100 } })
 */
const A = (typeof args === 'string' ? JSON.parse(args) : args) ?? {}

const EVIDENCE = `${R}${A.evidence ?? "scripts/audit/audit-500-evidence.json"}`

/* Phase 1 sees ONLY the text. Handing it the app's behaviour turns "what does this feat require?" into
 * "does the app already do this?", which is how an earlier run buried the cases that mattered. */
const EXTRACT = `
You are reading Pathfinder 2e feats and extracting WHAT AN APP MUST BE ABLE TO DO for each one to work.
Specification only — you have no information about any app and must not speculate.

A feat is delivered correctly when the app **asks the player the choices the feat says they make** AND
**changes the character sheet the way the feat says it does**. Both halves are requirements, so state
both:

  side "builder" — the feat says the player CHOOSES something. State what the question is and, above
    all, WHICH OPTIONS ARE LEGAL: "choose one of your deity's domains" is a different requirement from
    "choose a domain". Say if the text restricts the list, allows repeats, or scales at a later level.
  side "sheet" — the feat changes something the player reads off their sheet: a number, a note, an
    action, a resource, a marker on the record it modifies.

A single clause often makes both ("choose a skill; you become trained in it") — that is two
requirements, not one.

Read first, in order:
1. ${ANSWERS} — the owner's answers, the lettered principles, the numbered decisions. THE AUTHORITY.
2. ${LANES} — the lane vocabulary, especially DECIDED SCOPE: what the owner has ruled deliberately does
   NOT belong on the sheet (ally-facing effects, enemy conditions, aura position, companion bonuses,
   HP and damage inside a mode). None of those is a gap.
3. ${EXEMPLARS} — eight worked examples with agreed answers. Match their grain.

Split each feat's text into individual MECHANICAL clauses FIRST — a feat commonly makes two or three
promises and the usual failure is to notice one and stop. Then state the requirement per clause.
A feat may legitimately require NOTHING; say so rather than inventing something.
`

const REQ_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          featId: { type: 'string' },
          requirements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lane: { type: 'string' },
                what: { type: 'string' },
                clause: { type: 'string' },
                side: {
                  type: 'string',
                  enum: ['builder', 'sheet'],
                  description: 'builder = the player must be ASKED this; sheet = the character sheet must SHOW or COMPUTE this',
                },
              },
              required: ['lane', 'what', 'clause', 'side'],
            },
          },
        },
        required: ['featId', 'requirements'],
      },
    },
  },
  required: ['results'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          featId: { type: 'string' },
          name: { type: 'string' },
          verdict: { type: 'string', enum: ['correct', 'missing', 'spurious', 'no_lane', 'uncertain'] },
          half: {
            type: 'string',
            enum: ['builder', 'sheet', 'both', 'n/a'],
            description: 'which half the defect is in. "n/a" when the verdict is correct',
          },
          detail: { type: 'string', description: 'for a defect: the clause, and the option list or sheet value that is wrong' },
          question: { type: 'string', description: 'ONLY when uncertain: the exact question for the owner' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['featId', 'name', 'verdict', 'half', 'detail', 'question', 'severity'],
      },
    },
  },
  required: ['results'],
}

const VERIFY = `
You are auditing whether a Pathfinder 2e app delivers what a feat's printed text promises.

A feat is delivered correctly when the app **asks the player the choices the feat says they make** AND
**changes the sheet the way the feat says it does**. You are given evidence for BOTH halves, observed by
driving the real app — never by reading which fields a record carries.

You are given, per feat: the REQUIREMENTS an independent reader extracted from its text alone (each
tagged \`side\`: "builder" or "sheet"), and an EVIDENCE PACK from ${EVIDENCE}.

── THE SHEET HALF — what the app DOES ────────────────────────────────────────────────────────────
  \`sheetDiff\` — the app's actual behaviour: a character was built without the feat, then with it, and
    every derived value diffed — AC, saves, skills, perception, HP, speeds, senses, resistances,
    strikes, granted actions, limited uses, granted spells, owned features, situational notes.
  \`storedFields\`, \`registries\`, \`textNumbers\` — the record's own fields, which id-keyed rule
    registries mention it, and the numbers its text states (for the value check a diff cannot do).

── THE BUILDER HALF — what the app ASKS ──────────────────────────────────────────────────────────
Resolved by calling the app's own option resolvers for a concrete host character, so an option list
here is the option list the player sees.

  \`builder.declared\` — where a choice is declared: the record's \`choice\`/\`effectChoices\`, or one of
    the id-keyed registries. Declaring is not asking; the next field is what is actually rendered.
  \`builder.presentsChoices\` — the pickers the builder RENDERS: prompt, kind, \`optionCount\`, and the
    options themselves (listed up to 60; \`optionsTruncated\` gives the true length when longer).
  \`builder.answerIsRead\` — for each picker the app was given two DIFFERENT answers and the character
    rebuilt, to see whether the answer is consumed. \`verdict\` is one of:
      read           a derived value moved — the answer reaches something.
      echo-only      nothing moved except the feat's own label ("Assurance (Religion)").
      not-read       nothing moved at all, not even the label.
      free-text      the player types (Ruling I). There is no option list to judge.
      single-option  the list has exactly one entry — the player is asked a question with one answer.
      no-options     the list is empty — the player is asked a question with no answer.
      inert-declared the record itself declares the choice has no mechanical consequence.
      daily          per Q23 this is answered in Daily preparations, not in the builder.
      slot-budget    the language lane, measured as the number of language slots the feat grants.
  \`builder.unansweredState.silentDefaults\` — pickers where answering NOTHING produces the same
    character as answering. The player is never forced to choose and the app chose for them.
  \`builder.eligibleHosts\` — which of six reference characters may legally take the feat.
    \`builder.nativeHostEligible\` is the same question for a host matched to the feat's own traits, and
    is the meaningful one for a class feat no reference character has.

── THE CROSS-HALF FACTS — \`crossChecks\` ─────────────────────────────────────────────────────────
Neither half can state these alone, and reading one half without the other is how a working feat gets
called broken and a broken one called correct:
  \`sheetSilentButBuilderAsks\`  the diff is empty AND the feat asks something. DO NOT read the empty
    diff as "this feat does nothing" — the effect may be waiting on an answer nobody has given.
  \`silentOnBothHalves\`  changes nothing and asks nothing. The strongest defect candidate — after you
    have read \`harnessLimits\` and DECIDED SCOPE, both of which produce this shape legitimately.
  \`sheetSilentAndNoAnswerRead\`  it asks, and no answer to it moves anything either.
  \`answerDeadButSheetMoves\`  the feat works and the ANSWER is decorative. See Q20 below.
  \`declaredWithoutPicker\`  a choice the record declares that the builder renders NO picker for — the
    player is never asked. \`pickerWithZeroOptions\` — asked a question with no answers. Both are
    \`missing\` defects on the builder half unless \`harnessLimits\` explains them.

── HOW TO JUDGE THE BUILDER HALF ─────────────────────────────────────────────────────────────────
  • **Q9** — the builder shows only what the player may LEGALLY pick. An option list that contradicts
    the feat's own printed restriction is \`spurious\` even though nothing is missing: "choose one of
    your deity's domains" offering all 49 domains is a defect, and one this evidence can show.
  • **Q21** — filtering asks "is this wasted across the character's whole CAREER?", not "is this
    redundant right now?". Canny Acumen must keep offering a save you are already expert in, because
    the level-17 upgrade is the point. An option list that looks over-long may be right for this reason.
  • **Q20 + Round 5** — an answer that moves no number is NOT automatically wrong. Two questions:
    (1) does the app model a mechanical consequence of the choice? If yes, a label is not enough —
    \`missing\`. (2) does the choice name a specific stat? If yes, that stat needs a \`*\` back to the
    feat, whether or not a number moves. Only when both answers are no is \`echo-only\` correct.
    Assurance is the worked case: nothing on the sheet changes and the skill still must be starred.
  • **Q26** — a picker whose answer reaches nothing is a candidate MISSING GRANT. Do not default to
    "it must be flavour"; find what the text says the choice gives.
  • **Ruling K** — what the player re-chooses in the builder needs no further sheet surface.
  • **Q27** is a DISPLAY rule (an unpickable option must LOOK unpickable). This evidence cannot see
    greying, so never report it from an option count.

Read ${ANSWERS} and ${LANES} (especially DECIDED SCOPE) before judging. They settle what does NOT belong
on the sheet, and a requirement the owner has ruled out is not a defect.

Verdicts — ONE per feat, covering both halves. Where the halves disagree, report the DEFECT and set
\`half\` to the half it is in ("both" when each half fails a different requirement):
  correct   — every requirement is delivered, and nothing the text does not call for happens.
  missing   — a requirement the text makes is not delivered: a value the sheet never shows, or a choice
              the player is never asked (no picker, no options, or an answer nothing consumes when the
              text says it should).
  spurious  — the app does something the text does not call for: a bonus of the WRONG TYPE (circumstance
              where the text says status — they stack differently, so this counts even when the number
              matches), an effect applied unconditionally where the text conditions it, a wrong value,
              or an option list WIDER than the feat's own restriction.
  no_lane   — the requirement needs a capability this app has no route for.
  uncertain — you cannot settle it: the text is ambiguous, two of the owner's decisions pull opposite
              ways, or the evidence cannot show whether it works.

⚠ HARNESS LIMITS — \`harnessLimits\` lists, per feat, the ones that apply, with the evidence that
triggered each. **A limit explains an ABSENCE OF EVIDENCE. It never establishes that the feat is
correct.** When a limit applies, judge that requirement from the text and the record's own fields, and
say \`uncertain\` rather than \`correct\` if you cannot tell.
  1. \`pick-a-feat-grant\` — what the feat grants is a feat the player picks, so the diff is empty until
     the pick is made. The builder half shows the picker; the empty diff is expected and is not a defect.
  2. \`companion-tab\` / \`companion-tab?\` — effects that land on an eidolon, animal companion, familiar
     or minion are invisible to BOTH halves: neither harness builds a companion. \`companion-tab?\` is a
     text match and a candidate only. ⚠ This limit does not make a companion feat correct — the owner
     has already ruled one such feat (Ranged Combatant) a defect for granting its eidolon nothing.
  3. \`host-owns-nothing\` — the picker resolves its options from what the character OWNS (a weapon, a
     spell). The reference host owns none, so the empty list is the host, not the app.
  4. \`daily-choice\` — per Q23 it is answered in Daily preparations; play state is not simulated.
  5. \`forced-placement\` — no rendered slot offered this feat to this host, so it was forced into one.
     The pickers are still real; the host's eligibility is simply not evidenced either way.
  6. \`sheet-unplaceable\` — no slot accepted the feat at all, so \`sheetDiff\` is **null, not empty**.
     Nothing was measured; judge the sheet half from the record's fields and the text.
  7. Effects on enemies, allies, or another sheet entirely produce no diff here, correctly.

**Prefer \`uncertain\` over a guess.** The owner will personally address every uncertain case, so an
honest question is more useful than a confident wrong answer. But do not use it to avoid work: if the
owner's decisions settle it, settle it.
`

/* Workflow scripts have no filesystem access, so the ids are never loaded here — each reader takes its
 * own slice straight from the frozen sample. That also keeps the batch boundaries reproducible: batch
 * N is always the same five feats, whatever order the agents finish in. The merged evidence file is
 * written in the sample's own order for the same reason. */
const SAMPLE = `${R}${A.sample ?? "scripts/audit/feat-500.json"}`
const TOTAL = A.total ?? 500
const SIZE = 5

/* ── The cache plan ─────────────────────────────────────────────────────────────────────────────
 * This run cost 17.4M tokens the first time because it reads every feat twice. Most of that is
 * recoverable: a REQUIREMENT is derived from the feat's text alone, so building a lane cannot change
 * one, and a VERDICT only needs redoing where the evidence pack actually moved. `scripts/audit-cache.mjs`
 * decides which those are — by hashing what each reader really sees — and hands the answer in as `args`:
 *
 *   node scripts/audit-cache.mjs plan            # prints the args blob, writes scripts/audit/plan/
 *   Workflow({ scriptPath, args: <that blob> })
 *   node scripts/audit-cache.mjs apply <output>  # folds the fresh answers back into the cache
 *
 * With no plan this behaves exactly as it did before the cache existed: 100 batches, both phases.
 * `args.force` does the same over a plan that is present. A batch keeps its identity either way — it is
 * always the same five feats — it simply carries fewer of them to ask about.
 *
 * ⚠ WITH A PLAN, THIS WORKFLOW'S OUTPUT IS SHORT BY DESIGN: it holds only what was recomputed. The
 * complete 500-feat answer lives in the cache and is assembled by `audit-cache.mjs apply`. `partial`
 * says so in the output, because a truncated result that looks whole is the exact shape of the silent
 * shortfall that disqualified Haiku in the bake-off. */
const PLAN = A.force ? null : (A.plan ?? null)
const planned = PLAN ? new Map(PLAN.batches.map((b) => [b.i, b])) : null

const batches = []
for (let from = 0; from < TOTAL; from += SIZE) {
  const i = from / SIZE
  const b = { i, from, to: Math.min(TOTAL, from + SIZE) - 1 }
  const p = planned?.get(i)
  if (planned && !p) continue // every feat in this batch is answered in the cache
  // `null` means "the whole batch", which is what a run without a plan asks for.
  batches.push({ ...b, req: p ? p.req : null, verify: p ? p.verify : null, carried: p ? (p.carried ?? 0) : 0 })
}

const idxOf = (b, phase) => (b[phase] ? b[phase].join(', ') : `${b.from}–${b.to}`)
const countOf = (b, phase) => (b[phase] ? b[phase].length : b.to - b.from + 1)
const slice = (b, phase) => `the feats at indices ${idxOf(b, phase)} of the \`featIds\` array in ${SAMPLE}`
const planFile = (b) => `${R}${PLAN.dir ?? 'scripts/audit/plan/'}batch-${String(b.i).padStart(3, '0')}.json`

const askedReq = batches.reduce((t, b) => t + countOf(b, 'req'), 0)
const askedVerify = batches.reduce((t, b) => t + countOf(b, 'verify'), 0)
log(
  PLAN
    ? `CACHED RUN · ${askedReq} requirement extractions and ${askedVerify} verdicts to recompute, ` +
        `in ${batches.length} of ${TOTAL / SIZE} batches · reused ${PLAN.totals?.reqReused ?? '?'} requirements, ${PLAN.totals?.verifyReused ?? '?'} verdicts`
    : `${TOTAL} feats in ${batches.length} batches of ${SIZE} — full run, no cache plan supplied`,
)

const out = await pipeline(
  batches,
  (b) =>
    countOf(b, 'req') === 0
      ? Promise.resolve({ results: [] }) // every requirement in this batch is reused from the cache
      : agent(
          `${EXTRACT}\n\nYour feats are ${slice(b, 'req')}. Look each one up in ${EVIDENCE} and use ONLY its ` +
            `\`text\` field. Ignore every other field in that file — they describe an app, and reading them ` +
            `would contaminate this. Return exactly one result per feat, ${countOf(b, 'req')} in total.`,
          { label: `req:${b.i}`, phase: 'Requirements', schema: REQ_SCHEMA },
        ),
  (req, b) =>
    countOf(b, 'verify') === 0
      ? Promise.resolve({ batch: b.i, requirements: req?.results ?? [], verdicts: [] })
      : agent(
          `${VERIFY}\n\nYour feats are ${slice(b, 'verify')}. Read their full entries in ${EVIDENCE} — text, ` +
            `sheetDiff, storedFields, registries, and the whole \`builder\` object, \`crossChecks\` and ` +
            `\`harnessLimits\`.\n\nREQUIREMENTS an independent reader extracted from the ` +
            `text alone:\n${JSON.stringify(req?.results ?? [], null, 1)}\n` +
            /* Requirements this run did not re-derive, because the feat's TEXT has not changed since they
             * were extracted. They are read from a file rather than inlined because 500 requirement sets
             * are megabytes and the args blob is pasted by hand. */
            (b.carried
              ? `\nThe remaining ${b.carried} feat(s) in your batch had their requirements extracted in an ` +
                `earlier run, from text that has not changed since. Read ${planFile(b)} and use its ` +
                `\`requirements\` array — one entry per feat, the same shape as above. Treat those ` +
                `requirements exactly as you treat these.\n`
              : '') +
            `\nReturn exactly one verdict per feat, ${countOf(b, 'verify')} in total.`,
          { label: `verify:${b.i}`, phase: 'Verify', schema: VERDICT_SCHEMA },
        ).then((v) => ({ batch: b.i, requirements: req?.results ?? [], verdicts: v?.results ?? [] })),
)

const ok = out.filter(Boolean)
const verdicts = ok.flatMap((r) => r.verdicts)
// Completion accounting, because Haiku's silent shortfall in the bake-off looked exactly like clean
// coverage. A missing verdict must be visible, not inferred from a total that happens to look plausible.
// ⚠ The expected size is now PER BATCH — a cached run legitimately asks about two feats in one batch and
// five in the next, so a flat "must be 5" would have reported every cached batch as short.
const seen = new Set(verdicts.map((v) => v.featId))
const expectedFor = new Map(batches.map((b) => [b.i, countOf(b, 'verify')]))
const shortBatches = ok
  .filter((r) => r.verdicts.length !== expectedFor.get(r.batch))
  .map((r) => ({ batch: r.batch, got: r.verdicts.length, expected: expectedFor.get(r.batch) }))

const by = (v) => verdicts.filter((x) => x.verdict === v)
const defects = [...by('missing'), ...by('spurious'), ...by('no_lane')]
const half = (h) => defects.filter((d) => d.half === h).length
log(`${verdicts.length}/${askedVerify} judged this run (of ${TOTAL} in the sample) · correct ${by('correct').length} · missing ${by('missing').length} · spurious ${by('spurious').length} · no_lane ${by('no_lane').length} · UNCERTAIN ${by('uncertain').length}`)
// The whole point of the merge: a defect rate that says WHICH half it describes. The previous run's
// numbers covered the sheet only and must never be compared with these without that in hand.
log(`defects by half · builder ${half('builder')} · sheet ${half('sheet')} · both ${half('both')}`)
const reqs = ok.flatMap((r) => r.requirements)
const reqSides = reqs.flatMap((r) => r.requirements ?? [])
log(`requirements extracted · builder ${reqSides.filter((r) => r.side === 'builder').length} · sheet ${reqSides.filter((r) => r.side === 'sheet').length}`)
// A shortfall is now measured against what this run was ASKED for, not against 500 — under a plan, 496
// of the 500 are answered in the cache and their absence here is the saving, not a failure.
if (verdicts.length !== askedVerify) log(`⚠ SHORTFALL: ${askedVerify - verdicts.length} of the ${askedVerify} feats asked about returned no verdict, across ${shortBatches.length} batches`)
// The report line the cache exists for: what this run did NOT have to pay for.
const cache = {
  used: !!PLAN,
  forced: !!A.force,
  batchesRun: batches.length,
  batchesSkipped: TOTAL / SIZE - batches.length,
  reqRecomputed: askedReq,
  verifyRecomputed: askedVerify,
  reqReused: PLAN ? (PLAN.totals?.reqReused ?? TOTAL - askedReq) : 0,
  verifyReused: PLAN ? (PLAN.totals?.verifyReused ?? TOTAL - askedVerify) : 0,
}
log(`cache · requirements reused ${cache.reqReused}, recomputed ${cache.reqRecomputed} · verdicts reused ${cache.verifyReused}, recomputed ${cache.verifyRecomputed}`)
if (PLAN) log(`${askedVerify < TOTAL ? '⚠ PARTIAL OUTPUT — this holds only what was recomputed. ' : ''}Assemble the full ${TOTAL} with:  node scripts/audit-cache.mjs apply <this file>`)

return {
  requested: TOTAL,
  // ⚠ True when this run judged fewer than the whole sample: the counts below then describe the
  // recomputed feats ONLY, and reading them as a 500-feat defect rate would understate every total by
  // however much the cache saved. `audit-cache.mjs apply` assembles the complete answer.
  partial: askedVerify < TOTAL,
  cache,
  distinctFeatsJudged: seen.size,
  shortBatches,
  judged: verdicts.length,
  counts: {
    correct: by('correct').length,
    missing: by('missing').length,
    spurious: by('spurious').length,
    no_lane: by('no_lane').length,
    uncertain: by('uncertain').length,
  },
  defectsByHalf: { builder: half('builder'), sheet: half('sheet'), both: half('both'), unattributed: defects.length - half('builder') - half('sheet') - half('both') },
  requirementsBySide: { builder: reqSides.filter((r) => r.side === 'builder').length, sheet: reqSides.filter((r) => r.side === 'sheet').length },
  defects: defects.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]),
  uncertain: by('uncertain'),
  // EVERY verdict, not only the defects. The previous run reported 136 correct and stored none of them,
  // so nothing could be reused and the pile could not be re-examined feat by feat. `defects` and
  // `uncertain` above are kept as they were — they are what a reader opens the file for.
  verdicts,
  requirements: reqs,
}
