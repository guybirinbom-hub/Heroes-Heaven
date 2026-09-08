import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { content } from './_content';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { emptyBuild } from '../src/rules/build';

const c = content();

/*
 * AoN feat-5039 ("Knowledge is Power", Player Core pg. 203, Feat 8) is ONE printed feat with the
 * trait list ["Magus","Wizard"], and the app imported it twice: `knowledge-is-power` (traits
 * magus+wizard) and `knowledge-is-power-wizard` (trait wizard). The names differ — "Knowledge is
 * Power" against "Knowledge is Power (Wizard)" — so neither the exact-name pass nor the
 * grade-spelling pass in findDuplicateIds could pair them, and featSlots.ts offered a level-8 wizard
 * the same printed feat twice.
 *
 * `knowledge-is-power-wizard` is the hidden half BECAUSE OF THE TRAITS: hiding the two-trait record
 * instead would take the printed level-8 feat off every magus, and `knowledge-is-power-magus` cannot
 * stand in for it — that record is feat-9062 (Impossible Magic pg. 21), Feat 6, a different document.
 */
describe('knowledge-is-power is offered once, and to both printed classes', () => {
  // batch 032: knowledge-is-power
  it('offers a level-8 wizard exactly one Knowledge is Power, the magus+wizard record', () => {
    const build = { ...emptyBuild(), level: 8, classId: 'wizard', ancestryId: 'human' };
    const offered = eligibleFeatsForSlot(build, c, { level: 8, category: 'class', idx: 0 }).map((f) => f.id);
    expect(offered).toContain('knowledge-is-power');
    expect(offered).not.toContain('knowledge-is-power-wizard');
    // The symptom this closes: two rows reading "Knowledge is Power" in one picker.
    expect(offered.filter((id) => id.startsWith('knowledge-is-power'))).toEqual(['knowledge-is-power']);
  });

  // batch 032: knowledge-is-power
  it('still offers knowledge-is-power to a level-8 magus, which the other hide direction would not', () => {
    // Mirror feat-5039 trait_raw is ["Magus","Wizard"]; the kept record is the only one carrying both.
    expect(c.feats['knowledge-is-power'].traits).toEqual(expect.arrayContaining(['magus', 'wizard']));
    expect(c.feats['knowledge-is-power-wizard'].traits).not.toContain('magus');
    const build = { ...emptyBuild(), level: 8, classId: 'magus', ancestryId: 'human' };
    const offered = eligibleFeatsForSlot(build, c, { level: 8, category: 'class', idx: 0 }).map((f) => f.id);
    expect(offered).toContain('knowledge-is-power');
    // knowledge-is-power-magus is feat-9062, a DIFFERENT document, so it is no substitute.
    expect(c.feats['knowledge-is-power-magus'].aonId).toBe('feat-9062');
    expect(c.feats['knowledge-is-power'].aonId).toBe('feat-5039');
  });

  // batch 032: knowledge-is-power
  it('hides the twin rather than deleting it, so a saved character keeps its pick', () => {
    expect(c.duplicateIds!.has('knowledge-is-power-wizard')).toBe(true);
    expect(c.feats['knowledge-is-power-wizard']).toBeTruthy();
    expect(c.duplicateIds!.has('knowledge-is-power')).toBe(false);
  });

  /*
   * The one thing the hide would otherwise cost the player: the twin ships a clickable "Recall
   * Knowledge" ref-link and the kept record has none. feat-5039 hangs its whole effect on that
   * action — "When you critically succeed at a Recall Knowledge check about a creature…" — so the
   * link moves across on a descRefs overlay row. Asserted against the SPEC VALUE rather than a
   * shipped-vs-patched delta, so the case reads the same before and after the row is applied.
   */
  // batch 032: knowledge-is-power
  it('carries the twin descRefs across on a spec row, so the ref-link survives the hide', () => {
    const spec = JSON.parse(readFileSync('work/.b032-rows-gap-situational.json', 'utf8')) as {
      findings: { id: string; backfillRows: { category: string; id: string; field: string; value: unknown }[] }[];
    };
    const row = spec.findings
      .flatMap((f) => f.backfillRows)
      .find((r) => r.category === 'feats' && r.id === 'knowledge-is-power' && r.field === 'descRefs');
    expect(row, 'the gap spec must carry the descRefs row').toBeTruthy();
    expect(row!.value).toEqual(c.feats['knowledge-is-power-wizard'].descRefs);
    expect(row!.value).toEqual([{ label: 'Recall Knowledge', key: 'actions' }]);
    // And the field really is empty on the record the row targets, in the shipped copy or a patched
    // one — read off a COPY with the field stripped, so applying the row cannot flip this case.
    const stripped = { ...c.feats['knowledge-is-power'], descRefs: undefined };
    expect({ ...stripped, descRefs: row!.value }.descRefs).toEqual(c.feats['knowledge-is-power-wizard'].descRefs);
  });
});
