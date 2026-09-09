import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveBulk } from '../src/rules/derive';
import type { Character, ClassFeature, ContentDatabase, Item } from '../src/rules/types';

const db = content();

/* ---------------------------------------------------------------------------------------------- *
 * light-mortar-innovation — the munitions master's innovation IS a light mortar, and until this batch
 * nothing handed it over.
 *
 * AoN archetype-329 (Munitions Master, Battlecry! pg. 64): *"Instead of choosing an innovation from
 * the options listed in the inventor class, you have the light mortar innovation… Your innovation is a
 * mounted siege weapon called a light mortar that weighs 2 Bulk."*
 *
 * The two rows this file pins are in
 * work/.b033-rows-resume-light-mortar-siege-the-munitions-master-innovation-grant-3-red-lines-one-lane-.json
 * and the driver applies them, so the content is patched IN MEMORY here — both the "with" and the
 * "without" side, never a patched-vs-shipped delta.
 * ---------------------------------------------------------------------------------------------- */

/** The created items row's mechanical half — the fields build.ts and derive.ts read. */
const MORTAR = {
  id: 'innovation-light-mortar',
  name: 'Light Mortar',
  level: 1,
  itemType: 'equipment',
  bulk: 2,
  traits: ['siege-weapon', 'mounted'],
  rarity: 'uncommon',
  source: { book: 'Pathfinder Battlecry!', license: 'ORC' },
  edition: 'remaster-era',
  aonId: 'siege-weapon-36',
} as unknown as Item;

/** Content with BOTH rows applied: the item exists and the innovation grants it. */
function withRows(): ContentDatabase {
  return {
    ...db,
    items: { ...db.items, [MORTAR.id]: MORTAR },
    classFeatures: {
      ...db.classFeatures,
      'light-mortar-innovation': {
        ...db.classFeatures['light-mortar-innovation'],
        grantsItems: [{ itemId: MORTAR.id }],
      } as unknown as ClassFeature,
    },
  } as ContentDatabase;
}

/**
 * The same content with the GRANT stripped — the pre-row state, expressed in memory.
 *
 * ⚠ It DELETES the key rather than restoring the record from `db`. Restoring worked only while the row
 * was unapplied: `db` is the shipped content, so the moment the driver wrote
 * classFeatures/light-mortar-innovation.grantsItems the "stripped" copy carried the grant too, both
 * negative assertions below saw a mortar they were asserting the absence of, and the bulk delta
 * collapsed from 2 to 0. Deleting the field is the shape that stays honest on both sides of the apply.
 */
function withoutGrant(): ContentDatabase {
  const c = withRows();
  const { grantsItems: _stripped, ...bare } = c.classFeatures['light-mortar-innovation'] as unknown as Record<string, unknown>;
  return { ...c, classFeatures: { ...c.classFeatures, 'light-mortar-innovation': bare as unknown as ClassFeature } } as ContentDatabase;
}

/**
 * A BUILT munitions master: an inventor whose innovation is the light mortar, holding Munitions Master
 * Dedication as the level-2 class feat print requires (*"You must select Munitions Master Dedication as
 * your 2nd-level class feat"*, archetype-329).
 */
function munitionsMaster(level: number, cdb: ContentDatabase, subclassId = 'light-mortar-innovation'): Character {
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId: 'inventor',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'int',
      subclassId,
      ...(level >= 2 ? { featPicks: { '2:class': 'munitions-master-dedication' } } : {}),
    },
    cdb,
  );
}

const mortarOf = (ch: Character) => ch.inventory.find((i) => i.itemId === MORTAR.id);

describe('light-mortar-innovation hands the light mortar over as the innovation itself', () => {
  // batch 033: light-mortar-innovation#innovation-item
  it('a 1st-level light-mortar-innovation inventor owns the Light Mortar without buying it', () => {
    // "Your innovation is a mounted siege weapon called a light mortar that weighs 2 Bulk"
    // (archetype-329). The record carried no grantsItems and build.ts's innovation block branches on
    // the ARMOUR innovation only, so the munitions master's own innovation was granted by nothing.
    const ch = munitionsMaster(1, withRows());
    const mortar = mortarOf(ch);
    expect(mortar).toBeTruthy();
    expect((mortar as { grantedBy?: string }).grantedBy).toBe('Light Mortar Innovation');
    // …and it is on the sheet, not only in the build: 2 Bulk of it, against the encumbrance limits.
    expect(deriveBulk(ch, withRows()).total).toBeCloseTo(deriveBulk(munitionsMaster(1, withoutGrant()), withoutGrant()).total + 2, 5);
  });

  // batch 033: light-mortar-innovation#innovation-item
  it('the light-mortar-innovation grant rides the class-features arm, so a real 2nd-level munitions master has it too', () => {
    // 'light-mortar-innovation' is BOTH the subclass option id and the classFeature id, so it is in
    // `grantOptions` and the existing grantsItems collector (build.ts:7671) reads the record — no new
    // branch in the innovation block is needed for it, unlike the armour suit, whose item is the
    // answer to a per-character question (build.inventorArmorStats).
    const ch = munitionsMaster(2, withRows());
    expect(ch.feats.some((f) => f.featId === 'munitions-master-dedication')).toBe(true);
    expect(mortarOf(ch)).toBeTruthy();
  });

  // batch 033: light-mortar-innovation#innovation-item
  it('no light-mortar-innovation grant, no mortar — and no other innovation hands one over', () => {
    // The stripped copy is the pre-row state: with the item in content but the record's grantsItems
    // gone, nothing puts a mortar in the pack. Print gives the mortar to the munitions master alone —
    // "Instead of choosing an innovation from the options listed in the inventor class, you have the
    // light mortar innovation" (archetype-329) — so an armour or weapon inventor must still have none.
    expect(mortarOf(munitionsMaster(1, withoutGrant()))).toBeUndefined();
    for (const other of ['armor-innovation', 'weapon-innovation', 'construct-innovation']) {
      expect(mortarOf(munitionsMaster(1, withRows(), other))).toBeUndefined();
    }
  });

  // batch 033: light-mortar-innovation#innovation-item
  it('the created light-mortar-innovation item ships its prose on the created-prose row ALONE, and reaches the split file', () => {
    /*
     * The created record must not ship blank — that is the state
     * classFeatures/arcane-bond-school-of-unified-magical-theory was in earlier this batch, where
     * render-check.mjs and readable-record-check.mjs both went red because a create row carries no
     * description. And it must not ship the prose TWICE.
     *
     * ⚠ This assertion is the inverse of the one it replaces. The description was on BOTH rows for one
     * measured reason: pre-check (1b) refused a field row on a record the same manifest creates. The
     * closer fixed (1b) instead of working around it — prose is routed BY FIELD to
     * public/core-descriptions.json, a different file from the one a create row writes, so neither row
     * can shadow the other and (1b)'s premise never applies to prose. The fold then became the defect:
     * 1,130 characters landed INLINE in public/core.json and regen-durability-check.mjs went red on
     * "descriptions are split out". lib/apply-backfill.mjs now applies its `skipFields` to a create too,
     * so this is the documented shape again — "prose for created records, since a create row never
     * carries a description" — and it is pinned in all three places at once: not on the create row, on
     * the prose row verbatim, and in the split file rather than the record.
     */
    const spec = JSON.parse(readFileSync('work/.b033-rows-resume-light-mortar-siege-the-munitions-master-innovation-grant-3-red-lines-one-lane-.json', 'utf8'));
    const prose = JSON.parse(readFileSync('work/.b033-created-desc-resume-light-mortar-siege.json', 'utf8'));
    const createRow = spec.findings[0].backfillRows.find((r: { create?: boolean }) => r.create);
    const descRow = prose.findings[0].backfillRows.find((r: { field?: string }) => r.field === 'description');
    expect(createRow.category).toBe('items');
    expect(createRow.id).toBe(MORTAR.id);
    expect(descRow.category).toBe('items');
    expect(descRow.id).toBe(MORTAR.id);
    // batch 033: light-mortar-innovation#innovation-item
    expect(createRow.value.description).toBeUndefined();
    // "Your innovation is a mounted siege weapon called a light mortar that weighs 2 Bulk" (archetype-329)
    // batch 033: light-mortar-innovation#innovation-item
    expect(descRow.value).toContain('mounted siege weapon called a light mortar');
    /* …and the shipped artefacts agree: the text is in the split file, not inline on the record, which
     * is exactly what regen-durability-check.mjs asserts over the whole corpus. */
    const shipped = JSON.parse(readFileSync('public/core.json', 'utf8')).items[MORTAR.id];
    const split = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')).items[MORTAR.id];
    // batch 033: light-mortar-innovation#innovation-item
    expect(shipped.description).toBeUndefined();
    // batch 033: light-mortar-innovation#innovation-item
    expect(split.d).toBe(descRow.value);
  });
});
