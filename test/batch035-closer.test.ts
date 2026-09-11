/*
 * BATCH 035 — CLOSER. The three things the gate demanded that no family owned.
 *
 *   1. KINDS  — demon / plant / undead eidolon each got the printed Language line on the
 *               COMPANION_MODS.languages carrier this batch, so the per-id credit in wg-diff's
 *               OFF_RECORD_CARRIERS is now earned. dragon-eidolon is the CONTROL: same file, same
 *               field, no per-id credit — it must keep reporting, or the credit has silently become
 *               blanket (REGISTRY_KINDS credits a FILE row to every one of that file's ~112 ids).
 *   2. IDENTITY — `grantedSpells` on a plain class-feature record had no reader in wg-identity, so
 *               lesson-of-vengeance's landed row still read as a gap. A TEACH, not a settle, and it is
 *               proved against a STUNTED core copy so it cannot hide the gap it just stopped reporting.
 *   3. VALUES/KINDS — curse-of-inclement-headwinds' Cursebound 4 Speed penalty had no carrier at all.
 *               Two overlay rows, the shape batch 033 built for its sibling one mystery over.
 *
 * ⚠ `--raw` bypasses the settle registries: a run WITHOUT it is what proves a record is still watched.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import { deriveSpeeds } from '../src/rules/derive';
import { modeNumberBonus } from '../src/rules/modes';
import type { Character, ModeDef } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
type Core = Record<string, any>;
const CORE: Core = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8'));

/** wg-diff has no `--ids`: it is corpus-wide by construction, so it is run to a file and indexed. */
function diffRows(tag = 'base'): Map<string, Core> {
  const rel = `work/.b035c-diff-${tag}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const j: Core = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    const idx = new Map<string, Core>();
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) for (const r of j[bucket] as Core[]) idx.set(r.id, { ...r, bucket });
    return idx;
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** wg-identity, run as the real CLI against a (possibly stunted) content file. */
function identityOut(coreRel = 'public/core.json'): string {
  return execFileSync(process.execPath, [
    join(CLI_ROOT, 'scripts/wg-identity.mjs'), '--batch', 'work/wg-batch-035.json', '--core', coreRel,
  ], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

/** Run something against a copy of public/core.json with one carrier removed. */
function stuntedCore<T>(tag: string, mutate: (core: Core) => void, run: (coreRel: string) => T): T {
  const rel = `work/.b035c-stunt-${tag}.json`;
  const copy: Core = JSON.parse(JSON.stringify(CORE));
  mutate(copy);
  expect(JSON.stringify(copy)).not.toBe(JSON.stringify(CORE));   // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(copy));
  try {
    return run(rel);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/* ================================================================== *
 * 1. THE EIDOLON LANGUAGE CREDIT IS EARNED, AND IT IS PER ID
 * ================================================================== */

describe('batch 035 closer — demon-eidolon, plant-eidolon and undead-eidolon credit a LIVE per-id language carrier, and dragon-eidolon still reports', () => {
  /*
   * OFF_RECORD_CARRIERS is not one of the four registries scripts/test-flip-audit.mjs audits, so no
   * `mutation-proof` marker is owed on it; what IS owed (the batch-033 note above the entries says so)
   * is proof that the carrier is LIVE — a credit for a dead field is a laundering — and that the credit
   * is PER ID rather than on the companionGrants.ts file row.
   *
   * ⚠ THE CONTROL CHANGED IN BATCH 037 (the describe title above still names the old one; a batch never
   * deletes a describe block, so the title is kept and corrected here). It used to be dragon-eidolon:
   * that id HAS `languages: ['draconic']` and deliberately carried no per-id credit, because it was not
   * a batch-035 record. It IS a batch-037 record, so batch 037's gap lane earned it the same credit
   * (AoN eidolon-7 *"Language Draconic"*), and "dragon-eidolon still reports" is no longer a true
   * statement about a healthy tree — it would now fail for the right reason, which is a useless control.
   * The replacement is STRICTER than the id it replaces: the credit list inside OFF_RECORD_CARRIERS is
   * pinned to the exact eight eidolon ids, so a hand that moves the credit onto the companionGrants.ts
   * FILE row (which REGISTRY_KINDS would spread to every one of that file's ~112 ids) fails here just
   * as loudly, and so does a ninth id credited without a batch behind it.
   */
  // batch 035: demon-eidolon#language-abyssal
  // batch 035: plant-eidolon#language
  // batch 035: undead-eidolon#language
  // batch 037 premise: eidolon-7 "Language Draconic"
  it('the three carriers hold the printed language and the three records report no missing kind', () => {
    expect(COMPANION_MODS['demon-eidolon']?.languages).toEqual(['Abyssal']);
    expect(COMPANION_MODS['plant-eidolon']?.languages).toEqual(['Sylvan']);
    expect(COMPANION_MODS['undead-eidolon']?.languages).toEqual(['necril']);
    /* The assertion batch 037 removed from below this loop was
     * `expect(idx.get('dragon-eidolon')?.missing).toContain('language')`. Batch 037 gave dragon-eidolon
     * the same earned per-id credit its siblings hold, so it no longer reports and the control moved to
     * the exact-credit-list assertion further down. */
    // batch 037 premise: eidolon-7 "Language Draconic"
    const idx = diffRows('eidolon');
    for (const id of ['demon-eidolon', 'plant-eidolon', 'undead-eidolon']) {
      expect(idx.get(id)?.missing).not.toContain('language');
    }
    const src = readFileSync(join(CLI_ROOT, 'scripts/wg-diff.mjs'), 'utf8');
    expect(src).toContain("'demon-eidolon': ['language'],");
    expect(src).not.toContain("['src/rules/companionGrants.ts', ['grantsRecord', 'choice', 'language']]");
    /* THE CONTROL — the language credit is per id, and these are the only ids that hold it. Sliced to
     * the OFF_RECORD_CARRIERS literal so a `['language']` settle in VERIFIED_EQUIVALENT is not counted. */
    // batch 037 premise: eidolon-7 "Language Draconic"
    const block = src.slice(src.indexOf('const OFF_RECORD_CARRIERS = {'));
    const credited = [...block.slice(0, block.indexOf('\n};')).matchAll(/^ {2}'([a-z0-9-]+)': \['language'\],$/gm)].map((m) => m[1]);
    expect(credited.sort()).toEqual([
      'angel-eidolon', 'beast-eidolon', 'demon-eidolon', 'dragon-eidolon',
      'fey-eidolon', 'plant-eidolon', 'psychopomp-eidolon', 'undead-eidolon',
    ]);
  });
});

/* ================================================================== *
 * 2. wg-identity NOW READS grantedSpells ON THE RECORD ITSELF
 * ================================================================== */

describe('batch 035 closer — lesson-of-vengeance stops reporting its familiar spell, and reports it again when the carrier is gone', () => {
  // batch 035: lesson-of-vengeance#familiar-spell
  it('phantom-pain is credited from the record, and the credit dies with the field', () => {
    /*
     * AoN lesson-4 (Lesson of Vengeance) teaches the familiar `phantom pain` alongside the needle of
     * vengeance hex; WG writes both as giveSpell. The row landed on the record this batch
     * (classFeatures/lesson-of-vengeance.grantedSpells = ['phantom-pain']) and reaches the familiar's
     * spellbook, but wg-identity read `grantedSpells` only on a SubclassOption and on the declaring
     * feature's per-option ladder — never on a plain class-feature record — so it kept reporting
     * "theirs-not-ours=[phantompain]".
     */
    expect(content().classFeatures['lesson-of-vengeance']?.grantedSpells).toEqual(['phantom-pain']);
    expect(identityOut()).not.toMatch(/phantompain/);

    /*
     * mutation-proof — stunts classFeatures/lesson-of-vengeance.grantedSpells, the carrier the teach
     * above reads. A teach that survives its own carrier being deleted is not a teach, it is a
     * suppression, and it would hide the next real gap on this record unread.
     */
    const stunted = stuntedCore('lov', (c) => { delete c.classFeatures['lesson-of-vengeance'].grantedSpells; }, identityOut);
    expect(stunted).toMatch(/phantompain/);
  });
});

/* ================================================================== *
 * 3. CURSEBOUND 4 TAKES ALL FIVE SPEEDS, NOT A SENTENCE ABOUT THEM
 * ================================================================== */

describe('batch 035 closer — curse-of-inclement-headwinds cursebound 4 applies its Speed penalty instead of describing it', () => {
  const curse = () => (content() as unknown as { modes: Record<string, ModeDef> }).modes['curse-of-inclement-headwinds-4'];

  // batch 035 premise: mystery-19 "The raging winds push you back, imposing a -10- foot status penalty to all your Speeds."
  it('drops a built oracle fly Speed by 10 as well as their land Speed', () => {
    /*
     * The rung-4 mode carried the electricity weakness and the -2 circumstance ranged-attack penalty
     * but NO speed carrier, and its note ended "apply that Speed penalty by hand, the mode can't" — so
     * KINDS reported `speed` and VALUES reported five -10s with nothing on our side. `detail: 'all'` is
     * what modeMatches (src/rules/modes.ts:135, which otherwise defaults a detail-less speed modifier
     * to 'land') and the deriveSpeeds movement loop were built to read; the sibling
     * curse-of-creeping-ashes-4 (mystery-20, the same clause) has used it since batch 033.
     */
    const mode = curse();
    expect(mode.modifiers.some((m) => m.target === 'attack' && m.value === -2)).toBe(true); // the harness half
    expect(mode.modifiers).toContainEqual({ value: -10, type: 'status', target: 'speed', detail: 'all' });
    expect(modeNumberBonus([mode], { kind: 'speed', detail: 'fly' })).toBe(-10);
    expect(modeNumberBonus([mode], { kind: 'speed', detail: 'land' })).toBe(-10);
    /* The apology is gone with it: a note telling the player to apply a penalty the sheet has already
     * applied is an instruction to take it twice. */
    expect(mode.note).not.toMatch(/by hand/);

    const base = build('oracle', 6);
    const flight: ModeDef = { id: 'test-flight', name: 'Flight', speeds: { fly: 30 }, modifiers: [] };
    const before = deriveSpeeds({ ...base, activeModes: [flight] } as Character, content());
    expect(before.fly).toBe(30); // the harness half: there is a fly Speed to reduce
    const land = before.land ?? 0;
    expect(land).toBeGreaterThan(10);

    const cursed = deriveSpeeds({ ...base, activeModes: [flight, mode] } as Character, content());
    expect(cursed.fly).toBe(20);
    expect(cursed.land).toBe(land - 10);
  });
});
