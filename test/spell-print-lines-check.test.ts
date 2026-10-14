import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import {
  spellPrintLineOffenders,
  baselineProblems,
  applyPendingSpellRows,
  BASELINE,
  CHECKS,
} from '../scripts/spell-print-lines-check.mjs';

/**
 * scripts/spell-print-lines-check.mjs (npm run verify) holds shut the class batch P02 found on
 * spells/conjurers-countermeasure (spell-2876: no cast although the page prints "Single Action", no
 * duration although it prints "Duration until the end of your next turn", a description opening with the
 * scraped "Conjurer's Countermeasure \nSource Impossible Magic pg. 179" header) and on
 * spells/turbulent-tide (spell-2885: a printed Requirements line shown nowhere).
 *
 * The fixture is synthetic; the last test measures the real data with the batch's rows applied in memory.
 */
const doc = (over: Record<string, unknown>) => ({ id: 'spell-1', name: 'Fixture', ...over });

describe('spell print lines guard (conjurers-countermeasure, turbulent-tide)', () => {
  // batch P02: conjurers-countermeasure#cast-duration
  it('conjurers-countermeasure: a page printing an action cost and a duration needs cast and duration', () => {
    const docs = { 'spell-1': doc({ actions: 'Single Action', duration_raw: 'until the end of your next turn' }) };
    const bare = { 'conjurers-countermeasure': { name: "Conjurer's Countermeasure", aonId: 'spell-1' } };
    expect(spellPrintLineOffenders({ spells: bare, descriptions: {}, docs })).toMatchObject({
      cast: ['conjurers-countermeasure'],
      duration: ['conjurers-countermeasure'],
    });
    const fixed = { 'conjurers-countermeasure': { ...bare['conjurers-countermeasure'], cast: { type: 'actions', value: 1 }, duration: 'until the end of your next turn' } };
    const f = spellPrintLineOffenders({ spells: fixed, descriptions: {}, docs });
    expect([f.cast, f.duration]).toEqual([[], []]);
  });

  // batch P02: conjurers-countermeasure#cast-duration
  it('conjurers-countermeasure: a ritual and a record with no mirror page are never judged', () => {
    const docs = { 'spell-1': doc({ actions: 'Single Action', duration_raw: '1 minute' }) };
    const spells = {
      rite: { name: 'Rite', aonId: 'spell-1', ritual: true },
      homebrew: { name: 'Homebrew' },
    };
    const f = spellPrintLineOffenders({ spells, descriptions: {}, docs });
    expect([f.cast, f.duration, f.requirements]).toEqual([[], [], []]);
  });

  // batch P02: conjurers-countermeasure#description
  it('conjurers-countermeasure: a description opening with the scraped page header is caught', () => {
    const spells = { 'conjurers-countermeasure': { name: "Conjurer's Countermeasure" } };
    const scraped = { 'conjurers-countermeasure': { d: "Conjurer's Countermeasure \nSource Impossible Magic pg. 179\n\nDuration until the end of your next turn \n\nYou quickly create a barrier" } };
    expect(spellPrintLineOffenders({ spells, descriptions: scraped, docs: {} }).header).toEqual(['conjurers-countermeasure']);
    const clean = { 'conjurers-countermeasure': { d: 'You quickly create a barrier that protects you against the magic of spellcraft.' } };
    expect(spellPrintLineOffenders({ spells, descriptions: clean, docs: {} }).header).toEqual([]);
  });

  // batch P02: turbulent-tide#requirements
  it('turbulent-tide: a printed Requirements line must be shown, inline or as a field', () => {
    const docs = { 'spell-1': doc({ requirement: "You're wielding an improvised weapon." }) };
    const spells = { 'turbulent-tide': { name: 'Turbulent Tide', aonId: 'spell-1' } };
    expect(spellPrintLineOffenders({ spells, descriptions: { 'turbulent-tide': { d: 'Water surges.' } }, docs }).requirements).toEqual(['turbulent-tide']);
    const inline = { 'turbulent-tide': { d: "**Requirements** You're wielding an improvised weapon.\n\n---\n\nWater surges." } };
    expect(spellPrintLineOffenders({ spells, descriptions: inline, docs }).requirements).toEqual([]);
  });

  // batch P02: turbulent-tide#requirements
  it('turbulent-tide: the baseline only shrinks - a new offender fails, and so does a listed one now right', () => {
    const baseline = { header: [], cast: ['old'], duration: [], requirements: [] };
    const found = { header: [], cast: ['turbulent-tide'], duration: [], requirements: [] };
    const p = baselineProblems(found, baseline);
    expect(p.some((l) => l.startsWith('cast: spells/turbulent-tide has no cast'))).toBe(true);
    expect(p.some((l) => l.startsWith('cast: spells/old is in ') && l.includes('remove the entry'))).toBe(true);
    expect(baselineProblems(found, { ...baseline, cast: ['turbulent-tide'] })).toEqual([]);
  });

  const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/spell';
  // batch P02: conjurers-countermeasure#cast-duration
  it.skipIf(!existsSync(MIRROR))('conjurers-countermeasure: the shipped data with batch P02 rows applied matches the baseline exactly', () => {
    const docs: Record<string, unknown> = {};
    for (const f of readdirSync(MIRROR)) {
      const j = JSON.parse(readFileSync(`${MIRROR}/${f}`, 'utf8'));
      if (j?.id) docs[j.id] = j;
    }
    const spells = JSON.parse(readFileSync('public/core.json', 'utf8')).spells;
    const descriptions = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')).spells;
    // Applying a row twice is a no-op, so this holds before and after the driver applies the rows.
    for (const f of readdirSync('work').filter((n) => /^\.bP02-rows-.+\.json$/.test(n))) {
      applyPendingSpellRows(spells, descriptions, JSON.parse(readFileSync(`work/${f}`, 'utf8')));
    }
    const found = spellPrintLineOffenders({ spells, descriptions, docs });
    expect(baselineProblems(found, JSON.parse(readFileSync(BASELINE, 'utf8')))).toEqual([]);
    // the P02 records are off the lists their rows fix (booming-blast and force-fling were fixed for
    // cast only - their descriptions keep the header, which the baseline lists)
    for (const c of CHECKS) expect(found[c]).not.toContain('conjurers-countermeasure');
    expect(found.requirements).not.toContain('turbulent-tide');
    for (const id of ['booming-blast', 'force-fling']) expect(found.cast).not.toContain(id);
    // Reads about 2,800 mirror pages plus core.json and core-descriptions.json: about 1.7 s alone, far longer
    // (over the 5 s default) when the whole suite runs at once.
  }, 300_000);
});
