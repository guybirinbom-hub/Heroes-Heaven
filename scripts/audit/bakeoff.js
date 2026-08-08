export const meta = {
  name: 'feat-audit-bakeoff',
  description: 'Two model tiers judge the same 500 feats from identical evidence; agreement decides which runs the full audit',
  phases: [
    { title: 'Haiku', detail: 'cheap arm — 10 batches of 50' },
    { title: 'Opus', detail: 'reference arm — same 500, same prompt, same evidence' },
  ],
}

const EVIDENCE = 'C:/trying ai 2/pf2e codex/scripts/audit/feat-500-evidence.json'
const LANES = 'C:/trying ai 2/pf2e codex/docs/mechanic-lanes.md'
const BATCH = 50
const BATCHES = 10

const TASK = `
You are auditing a Pathfinder 2e character-builder app. For each feat you are given an EVIDENCE PACK
and must decide whether the app implements that feat's printed text correctly.

**Judge from the evidence pack alone. Do not read the codebase, do not use tools.** The pack is
complete by design and the audit is only comparable between reviewers if everyone sees the same thing.

## The evidence pack

- \`text\` — the feat's own printed rules text. This is the specification.
- \`sheetDiff\` — **what the app ACTUALLY does.** Built by making a character without the feat, making
  the same character with it, and diffing every derived sheet value: AC, saves, skills, perception,
  HP, speeds, senses, resistances/immunities/weaknesses, strikes, granted actions, limited uses,
  granted spells, owned class features, and situational star-notes. This is observed behaviour, not a
  claim about what is stored.
- \`storedFields\` — the record's own data fields.
- \`registries\` — which id-keyed registries in src/rules mention this feat.
- \`textNumbers\` — numbers scraped from the text, for comparison against the diff.

## Your verdict — exactly one per feat

- **correct** — everything the text promises happens, and nothing the text does not promise happens.
- **missing** — the text promises a mechanical effect on the character sheet and the diff does not
  show it.
- **spurious** — the app does something this feat should not do: a bonus of the WRONG TYPE
  (circumstance where the text says status — they stack differently, so this is a real defect even
  when the number matches), an effect applied unconditionally where the text conditions it, a wrong
  value, or an effect the text never mentions.
- **no_lane** — the text needs a kind of sheet change this app has no way to express at all.

## ⚠ Two known limits of the harness — do NOT report these as defects

1. **A pick-a-feat grant shows an empty diff.** If \`registries\` includes \`featPickGrants\`, the feat
   offers the player a choice and contributes nothing until that choice is made. Empty diff is
   expected and correct.
2. **Effects on enemies, allies, or another sheet entirely** (Kingmaker kingdom rules, for instance)
   correctly produce no diff on this character's sheet.

## NOT defects — the overwhelming majority of text is one of these

- Flavour, lore, appearance, restating a general rule.
- Anything the GM adjudicates: exploration outcomes, social results, narrative access.
- Effects on enemies or the battlefield rather than your own sheet.
- The internal steps of an activity ("make a Strike", "you may Step"). The app lists the action; the
  player performs it. Only the action's EXISTENCE needs to appear.
- A bonus to one specific roll under one specific circumstance is a situational star-note, which
  appears in the diff under \`situational\`. That IS the correct lane for it — not a flat bonus.
- Prerequisites, frequency lines, trigger lines, access clauses.

**Default to \`correct\` when uncertain.** A false defect costs as much as a missed one here.
`

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          featId: { type: 'string' },
          verdict: { type: 'string', enum: ['correct', 'missing', 'spurious', 'no_lane'] },
          reason: { type: 'string', description: 'one sentence; for a defect, name the clause and the sheet value that is wrong' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['featId', 'verdict', 'reason', 'confidence'],
      },
    },
  },
  required: ['results'],
}

const batches = []
for (let i = 0; i < BATCHES; i++) batches.push({ i, from: i * BATCH, to: (i + 1) * BATCH })

const promptFor = (b) =>
  `${TASK}\n\nRead the lane vocabulary at ${LANES} first — it names every system this app has for ` +
  `turning text into sheet changes. Then read ${EVIDENCE} (a JSON array) and judge the evidence packs ` +
  `at array indices ${b.from} through ${b.to - 1} inclusive. Judge EVERY one of them — return exactly ` +
  `one result per feat in that range, in order. Reading those two files is the only tool use permitted.`

phase('Haiku')
const haiku = await parallel(
  batches.map((b) => () =>
    agent(promptFor(b), { label: `haiku:${b.from}-${b.to - 1}`, phase: 'Haiku', schema: SCHEMA, model: 'haiku' })),
)

phase('Opus')
const opus = await parallel(
  batches.map((b) => () =>
    agent(promptFor(b), { label: `opus:${b.from}-${b.to - 1}`, phase: 'Opus', schema: SCHEMA, model: 'opus' })),
)

const collect = (arm) => {
  const m = {}
  for (const r of arm) for (const x of r?.results ?? []) m[x.featId] = x
  return m
}
const H = collect(haiku)
const O = collect(opus)

const ids = [...new Set([...Object.keys(H), ...Object.keys(O)])]
const both = ids.filter((id) => H[id] && O[id])

let agree = 0
const missedByCheap = []   // opus says defect, haiku says correct — the dangerous direction
const overflagByCheap = [] // haiku says defect, opus says correct — absorbed by triage
const otherDisagree = []
const isDefect = (v) => v && v !== 'correct'

for (const id of both) {
  const h = H[id].verdict, o = O[id].verdict
  if (h === o) { agree++; continue }
  const row = { featId: id, haiku: h, opus: o, haikuReason: H[id].reason, opusReason: O[id].reason }
  if (!isDefect(h) && isDefect(o)) missedByCheap.push(row)
  else if (isDefect(h) && !isDefect(o)) overflagByCheap.push(row)
  else otherDisagree.push(row) // both call it a defect, disagree on which kind
}

const tally = (m) => {
  const t = {}
  for (const x of Object.values(m)) t[x.verdict] = (t[x.verdict] ?? 0) + 1
  return t
}

log(`judged by both: ${both.length}. verdict agreement ${agree}/${both.length} = ${((100 * agree) / both.length).toFixed(1)}%`)
log(`missed-by-cheap ${missedByCheap.length} | over-flagged-by-cheap ${overflagByCheap.length} | kind-disagreement ${otherDisagree.length}`)

return {
  judged: both.length,
  haikuOnly: ids.filter((id) => H[id] && !O[id]).length,
  opusOnly: ids.filter((id) => O[id] && !H[id]).length,
  agreementPct: Number(((100 * agree) / both.length).toFixed(1)),
  missedByCheapPct: Number(((100 * missedByCheap.length) / both.length).toFixed(1)),
  haikuTally: tally(H),
  opusTally: tally(O),
  missedByCheap,
  overflagByCheap: overflagByCheap.slice(0, 40),
  otherDisagree,
}
