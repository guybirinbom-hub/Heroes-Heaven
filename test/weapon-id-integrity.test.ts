import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { FEAT_GRANTS } from '../src/rules/featGrants';

const db = content();

/**
 * EVERY WEAPON ID A FEAT NAMES MUST EXIST.
 *
 * Tengu Weapon Familiarity listed `khakkara` and `wakazashi`; the shipped items are `khakkhara` and
 * `wakizashi`. Two of the four weapons the feat prints got no familiarity and no critical
 * specialization — silently, because nothing ever checked a `weaponFamiliarity` or `critSpecWeapons`
 * list against `core.items`. A typo in one of these lists cannot be seen on the sheet: the weapon simply
 * is not on it.
 *
 * Found by comparing our list against Wanderer's Guide's, which spells both correctly. This guard is so
 * that the next one is found by the test suite instead.
 */

const items = db.items as Record<string, { itemType?: string; name?: string }>;

/** Weapon ids named across every grant table, tagged with where they came from. */
function namedWeaponIds(): { id: string; from: string }[] {
  const out: { id: string; from: string }[] = [];
  for (const [featId, g] of Object.entries(FEAT_GRANTS)) {
    const wf = Array.isArray(g.weaponFamiliarity) ? g.weaponFamiliarity : g.weaponFamiliarity ? [g.weaponFamiliarity] : [];
    for (const w of wf) for (const id of w.weapons ?? []) out.push({ id, from: `FEAT_GRANTS.${featId}.weaponFamiliarity` });
  }
  /* …and the records' own `critSpecWeapons`, which names base weapons the same way. */
  for (const bucket of ['feats', 'classFeatures', 'heritages', 'ancestries'] as const) {
    for (const [id, rec] of Object.entries((db as unknown as Record<string, Record<string, { critSpecWeapons?: { bases?: string[] } }>>)[bucket] ?? {})) {
      for (const b of rec?.critSpecWeapons?.bases ?? []) out.push({ id: b, from: `${bucket}/${id}.critSpecWeapons.bases` });
    }
  }
  return out;
}

describe('weapon ids named by feats', () => {
  it('finds ids to check (so a silent zero cannot pass)', () => {
    expect(namedWeaponIds().length).toBeGreaterThan(50);
  });

  it('every named weapon id is a real item', () => {
    const dead = namedWeaponIds()
      /*
       * ⚠ A `{actor|…}` or `{item|…}` entry is a PLACEHOLDER, not a dead id. It stands for the player's
       * own pick and is substituted at read time by the resolver in `critSpecSources`. I mistook these
       * for leaked template text and stripped them, which broke six passing tests — including
       * test/gird-champion.test.ts, which pins the placeholder on purpose. Skipped here by shape, and
       * the resolution itself is tested there rather than by asserting the string is an item.
       */
      .filter(({ id }) => !/^\{(?:actor|item)\|/.test(id))
      .filter(({ id }) => !items[id])
      .map(({ id, from }) => `${id} (${from})`);
    expect([...new Set(dead)]).toEqual([]);
  });

  it('every named weapon id is actually a WEAPON', () => {
    const wrong = namedWeaponIds()
      /* The Dueling Cape is ADVENTURING GEAR that Performative Weapons Training names anyway, exactly as
       * the book does — it has no damage die and is used to Disarm and Feint. Our typing is right and so
       * is the feat; the pair is simply not a weapon-and-weapon-list. Exempted by name, not by loosening
       * the rule. */
      .filter(({ id }) => id !== 'dueling-cape')
      .filter(({ id }) => items[id] && items[id].itemType !== 'weapon')
      .map(({ id, from }) => `${id} is ${items[id].itemType} (${from})`);
    expect([...new Set(wrong)]).toEqual([]);
  });

  /* The record that prompted the guard, pinned by name so a re-import cannot quietly revert it. */
  it('Tengu Weapon Familiarity names all four printed weapons, spelled as they ship', () => {
    const wf = FEAT_GRANTS['tengu-weapon-familiarity']?.weaponFamiliarity;
    const list = (Array.isArray(wf) ? wf : wf ? [wf] : []).flatMap((w) => w.weapons ?? []);
    expect([...list].sort()).toEqual(['katana', 'khakkhara', 'temple-sword', 'wakizashi']);
    for (const id of list) expect(items[id]?.name, `${id} must be a shipped item`).toBeTruthy();
  });
});
