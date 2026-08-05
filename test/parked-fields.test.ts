import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';

/**
 * TRIPWIRES for fields that are carried by real records and DELIBERATELY not read.
 *
 * Each one is parked for a stated reason, not forgotten. A comment explaining that is easy to miss
 * when you are three files deep implementing something else — so these tests fail the build the
 * moment someone wires one up, and tell them what to go read.
 *
 * If a test here fails because you added the reader ON PURPOSE: good. Do the thing the message asks
 * for, then delete that test. It has done its job.
 */
const db = content();

/** Every .ts/.tsx under src/, as [path, source]. */
function sourceFiles(dir = 'src'): [string, string][] {
  const out: [string, string][] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e)) out.push([p.replace(/\\/g, '/'), readFileSync(p, 'utf8')]);
  }
  return out;
}
/** Comments stripped: a warning ABOUT a parked field must not read as a use OF it — the first run of
 *  this file failed on its own explanatory comment. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const FILES = sourceFiles().map(([p, src]) => [p, stripComments(src)] as [string, string]);

/** Files containing a real property ACCESS of `name` (`.name` or `name:` in a destructure), not a
 *  mention. Bare word-matching is too loose — `restriction` alone hits five unrelated files. */
function readersOf(name: string, allow: string[]): string[] {
  const re = new RegExp(`(?:\\.\\s*${name}\\b|\\b${name}\\s*[,}])`);
  return FILES.filter(([p, src]) => !allow.includes(p) && re.test(src)).map(([p]) => p);
}

describe('Spell.damageKind — parked until a numeric spell-damage bonus exists', () => {
  it('is carried by real records, so it is worth keeping', () => {
    const carriers = Object.values(db.spells).filter((s) => s.damageKind);
    expect(carriers.length).toBeGreaterThan(400);
    expect(carriers.filter((s) => s.damageKind === 'healing').length).toBeGreaterThan(20);
  });

  it('has no reader — and if you just gave it one, READ THIS', () => {
    const readers = readersOf('damageKind', ['src/rules/types.ts']);
    expect(
      readers,
      [
        '',
        'Spell.damageKind now has a reader. That is fine — but it exists for ONE reason:',
        'a numeric bonus to spell damage must not add itself to a HEAL. 31 spells heal.',
        '',
        'Check each granting record\'s OWN words before excluding healing:',
        "  Sorcerous Potency — 'a spell that deals damage OR RESTORES HIT POINTS'  -> covers BOTH",
        "  Dangerous Sorcery — 'a spell that deals damage'                          -> damage only",
        '',
        'When you have handled that, delete this test.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('spellDamage situational entries are still prose, which is why healing cannot be wrong yet', () => {
    // A situational entry renders a "when" the player applies themselves. The moment one becomes a
    // number, the test above is the one that matters.
    // Read RAW — FILES has comments stripped, and the warning being checked for IS a comment.
    const raw = readFileSync('src/rules/situationalBonuses.ts', 'utf8');
    expect(raw).toMatch(/spellDamage/);
    expect(raw, 'the warning explaining why this is prose must stay').toMatch(/PROSE ONLY/);
  });
});

describe('SpellSlotBonus.restriction — display-only, and not yet displayed', () => {
  it('one record carries it', () => {
    const carriers = Object.values(db.feats).filter((f) => f.spellSlotBonus?.restriction);
    expect(carriers.length).toBeGreaterThan(0);
  });

  it('nothing displays it — and if you just made it, show it WITH the slot', () => {
    const readers = readersOf('restriction', ['src/rules/types.ts', 'test/parked-fields.test.ts']);
    expect(
      readers,
      [
        '',
        'SpellSlotBonus.restriction now has a reader.',
        'It is the caveat on a GRANTED slot — Gifted Power reads',
        "  'Only to cast one of your mystery\\'s granted spells, heightened to this rank.'",
        'A player looking at an extra slot must see that limit ON THE SLOT, not in a list',
        'somewhere else, or they will spend it on the wrong spell. Then delete this test.',
      ].join('\n'),
    ).toEqual([]);
  });
});

describe('dailyTemporaryItems filter.fromKnownFormulas — recorded, not enforced', () => {
  it('a record carries it', () => {
    const carriers = Object.values(db.feats).filter((f) =>
      (f.dailyTemporaryItems ?? []).some((d) => d.filter.fromKnownFormulas),
    );
    expect(carriers.length).toBeGreaterThan(0);
  });

  it('the pool is not filtered by it — deliberately', () => {
    // Herbal Forager makes "one temporary alchemical item YOU KNOW THE FORMULA FOR". The app does not
    // model a formula book, so the restriction is shown on the picker as a note the player honours.
    // Narrowing the pool to a formula list the app does not have would offer them nothing at all.
    const src = FILES.find(([p]) => p === 'src/rules/dailyItems.ts')![1];
    const consulted = /slot\.fromKnownFormulas/.test(src);
    expect(
      consulted,
      [
        '',
        'dailyItemOptions now filters on fromKnownFormulas.',
        'Make sure a character with NO recorded formulas still gets a usable pool —',
        'the app has no formula book, so filtering on one can only ever offer nothing.',
        'If you added a formula book, this is right: delete this test.',
      ].join('\n'),
    ).toBe(false);
  });
});
