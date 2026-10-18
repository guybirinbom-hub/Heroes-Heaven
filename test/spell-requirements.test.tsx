// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { spellStatRows } from '../src/sheet/SpellsTab';
import { spellCardModel } from '../src/sheet/spellCard';
import { fillSpellRequirements, requirementsText } from '../scripts/lib/spell-requirements.mjs';
import { spellPrintLineOffenders } from '../scripts/spell-print-lines-check.mjs';
import type { Spell } from '../src/rules/types';

/**
 * Package I, I6d (2026-10-18): A SPELL CARRIES ITS PAGE'S REQUIREMENTS LINE AS A FIELD.
 *
 * The Archives print a Requirements line above some spells' body — Thunderous Strike (spell-2885) "You’re
 * wielding a melee weapon in two hands.", Deity's Strike (spell-2673) "You have a deity." — as the document's
 * `data.requirement`. The popup's PAGE lane printed it from the page; the FIELD lane (no page loaded, a homebrew
 * copy) printed it nowhere, because `Spell` had no field (batch P02 parked it, turbulent-tide#requirements).
 * scripts/import-core-v2.mjs now fills `requirements` from each spell's own page (scripts/lib/spell-requirements.mjs)
 * and SpellsTab.tsx spellStatRows prints it after Cast. The data half is scripts/spell-print-lines-check.mjs
 * `requirements` in npm run verify, whose baseline empties once npm run data has filled the field.
 *
 * MUTATION LINES (each measured red on a scratch copy, 2026-10-18):
 *  - SpellsTab.tsx spellStatRows: drop the Requirements row → the field-lane cases go red.
 *  - spell-requirements.mjs requirementsText: drop the punctuation tidy → the clinging-shadows case goes red.
 *  - spell-requirements.mjs fillSpellRequirements: never delete → the cleared case goes red.
 *  - import-core-v2.mjs: move the fill after applyBackfill(db) → the wiring case goes red.
 */
const db = content();

/** A copy of a shipped spell under an id with no page, so the popup takes the FIELD lane. */
const synth = (extra: Partial<Spell>): Spell => ({ ...(db.spells['deitys-strike'] as Spell), id: 'synth-requirements', ...extra });

describe('a spell\'s Requirements line (package I, I6d)', () => {
  it('requirementsText tidies the page\'s line: templates and links keep their label, the space a link leaves goes', () => {
    expect(requirementsText('You are in  clinging shadows stance .')).toBe('You are in clinging shadows stance.'); // spell-2063
    expect(requirementsText('The target is taking persistent bleed damage.\r\n')).toBe('The target is taking persistent bleed damage.');
    expect(requirementsText('You must be a {{creatureFamilies 395 "dragon"}}')).toBe('You must be a dragon'); // ritual-224
    expect(requirementsText('You are in [clinging shadows stance](/Feats.aspx?ID=1) .')).toBe('You are in clinging shadows stance.');
    expect(requirementsText(['You have', 'a deity.'])).toBe('You have a deity.');
    expect(requirementsText(null)).toBe('');
    expect(requirementsText('  ')).toBe('');
  });

  it('fillSpellRequirements sets the line from each spell\'s own page and clears it where the page prints none', () => {
    const spells: Record<string, Record<string, unknown>> = {
      'thunderous-strike': { id: 'thunderous-strike' },
      'deitys-strike': { id: 'deitys-strike', requirements: 'stale text' },
      fireball: { id: 'fireball', requirements: 'a line the page no longer prints' },
      'no-page': { id: 'no-page' },
    };
    const pages: Record<string, { data: { requirement?: string } }> = {
      'thunderous-strike': { data: { requirement: 'You’re wielding a melee weapon in two hands.' } },
      'deitys-strike': { data: { requirement: 'You have a deity.' } },
      fireball: { data: {} },
    };
    const asked: string[] = [];
    const counts = fillSpellRequirements(spells, (id: string, rec: Record<string, unknown>) => {
      asked.push(`${id}=${rec.id}`);
      return pages[id] ?? null;
    });
    expect(counts).toEqual({ set: 2, cleared: 1 });
    expect(spells['thunderous-strike'].requirements).toBe('You’re wielding a melee weapon in two hands.');
    expect(spells['deitys-strike'].requirements).toBe('You have a deity.');
    expect('requirements' in spells.fireball).toBe(false);
    expect('requirements' in spells['no-page']).toBe(false);
    expect(asked).toContain('fireball=fireball');
  });

  it('spellStatRows prints Requirements right after Cast, and nothing when the spell has none', () => {
    const rows = spellStatRows(synth({ requirements: 'You have a deity.' }));
    expect(rows.slice(0, 2)).toEqual([['Cast', undefined], ['Requirements', 'You have a deity.']]);
    expect(spellStatRows(synth({ requirements: undefined })).find(([k]) => k === 'Requirements')?.[1]).toBeUndefined();
  });

  it('on the FIELD lane the card prints the row once and takes the inline **Requirements** line off the body', () => {
    const s = synth({
      requirements: 'You have a deity.',
      description: '**Requirements** You have a deity.\n\n---\n\nA manifested version of your deity\'s favored weapon appears.',
    });
    const model = spellCardModel(s, undefined, spellStatRows(s));
    expect(model.lane).toBe('field');
    expect(model.rows.filter(([k]) => k === 'Requirements')).toEqual([['Requirements', 'You have a deity.']]);
    expect(model.base).toBe('A manifested version of your deity\'s favored weapon appears.');
    // …and without the field the inline line stays: it is the only place the player can read it
    const bare = synth({ requirements: undefined, description: s.description });
    expect(spellCardModel(bare, undefined, spellStatRows(bare)).base).toBe(s.description);
  });

  it('spell-print-lines-check counts the field: a spell whose page prints Requirements is right with the field, wrong without it and without the inline line', () => {
    const docs = { 'spell-2673': { id: 'spell-2673', requirement: 'You have a deity.', actions: 'Two Actions' } };
    const rec = { name: 'Deity\'s Strike', aonId: 'spell-2673', cast: { type: 'actions', value: 2 } };
    const withField = spellPrintLineOffenders({ spells: { x: { ...rec, requirements: 'You have a deity.' } }, descriptions: { x: { d: 'A weapon appears.' } }, docs });
    const without = spellPrintLineOffenders({ spells: { x: rec }, descriptions: { x: { d: 'A weapon appears.' } }, docs });
    expect(withField.requirements).toEqual([]);
    expect(without.requirements).toEqual(['x']);
  });

  it('the importer fills the field BEFORE the overlay (a row can still override it), from the record\'s own page', () => {
    const src = readFileSync('scripts/import-core-v2.mjs', 'utf8');
    const fill = src.indexOf('fillSpellRequirements(db.spells');
    const overlay = src.indexOf('applyBackfill(db)');
    expect(fill).toBeGreaterThan(0);
    expect(overlay).toBeGreaterThan(fill);
  });
});
