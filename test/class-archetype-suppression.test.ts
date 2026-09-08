// @vitest-environment jsdom
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom, renderText } from './_render';
import { FeatsTab } from '../src/sheet/FeatsTab';
import { MainTab } from '../src/sheet/MainTab';
import { ownedFeatureIds } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/**
 * A CLASS ARCHETYPE takes class features away, and `ownedFeatureIds` — the choke point every sheet
 * reader asks "does this character have that feature" through — did not know it.
 *
 * War Mage (AoN archetype-331): *"You do not gain the arcane bond or arcane thesis class features.
 * You do not gain the defensive robes feature at 13th level."* buildCharacter honours that list
 * (build.ts, `for (const id of archSuppressed) ownedFeatureIds.delete(id)`) and writes it onto the
 * character as `classArchetype.suppressedFeatures`; derive.ts rebuilt ownership from `cls.features`
 * and never subtracted it. So a War Mage wizard owned `arcane-bond`, whose `grantsActions` put Drain
 * Bonded Item in the Main tab's action list and whose `limitedUses` drew a once-per-day pip — for a
 * feature the printed archetype says the character does not have.
 *
 * Every assertion here runs on a BUILT character, because the defect only exists once
 * `classArchetype` has been resolved onto one.
 */
const c = () => content();
const noop = () => undefined;

/** A War Mage wizard at 13 — the level at which all three suppressed features are on the table. */
const warMage = () => build('wizard', 13, { featPicks: { '2:class:0': 'war-mage-dedication' } }) as Character;
/** The same wizard who then took Spellshield, which hands `arcane-bond` back. */
const warMageSpellshield = () =>
  build('wizard', 13, { featPicks: { '2:class:0': 'war-mage-dedication', '8:class:0': 'spellshield' } }) as Character;

describe('class archetype suppression reaches ownedFeatureIds', () => {
  it('a plain wizard owns arcane-bond and its granted action reaches the sheet', () => {
    const plain = build('wizard', 13);
    expect(plain.classArchetype).toBeUndefined();
    expect([...ownedFeatureIds(plain, c())]).toContain('arcane-bond');
    const text = renderText(createElement(MainTab, { character: plain, content: c(), onPlay: noop }), ['Actions']);
    expect(text).toContain('Drain Bonded Item');
  });

  it('a War Mage wizard does not own arcane-bond, arcane-thesis or defensive-robes', () => {
    const ch = warMage();
    // The archetype resolved onto the character at all — otherwise the test below proves nothing.
    expect(ch.classArchetype?.suppressedFeatures).toEqual(
      expect.arrayContaining(['arcane-bond', 'arcane-thesis', 'defensive-robes']),
    );
    const owned = ownedFeatureIds(ch, c());
    for (const id of ['arcane-bond', 'arcane-thesis', 'defensive-robes']) expect([...owned]).not.toContain(id);
    // …and a feature the archetype does NOT touch is still owned, so this is a subtraction and not a
    // collapse of the whole set.
    expect([...owned]).toContain('wizard-spellcasting');
  });

  it("the suppressed feature's grants stop applying: no Drain Bonded Item in the action list", () => {
    // arcane-bond carries `grantsActions: ['drain-bonded-item']`, and MainTab's granted-action walk
    // reads it through ownedFeatureIds — the display half of "its grants do not apply".
    const text = renderText(createElement(MainTab, { character: warMage(), content: c(), onPlay: noop }), ['Actions']);
    expect(text).not.toContain('Drain Bonded Item');
  });

  it('Spellshield gives arcane-bond back, so the War Mage owns it again', () => {
    // "You gain the arcane bond class feature and the Drain Bonded Item action" (AoN feat-7983).
    // The re-add happens in the grantsClassFeatures pass, which is why the suppression is subtracted
    // immediately BEFORE that pass rather than at the end of the function.
    const ch = warMageSpellshield();
    expect([...ownedFeatureIds(ch, c())]).toContain('arcane-bond');
    const text = renderText(createElement(MainTab, { character: ch, content: c(), onPlay: noop }), ['Actions']);
    expect(text).toContain('Drain Bonded Item');
  });
});

describe('the FeatsTab "Replaced" note still says what the player LOST', () => {
  /** The "Replaced: …" line of the class-archetype note, or undefined when it is not rendered. */
  const replacedLine = (ch: Character) => {
    const { host, stop } = renderDom(createElement(FeatsTab, { character: ch, content: c(), onPlay: noop }));
    const line = [...host.querySelectorAll('.ff-arch li')]
      .map((li) => li.textContent ?? '')
      .find((t) => t.startsWith('Replaced'));
    stop();
    return line;
  };

  it('names Arcane Bond for a War Mage who never got it back', () => {
    // The note is the ONLY place a lost feature is now visible: it is no longer an owned feature and
    // no longer a row, so dropping it from here would delete the information entirely.
    expect(replacedLine(warMage())).toContain('Arcane Bond');
  });

  it('does not name it once Spellshield hands it back', () => {
    const line = replacedLine(warMageSpellshield());
    expect(line).not.toContain('Arcane Bond');
    expect(line).toContain('Arcane Thesis');
  });
});

/**
 * The blast radius, pinned: these are the class archetypes that suppress anything at all, so a
 * seventh arriving in a data update cannot change what this fix covers without a test noticing.
 */
describe('every class archetype that suppresses a class feature', () => {
  it('is one of the six shipped, on the class it restructures', () => {
    const db = c();
    const rows: string[] = [];
    for (const bucket of [db.feats, db.classFeatures] as Record<string, { classArchetype?: { classId: string | string[]; suppressFeatures?: string[] } }>[]) {
      for (const [id, rec] of Object.entries(bucket)) {
        const ca = rec.classArchetype;
        if (!ca?.suppressFeatures?.length) continue;
        rows.push(`${id} (${[ca.classId].flat().join('/')}): ${[...ca.suppressFeatures].sort().join(', ')}`);
      }
    }
    expect(rows.sort()).toEqual([
      'avenger-dedication (rogue): surprise-attack',
      'battle-harbinger-dedication (cleric): miraculous-spell, resolute-faith',
      'palatine-detective-dedication (investigator): methodology',
      'runelord-dedication (wizard): arcane-thesis',
      'war-mage-dedication (wizard): arcane-bond, arcane-thesis, defensive-robes',
      'warrior-of-legend-dedication (fighter): shield-block',
    ]);
  });
});
