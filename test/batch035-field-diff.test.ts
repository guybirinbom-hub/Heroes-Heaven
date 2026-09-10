/*
 * BATCH 035 — GATE-RED, group `field-diff` (family instruments).
 *
 * scripts/field-diff.mjs reported six unexplained levels. Five were the INSTRUMENT, not the data:
 * throneglass and its four graded siblings each ship the WHOLE family's markdown, so `printedLevel()`
 * read the low-grade sibling's `right="Item 2"` heading off every one of them and reported
 * `app <0|0|0|8|16> -> mirror 2` against documents whose own structured levels are -1/-1/-1/8/16 —
 * i.e. agreeing with us (-1 is the mirror's sentinel for "prints no level", stored as 0 here). The
 * by-NAME branch has refused exactly this since it was written (`m.level === wantLevel`, :142); the
 * own-document branch did not, and now does.
 *
 * The sixth is REAL and must survive that guard: ritual-275 prints `right="Ritual 3"`, which
 * `printedLevel`'s regex (Item|Feat|Spell|Cantrip|Focus) does not match, so the value falls back to
 * the document's own structured level 3 — heading and structured field agree, so the fixed condition
 * still reports it. Our record shipped rank 1.
 *
 * Three cases, in the order the risk runs:
 *   (a) the ritual's printed rank, on a content copy PATCHED IN MEMORY (never a patched-vs-shipped
 *       delta, which would flip the moment the driver applies the row);
 *   (b) mutation-proof — on a STUNTED copy of the fix the five throneglass lines come back, so the
 *       guard is what silences them and not luck;
 *   (c) the ritual is still reported when its rank is stunted back to 1, so the guard did not swallow
 *       a real defect along with the false ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { INSTRUMENT_TIMEOUT } from './_timeouts';
/*
 * (b) and (c) run field-diff as a real node child over core.json and the whole AoN mirror.
 *
 * batch 036, RECLASSIFICATION (no assertion touched, no work removed): this file was on CHILD_TIMEOUT
 * (90 s) and case (c) timed out at 183 s in batch 036's suite run — the FIRST suite that exceeded it,
 * because the suite grew from 528 to 537 files (202 s total, up from 175 s in batch 035) and this file
 * is the one that competes hardest for the disk. _timeouts.ts draws the line by WHAT THE TEST DOES, and
 * by its own wording this file has always been on the wrong side of it: CHILD_TIMEOUT is for "a child
 * that boots its own runtime and reads the shipped data", INSTRUMENT_TIMEOUT for one that "re-reads
 * every page in the Archives mirror … minutes of work rather than seconds". field-diff.mjs walks the
 * ENTIRE AoN mirror, three times in this file. So the clock was mis-set, not the test: the assertions,
 * the stunts and the mutation-proof are byte-identical, and case (c) still fails if the guard ever
 * swallows the real ritual-275 defect.
 */
vi.setConfig({ testTimeout: INSTRUMENT_TIMEOUT, hookTimeout: INSTRUMENT_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';

const CLI_ROOT = join(__dirname, '..');
const AON = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const SCRIPT = join(CLI_ROOT, 'scripts/field-diff.mjs');
const SRC = readFileSync(SCRIPT, 'utf8');

/** The one condition batch 035 added — the stunt point for (b). */
const GUARD = 'const headingAgreesOwn = own.level === wantLevelOwn;';
/** core.json is loaded once, on this line; both variants pin the ritual's rank right after it. */
const DB_LOAD = "const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));";
const PIN_RANK = `${DB_LOAD}\ndb.spells['beckon-the-blasphemous-brethren'].rank = 1;`;

const THRONEGLASS = [
  'throneglass',
  'throneglass-shard',
  'throneglass-plate',
  'standard-grade-throneglass-object',
  'high-grade-throneglass-object',
];

/**
 * Run a transformed copy of the instrument. It lives beside the original's root (work/.. is the repo
 * root, exactly as scripts/.. is) so `public/core.json` still resolves, and it is removed either way.
 * A non-zero exit is the script's own "UNEXPLAINED > 0" signal, not a failure to run.
 */
function runCopy(name: string, transform: (src: string) => string): string {
  const p = join(CLI_ROOT, 'work', name);
  writeFileSync(p, transform(SRC), 'utf8');
  try {
    return execFileSync(process.execPath, [p], { cwd: CLI_ROOT, encoding: 'utf8' });
  } catch (e) {
    const out = (e as { stdout?: string }).stdout;
    if (typeof out !== 'string' || !out.includes('UNEXPLAINED')) throw e;
    return out;
  } finally {
    rmSync(p, { force: true });
  }
}

describe('batch 035 field-diff — beckon-the-blasphemous-brethren prints Ritual 3', () => {
  // batch 035 premise: ritual-275 "Ritual 3"
  it('carries rank 3, the level its own AoN document prints', () => {
    const mirror = JSON.parse(readFileSync(join(AON, 'ritual/ritual-275.json'), 'utf8'));
    const md: string = mirror._source?.markdown ?? mirror.markdown ?? '';
    // Print is the authority: the heading and the structured field, which is why this is a real red.
    expect(md).toContain('right="Ritual 3"');
    expect(mirror.level).toBe(3);

    const c = content() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const shipped = c.spells['beckon-the-blasphemous-brethren'];
    expect(shipped.aonId).toBe('ritual-275');
    // PATCHED IN MEMORY — the row the driver will apply, asserted here rather than a shipped delta.
    const patched = { ...shipped, rank: 3 };
    expect(patched.rank).toBe(3);
    expect(patched.rank).toBe(mirror.level);

    /*
     * The other two thin fields, checked so they are not silently owed a row: the mirror's `trait`
     * array is the rarity alone, which we store on `rarity`, and rituals print no tradition at all.
     */
    expect(mirror.trait).toEqual(['Rare']);
    expect(shipped.rarity).toBe('rare');
    expect(shipped.traits).toEqual([]);
    expect(mirror.tradition).toBeUndefined();
    expect(shipped.traditions).toEqual([]);
  });

  // batch 035 premise: ritual-275 "Ritual 3"
  it('is still reported by field-diff when its rank is stunted back to 1', () => {
    const out = runCopy('.b035-field-diff-pinned.mjs', (s) => s.replace(DB_LOAD, PIN_RANK));
    expect(out).toContain('level   spells/beckon-the-blasphemous-brethren');
    expect(out).toContain('app 1 -> mirror 3');
    // The guard silences the five false ones and nothing else: one red left, and it is this one.
    expect(out).toContain('UNEXPLAINED: 1');
    expect(out).not.toContain('throneglass');
  });
});

describe('batch 035 field-diff — the throneglass family heads are the instrument, not a defect', () => {
  // batch 035 premise: equipment-5212 "Item 2"
  it('agrees with each record\'s own mirror document', () => {
    const c = content() as unknown as Record<string, Record<string, Record<string, unknown>>>;
    for (const id of THRONEGLASS) {
      const rec = c.items[id];
      const doc = JSON.parse(readFileSync(join(AON, `equipment/${rec.aonId}.json`), 'utf8'));
      // -1 is the mirror's sentinel for "prints no level"; this app stores that same absence as 0.
      expect(rec.level).toBe(doc.level < 0 ? 0 : doc.level);
      // …while every sub-document carries the family's low-grade heading, which is where "2" came from.
      const md: string = doc._source?.markdown ?? doc.markdown ?? '';
      expect(md).toContain('right="Item 2"');
    }
  });

  // batch 035 premise: equipment-5212 "Item 2"
  it('come back the moment the own-document level condition is stunted out', () => {
    // mutation-proof — stunts the batch-035 guard `headingAgreesOwn` (scripts/field-diff.mjs).
    expect(SRC).toContain(GUARD);
    const out = runCopy('.b035-field-diff-stunted.mjs', (s) =>
      s.replace(DB_LOAD, PIN_RANK).replace(GUARD, 'const headingAgreesOwn = true;'),
    );
    for (const id of THRONEGLASS) expect(out).toContain(`items/${id}`);
    expect(out).toContain('UNEXPLAINED: 6');
  });
});
