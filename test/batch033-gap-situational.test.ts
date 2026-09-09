import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RECORD_MARKERS } from '../src/rules/situationalBonuses';

/**
 * Wanderer's-Guide parity batch 033, SITUATIONAL family — GAP lane.
 *
 * scripts/backfill-oracle-curses.mjs is the AUTHORING SOURCE of the oracle-curse block of
 * RECORD_MARKERS: on `--write` it rewrites that block from its own CURSES table. So a printed-text
 * fix made in the registry alone is only as durable as the next run of that script — the exact
 * latent revert the batch's cross-file gap named. This pins the two strings to each other, in the
 * direction that matters: if either side drifts, the test fails before the script can quietly
 * restore the invented sentence.
 */
const GENERATOR = 'scripts/backfill-oracle-curses.mjs';

/** The `note` literal the generator holds for one curse id, read out of its source. */
const generatorNote = (curseId: string): string => {
  const src = readFileSync(GENERATOR, 'utf8');
  const block = new RegExp(`'${curseId}':\\s*\\{[^}]*?note:\\s*'([^']*)'`, 's').exec(src);
  expect(block, `${GENERATOR} still holds a CURSES entry for ${curseId}`).not.toBeNull();
  return block![1];
};

describe('curse-of-creeping-ashes: the generator cannot revert the cursebound-4 text', () => {
  /* AoN mystery-20 (Ash): "Cursebound 4 You take a -10-foot status penalty to all your Speeds as
   * your limbs begin to crumble like ash." The registry note used to end "4: you are consumed and
   * die", a mechanic that appears nowhere in the record; the generator transcribed the same invented
   * sentence, and it is the half that survives a regeneration. */

  const registryNote = RECORD_MARKERS['curse-of-creeping-ashes'][0].note;

  // batch 033: curse-of-creeping-ashes#cursebound-4-text
  it('scripts/backfill-oracle-curses.mjs transcribes exactly what curse-of-creeping-ashes displays', () => {
    expect(generatorNote('curse-of-creeping-ashes')).toBe(registryNote);
  });

  // batch 033: curse-of-creeping-ashes#cursebound-4-text
  it('neither side of curse-of-creeping-ashes carries the invented death clause', () => {
    for (const note of [registryNote, generatorNote('curse-of-creeping-ashes')]) {
      expect(note).not.toMatch(/\bdie\b/);
      expect(note).not.toContain('consumed');
      expect(note).toContain('−10-foot status penalty to all your Speeds');
      expect(note).toContain('crumble like ash');
    }
  });
});
