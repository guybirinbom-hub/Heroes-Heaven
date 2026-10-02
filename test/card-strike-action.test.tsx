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
 * Page trees: the activity popups render the Archives page through DescBody (astKey 'actions'). jsdom
 * cannot fetch public/ast, so the TRACKED public/ast/actions.json.gz is served for the three actions
 * opened here and the cache primed, which is the state the app is in once the bucket has loaded. Every
 * other bucket 404s; feat actions carry no astKey and render their description string either way.
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
  const served: Record<string, Record<string, AstNode>> = {
    actions: { aid: actions.aid, leap: actions.leap, 'high-jump': actions['high-jump'] },
  };
  globalThis.fetch = (async (input: unknown) => {
    const m = /ast\/([A-Za-z0-9_-]+)\.json$/.exec(String(input));
    return m && served[m[1]]
      ? new Response(JSON.stringify(served[m[1]]), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('', { status: 404 });
  }) as typeof fetch;
  await loadBucketAst('actions');
  await loadBucketAst('feats');
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

describe('StrikeDetailModal', () => {
  it('a level-1 fighter\'s longsword: name, PinStar, Attack bonus and Damage as derived, the item text, and NO crit block', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'i-sword');
    const { host } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => undefined} />);
    const pop = host.querySelector('.picker.info-modal') as HTMLElement;
    expect(txt(pop.querySelector('.picker-head .info-title'))).toBe('Longsword');
    expect(pop.querySelector('.picker-head .info-star'), 'PinStar is in the header').not.toBeNull();
    const stats = [...pop.querySelectorAll('.strike-detail-stat')].map((b) => [txt(b.querySelector('.sds-label')), txt(b.querySelector('.sds-value'))]);
    expect(stats).toEqual([
      ['Attack bonus', formatMod(s.attack[0])],
      ['Damage', s.damage],
    ]);
    // The numbers the derive measured on 2026-10-02 for this build, so a silent engine change shows here too.
    expect(stats.map(([, v]) => v)).toEqual(['+5', '1d8 S']);
    // Without onOpenStat the two stats are inert: no .clickable, no "show calculation" hint.
    expect(pop.querySelectorAll('.strike-detail-stat.clickable')).toHaveLength(0);
    expect(pop.querySelector('.sds-hint')).toBeNull();
    expect(pop.querySelector('.strike-detail-crit'), 'a level-1 fighter has no crit specialization').toBeNull();
    expect(txt(pop.querySelector('.info-body > div:last-child'))).toBe(LONGSWORD_TEXT);
    expect(txt(pop)).not.toContain('Critical specialization');
  });

  it('at level 5 (Fighter Weapon Mastery) the sword group\'s crit specialization shows above the text', () => {
    const c = fighter(5);
    const s = strikeOf(c, 'i-sword');
    const { host } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => undefined} />);
    const crit = host.querySelector('.strike-detail-crit') as HTMLElement;
    expect(crit).not.toBeNull();
    expect(txt(crit.querySelector('.sds-label'))).toBe('Critical specialization · Sword');
    expect(txt(crit.querySelector('.sd-critspec-text'))).toBe('The target is off-guard until the start of your next turn.');
    // Order in the body: stats, crit block, then the item's own text.
    const kids = [...host.querySelector('.info-body')!.children].map((k) => k.className);
    expect(kids).toEqual(['strike-detail-stats', 'strike-detail-crit', 'sd-desc']);
    expect(txt(host.querySelector('.info-body')!.lastElementChild)).toBe(LONGSWORD_TEXT);
  });

  it('with onOpenStat, each stat is a button into its breakdown, keyed by the strike', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'i-sword');
    const opened: StatRef[] = [];
    const { host, click } = mount(
      <StrikeDetailModal strike={s} character={c} content={db} onOpenStat={(r) => opened.push(r)} onClose={() => undefined} />,
    );
    const buttons = [...host.querySelectorAll('.strike-detail-stat.clickable')];
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => txt(b.querySelector('.sds-hint')))).toEqual(['show calculation', 'show calculation']);
    click(buttons[0]);
    click(buttons[1]);
    expect(opened).toEqual([
      { kind: 'strikeAttack', instanceId: 'i-sword' },
      { kind: 'strikeDamage', instanceId: 'i-sword' },
    ]);
  });

  it('the Fist has no item, so it shows the built-in blurb', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'fist');
    const { host } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => undefined} />);
    expect(txt(host.querySelector('.info-title'))).toBe('Fist');
    expect(txt(host.querySelector('.info-body')!.lastElementChild)).toBe(
      'An unarmed Strike with your fist — every creature can make unarmed attacks. It uses your unarmed proficiency, and Handwraps of Mighty Blows can etch potency, striking, and property runes onto it.',
    );
  });

  it('the PinStar pins {title, key: items, description}; the overlay closes, the popup body does not', () => {
    const c = fighter(1);
    const s = strikeOf(c, 'i-sword');
    let closed = 0;
    const { host, click } = mount(<StrikeDetailModal strike={s} character={c} content={db} onClose={() => (closed += 1)} />);
    click(host.querySelector('.info-star'));
    expect(toggled.map((n) => [n.title, n.key, n.description])).toEqual([['Longsword', 'items', LONGSWORD_TEXT]]);
    expect(closed, 'the star does not close the popup').toBe(0);
    click(host.querySelector('.info-body'));
    expect(closed).toBe(0);
    click(host.querySelector('.picker-close'));
    expect(closed).toBe(1);
    click(host.querySelector('.picker-overlay'));
    expect(closed).toBe(2);
  });

  it('through MainTab: the Strikes sub-tab\'s name button opens this popup for that strike', () => {
    const c = fighter(5);
    const { host, click } = mount(<MainTab character={c} content={db} onPlay={() => undefined} />);
    click([...host.querySelectorAll('.stab')].find((t) => t.textContent?.trim() === 'Strikes') ?? null);
    expect(host.querySelector('.picker.info-modal')).toBeNull();
    click([...host.querySelectorAll('.strike-name')].find((b) => txt(b).startsWith('Longsword')) ?? null);
    const pop = host.querySelector('.picker.info-modal') as HTMLElement;
    expect(txt(pop.querySelector('.info-title'))).toBe('Longsword');
    expect(txt(pop.querySelector('.strike-detail-crit .sds-label'))).toBe('Critical specialization · Sword');
    expect(txt(pop.querySelector('.info-body')!.lastElementChild)).toBe(LONGSWORD_TEXT);
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

describe('the Main-tab action popup, opened from its chip', () => {
  it('Halfling Luck (a feat action, on its description string): free-action glyph, both traits, Frequency and Trigger once each, then the rule', () => {
    const { chip, popup } = actionsOf(halfling());
    expect(txt(chip('Halfling Luck').querySelector('.ff-uses-n')), 'the use counter rides the chip').toBe('1/1');
    const pop = popup('Halfling Luck');
    expect(glyphs(pop.querySelector('.picker-head .action-detail-cost'))).toEqual(['Free action']);
    expect(txt(pop.querySelector('.info-title'))).toBe('Halfling Luck');
    expect(pop.querySelector('.picker-head .pin-star'), 'the action pin (Star) is in the header').not.toBeNull();
    expect([...pop.querySelectorAll('.action-detail-traits .strike-trait')].map((t) => txt(t))).toEqual(['fortune', 'halfling']);
    const desc = pop.querySelector('.action-detail-desc') as HTMLElement;
    expect(desc.querySelector('.ast-body'), 'a feat action has no page tree here').toBeNull();
    expect([...desc.children].map((k) => [k.tagName.toLowerCase(), txt(k)])).toEqual([
      ['p', 'Frequency once per day'],
      ['p', 'Trigger You fail a skill check or saving throw.'],
      ['hr', ''],
      [
        'p',
        "Your happy-go-lucky nature makes it seem like misfortune avoids you, and to an extent, that might even be true. You can reroll the triggering check, but you must use the new result, even if it's worse.",
      ],
    ]);
    expect(count(txt(pop), 'Frequency')).toBe(1);
    expect(count(txt(pop), 'Trigger')).toBe(1);
  });

  it('Aid (an activity, on its page tree): reaction glyph, no trait row, the page prose and degrees — and TODAY no Trigger or Requirements line', () => {
    // hideMeta drops the page's header lines, and the action popup prints no stat rows of its own, so
    // Aid's printed Trigger and Requirements reach no part of this popup today. Step 9's refuter is
    // "Aid and Shield Block show Trigger and Requirements once"; it flips the two zero counts below with
    // a `// batch card premise: action-… "Trigger"` line.
    const pop = actionsOf(halfling()).popup('Aid');
    expect(glyphs(pop.querySelector('.action-detail-cost'))).toEqual(['Reaction']);
    expect(pop.querySelector('.action-detail-traits')).toBeNull();
    const tree = pop.querySelector('.action-detail-desc > .ast-body.ast-embed') as HTMLElement;
    expect(tree, 'the popup renders the page tree, not the fallback string').not.toBeNull();
    expect(txt(tree.querySelector('p'))).toBe(
      "You try to help your ally with a task. To use this reaction, you must first prepare to help, usually by using an action during your turn. You must explain to the GM exactly how you're trying to help, and they determine whether you can Aid your ally.",
    );
    expect([...tree.querySelectorAll('.ast-ds .ast-ds-lbl')].map((l) => txt(l))).toEqual(['Critical Success', 'Success', 'Critical Failure']);
    expect(count(txt(pop), 'Trigger')).toBe(0);
    expect(count(txt(pop), 'Requirements')).toBe(0);
  });

  it('a mark whose value IS a cost (Quick Jump on High Jump): one-action glyph on the chip AND the popup; the note is only the star\'s tooltip', () => {
    const { chip, popup } = actionsOf(halfling());
    const ch = chip('High Jump');
    expect(glyphs(ch.querySelector('.action-cost'))).toEqual(['One action']);
    expect(ch.querySelector('.action-mark-val'), 'no parenthetical second cost').toBeNull();
    const note = 'Quick Jump: you can High Jump as a single action instead of 2, and you do not need to Stride 10 feet first.';
    expect(ch.querySelector('.action-mark')?.getAttribute('title')).toBe(note);
    expect(ch.querySelector('.sit-star')?.getAttribute('title')).toBe(note);
    const pop = popup('High Jump');
    expect(glyphs(pop.querySelector('.action-detail-cost'))).toEqual(['One action']);
    expect(txt(pop.querySelector('.info-title'))).toBe('High JumpAthletics');
    // TODAY the marked cost carries no note inside the popup (spec section 4, kind `actionMark`).
    expect(txt(pop)).not.toContain('Quick Jump');
    expect(pop.querySelector('.action-mark, .sit-star, [data-ours]')).toBeNull();
    expect(txt(pop.querySelector('.action-detail-desc .ast-body p'))).toContain('You Stride, then attempt a DC 30 Athletics check to jump vertically.');
  });

  it('without Quick Jump the same chip and popup keep the printed two actions and no mark', () => {
    const { chip, popup } = actionsOf({ ...build('fighter', 2), inventory: SWORD });
    expect(glyphs(chip('High Jump').querySelector('.action-cost'))).toEqual(['Two actions']);
    expect(chip('High Jump').querySelector('.action-mark')).toBeNull();
    expect(glyphs(popup('High Jump').querySelector('.action-detail-cost'))).toEqual(['Two actions']);
  });

  it('a mark whose value is NOT a cost (Black Powder Boost on Leap): "(+10 feet)" and the star on the chip; the popup is the plain action', () => {
    const { chip, popup } = actionsOf(boosted());
    const ch = chip('Leap');
    expect(glyphs(ch.querySelector('.action-cost'))).toEqual(['One action']);
    expect(txt(ch.querySelector('.action-mark-val'))).toBe('(+10 feet)');
    expect(ch.querySelector('.sit-star')?.getAttribute('title')).toMatch(/^Black Powder Boost: /);
    const pop = popup('Leap');
    expect(glyphs(pop.querySelector('.action-detail-cost'))).toEqual(['One action']);
    expect(txt(pop)).not.toContain('+10 feet');
    expect(txt(pop)).not.toContain('Black Powder Boost');
    expect([...pop.querySelectorAll('.action-detail-desc .ast-body li strong')].map((s) => txt(s))).toEqual(['Horizontal Jump', 'Vertical Jump']);
  });

  it('the popup closes from its close button and leaves the sheet behind it', () => {
    const r = actionsOf(halfling());
    r.popup('Aid');
    r.click(r.host.querySelector('.picker.info-modal .picker-close'));
    expect(r.host.querySelector('.picker.info-modal')).toBeNull();
    expect(r.chip('Aid')).toBeTruthy();
  });
});
