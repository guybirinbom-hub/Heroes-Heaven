// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { normalizeCharacter } from '../src/rules/normalize';
import { deriveArmorCheckPenalty } from '../src/rules/derive';
import { deriveInitiative, initiativeFoldsClause, initiativeInfluenceDetail } from '../src/rules/initiative';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { isRestrictedReaction } from '../src/rules/reactions';
import { applyPlayState, emptyPlay, removeCondition } from '../src/rules/play';
import { VitalsRail } from '../src/sheet/VitalsRail';
import type { Character } from '../src/rules/types';

/**
 * Owner, 2026-09-16 (screenshots) — three things about the character sheet.
 *
 *  1. *Perception back with the saves.* It left that card on 2026-09-15 for "Essentials"; he wants to
 *     read it beside Fortitude/Reflex/Will again. Essentials keeps hero points, Speed, Reactions,
 *     Initiative-when-influenced and Senses — Initiative did NOT come back with Perception.
 *
 *  2. *A number for what always applies, a star for what applies only sometimes.* A guardian's
 *     Reactions row read "2 per round". Reaction Time grants a reaction usable *"only for reactions
 *     from guardian feats or class features (including Shield Block)"*, so the second one cannot be
 *     spent on a Reactive Strike and the number was a promise the rules do not keep.
 *
 *     ⚠ SECOND RULING, same day, and it moved both rows again:
 *      • Reactions — *"don't show 1 per round because everyone has one per round, it has no point; if
 *        a character has something with reaction amount changes then add the reaction line and have a
 *        `*` and the `*` when clicked shows the reaction changes."* So there is no count on that row
 *        at all: the row appears when something changes the count, restricted or not, and its whole
 *        value is the star that opens the list.
 *      • Initiative — the other half of the same sentence. A bonus that applies to EVERY initiative
 *        roll now goes INTO the number instead of being printed as homework beside it, so the popup
 *        has two labels rather than three and the star again means only "sometimes".
 *
 *  3. *A derived condition has to look derived.* Encumbered is worked out from Bulk by
 *     `applyPlayState` and never written into `play.conditions` — so it was listed wearing the pill of
 *     a toggled condition, remove button and all, and pressing that button did nothing at all. It is
 *     now locked, and says its cause.
 *
 *     ⚠ REFUTATION, same day: for the commonest case it was not listed AT ALL. The derivation
 *     overlaid the play INVENTORY and not the play WALLET, while the sheet renders the play wallet —
 *     so a character with 10,000 gp earned at the table had an Inventory header reading "Bulk 10 / 5
 *     · encumbered" and an empty Conditions card. Fixed where both answers come from (play.ts), and
 *     the cause now travels on the condition itself (`ActiveCondition.derivedFrom`) instead of being
 *     worked out a second time beside the display, which is how the two could disagree.
 *
 * MUTATION PROOF (each applied once, then restored):
 *  • Perception gated off the saves card (`{false && <div …>}` around its row) fails two legs —
 *    `AssertionError: expected [ 'Fortitude', 'Reflex', 'Will' ] to deeply equal [ 'Fortitude',
 *    'Reflex', 'Will', …(1) ]`, and the shape leg then cannot find a row at all.
 *  • Putting any count back on the Reactions row (`{1 + reactionChanges.length} per round` in the
 *    row's `.iwr-val`) fails three exact-string pins, two here and one in
 *    bug-rail-initiative-essentials — `AssertionError: the whole row is the label and the star:
 *    expected 'Reactions2 per round*' to be 'Reactions*'`.
 *  • Turning the Reactions star back into a bare `<SituationalStar>` (the `<button>` → `<span>`)
 *    fails "…is the label and the star" and its 09-15 twin — `AssertionError: and it is pressable:
 *    expected null to be truthy`. Star and control are proved separately, not one through the other.
 *  • Dropping `rail-star-btn` from the star button's className (leaving it a bare `.cond-mark`) fails
 *    "the target is sized by a class" — `AssertionError: expected 'cond-mark' to contain
 *    'rail-star-btn'` — and the 09-15 file's twin leg with it.
 *  • Putting the size back as an inline `style` instead fails "and nothing is left inline on it" —
 *    `AssertionError: expected 'min-width: 24px; min-height: 24px;…' to be null`.
 *  • Printing a folded line without the figure the number actually took (`const text = note.text`)
 *    fails "ponderous armour is always-on too" — `AssertionError: the figure the number actually took,
 *    beside the prose the record prints: expected 'Initiativerolled with Perception-2Wha…' to contain
 *    '-3 for this character'`.
 *  • Reconciling a line against its OWN modifier instead of against what the pool took from it
 *    (`if (t.mod.value === t.printed) return text` in `reconciled`, which is what the first refutation
 *    pass shipped) fails the two same-type legs — `AssertionError: exactly one of the two is the one
 *    the number took: expected [] to have a length of 1 but got +0`, and its twin on the two feats.
 *    That is the bug in the other direction: two "+2 circumstance" lines both claiming a number that
 *    had moved 2.
 *  • Dropping the registry half of `initiativeTerms` (what `deriveInitiative` pools) fails two
 *    legs — `AssertionError: the feat is worth +2 on every initiative roll: expected 1 to be 3` and,
 *    on ponderous armour, `expected 1 to be -2`.
 *  • Summing that lane instead of pooling it (`.reduce((n, m) => n + m.value, 0)` for
 *    `poolTypedMods`) fails "two unconditional +2 status modes count once" — `AssertionError: same
 *    type, so it does not double: expected 5 to be 3`.
 *  • Folding ponderous's printed -1 rather than the worse of it and the armour's check penalty
 *    (`value: Number(m[1])`) fails "ponderous armour is always-on too" — `AssertionError: expected +0
 *    to be -2`.
 *  • Reverting the popup to its three labels ("already in the number above" / "only sometimes") fails
 *    four legs — `AssertionError: so the popup has to say which kind it is: expected
 *    'Initiativerolled with Perception+3Wha…' to contain '(in the number)'`.
 *  • Dropping the star from the Initiative row fails "a genuinely conditional influence…" —
 *    `AssertionError: the conditional influence has to be announced: expected null to be truthy`.
 *  • Rendering the stepper on a derived condition again (`valued && onPlay`, no `!auto`, in the
 *    rail's pill loop) fails "a derived VALUED condition shows its value and not its stepper" —
 *    `AssertionError: a dead ± is worse than none: expected <span class="cond-pill-step">…(2)</span>
 *    to be null`.
 *  • The same mutation in the picker (dropping `!auto` from the ± buttons, ConditionsModal) fails the
 *    second half of that leg — `AssertionError: same rule in the picker: expected <button …(1)><i
 *    …(2)></i></button> to be null`. Applied on its own, because the rail half aborts the leg before
 *    the picker half runs.
 *  • Lifting the locked value back OUT of `.cond-stepper` (a `<span className="cond-val">` of its own,
 *    the shape the refutation caught: `.cond-val` is styled by `.cond-stepper .cond-val` and by
 *    nothing else) fails the same leg — `AssertionError: and the same value still shows, styled:
 *    expected undefined to be '1'`.
 *  • `const auto = undefined` in the rail's pill loop fails two legs — `AssertionError: a derived
 *    condition has no remove button: expected <button …(2)>…(1)</button> to be null`.
 *  • Removing the `disabled` from the picker's locked toggle fails "the picker cannot offer a toggle
 *    that does nothing" — `AssertionError: expected false to be true`.
 *  • Dropping `currency` back out of the Bulk overlay (play.ts, the shipped bug) fails six legs —
 *    `AssertionError: expected false to be true` on "coins earned in play → encumbered: true", and
 *    every Encumbered leg above it.
 *  • Marking a mode's condition derived even when the player already holds it (dropping the `!have`
 *    guard's half) fails "the player's OWN Enfeebled 2 keeps its remove button" —
 *    `AssertionError: so it can still be taken off: expected null to be truthy`.
 *  • Reverting the Initiative popup's heading to the shared default fails "an always-on influence is
 *    inside the number" — `AssertionError: a line that always applies is not filed under "apply when
 *    it fits"`.
 */
const db = content();
const noop = (() => undefined) as never;

/** A character with no ancestry, heritage, background or feat, and Str 10 — so the Bulk limit is a
 *  flat 5 and anything the rail shows came from what the leg put on it. */
const plain = (over: Record<string, unknown> = {}): Character =>
  normalizeCharacter({
    id: 'r',
    name: 'R',
    level: 1,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    feats: [],
    currency: {},
    inventory: [],
    ...over,
  } as unknown as Character);

const rail = (character: Character, onPlay?: unknown) =>
  renderDom(createElement(VitalsRail, { character, content: db, onOpenStat: noop, onPlay: (onPlay ?? noop) as never }));

const card = (host: HTMLElement, title: string): HTMLElement | undefined =>
  [...host.querySelectorAll<HTMLElement>('.card')].find((e) => (e.querySelector('.ct')?.textContent ?? '').trim() === title);

/** The labels of a card's rows, in render order, with any situational `*` dropped. */
const rowLabels = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('.stat-row, .rail-kv')].map((r) =>
    (r.querySelector('.stat-name, .kv-label')?.textContent ?? '').replace(/\*/g, '').trim(),
  );

/** Is anything left OUT of the number — the `*` beside the Initiative value, asked exactly the way
 *  VitalsRail asks it. There is deliberately no `initiativeHasSituational` in src/ any more, and no
 *  `initiativeInfluences` either: each had no caller but these legs, while the component read the
 *  same rule off the list it already held, so one rule had two spellings that could drift. */
const hasStar = (c: Character): boolean => initiativeInfluenceDetail(c, db).some((i) => !i.inNumber);

/** The influence lines — the `initiativeInfluences` these legs used to import, spelled the way the
 *  component spells it. */
const influences = (c: Character): string[] => initiativeInfluenceDetail(c, db).map((i) => i.note.text);

/** One `.rail-kv` row of a card, by its label. */
const kvRow = (host: HTMLElement, cardTitle: string, label: string): HTMLElement | undefined =>
  [...(card(host, cardTitle)?.querySelectorAll<HTMLElement>('.rail-kv') ?? [])].find(
    (e) => (e.querySelector('.kv-label')?.textContent ?? '').trim() === label,
  );

/** The condition pill for one condition name on the rail's Conditions card. */
const condPill = (host: HTMLElement, name: string): HTMLElement | undefined =>
  [...(card(host, 'Conditions')?.querySelectorAll<HTMLElement>('.cond-pill') ?? [])].find((p) =>
    (p.textContent ?? '').includes(name),
  );

/* ---------------------------------------------------------------- 1. Perception */

describe('Perception is back on the saves card', () => {
  // bug 2026-09-16: rail perception
  it('the saves card is Fortitude, Reflex, Will and Perception — in that order', () => {
    const r = rail(plain());
    expect(rowLabels(card(r.host, 'Saves')!)).toEqual(['Fortitude', 'Reflex', 'Will', 'Perception']);
    r.stop();
  });

  // bug 2026-09-16: rail perception
  it('Perception keeps the shape it had — rank pill, modifier, rollable', () => {
    const r = rail(plain());
    const row = [...card(r.host, 'Saves')!.querySelectorAll<HTMLElement>('.stat-row')].find((e) =>
      (e.querySelector('.stat-name')?.textContent ?? '').startsWith('Perception'),
    )!;
    expect(row.querySelector('.rank-pill'), 'the rank pill came with it').toBeTruthy();
    expect(row.querySelector('.stat-mod')?.textContent).toMatch(/^[+-]\d+$/);
    expect(row.className, 'and it still opens its own breakdown').toContain('rollable');
    r.stop();
  });

  // bug 2026-09-16: rail perception
  it('Essentials keeps hero points, Speed and Senses — and does NOT get Initiative back with it', () => {
    const r = rail(plain());
    expect(rowLabels(card(r.host, 'Essentials')!)).toEqual(['Hero points', 'Speed', 'Senses']);
    r.stop();
  });
});

/* ---------------------------------------------------------------- 2. reactions */

describe('the Reactions row is a star, and never a number', () => {
  // bug 2026-09-16: conditional reactions
  it('every record in the data that grants an extra reaction restricts it', () => {
    // If this ever fails, a record was authored with an unrestricted `usableFor` and the classification
    // table in the lane report is out of date — which is exactly when the owner needs to hear about it.
    const all = [...Object.values(db.feats ?? {}), ...Object.values(db.classFeatures ?? {})].filter((r) => r.extraReaction);
    expect(all.length, 'fixture: the data still carries extra-reaction grants').toBeGreaterThan(10);
    expect(all.filter((r) => !isRestrictedReaction(r.extraReaction!)).map((r) => r.name)).toEqual([]);
  });

  // bug 2026-09-16: conditional reactions
  it("a guardian's row is the label and the star — no count anywhere on it", () => {
    const guardian = build('guardian', 7);
    expect(guardian.extraReactions?.length, 'fixture: Reaction Time lands at level 7').toBeTruthy();
    const r = rail(guardian);
    const row = kvRow(r.host, 'Essentials', 'Reactions')!;
    // *"don't show 1 per round because everyone has one per round, it has no point"* — the exact
    // string is the pin, because the ruling is about what may NOT be on this row.
    expect(row.textContent?.trim(), 'the whole row is the label and the star').toBe('Reactions*');
    expect(row.querySelector('.iwr-val .info-term'), 'no number left for a dotted term to sit on').toBeNull();
    expect(row.querySelector('.kv-note'), 'no explanation line on the row itself').toBeNull();
    expect(row.querySelector('.iwr-val .sit-star'), 'the value IS the star').toBeTruthy();
    // *"the `*` when clicked shows the reaction changes"* — so the star has to be a control, and the
    // clause it SAYS lives on that control, where it covers the whole of the hit area rather than the
    // glyph alone (the star itself has no `title` and inherits this one).
    const press = row.querySelector<HTMLElement>('.iwr-val button');
    expect(press, 'and it is pressable').toBeTruthy();
    expect(press!.getAttribute('title'), 'and it carries the clause, like every other star').toContain(
      'a reaction from a guardian feat or class feature',
    );
    /* bug 2026-09-16 (refutation): the hit target used to be five inline properties on this element
       and two more on the glyph — a size a phone depends on, living where no stylesheet could see it.
       It is `.rail-star-btn` in sheet.css now, so the pin is the class and the ABSENCE of the inline
       style; jsdom has no stylesheet, so the rule itself cannot be measured here either way. */
    expect(press!.className, 'the target is sized by a class').toContain('rail-star-btn');
    expect(press!.getAttribute('style'), 'and nothing is left inline on it').toBeNull();
    expect(
      row.querySelector<HTMLElement>('.iwr-val .sit-star')!.getAttribute('style'),
      'nor on the glyph it holds',
    ).toBeNull();
    r.stop();
  });

  // bug 2026-09-16: conditional reactions
  it('pressing the star names every source with its restriction', () => {
    const r = rail(build('guardian', 7));
    r.click(kvRow(r.host, 'Essentials', 'Reactions')!.querySelector('.iwr-val button'));
    const text = r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '';
    expect(text, 'the untrimmed printed clause, parenthetical and all').toContain('(including Shield Block)');
    expect(text, 'what grants it').toContain('Reaction Time');
    expect(text, 'and what it may be spent on').toContain('usable only for');
    // The count is gone from the popup too — it was the thing that could be wrong.
    expect(text, 'no per-round count anywhere').not.toContain('per round');
    r.stop();
  });

  // bug 2026-09-16: conditional reactions
  it('an UNRESTRICTED extra earns the same row, with its own wording and still no number', () => {
    const base = build('guardian', 7);
    // Synthetic: no shipped record grants an unrestricted extra reaction, and `usableFor` naming no
    // restriction is exactly how one would be authored.
    const c: Character = { ...base, extraReactions: [{ usableFor: 'any reaction', count: 1, from: 'A blessing' }] };
    expect(isRestrictedReaction(c.extraReactions![0])).toBe(false);
    const r = rail(c);
    const row = kvRow(r.host, 'Essentials', 'Reactions')!;
    expect(row.textContent?.trim(), 'an unrestricted change is still a change, and still a star').toBe('Reactions*');
    expect(row.querySelector<HTMLElement>('.iwr-val button')!.getAttribute('title')).toBe('A blessing: +1 reaction');
    r.click(row.querySelector('.iwr-val button'));
    const text = r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '';
    expect(text).toContain('+1 reaction — A blessing');
    expect(text, 'nothing restricts it, so nothing says it is restricted').not.toContain('usable only for');
    r.stop();
  });

  // bug 2026-09-16: conditional reactions
  it('a character with nothing that changes reactions has no row at all', () => {
    const r = rail(plain());
    expect(kvRow(r.host, 'Essentials', 'Reactions')).toBeUndefined();
    r.stop();
  });
});

/* ---------------------------------------------------------------- 2b. initiative */

/** Modes aimed at initiative: two identical unconditional ones (they must not add up) and a
 *  sometimes-one (it must not be counted at all). */
const INIT_MODE_DB = {
  ...db,
  modes: {
    ...db.modes,
    'lane-init-a': { id: 'lane-init-a', name: 'Lane A', predefined: true, modifiers: [{ value: 2, type: 'status', target: 'initiative' }] },
    'lane-init-b': { id: 'lane-init-b', name: 'Lane B', predefined: true, modifiers: [{ value: 2, type: 'status', target: 'initiative' }] },
    'lane-init-when': {
      id: 'lane-init-when',
      name: 'Lane Sometimes',
      predefined: true,
      modifiers: [{ value: 2, type: 'circumstance', target: 'initiative', appliesWhen: 'in a forest' }],
    },
  },
} as typeof db;
const withInitModes = (ids: string[]) => applyPlayState(plain(), { ...emptyPlay(), activeModes: ids }, INIT_MODE_DB);

describe('the Initiative row follows the same rule', () => {
  /* Incredible Initiative prints "+2 circumstance on initiative rolls (whatever statistic you roll
     for initiative — usually Perception)". There is no sometimes in that sentence: it applies on
     every roll this row describes — so as of the owner's second ruling it is IN the number, and the
     popup says so instead of telling the player to add it themselves. */
  // bug 2026-09-16: conditional initiative
  it("an always-on influence is inside the number, earns NO star, and the popup says it is counted", () => {
    const c = plain({ feats: [{ featId: 'incredible-initiative', level: 1 }] });
    expect(influences(c).join('\n')).toMatch(/Incredible Initiative/);
    expect(hasStar(c), 'nothing about it is conditional').toBe(false);
    // The +2 itself: the one leg that fails if the fold is dropped and only the wording is kept.
    expect(deriveInitiative(c, db).modifier, 'the feat is worth +2 on every initiative roll').toBe(
      deriveInitiative(plain(), db).modifier + 2,
    );
    const r = rail(c);
    const row = kvRow(r.host, 'Essentials', 'Initiative')!;
    expect(row.querySelector('.iwr-val .info-term')?.textContent).toMatch(/^[+-]\d+ \(Perception\)$/);
    expect(row.querySelector('.iwr-val .sit-star'), 'an always-on influence is not "sometimes"').toBeNull();
    r.click(row.querySelector('.iwr-val .info-term'));
    const text = r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '';
    expect(text, 'so the popup has to say which kind it is').toContain('(in the number)');
    expect(text, 'and must not ask the player to add what is already counted').not.toContain('add it yourself');
    // bug 2026-09-16 (refutation): and it must not file that line under a heading saying the
    // opposite. "Situational (apply when it fits)" over a line that says it applies to every roll is
    // the popup contradicting itself in two adjacent elements.
    expect(text, 'a line that always applies is not filed under "apply when it fits"').not.toContain('apply when it fits');
    expect(r.host.querySelector('.sd-sec-label:not(.sd-calc-label)')?.textContent, 'the heading says what the list is').toContain(
      'What changes your initiative',
    );
    r.stop();
  });

  /* PF2e stacking, in the one place two sources of the same kind meet: best bonus per type, so two
     unconditional +2 status modes are +2 and not +4 — the refuter's note on pass 1. */
  // bug 2026-09-16: conditional initiative
  it('two unconditional +2 status modes count once, and the popup does not claim the +2 twice', () => {
    const base = deriveInitiative(plain(), db).modifier;
    expect(deriveInitiative(withInitModes(['lane-init-a']), db).modifier).toBe(base + 2);
    const both = withInitModes(['lane-init-a', 'lane-init-b']);
    expect(deriveInitiative(both, db).modifier, 'same type, so it does not double').toBe(base + 2);
    /* bug 2026-09-16 (refutation): the number pooled and the LIST did not. Both lines said "(in the
       number)" — an explanation of +4 printed beside a +2, which is the same contradiction the
       ponderous leg below caught from the other direction. Nothing here asked what those two lines
       said, so the pass shipped with the fixture that proves it in the file. */
    const lines = influences(both);
    expect(lines.filter((t) => /Lane [AB]/.test(t)), 'fixture: both modes are still listed').toHaveLength(2);
    expect(
      lines.filter((t) => t.includes('the same status bonus is already counted')),
      'exactly one of the two is the one the number took',
    ).toHaveLength(1);
    expect(hasStar(both), 'neither of them is a sometimes-bonus').toBe(false);
  });

  /* The same rule where the owner will actually meet it: two SHIPPED feats. Incredible Initiative and
     Saved by Clockwork are both "+2 circumstance", and their `when` strings differ by one
     parenthetical — so `poolSituationalLines` keeps both display lines while `poolTypedMods` takes
     the +2 once. */
  // bug 2026-09-16: conditional initiative
  it('two always-on +2 circumstance feats move the number once, and only one line claims it', () => {
    const c = plain({
      feats: [
        { featId: 'incredible-initiative', level: 1 },
        { featId: 'saved-by-clockwork', level: 1 },
      ],
    });
    expect(deriveInitiative(c, db).modifier, 'same type, so it does not double').toBe(deriveInitiative(plain(), db).modifier + 2);
    const lines = influences(c);
    expect(lines.length, 'fixture: both records still reach the list as separate lines').toBe(2);
    expect(
      lines.filter((t) => t.includes('+0 for this character: the same circumstance bonus is already counted')),
      'the one that added nothing says so, beside the one that added the +2',
    ).toHaveLength(1);
    expect(hasStar(c), 'neither of them is a sometimes-bonus').toBe(false);
  });

  // bug 2026-09-16: conditional initiative
  it('a conditional mode stays OUT of the number and wears the star', () => {
    const c = withInitModes(['lane-init-when']);
    expect(deriveInitiative(c, db).modifier, 'nothing sometimes-only is counted').toBe(deriveInitiative(plain(), db).modifier);
    expect(hasStar(c)).toBe(true);
    const r = rail(c);
    const row = kvRow(r.host, 'Essentials', 'Initiative')!;
    expect(row.querySelector('.iwr-val .sit-star')).toBeTruthy();
    r.click(row.querySelector('.iwr-val .info-term'));
    expect(r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '').toContain('(only sometimes — apply it yourself)');
    r.stop();
  });

  /* The other side of the fold, in the number rather than in the star: a sometimes-bonus is worth
     nothing until its clause is true, so it may not be counted. Scout Dedication is both kinds of
     "no" at once — a real trigger ("when you used the Scout exploration activity") and a bonus that
     is not one plain modifier ("+2 circumstance (instead of Scout's usual +1)"). */
  // bug 2026-09-16: conditional initiative
  it.each(['always-ready', 'scout-dedication'] as const)('%s changes no number', (featId) => {
    const c = plain({ feats: [{ featId, level: 1 }] });
    expect(deriveInitiative(c, db).modifier).toBe(deriveInitiative(plain(), db).modifier);
    expect(hasStar(c), 'it is the star instead').toBe(true);
  });

  /* And the contrast, through the same code: Always Ready is "+1 circumstance on initiative when all
     your opponents are undead" — a real sometimes-clause. */
  // bug 2026-09-16: conditional initiative
  it('a genuinely conditional influence still carries the star', () => {
    const c = plain({ feats: [{ featId: 'always-ready', level: 1 }] });
    expect(hasStar(c)).toBe(true);
    const r = rail(c);
    const row = kvRow(r.host, 'Essentials', 'Initiative')!;
    expect(row.querySelector('.iwr-val .sit-star'), 'the conditional influence has to be announced').toBeTruthy();
    r.click(row.querySelector('.iwr-val .info-term'));
    const text = r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '';
    expect(text, 'with its clause').toContain('all your opponents are undead');
    expect(text, 'marked as the sometimes kind').toContain('(only sometimes — apply it yourself)');
    expect(text, 'and never claimed as counted').not.toContain('(in the number)');
    r.stop();
  });

  /* The table itself, one feat per shape, so a re-worded `when` in the registry shows up here rather
     than as a star nobody can explain. LEFT: the clause is the row, so the bonus is in the number.
     RIGHT: it is a real trigger, so it is the star.

     ⚠ REFUTATION (2026-09-16, same day): two of the LEFT column were free actions. Swaggering
     Initiative prints *"**Trigger** You are about to roll initiative. … You gain a +2 circumstance
     bonus to your initiative roll and can Interact to draw a weapon"* and Emphatic Emissary prints
     *"**Trigger** You roll initiative."* — a player who does not spend the free action gets nothing,
     so a number that had already added the +2 was a promise the rules do not keep. They now read as
     the star, like their siblings Duelist's Edge and Ten Paces, and the guard below re-derives that
     from the printed text rather than from this table. */
  // bug 2026-09-16: conditional initiative
  it.each([
    ['incredible-initiative', false],
    ['swaggering-initiative', true],
    ['divine-dragonblood', false],
    ['emphatic-emissary', true],
    ['saved-by-clockwork', false],
    ['ambush-awareness', false],
    ['proximity-alert', false],
    ['battlefield-surveyor', false],
    ['always-ready', true],
    ['all-this-has-happened-before', true],
    ['posse', true],
    ['scout-dedication', true],
    ['psychic-duelist-dedication', true],
  ] as const)('%s → conditional: %s', (featId, conditional) => {
    const c = plain({ feats: [{ featId, level: 1 }] });
    expect(influences(c).length, 'the feat has to reach the row at all').toBeGreaterThan(0);
    expect(hasStar(c)).toBe(conditional);
  });

  /* THE GUARD, and the reason the two rows above moved: the table names records, and a record the
     table does not name can still be re-worded into the number. So ask the whole registry the same
     question the number asks, and answer it from the PRINTED text rather than from this file — a
     record whose description opens with a **Trigger** is something the player has to USE, and if that
     trigger is the initiative roll then its bonus is theirs to apply and not the app's to add.
     Every bucket, because the offenders are as often class features and items (Ten Paces) as feats. */
  // bug 2026-09-16: conditional initiative
  it('no record that prints a **Trigger** about initiative is folded into the number', () => {
    const desc = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')) as Record<
      string,
      Record<string, { d?: string }>
    >;
    const printed = (id: string): string => {
      for (const bucket of Object.values(desc)) if (bucket?.[id]?.d) return bucket[id].d!;
      return '';
    };
    const examined: string[] = [];
    const folded: string[] = [];
    for (const [id, list] of Object.entries(FEAT_SITUATIONAL)) {
      const d = printed(id);
      if (!d.startsWith('**Trigger**') || !/initiative/i.test(d)) continue;
      examined.push(id);
      for (const b of list ?? []) if (initiativeFoldsClause(b.when, b.bonus)) folded.push(`${id} — "${b.when}"`);
    }
    /* Not vacuous: the four the refutation named have to be among the records this looked at, or the
       lookup is broken and an empty `folded` means nothing. */
    expect(examined, 'the records this guard exists for').toEqual(
      expect.arrayContaining(['swaggering-initiative', 'emphatic-emissary', 'duelists-edge', 'ten-paces']),
    );
    expect(folded, 'a triggered free action is the player’s to spend, so it keeps the star').toEqual([]);
  });

  /* The one that is not a feat: ponderous is a PENALTY every wearer of that armour takes on every
     initiative roll ("on initiative", -1 or the check penalty if worse). A star on it would have
     read as "only sometimes" to every heavy-armour character in the game — and leaving it out of the
     number told them their initiative was better than it is. */
  // bug 2026-09-16: conditional initiative
  it('ponderous armour is always-on too, and its penalty is in the number', () => {
    const c = plain({
      inventory: [{ instanceId: 'arm1', itemId: 'fortress-plate', quantity: 1, worn: true }],
    });
    expect(influences(c).join('\n')).toMatch(/ponderous/i);
    expect(hasStar(c)).toBe(false);
    // *"-1 … if you don't meet the armor's required Strength modifier, the penalty becomes the
    // armor's check penalty when that is worse"* — Str 10 in fortress plate does not meet it, and the
    // app already computes that check penalty, so the worse of the two is exact rather than prose.
    const penalty = Math.min(-1, deriveArmorCheckPenalty(c, db).value);
    expect(penalty, 'fixture: this armour is heavy enough to beat its own printed -1').toBeLessThan(-1);
    expect(deriveInitiative(c, db).modifier).toBe(deriveInitiative(plain(), db).modifier + penalty);
    /* bug 2026-09-16 (refutation): "(in the number)" is a claim about the value on the row, and this
       is the one entry whose PRINTED bonus is not the folded one — the popup said "-1 … in the
       number" next to a 3-point drop. So the line has to carry the figure actually taken. */
    const r = rail(c);
    r.click(kvRow(r.host, 'Essentials', 'Initiative')!.querySelector('.iwr-val .info-term'));
    const text = r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '';
    expect(text, 'the figure the number actually took, beside the prose the record prints').toContain(`${penalty} for this character`);
    expect(text).toContain('(in the number)');
    r.stop();
  });

  // bug 2026-09-16: conditional initiative
  it('rolling with Stealth is not conditional — it is how this character always rolls', () => {
    const c = plain({ initiativeSkill: 'stealth' });
    expect(influences(c).length, 'it still earns the row').toBeGreaterThan(0);
    expect(hasStar(c)).toBe(false);
    const r = rail(c);
    const row = kvRow(r.host, 'Essentials', 'Initiative')!;
    expect(row.querySelector('.iwr-val .info-term')?.textContent).toMatch(/^[+-]\d+ \(Stealth\)$/);
    expect(row.querySelector('.iwr-val .sit-star'), 'nothing conditional here').toBeNull();
    // This one IS the number shown — telling the player to add it themselves would have them count
    // the whole statistic twice.
    r.click(row.querySelector('.iwr-val .info-term'));
    const text = r.host.querySelector<HTMLElement>('.stat-detail')?.textContent ?? '';
    expect(text, 'the Stealth line is already in the number').toContain('(in the number)');
    expect(text).not.toContain('add it yourself');
    r.stop();
  });
});

/* ---------------------------------------------------------------- 3. derived conditions */

/**
 * Str 10 → encumbered above 5 Bulk. 10,000 gold pieces are 10 Bulk and nothing else, so the leg owns
 * the whole load and "dropping it" is one field.
 *
 * The coins are in the PLAY wallet, which is where the owner's were: money earned at the table is
 * typed into the sheet's own wallet and lands in `play.currency`. Judging the limit against the BUILD
 * purse — what shipped — showed a character whose Inventory header read "Bulk 10 / 5 · encumbered"
 * with no pill, no lock, no clumsy 1 and no −10 ft anywhere on the rail.
 */
const overloaded = () => applyPlayState(plain({ currency: { gp: 15 } }), { ...emptyPlay(), currency: { gp: 10000 } }, db);

describe('a condition derived from Bulk shows on the sheet, locked', () => {
  // bug 2026-09-16: derived conditions
  it('Encumbered is in the sheet’s condition list and says where it came from', () => {
    const c = overloaded();
    expect(c.conditions.map((x) => x.id)).toContain('encumbered');
    const r = rail(c);
    const pill = condPill(r.host, 'Encumbered');
    expect(pill, 'the pill has to be there at all').toBeTruthy();
    const lock = pill!.querySelector<HTMLElement>('.cond-auto-lock');
    expect(lock, 'and marked automatic').toBeTruthy();
    expect(lock!.textContent).toContain('from Bulk');
    expect(lock!.getAttribute('title')).toContain('carrying 10 of 5');
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('Encumbered cannot be removed from the sheet', () => {
    const r = rail(overloaded());
    const pill = condPill(r.host, 'Encumbered')!;
    expect(pill.querySelector('.cond-pill-x'), 'a derived condition has no remove button').toBeNull();
    // A toggled one still does, so this is a property of the derivation and not of the card.
    r.stop();
    const withDying = applyPlayState(plain(), { ...emptyPlay(), conditions: [{ id: 'dying', value: 1 }] }, db);
    const r2 = rail(withDying);
    expect(condPill(r2.host, 'Dying')!.querySelector('.cond-pill-x'), 'a toggled condition keeps its X').toBeTruthy();
    r2.stop();
  });

  // bug 2026-09-16: derived conditions
  it('…and removing it through the play state would not have worked anyway', () => {
    // The reason the lock is the fix rather than a working button: the condition is not IN play, so
    // `removeCondition` has nothing to remove and `applyPlayState` derives it straight back.
    const ch = plain({ currency: { gp: 10000 } });
    const after = applyPlayState(ch, removeCondition(emptyPlay(), 'encumbered'), db);
    expect(after.conditions.map((x) => x.id)).toContain('encumbered');
  });

  /* The ONE wallet, both ways round. `deriveBulk` counts coins, and the sheet renders the play
     wallet, so the condition and the Bulk number that justifies it have to be asked about the same
     purse — the live bug was the first of these, and mirroring the derivation next to the display
     instead of fixing the overlay would have produced the second. */
  // bug 2026-09-16: derived conditions
  it.each([
    ['coins earned in play → encumbered', { gp: 15 }, { gp: 10000 }, true],
    ['coins spent in play → not encumbered', { gp: 10000 }, { gp: 10 }, false],
    ['no play wallet at all → the build purse still counts', { gp: 10000 }, undefined, true],
  ] as const)('%s', (_label, charCurrency, playCurrency, want) => {
    const c = applyPlayState(plain({ currency: charCurrency }), { ...emptyPlay(), currency: playCurrency }, db);
    expect(c.conditions.some((x) => x.id === 'encumbered')).toBe(want);
    const r = rail(c);
    // …and the rail agrees with the overlay, pill and lock included.
    expect(!!condPill(r.host, 'Encumbered')).toBe(want);
    if (want) expect(condPill(r.host, 'Encumbered')!.querySelector('.cond-pill-x')).toBeNull();
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('the conditions picker cannot offer a toggle that does nothing', () => {
    const r = rail(overloaded(), noop);
    r.click(card(r.host, 'Conditions')!.querySelector('.add-btn'));
    const row = [...r.host.querySelectorAll<HTMLElement>('.cond-row')].find(
      (e) => (e.querySelector('.mode-name')?.textContent ?? '').startsWith('Encumbered'),
    )!;
    const toggle = row.querySelector<HTMLButtonElement>('.mode-toggle')!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('title')).toContain('Automatic');
    expect(row.querySelector('.cond-auto-tag')?.textContent).toBe('from Bulk');
    // The full rules page is still one click away — a locked condition is still a condition to read.
    r.click(row.querySelector('.cond-row-open'));
    // The unmodified DescriptionModal, pin star and all (the star needs the sheet's pin context,
    // which a bare rail has not got, so the leg asserts the popup rather than its header).
    expect(r.host.querySelector('.ast-modal'), 'its description still opens').toBeTruthy();
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('dropping the load removes it', () => {
    const light = applyPlayState(plain({ currency: { gp: 100 } }), emptyPlay(), db);
    expect(light.conditions.map((x) => x.id)).not.toContain('encumbered');
    const r = rail(light);
    expect(condPill(r.host, 'Encumbered')).toBeUndefined();
    r.stop();
  });
});

/*
 * The other half of the same rule, and the one a lock can get WRONG: a condition the PLAYER applied
 * stays the player's. `applyPlayState` derives a condition only when nobody already holds it — a mode
 * that imposes Enfeebled 1 on top of a GM-applied Enfeebled 2 raises nothing and marks nothing — so a
 * lock that fired on "the cause exists" would have taken away a control the sheet has always had.
 */
const MODE_DB = {
  ...db,
  modes: {
    ...db.modes,
    'lane-mode': { id: 'lane-mode', name: 'Test Mutagen', predefined: true, modifiers: [], conditions: [{ id: 'enfeebled', value: 1 }] },
  },
};
const withMode = (conditions: { id: string; value?: number }[] = []) =>
  applyPlayState(plain(), { ...emptyPlay(), activeModes: ['lane-mode'], conditions }, MODE_DB as typeof db);

describe('a derived condition is locked; a condition the player applied is not', () => {
  // bug 2026-09-16: derived conditions
  it('a condition a MODE imposes is locked and names the mode', () => {
    const c = withMode();
    expect(c.conditions.find((x) => x.id === 'enfeebled')?.value).toBe(1);
    const r = rail(c);
    const pill = condPill(r.host, 'Enfeebled')!;
    expect(pill.querySelector('.cond-pill-x'), 'not the player’s to remove').toBeNull();
    expect(pill.querySelector('.cond-auto-lock')?.textContent).toContain('Test Mutagen');
    r.stop();
  });

  /* bug 2026-09-16 (second pass): the lock took the remove button and left the ± beside it, which
     offered to change the one thing about a derived condition the player cannot change — the value
     comes from the cause, and `applyPlayState` derives it back on the next pass. */
  // bug 2026-09-16: derived conditions
  it('a derived VALUED condition shows its value and not its stepper', () => {
    const r = rail(withMode(), noop);
    const pill = condPill(r.host, 'Enfeebled')!;
    expect(pill.querySelector('.cond-pill-step'), 'a dead ± is worse than none').toBeNull();
    expect(pill.textContent, 'the value itself still has to be readable').toContain('1');
    // …and the picker's copy of the same row.
    r.click(card(r.host, 'Conditions')!.querySelector('.add-btn'));
    const row = [...r.host.querySelectorAll<HTMLElement>('.cond-row')].find(
      (e) => (e.querySelector('.mode-name')?.textContent ?? '').startsWith('Enfeebled'),
    )!;
    // The ± BUTTONS are what goes, not the box round them: `.cond-val` is styled by
    // `.cond-stepper .cond-val` and by nothing else, so a value lifted out of that wrapper is an
    // element with no rule at all.
    expect(row.querySelector('.cond-stepper button'), 'same rule in the picker').toBeNull();
    expect(row.querySelector('.cond-stepper .cond-val')?.textContent, 'and the same value still shows, styled').toBe('1');
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('…while the player’s OWN valued condition keeps its stepper', () => {
    const r = rail(withMode([{ id: 'enfeebled', value: 2 }]), noop);
    expect(condPill(r.host, 'Enfeebled')!.querySelector('.cond-pill-step'), 'they set it, so they can step it').toBeTruthy();
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('the player’s OWN Enfeebled 2 keeps its remove button while the mode imposes Enfeebled 1', () => {
    const c = withMode([{ id: 'enfeebled', value: 2 }]);
    const held = c.conditions.find((x) => x.id === 'enfeebled')!;
    expect(held.value, 'the worse value the player holds is kept').toBe(2);
    expect(held.derivedFrom, 'and it is still theirs').toBeUndefined();
    const r = rail(c);
    expect(condPill(r.host, 'Enfeebled')!.querySelector('.cond-pill-x'), 'so it can still be taken off').toBeTruthy();
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('…and the picker leaves that one toggleable too', () => {
    const r = rail(withMode([{ id: 'enfeebled', value: 2 }]), noop);
    r.click(card(r.host, 'Conditions')!.querySelector('.add-btn'));
    const row = [...r.host.querySelectorAll<HTMLElement>('.cond-row')].find(
      (e) => (e.querySelector('.mode-name')?.textContent ?? '').startsWith('Enfeebled'),
    )!;
    expect(row.querySelector<HTMLButtonElement>('.mode-toggle')!.disabled, 'the player put it on; they can take it off').toBe(false);
    expect(row.querySelector('.cond-auto-tag')).toBeNull();
    // …and the other side of the merged block: their own value is still theirs to step.
    expect(row.querySelectorAll('.cond-stepper button'), 'so the ± is still there').toHaveLength(2);
    r.stop();
  });

  // bug 2026-09-16: derived conditions
  it('an Encumbered the player applied themselves is theirs, over the Bulk limit or not', () => {
    const c = applyPlayState(
      plain({ currency: { gp: 15 } }),
      { ...emptyPlay(), currency: { gp: 10000 }, conditions: [{ id: 'encumbered' }] },
      db,
    );
    expect(c.conditions.filter((x) => x.id === 'encumbered')).toHaveLength(1);
    const r = rail(c);
    expect(condPill(r.host, 'Encumbered')!.querySelector('.cond-pill-x'), 'they applied it, so they can remove it').toBeTruthy();
    r.stop();
  });
});
