/*
 * BATCH 035 — GATE-RED, group "experience-hosts".
 *
 * Four records came into this round already PARKED as instrument limitations, each with a hand
 * verification in work/experience-instrument-limits.json and a verdict of UNSUPPORTED the gate records
 * without passing. This group's job was the optional half: LIFT the limit rather than rescue a red.
 * Both routes landed in test/wg-experience.harness.test.tsx —
 *
 *   route 4  `innovationModificationHost` — an inventor innovation MODIFICATION is a class feature of
 *            no class, no subclass option and no extraChoices group; the player holds it through
 *            inventorModificationOptions (build.ts:2753) on `c.inventor.modifications`.
 *   route 5  `featChoiceHost` — a class feature owned by a FEAT's `choice.ownsFeature`, which is how
 *            all nineteen witch lessons are held (choiceOwnedFeatureIds, derive.ts:3551).
 *
 * — and with them the sweep reports all four OK, delivered by the differential
 * (`node scripts/wg-experience.mjs --batch work/wg-batch-RED.json`, verdicts kept in
 * work/wg-batch-RED-experience.json). The routes themselves are pinned where they live, beside the
 * extraChoices route, WITH their mutation-proof halves. What is pinned HERE is the other half of the
 * lift, the half a green test run would otherwise never notice: the PARKS ARE GONE. A park that
 * outlives the blindness it describes is a gap in hiding — the gate never judges a record it lists,
 * so a record left parked after its host arrived would sail past gate 9 for free.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');
const limits = JSON.parse(readFileSync(join(CLI_ROOT, 'work/experience-instrument-limits.json'), 'utf8'));
const harness = readFileSync(join(CLI_ROOT, 'test/wg-experience.harness.test.tsx'), 'utf8');

describe('batch 035 red-experience-hosts — metallic-reactance, phlogistonic-regulator, lesson-of-vengeance and lesson-of-elements are hosted, so their parks are retired', () => {
  // batch 035: metallic-reactance#instrument
  it('metallic-reactance and phlogistonic-regulator are no longer in the experience limits file', () => {
    /* Their entries read "Remove an entry the moment the instrument can see the record (the gate then
     * judges it again)" — the file's own rule, in its `_` header. The instrument can see them. */
    // batch 035: phlogistonic-regulator#instrument
    for (const id of ['metallic-reactance', 'phlogistonic-regulator']) {
      expect(limits.records[id], `${id} is still parked though route 4 hosts it`).toBeUndefined();
    }
  });

  // batch 035: lesson-of-vengeance#experience-flag
  it('lesson-of-vengeance and lesson-of-elements are no longer in the experience limits file', () => {
    // batch 035: lesson-of-elements#experience-flag
    for (const id of ['lesson-of-vengeance', 'lesson-of-elements']) {
      expect(limits.records[id], `${id} is still parked though route 5 hosts it`).toBeUndefined();
    }
  });

  // batch 035: metallic-reactance#instrument
  it('the routes that unparked metallic-reactance and lesson-of-vengeance are still in the host search', () => {
    /*
     * The pairing this test exists for: four records were unparked BECAUSE the search learned two
     * routes, and nothing else in the suite fails if the routes are deleted and the parks stay gone —
     * the records would simply read UNSUPPORTED again and the gate would record it without failing.
     * So the route is guarded from the side that has no other guard, the same way instruments-1 guards
     * the extraChoices route: on the search body itself, sliced to the reason string it ends with.
     */
    const search = harness.slice(harness.indexOf('function classFeatureHost'), harness.indexOf("reason: 'no class or subclass grants this feature at level 20'"));
    // batch 035: lesson-of-vengeance#experience-flag
    expect(search).toContain('innovationModificationHost');
    expect(search).toContain('featChoiceHost');
    // …and both are real functions, not a stale mention in a comment.
    // batch 035: lesson-of-elements#experience-flag
    expect(harness).toContain('function innovationModificationHost');
    expect(harness).toContain('function featChoiceHost');
  });

  // batch 035: phlogistonic-regulator#instrument
  it('no other record was quietly unparked with phlogistonic-regulator — the extra-choice lane is untouched', () => {
    /* The four extraChoices-route records and the-oscillating-wave belong to other groups in this
     * round and this group must not have moved them. */
    // batch 035: metallic-reactance#instrument
    for (const id of ['wandering-reverie', 'gathered-lore', 'impostor-in-hidden-places', 'noble-branch']) {
      expect(limits.records[id]?.lane, `${id} lost its park`).toBe('harness-host-search-no-extra-choice-route');
    }
    // batch 035: phlogistonic-regulator#instrument
    expect(limits.records['the-oscillating-wave']?.verdict).toBe('NO-SHEET-EFFECT');
  });
});
