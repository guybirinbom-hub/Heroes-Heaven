// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { normalizeCharacter } from '../src/rules/normalize';
import { initiativeInfluences } from '../src/rules/initiative';
import { VitalsRail } from '../src/sheet/VitalsRail';
import type { Character } from '../src/rules/types';

/**
 * The right rail's saves box, its Perception row and its Initiative row — owner, 2026-09-15.
 *
 * Three complaints, one card each:
 *  • *"perception out of the saves box"* — it belongs with the senses, so it moved to the card below,
 *    which stopped being "Hero points & movement" and became "Essentials".
 *  • *"in pf2e initiative isn't always perception"* — the Initiative row used to print the Perception
 *    number unconditionally, which told the player nothing. It now appears ONLY when something
 *    actually changes initiative, and its dotted value opens the list of those things and nothing
 *    else (`initiativeInfluences`).
 *  • *"i don't want the whole text block there because it's too big, but if a character does have
 *    something that affects the amount of reactions, add a Reactions row with a dotted line
 *    underneath so that the player will know it's pressable, and that popup will show the full
 *    explanation."* — so the row is the number on a pressable term and nothing else, and the
 *    untrimmed wording lives in the popup.
 *
 * MUTATION PROOF (each applied once, then restored):
 *  • Relaxing the row's gate to `initInfluences.length >= 0` fails "a plain fighter has nothing that
 *    affects initiative, so there is no row" AND "Perception sits directly above Senses in
 *    Essentials" — `AssertionError: expected [ 'Hero points', 'Speed', …(3) ] to deeply equal
 *    [ 'Hero points', 'Speed', …(2) ]` on both.
 *  • Putting a Perception row back in the saves card fails "the saves card is saves only" —
 *    `AssertionError: expected [ 'Fortitude', 'Reflex', 'Will', …(1) ] to deeply equal
 *    [ 'Fortitude', 'Reflex', 'Will' ]`.
 *  • Taking Perception back OUT of Essentials fails four legs, "Perception sits directly above
 *    Senses" among them — `AssertionError: expected [ 'Hero points', 'Speed', 'Senses' ] to deeply
 *    equal [ 'Hero points', 'Speed', …(2) ]`.
 *  • Reverting the Reactions value from `IwrTerm` to a plain span that still opens the popup fails
 *    the Reactions leg — `AssertionError: the value has to carry the dotted affordance: expected null
 *    to be truthy`. The popup half of the leg keeps passing, which is the point: pressability is
 *    asserted on its own, not smuggled in through the click.
 */
const db = content();
const noop = (() => undefined) as never;

/** A character with no ancestry, heritage, background or feat — so anything the rail shows below
 *  came from the one thing the leg puts on it. */
const fighter = (over: Record<string, unknown> = {}): Character =>
  normalizeCharacter({
    id: 'r',
    name: 'R',
    level: 1,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    feats: [],
    currency: {},
    inventory: [],
    ...over,
  } as unknown as Character);

const rail = (character: Character) =>
  renderDom(createElement(VitalsRail, { character, content: db, onOpenStat: noop }));

/** A rail card by the title printed in its header. */
const card = (host: HTMLElement, title: string): HTMLElement | undefined =>
  [...host.querySelectorAll<HTMLElement>('.card')].find((e) => (e.querySelector('.ct')?.textContent ?? '').trim() === title);

/** The labels of a card's rows, in the order they are rendered. The `*` a situational star appends
 *  is dropped — these legs are about which rows exist and in what order. */
const rowLabels = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('.stat-row, .rail-kv')].map((r) =>
    (r.querySelector('.stat-name, .kv-label')?.textContent ?? '').replace(/\*/g, '').trim(),
  );

describe('the saves card is saves, and Perception moved in with the senses', () => {
  // bug 2026-09-15: rail initiative
  it('the saves card is saves only — no Perception row, no Initiative row', () => {
    const r = rail(fighter());
    const saves = card(r.host, 'Saves');
    expect(saves, 'the card is titled "Saves" now, not "Saves & perception"').toBeTruthy();
    expect(rowLabels(saves!)).toEqual(['Fortitude', 'Reflex', 'Will']);
    r.stop();
  });

  // bug 2026-09-15: rail initiative
  it('Perception sits directly above Senses in Essentials', () => {
    const r = rail(fighter());
    const essentials = card(r.host, 'Essentials');
    expect(essentials, 'the card is titled "Essentials" now').toBeTruthy();
    const labels = rowLabels(essentials!);
    expect(labels).toEqual(['Hero points', 'Speed', 'Perception', 'Senses']);
    expect(labels.indexOf('Perception'), 'Perception has to be ON the card at all').toBeGreaterThanOrEqual(0);
    expect(labels.indexOf('Perception')).toBe(labels.indexOf('Senses') - 1);
    r.stop();
  });

  // bug 2026-09-15: rail initiative
  it('the Perception row keeps everything it had — rank pill, modifier, rollable', () => {
    const r = rail(fighter());
    const row = [...card(r.host, 'Essentials')!.querySelectorAll<HTMLElement>('.stat-row')].find((e) =>
      (e.querySelector('.stat-name')?.textContent ?? '').startsWith('Perception'),
    );
    expect(row!.querySelector('.rank-pill'), 'the rank pill came with it').toBeTruthy();
    expect(row!.querySelector('.stat-mod')?.textContent).toMatch(/^[+-]\d+$/);
    expect(row!.className, 'still opens its breakdown').toContain('rollable');
    r.stop();
  });
});

describe('an Initiative row only when something affects initiative', () => {
  // bug 2026-09-15: rail initiative
  it('a plain fighter has nothing that affects initiative, so there is no row', () => {
    const c = fighter();
    expect(initiativeInfluences(c, db), 'nothing on a level-1 fighter touches initiative').toEqual([]);
    const r = rail(c);
    expect(rowLabels(card(r.host, 'Essentials')!)).toEqual(['Hero points', 'Speed', 'Perception', 'Senses']);
    r.stop();
  });

  // bug 2026-09-15: rail initiative
  it('Incredible Initiative earns the row, and it says what it is rolled with', () => {
    const c = fighter({ feats: [{ featId: 'incredible-initiative', level: 1 }] });
    expect(initiativeInfluences(c, db).map((i) => i.text).join('\n')).toMatch(/Incredible Initiative/);
    const r = rail(c);
    const essentials = card(r.host, 'Essentials')!;
    expect(rowLabels(essentials)).toEqual(['Hero points', 'Speed', 'Perception', 'Initiative', 'Senses']);
    const row = [...essentials.querySelectorAll<HTMLElement>('.rail-kv')].find(
      (e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === 'Initiative',
    )!;
    // The same dotted-underline affordance the Senses value carries (.info-term), so the value looks
    // openable rather than being a number the player has to guess is clickable.
    const term = row.querySelector<HTMLElement>('.iwr-val .info-term');
    expect(term, 'the value has to carry the dotted affordance').toBeTruthy();
    expect(term!.textContent).toMatch(/^[+-]\d+ \(Perception\)$/);
    r.stop();
  });

  // bug 2026-09-15: rail initiative
  it('the popup lists the influences and NOT the Perception breakdown', () => {
    const r = rail(fighter({ feats: [{ featId: 'incredible-initiative', level: 1 }] }));
    r.click(r.host.querySelector('.rail-kv .iwr-val .info-term'));
    const modal = r.host.querySelector<HTMLElement>('.stat-detail');
    expect(modal, 'clicking the value opens the breakdown popup').toBeTruthy();
    const text = modal!.textContent ?? '';
    expect(text).toContain('Initiative');
    expect(text, 'the thing the row exists for').toContain('Incredible Initiative');
    // The Perception breakdown is one click away on its own row; repeating it here is exactly what
    // the owner said the Initiative row must stop doing.
    expect(text).not.toContain("How it's calculated");
    expect(text).not.toContain('How you got here');
    expect(text).not.toContain('Actions you can take');
    r.stop();
  });

  // bug 2026-09-15: rail initiative
  it('rolling initiative with Stealth is itself the reason for the row', () => {
    const c = fighter({ initiativeSkill: 'stealth' });
    expect(initiativeInfluences(c, db).map((i) => i.text).join('\n')).toMatch(/Stealth/);
    const r = rail(c);
    const term = [...card(r.host, 'Essentials')!.querySelectorAll<HTMLElement>('.rail-kv')]
      .find((e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === 'Initiative')!
      .querySelector<HTMLElement>('.iwr-val .info-term');
    expect(term!.textContent).toMatch(/^[+-]\d+ \(Stealth\)$/);
    r.stop();
  });
});

describe('the Reactions row', () => {
  // bug 2026-09-15: rail reactions
  it('a guardian with Reaction Time reads "2 per round" on a pressable term, the wording in its popup', () => {
    const guardian = build('guardian', 7);
    expect(guardian.extraReactions?.length, 'fixture: level 7 is where Reaction Time lands').toBeTruthy();
    const r = rail(guardian);
    const row = [...card(r.host, 'Essentials')!.querySelectorAll<HTMLElement>('.rail-kv')].find(
      (e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === 'Reactions',
    )!;
    // *"i don't want the whole text block there because it's too big"* — the row is the label and the
    // number, with no explanation line left on it at all.
    expect(row.querySelector('.iwr-val')?.textContent?.trim()).toBe('2 per round');
    expect(row.querySelector('.kv-note'), 'the trimmed explanation line is gone from the row').toBeNull();
    expect(row.textContent?.trim(), 'the whole row is the label and the number').toBe('Reactions2 per round');
    // *"a dotted line underneath so that the player will know it's pressable"* — the SAME affordance
    // the Initiative term carries (.info-term, role=button), not a lookalike of it.
    const term = row.querySelector<HTMLElement>('.iwr-val .info-term');
    expect(term, 'the value has to carry the dotted affordance').toBeTruthy();
    expect(term!.getAttribute('role'), 'and say it is pressable').toBe('button');
    const initTerm = [...card(r.host, 'Essentials')!.querySelectorAll<HTMLElement>('.rail-kv')]
      .find((e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === 'Initiative')
      ?.querySelector<HTMLElement>('.iwr-val .info-term');
    if (initTerm) expect(term!.className, 'the same class the Initiative term uses').toBe(initTerm.className);
    expect(term!.textContent).toBe('2 per round');
    // *"that popup will show the full explanation"* — untrimmed, parenthetical and all, plus the record
    // it came from and the click that opens that record's own text.
    r.click(term);
    const modal = r.host.querySelector<HTMLElement>('.stat-detail');
    expect(modal, 'pressing the term opens the breakdown popup').toBeTruthy();
    const text = modal!.textContent ?? '';
    expect(text, 'the parenthetical the row used to abbreviate to "incl."').toContain('(including Shield Block)');
    expect(text).toContain('a reaction from a guardian feat or class feature');
    expect(text, 'and what grants it').toContain('Reaction Time');
    // `extraReactions[].from` is a NAME; the note is only clickable if it was mapped back to the id.
    expect(modal!.querySelector('.sd-situational .sd-sit-more'), 'the note opens its record like the others').toBeTruthy();
    r.stop();
  });
});
