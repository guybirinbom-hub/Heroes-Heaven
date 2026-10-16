// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { FeatsTab } from '../src/sheet/FeatsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { ensureTraits } from '../src/data';

/**
 * EVERY RECORD OF A TRAITED KIND HAS A `traits` ARRAY (2026-10-16).
 *
 * 24 class features — all 14 of the Necromancer's and all 10 of the Runesmith's — were imported on
 * 2026-08-18 with no `traits` key, and the Feats tab spreads `entry.traits`: for every Necromancer and
 * Runesmith, opening the Feats tab crashed the whole sheet from v0.1.23 to v0.1.44. Found by the
 * v0.1.43 → v0.1.44 regression harness (717 synthetic characters). The loader now gives every such
 * record an array (ensureTraits, src/data/index.ts), and so does the tests' content().
 */

const db = content({ trustGate: true });
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

describe('ensureTraits', () => {
  it('leaves no record of a traited kind without a traits array in the shipped core.json', () => {
    const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, { traits?: unknown }>>;
    ensureTraits(core);
    for (const bucket of ['ancestries', 'heritages', 'backgrounds', 'classes', 'classFeatures', 'feats', 'spells', 'items', 'deities', 'actions', 'runesmithRune']) {
      for (const [id, rec] of Object.entries(core[bucket] ?? {})) expect(Array.isArray(rec.traits), `${bucket}/${id}`).toBe(true);
    }
  });
});
