/*
 * BATCH 037 — the GAP lane of family "instruments-6".
 *
 * One line of the three was AUTHORED, and this file is it: wg-diff filed classFeatures/dragon-eidolon
 * THEY-ONLY `missing=[language]` although the carrier exists and is correct, so the report was a false
 * positive that would have outlived the batch. It is the last of the eight eidolon types to get the
 * per-id credit its seven siblings earned in batches 033 / 034 / 035, and it is earned the same way:
 * by proving the carrier is LIVE on a built character, not by asserting the comparer went quiet.
 *
 * Print is the authority and no batch-037 finding covers this aspect (the record's finding,
 * dragon-eidolon#tradition, is a different clause), so every flip below carries the premise citation
 * form: AoN eidolon-7 — and its remaster twin eidolon-21 — print *"Language Draconic"*.
 *
 * The other two gap lines are PARKED in work/.b037-report-gap-instruments-6.txt and own no test.
 */
import { describe, expect, it, vi } from 'vitest';
/* wg-diff is a real node child that reads the whole WG dump and all of core.json — well past vitest's
 * 5 s default, which is what timed this file out the first time the suite ran it. Same configuration
 * every other comparer-driving test file uses. */
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { build, content } from './_content';
import { deriveEidolon } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import type { CompanionConfig } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');

/** The eidolon block a real summoner of that type derives. `over` stunts a carrier in memory. */
function eidolonLanguages(typeId: string, stunt?: () => void, restore?: () => void): string[] {
  if (stunt) stunt();
  try {
    const c = content();
    const ch = build('summoner', 5, { subclassId: typeId });
    const cfg: CompanionConfig = { id: `c-${typeId}`, kind: 'eidolon', name: 'Test Eidolon', typeId, eidolon: {} };
    return deriveEidolon(cfg, ch, c).languages ?? [];
  } finally {
    if (restore) restore();
  }
}

/** wg-diff has no `--ids`: it is corpus-wide by construction, so it is run to a file and indexed. */
function diffRows(tag: string): Map<string, Record<string, any>> {
  const rel = `work/.b037g6-${tag}.json`;
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel], {
      cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
    });
    const j: Record<string, any> = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    const idx = new Map<string, Record<string, any>>();
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) for (const r of j[bucket] as any[]) idx.set(r.id, { ...r, bucket });
    return idx;
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

describe('batch 037 gap — dragon-eidolon speaks Draconic on a built summoner, and wg-diff stops calling that a missing kind', () => {
  /*
   * AoN eidolon-7: *"Skills Arcana, Intimidation Senses darkvision Language Draconic Speed 25 feet"*.
   * `languages: ['draconic']` is the ID rather than the printed name, because content.languages holds
   * a remaster `draconic` row — the same branch psychopomp (requian) and undead (necril) take, and the
   * opposite of angel / beast / demon / fey / plant, whose printed names have no row to resolve to.
   */
  // batch 037 premise: eidolon-7 "Language Draconic"
  it('dragon-eidolon carries the printed language as a content id and it resolves onto the eidolon block', () => {
    expect(COMPANION_MODS['dragon-eidolon']?.languages).toEqual(['draconic']);
    expect(content().languages?.['draconic']?.name).toBe('Draconic');
    expect(eidolonLanguages('dragon-eidolon')).toContain('Draconic');
    // Not a pick: a fixed Language line asks nothing, so no unchosen slot appears beside it.
    expect(COMPANION_MODS['dragon-eidolon']?.languageChoices).toBeUndefined();
  });

  /*
   * MUTATION PROOF. The credit in wg-diff's OFF_RECORD_CARRIERS is a hard-coded claim about this
   * carrier, so the claim is only honest while the carrier actually produces the language. Stunt the
   * field and the built eidolon must lose Draconic — a credit for a dead field is a laundering.
   */
  // mutation-proof — stunts COMPANION_MODS['dragon-eidolon'].languages (the field the
  // OFF_RECORD_CARRIERS['dragon-eidolon'] = ['language'] credit stands on).
  // batch 037 premise: eidolon-7 "Language Draconic"
  it('with the languages field stripped the built eidolon has no Draconic, so the credit is not laundering a dead field', () => {
    const mod = COMPANION_MODS['dragon-eidolon'] as Record<string, any>;
    const was = mod.languages;
    const stunted = eidolonLanguages('dragon-eidolon', () => { delete mod.languages; }, () => { mod.languages = was; });
    expect(stunted).not.toContain('Draconic');
    expect(COMPANION_MODS['dragon-eidolon']?.languages).toEqual(['draconic']);   // restored
  });

  /*
   * The credit closes ONE kind. The record's other half — our `specialStat` and `grantsRecord`, which
   * WG has no op for — must keep reporting, or the credit has quietly become a whole-record settle.
   */
  // batch 037 premise: eidolon-7 "Language Draconic"
  it('dragon-eidolon reports no missing kind, still reports its two extra kinds, and no sibling eidolon moved', () => {
    const idx = diffRows('gapdiff');
    const row = idx.get('dragon-eidolon');
    expect(row?.missing ?? []).not.toContain('language');
    expect(row?.extra).toEqual(['specialStat', 'grantsRecord']);
    expect(row?.bucket).toBe('weOnly');
    // The seven siblings credited in 033 / 034 / 035 are unchanged, and no eidolon is left reporting.
    for (const id of ['angel-eidolon', 'beast-eidolon', 'demon-eidolon', 'fey-eidolon',
      'plant-eidolon', 'psychopomp-eidolon', 'undead-eidolon']) {
      expect(idx.get(id)?.missing ?? []).not.toContain('language');
    }
  });
});
