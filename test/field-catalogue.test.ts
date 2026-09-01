/*
 * The field catalogue is trusted by every parity agent, so it gets a guard.
 *
 * `scripts/wg-field-catalogue.mjs` tells a batch which fields exist, what shape each takes, and
 * whether anything in src/ actually READS it. That turns the question those agents asked thirty-seven
 * separate times ("is this field inert?") into a lookup — but it also concentrates risk: today ten
 * agents grepping independently means one mistake stays local, whereas a wrong catalogue entry reaches
 * every record in the batch at once.
 *
 * So the properties that make it safe are asserted here rather than assumed:
 *
 *   1. It knows BOTH storage locations. wg-batch.mjs's header records that the differ was 19.2%
 *      accurate until it learned to look at the id-keyed registries in src/rules/, because a mechanic
 *      can live in one with no field to show. A field-only catalogue repeats that at batch scale.
 *   2. `hasReader` means what it says. A field declared in types.ts and read nowhere is INERT, and
 *      authoring it changes nothing a player sees — the failure this project ships most often.
 *   3. It is generated, not remembered. The script is re-run here; a hand-edited or stale copy fails.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(__dirname, '..');

/** Regenerate from source, so this never tests a stale artefact. */
function catalogue(): {
  fields: { field: string; hasReader: boolean; readers: string[]; shape: string | null; records: number; buckets: string[] }[];
  registries: { name: string; keys: number; at: string }[];
} {
  const out = join(tmpdir(), `hh-field-catalogue-${process.pid}.json`);
  execFileSync('node', [join(ROOT, 'scripts/wg-field-catalogue.mjs'), '--json', out], { cwd: ROOT, stdio: 'pipe' });
  const parsed = JSON.parse(readFileSync(out, 'utf8'));
  try { unlinkSync(out); } catch { /* best effort */ }
  return parsed;
}

const cat = catalogue();
const byName = new Map(cat.fields.map((f) => [f.field, f]));

describe('the field catalogue', () => {
  it('covers a realistic number of fields and every bucket that has them', () => {
    expect(cat.fields.length, 'far fewer than ~150 means the walk broke').toBeGreaterThan(150);
    expect(cat.fields.every((f) => f.records > 0)).toBe(true);
  });

  it('knows the SECOND storage location — the id-keyed registries', () => {
    // Without these a mechanic that lives in a registry reads as "we do not encode it", which is the
    // exact error that held the differ at 19.2% accuracy.
    expect(cat.registries.length, 'no registries found — the matcher broke').toBeGreaterThan(15);
    const names = cat.registries.map((r) => r.name);
    for (const required of ['FEAT_SITUATIONAL', 'RECORD_MARKERS', 'FEAT_SKILL_GRANTS']) {
      expect(names, `${required} must be catalogued`).toContain(required);
    }
    // FEAT_SITUATIONAL is the big one; a collapse here means the key scrape silently stopped working.
    expect(cat.registries.find((r) => r.name === 'FEAT_SITUATIONAL')!.keys).toBeGreaterThan(1000);
  });

  it('marks live fields as read, with a real file:line', () => {
    // Sampled across different readers so one broken path cannot pass the whole test.
    for (const f of ['situational', 'grantsItems', 'innateSpells', 'critSpecWeapons', 'recordMarks']) {
      const e = byName.get(f);
      expect(e, `${f} must be in the catalogue`).toBeTruthy();
      expect(e!.hasReader, `${f} is read by the engine and must not be reported inert`).toBe(true);
      expect(e!.readers[0], `${f} needs a concrete reader location`).toMatch(/^src\/.+:\d+$/);
    }
  });

  it('reports the shape of a field, so an author does not have to guess it', () => {
    const e = byName.get('situational');
    expect(e!.shape, 'the declared type is what makes a value the right SHAPE').toBeTruthy();
    expect(e!.shape).toContain('SituationalBonus');
  });

  it('inert fields stay visible and stay rare', () => {
    const inert = cat.fields.filter((f) => !f.hasReader);
    // Known today: `passengers`, carried on 42 vehicle records and read by nothing. Listed rather than
    // silently tolerated — a growing inert set means authoring is outpacing the engine.
    expect(inert.length, `inert fields: ${inert.map((f) => f.field).join(', ')}`).toBeLessThanOrEqual(3);
  });
});
