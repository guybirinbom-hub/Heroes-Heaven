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
 *  • The Reactions row wrapped a whole sentence into a right-aligned value box, which reads as
 *    right-to-left. The number is the value; the explanation is its own left-aligned line.
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
  // bug 2026-09-15: rail initiative
  it('a guardian with Reaction Time reads "2 per round", with the reason on its own line', () => {
    const guardian = build('guardian', 7);
    expect(guardian.extraReactions?.length, 'fixture: level 7 is where Reaction Time lands').toBeTruthy();
    const r = rail(guardian);
    const row = [...card(r.host, 'Essentials')!.querySelectorAll<HTMLElement>('.rail-kv')].find(
      (e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === 'Reactions',
    )!;
    // The VALUE is the number and nothing else — the sentence used to live inside it, right-aligned,
    // which is what the owner read as right-to-left.
    expect(row.querySelector('.iwr-val')?.textContent?.trim()).toBe('2 per round');
    const note = row.querySelector<HTMLElement>('.kv-note');
    expect(note, 'the explanation is its own line').toBeTruthy();
    expect(note!.closest('.iwr-val'), 'and it is NOT inside the right-aligned value').toBeNull();
    // Trimmed of the "a reaction from …" boilerplate the row's own label already says.
    expect(note!.textContent).toBe('+1 · guardian feat or class feature incl. Shield Block — Reaction Time');
    // Trimmed for the row; the untouched printed wording stays reachable on the hover.
    expect(note!.getAttribute('title')).toContain('a reaction from a guardian feat or class feature');
    r.stop();
  });
});
