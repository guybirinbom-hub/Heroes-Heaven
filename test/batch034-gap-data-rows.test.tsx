// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { ownedFeatureIds } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Batch-034, WG-comparison lane — the GAP-DATA-ROWS family.
 *
 * One line, raised twice (the data-rows builder's report and its verifier's): `grantsActions` had no
 * opposite number, so a record that REPLACES an action another record grants could only say so in
 * prose. Improved Familiar Attunement (AoN arcane-thesis-7) hands over Drain Familiar *"instead of
 * Drain Bonded Item"* and does NOT remove arcane bond — it retargets it — so the wizard rendered both
 * free actions, one of which they cannot use.
 *
 * The reader is src/sheet/MainTab.tsx's `replacedActionIds`, authored with this test. Its row
 * (classFeatures/improved-familiar-attunement.replacesActions) is in
 * work/.b034-rows-gap-data-rows.json and has not landed, and neither has the data-rows family's
 * `drain-familiar` create + grant — so every assertion here runs against a deep copy of `content()`
 * with those fields PATCHED IN MEMORY. Nothing flips when either spec is applied.
 */
const noop = () => undefined;

/**
 * A content copy carrying the data-rows family's Drain Familiar rows, with this family's
 * `replacesActions` row optional — the control that proves the suppression, and not the patch, is
 * what removes the row.
 */
function withDrainFamiliar(replaces: boolean): ContentDatabase {
  const con = JSON.parse(JSON.stringify(content())) as ContentDatabase;
  (con.actions as Record<string, unknown>)['drain-familiar'] = {
    id: 'drain-familiar',
    name: 'Drain Familiar',
    traits: ['arcane', 'wizard'],
    rarity: 'common',
    actionCost: { type: 'free' },
    source: { book: 'Pathfinder Player Core', license: 'ORC' },
    edition: 'remaster',
  };
  const thesis = con.classFeatures['improved-familiar-attunement'] as unknown as Record<string, unknown>;
  thesis.grantsActions = ['drain-familiar'];
  thesis.limitedUses = { max: 1, per: 'day' };
  /* CLOSER, batch 034: `replaces:false` must DELETE the field, not merely skip setting it. The row is
   * applied now, so the copy inherits `replacesActions` from the shipped record and the control case
   * silently stopped being a control — it asserted the pre-row behaviour against post-row data and
   * failed. Deleting makes the stunt bite whether or not the row has landed. */
  if (replaces) thesis.replacesActions = ['drain-bonded-item'];
  else delete thesis.replacesActions;
  return con;
}

/** A wizard whose 1st-level Arcane Thesis pick is Improved Familiar Attunement. */
const thesisWizard = () =>
  build('wizard', 5, { extraChoices: { thesis: ['improved-familiar-attunement'] } }) as Character;

/** The names on the Actions sub-tab's rows, in either the chip or the full-row shape. */
function actionNames(ch: Character, con: ContentDatabase): string[] {
  const { host, click, stop } = renderDom(<MainTab character={ch} content={con} onPlay={noop} />);
  click([...host.querySelectorAll<HTMLElement>('button.stab')].find((b) => /^Actions/.test(b.textContent ?? '')) ?? null);
  const names = [...host.querySelectorAll('.action-name, .action-chip-name')].map((e) => (e.textContent ?? '').trim());
  stop();
  return names;
}

const has = (names: string[], name: string) => names.some((t) => t.startsWith(name));

describe('improved-familiar-attunement replaces Drain Bonded Item with Drain Familiar', () => {
  beforeEach(() => localStorage.clear());

  // batch 034: improved-familiar-attunement#drain-familiar
  it('improved-familiar-attunement is an owned class feature of the wizard who picked the thesis', () => {
    // The suppression is gated on OWNING the replacer, and the thesis is an extraChoices pick rather
    // than a listed class feature — `ownedFeatureIds` reaches it through `c.classChoices`.
    const ch = thesisWizard();
    expect([...ownedFeatureIds(ch, content())]).toContain('improved-familiar-attunement');
    // arcane-bond is still owned: the thesis "alters your arcane bond class feature", it does not
    // remove it, which is why its grant keeps firing and needed suppressing rather than deleting.
    expect([...ownedFeatureIds(ch, content())]).toContain('arcane-bond');
  });

  // batch 034: improved-familiar-attunement#drain-familiar
  it('improved-familiar-attunement: WITHOUT the replacesActions row both free actions render', () => {
    // The control. Grant alone (the data-rows family's rows) leaves the defect its verifier found:
    // two free actions on one wizard, one of them for a bonded item this thesis gave up.
    const names = actionNames(thesisWizard(), withDrainFamiliar(false));
    expect(has(names, 'Drain Familiar')).toBe(true);
    expect(has(names, 'Drain Bonded Item')).toBe(true);
  });

  // batch 034: improved-familiar-attunement#drain-familiar
  it('improved-familiar-attunement: WITH it only Drain Familiar renders', () => {
    // AoN arcane-thesis-7: "you also gain the Drain Familiar free action instead of Drain Bonded
    // Item." Only the replaced id is dropped; the granted one stays.
    const names = actionNames(thesisWizard(), withDrainFamiliar(true));
    expect(has(names, 'Drain Familiar')).toBe(true);
    expect(has(names, 'Drain Bonded Item')).toBe(false);
  });

  // batch 034: improved-familiar-attunement#drain-familiar
  it('improved-familiar-attunement: a wizard on another thesis keeps Drain Bonded Item', () => {
    // The suppression must not leak to a wizard who does not own the replacer — arcane-bond's grant
    // is unconditional for everyone else.
    const other = build('wizard', 5, { extraChoices: { thesis: ['experimental-spellshaping'] } }) as Character;
    const names = actionNames(other, withDrainFamiliar(true));
    expect(has(names, 'Drain Bonded Item')).toBe(true);
    expect(has(names, 'Drain Familiar')).toBe(false);
  });
});
