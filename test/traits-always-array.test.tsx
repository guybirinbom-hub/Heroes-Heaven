// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { FeatsTab } from '../src/sheet/FeatsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { TRAITED_BUCKETS as TRAITED, ensureTraits } from '../src/data';

/**
 * EVERY RECORD OF A TRAITED KIND HAS A `traits` ARRAY (2026-10-16).
 *
 * 24 class features — all 14 of the Necromancer's and all 10 of the Runesmith's — were imported on
 * 2026-08-18 with no `traits` key, and the Feats tab spreads `entry.traits`: for every Necromancer and
 * Runesmith, opening the Feats tab crashed the whole sheet from v0.1.23 to v0.1.44. Found by the
 * v0.1.43 → v0.1.44 regression harness (717 synthetic characters). The loader now gives every such
 * record an array (ensureTraits, src/data/index.ts), and so does the tests' content().
 */

// The loader's own list, so a new traited bucket is planted and checked here with no second edit.
// The buckets that must stay on it: dropping one from the loader's list would stop guarding its records.
const MUST_STAY = ['ancestries', 'heritages', 'backgrounds', 'classes', 'classFeatures', 'feats', 'spells', 'items', 'deities', 'actions', 'runesmithRune'];
it('the loader still guards every bucket that once crashed or was listed here', () => {
  expect([...TRAITED]).toEqual(expect.arrayContaining(MUST_STAY));
});
// batch-independent plant (2026-10-23): the data now gives every record traits, so a test that relied on
// the data having a trait-less record could no longer fail. This load strips `traits` off every class
// feature (the bug's own bucket) and off the first record of each other traited kind before the reader's
// normalisation runs, and adds one synthetic record with no key. Feats keep their real traits, so the
// Feats-tab cases below still draw real trait chips and the archetype group.
const db = content({
  trustGate: true,
  plant: (core) => {
    for (const bucket of TRAITED) {
      const recs = Object.values(core[bucket] ?? {});
      for (const rec of bucket === 'classFeatures' ? recs : recs.slice(0, 1)) delete (rec as { traits?: unknown }).traits;
    }
    core.classFeatures['synthetic-no-traits'] = { id: 'synthetic-no-traits', name: 'Synthetic no-traits feature' };
  },
});
const noop = () => undefined;

const character = (classId: string, key: string) => {
  const cls = db.classes[classId] as unknown as { subclass?: { options?: Record<string, unknown> } };
  return buildCharacter(
    {
      ...emptyBuild(),
      name: `Synth ${classId}`,
      level: 5,
      classId,
      subclassId: Object.keys(cls.subclass?.options ?? {})[0] ?? null,
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: key,
    } as unknown as BuildState,
    db,
  );
};

describe('the Feats tab opens for every class whose features once had no traits', () => {
  // mutation-proof: drop ensureTraits from test/_content.ts and both cases crash with "… is not
  // iterable". (The app loader's call is pinned by test/content-loader.test.ts.)
  for (const [classId, key] of [['necromancer', 'int'], ['runesmith', 'int']] as const) {
    it(`a level-5 ${classId}`, () => {
      expect(db.classes[classId], `${classId} exists in core.json`).toBeTruthy();
      const ch = character(classId, key);
      const { host, stop } = renderDom(<FeatsTab character={ch} content={db} onPlay={noop} />);
      try {
        expect(host.textContent ?? '').not.toMatch(/ran into a problem/i);
        expect(host.textContent?.length ?? 0).toBeGreaterThan(100);
      } finally {
        stop();
      }
    });
  }
});

describe('the reader gives every record of a traited kind a traits array', () => {
  // mutation-proof: drop ensureTraits from test/_content.ts (or empty its body) and this goes red — the
  // planted records above have no `traits` key when the reader sees them.
  it('after a load where class features and one record of every other kind had none', () => {
    expect(Array.isArray((db.classFeatures['synthetic-no-traits'] as { traits?: unknown }).traits)).toBe(true);
    for (const bucket of TRAITED) {
      const records = (db as unknown as Record<string, Record<string, { traits?: unknown }>>)[bucket] ?? {};
      for (const [id, rec] of Object.entries(records)) expect(Array.isArray(rec.traits), `${bucket}/${id}`).toBe(true);
    }
  });

  it('ensureTraits itself fixes exactly the records that lack an array, and keeps a real one', () => {
    const core = {
      feats: { a: { id: 'a' }, b: { id: 'b', traits: ['Fighter'] }, c: { id: 'c', traits: 'oops' } },
      classFeatures: { d: { id: 'd' } },
    };
    expect(ensureTraits(core)).toBe(3);
    expect(core.feats.a).toHaveProperty('traits', []);
    expect(core.feats.b.traits).toEqual(['Fighter']);
    expect(core.feats.c).toHaveProperty('traits', []);
    expect(core.classFeatures.d).toHaveProperty('traits', []);
  });
});
