import { describe, it, expect, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { content, build } from './_content';
import { deriveEidolon, LANGUAGE_UNCHOSEN } from '../src/rules/companions';
import { COMPANION_MODS } from '../src/rules/companionGrants';
import type { CompanionConfig, EidolonConfig } from '../src/rules/types';

/*
 * BATCH 033 — the closer's own two fixes, both on eidolon TYPE rows that were dead on arrival.
 *
 * COMPANION_MODS holds eleven rows keyed by a summoner SUBCLASS OPTION id, and deriveEidolon's pass
 * over that table only ever matched the OWNER'S FEAT ids. A subclass option is a classFeature, never
 * a feat, so every one of those rows was inert: the notes and senses they carry reached no player.
 * Both tests below build a real summoner and read the derived eidolon block.
 */

const eidolonCfg = (typeId: string, eidolon: EidolonConfig = {}): CompanionConfig => ({
  id: `c-${typeId}`,
  kind: 'eidolon',
  name: 'Test Eidolon',
  typeId,
  eidolon,
});

const blockFor = (typeId: string, eidolon: EidolonConfig = {}) => {
  const c = content();
  const ch = build('summoner', 5, { subclassId: typeId });
  return deriveEidolon(eidolonCfg(typeId, eidolon), ch, c);
};

describe('batch 033 closer — devotion-phantom-eidolon language', () => {
  // batch 033: devotion-phantom-eidolon#language
  // AoN eidolon-20: "Language one common mortal language the eidolon spoke in life". The line was
  // description prose only — nothing asked the question and nothing recorded the answer.
  it('devotion-phantom-eidolon shows an unanswered language slot as a prompt', () => {
    expect(COMPANION_MODS['devotion-phantom-eidolon'].languageChoices).toBe(1);
    const b = blockFor('devotion-phantom-eidolon');
    expect(b.languages).toEqual([LANGUAGE_UNCHOSEN]);
  });

  // batch 033: devotion-phantom-eidolon#language
  it('devotion-phantom-eidolon renders the language the player picked', () => {
    const b = blockFor('devotion-phantom-eidolon', { languages: ['dwarven'] });
    expect(b.languages).toEqual([content().languages.dwarven.name]);
  });

  // batch 033: devotion-phantom-eidolon#language
  // The type rows were dead: the same pass carries the type's senses, so darkvision is the proof
  // that matching on cfg.typeId (not only on the owner's feats) is what switched them on.
  it('devotion-phantom-eidolon gains its printed darkvision from the type row', () => {
    expect(blockFor('devotion-phantom-eidolon').senses).toContain('darkvision');
  });

  // batch 033: devotion-phantom-eidolon#language
  // An eidolon whose printed Language line is a fixed list asks nothing, so no slot is shown.
  it('an eidolon type with no language question (beast-eidolon) shows no languages row', () => {
    expect(blockFor('beast-eidolon').languages).toBeUndefined();
  });
});

describe('batch 033 closer — elemental-eidolon core note', () => {
  // batch 033: elemental-eidolon#core-note-generalises-fire
  // Print (AoN eidolon-12) gives the resistance/weakness/+1 damage to FIRE alone; the note gave it to
  // every core, so five of the six were shown a benefit they do not have.
  it('elemental-eidolon note names all six cores and confines the fire benefit to fire', () => {
    const note = COMPANION_MODS['elemental-eidolon'].note ?? '';
    for (const core of ['AIR', 'EARTH', 'FIRE', 'METAL', 'WATER', 'WOOD']) expect(note).toContain(core);
    expect(note).toContain('minimum 1');
    // The wrong generalisation, verbatim from the old note.
    expect(note).not.toContain("your core's damage type");
  });

  // batch 033: elemental-eidolon#core-note-generalises-fire
  it('elemental-eidolon reaches the block, which is what made the old note wrong in play', () => {
    const b = blockFor('elemental-eidolon');
    expect(b.evoNotes?.some((n) => n.startsWith('Elemental Core'))).toBe(true);
    expect(b.senses).toContain('darkvision');
  });
});

/*
 * THE CLOSER'S THREE OFF_RECORD_CARRIERS ENTRIES (scripts/wg-diff.mjs).
 *
 * All three gate KINDS lines were "a mechanic that ships, in a place wg-diff cannot read off the
 * record" — the fixed eidolon Language line (src/rules/companionGrants.ts COMPANION_MODS.languages)
 * and the light mortar's tiered modification pickers (inventorModificationOptions in
 * src/rules/build.ts). OFF_RECORD_CARRIERS is not one of the four audited settle registries, so no
 * `mutation-proof` marker is owed; what IS owed is proof that the credit is PER ID rather than blanket,
 * because the one shape that would have laundered real gaps here is putting `language` on the
 * companionGrants.ts file row (REGISTRY_KINDS credits a file's kinds to every id in it). The five
 * eidolon types that print a Language line and still carry no row are that control group.
 */
const CLI_ROOT = join(__dirname, '..');
const diffIndex = () => {
  const rel = 'work/.b033-closer-diff-test.json';
  try {
    execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-diff.mjs'), '--out', rel], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    const j = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8')) as Record<string, { id: string; missing: string[] }[]>;
    const idx = new Map<string, { id: string; missing: string[]; bucket: string }>();
    for (const bucket of ['theyOnly', 'weOnly', 'agree']) for (const r of j[bucket] ?? []) idx.set(r.id, { ...r, bucket });
    return idx;
  } finally { rmSync(join(CLI_ROOT, rel), { force: true }); }
};

describe('batch 033 closer — angel-eidolon, fey-eidolon and light-mortar-innovation credit their off-record carriers', () => {
  // batch 033: angel-eidolon#language
  it('angel-eidolon and fey-eidolon no longer report the language kind, and the uncredited types still do', () => {
    const idx = diffIndex();
    // batch 033: fey-eidolon#language
    for (const id of ['angel-eidolon', 'fey-eidolon']) expect(idx.get(id)?.missing).toEqual([]);
    /* The control group: same printed Language line, no COMPANION_MODS.languages row, still red. If a
     * later hand moves the credit onto the companionGrants.ts file row, these five go quiet and this
     * test fails — which is the whole reason they are asserted. */
    // batch 033: angel-eidolon#language
    for (const id of ['beast-eidolon', 'demon-eidolon', 'plant-eidolon', 'psychopomp-eidolon', 'undead-eidolon']) {
      expect(idx.get(id)?.missing).toContain('language');
    }
  });

  // batch 033: light-mortar-innovation#duplicate-modification-choice
  it('light-mortar-innovation reports no missing kind, and `conditional` was answered without a settle', () => {
    const r = diffIndex().get('light-mortar-innovation');
    expect(r?.missing).toEqual([]);
    /* Only `choice` is settled. `conditional` is answered on every run by a real carrier, so a settle
     * naming it would have laundered a kind we deliver — it must NOT be in the entry. */
    const src = readFileSync(join(CLI_ROOT, 'scripts/wg-diff.mjs'), 'utf8');
    expect(src).toContain("'light-mortar-innovation': ['choice'],");
  });
});
