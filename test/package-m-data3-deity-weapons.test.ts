import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, content } from './_content';
import { critSpecSources, deityFavoredWeapons, deriveStrikes, strikeShowsCritSpec, type Strike } from '../src/rules/derive';
import { buildCharacter, deityFavorsSimpleOrUnarmed, emptyBuild, vindicatorGetsDeadlySimplicity } from '../src/rules/build';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * PACKAGE M, ROUND 3 (b) — Malthus's favored weapon is the Crossbow, read through the page's own link.
 *
 * deity-528 (Malthus, Lost Omens Divine Mysteries pg. 314) prints "**Favored Weapon** [Light
 * Crossbow](/Weapons.aspx?ID=425)". No weapon page is titled Light Crossbow: the Archives' own link names
 * weapon-425, Player Core's Crossbow (legacy_id weapon-67, the Core Rulebook Crossbow), which ships as
 * items/crossbow. The record carried the link TEXT, 'light-crossbow', an id no item has — and a favored weapon
 * that is no item is read as an UNARMED attack (derive.ts deityFavoredWeapons). Since round 2 a Malthus
 * warpriest's or cloistered cleric's doctrine critical specialization ("using your deity's favored weapon",
 * doctrine-5 / doctrine-4) reached no weapon at all, and Deadly Simplicity raised the Fist's die instead of
 * the crossbow's.
 *
 * scripts/deity-fields-check.mjs (npm run verify) compared favored weapons by printed NAME and so refused the
 * corrected record. It now reads an unmatched name through the page's link (and that page's reprint chain)
 * to the one shipped item, refusing a link to the Fist page (a natural attack is never the Fist). This file
 * pins the record, the sheet, and the check — the check red on planted scratch inputs and on scratch copies of
 * itself with each new step taken out, never in the tree.
 *
 * WG has no deity table (scripts/wg-show.mjs "Malthus": no row), so there is nothing of theirs to compare.
 */
const db = content();
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const SCRIPT = 'scripts/deity-fields-check.mjs';

const held = (itemId: string): InventoryItem => ({ instanceId: `pm3-${itemId}`, itemId, quantity: 1, equipped: true });
const wielding = (c: Character, ...ids: string[]): Character => ({ ...c, inventory: [...c.inventory, ...ids.map(held)] });
const strikeNamed = (c: Character, d: ContentDatabase, name: string): Strike => {
  const s = deriveStrikes(c, d).find((x) => x.name === name);
  if (!s) throw new Error(`no Strike named ${name}`);
  return s;
};
const shows = (c: Character, d: ContentDatabase, name: string) => strikeShowsCritSpec(strikeNamed(c, d, name), critSpecSources(c, d), c);
/** The database as it shipped before this round — the planted bad case, in memory only. */
const oldRecord = { ...db, deities: { ...db.deities, malthus: { ...db.deities['malthus'], favoredWeapons: ['light-crossbow'] } } } as ContentDatabase;

describe('the record', () => {
  // batch package-m premise: deity-528 "**Favored Weapon** [Light Crossbow](/Weapons.aspx?ID=425)"
  it('deities/malthus names items/crossbow, the weapon-425 the page links', () => {
    expect(db.deities['malthus']).toMatchObject({ aonId: 'deity-528', favoredWeapons: ['crossbow'] });
    expect(db.items['crossbow']).toMatchObject({ aonId: 'weapon-425', category: 'simple', hands: 2 });
    expect(db.items['light-crossbow']).toBeUndefined();
    const page = JSON.parse(readFileSync(join(MIRROR, 'deity/deity-528.json'), 'utf8')) as { favored_weapon_markdown?: string };
    expect(page.favored_weapon_markdown).toBe('[Light Crossbow](/Weapons.aspx?ID=425)');
    const weapon = JSON.parse(readFileSync(join(MIRROR, 'weapon/weapon-425.json'), 'utf8')) as { name: string; legacy_id?: string[] };
    expect(weapon).toMatchObject({ name: 'Crossbow', legacy_id: ['weapon-67'] });
  });

  it('every shipped deity favored weapon is an item or a body part — none is left unresolved', () => {
    const BODY_PARTS = new Set(['fist', 'claw', 'claws', 'jaw', 'jaws', 'fang', 'fangs', 'tail', 'nails', 'horn', 'horns', 'tentacle', 'tentacles', 'wing', 'wings', 'beak', 'talon', 'talons']);
    const unresolved = (d: ContentDatabase) =>
      Object.entries(d.deities).flatMap(([id, dz]) => (dz.favoredWeapons ?? []).filter((w) => !d.items[w] && !BODY_PARTS.has(w)).map((w) => `${id}:${w}`));
    expect(unresolved(db)).toEqual([]);
    expect(unresolved(oldRecord), 'planted: the old record is caught').toEqual(['malthus:light-crossbow']);
  });
});

describe('a Malthus warpriest 7 — the doctrine\'s critical specialization on the crossbow only', () => {
  const warpriest = () => wielding(build('cleric', 7, { subclassId: 'warpriest', deityId: 'malthus' }), 'crossbow', 'longsword');

  // batch package-m premise: doctrine-5 "When you critically succeed at an attack roll using your deity's favored weapon, you apply the weapon's critical specialization effect"
  it('crossbow yes, longsword no, Fist no', () => {
    const c = warpriest();
    expect(deityFavoredWeapons(c, db)).toEqual({ bases: ['crossbow'], unarmed: [] });
    expect(shows(c, db, 'Crossbow')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
    expect(shows(c, db, 'Fist')).toBe(false);
  });

  it('planted: the old record reaches no weapon at all (what round 2 shipped)', () => {
    const c = warpriest();
    expect(deityFavoredWeapons(c, oldRecord)).toEqual({ bases: [], unarmed: ['light-crossbow'] });
    expect(shows(c, oldRecord, 'Crossbow')).toBe(false);
    expect(shows(c, oldRecord, 'Longsword')).toBe(false);
  });

  it('a cloistered cleric of Malthus: from 11th, the crossbow only', () => {
    const c = wielding(build('cleric', 11, { subclassId: 'cloistered-cleric', deityId: 'malthus' }), 'crossbow', 'longsword');
    expect(shows(c, db, 'Crossbow')).toBe(true);
    expect(shows(c, db, 'Longsword')).toBe(false);
  });

  it('with the trust gate on, as the app runs (deities are on, ruling R17 Q2)', () => {
    const gated = content({ trustGate: true });
    expect(gated.deities['malthus'].favoredWeapons).toEqual(['crossbow']);
    expect(shows(warpriest(), gated, 'Crossbow')).toBe(true);
    expect(shows(warpriest(), gated, 'Longsword')).toBe(false);
  });

  // Deadly Simplicity: "If your deity's favored weapon is a simple weapon … increase the damage die" (feat-4642)
  it('Deadly Simplicity now raises the crossbow (simple, d8 -> d10), not the Fist', () => {
    const c = warpriest();
    expect(deityFavorsSimpleOrUnarmed('malthus', db)).toBe(true);
    expect(c.feats.some((f) => f.featId === 'deadly-simplicity'), 'the warpriest has it').toBe(true);
    expect(strikeNamed(c, db, 'Crossbow').dieFaces).toBe(10);
    expect(strikeNamed(c, db, 'Fist').dieFaces).toBe(4);
    // planted: the old record read 'light-crossbow' as an unarmed attack and raised the Fist instead
    expect(strikeNamed(c, oldRecord, 'Crossbow').dieFaces).toBe(8);
    expect(strikeNamed(c, oldRecord, 'Fist').dieFaces).toBe(6);
  });

  // batch package-m premise: doctrine-5 "Third Doctrine (7th) You gain expert proficiency with your deity's favored weapon"
  it('the favored-weapon proficiency row now names the crossbow (the Details list shows "Crossbow: expert")', () => {
    expect(warpriest().proficiencies.weaponOverrides?.['crossbow']).toBe('expert');
    // planted: the old record named no item, so build.ts wrote no row at all
    const old = buildCharacter({ ...emptyBuild(), name: 't', level: 7, classId: 'cleric', ancestryId: Object.keys(db.ancestries)[0], backgroundId: Object.keys(db.backgrounds)[0], keyAbility: 'wis', subclassId: 'warpriest', deityId: 'malthus' }, oldRecord);
    expect(old.proficiencies.weaponOverrides?.['crossbow']).toBeUndefined();
    expect(old.proficiencies.weaponOverrides?.['light-crossbow']).toBeUndefined();
  });
});

describe('a Malthus vindicator gains Deadly Simplicity (the crossbow is a simple weapon)', () => {
  // batch package-m premise: archetype-285 "If your deity's favored weapon is a simple weapon or unarmed attack with a damage die smaller than d6, you gain the Deadly Simplicity feat."
  const vindicator = () => build('ranger', 5, { subclassId: 'vindicator', keyAbility: 'dex', deityId: 'malthus', featPicks: { '2:class:0': 'vindicator-dedication' } });

  it('the grant fires for Malthus, and the crossbow\'s die is raised', () => {
    expect(vindicatorGetsDeadlySimplicity('malthus', db)).toBe(true);
    const c = wielding(vindicator(), 'crossbow');
    expect(c.feats.filter((f) => f.featId === 'deadly-simplicity').map((f) => f.grantedBy)).toEqual(['vindicator']);
    expect(strikeNamed(c, db, 'Crossbow').dieFaces).toBe(10);
  });

  it('planted: the old record (no item, not the fist) gave a Malthus vindicator nothing', () => {
    expect(vindicatorGetsDeadlySimplicity('malthus', oldRecord)).toBe(false);
  });
});

/* ---------------------------------------------------------------------------------------------------------
 * scripts/deity-fields-check.mjs — run for real on scratch inputs (CORE_JSON, CORE_DESCRIPTIONS, AON_MIRROR)
 * and, for each new step, on a scratch copy of itself with that step taken out.
 * ------------------------------------------------------------------------------------------------------- */
let dir = '';
let mirror = '';
const FALLBACK_LINE = 'const hit = weaponByLink(doc, name);';
const CHAIN_LINE = '    chain.push(cur);\n';
const UNARMED_LINE = "if (it?.category === 'unarmed' || (it?.traits ?? []).includes('unarmed')) return null;";

type Deity = Record<string, unknown>;
const malthusRecord = (): Deity => {
  const { description: _d, ...rec } = db.deities['malthus'] as unknown as Record<string, unknown>;
  return rec;
};
/** A small core: the two weapons the links can reach, Malthus's spells, and the deities named. */
function writeCore(deities: Record<string, Deity>): { core: string; descs: string } {
  const root = mkdtempSync(join(dir, 'core-'));
  const spells = Object.fromEntries(((db.deities['malthus'].spells ?? []) as string[]).map((s) => [s, { id: s, name: db.spells[s].name }]));
  const core = {
    items: {
      crossbow: { id: 'crossbow', name: 'Crossbow', aonId: 'weapon-425', itemType: 'weapon', category: 'simple', traits: [] },
      'aon-fist': { id: 'aon-fist', name: 'Fist', aonId: 'weapon-356', itemType: 'weapon', category: 'unarmed', traits: ['agile', 'finesse', 'nonlethal', 'unarmed'] },
    },
    spells,
    deities,
  };
  writeFileSync(join(root, 'core.json'), JSON.stringify(core));
  writeFileSync(join(root, 'core-descriptions.json'), '{}');
  return { core: join(root, 'core.json'), descs: join(root, 'core-descriptions.json') };
}
const fixtureDeities = (malthusWeapons: string[]): Record<string, Deity> => ({
  malthus: { ...malthusRecord(), favoredWeapons: malthusWeapons },
  // A planted page whose unmatched name links the LEGACY Crossbow page (weapon-67): only the reprint chain
  // (67 -> 425) reaches items/crossbow.
  'test-legacy-link': { id: 'test-legacy-link', name: 'Test Legacy Link', aonId: 'deity-990002', rarity: 'common', favoredWeapons: ['crossbow'] },
  // A planted page whose unmatched name links the Fist page: a natural attack, never the Fist item.
  'test-paw': { id: 'test-paw', name: 'Test Paw', aonId: 'deity-990001', rarity: 'common', favoredWeapons: ['paw'] },
});
function check(script: string, inputs: { core: string; descs: string } | null) {
  const env = { ...process.env, ...(inputs ? { CORE_JSON: inputs.core, CORE_DESCRIPTIONS: inputs.descs, AON_MIRROR: mirror } : {}) };
  const r = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}
function mutant(find: string, replace: string): string {
  const src = readFileSync(SCRIPT, 'utf8');
  expect(src.split(find).length - 1, `the step the mutant takes out occurs exactly once: ${find}`).toBe(1);
  const p = join(mkdtempSync(join(dir, 'mut-')), 'deity-fields-check.mjs');
  writeFileSync(p, src.replace(find, replace));
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm3-deity-'));
  mirror = join(dir, 'mirror');
  for (const sub of ['deity', 'weapon', 'spell', 'domain']) mkdirSync(join(mirror, sub), { recursive: true });
  copyFileSync(join(MIRROR, 'deity/deity-528.json'), join(mirror, 'deity/deity-528.json'));
  for (const w of ['weapon-425', 'weapon-67', 'weapon-1', 'weapon-356']) copyFileSync(join(MIRROR, `weapon/${w}.json`), join(mirror, `weapon/${w}.json`));
  writeFileSync(join(mirror, 'deity/deity-990001.json'), JSON.stringify({ id: 'deity-990001', name: 'Test Paw', rarity: 'common', favored_weapon: ['Paw'], favored_weapon_markdown: '[Paw](/Weapons.aspx?ID=1)' }));
  writeFileSync(join(mirror, 'deity/deity-990002.json'), JSON.stringify({ id: 'deity-990002', name: 'Test Legacy Link', rarity: 'common', favored_weapon: ['Light Crossbow'], favored_weapon_markdown: '[Light Crossbow](/Weapons.aspx?ID=67)' }));
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// Each run is a child process reading the mirror's weapon pages; a minute per test under load.
describe('scripts/deity-fields-check.mjs reads an unmatched favored weapon through the page\'s link', { timeout: 60_000 }, () => {
  it('the shipped tree passes it', () => {
    const r = check(SCRIPT, null);
    expect(r.out).toMatch(/favoredWeapons\s+differs on\s+0 record/);
    expect(r.status).toBe(0);
  });

  it('on the scratch inputs: Malthus as crossbow, the legacy-link page through the reprint chain, and the paw kept as a body part — green', () => {
    const r = check(SCRIPT, writeCore(fixtureDeities(['crossbow'])));
    expect(r.out).toMatch(/favoredWeapons\s+differs on\s+0 record/);
    expect(r.status, r.out).toBe(0);
  });

  it('planted record: the old light-crossbow is a difference now, and the repair names items/crossbow through weapon-425', () => {
    const r = check(SCRIPT, writeCore(fixtureDeities(['light-crossbow'])));
    expect(r.status).toBe(1);
    expect(r.out).toContain('malthus: ours light-crossbow | print crossbow');
  });

  it('planted script: without the link fallback the corrected record fails, as it did before this round', () => {
    const r = check(mutant(FALLBACK_LINE, 'const hit = null;'), writeCore(fixtureDeities(['crossbow'])));
    expect(r.status).toBe(1);
    expect(r.out).toContain('malthus: ours crossbow | print light-crossbow');
    expect(r.out).toMatch(/unresolved favoredWeapons[\s\S]*malthus: light-crossbow/);
  });

  it('planted script: without the reprint chain a link to the legacy page reaches no item', () => {
    const r = check(mutant(CHAIN_LINE, ''), writeCore(fixtureDeities(['crossbow'])));
    expect(r.status).toBe(1);
    expect(r.out).toContain('test-legacy-link: ours crossbow | print light-crossbow');
  });

  it('planted script: without the unarmed refusal a name linked to the Fist page would become the Fist item', () => {
    const r = check(mutant(UNARMED_LINE, ''), writeCore(fixtureDeities(['crossbow'])));
    expect(r.status).toBe(1);
    expect(r.out).toContain('test-paw: ours paw | print aon-fist');
  });
});
