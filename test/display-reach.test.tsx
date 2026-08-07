// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { renderText } from './_render';
import { DetailsTab } from '../src/sheet/DetailsTab';
import { MainTab } from '../src/sheet/MainTab';
import { FeatsTab } from '../src/sheet/FeatsTab';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { applyPlayState, initialPlay } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * DISPLAY — does the number reach a pixel?
 *
 * The whole suite ran in node against pure rule functions, so every defect of the form "the value is
 * computed correctly and no surface shows it" was invisible to it — and by this app's own audit
 * history that is its dominant defect class. Every case below was a value the engine had right and
 * the screen did not print.
 */
const c = () => content();
const live = (ch: Character) => applyPlayState(ch, initialPlay(ch, c()), c());
const noop = () => undefined;

describe('the Details tab prints the proficiencies the engine computed', () => {
  it("shows a gunslinger's firearm ranks, not just the bare weapon categories", () => {
    const ch = build('gunslinger', 13, { subclassId: c().classes.gunslinger?.subclass?.options[0]?.id ?? null });
    // The engine knows this…
    expect(ch.proficiencies.firearmProf?.simple).toBe('legendary');
    // …and for every level from 1 to 20 the page read "Simple Trained / Martial Trained".
    const text = renderText(<DetailsTab character={ch} content={c()} onPlay={noop} />);
    expect(text).toContain('firearms & crossbows');
  });

  it("shows the deity's cleric spells, which the import never carried at all", () => {
    const ch = build('cleric', 3, { deityId: 'ragathiel' });
    const text = renderText(<DetailsTab character={ch} content={c()} onPlay={noop} />);
    expect(text).toContain('Cleric spells');
    expect(text).toContain(c().spells['sure-strike'].name);
  });
});

describe('the encounter action list includes actions a record GRANTS', () => {
  it("lists a barbarian's Rage, which is a passive class FEATURE and a 1-action record", () => {
    const ch = live(build('barbarian', 5, { subclassId: 'fury-instinct', keyAbility: 'str' }));
    expect(c().classFeatures.rage?.actionCost?.type).toBe('passive');
    // The Main tab opens on Strikes; the action list is one click away, as it is for a player.
    const text = renderText(<MainTab character={ch} content={c()} onPlay={noop} />, ['Actions']);
    expect(text).toContain('Rage');
  });

  it("lists a background's granted action with its once-per-day pips", () => {
    const ch = live(build('fighter', 3, { backgroundId: 'genie-blessed' }));
    const text = renderText(<MainTab character={ch} content={c()} onPlay={noop} />, ['Actions']);
    expect(text).toContain(c().actions['wish-for-luck'].name);
  });
});

describe('a feat sub-choice reads as a name, not a slug', () => {
  it('renders the chosen option, not its id', () => {
    const ch = build('fighter', 3, {
      featPicks: { '1:general:0': 'unconventional-weaponry' },
      featChoices: { '1:general:0': 'katana' },
    });
    const picked = ch.feats.find((f) => f.featId === 'unconventional-weaponry');
    if (picked?.choice) {
      // The label is what the sheet prints; a raw id here is the bug this guards.
      expect(picked.choice.label).not.toBe(picked.choice.value);
      const text = renderText(<FeatsTab character={ch} content={c()} onPlay={noop} />);
      expect(text).toContain(picked.choice.label);
    }
  });
});

describe('a companion shows what it actually is', () => {
  it('names the species even after the player renames the companion', () => {
    const typeId = Object.keys(c().animalCompanions)[0];
    const ch = live(
      build('ranger', 4, {
        featPicks: { '1:class:0': 'animal-companion' },
        companions: [{ id: 'c1', kind: 'animal', name: 'Fang', typeId }],
      }),
    );
    const text = renderText(<CompanionsTab character={ch} content={c()} onPlay={noop} charKey="t" />);
    expect(text).toContain('Fang');
    // …and the type it derives every one of its numbers from.
    expect(text).toContain(c().animalCompanions[typeId].name);
  });
});
