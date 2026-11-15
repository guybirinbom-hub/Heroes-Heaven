// @vitest-environment jsdom
/*
 * A cleric made SPONTANEOUS by Flexible Spellcaster is named and hinted right.
 *
 * bug 2026-10-23 (sheet fixes): `fillSpellCollection` flips the entry's type to spontaneous but kept the
 * name it was built with, "Divine prepared spellcasting". And on the Spells tab the empty cantrip places
 * said "tap Prepare to choose" beside a manage button reading "Repertoire". The cantrips stay PREPARED
 * (`cantripsPrepared` — print leaves cantrip preparation unchanged); only the words change.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { build, content, mainCasting } from './_content';
import { renderDom } from './_render';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { SpellsTab, manageButtonLabel } from '../src/sheet/SpellsTab';
import { overCantripCapNote } from '../src/rules/spellcasting';
import type { Character } from '../src/rules/types';

const db = content();
const flexCleric = (level: number): Character =>
  buildCharacter(
    {
      ...emptyBuild(),
      name: 'flex',
      level,
      classId: 'cleric',
      subclassId: 'cloistered-cleric',
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: 'wis',
      featPicks: { '2:class:0': 'flexible-spellcaster-dedication' },
    } as unknown as BuildState,
    db,
  );

describe('Flexible Spellcaster cleric — the entry name says the type', () => {
  it('is "Divine spontaneous spellcasting", and still prepares its cantrips', () => {
    const e = mainCasting(flexCleric(4))!;
    expect(e.type).toBe('spontaneous');
    expect(e.name).toBe('Divine spontaneous spellcasting');
    expect(e.cantripsPrepared).toBe(true);
  });

  it('a flexible wizard (the spellbook branch) is renamed the same way', () => {
    const e = mainCasting(build('wizard', 4, { featPicks: { '2:class:0': 'flexible-spellcaster-dedication' } }))!;
    expect(e.type).toBe('spontaneous');
    expect(e.name).toBe('Arcane spontaneous spellcasting');
  });

  it('control: a plain cleric keeps "Divine prepared spellcasting"', () => {
    const e = mainCasting(build('cleric', 4, { subclassId: 'cloistered-cleric', keyAbility: 'wis' }))!;
    expect(e.type).toBe('prepared');
    expect(e.name).toBe('Divine prepared spellcasting');
  });
});

describe('Flexible Spellcaster cleric — the Spells tab names the button it shows', () => {
  it('empty cantrip places say "tap Repertoire to choose", beside a "Repertoire" button', () => {
    const r = renderDom(createElement(SpellsTab, { character: flexCleric(4), content: db, onPlay: () => undefined }));
    const text = r.host.textContent ?? '';
    const buttons = [...r.host.querySelectorAll('button.ms-btn')].map((b) => b.textContent?.trim());
    r.stop();
    expect(buttons).toContain('Repertoire');
    expect(text).toContain('tap Repertoire to choose');
    expect(text).not.toContain('tap Prepare to choose');
  });

  it('control: a plain cleric still says "tap Prepare to choose" beside "Prepare"', () => {
    const r = renderDom(createElement(SpellsTab, { character: build('cleric', 4, { subclassId: 'cloistered-cleric', keyAbility: 'wis' }), content: db, onPlay: () => undefined }));
    const text = r.host.textContent ?? '';
    r.stop();
    expect(text).toContain('tap Prepare to choose');
  });

  it('the over-cap cantrip note names the same button', () => {
    expect(manageButtonLabel({ type: 'spontaneous' })).toBe('Repertoire');
    expect(manageButtonLabel({ type: 'prepared' })).toBe('Prepare');
    expect(overCantripCapNote(5, true, 1, 'Repertoire')).toContain('with the Repertoire button');
    expect(overCantripCapNote(5, true)).toContain('with the Prepare button');
  });
});
