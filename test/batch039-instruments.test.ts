/*
 * BATCH 039 — THE INSTRUMENT LANE (WG-COMPARISON family). One finding:
 *
 *   arcane-spellcasting-magus#instrument — wg-diff read `classFeatures/arcane-spellcasting-magus` as
 *   missing=[spellcasting, grantsItem, spellSlot]. Two of the three are a misread: casting is carried
 *   by `classes.magus.spellcasting` (prepared / arcane / int, progression 'psychic'), which wg-diff
 *   credits to the class's casting FEATURE only when the id ends in `-spellcasting`. The magus's is the
 *   one class casting feature with its class as a suffix. The teach (scripts/wg-diff.mjs, the
 *   "Spell slots and the spellcasting proficiency come off the class's own progression" line) also
 *   accepts `-spellcasting-<owning class>`. Measured on the shipped data: exactly this record moves
 *   (THEY-ONLY 199 → 199, the row goes from three missing kinds to `grantsItem` alone).
 *
 *   `grantsItem` is a REAL gap (the free spellbook, arcane-spellcasting-magus#spellbook-item, a data
 *   row another family authors) and must keep reporting while the feature has no grantsItems.
 *
 * A teach is proved WITH `--raw`, so a pass cannot come from a settle registry quieting the record.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case runs wg-diff as a real node child — see test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, mainCasting } from './_content';

const CLI_ROOT = join(__dirname, '..');
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));
type Core = Record<string, any>;
const tag = () => `${process.pid}-${Math.random().toString(36).slice(2)}`;
const ID = 'arcane-spellcasting-magus';

/** wg-diff's THEY-ONLY `missing` for one record, on a copy of core.json patched in memory. */
function missingOn(mutate: (core: Core) => void): string[] | undefined {
  const coreRel = `work/.b039i-core-${tag()}.json`;
  const outRel = `work/.b039i-diff-${tag()}.json`;
  const copy: Core = JSON.parse(JSON.stringify(CORE));
  mutate(copy);
  writeFileSync(join(CLI_ROOT, coreRel), JSON.stringify(copy));
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--raw', '--core', coreRel, '--out', outRel], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const out = JSON.parse(readFileSync(join(CLI_ROOT, outRel), 'utf8'));
    return out.theyOnly.find((r: { id: string; bucket: string }) => r.id === ID && r.bucket === 'classFeatures')?.missing;
  } finally {
    rmSync(join(CLI_ROOT, coreRel), { force: true });
    rmSync(join(CLI_ROOT, outRel), { force: true });
  }
}

/* The spellbook row (a sibling finding) may or may not have landed; strip it in memory so these
 * assertions read the same before and after the driver applies it. */
const noSpellbook = (c: Core) => { delete c.classFeatures[ID].grantsItems; };

describe('arcane-spellcasting-magus — casting comes from the magus class record', () => {
  // batch 039: arcane-spellcasting-magus#instrument
  it('arcane-spellcasting-magus: the carrier delivers print on a built magus (1 first-rank slot, 5 cantrips)', () => {
    /* Print: "At 1st level, you can prepare one 1st-rank spell and five cantrips each morning". */
    const e = mainCasting(build('magus', 1, { keyAbility: 'int' }))!;
    expect(e.type).toBe('prepared');
    expect(e.tradition).toBe('arcane');
    expect(e.cantripCap).toBe(5);
    expect(Object.keys(e.prepared ?? {}).map(Number)).toEqual([1]);
    expect(e.prepared![1]!.length).toBe(1);
  });

  // batch 039: arcane-spellcasting-magus#instrument
  it('arcane-spellcasting-magus: wg-diff --raw reports only the real grantsItem gap', () => {
    expect(missingOn(noSpellbook)).toEqual(['grantsItem']);
  });

  // batch 039: arcane-spellcasting-magus#instrument
  it('arcane-spellcasting-magus: with classes.magus.spellcasting stunted, spellcasting + spellSlot report again', () => {
    // mutation-proof — stunts the taught carrier classes.magus.spellcasting (the -spellcasting-<owner> teach)
    const missing = missingOn((c) => {
      noSpellbook(c);
      expect(c.classes.magus.spellcasting).toBeTruthy();   // the stunt must actually bite
      delete c.classes.magus.spellcasting;
    });
    expect(missing).toEqual(expect.arrayContaining(['spellcasting', 'spellSlot', 'grantsItem']));
  });

  // batch 039: arcane-spellcasting-magus#instrument
  it('arcane-spellcasting-magus: the suffix must be the OWNING class — a foreign suffix is not credited', () => {
    // mutation-proof — stunts the teach's owner check by moving the feature to the wizard's feature list
    const missing = missingOn((c) => {
      noSpellbook(c);
      const f = c.classes.magus.features.find((x: { featureId: string }) => x.featureId === ID);
      expect(f).toBeTruthy();
      c.classes.magus.features = c.classes.magus.features.filter((x: { featureId: string }) => x.featureId !== ID);
      c.classes.wizard.features.push(f);
    });
    expect(missing).toEqual(expect.arrayContaining(['spellcasting', 'spellSlot']));
  });
});
