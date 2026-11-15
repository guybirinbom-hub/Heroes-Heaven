// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP5: "Pick from any list" (`choice.anyList`; plan work/tweaks-phase2-notes/plan.md WP5, C5, C18,
 * C20-C22, C41, C45). Synthetic characters only.
 *
 *   - `slotRefusal` returns EVERY refusing rule with its words; `slotTakes` (so `fitsSlot`) takes a feat only when
 *     every refusal is liftable AND lifted by a live block — a 3rd-level general feat in a 2nd-level class slot with
 *     only `list` lifted stays refused; a mythic or impulse place's rule is never liftable;
 *   - an allowed pick counts and shows no "Not valid for this slot"; paused, the note returns and the pick stays;
 *   - two rules → two blocks in ONE write with the pick; a paused block is switched back on, never listed twice;
 *   - `picksLosingSlot` per slot toggle with an allowed pick (C22, the decision pinned);
 *   - pick-a-feat: counts while live, dropped by the engine while paused, the stored answer byte-equal;
 *   - the three bonus feat pickers: the greyed rows' words, the pick reaches Character.feats live AND paused (the
 *     engine never re-checks them), and the Versatile Human picker in the Builder ("Search every feat", "Allow here");
 *   - the slot picker in the Builder: "Search every feat", "Allow here", the card's live mark; and the Tweaks page
 *     alone creates the tweak.
 */
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, hero, mountTweaks, openMenu, pick as pickPart, press } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { anyListLifts } from '../src/rules/blocks/active';
import { blockKind, STILL_TO_ADD } from '../src/rules/blocks/registry';
import { writeChoiceTweak } from '../src/rules/blocks/write';
import { eligibleFeatsForSlot, fitsSlot, moveTargetFor, picksLosingSlot, slotBookRefusals, slotRefusal, withFeat } from '../src/rules/featSlots';
import { BONUS_SKILL_FEAT_SPEC, FEAT_PICK_GRANTS, HERITAGE_FEAT_SPEC, UMT_FEAT_SPEC, pickRefusal, pickableFeats } from '../src/rules/featPickGrants';
import { liftedAll } from '../src/rules/choiceRefusal';
import { anyListDrafts } from '../src/builder/tweaks/anyList';
import type { BuildOverrides, Character, Feat } from '../src/rules/types';

const db = content();
const noop = () => undefined;
let seq = 0;
const list = (record: string, rule: string, on = true) => ({ id: `t${++seq}_wp5${String(seq).padStart(2, '0')}`, kind: 'choice.anyList', v: 1, record, rule, ...(on ? {} : { on: false }) });
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const featIds = (ch: Character) => (ch.feats ?? []).map((f) => f.featId);
const slot = (level: number, category: string, idx = 0) => ({ level, category: category as Feat['category'], idx });

/* Feats chosen from the data, so a renamed record fails here rather than silently testing nothing. */
const byLevel = (pred: (f: Feat) => boolean) =>
  Object.values(db.feats)
    .filter((f) => !db.duplicateIds?.has(f.id) && f.onlyAtLevel == null && pred(f))
    .sort((a, b) => a.name.localeCompare(b.name))[0]!;
const GENERAL3 = byLevel((f) => f.category === 'general' && f.level === 3 &&!f.traits.includes('archetype'));
const FIGHTER6 = byLevel((f) => f.category === 'class' && f.level === 6 && f.traits.includes('fighter') && !f.traits.includes('archetype'));
const SKILL2 = byLevel((f) => f.category === 'skill' && f.level === 2 && f.source?.book === 'Pathfinder Player Core');
const WIZARD2 = byLevel((f) => f.category === 'class' && f.level === 2 && f.traits.includes('wizard') && !f.traits.includes('archetype'));

/** A level-3 fighter holding `pick` in its 2nd-level class slot. */
const F3 = (pick: string, ...blocks: object[]) => hero(db, 'fighter', 3, ov(...blocks), { featPicks: { '2:class:0': pick } });

describe('slotRefusal: every rule, in the player\'s words', () => {
  it('a general feat in a class slot, another ancestry\'s feat, a feat above the slot\'s level', () => {
    const b = F3('toughness');
    expect(slotRefusal(b, db, slot(2, 'class'))(db.feats.toughness)).toEqual([{ rule: 'list', words: 'A general feat, not a class feat', liftable: true }]);
    expect(slotRefusal(b, db, slot(1, 'ancestry'))(db.feats['elven-lore'])).toEqual([{ rule: 'list', words: 'An Elf feat, not a Human feat', liftable: true }]);
    expect(slotRefusal(b, db, slot(2, 'class'))(FIGHTER6)).toEqual([{ rule: 'level', words: `A level 6 feat: this place takes level 2 or lower`, liftable: true }]);
    // Two rules: a 3rd-level general feat in a 2nd-level class slot.
    expect(slotRefusal(b, db, slot(2, 'class'))(GENERAL3).map((r) => r.rule)).toEqual(['level', 'list']);
  });
  it('the cap and a mythic or impulse place\'s own rule are never liftable', () => {
    const own = { ...F3('toughness'), featPicks: { '3:general:0': 'toughness' } };
    expect(slotRefusal(own, db, slot(3, 'general'))(db.feats.toughness)).toEqual([]); // its own slot is not "another"
    const b = { ...F3('toughness'), featPicks: { '2:class:0': 'toughness', '3:general:0': 'toughness' } };
    expect(slotRefusal(b, db, slot(3, 'general'))(db.feats.toughness).map((r) => r.rule)).toEqual(['taken']);
    const taken = slotRefusal(b, db, slot(3, 'skill'))(db.feats.toughness);
    expect(taken.find((r) => r.rule === 'taken')?.liftable).toBe(false);
    const myth = slotRefusal({ ...F3('fleet'), mythicEnabled: true }, db, slot(2, 'mythic'))(db.feats.toughness);
    expect(myth).toEqual([{ rule: 'slotRule', words: 'Not a feat this mythic place takes', liftable: false }]);
    const all = new Set(['list', 'level', 'onlyAtLevel']);
    expect(liftedAll(myth, all), 'no "Pick from any list" lifts a mythic place').toBe(false);
    // Never liftable even if a set named the rule (a hand-edited save, a future rule): `liftable` decides, not the set.
    expect(liftedAll(myth, new Set(['slotRule'])), 'a slotRule is never lifted').toBe(false);
    expect(liftedAll(taken, new Set(['taken', 'list', 'level'])), 'the cap is never lifted here (WP8)').toBe(false);
    const kin = hero(db, 'kineticist', 1, ov());
    const imp = slotRefusal(kin, db, slot(1, 'impulse'))(db.feats.toughness);
    expect(imp.every((r) => !r.liftable) && imp.some((r) => r.rule === 'slotRule')).toBe(true);
  });
});

describe('a live allow lets the slot take the feat; paused, the book returns', () => {
  it('a general feat in a class slot, another ancestry\'s feat, a 6th-level feat in a 2nd-level slot: each counts, no "Not valid"', () => {
    const cases: [BuildState, string][] = [
      [F3('toughness', list('toughness', 'list')), '2:class:0'],
      [hero(db, 'fighter', 3, ov(list('elven-lore', 'list')), { featPicks: { '1:ancestry:0': 'elven-lore' } }), '1:ancestry:0'],
      [F3(FIGHTER6.id, list(FIGHTER6.id, 'level')), '2:class:0'],
    ];
    for (const [b, key] of cases) {
      const id = b.featPicks[key];
      expect(fitsSlot(b, db, key, key), `${id} fits while live`).toBe(true);
      expect(featIds(built(b))).toContain(id);
      expect(slotBookRefusals(b, db, key)!.length, 'the book still refuses it (the mark reads this)').toBeGreaterThan(0);
      const paused = { ...b, overrides: ov(...(b.overrides!.blocks as object[]).map((x) => ({ ...x, on: false }))) };
      expect(fitsSlot(paused, db, key, key), `${id} paused: not valid again`).toBe(false);
      expect(paused.featPicks).toEqual(b.featPicks);
      expect(fitsSlot(off(b), db, key, key), `${id} Tweaks off: not valid`).toBe(false);
    }
  });
  it('a 3rd-level general feat in a 2nd-level class slot with only `list` lifted stays refused; both rules lifted, it fits', () => {
    expect(fitsSlot(F3(GENERAL3.id, list(GENERAL3.id, 'list')), db, '2:class:0', '2:class:0')).toBe(false);
    expect(fitsSlot(F3(GENERAL3.id, list(GENERAL3.id, 'level')), db, '2:class:0', '2:class:0')).toBe(false);
    expect(fitsSlot(F3(GENERAL3.id, list(GENERAL3.id, 'list'), list(GENERAL3.id, 'level')), db, '2:class:0', '2:class:0')).toBe(true);
  });
  it('the slot picker offers a lifted feat; another feat\'s allow lifts nothing', () => {
    const b = hero(db, 'fighter', 3, ov(list('toughness', 'list')));
    expect(eligibleFeatsForSlot(b, db, slot(2, 'class')).some((f) => f.id === 'toughness')).toBe(true);
    expect(eligibleFeatsForSlot(hero(db, 'fighter', 3, ov(list('fleet', 'list'))), db, slot(2, 'class')).some((f) => f.id === 'toughness')).toBe(false);
  });
  it('"Move to slot" can place an allowed feat with no slot, and never while paused', () => {
    const b = hero(db, 'fighter', 3, ov(list('toughness', 'list')), { featPicks: { '2:class:5': 'toughness' } });
    expect(moveTargetFor(b, db, '2:class:5')).toBe('2:class:0');
    const paused = hero(db, 'fighter', 3, ov(list('toughness', 'list', false)), { featPicks: { '2:class:5': 'toughness' } });
    expect(moveTargetFor(paused, db, '2:class:5')).toBeNull();
  });
});

describe('two rules → two blocks in ONE write; a paused block switched back on', () => {
  it('anyListDrafts + writeChoiceTweak: both blocks and the pick in one returned build', () => {
    const b = hero(db, 'fighter', 3, ov());
    const drafts = anyListDrafts(b, GENERAL3.id, ['level', 'list']);
    expect(drafts).toHaveLength(2);
    const r = writeChoiceTweak(b, drafts, (x) => withFeat(x, '2:class:0', GENERAL3.id));
    expect(r.refused).toBeUndefined();
    expect(r.keys).toHaveLength(2);
    expect(r.build.featPicks['2:class:0']).toBe(GENERAL3.id);
    expect([...(anyListLifts(r.build).get(GENERAL3.id) ?? [])].sort()).toEqual(['level', 'list']);
    expect(fitsSlot(r.build, db, '2:class:0', '2:class:0')).toBe(true);
  });
  it('a paused block for the same rule is switched back on (one block, not two); a live one needs no draft', () => {
    const paused = hero(db, 'fighter', 3, ov(list('toughness', 'list', false)));
    const d = anyListDrafts(paused, 'toughness', ['list']);
    expect(d).toEqual([{ key: expect.stringMatching(/^blocks:/), kind: 'choice.anyList', on: true }]);
    const r = writeChoiceTweak(paused, d);
    expect((r.build.overrides!.blocks as unknown[]).length).toBe(1);
    expect(anyListDrafts(r.build, 'toughness', ['list'])).toEqual([]);
  });
});

describe('picksLosingSlot with an allowed pick, per slot toggle (C22: the decision pinned)', () => {
  // Toughness (a general feat) in the 2nd-level class slot, its `list` rule lifted. Turning a toggle off keeps that
  // slot, which still takes it: nothing is named for it. The second class's slot under Dual Class is the one corner:
  // the slot goes, so its pick is named — exactly as a book pick there is.
  const withToughness = (more: Partial<BuildState>) => hero(db, 'fighter', 4, ov(list('toughness', 'list')), { featPicks: { '2:class:0': 'toughness' }, ...more });
  it('Free Archetype, Ancestry Paragon, Mythic off: the allowed pick keeps its slot', () => {
    for (const [name, on, offPatch] of [
      ['Free Archetype', { variantRules: { freeArchetype: true } }, { variantRules: {} }],
      ['Ancestry Paragon', { variantRules: { ancestryParagon: true } }, { variantRules: {} }],
      ['Mythic', { mythicEnabled: true }, { mythicEnabled: false }],
    ] as const) {
      const prev = withToughness(on as Partial<BuildState>);
      expect(picksLosingSlot(prev, { ...prev, ...offPatch } as BuildState, db), name).toEqual([]);
    }
  });
  it('Dual Class off: the allowed pick in the first class slot stays; one in the second class slot is named', () => {
    const prev = withToughness({ variantRules: { dualClass: true }, classId2: 'rogue', featPicks: { '2:class:0': 'toughness', '2:class:1': 'fleet' } });
    const next = { ...prev, variantRules: {}, classId2: null } as BuildState;
    const lost = picksLosingSlot(prev, next, db).map(([k]) => k);
    expect(lost).not.toContain('2:class:0');
  });
  it('paused: the book decides again (the pick never fitted, so the toggle does not name it either)', () => {
    const prev = hero(db, 'fighter', 4, ov(list('toughness', 'list', false)), { featPicks: { '2:class:0': 'toughness' }, variantRules: { freeArchetype: true } });
    expect(picksLosingSlot(prev, { ...prev, variantRules: {} }, db)).toEqual([]);
  });
});

describe('pick-a-feat: the engine drop honours a live allow (the gated seam)', () => {
  // Ancestral Paragon (a general feat that picks a 1st-level ancestry feat) answered with an elf feat on a human.
  const PARAGON = (...blocks: object[]) =>
    hero(db, 'fighter', 5, ov(...blocks), { featPicks: { '3:general:0': 'ancestral-paragon' }, pickFeatChoices: { '3:general:0': 'elven-lore' } });
  it('counts while live; dropped while paused or switched off; the stored answer byte-equal', () => {
    expect(featIds(built(PARAGON())), 'no tweak: dropped (today)').not.toContain('elven-lore');
    const live = PARAGON(list('elven-lore', 'list'));
    expect(featIds(built(live))).toContain('elven-lore');
    expect(pickableFeats(FEAT_PICK_GRANTS['ancestral-paragon'], live, db).some((f) => f.id === 'elven-lore')).toBe(true);
    for (const b of [PARAGON(list('elven-lore', 'list', false)), off(live)]) {
      expect(featIds(built(b))).not.toContain('elven-lore');
      expect(b.pickFeatChoices).toEqual(live.pickFeatChoices);
    }
  });
  it('pickRefusal words: list, level, an impulse\'s element (never liftable)', () => {
    const b = hero(db, 'fighter', 5, ov());
    expect(pickRefusal(FEAT_PICK_GRANTS['ancestral-paragon'], b, db)(db.feats['elven-lore'])).toEqual([{ rule: 'list', words: 'An Elf feat, not a Human feat', liftable: true }]);
    expect(pickRefusal(FEAT_PICK_GRANTS['general-training'], b, db)(GENERAL3).map((r) => r.words)).toEqual(['Needs level 1 or lower']);
  });
});

describe('the three bonus feat pickers (picker-only: the engine never re-checks them)', () => {
  it('the greyed rows\' words: "Needs level 1 or lower" (heritage feat, UMT), "A general feat, not a skill feat" (bonus skill feat)', () => {
    const b = hero(db, 'wizard', 3, ov());
    expect(pickRefusal(HERITAGE_FEAT_SPEC, b, db)(SKILL2).map((r) => r.words)).toEqual(['Needs level 1 or lower']);
    expect(pickRefusal(UMT_FEAT_SPEC, b, db)(WIZARD2).map((r) => r.words)).toEqual(['Needs level 1 or lower']);
    expect(pickRefusal(BONUS_SKILL_FEAT_SPEC, b, db)(db.feats.toughness).map((r) => r.words)).toEqual(['A general feat, not a skill feat']);
  });
  it('taken, each reaches Character.feats; paused or off it stays and counts', () => {
    const rogueDed = hero(db, 'fighter', 4, ov(list('toughness', 'list')), { featPicks: { '2:class:0': 'rogue-dedication' }, dedicationSkillFeats: { 'rogue-dedication': 'toughness' } });
    const cases: [BuildState, string][] = [
      [hero(db, 'fighter', 3, ov(list(SKILL2.id, 'level')), { heritageFeatId: SKILL2.id }), SKILL2.id],
      [hero(db, 'wizard', 3, ov(list(WIZARD2.id, 'level')), { subclassId: 'school-of-unified-magical-theory', umtFeatId: WIZARD2.id }), WIZARD2.id],
      [rogueDed, 'toughness'],
    ];
    for (const [b, id] of cases) {
      expect(featIds(built(b)), `${id} live`).toContain(id);
      const paused = { ...b, overrides: ov(...(b.overrides!.blocks as object[]).map((x) => ({ ...x, on: false }))) };
      expect(featIds(built(paused)), `${id} paused`).toContain(id);
      expect(featIds(built(off(b))), `${id} off`).toContain(id);
    }
  });
});

/* ---------------------------------------------------------------- the Builder ---------------------------------- */

const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
const dialogButton = (label: string) => [...(document.querySelector('.confirm-modal')?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) ?? null;
let stops: (() => void)[] = [];
afterEach(async () => {
  for (const s of stops) {
    try {
      s();
    } catch {
      /* gone */
    }
  }
  stops = [];
  await flush();
  for (const n of [...document.body.children]) n.remove();
});
function open(initial: BuildState, page: string) {
  let saved: BuildState | null = null;
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }));
  stops.push(r.stop);
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
  return { r, saved: () => saved };
}
async function save(r: ReturnType<typeof open>['r']) {
  r.click([...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Save changes') ?? null);
  await flush();
  for (let i = 0; i < 4; i++) {
    const anyway = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Save anyway');
    if (!anyway) break;
    r.click(anyway);
    await flush();
  }
}
const overlays = () => [...document.querySelectorAll<HTMLElement>('.picker-overlay, .fsel-overlay, .fsel')];
async function typeSearch(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

describe('the slot picker: "Search every feat" and "Allow here"', () => {
  it('Tweaks off: no reveal; on: default off, then Toughness greyed with its rule and "Allow here" — the card then fits, with the live mark', async () => {
    const { r: r0 } = open(off(hero(db, 'fighter', 3, ov())), '2');
    r0.click(r0.host.querySelector('button.lvl-card.empty[data-ctl-title="Class feat"]'));
    await flush();
    expect(document.querySelector('.tw-reveal'), 'Tweaks off: no reveal').toBeNull();
    r0.stop();
    stops.pop();
    for (const n of [...document.body.children]) n.remove();

    const { r, saved } = open(hero(db, 'fighter', 3, ov()), '2');
    r.click(r.host.querySelector('button.lvl-card.empty[data-ctl-title="Class feat"]'));
    await flush();
    const reveal = document.querySelector<HTMLInputElement>('.tw-reveal input')!;
    expect(reveal.checked, 'default off').toBe(false);
    act(() => reveal.click());
    await flush();
    const search = document.querySelector<HTMLInputElement>('.fsel-results-search input')!;
    await typeSearch(search, 'Toughness');
    const row = [...document.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === 'Toughness')!;
    expect(row, 'Toughness greyed with a button').toBeTruthy();
    expect(row.dataset.breakable).toBe('allow');
    expect(row.querySelector('.picker-why')?.textContent).toBe('A general feat, not a class feat');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('Allow Toughness here?');
    r.click(dialogButton('Allow here'));
    await flush();
    await flush();
    const card = r.host.querySelector<HTMLElement>('button.lvl-card[data-ctl-title="Class feat"][data-ctl-state="picked"]')!.closest('.lvl-slot-wrap')!;
    expect(card.textContent).toContain('Toughness');
    expect(card.querySelector('[data-unfit]'), 'no "Not valid for this slot"').toBeNull();
    expect(card.querySelector('[data-tweak-mark="choice.anyList"][data-tweak-state="live"]')).toBeTruthy();
    await save(r);
    const b = saved()!;
    expect(b.featPicks['2:class:0']).toBe('toughness');
    expect([...(anyListLifts(b).get('toughness') ?? [])]).toEqual(['list']);
  });
  it('paused: the card shows "Tweak paused" and the "Not valid for this slot" note returns', async () => {
    const { r } = open(F3('toughness', list('toughness', 'list', false)), '2');
    await flush();
    const card = r.host.querySelector<HTMLElement>('[data-unfit="2:class:0"]')!.closest('.lvl-slot-wrap')!;
    expect(card.querySelector('[data-tweak-mark="choice.anyList"][data-tweak-state="paused"]')).toBeTruthy();
  });
});

describe('the Versatile Human heritage feat picker: "Search every feat" and "Allow here"', () => {
  it(`a 2nd-level skill feat greyed "Needs level 1 or lower" gets "Allow here"; taken, it is the heritage feat; paused, it shows greyed by name`, async () => {
    const { r, saved } = open(hero(db, 'fighter', 3, ov()), '0');
    await flush();
    const ctl = r.host.querySelector<HTMLElement>('[data-ctl-title="General feat"]')!;
    expect(ctl, 'the heritage feat picker').toBeTruthy();
    r.click(ctl.querySelector('.ss-replace') ?? ctl);
    await flush();
    const reveal = document.querySelector<HTMLInputElement>('.picker-overlay .tw-reveal input')!;
    act(() => reveal.click());
    await flush();
    await typeSearch(document.querySelector<HTMLInputElement>('.picker-overlay input.name-input')!, SKILL2.name);
    const row = [...document.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === SKILL2.name)!;
    expect(row, `${SKILL2.name} greyed`).toBeTruthy();
    expect(row.querySelector('.picker-why')?.textContent).toBe('Needs level 1 or lower');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    r.click(dialogButton('Allow here'));
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.heritageFeatId).toBe(SKILL2.id);
    expect(featIds(built(b))).toContain(SKILL2.id);
    for (const n of [...document.body.children]) n.remove();
    const paused = { ...b, overrides: ov(...(b.overrides!.blocks as object[]).map((x) => ({ ...x, on: false }))) };
    const { r: r2 } = open(paused, '0');
    await flush();
    const ctl2 = r2.host.querySelector<HTMLElement>('[data-ctl-title="General feat"]')!;
    expect(ctl2.textContent, 'the name, never "Choose…"').toContain(SKILL2.name);
  });
});

describe('choice.anyList on the Tweaks page alone: "Pick from any list" → Toughness → the list rule', () => {
  it('the class slot then takes it (fresh character)', async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 3, ov(), { featPicks: { '2:class:0': 'toughness' } }));
    stops.push(t.stop);
    await openMenu(t.host, 'Pick from any list');
    await pickPart(addEditor(t.host)!, 'Feat', 'Toughness');
    await pickPart(addEditor(t.host)!, 'Rule', "The feat place's list");
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect([...(anyListLifts(b).get('toughness') ?? [])]).toEqual(['list']);
    expect(fitsSlot(b, db, '2:class:0', '2:class:0')).toBe(true);
  });
  it('the registry calls it built and applied; no STILL_TO_ADD line', () => {
    expect(blockKind('choice.anyList')?.editor?.built).toBe(true);
    expect(blockKind('choice.anyList')?.applies).toBe('blocks');
    expect(STILL_TO_ADD.some((s) => s.id === 'choice.anyList')).toBe(false);
  });
});
