// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { normalizeCharacter } from '../src/rules/normalize';
import { initiativeInfluenceDetail } from '../src/rules/initiative';
import { VitalsRail } from '../src/sheet/VitalsRail';
import type { Character } from '../src/rules/types';

/**
 * The right rail's saves box, its Perception row and its Initiative row — owner, 2026-09-15.
 *
 * ⚠ 2026-09-16 REVERSED the first of the three: Perception went back to the saves card, and the
 * Reactions row lost its number entirely (first to "1 per round", then to nothing at all). The three
 * legs that pinned Perception to Essentials could not survive that and were deleted (marked
 * SUPERSEDED where they stood); the same three assertions, turned round, are the first describe of
 * test/bug-owner-2026-09-16-sheet.test.tsx — "the saves card is Fortitude, Reflex, Will and
 * Perception", "Perception keeps the shape it had" and "Essentials keeps hero points, Speed and
 * Senses". Nothing else here was relaxed: the Reactions row's exact-string pin below still pins the
 * whole row, at the value the reversal gives it.
 *
 * Three complaints, one card each:
 *  • *"perception out of the saves box"* — it belonged with the senses, so it moved to the card below,
 *    which stopped being "Hero points & movement" and became "Essentials". REVERSED 2026-09-16.
 *  • *"in pf2e initiative isn't always perception"* — the Initiative row used to print the Perception
 *    number unconditionally, which told the player nothing. It now appears ONLY when something
 *    actually changes initiative, and its dotted value opens the list of those things and nothing
 *    else (`initiativeInfluenceDetail`).
 *  • *"i don't want the whole text block there because it's too big, but if a character does have
 *    something that affects the amount of reactions, add a Reactions row with a dotted line
 *    underneath so that the player will know it's pressable, and that popup will show the full
 *    explanation."* — so the row is the number on a pressable term and nothing else, and the
 *    untrimmed wording lives in the popup.
 *
 * MUTATION PROOF (each applied once, then restored):
 *  • Relaxing the row's gate to `initInfluences.length >= 0` fails "a plain fighter has nothing that
 *    affects initiative, so there is no row" — `AssertionError: expected [ 'Hero points', 'Speed',
 *    …(2) ] to deeply equal [ 'Hero points', 'Speed', 'Senses' ]`.
 *  • Reverting the Reactions star from a `<button>` to a bare `<SituationalStar>` fails the Reactions
 *    leg — `AssertionError: and it is pressable: expected null to be truthy`. The popup half of the
 *    leg then cannot run at all, which is the point: pressability is asserted on its own, not
 *    smuggled in through the click.
 *  • Dropping `rail-star-btn` from that button's className fails the same leg — `AssertionError: a
 *    target a finger can hit, sized in the stylesheet: expected 'cond-mark' to contain
 *    'rail-star-btn'`. Live, the bare class is the 7.4 × 0 px box the refutation measured: a
 *    dispatched click lands on a control no finger can, so the size is pinned rather than the click.
 *  • Putting that size back as an inline `style` fails the next leg — `AssertionError: and not
 *    inline, where no stylesheet could reach it: expected 'min-width: 24px;…' to be null`.
 *  • Putting anything else on the Reactions row (a `.kv-note`, a count, a second span) fails the
 *    exact-string pin — `AssertionError: the whole row is the label and its star: expected
 *    'Reactions1 per round*' to be 'Reactions*'`.
 */
const db = content();
const noop = (() => undefined) as never;

/** The influence lines behind the row, asked the way VitalsRail asks. `initiativeInfluences` (this
 *  same `.map`) was deleted from src/ on 2026-09-16: these legs were its only callers, so it was a
 *  second spelling of a rule with one reader. */
const influences = (c: Character): string[] => initiativeInfluenceDetail(c, db).map((i) => i.note.text);

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

/*
 * SUPERSEDED, 2026-09-16: the three legs that lived here pinned Perception to the Essentials card.
 * The owner reversed that the next day — *"perception back with the saves"* — so its position is
 * asserted in test/bug-owner-2026-09-16-sheet.test.tsx instead. The Initiative half of the same
 * ruling stands and is asserted below: Perception moving back did NOT bring Initiative with it.
 */

describe('an Initiative row only when something affects initiative', () => {
  // bug 2026-09-15: rail initiative
  it('a plain fighter has nothing that affects initiative, so there is no row', () => {
    const c = fighter();
    expect(influences(c), 'nothing on a level-1 fighter touches initiative').toEqual([]);
    const r = rail(c);
    expect(rowLabels(card(r.host, 'Essentials')!)).toEqual(['Hero points', 'Speed', 'Senses']);
    r.stop();
  });

  // bug 2026-09-15: rail initiative
  it('Incredible Initiative earns the row, and it says what it is rolled with', () => {
    const c = fighter({ feats: [{ featId: 'incredible-initiative', level: 1 }] });
    expect(influences(c).join('\n')).toMatch(/Incredible Initiative/);
    const r = rail(c);
    const essentials = card(r.host, 'Essentials')!;
    expect(rowLabels(essentials)).toEqual(['Hero points', 'Speed', 'Initiative', 'Senses']);
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
    expect(influences(c).join('\n')).toMatch(/Stealth/);
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
  it('the row is the label and a pressable star, and the popup carries the untrimmed wording', () => {
    const guardian = build('guardian', 7);
    expect(guardian.extraReactions?.length, 'fixture: level 7 is where Reaction Time lands').toBeTruthy();
    const r = rail(guardian);
    const row = [...card(r.host, 'Essentials')!.querySelectorAll<HTMLElement>('.rail-kv')].find(
      (e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === 'Reactions',
    )!;
    // *"i don't want the whole text block there because it's too big"* — the row is the label and its
    // value, with no explanation line left on it at all.
    //
    // The VALUE moved TWICE on 2026-09-16: "2 per round" → "1 per round" + `*` (a restricted extra
    // stopped counting), then → the `*` alone (*"don't show 1 per round because everyone has one per
    // round, it has no point"*). Both moves are asserted in bug-owner-2026-09-16-sheet.test.tsx. The
    // PIN did not move with them — this stays an exact string, because the whole point of the 09-15
    // ruling is that nothing else is allowed onto this row.
    expect(row.querySelector('.kv-note'), 'the trimmed explanation line is gone from the row').toBeNull();
    expect(row.textContent?.trim(), 'the whole row is the label and its star').toBe('Reactions*');
    // *"and the `*` when clicked shows the reaction changes"* — the star is the control, so it has to
    // be a real one.
    const star = row.querySelector<HTMLElement>('.iwr-val .sit-star');
    expect(star, 'the value IS the star').toBeTruthy();
    const press = row.querySelector<HTMLElement>('.iwr-val button');
    expect(press, 'and it is pressable').toBeTruthy();
    /* …and pressABLE by a finger, which a dispatched click cannot prove. Measured live at 7.4 × 0 px
       before this: `.cond-mark` is inline-flex and `.sit-star` carries `line-height: 0`, so the box
       collapsed and the only target was the glyph overflowing it, at the `cursor: help` that class
       sets. jsdom has no layout, so the leg below pins the RULE that produced the box instead — a
       proxy, and named as one.
       2026-09-16: that rule moved out of the inline `style` and into `.rail-star-btn` in sheet.css
       (with the dotted affordance and the glyph's `line-height`/`cursor` overrides), where a
       stylesheet can see it. jsdom loads no stylesheet, so the proxy is now the class and the absence
       of anything inline. */
    expect(press!.className, 'a target a finger can hit, sized in the stylesheet').toContain('rail-star-btn');
    expect(press!.getAttribute('style'), 'and not inline, where no stylesheet could reach it').toBeNull();
    expect(star!.getAttribute('style'), 'the glyph is un-collapsed by the same class').toBeNull();
    // *"that popup will show the full explanation"* — untrimmed, parenthetical and all, plus the record
    // it came from and the click that opens that record's own text.
    r.click(press);
    const modal = r.host.querySelector<HTMLElement>('.stat-detail');
    expect(modal, 'pressing the star opens the breakdown popup').toBeTruthy();
    const text = modal!.textContent ?? '';
    expect(text, 'the parenthetical the row used to abbreviate to "incl."').toContain('(including Shield Block)');
    expect(text).toContain('a reaction from a guardian feat or class feature');
    expect(text, 'and what grants it').toContain('Reaction Time');
    // `extraReactions[].from` is a NAME; the note is only clickable if it was mapped back to the id.
    expect(modal!.querySelector('.sd-situational .sd-sit-more'), 'the note opens its record like the others').toBeTruthy();
    r.stop();
  });
});
