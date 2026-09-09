// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { LANGUAGE_UNCHOSEN } from '../src/rules/companions';
import type { Character, CompanionConfig } from '../src/rules/types';

/**
 * What the PLAYER sees, not what the deriver returns. Both records below were carried by
 * COMPANION_MODS rows keyed to a summoner subclass option, and the eidolon pass over that table
 * matched only the owner's FEAT ids — so neither reached the sheet at all.
 */
const db = content();
const noop = () => undefined;

const eidolon = (typeId: string, languages?: (string | null)[]): CompanionConfig => ({
  id: 'c1',
  kind: 'eidolon',
  name: 'Test Eidolon',
  typeId,
  eidolon: languages ? { languages } : {},
});

const summoner = (typeId: string, languages?: (string | null)[]): Character => {
  const ch = build('summoner', 5, { subclassId: typeId, companions: [eidolon(typeId, languages)] });
  return applyPlayState(ch, initialPlay(ch, db), db);
};

const sheet = (ch: Character) => renderText(<CompanionsTab character={ch} content={db} onPlay={noop} charKey="t" />);

describe('batch 033 closer — the sheet shows devotion-phantom-eidolon its language', () => {
  // batch 033: devotion-phantom-eidolon#language
  // AoN eidolon-20: "Language one common mortal language the eidolon spoke in life" — the printed
  // line reached the player only as description prose, with nothing asking and nothing recording it.
  it('devotion-phantom-eidolon prompts for its language on the companion card', () => {
    expect(sheet(summoner('devotion-phantom-eidolon'))).toContain(LANGUAGE_UNCHOSEN);
  });

  // batch 033: devotion-phantom-eidolon#language
  it('devotion-phantom-eidolon shows the language once the player has chosen one', () => {
    const text = sheet(summoner('devotion-phantom-eidolon', ['dwarven']));
    expect(text).toContain(db.languages.dwarven.name);
    expect(text).not.toContain(LANGUAGE_UNCHOSEN);
  });
});

describe('batch 033 closer — the sheet shows elemental-eidolon its own core', () => {
  // batch 033: elemental-eidolon#core-note-generalises-fire
  // Print (AoN eidolon-12) gives the fire resistance/weakness/+1 damage to the FIRE core alone; the
  // note handed it to all six, so a Water- or Wood-core eidolon read a benefit it does not have.
  it('elemental-eidolon shows all six printed cores, not the fire one generalised', () => {
    const text = sheet(summoner('elemental-eidolon'));
    expect(text).toContain('Elemental Core');
    for (const core of ['AIR', 'EARTH', 'FIRE', 'METAL', 'WATER', 'WOOD']) expect(text).toContain(core);
    expect(text).not.toContain("your core's damage type");
  });
});
