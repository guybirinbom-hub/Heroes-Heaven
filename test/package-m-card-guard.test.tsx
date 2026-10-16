import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASELINE, loadContent, loadDeps, loadTrees } from '../scripts/card-truth-check.mjs';
import { NEVER_BASELINED, baselineProblems, computeLedger, ownRecordUnlisted } from '../scripts/lib/card-scope.mjs';

/**
 * Package M (2026-10-16): the card guard's OWN-RECORD-UNLISTED rule (scripts/lib/card-scope.mjs
 * ownRecordUnlisted), beside CLASS_MISMATCH and NEVER BASELINED. A class lists a shared record — one whose
 * page is another class's — while a classFeatures record of the same base name whose page is the listing
 * class's exists. The swashbuckler listed weapon-expertise (class-feature-1178, "Class Thaumaturge":
 * "You've learned the secret ways your weapons work most effectively") while weapon-expertise-swashbuckler
 * (class-feature-1019, "Class Swashbuckler": "You gain access to the critical specialization effects of all
 * weapons for which you have expert proficiency") was listed by no class.
 *
 * `npm run verify`'s card-truth-check fails on any entry: computeLedger puts the rule's entries in
 * found['OWN-RECORD-UNLISTED'] and baselineProblems reports every one, whatever the baseline file lists
 * (and reports the baseline file if it ever lists one).
 *
 * MUTATION LINES (each measured red on 2026-10-16 under the heavy-job lock, then restored byte-exact from
 * the original bytes, sha1 checked; scratch pm-mutate.mjs runs C and D):
 *  - card-scope.mjs computeLedger: the `found['OWN-RECORD-UNLISTED'] = …` line removed → the wiring case red.
 *  - card-scope.mjs baselineProblems: the NEVER_BASELINED loop emptied → the baseline case and the wiring
 *    case red.
 *  - card-scope.mjs ownRecordUnlisted: the page-class test on the own record dropped → the live case red
 *    (every same-named record of another class counts), and the two planted cases with it.
 */
const LANE = process.cwd();
const db = loadContent(LANE) as { classes: Record<string, { id: string; name: string; features: { level: number; featureId: string }[] }> } & Record<string, unknown>;
const trees = loadTrees(LANE);

/** The data as it would be if the swashbuckler's list named the shared record again (a temp copy). */
function plantedSwashbuckler<T extends { classes: typeof db.classes }>(base: T): T {
  const swash = base.classes.swashbuckler;
  const features = swash.features.some((f) => f.featureId === 'weapon-expertise')
    ? swash.features
    : swash.features.map((f) => (f.featureId === 'weapon-expertise-swashbuckler' ? { ...f, featureId: 'weapon-expertise' } : f));
  return { ...base, classes: { ...base.classes, swashbuckler: { ...swash, features } } };
}
const PLANTED = 'classFeatures:weapon-expertise@swashbuckler→weapon-expertise-swashbuckler';

describe('package M guard: a class lists the shared record while its own printing exists (never baselined)', () => {
  it('the live data: no class lists a shared record over its own printing', () => {
    expect(ownRecordUnlisted(db, trees)).toEqual([]);
  });

  it('a planted copy where the swashbuckler lists weapon-expertise: red, naming its own record', () => {
    expect(ownRecordUnlisted(plantedSwashbuckler(db), trees)).toEqual([PLANTED]);
  });

  it('the magus listing the shared record over weapon-expertise-magus: red too (the rule is not the swashbuckler\'s alone)', () => {
    const mag = db.classes.magus;
    const planted = { ...db, classes: { ...db.classes, magus: { ...mag, features: mag.features.map((f) => (f.featureId === 'weapon-expertise-magus' ? { ...f, featureId: 'weapon-expertise' } : f)) } } };
    expect(ownRecordUnlisted(planted, trees)).toEqual(['classFeatures:weapon-expertise@magus→weapon-expertise-magus']);
  });

  it('no baseline can hold it: an entry is a problem even when the baseline lists it, and the listing is a problem too', () => {
    expect(NEVER_BASELINED).toContain('OWN-RECORD-UNLISTED');
    const found = { 'OWN-RECORD-UNLISTED': [PLANTED] };
    const unlisted = baselineProblems(found, {}, 'b.json');
    expect(unlisted.some((p: string) => p.includes(PLANTED) && /never baselined/.test(p))).toBe(true);
    const listed = baselineProblems(found, { 'OWN-RECORD-UNLISTED': [PLANTED] }, 'b.json');
    expect(listed.filter((p: string) => p.includes(PLANTED))).toHaveLength(2);
    expect(baselineProblems({ 'OWN-RECORD-UNLISTED': [] }, {}, 'b.json')).toEqual([]);
  });

  it('wired into card-truth-check: the whole ledger over the planted copy is red against the real baseline file', async () => {
    const deps = await loadDeps(LANE);
    const { found } = computeLedger({ ...deps, content: plantedSwashbuckler(deps.content) });
    expect(found['OWN-RECORD-UNLISTED']).toEqual([PLANTED]);
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const problems = baselineProblems(found, baseline, BASELINE).filter((p: string) => p.startsWith('OWN-RECORD-UNLISTED'));
    expect(problems).toEqual([expect.stringContaining(PLANTED)]);
  }, 600_000);
});
