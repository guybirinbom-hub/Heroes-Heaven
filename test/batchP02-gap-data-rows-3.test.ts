import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';
import { readFileSync } from 'node:fs';
import {
  headerOffenders,
  baselineProblems,
  applyPendingDescriptionRows,
  BASELINE,
} from '../scripts/description-header-check.mjs';

/*
 * PRINT BATCH P02 — GAP agent for family data-rows-3.
 *
 * The chunk's builder could not write heaven-earth-encompassing-sleeves#sleeves-item: the garment
 * changes at a level (feat-7082: *"This clothing becomes a set of sleeves of storage … At 9th level,
 * the clothing becomes greater sleeves of storage instead"*) and the grantsItems reader had no level
 * gate. The gate now exists (src/rules/types.ts `grantsItems[].minLevel/maxLevel`, read by
 * `grantInLevelWindow` in src/rules/build.ts on every carrier), and the row is in
 * work/.bP02-rows-gap-data-rows-3.json.
 *
 * The row is not applied yet (the driver applies it), so every build below patches `grantsItems` IN
 * MEMORY to exactly the row's value — never a patched-vs-shipped delta, and each assertion holds the
 * same once the row lands.
 */
const db = content();

/** Verbatim the value of the gap spec's row. */
const SLEEVES_GRANTS_ITEMS = [
  { itemId: 'sleeves-of-storage', worn: true, maxLevel: 8 },
  { itemId: 'sleeves-of-storage-greater', worn: true, minLevel: 9 },
];

const withRow = (grants: unknown): ContentDatabase => ({
  ...db,
  feats: {
    ...db.feats,
    'heaven-earth-encompassing-sleeves': { ...db.feats['heaven-earth-encompassing-sleeves'], grantsItems: grants },
  },
} as ContentDatabase);

/** An unfurling-brocade magus who took the feat at 4th level, built at `level`. */
const magus = (level: number, cdb: ContentDatabase): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'magus',
      subclassId: 'unfurling-brocade',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'str',
      featPicks: { '4:class': 'heaven-earth-encompassing-sleeves' },
    } as unknown as BuildState,
    cdb,
  );

const sleeves = (c: Character) =>
  (c.inventory ?? [])
    .filter((i) => (i as { itemId: string }).itemId.startsWith('sleeves-of-storage'))
    .map((i) => i as { itemId: string; worn?: boolean });

describe('heaven-earth-encompassing-sleeves: one garment, the lesser sleeves below 9th and the greater from 9th', () => {
  // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
  it('heaven-earth-encompassing-sleeves at 4th level hands over sleeves of storage, worn, and not the greater ones', () => {
    const ch = magus(4, withRow(SLEEVES_GRANTS_ITEMS));
    expect(ch.feats.some((f) => f.featId === 'heaven-earth-encompassing-sleeves'), 'the feat has to be held').toBe(true);
    // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
    expect(sleeves(ch).map((i) => i.itemId)).toEqual(['sleeves-of-storage']);
    // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
    expect(sleeves(ch)[0].worn, 'the magus wears the clothing the feat enchants').toBe(true);
  });

  // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
  it('heaven-earth-encompassing-sleeves at 8th level still hands over the lesser sleeves only', () => {
    expect(sleeves(magus(8, withRow(SLEEVES_GRANTS_ITEMS))).map((i) => i.itemId)).toEqual(['sleeves-of-storage']);
  });

  // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
  it('heaven-earth-encompassing-sleeves at 9th level: "the clothing becomes greater sleeves of storage instead"', () => {
    // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
    expect(sleeves(magus(9, withRow(SLEEVES_GRANTS_ITEMS))).map((i) => i.itemId)).toEqual(['sleeves-of-storage-greater']);
    // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
    expect(sleeves(magus(15, withRow(SLEEVES_GRANTS_ITEMS))).map((i) => i.itemId)).toEqual(['sleeves-of-storage-greater']);
  });

  // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
  it('heaven-earth-encompassing-sleeves: without the level window both items arrive — the gate is alive', () => {
    /* The control that keeps the gate honest: strip minLevel/maxLevel from the patched copy and a
     * 4th-level magus holds the 9th-level container too, which is why the row could not be written
     * before the reader honoured the window. */
    const ungated = SLEEVES_GRANTS_ITEMS.map(({ itemId, worn }) => ({ itemId, worn }));
    expect(sleeves(magus(4, withRow(ungated))).map((i) => i.itemId).sort()).toEqual(['sleeves-of-storage', 'sleeves-of-storage-greater']);
  });

  // batch P02: heaven-earth-encompassing-sleeves#sleeves-item
  it('heaven-earth-encompassing-sleeves: a magus who never took the feat gets no sleeves', () => {
    const none = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 9,
        classId: 'magus',
        subclassId: 'unfurling-brocade',
        ancestryId: Object.keys(db.ancestries)[0],
        backgroundId: Object.keys(db.backgrounds)[0],
        keyAbility: 'str',
      } as unknown as BuildState,
      withRow(SLEEVES_GRANTS_ITEMS),
    );
    expect(sleeves(none)).toEqual([]);
  });
});

/* ================================================================== *
 * the scraped page header — scripts/description-header-check.mjs
 * ================================================================== */

describe('exploding-bullet and its two siblings: no description may open with "<Name>\\nSource …"', () => {
  /* A fixture, so the guard's logic is pinned whatever the shipped data holds: exploding-bullet as it
   * shipped (AoN feat-9055 page chrome on top), recharging-flurry already clean, a spell with the header
   * (spells are held by spell-print-lines-check.mjs instead), and a record with no name. */
  const core = {
    feats: {
      'exploding-bullet': { name: 'Exploding Bullet' },
      'recharging-flurry': { name: 'Recharging Flurry' },
    },
    spells: { 'force-fling': { name: 'Force Fling' } },
    items: { nameless: {} },
  };
  const descriptions = () => ({
    feats: {
      'exploding-bullet': { d: 'Exploding Bullet\nSource Impossible Magic pg. 60\nPrerequisites volatile spark hybrid study\n---\n**Requirements** You’re wielding an unloaded firearm.' },
      'recharging-flurry': { d: '**Requirements** You’re wielding two melee weapons, each in a different hand.' },
    },
    spells: { 'force-fling': { d: 'Force Fling \nSource Impossible Magic pg. 180\n…' } },
    items: { nameless: { d: 'Nameless\nSource x' } },
  });

  // batch P02: exploding-bullet#description-header
  it('exploding-bullet: the guard names a feat that opens with its page header, and skips spells and nameless records', () => {
    // batch P02: exploding-bullet#description-header
    expect(headerOffenders({ core, descriptions: descriptions() })).toEqual(['feats/exploding-bullet']);
  });

  // batch P02: exploding-bullet#description-header
  it('exploding-bullet: a NEW offender fails, and a listed record that is now right fails until its entry goes', () => {
    // batch P02: exploding-bullet#description-header
    expect(baselineProblems(['feats/exploding-bullet'], { records: [] })).toHaveLength(1);
    // batch P02: exploding-bullet#description-header
    expect(baselineProblems([], { records: ['feats/exploding-bullet'] })[0]).toMatch(/remove the entry/);
    // batch P02: exploding-bullet#description-header
    expect(baselineProblems(['feats/exploding-bullet'], { records: ['feats/exploding-bullet'] })).toEqual([]);
  });

  // batch P02: exploding-bullet#description-header
  it('exploding-bullet: the pending description row clears the record, as the driver will once it applies it', () => {
    const d = descriptions();
    applyPendingDescriptionRows(d, {
      findings: [{ id: 'exploding-bullet#description-header', backfillRows: [{ category: 'feats', id: 'exploding-bullet', field: 'description', value: '**Requirements** You’re wielding an unloaded firearm.' }] }],
    });
    // batch P02: exploding-bullet#description-header
    expect(headerOffenders({ core, descriptions: d })).toEqual([]);
  });

  // batch P02: running-recharge#description-header
  it('running-recharge, recharging-flurry and exploding-bullet are NOT in the baseline: their P02 rows fix them', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as { records: string[] };
    // batch P02: running-recharge#description-header
    expect(baseline.records).not.toContain('feats/running-recharge');
    // batch P02: recharging-flurry#description-header
    expect(baseline.records).not.toContain('feats/recharging-flurry');
    // batch P02: exploding-bullet#description-header
    expect(baseline.records).not.toContain('feats/exploding-bullet');
    // batch P02: running-recharge#description-header
    expect(baseline.records.some((k) => k.startsWith('spells/')), 'spells belong to spell-print-lines-check.mjs').toBe(false);
  });
});
