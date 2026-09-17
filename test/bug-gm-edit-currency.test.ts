// bug 2026-09-17: GM-edit currency wipe (refuter #2, second site)
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { carryStoredOverrides } from '../src/data/rebuild';
import type { SavedChar } from '../src/data/storage';

const buildOf = (name: string): BuildState => ({
  ...emptyBuild(),
  name,
  level: 1,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
});

/**
 * GmEditSheet's own Builder-save handler (`onCreate`, src/sheet/GmEditSheet.tsx) replaced
 * `work.character` wholesale with the freshly built one — the same 0-gold wipe App.tsx's builder
 * save had, but for a GM editing a player's character that has never been through Play mode (no
 * `play.currency` overlay yet, e.g. a WG import). This mirrors GmEditSheet.tsx's onCreate exactly:
 * `character: carryStoredOverrides(built, w.character)`, using the real helper.
 *
 * Mutation proof: commenting out the `if (stored.currency !== undefined) …` line in
 * carryStoredOverrides (src/data/rebuild.ts) — the same effect as dropping the helper call at the
 * GmEditSheet.tsx site — turns this wallet back into `{}` and fails the assertion below.
 */
describe('GmEditSheet onCreate keeps a currency-only wallet across a rebuild-save', () => {
  it('a stored wallet with no play object on the working copy survives a no-op save', () => {
    const db = content();
    const build = buildOf('Wallet Test');
    const built = buildCharacter(build, db);
    expect(built.currency, 'fixture check: a fresh build starts at 0 gold').toEqual({});
    const work: SavedChar = { id: 'c-1', character: { ...built, currency: { gp: 500 } }, build } as SavedChar;
    // The exact GmEditSheet.tsx onCreate expression.
    const next: SavedChar = {
      ...work,
      character: carryStoredOverrides(built, work.character),
      build,
      play: work.play,
    };
    expect(next.character.currency).toEqual({ gp: 500 });
  });
});
