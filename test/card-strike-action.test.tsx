// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { StrikeDetailModal } from '../src/sheet/StrikeDetailModal';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { deriveStrikes, formatMod, type Strike } from '../src/rules/derive';
import type { StatRef } from '../src/rules/explain';
import type { Character, InventoryItem } from '../src/rules/types';
import type { DescNode } from '../src/sheet/descref';

/**
 * Card step 0 (docs/card-design.md section 9, row 0): pin what two unguarded popups do TODAY, before
 * steps 2, 9 and 10 move them onto the card.
 *
 *  - StrikeDetailModal had 0 tests. It is the strike popup: Attack bonus and Damage (each a button
 *    into the breakdown), the critical specialization block gated on the character actually having
 *    it, the item's description or the built-in blurb, and the PinStar.
 *  - The Main-tab action popup (ActionDetailModal, a closure inside MainTab, so reached only THROUGH
 *    MainTab) and the record marks on action rows: a mark whose value is a cost replaces the glyph on
 *    the chip and in the popup header; a mark whose value is not a cost shows "(value)" beside the
 *    name; either way the mark's note lives only in the star's tooltip and never reaches the popup.
 *
 * Every character here is synthesized through build() (name 't'); none is the owner's.
 *
 * Page trees: the action popups render the Archives page through the record's card. jsdom cannot fetch
 * public/ast, so the TRACKED public/ast/actions.json.gz is served for the three actions opened here and
 * the cache primed, which is the state the app is in once the bucket has loaded (Halfling Luck's feats
 * page is served too). Every other bucket 404s.
 *
 * Card step 9: the action popup is the record's 'mine' card; card step 10: the strike popup is the
 * weapon's. Card step 22 removed the switches and, with them, the two blocks of the legacy popups' own
 * cases that ran only with a switch off; the same cases, re-pointed at the cards, run below.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact):
 *  - StrikeDetailModal.tsx: drop the gate (`{critText && (` for `{showsCrit && (`) → the level-1
 *    "no crit block" test goes red.
 *  - MainTab.tsx ActionDetailModal: `const cost = a.cost` instead of the marked cost → the Quick Jump test goes red.
 *  - MainTab.tsx ActionRow: drop `<MarkTag />` from the compact chip → the Quick Jump and Black Powder Boost tests go red.
 *  The first two were applied in one run (2 of 12 red, one test each); the third on its own (2 of 12 red).
 */
const db = content();
const readBucket = (b: string) =>
  JSON.parse(gunzipSync(readFileSync(`public/ast/${b}.json.gz`)).toString('utf8')) as Record<string, AstNode>;

beforeAll(async () => {
  const actions = readBucket('actions');
  // Card step 9: Halfling Luck's page too — on the card a feat action reads its tree (the legacy popup
  // never asked for one, so serving it changes nothing there).
  // Card step 10: the longsword's page too — on the card the strike popup reads its weapon's tree (the
  // legacy popup never asked for one, so serving it changes nothing there).
  const served: Record<string, Record<string, AstNode>> = {
    actions: { aid: actions.aid, leap: actions.leap, 'high-jump': actions['high-jump'] },
    feats: { 'halfling-luck': readBucket('feats')['halfling-luck'] },
    items: { longsword: readBucket('items').longsword },
  };
  globalThis.fetch = (async (input: unknown) => {
    const m = /ast\/([A-Za-z0-9_-]+)\.json$/.exec(String(input));
    return m && served[m[1]]
      ? new Response(JSON.stringify(served[m[1]]), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('', { status: 404 });
  }) as typeof fetch;
  await loadBucketAst('actions');
  await loadBucketAst('feats');
  await loadBucketAst('items');
});

const toggled: DescNode[] = [];
const pin: PinDescApi = { has: () => false, toggle: (n) => void toggled.push(n) };
let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
  toggled.length = 0;
});

function mount(el: ReactElement) {
  const r = renderDom(
    <ContentContext.Provider value={db}>
      <PinContext.Provider value={pin}>{el}</PinContext.Provider>
    </ContentContext.Provider>,
  );
  stops.push(r.stop);
  return r;
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const SWORD: InventoryItem[] = [{ instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true }];
/** A synthesized fighter wielding a longsword. Fighter Weapon Mastery (level 5) is its crit-spec source. */
const fighter = (level: number): Character => ({ ...build('fighter', level), inventory: SWORD });
const strikeOf = (c: Character, id: string): Strike => {
  const s = deriveStrikes(c, db).find((x) => x.instanceId === id);
  if (!s) throw new Error(`no strike ${id}`);
  return s;
};
const LONGSWORD_TEXT =
  "Longswords, also known as arming swords, can be one-edged or two-edged swords. Their blades are heavy and they're between 3 and 4 feet in length.";

/*
 * Card step 10 (docs/card-design.md section 9 row 10): the same six cases, re-pointed at the weapon's
 * 'mine' card. The numbers, the buttons, the crit gate and the pin are the legacy
 * popup's, unchanged; the weapon's words now come from its Archives page (weapon-386, Player Core) — the
 * old import's "also known as arming swords" is gone — and the Fist's blurb sits in the ours box.
 * test/card-strike.test.tsx holds the step's full refuter set.
 */
/** The page's own prose paragraph for the longsword (weapon-386). */
const LONGSWORD_PAGE = "Longswords can be one-edged or two-edged swords. Their blades are heavy and they're between 3 and 4 feet in length.";
const strikeCard = (host: HTMLElement) => {
  const card = host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  if (!card) throw new Error('no strike card on the page lane');
  return card;
};
/** The page's prose paragraphs on the card: the body's paragraphs after the page's first rule (its header lines sit above it). */
const prose = (card: Element) => {
  const kids = [...(card.querySelector('.ast-pop > .ast-body')?.children ?? [])];
  const hr = kids.findIndex((k) => k.tagName === 'HR');
  return kids.slice(hr + 1).filter((k) => k.tagName === 'P' && !k.closest('[data-ours]') && !k.classList.contains('card-dim')).map((p) => txt(p));
};
// batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
describe('StrikeDetailModal — the weapon\'s mine card (step 10)', () => {
  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('a level-1 fighter\'s longsword: name, PinStar, Attack bonus and Damage as derived, the PAGE text, and NO crit block', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'i-sword');
    const { host } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => undefined} />);
    const pop = strikeCard(host);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(txt(pop.querySelector('.ast-head .ast-name'))).toBe('Longsword');
    expect(pop.querySelector('.ast-head .info-star'), 'PinStar is in the header').not.toBeNull();
    const stats = [...pop.querySelectorAll('.strike-detail-stat')].map((b) => [txt(b.querySelector('.sds-label')), txt(b.querySelector('.sds-value'))]);
    expect(stats).toEqual([
      ['Attack bonus', formatMod(s.attack[0])],
      ['Damage', s.damage],
    ]);
    // The numbers the derive measured on 2026-10-02 for this build, so a silent engine change shows here too.
    // batch card premise: weapon-386 "Damage 1d8 S"
    expect(stats.map(([, v]) => v)).toEqual(['+5', '1d8 S']);
    expect(pop.querySelectorAll('.strike-detail-stat.clickable')).toHaveLength(0);
    expect(pop.querySelector('.sds-hint')).toBeNull();
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(pop.querySelector('.strike-detail-crit'), 'a level-1 fighter has no crit specialization').toBeNull();
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(prose(pop)[0]).toBe(LONGSWORD_PAGE);
    expect(txt(pop)).not.toContain('also known as arming swords');
    expect(txt(pop)).not.toContain('Critical specialization');
  });

  // batch card premise: weapon-group-15 "The target is made off-balance by your attack, becoming off-guard until the start of your next turn"
  it('at level 5 (Fighter Weapon Mastery) the sword group\'s crit specialization shows above the page', () => {
    const c = fighter(5);
    const s = strikeOf(c, 'i-sword');
    const { host } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => undefined} />);
    const crit = host.querySelector('.strike-detail-crit') as HTMLElement;
    // batch card premise: weapon-group-15 "The target is made off-balance by your attack, becoming off-guard until the start of your next turn"
    expect(crit).not.toBeNull();
    expect(txt(crit.querySelector('.sds-label'))).toBe('Critical specialization · Sword');
    expect(txt(crit.querySelector('.sd-critspec-text'))).toBe('The target is off-guard until the start of your next turn.');
    // Order: the controls (stats, crit block) first in the page's body, then the page.
    const body = strikeCard(host).querySelector('.ast-pop > .ast-body') as HTMLElement;
    // batch card premise: weapon-group-15 "The target is made off-balance by your attack, becoming off-guard until the start of your next turn"
    expect([...(body.firstElementChild?.children ?? [])].map((k) => k.className)).toEqual(['strike-detail-stats', 'strike-detail-crit']);
    expect(body.firstElementChild?.className).toBe('card-controls card-lead');
    expect(prose(strikeCard(host))[0]).toBe(LONGSWORD_PAGE);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('with onOpenStat, each stat is a button into its breakdown, keyed by the strike', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'i-sword');
    const opened: StatRef[] = [];
    const { host, click } = mount(
      <StrikeDetailModal strike={s} character={c} content={db} onOpenStat={(r) => opened.push(r)} onClose={() => undefined} />,
    );
    const buttons = [...strikeCard(host).querySelectorAll('.strike-detail-stat.clickable')];
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => txt(b.querySelector('.sds-hint')))).toEqual(['show calculation', 'show calculation']);
    click(buttons[0]);
    click(buttons[1]);
    expect(opened).toEqual([
      { kind: 'strikeAttack', instanceId: 'i-sword' },
      { kind: 'strikeDamage', instanceId: 'i-sword' },
    ]);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('the Fist has no item, so it shows the built-in blurb — in the ours box, with no page looked up by its name', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'fist');
    const { host } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => undefined} />);
    const pop = host.querySelector('.picker.info-modal.card-mine') as HTMLElement;
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(txt(pop.querySelector('.info-title'))).toBe('Fist');
    expect(txt(pop.querySelector('[data-ours] [data-ours-kind="blurb"]'))).toBe(
      'An unarmed Strike with your fist — every creature can make unarmed attacks. It uses your unarmed proficiency, and Handwraps of Mighty Blows can etch potency, striking, and property runes onto it.',
    );
    expect(pop.querySelectorAll('.strike-detail-stat')).toHaveLength(2);
    expect(pop.querySelector('.card-nopage'), 'app-authored, never print: no no-page line').toBeNull();
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('the PinStar pins {title, key: items, description} as before (plus the step-19 slug and mode); the overlay closes, the popup body does not', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'i-sword');
    let closed = 0;
    const { host, click } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => (closed += 1)} />);
    click(strikeCard(host).querySelector('.info-star'));
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(toggled.map((n) => [n.title, n.key, n.description])).toEqual([['Longsword', 'items', LONGSWORD_TEXT]]);
    expect(toggled.map((n) => [n.slug, (n as { mode?: string }).mode])).toEqual([['longsword', 'mine']]);
    expect(closed, 'the star does not close the popup').toBe(0);
    click(strikeCard(host).querySelector('.ast-body'));
    expect(closed).toBe(0);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    click(strikeCard(host).querySelector('.picker-close'));
    expect(closed).toBe(1);
    click(host.querySelector('.picker-overlay'));
    expect(closed).toBe(2);
  });

  // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
  it('through MainTab: the Strikes sub-tab\'s name button opens this card for that strike', () => {
    const c = fighter(5);
    const { host, click } = mount(<MainTab character={c} content={db} onPlay={() => undefined} />);
    click([...host.querySelectorAll('.stab')].find((t) => t.textContent?.trim() === 'Strikes') ?? null);
    // batch card premise: weapon-386 "Longswords can be one-edged or two-edged swords"
    expect(host.querySelector('.ast-modal.card-mine')).toBeNull();
    click([...host.querySelectorAll('.strike-name')].find((b) => txt(b).startsWith('Longsword')) ?? null);
    const pop = strikeCard(host);
    expect(txt(pop.querySelector('.ast-name'))).toBe('Longsword');
    expect(txt(pop.querySelector('.strike-detail-crit .sds-label'))).toBe('Critical specialization · Sword');
    expect(prose(pop)[0]).toBe(LONGSWORD_PAGE);
  });
});

/* ---------------------------------------------------------------- the Main-tab action popup */

/** A synthesized level-2 halfling fighter with Halfling Luck (free action, 1/day) and Quick Jump. */
const halfling = (): Character => ({
  ...build('fighter', 2, { ancestryId: 'halfling', featPicks: { '1:ancestry': 'halfling-luck', '2:skill': 'quick-jump' } as never }),
  inventory: SWORD,
});
/** A synthesized level-5 fighter holding exactly Black Powder Boost, whose mark on Leap is "+10 feet". */
const boosted = (): Character => ({ ...build('fighter', 5), feats: [{ featId: 'black-powder-boost', level: 1, category: 'class' }] });

/** Open the Actions sub-tab and hand back the chip for `name` plus a function that opens its popup. */
function actionsOf(c: Character) {
  const r = mount(<MainTab character={c} content={db} onPlay={() => undefined} />);
  r.click([...r.host.querySelectorAll('.stab')].find((t) => t.textContent?.trim() === 'Actions') ?? null);
  const chip = (name: string) => {
    const el = [...r.host.querySelectorAll('.action-chip')].find((e) => txt(e.querySelector('.action-chip-name')) === name);
    if (!el) throw new Error(`no action chip for ${name}`);
    return el as HTMLElement;
  };
  const popup = (name: string) => {
    r.click(chip(name));
    const pop = r.host.querySelector('.picker.info-modal') as HTMLElement | null;
    if (!pop) throw new Error(`no popup for ${name}`);
    return pop;
  };
  return { ...r, chip, popup };
}
const glyphs = (el: Element | null | undefined) => [...(el?.querySelectorAll('.pf2-action') ?? [])].map((g) => g.getAttribute('aria-label'));

/*
 * Card step 9 (docs/card-design.md section 9 row 9): the same six popups, re-pointed at the record's
 * 'mine' card. The page's use lines now reach the popup once each, the page's
 * printed glyph stays and the marked cost is our marked glyph beside it, and a record marker's note is an `actionMark` line in the ours box
 * ([data-ours]) instead of living only in the row star's tooltip. test/card-action.test.tsx holds the
 * step's full refuter set.
 */
/** The card a chip opens (page lane: .ast-modal.card-mine). */
const cardOf = (r: ReturnType<typeof actionsOf>, name: string) => {
  r.click(r.chip(name));
  const card = r.host.querySelector('.ast-modal.card-mine') as HTMLElement | null;
  if (!card) throw new Error(`no card for ${name}`);
  return card;
};
const headGlyph = (card: Element) => [...card.querySelectorAll('.ast-head .ast-ag.head')].map((g) => g.getAttribute('title'));
// batch card premise: action-2292 "Trigger An ally is about to use an action that requires a skill check or attack roll"
describe('the Main-tab action popup, opened from its chip — the record\'s mine card (step 9)', () => {
  // batch card premise: feat-4458 "Frequency once per day"
  it('Halfling Luck (a feat action, now on its page tree): free-action glyph, both traits, Frequency and Trigger once each, then the rule', () => {
    const r = actionsOf(halfling());
    // batch card premise: feat-4458 "Frequency once per day"
    expect(txt(r.chip('Halfling Luck').querySelector('.ff-uses-n')), 'the use counter rides the chip').toBe('1/1');
    const pop = cardOf(r, 'Halfling Luck');
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    expect(headGlyph(pop)).toEqual(['Free Action']);
    expect(txt(pop.querySelector('.ast-name'))).toBe('Halfling Luck');
    expect(pop.querySelector('.ast-head .ast-controls .pin-star'), 'the action pin (PinToggle) is a header action').not.toBeNull();
    expect([...pop.querySelectorAll('.ast-traits .ast-tr')].map((t) => txt(t))).toEqual(['Fortune', 'Halfling']);
    const body = pop.querySelector('.ast-pop > .ast-body') as HTMLElement;
    // batch card premise: feat-4458 "Trigger You fail a skill check or saving throw"
    expect([...body.children].map((k) => [k.tagName.toLowerCase(), k.className, txt(k)])).toEqual([
      ['p', 'card-dim', 'Source Player Core pg. 60'],
      ['p', 'card-use', 'Frequency once per day'],
      ['p', 'card-use', 'Trigger You fail a skill check or saving throw'],
      ['hr', 'ast-hr', ''],
      [
        'p',
        '',
        "Your happy-go-lucky nature makes it seem like misfortune avoids you, and to an extent, that might even be true. You can reroll the triggering check, but you must use the new result, even if it's worse.",
      ],
    ]);
    // batch card premise: feat-4458 "Frequency once per day"
    expect(count(txt(pop), 'Frequency')).toBe(1);
    expect(count(txt(pop), 'Trigger')).toBe(1);
  });

  // batch card premise: action-2292 "Requirements The ally is willing to accept your aid"
  it('Aid (an activity, on its page tree): reaction glyph, no trait row, the page prose and degrees — and its Trigger and Requirements once each', () => {
    const pop = cardOf(actionsOf(halfling()), 'Aid');
    // batch card premise: action-2292 "Requirements The ally is willing to accept your aid"
    expect(headGlyph(pop)).toEqual(['Reaction']);
    expect(pop.querySelector('.ast-traits')).toBeNull();
    const tree = pop.querySelector('.ast-pop > .ast-body') as HTMLElement;
    expect(txt(tree.querySelector('p:not(.card-dim):not(.card-use)'))).toBe(
      "You try to help your ally with a task. To use this reaction, you must first prepare to help, usually by using an action during your turn. You must explain to the GM exactly how you're trying to help, and they determine whether you can Aid your ally.",
    );
    // batch card premise: action-2292 "Trigger An ally is about to use an action that requires a skill check or attack roll"
    expect([...tree.querySelectorAll('.ast-ds .ast-ds-lbl')].map((l) => txt(l))).toEqual(['Critical Success', 'Success', 'Critical Failure']);
    expect(count(txt(pop), 'Trigger')).toBe(1);
    expect(count(txt(pop), 'Requirements')).toBe(1);
  });

  // batch card premise: action-2377 "You Stride, then attempt a DC 30 Athletics check to jump vertically"
  it('a mark whose value IS a cost (Quick Jump on High Jump): one-action glyph on the chip AND the card header; the note is an actionMark line in the ours box', () => {
    const r = actionsOf(halfling());
    const ch = r.chip('High Jump');
    // batch card premise: action-2377 "You Stride, then attempt a DC 30 Athletics check to jump vertically"
    expect(glyphs(ch.querySelector('.action-cost'))).toEqual(['One action']);
    expect(ch.querySelector('.action-mark-val'), 'no parenthetical second cost').toBeNull();
    const note = 'Quick Jump: you can High Jump as a single action instead of 2, and you do not need to Stride 10 feet first.';
    expect(ch.querySelector('.action-mark')?.getAttribute('title')).toBe(note);
    const pop = cardOf(r, 'High Jump');
    // The page's printed glyph stays as printed; the marked cost is OUR glyph beside it, marked data-ours.
    // batch card premise: action-2377 "You Stride, then attempt a DC 30 Athletics check to jump vertically"
    expect(headGlyph(pop)).toEqual(['Two Actions']);
    // batch card premise: feat-5196 "You can use High Jump and Long Jump as a single action instead of 2 actions"
    expect(glyphs(pop.querySelector('.ast-head .card-ours-cost[data-ours]'))).toEqual(['One action']);
    expect(txt(pop.querySelector('.ast-name'))).toBe('High Jump');
    expect(txt(pop.querySelector('.ast-head .action-skill'))).toBe('Athletics');
    expect(txt(pop.querySelector('[data-ours] [data-ours-kind="actionMark"]'))).toBe(note);
    // batch card premise: action-2377 "You Stride, then attempt a DC 30 Athletics check to jump vertically"
    expect(pop.querySelector('.action-mark, .sit-star')).toBeNull();
    expect(txt(pop.querySelector('.ast-pop > .ast-body > p:not(.card-dim)'))).toContain('You Stride, then attempt a DC 30 Athletics check to jump vertically.');
  });

  // batch card premise: action-2377 "You Stride, then attempt a DC 30 Athletics check to jump vertically"
  it('without Quick Jump the same chip and card keep the printed two actions and no mark', () => {
    const r = actionsOf({ ...build('fighter', 2), inventory: SWORD });
    // batch card premise: action-2377 "You Stride, then attempt a DC 30 Athletics check to jump vertically"
    expect(glyphs(r.chip('High Jump').querySelector('.action-cost'))).toEqual(['Two actions']);
    expect(r.chip('High Jump').querySelector('.action-mark')).toBeNull();
    const pop = cardOf(r, 'High Jump');
    expect(headGlyph(pop)).toEqual(['Two Actions']);
    expect(pop.querySelector('[data-ours-kind="actionMark"]')).toBeNull();
  });

  // batch card premise: feat-3166 "You Leap and discharge your firearm to add a +10-foot status bonus to the distance traveled"
  it('a mark whose value is NOT a cost (Black Powder Boost on Leap): "(+10 feet)" and the star on the chip; the card header shows the chip\'s one action and names the mark in the ours box', () => {
    const r = actionsOf(boosted());
    const ch = r.chip('Leap');
    // batch card premise: feat-3166 "You Leap and discharge your firearm to add a +10-foot status bonus to the distance traveled"
    expect(glyphs(ch.querySelector('.action-cost'))).toEqual(['One action']);
    expect(txt(ch.querySelector('.action-mark-val'))).toBe('(+10 feet)');
    const pop = cardOf(r, 'Leap');
    // The page's printed "Single Action" is the chip's ◆, so the header draws no glyph of ours.
    // batch card premise: action-2298 "You take a short horizontal or vertical jump"
    expect(headGlyph(pop)).toEqual(['Single Action']);
    expect(pop.querySelector('.card-ours-cost')).toBeNull();
    // batch card premise: feat-3166 "You Leap and discharge your firearm to add a +10-foot status bonus to the distance traveled"
    expect(txt(pop.querySelector('[data-ours] [data-ours-kind="actionMark"] .card-ours-from'))).toBe('Black Powder Boost:');
    expect([...pop.querySelectorAll('.ast-pop > .ast-body p, .ast-pop > .ast-body li')].filter((p) => !p.closest('[data-ours]')).some((p) => txt(p).includes('Black Powder Boost'))).toBe(false);
    expect([...pop.querySelectorAll('.ast-body li strong')].map((s) => txt(s))).toEqual(['Horizontal Jump', 'Vertical Jump']);
  });

  // batch card premise: action-2292 "Requirements The ally is willing to accept your aid"
  it('the card closes from its close button and leaves the sheet behind it', () => {
    const r = actionsOf(halfling());
    cardOf(r, 'Aid');
    // batch card premise: action-2292 "Requirements The ally is willing to accept your aid"
    r.click(r.host.querySelector('.ast-modal.card-mine .picker-close'));
    expect(r.host.querySelector('.picker-overlay')).toBeNull();
    expect(r.chip('Aid')).toBeTruthy();
  });
});
