export const meta = {
  name: 'wg-batch',
  description: 'One saved workflow per parity batch: cut + baseline, sliced read with adversarial verify, builders by family with verifiers, gaps, closer and close-verifier - Fable reads only work/.bNNN-run.json',
  phases: [
    { title: 'Cut', detail: 'driver cut + baseline; returns the record list and the run.json tail', model: 'opus' },
    { title: 'Read', detail: 'one reader per slice of 5 records, grouped by bucket', model: 'opus' },
    { title: 'Verify read', detail: 'adversarial refutation per slice, default REFUTED', model: 'opus' },
    { title: 'Read digest', detail: 'driver read-digest; returns the family list', model: 'opus' },
    { title: 'Build', detail: 'one builder per family; specs, manifest entries, tests', model: 'opus' },
    { title: 'Verify build', detail: 'one adversarial verifier per family', model: 'opus' },
    { title: 'Apply digest', detail: 'driver apply-digest; produces the gaps file', model: 'opus' },
    { title: 'Gaps', detail: 'one agent per gap family resolves or parks each open line, then a gap-verifier', model: 'opus' },
    { title: 'Close', detail: 'the closer runs the driver stage by stage and writes the commit message', model: 'opus' },
    { title: 'Verify close', detail: 'close-verifier, default REFUTE, re-runs flip-audit / gate / verify', model: 'opus' },
    { title: 'Final', detail: 'driver final run.json tail back to Fable', model: 'opus' },
  ],
}

// WHY this file exists: docs/wg-batch-pipeline.md section C - "One saved workflow -
// .claude/workflows/wg-batch.js ... Per batch Fable does three things: launch ONE saved workflow with
// the batch number; read ONE machine-generated digest (work/.bNNN-run.json); approve the commit or
// send the digest's 'needs the orchestrator' items back."
// The script itself has NO filesystem access: every read and write happens inside an agent.
// No backtick character appears anywhere in this file - two earlier launches died on one inside a
// template literal, so every prompt is built by concatenating single-quoted strings.

const RAW_BATCH = String((args && args.batch) != null ? (args && args.batch) : '')
// Padded to three digits when numeric, UPPERCASED otherwise - exactly what scripts/wg-batch-run.mjs does
// (`rawBatch.padStart(3,'0')` / `rawBatch.toUpperCase()`). A lowercase "p01" here would have the readers
// write work/.bp01-read-slice-1.json while the driver looked for .bP01- with a case-sensitive regex.
const BATCH = /^[0-9]+$/.test(RAW_BATCH) ? (RAW_BATCH.length >= 3 ? RAW_BATCH : ('000' + RAW_BATCH).slice(-3)) : RAW_BATCH.toUpperCase()
if (!BATCH) throw new Error('wg-batch: args.batch is required, e.g. { batch: "030" } or { batch: "P01", print: true }')
const PRINT = !!(args && args.print)
const B = '.b' + BATCH
const PACKET = PRINT ? 'work/print-batch-' + BATCH + '.json' : 'work/wg-batch-' + BATCH + '.json'
const LANE = PRINT ? 'PRINT-READ lane (print: true)' : 'WG-COMPARISON lane'
const REPO = 'C:\\trying ai 2\\pf2e codex'
const MIRROR = 'C:\\wonderers guide\\aon-2e-archive\\data\\by-category'
const DRIVER = 'node scripts/wg-batch-run.mjs --batch ' + BATCH
const PRINT_FLAG = PRINT ? ' --print' : ''
const OPUS = { model: 'opus', effort: 'high' }
const RUNNER = { model: 'opus', effort: 'low' }
const DEFAULT_FAMILIES = ['data-rows', 'instruments', 'situational', 'engine', 'repair']

const cutFlags = () => {
  let f = ''
  if (args && args.ids) f += ' --ids ' + String(args.ids)
  if (args && args.count) f += ' --count ' + String(args.count)
  if (args && args.maxLevel) f += ' --max-level ' + String(args.maxLevel)
  return f
}

// ---------------------------------------------------------------- schemas

const RUN_TAIL = {
  type: 'object', additionalProperties: false, required: ['ok', 'runJson'],
  properties: {
    ok: { type: 'boolean', description: 'true only if every stage this agent ran has ok:true' },
    runJson: { type: 'string', description: 'the run.json entries this run appended, verbatim JSON' },
    stopped: { type: 'string', description: 'the "needs the orchestrator" line, or empty' },
  },
}
const CUT_OUT = {
  type: 'object', additionalProperties: false, required: ['ok', 'runJson', 'records'],
  properties: {
    ok: { type: 'boolean' },
    runJson: { type: 'string', description: 'the cut and baseline run.json entries, verbatim JSON' },
    stopped: { type: 'string' },
    records: {
      type: 'array', description: 'every record in the batch, in packet order',
      items: {
        type: 'object', additionalProperties: false, required: ['bucket', 'id', 'name'],
        properties: {
          bucket: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' },
          flags: { type: 'string', description: 'the instrument / experience flags for this record from the baseline digest, or empty' },
        },
      },
    },
  },
}
const DIGEST_OUT = {
  type: 'object', additionalProperties: false, required: ['ok', 'runJson', 'families'],
  properties: {
    ok: { type: 'boolean' }, runJson: { type: 'string' }, stopped: { type: 'string' },
    families: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['family', 'findingIds'],
        properties: { family: { type: 'string' }, findingIds: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
}
const APPLY_DIGEST_OUT = {
  type: 'object', additionalProperties: false, required: ['ok', 'runJson', 'gapFamilies'],
  properties: {
    ok: { type: 'boolean' }, runJson: { type: 'string' }, stopped: { type: 'string' },
    gapFamilies: { type: 'array', items: { type: 'string' }, description: 'families with at least one status:"open" line in the gaps file' },
  },
}
const SLICE_OUT = {
  type: 'object', additionalProperties: false, required: ['file', 'count'],
  properties: { file: { type: 'string' }, count: { type: 'integer' }, note: { type: 'string' } },
}
const FAMILY_OUT = {
  type: 'object', additionalProperties: false, required: ['family', 'report', 'specFiles'],
  properties: {
    family: { type: 'string' }, report: { type: 'string', description: 'path of the report file written' },
    specFiles: { type: 'array', items: { type: 'string' } },
    gapsOpen: { type: 'integer', description: 'DATA STILL NEEDED + CROSS-FILE GAPS lines in the report' },
  },
}
const CLOSER_OUT = {
  type: 'object', additionalProperties: false, required: ['notes', 'closerEdits', 'needsOrchestrator', 'commitChars'],
  properties: {
    notes: { type: 'string', description: 'non-load-bearing prose, under 3000 chars' },
    closerEdits: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['file', 'why', 'test'],
        properties: { file: { type: 'string' }, why: { type: 'string' }, test: { type: 'string' } },
      },
    },
    needsOrchestrator: { type: 'array', items: { type: 'string' } },
    commitChars: { type: 'integer', description: 'length of work/' + B + '-commit.txt' },
  },
}
const CLOSE_VERIFY_OUT = {
  type: 'object', additionalProperties: false, required: ['verdict', 'report', 'needsOrchestrator'],
  properties: {
    verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED'] },
    report: { type: 'string', description: 'the evidence, under 6000 chars, quoting the runIds it produced' },
    needsOrchestrator: { type: 'array', items: { type: 'string' } },
  },
}

// ---------------------------------------------------------------- shared prompt blocks

const NEVER = [
  'ABSOLUTE PROHIBITIONS (a violation is a failed run, not a note): never run any git write command (add / commit / stash / checkout / reset - reading status, log, diff, rev-parse, show is fine); never run npm run data; never run apply-parity-fixes.mjs --write, apply-backfill-now.mjs or any apply-*.mjs (the driver applies); never pass --skip-harness to anything; never edit work/owner-questions.json (an owner question is an entry you write into work/' + B + '-queue.json and nothing else); never delete or rewrite another agent\'s file.',
  'Run vitest ONLY through node scripts/vt.mjs <args> (it takes the exclusive heavy-job lock) - never npx vitest, and never more than one vitest process at a time. Do not run the full suite; run only the test files you touched. Finish with npx tsc --noEmit clean.',
  'Write code with the Edit / Write tools, NEVER through a shell heredoc or node -e. node -e is for INSPECTING data only.',
].join('\n')

const RULES = [
  'PROJECT RULES (Heroes Heaven, ' + REPO + ' - work from this root; Tauri 2 + React + TypeScript; vitest; PATH needs "C:\\Program Files\\nodejs"):',
  NEVER,
  '- The findings you implement are in work/' + B + '-read.json (keys confirmed / refuted / askOwner) and summarised per family in work/' + B + '-read-summary.txt. Each finding has id (record id, with a "#aspect" suffix when a record has several), claim, printed (verbatim), ours, theirs, proposal, evidence. Read your assigned findings IN FULL before touching anything - the proposals cite exact files, lines and sibling shapes.',
  '- The printed text is the authority. Wanderer\'s Guide is GPL-3.0: its encoding is EVIDENCE to match, never text to copy. Where WG contradicts print, that is an owner question (work/' + B + '-queue.json), never a decision you make.',
  '- public/core.json is 8 MB and MINIFIED - inspect it with node -e, never read it raw. Descriptions live in public/core-descriptions.json (key "<bucket>/<id>"). Anything written straight into core.json dies at the next regeneration: durable data goes through overlay rows in scripts/data/effect-backfill.json ({category,id,field,value} = ABSOLUTE assignment of one top-level field; value:null deletes a field; {category,id,create:true,value:{...record}} creates a record with no description inside; {category,id,delete:true} retires one) - but in THIS workflow NO agent writes that file: you emit a SPEC and the driver applies it.',
  '- A record\'s traits, counters, spellSlotBonus, resonant, subclass options array etc. are each ONE field: to change one member you re-emit the WHOLE value (dump it first with node -e, edit the copy, emit the complete value). Two findings on the same record+field must be merged into ONE row - the applier hard-refuses collisions. A row that replaces an existing overlay row must carry supersedes: true AND the superseded value merged whole into yours.',
  '- Lanes that already exist must be REUSED, not rebuilt (grep before writing): grantsItems, grantedStrikes, builtInRunes, counters, frequency, item-driven modes in the core.json modes bucket, recordMarks + RECORD_MARKERS and FEAT_SITUATIONAL in src/rules/situationalBonuses.ts, skillSubstitutions, speedsIf, spellSlotBonus (.restricted ladders), resonant on aeon stones, the per-class tables in src/rules/advancement.ts, degreeShifts, featGrantsAuto.ts, featFeatGrants.ts, classResources.ts, itemAliases.ts, the learned-prepared merge in build.ts (grantedByRank).',
  '- BEFORE claiming ours lacks a mechanic, grep the field name in src/rules/build.ts or derive.ts to confirm a READER exists. A field with no reader anywhere IS a finding ("no reader"), and a row you author for a field whose reader another family is building is fine only if you say so in your report.',
  '- Every code change carries a comment saying WHY (quote the printed clause) and gets a vitest test that pins it on a BUILT character (test/_content.ts exports content() and build(classId, level, over?); test/_render.tsx exports renderDom). A test written BEFORE its data row lands must assert against a content copy with the field STRIPPED or PATCHED IN MEMORY - never a patched-vs-shipped delta that flips once the row is applied.',
  '- Stay inside the files assigned to you. If a fix truly needs another file, put it in CROSS-FILE GAPS instead of editing it.',
  // These three forms are not style: scripts/test-flip-audit.mjs parses them, and batch 29 predates them
  // (its own comment reads "// Batch 29: <prose>", which the audit correctly rejects). Nothing in the
  // repo used them before batch 030, so they have to be stated here or the first flip fails the audit.
  '- CITATION CONVENTIONS, enforced exactly by scripts/test-flip-audit.mjs - an uncited flip fails the batch:',
  '  (1) Every changed or removed it( / expect( / settle-registry entry / ratchet constant carries the comment "// batch ' + BATCH + ': <finding id>" in the 6 lines ABOVE it. <finding id> is an id from confirmed[] in work/' + B + '-read.json (verdict CONFIRMED), and that finding\'s RECORD id must appear in the enclosing describe/it title - the audit checks both halves.',
  '  (2) Where print itself is the authority and no finding covers the change, the form is "// batch ' + BATCH + ' premise: <AoN doc id> \\"<clause>\\"" - the doc id must exist in the AoN mirror and the clause must be a verbatim quote from that document.',
  '  (3) Every test that proves a NEW settle or comparer teach still reports on a STUNTED copy carries the marker comment "// mutation-proof" inside the test body, along with the settle key it stunts. A settle or teach with no such test fails the audit; add the test, never an exemption.',
  '  "// Batch 29: <prose>" is NOT one of these forms. Neither is a bare record id.',
  '- YOUR REPORT LINE FOR A SETTLE OR A TEACH MUST NAME THE FINDING ID, not just the record id. scripts/wg-batch-close.mjs derives the MATCHES verdict by looking for the finding id on a teach line of work/' + B + '-report-<family>.txt (or the matching verify file); a line that names only the record makes every OTHER finding on that record read as taught too, which is how a real gap ships as MATCHES.',
].join('\n')

// ---------------------------------------------------------------- 1. runner: cut + baseline

phase('Cut')
const cut = await agent([
  'You are the RUNNER for parity batch ' + BATCH + ' (' + LANE + '). Repo: ' + REPO + ' (work from this root). You run the driver and report; you author nothing.',
  NEVER,
  'Do exactly this, in order, from the repo root:',
  '1. node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage cut' + cutFlags() + PRINT_FLAG,
  '2. node scripts/wg-batch-run.mjs --batch ' + BATCH + ' --stage baseline' + PRINT_FLAG,
  'The driver takes the heavy-job lock itself and waits - do not kill it because it is quiet. If a stage exits non-zero, do NOT retry it more than once and do not work around it: report ok:false and put the driver\'s own "next" line into stopped.',
  'Then read work/' + B + '-run.json and return, verbatim, the entries these two stages appended (the whole JSON objects, not a summary) as runJson.',
  'Also return the RECORD LIST the workflow slices: one entry per record of the batch packet ' + PACKET + ' with bucket (the core.json bucket: items / feats / classFeatures / ...), id, name, and flags.',
  'flags = the comparer flags the baseline recorded for THAT record id. They are NOT in the run.json digest entry (which carries only counts). Read work/' + B + '-baseline/flags.json - the baseline stage writes it keyed by record id as {kinds: [wg-diff KINDS], values: [wg-values lines], identity: [wg-identity lines], experience: "<verdict> or null"} - and for each record join its non-empty entries into ONE short string, worded as the file words them. Do NOT parse values.txt / identity.txt / diff-batch.json by hand: flags.json is the same data already extracted, and two parsers of the same dumps eventually disagree. A record with nothing in it gets the empty string. Do not invent a flag and do not adjudicate one - the readers do that.'
    + (PRINT ? ' In THIS print lane the baseline skipped every comparer (there is no Wanderer\'s Guide side), so flags.json holds an empty entry per record and every record\'s flags is the empty string - that is correct, not a missing artefact.' : ''),
].join('\n\n'), Object.assign({ label: 'runner:cut+baseline', phase: 'Cut', schema: CUT_OUT }, RUNNER))

if (!cut || !cut.ok) {
  log('cut/baseline failed - stopping: ' + ((cut && cut.stopped) || 'no runner result'))
  return { batch: BATCH, runJsonTail: (cut && cut.runJson) || '', closerNotes: '', verifierReport: 'STOPPED at cut/baseline: ' + ((cut && cut.stopped) || 'runner returned nothing') }
}

const records = (cut.records || []).filter(Boolean)
log('batch ' + BATCH + ': ' + records.length + ' records (' + LANE + ')')

// 5 per slice, grouped by bucket - a reader never straddles two buckets, because the carrier sweep is per bucket.
const byBucket = new Map()
for (const r of records) {
  const k = r.bucket || 'other'
  if (!byBucket.has(k)) byBucket.set(k, [])
  byBucket.get(k).push(r)
}
const SLICES = []
for (const list of byBucket.values()) {
  const first = SLICES.length
  for (let i = 0; i < list.length; i += 5) SLICES.push(list.slice(i, i + 5))
  // A trailing slice of ONE record would spend a reader and an adversarial verifier on one record, and
  // batch 29 (sliced by hand) never did that: its 17 items / 14 class features / 6 feats went out as
  // 4 + 3 + 1 = 8 readers, the 6 feats in one slice. Fold a one-record tail back into its neighbour.
  if (SLICES.length - first > 1 && SLICES[SLICES.length - 1].length === 1) {
    const tail = SLICES.pop()
    SLICES[SLICES.length - 1] = SLICES[SLICES.length - 1].concat(tail)
  }
}
log(SLICES.length + ' read slices')

// ---------------------------------------------------------------- 2. readers -> read-verifiers

const READ_HEAD = [
  'Repo: ' + REPO + ' (work from this root). You are one READER in the parity pipeline, batch ' + BATCH + ' (' + LANE + '); you read the slice below.',
  'INVESTIGATION ONLY: modify no repo file. ' + NEVER,
  'The ONLY file you write is work/' + B + '-read-slice-<i>.json (the index is given below) and nothing else - no reports, no scratch files, no notes anywhere else.',
].join('\n\n')

const READ_STEPS_WG = [
  'For EACH record, do all three reads and compare:',
  '1. OURS: the batch packet ' + PACKET + ' (read it) already holds each record\'s printed text, our fields (ourFields), the registries that mention it (ourRegistries) and their flattened encoding (theirEncoding). Then dump the full record from public/core.json (8 MB minified - never read it raw): node -e "const c=require(\'./public/core.json\');console.log(JSON.stringify(c[\'<bucket>\'][\'<id>\']))" and its description: node -e "const d=require(\'./public/core-descriptions.json\');console.log(JSON.stringify(d[\'<bucket>/<id>\']))".',
  '2. THEIRS: node scripts/wg-show.mjs "<Name>" --raw prints Wanderer\'s Guide\'s raw operations for the row (items live in their item table, feats and class features in ability_block).',
  '3. PRINT: the AoN mirror at ' + MIRROR + '\\<category>\\<aonId>.json where <aonId> is the record\'s own aonId field and <category> is that id without its trailing number (equipment-123 -> equipment/equipment-123.json; class-feature-N, feat-N, shield-N, weapon-N, armor-N). The markdown/text field is the printed text; the packet\'s printed field is the same text and is fine unless it looks truncated or the record has a table.',
].join('\n')

const READ_STEPS_PRINT = [
  'This is the PRINT-READ lane: there is NO Wanderer\'s Guide side. Do NOT run wg-show.mjs and do not reason about their encoding at all. Do exactly two reads and compare:',
  '1. OURS: the packet ' + PACKET + ' (read it) holds each record\'s printed text, our fields (ourFields) and the registries that mention it (ourRegistries). Then dump the full record from public/core.json (8 MB minified - never read it raw): node -e "const c=require(\'./public/core.json\');console.log(JSON.stringify(c[\'<bucket>\'][\'<id>\']))" and its description: node -e "const d=require(\'./public/core-descriptions.json\');console.log(JSON.stringify(d[\'<bucket>/<id>\']))".',
  '2. PRINT: the AoN mirror at ' + MIRROR + '\\<category>\\<aonId>.json where <aonId> is the record\'s own aonId field and <category> is that id without its trailing number. The markdown/text field is the printed text; the packet\'s printed field is the same text and is fine unless it looks truncated or the record has a table.',
].join('\n')

const KINDS_WG = [
  'Emit a finding for every one of these, and nothing else:',
  '(a) THEIR encoding delivers a mechanic ours does not - the mandate is exact parity: we adopt theirs. Include their exact op.',
  '(b) OURS contradicts the printed text (wrong number, wrong rank, wrong level, wrong skill or target, a missing or extra grant).',
  '(c) The printed text states a mechanic NEITHER side models and a player would miss it (the residual-read lane).',
  '(d) OURS delivers something that DUPLICATES what another of our carriers already delivers for the same record.',
  '(e) WG contradicts the printed text - askOwner:true, propose nothing, never side against print. (Rule R10: where WG merely encodes LESS than print, that is parity, not a question; only a print-CONTRADICTING encoding is a question.)',
  '(f) The instrument flag listed for a record is wrong (the comparer misread a carrier) - say so with proposal "instrument: ..." so the settle can be written.',
].join('\n')

const KINDS_PRINT = [
  'Emit a finding for every one of these, and nothing else. Kinds (a), (e) and (f) DO NOT EXIST in this lane (there is no their-side and no comparer run): never emit one, always set theirs to "" and askOwner to false.',
  '(b) OURS contradicts the printed text (wrong number, wrong rank, wrong level, wrong skill or target, a missing or extra grant).',
  '(c) The printed text states a mechanic OURS does not model and a player would miss it (the residual-read lane).',
  '(d) OURS delivers something that DUPLICATES what another of our carriers already delivers for the same record.',
].join('\n')

const CARRIERS = [
  'BEFORE claiming ours lacks a mechanic, sweep the carriers that bucket can use.',
  'ITEMS: passiveEffects (skills/AC/saves/speed/HP/resistances), the situational registry src/rules/situationalBonuses.ts (entries keyed by record id: value, target skill/stat/strikeDamage, condition text), counters + activationCost + frequency, innateSpells, heldSpells, spellSlotBonus, resonant (the aeon-stone lane - grep resonant in src/rules), grantsItems, grantedStrikes, recordMarks + RECORD_MARKERS, src/rules/itemAliases.ts, investmentGroup, shield fields (acBonus/hardness/hp/brokenThreshold), builtInRunes, the core.json modes bucket (fromItemId).',
  'CLASS FEATURES: a proficiency-rank increase a feature prints is delivered by the OWNING CLASS\'s table in src/rules/advancement.ts (keyed by class, not on the feature record - check the rank at the feature\'s level for EVERY class that owns the feature), degreeShifts (success-to-critical rules), src/rules/featGrantsAuto.ts, src/rules/classResources.ts (focus points - the focus trait on a spell marks it point-costing), choice lanes (effectChoices on the record, and class-specific picks in src/rules/build.ts + src/builder/Builder.tsx / shared.tsx - grep the feature id and its key words), spell-grant lanes (grep grantsSpells, grantedSpells, innateSpells, spellsByLevel, grantedByRank in src/rules/build.ts), weapon specialization in src/rules/derive.ts.',
  'FEATS: skillSubstitutions, speedsIf, situationalBonuses.ts, src/rules/featFeatGrants.ts, featGrantsAuto.ts, degreeShifts, passiveEffects, recordMarks.',
  'Grep the field name in src/rules/build.ts or derive.ts to confirm a field has a READER - a field with no reader anywhere IS a finding ("no reader").',
  'Known false-positive classes, check them before you write a finding: a mechanic delivered by a CLASS TABLE or by another record rather than this one; LEGACY pre-remaster text quoted against a remaster record (check edition + aonId); a situational entry keyed by an alias in src/rules/itemAliases.ts.',
].join('\n')

const FINDING_SHAPE = [
  'Write work/' + B + '-read-slice-<i>.json containing EXACTLY {"findings":[...]} where each finding is',
  '{"id": "<record id, with a #aspect suffix when one record has several findings - never a batch prefix>", "claim": "<one-sentence defect statement>", "printed": "<the exact printed sentence(s), verbatim>", "ours": "<what we carry>", "theirs": "<their exact op, or empty in the print lane>", "proposal": "<the concrete fix: field, value and which lane/file; or \'instrument: <what the comparer misread>\'>", "playerVisible": <boolean>, "askOwner": <boolean, true ONLY if WG contradicts print>}.',
  'A record with no findings appears nowhere. Be precise: quote print verbatim, name fields exactly, cite their op exactly.',
  'Then return, through the structured output tool, the file path you wrote and the number of findings in it.',
].join('\n')

const readStage = (slice, _item, i) => agent([
  READ_HEAD.replace('<i>', String(i + 1)),
  PRINT ? READ_STEPS_PRINT : READ_STEPS_WG,
  PRINT ? KINDS_PRINT : KINDS_WG,
  CARRIERS,
  'Records for this slice (bucket | id | name | instrument flags from the baseline digest, which you must ADJUDICATE: real gap, instrument misread, or WG-vs-print):\n' +
    slice.map((r) => (r.bucket || '?') + ' | ' + r.id + ' | ' + (r.name || r.id) + ' | ' + (r.flags ? r.flags : '(no comparer flag - read against print anyway)')).join('\n'),
  FINDING_SHAPE.split('<i>').join(String(i + 1)),
].join('\n\n'), { label: 'read:' + (i + 1), phase: 'Read', model: 'opus', effort: 'high', agentType: 'general-purpose', schema: SLICE_OUT })

const verifyReadStage = (_prev, slice, i) => agent([
  'Repo: ' + REPO + ' (work from this root). You are the ADVERSARIAL VERIFIER in the parity pipeline, batch ' + BATCH + ' (' + LANE + '), slice ' + (i + 1) + '.',
  'Your default is REFUTED - a finding survives only if you fail to break it.',
  'INVESTIGATION ONLY: modify no repo file. ' + NEVER,
  'The ONLY file you write is work/' + B + '-verify-slice-' + (i + 1) + '.json and nothing else.',
  'Read the findings from work/' + B + '-read-slice-' + (i + 1) + '.json. If that file does not exist or holds no findings, write {"verdicts":[]} and say so.',
  'For each finding: re-read the printed text YOURSELF (the AoN mirror ' + MIRROR + '\\<category>\\<aonId>.json - get aonId with node -e "const c=require(\'./public/core.json\');console.log(c[\'<bucket>\'][\'<id>\'].aonId)", never read that 8 MB file raw; the packet ' + PACKET + ' also carries the printed text)' + (PRINT ? '' : ', re-run node scripts/wg-show.mjs "<name>" --raw when the claim cites their side') + ', and sweep ALL our carriers before accepting any "we lack it" claim: the record itself (dump it), src/rules/situationalBonuses.ts (entries keyed by record id), src/rules/advancement.ts (class tables deliver the rank increases class features print - check EVERY owning class at the feature\'s level), degreeShifts, featGrantsAuto.ts, featFeatGrants.ts, classResources.ts, the spell-grant lanes in src/rules/build.ts, resonant / itemAliases / grantsItems / grantedStrikes / recordMarks / speedsIf / skillSubstitutions readers, and the builder controls in src/builder/Builder.tsx + shared.tsx.',
  'Known false-positive classes: a mechanic delivered by a CLASS TABLE or another record rather than this record; the reader quoting LEGACY pre-remaster text while our record is the remaster edition (check edition + aonId); a situational entry keyed by an alias (src/rules/itemAliases.ts)' + (PRINT ? '.' : '; WG encoding LESS than print (that is parity, not a finding).'),
  (PRINT ? 'This lane has no their-side: REFUTE on sight any finding that cites Wanderer\'s Guide, sets theirs to anything but the empty string, or sets askOwner true.' : ''),
  'Write work/' + B + '-verify-slice-' + (i + 1) + '.json containing EXACTLY {"verdicts":[{"id": "<same id>", "claim": "<same claim>", "verdict": "CONFIRMED" | "REFUTED", "evidence": "<what you re-read and what it showed, one or two sentences>"}]} - one verdict for EVERY finding, same order.',
  'Then return, through the structured output tool, that file path and the number of verdicts in it (note = how many you REFUTED).',
].join('\n\n'), { label: 'verify:' + (i + 1), phase: 'Verify read', model: 'opus', effort: 'high', agentType: 'general-purpose', schema: SLICE_OUT })

const sliceResults = await pipeline(SLICES, readStage, verifyReadStage)
log('read+verify done: ' + sliceResults.filter(Boolean).length + '/' + SLICES.length + ' slices returned')

// ---------------------------------------------------------------- 3. runner: read-digest

phase('Read digest')
const readDigest = await agent([
  'You are the RUNNER for parity batch ' + BATCH + ' (' + LANE + '). Repo: ' + REPO + '. You run the driver and report; you author nothing.',
  NEVER,
  'Run: ' + DRIVER + ' --stage read-digest' + PRINT_FLAG,
  'It merges every work/' + B + '-read-slice-*.json against its work/' + B + '-verify-slice-*.json into work/' + B + '-read.json and work/' + B + '-read-summary.txt. The merge rule: a finding with askOwner goes to askOwner[], a REFUTED verdict to refuted[], everything else to confirmed[] with verdict CONFIRMED or UNVERIFIED. There are ' + SLICES.length + ' slices; if the stage reports fewer slice files than that, report ok:false and name the missing indices in stopped rather than proceeding.',
  PRINT ? 'This is the PRINT-READ lane, and the lanes must not share one green report: check that work/' + B + '-run.json DISCLOSES it. The disclosure the driver writes is on the baseline entry - its digest reads "PRINT LANE: skipped ..." and names the THEIRS-dependent steps that did not run. Confirm that line is there. If NO entry in the file discloses the print lane, report ok:false with "the print lane is not disclosed in the digest" in stopped rather than letting this batch\'s report stand for the WG lane. The read-digest entry itself carries only counts - its silence is not the failure; a run.json with no disclosure anywhere is.' : '',
  'Then read work/' + B + '-run.json and return the entries this stage appended, verbatim, as runJson.',
  'Also return the FAMILY LIST. DO NOT ROUTE IT YOURSELF: work/' + B + '-read-summary.txt now carries a "== FAMILIES" block, written by the driver from the FAMILY_RULES table in scripts/wg-batch-run.mjs (first rule wins, exactly one family per finding, a family with no findings omitted). Read that block and return it verbatim as the families array - one entry per line, family = the name before the parenthesis, findingIds = the comma-separated ids after the colon. Copy it; do not re-adjudicate it, do not add a family it omits, and do not move an id between families. If the block is MISSING from the summary, report ok:false with "the read summary has no == FAMILIES block" in stopped rather than routing by hand - hand routing is exactly the step this block removed, and the builders take these ids as their assignment.',
].join('\n\n'), Object.assign({ label: 'runner:read-digest', phase: 'Read digest', schema: DIGEST_OUT }, RUNNER))

if (!readDigest || !readDigest.ok) {
  log('read-digest failed - stopping: ' + ((readDigest && readDigest.stopped) || 'no runner result'))
  return { batch: BATCH, runJsonTail: (readDigest && readDigest.runJson) || cut.runJson, closerNotes: '', verifierReport: 'STOPPED at read-digest: ' + ((readDigest && readDigest.stopped) || 'runner returned nothing') }
}

const families = (readDigest.families || []).filter((f) => f && f.family)
const FAMILIES = families.length ? families : DEFAULT_FAMILIES.map((f) => ({ family: f, findingIds: [] }))
log('families: ' + FAMILIES.map((f) => f.family + '(' + (f.findingIds || []).length + ')').join(', '))

// ---------------------------------------------------------------- 4. builders by family -> build-verifiers

const FAMILY_FILES = {
  'data-rows': 'Files you may write: your spec work/' + B + '-rows.json, prose for CREATED records work/' + B + '-created-desc.json (a SEPARATE spec of {category,id,field:"description",value} rows - a create row never carries a description), and your tests test/batch' + BATCH + '-data.test.ts. You modify NO src/ or scripts/ file and you never write scripts/data/effect-backfill.json - the driver applies your spec. Your tests may be written now and will only pass after the driver applies your rows: write them to read public/core.json through content() and assert the authored fields, and run them only to confirm they fail for the right reason.',
  instruments: 'Files you may edit: scripts/wg-diff.mjs, scripts/wg-values.mjs, scripts/wg-identity.mjs, scripts/wg-casting.mjs, scripts/lib/wg-experience-lanes.mjs, work/experience-instrument-limits.json, test/wg-experience-lanes.test.ts (append only) and test/batch' + BATCH + '-instruments.test.ts (new). Settle registries: VERIFIED_EQUIVALENT (wg-diff), SETTLED_VALUES / NOT_A_SCALAR (wg-values), SETTLED_IDENTITIES (wg-identity) - read their existing entries for the exact shape. Prefer ONE TEACH over N settles, and measure the blast radius: a teach that hides a REAL gap is the failure mode, so pick records whose carrier does NOT reach the printed value and prove they are still flagged. Never use the word "verified" inside a settle comment - write "adversarially confirmed". Every teach and every settle needs a MUTATION-PROOF test (a test that fails when the taught carrier is removed from a content copy in memory) or scripts/test-flip-audit.mjs will fail the batch. After your changes run node scripts/wg-diff.mjs, wg-values.mjs, wg-identity.mjs and wg-casting.mjs on ' + PACKET + ' and on the two previous batch packets, and report before/after counts per comparer to prove no earlier batch flipped.',
  situational: 'Files you may edit: src/rules/situationalBonuses.ts, the exclusion list of scripts/apply-situational-lane.mjs (for deletions only - read that script\'s header first: generated FEAT_SITUATIONAL rows come back unless their ids are excluded), and test/batch' + BATCH + '-situational.test.ts (new). Every entry gets a test that builds the character (or the companion) and finds the clause on the DERIVED sheet through the same reader the sheet uses.',
  engine: 'Files you may edit: src/rules/types.ts, src/rules/build.ts, src/rules/derive.ts, src/rules/spellcasting.ts, src/rules/advancement.ts, src/builder/Builder.tsx and src/builder/shared.tsx (only where a lane needs a control), and test/batch' + BATCH + '-engine.test.ts (new). Every reader you add or widen is exercised by a test on a BUILT character, never by reading fields, and every widening states its blast radius (which existing records change behaviour) in the report. Where the mechanic needs a data row too, the row is the data-rows family\'s: name it in DATA STILL NEEDED and test with the field patched into a content copy in memory.',
  repair: 'Files you may write: a new scripts/repair-<what>.mjs (dry-run by default, --write never invoked by you), scripts/dropped-inline-check.mjs (add a hole class with its own baseline constant set to the count you MEASURE - the ratchet fails when the count RISES, and the comment says the repair script drives it to zero), your spec work/' + B + '-rows-repair.json, and test/batch' + BATCH + '-repair.test.ts (the matcher on fixture sentence pairs: it restores exactly the missing tokens and leaves an already-correct sentence alone). A repair script rewrites OUR current wording by restoring the missing tokens - it never replaces a description with mirror text.',
}

const MANIFEST_RULE = [
  'WHEN YOU ARE DONE, in this order:',
  '1. Write your report to work/' + B + '-report-<family>.txt: per finding id - what you did (file + symbol, or the row), the test that pins it, anything you could not do and why. Start the report with a "DATA STILL NEEDED" list (rows the driver must author: exact category/id/field/value) and a "CROSS-FILE GAPS" list (things outside your files), one line each, and write the two headers even when the lists are empty.',
  '2. Append your manifest entry to work/' + B + '-specs.json for EACH spec file you wrote: {"file": "work/' + B + '-rows-<family>.json", "kind": "rows" | "created-prose", "family": "<family>", "stage": ["every path the commit must stage for your work - your spec files, your test files, every src/ or scripts/ file you edited"]}. Read the file immediately before writing it, keep every entry already in it, and write the whole array back; if it does not exist, create it as a JSON array. Never remove or rewrite another family\'s entry.',
  '3. Declare supersedes: true on every row that replaces an existing scripts/data/effect-backfill.json row for the same category/id/field/path key, and carry the superseded value merged whole into yours. The driver hard-refuses an undeclared replacement, a collision between two specs, a pathless whole-value row over a path:[...,"id=..."] row (or the reverse), a description/descRefs row that carries a path, and a why that names no AoN doc id.',
  '4. Spec format (each file): {"findings":[{"id":"<finding id>","backfillRows":[{category,id,field,value,why} | {category,id,create:true,value:{...},why} | {category,id,delete:true,why}],"note":"why this shape"}]}. A finding that correctly needs NO row still gets an entry with backfillRows: [] and a note saying why (a residual read, an instrument settle, a code-only fix).',
  'Then return, through the structured output tool, your family name, your report path, your spec file paths, and how many DATA STILL NEEDED + CROSS-FILE GAPS lines your report carries.',
].join('\n')

const buildStage = (fam) => agent([
  RULES,
  'YOU ARE THE ' + fam.family.toUpperCase() + ' BUILDER for parity batch ' + BATCH + ' (' + LANE + ').',
  ((fam.findingIds || []).length
    ? 'YOUR FINDINGS ARE EXACTLY THESE IDS, and this list is the assignment: ' + fam.findingIds.join(', ') + '. Read each one IN FULL in work/' + B + '-read.json (the confirmed[] entries; work/' + B + '-read-summary.txt prints the same claims with their proposals) before you touch anything. Do not take a finding assigned to another family, and do not silently drop one of yours - a finding you believe belongs elsewhere goes in CROSS-FILE GAPS naming the family you think owns it.'
    : 'No finding ids were routed to "' + fam.family + '". Read work/' + B + '-read.json and work/' + B + '-read-summary.txt in full and take ONLY the confirmed findings whose proposal targets this family\'s files (below); if none do, write your report with both lists empty and an explicit "no findings routed to this family" line, and author nothing.'),
  FAMILY_FILES[fam.family] || 'Files you may edit: exactly the files work/' + B + '-read-summary.txt names for your family, plus your own spec work/' + B + '-rows-' + fam.family + '.json and a new test file test/batch' + BATCH + '-' + fam.family + '.test.ts. Nothing else.',
  MANIFEST_RULE,
].join('\n\n'), { label: 'build:' + fam.family, phase: 'Build', model: 'opus', effort: 'high', schema: FAMILY_OUT })

const verifyBuildStage = (built, fam) => agent([
  RULES,
  'You are an ADVERSARIAL VERIFIER for parity batch ' + BATCH + ' (' + LANE + '), family "' + fam.family + '". Do not take the builder\'s report on trust: your default is that the work is NOT done.',
  'Re-read each of the family\'s findings in work/' + B + '-read.json and work/' + B + '-read-summary.txt, open every changed file, run npx tsc --noEmit and the family\'s test files through node scripts/vt.mjs (one vitest process at a time), and for EACH finding decide: DONE (the printed mechanic now reaches a BUILT character, or the comparer now reads the carrier), WRONG (the change contradicts print or breaks a sibling - fix it directly under the same rules and add a test), or NOT DONE (say exactly what is missing).',
  'Verify the SPEC ROWS as rows, without applying them: every target record exists or the row carries create:true; every re-emitted value still holds everything it held before minus exactly the intended change (diff each against the shipped value with node -e); a reader exists for every field or is named as another family\'s; no two rows in any spec hit the same record+field+path key; created records carry no description in the create row and have their prose in the created-prose spec; every spell / action / trait / item id a row names exists in core.json. Where a mechanic can be exercised, build a throwaway in-memory harness that applies the rows to a content copy and builds a real character - then delete the harness.',
  'Check the manifest: work/' + B + '-specs.json still contains every other family\'s entry, this family\'s entry lists every path it touched in stage[], and every superseding row declares supersedes: true.',
  'Write your verdicts to work/' + B + '-verify-' + fam.family + '.txt: per finding id - DONE / FIXED-BY-ME / NOT-DONE with one line of evidence; end with the same two lists the builder wrote, DATA STILL NEEDED and CROSS-FILE GAPS, corrected by what you found. If you fixed anything, append your own manifest stage[] paths for the files you touched.',
  'The builder\'s report path was: ' + ((built && built.report) || 'work/' + B + '-report-' + fam.family + '.txt') + ' - read it, and read its spec files: ' + (((built && built.specFiles) || []).join(', ') || '(the builder returned none - check the manifest)') + '.',
  'Then return, through the structured output tool: family, report = the path of the verify file you wrote, specFiles = the spec files you checked, gapsOpen = how many lines still stand in the two lists.',
].join('\n\n'), { label: 'verify:' + fam.family, phase: 'Verify build', model: 'opus', effort: 'high', schema: FAMILY_OUT })

phase('Build')
const familyResults = await pipeline(FAMILIES, buildStage, verifyBuildStage)
log('families built+verified: ' + familyResults.filter(Boolean).length + '/' + FAMILIES.length)

// ---------------------------------------------------------------- 5. runner: apply-digest

phase('Apply digest')
const applyDigest = await agent([
  'You are the RUNNER for parity batch ' + BATCH + ' (' + LANE + '). Repo: ' + REPO + '. You run the driver and report; you author nothing.',
  NEVER,
  'Run: ' + DRIVER + ' --stage apply-digest' + PRINT_FLAG,
  'It turns the family reports and verify files into work/' + B + '-apply.json and collates every DATA STILL NEEDED / CROSS-FILE GAPS line into work/' + B + '-gaps.json as [{family, kind, line, status:"open", ref}].',
  'Then read work/' + B + '-run.json and return the entries this stage appended, verbatim, as runJson. Also read work/' + B + '-gaps.json and return gapFamilies: the distinct family names that still have at least one line with status "open" (empty array if none).',
].join('\n\n'), Object.assign({ label: 'runner:apply-digest', phase: 'Apply digest', schema: APPLY_DIGEST_OUT }, RUNNER))

// A failed apply-digest must STOP the run, not fall through: it is the stage that writes the gaps file,
// and the driver's gaps stage reads a missing gaps file as an empty list and passes. Falling through
// would turn every DATA STILL NEEDED line into a green stage.
if (!applyDigest || !applyDigest.ok) {
  log('apply-digest failed - stopping: ' + ((applyDigest && applyDigest.stopped) || 'no runner result'))
  return {
    batch: BATCH,
    runJsonTail: (applyDigest && applyDigest.runJson) || readDigest.runJson,
    closerNotes: '',
    verifierReport: 'STOPPED at apply-digest (the families built; nothing was applied): ' + ((applyDigest && applyDigest.stopped) || 'runner returned nothing'),
  }
}

const gapFamilies = (applyDigest.gapFamilies || []).filter(Boolean)
log(gapFamilies.length ? 'open gap families: ' + gapFamilies.join(', ') : 'no open gap lines')

// ---------------------------------------------------------------- 6. gap agents + gap-verifier

if (gapFamilies.length) {
  phase('Gaps')
  // parallel(), not pipeline(): the single gap-verifier needs every family's gap pass at once.
  await parallel(gapFamilies.map((fam) => () => agent([
    RULES,
    'YOU ARE THE GAP AGENT for family "' + fam + '", parity batch ' + BATCH + ' (' + LANE + '). The driver\'s gaps stage REFUSES to proceed while any line is status "open", so every open line of your family in work/' + B + '-gaps.json ends this run either AUTHORED or PARKED - never as prose.',
    'For each open line of your family:',
    'AUTHORED means you produced the thing: rows go into a new spec work/' + B + '-rows-gap-' + fam + '.json in the standard spec format, with a manifest entry appended to work/' + B + '-specs.json ({file, kind, family: "gap-' + fam + '", stage: [paths]}) exactly as the builders do (re-read the manifest immediately before writing it and keep every existing entry); a code fix goes in the file the line names, under the same rules, with a test that pins it.',
    'PARKED means the line cannot be closed here and says so with a reference: an owner question (WG contradicts print, a ruling conflict, an engine-shape decision) becomes an entry in work/' + B + '-queue.json - [{id, batch, printed, theirs, ours, question}] - which is the ONLY way you may ask an owner anything; you never touch work/owner-questions.json, the driver\'s gaps stage feeds your queue through scripts/add-owner-question.mjs. A measurement or an unmodelled mechanic that is genuinely out of scope becomes a flaggedResidue line with a reason.',
    'Then rewrite work/' + B + '-gaps.json setting each of YOUR family\'s lines to status "authored" or "parked" with ref naming the spec file / file:symbol / queue id / residue line that closes it. Read the file immediately before writing it and leave every other family\'s line exactly as it was.',
    'Write your report to work/' + B + '-report-gap-' + fam + '.txt: one line per gap line - AUTHORED or PARKED, the ref, and one sentence of why. Then return, through the structured output tool: family = "gap-' + fam + '", report = that path, specFiles = the spec files you wrote (empty array if none), gapsOpen = how many of your lines are still open (this must be 0).',
  ].join('\n\n'), { label: 'gap:' + fam, phase: 'Gaps', model: 'opus', effort: 'high', schema: FAMILY_OUT })))

  const gapVerifier = await agent([
    RULES,
    'You are the GAP VERIFIER for parity batch ' + BATCH + ' (' + LANE + '). Default: REFUTE. A gap line counts as closed only if you can point at the artefact that closes it.',
    'Read work/' + B + '-gaps.json in full. For EVERY line, whatever its status:',
    '- status "authored": open the ref. The spec file must exist, be valid JSON in the spec format, and its rows must target records that exist; the manifest work/' + B + '-specs.json must carry its entry with stage[] paths; a code ref must exist at that file:symbol and have a test that fails when the change is reverted. If any of that is missing, set the line back to "open" and say why in your report.',
    '- status "parked": the ref must be a real entry in work/' + B + '-queue.json (with printed, theirs, ours and a question that a print citation cannot already answer) or a flaggedResidue line with a reason. A line parked because "it is out of scope" with no artefact goes back to "open".',
    '- status "open": name it - the driver will refuse, and the closer needs to know now.',
    'Confirm nobody edited work/owner-questions.json (git diff it against HEAD) and that no gap agent removed another family\'s manifest entry or gap line.',
    'Write work/' + B + '-verify-gaps.txt with one line per gap line: CLOSED / REOPENED / STILL-OPEN, the ref, and the evidence. Then return, through the structured output tool: family = "gaps", report = that path, specFiles = the spec files you checked, gapsOpen = how many lines are open after your pass.',
  ].join('\n\n'), { label: 'verify:gaps', phase: 'Gaps', model: 'opus', effort: 'high', schema: FAMILY_OUT })
  log('gap pass done; lines still open after verify: ' + ((gapVerifier && gapVerifier.gapsOpen) != null ? gapVerifier.gapsOpen : 'unknown'))
}

// ---------------------------------------------------------------- 7. closer

phase('Close')
const closer = await agent([
  RULES,
  'YOU ARE THE CLOSER for parity batch ' + BATCH + ' (' + LANE + '). Everything the families built is on disk; your job is to drive it home and to leave Fable nothing to do but read work/' + B + '-run.json and approve the commit. These rules are numbered because each one is a thing that went wrong in an earlier batch:',
  '1. Run the driver ONE STAGE AT A TIME, in this order, and read work/' + B + '-run.json after each: apply, gaps, close, experience, gate, regate, suite, verify. Command: ' + DRIVER + ' --stage <stage>' + PRINT_FLAG + '. Never run --stage all, never run two stages at once, never run anything in the background and never work around a refusal.',
  '2. The driver takes the heavy-job lock and waits on it - a quiet stage is a waiting stage, not a hung one. One bounded retry is allowed for a forks-worker failure in the experience stage and for nothing else.',
  '3. A stage that refuses has named the offending ids. Fix the CAUSE (the spec row, the missing supersedes, the unauthored gap line, the flip without a citation) and re-run that stage. Never edit a guard, a ratchet baseline, a settle registry or a test to make a stage pass without a citation - see rule 6.',
  '3b. EVIDENCE FOLLOWS EDITS. Any edit you make under src/ or to public/core.json AFTER the experience stage has run (a suite-triage fix, a trimmed registry string, anything) invalidates the EXPERIENCE evidence: gate 9 compares the artefact\'s observed time against the newest source mtime and goes red. Batch 030 ended with a red gate exactly this way. So after such an edit, re-run --stage experience and then --stage gate before you go on to suite / verify, and never leave a red gate as the batch\'s final state.',
  '4. ' + NEVER,
  '5. Any stage that stops with "needs the orchestrator" (a create-row correction, a row removal, anything that needs npm run data, an owner-question wording, an engine-shape decision, a ruling conflict) STOPS THERE: put it in needsOrchestrator and do not attempt it. That is Fable\'s half of the protocol, not yours.',
  '6. Every flip is cited or it does not happen, in these EXACT forms - scripts/test-flip-audit.mjs --batch ' + BATCH + ' parses them: each changed or removed it( / expect( / settle-registry entry / ratchet constant sits within 6 lines below a comment "// batch ' + BATCH + ': <finding id>", where <finding id> comes from confirmed[] in work/' + B + '-read.json and that finding\'s RECORD id appears in the enclosing describe/it title; or, where print is the authority and no finding covers it, "// batch ' + BATCH + ' premise: <AoN doc id> \\"<clause>\\"" with the doc id in the AoN mirror and the clause quoted verbatim from it. Every test that proves a new settle or comparer teach still reports on a STUNTED copy carries the marker comment "// mutation-proof" in its body naming the settle key it stunts. No new .skip / .only / .todo, no deleted test file or describe block, no changed numeric literal inside an otherwise unchanged it(. A settle or teach with no mutation-proof test fails the audit - add the test rather than the exemption. "// Batch 29: <prose>" is not one of these forms.',
  '6b. A teach line in work/' + B + '-report-<family>.txt must name the FINDING id, not just the record id: scripts/wg-batch-close.mjs derives MATCHES from exactly that, and a record-only line turns every sibling finding on that record into MATCHES as well. If a family report you inherit names only the record, fix the line and say so in your notes.',
  '7. Your own src/ or scripts/ edits are LISTED: return closerEdits[] as {file, why (quote the printed clause or the refusal you were fixing), test (the test file and the it( name that pins it)}. An edit with no test does not ship. AND every file you create or edit - the src/ edit, its test file, a settle you add - goes into the manifest work/' + B + '-specs.json: append its path to the stage[] of the family whose finding you were closing (re-read the file immediately before writing it, keep every entry). Batch 030\'s closer wrote test/batch030-closer.test.ts and never listed it, so the commit script did not stage it and the mutation-proof test for its settle stayed out of history until a later commit picked it up.',
  '8. The regate stage is blocking: a newly failing EARLIER-batch record needs a disposition line (fixed here / queued with its owner-question n / next batch) in your notes, and you may not settle an id outside batch ' + BATCH + '.',
  '9. The close stage derives work/wg-batch-' + BATCH + '-parity.json and -residual.json from work/' + B + '-read.json plus the manifest - never hand-write them, never overwrite an existing verdict.',
  '10. Write work/' + B + '-commit.txt: the commit message, at least 200 characters, saying what the batch changed (families, row count, code lanes), what it settled and why, what is queued for the owner, and what is deferred. It is read by scripts/wg-batch-commit.mjs, which you do NOT run - the verify stage\'s "next" line names that script because it is the NEXT step in the protocol, and that step is Fable\'s: she approves the commit. Running it would stage and commit this batch unapproved. You run no git write command and no commit script.',
  '11. Your notes are displayed but never load-bearing: keep them under 3000 characters and put every fact that matters into the run.json digest, the reports and the commit file instead.',
  'Return, through the structured output tool: notes, closerEdits[], needsOrchestrator[] and commitChars (the length of work/' + B + '-commit.txt).',
].join('\n\n'), Object.assign({ label: 'closer', phase: 'Close', schema: CLOSER_OUT }, OPUS))

// ---------------------------------------------------------------- 8. close-verifier

phase('Verify close')
const closeVerifier = await agent([
  RULES,
  'You are the CLOSE-VERIFIER for parity batch ' + BATCH + ' (' + LANE + '). DEFAULT: REFUTE. The closer\'s notes are a claim, not evidence; your verdict is CONFIRMED only when every check below produced its own evidence in your hands.',
  'Do all of this:',
  '1. Re-run node scripts/test-flip-audit.mjs --batch ' + BATCH + ', ' + DRIVER + ' --stage gate' + PRINT_FLAG + ' and ' + DRIVER + ' --stage verify' + PRINT_FLAG + ', and QUOTE each stage\'s runId out of the work/' + B + '-run.json entries YOUR runs appended (a runId the closer produced is not evidence that you re-ran anything).',
  '2. Diff work/owner-questions.json against the batch-start commit recorded by the cut stage (git diff <startSha> -- work/owner-questions.json). Every added entry must have come through scripts/add-owner-question.mjs from work/' + B + '-queue.json, must carry a fresh n, and must not restate a question print already answers. Any hand edit is an automatic REFUTED.',
  '3. Read work/' + B + '-gaps.json: every line is "authored" or "parked" with a ref you opened and found real. One "open" line, or one ref that does not exist, is REFUTED.',
  '4. Check the git snapshots in work/' + B + '-run.json: HEAD unmoved across the whole run, git stash list unchanged, and no file the run log says changed is now byte-identical to HEAD (a change that vanished is a change that was reverted). Read git only - never run a git write command.',
  '5. Every new settle, teach or comparer exemption has a MUTATION-PROOF test: remove the taught carrier from a content copy in memory (or point the comparer at a mutated packet) and prove the test fails. A settle whose test passes with the carrier gone is not a test.',
  '6. Spot-check the closer\'s closerEdits[]: each file, each cited test, each printed clause. An edit that is not listed, or listed with a test that does not exist or does not fail when the edit is reverted, is REFUTED.',
  '7. Read work/' + B + '-commit.txt: at least 200 characters, and every claim in it traceable to the reports and the digest.',
  NEVER,
  'The closer returned these notes (a claim to be tested, not a source):\n---\n' + ((closer && closer.notes) || '(none)') + '\n---\nand these closerEdits: ' + JSON.stringify((closer && closer.closerEdits) || []) + '\nand flagged as needing the orchestrator: ' + JSON.stringify((closer && closer.needsOrchestrator) || []) + '.',
  'Return, through the structured output tool: verdict (CONFIRMED only if every check above passed with your own evidence), report (the evidence per numbered check, with the runIds you quoted, under 6000 characters), and needsOrchestrator[] - everything Fable must decide: owner-question wording, engine-shape decisions, ruling conflicts, npm run data decisions, and anything you could not close.',
].join('\n\n'), Object.assign({ label: 'close-verifier', phase: 'Verify close', schema: CLOSE_VERIFY_OUT }, OPUS))

// ---------------------------------------------------------------- 9. runner: final digest

phase('Final')
const final = await agent([
  'You are the RUNNER for parity batch ' + BATCH + ' (' + LANE + '). Repo: ' + REPO + '. You run nothing that writes; you report.',
  NEVER,
  'Read work/' + B + '-run.json and return, verbatim as runJson, the LAST entry of every distinct stage in the file (cut, baseline, read-digest, apply, apply-digest, gaps, close, experience, gate, regate, suite, verify), in the order the stages ran - the whole JSON objects, including runId, counts, digest, next, git, hashes and refusals. This is the only thing Fable reads, so drop nothing and summarise nothing.',
  'Set ok true only if the last entry of every stage that ran has ok:true, and put into stopped every "next" line that says the orchestrator is needed.',
].join('\n\n'), Object.assign({ label: 'runner:final', phase: 'Final', schema: RUN_TAIL }, RUNNER))

log('batch ' + BATCH + ' finished: close-verifier ' + ((closeVerifier && closeVerifier.verdict) || 'MISSING'))

return {
  batch: BATCH,
  runJsonTail: (final && final.runJson) || '',
  closerNotes: (closer && closer.notes) || '',
  verifierReport: ((closeVerifier && closeVerifier.verdict) || 'MISSING') + '\n' + ((closeVerifier && closeVerifier.report) || '') +
    '\nNEEDS THE ORCHESTRATOR: ' + JSON.stringify(((closeVerifier && closeVerifier.needsOrchestrator) || []).concat((closer && closer.needsOrchestrator) || [])),
}
