// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { deitySwapDrops } from '../src/builder/shared';
import { emptyBuild, type BuildState } from '../src/rules/build';
import type { FeatCategory } from '../src/rules/types';

/**
 * CASE D in the BUILDER (docs/overrides-redesign.md spec item 2 case D, Building blocks item 9; plan
 * work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md section 2, Builder.tsx and shared.tsx): a feat given
 * through Tweaks (`overrides.addedFeats`, its answers under `override:<featId>`) gets the same Builder
 * controls as the same feat picked in a slot. test/given-feat-like-picked.test.ts holds the rules side; this
 * file holds what the player SEES — the cards a held feat opens on the Level 0 page, the archetype spells on
 * a level page, and the answers a deity change re-checks.
 *
 * Every case read `build.featPicks` alone before (2026-10-20), so the given twin drew no card at all.
 * Synthetic characters only.
 */

const db = content();
const noop = () => undefined;
let open: { stop: () => void }[] = [];
afterEach(() => {
  for (const r of open) r.stop();
  open = [];
});

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ...more,
  } as BuildState;
}

interface Take {
  featId: string;
  slot: string;
  category: FeatCategory;
  level: number;
  answer?: string;
}

/** The same character with the feats picked into slots, and given through Tweaks (answers under override:<id>). */
function pickedAndGiven(base: BuildState, takes: Take[]): { picked: BuildState; given: BuildState } {
  const picked: BuildState = {
    ...base,
    featPicks: { ...base.featPicks, ...Object.fromEntries(takes.map((t) => [t.slot, t.featId])) },
    featChoices: { ...base.featChoices, ...Object.fromEntries(takes.filter((t) => t.answer).map((t) => [t.slot, t.answer!])) },
  };
  const given: BuildState = {
    ...base,
    overrides: { addedFeats: takes.map((t) => ({ featId: t.featId, level: t.level, category: t.category })) },
    featChoices: { ...base.featChoices, ...Object.fromEntries(takes.filter((t) => t.answer).map((t) => [`override:${t.featId}`, t.answer!])) },
  };
  return { picked, given };
}

/** Open the builder on a page the way a player does — the level chip ('0' is the Level 0 page). */
function openAt(b: BuildState, page: string): HTMLElement {
  const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
  open.push(r);
  r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
  return r.host;
}
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const cardText = (host: HTMLElement, label: string) => squash(host.querySelector(`[data-setupcard="${label}"], [data-subcard="${label}"]`)?.textContent);

describe('case D in the Builder: a given feat opens the same Level 0 card as the picked one', () => {
  const cases: { name: string; card: string; base: BuildState; takes: Take[] }[] = [
    { name: 'Runesmith Dedication (the runesmith gate, in step with levelChoices)', card: 'Runic repertoire', base: hero('fighter', 4), takes: [{ featId: 'runesmith-dedication', slot: '2:class:0', category: 'archetype', level: 2 }] },
    { name: 'Commander Dedication (the tactics folio)', card: 'Tactics folio', base: hero('fighter', 4), takes: [{ featId: 'commander-dedication', slot: '2:class:0', category: 'class', level: 2 }] },
    // Summoner Dedication's "Eidolon (archetype)" card reads the summoner CLASS's options, whose book
    // (Impossible Magic) is off in a new build's sources, so not even the picked feat draws it here; its
    // gate reads heldFeatIds like the four above.
    { name: 'Living Rune (the body rune, in step with buildCharacter)', card: 'Living rune', base: hero('fighter', 6), takes: [{ featId: 'living-rune', slot: '6:class:0', category: 'class', level: 6 }] },
    {
      name: 'Inventor Dedication + Basic Modification (the initial modification)',
      card: 'Initial modification',
      base: hero('fighter', 8),
      takes: [
        { featId: 'inventor-dedication', slot: '2:class:0', category: 'class', level: 2, answer: 'weapon-innovation' },
        { featId: 'basic-modification', slot: '8:class:0', category: 'class', level: 8 },
      ],
    },
    { name: 'Wizard Dedication on a caster class (the archetype spellcasting card)', card: 'Archetype spellcasting', base: hero('cleric', 4), takes: [{ featId: 'wizard-dedication', slot: '2:class:0', category: 'class', level: 2 }] },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const { picked, given } = pickedAndGiven(c.base, c.takes);
      const want = cardText(openAt(picked, '0'), c.card);
      expect(want, `the picked feat draws "${c.card}"`).not.toBe('');
      expect(cardText(openAt(given, '0'), c.card)).toBe(want);
    });
  }

  it('a given feat paused, or past the character level, opens nothing (only ACTIVE given feats are held)', () => {
    const { given } = pickedAndGiven(hero('fighter', 4), [{ featId: 'runesmith-dedication', slot: '2:class:0', category: 'archetype', level: 2 }]);
    const paused: BuildState = { ...given, overrides: { ...given.overrides, meta: { 'addedFeats:runesmith-dedication@2': { on: false } } } };
    expect(cardText(openAt(paused, '0'), 'Runic repertoire')).toBe('');
    const later: BuildState = { ...given, overrides: { addedFeats: [{ featId: 'runesmith-dedication', level: 6, category: 'archetype' }] } };
    expect(cardText(openAt(later, '0'), 'Runic repertoire')).toBe('');
  });
});

describe('case D in the Builder: a given caster dedication draws its archetype spells on its level page', () => {
  it('Wizard Dedication given to a fighter L4: the level 2 page draws the same spells section as picked', () => {
    const { picked, given } = pickedAndGiven(hero('fighter', 4), [{ featId: 'wizard-dedication', slot: '2:class:0', category: 'class', level: 2 }]);
    const spells = (host: HTMLElement) =>
      squash([...host.querySelectorAll('.card-sec')].find((s) => squash(s.querySelector('.bsec-title')?.textContent).startsWith('Spells'))?.textContent);
    const want = spells(openAt(picked, '2'));
    expect(want, 'the picked dedication draws an archetype spells section').toMatch(/^Spells — Arcane prepared \(archetype\)/);
    expect(spells(openAt(given, '2'))).toBe(want);
    // …and not a level early (archStartLevel reads the given feat's start level).
    expect(spells(openAt(given, '1'))).toBe('');
  });
});

describe('case D in the Builder: a deity change re-checks a given feat’s domain answers (deitySwapDrops)', () => {
  // kostchtchie: cold, destruction, might, zeal — otolmens: creation, fate, knowledge, perfection (no overlap).
  const base = hero('cleric', 4, { deityId: 'kostchtchie' });
  it('Domain Initiate: an answer off the new deity is cleared, given or picked', () => {
    const { picked, given } = pickedAndGiven(base, [{ featId: 'domain-initiate', slot: '1:class:0', category: 'class', level: 1, answer: 'cold' }]);
    const p = deitySwapDrops(picked, db, 'otolmens');
    expect(p.lostDomains).toEqual(['cold']);
    const g = deitySwapDrops(given, db, 'otolmens');
    expect(g.lostDomains).toEqual(p.lostDomains);
    expect(g.featChoices['override:domain-initiate']).toBeUndefined();
  });
  it('Splinter Faith: its four answers (override:splinter-faith#n) are validated like the slot’s', () => {
    const answers = ['cold', 'destruction', 'might', 'zeal'];
    const { picked, given } = pickedAndGiven(base, [{ featId: 'splinter-faith', slot: '1:class:0', category: 'class', level: 1 }]);
    picked.featChoices = { ...picked.featChoices, ...Object.fromEntries(answers.map((a, i) => [`1:class:0#${i}`, a])) };
    given.featChoices = { ...given.featChoices, ...Object.fromEntries(answers.map((a, i) => [`override:splinter-faith#${i}`, a])) };
    const p = deitySwapDrops(picked, db, 'otolmens');
    expect(p.lostDomains.length, 'the picked feat loses the answers the new deity cannot keep').toBeGreaterThan(0);
    const g = deitySwapDrops(given, db, 'otolmens');
    expect(g.lostDomains).toEqual(p.lostDomains);
    const kept = (fc: Record<string, string>, prefix: string) => Object.entries(fc).filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
    expect(kept(g.featChoices, 'override:splinter-faith#')).toEqual(kept(p.featChoices, '1:class:0#'));
  });
});
