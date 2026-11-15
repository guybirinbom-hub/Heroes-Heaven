// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP4 FINISH: the pickers the first WP4 job left out (B1-B3) and the checker's later defects (C1-C9),
 * each pinned by a test that fails without its fix. Synthetic characters only.
 *
 *   B1  the granted-feat open spell choice: the reveal, greyed rows with "Take anyway", the mark;
 *   B2  the second class's spell picker and a dedication's book-rank picker (picker-only: the engine never dropped);
 *   B3  a dedication that NAMES its cantrips (Oatia Skysage): the engine's `archetypeCantripAllowed` drop is lifted
 *       by a live `spell` allow (the second gated seam, mutation-proof), and both of its pickers take one anyway;
 *   C1  spell chips: the C45 grey on a stored off-list spell, read against the pool's EFFECTIVE list;
 *   C2  only a RULE grey gets the button (a row greyed for another reason stays plain);
 *   C3  a prepared caster's second copy of an off-list spell goes through the confirm;
 *   C4  a refused write says "Not saved: …";
 *   C5  a greyed read-first row's body stays disabled; its description has its own button;
 *   C7  one look for "the book refuses this stored pick";
 *   C8  the catalog's note says what the registry says.
 * (C6 is in test/phone-builder-css.test.ts, C9 in test/p2-sweep-fixture-fresh.test.ts.)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content, mainCasting } from './_content';
import { renderDom } from './_render';
import { hero } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { PopupSelect } from '../src/builder/shared';
import { BreakableOptionRow } from '../src/builder/tweaks/choiceParts';
import { StoredPickNote } from '../src/builder/tweaks/takeAnyway';
import { buildCharacter, featChoicePrompt, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { allowedInPicker } from '../src/rules/blocks/active';
import { blockKind } from '../src/rules/blocks/registry';
import { readTweaks } from '../src/rules/blocks/stored';
import { CASTER_ARCHETYPES } from '../src/rules/casterArchetypes';
import { openChoiceOptions } from '../src/rules/openChoice';
import { tweaksTurnOffList } from '../src/builder/tweaks/model';
import type { BuildOverrides, Character, ContentDatabase } from '../src/rules/types';

const db = content();
const noop = () => undefined;
let seq = 0;
const allow = (picker: string, record: string, rest: Record<string, unknown> = {}, on = true) => ({
  id: `t${++seq}_wf${String(seq).padStart(3, '0')}`,
  kind: 'choice.allowAnywayAnyPicker',
  v: 1,
  picker,
  record,
  ...rest,
  ...(on ? {} : { on: false }),
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState, d: ContentDatabase = db): Character => buildCharacter(b, contentFor(d, b));
const ids = (xs: unknown[] | undefined) => (xs ?? []).map((s) => (typeof s === 'string' ? s : (s as { spellId: string }).spellId));
const BOOKS = ['Pathfinder Player Core', 'Pathfinder Player Core 2', 'Pathfinder GM Core', 'Pathfinder Monster Core', 'Pathfinder Lost Omens Divine Mysteries'];
const GATEWALKERS = db.feats['oatia-skysage-dedication'].source!.book;

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
function open(initial: BuildState, d: ContentDatabase = db, page = '0') {
  let saved: BuildState | null = null;
  const r = renderDom(createElement(Builder, { content: d, initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }));
  stops.push(r.stop);
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
  return { r, saved: () => saved };
}
type R = ReturnType<typeof open>['r'];
async function save(r: R) {
  r.click([...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Save changes') ?? null);
  await flush();
  for (let i = 0; i < 4; i++) {
    const anyway = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Save anyway');
    if (!anyway) break;
    r.click(anyway);
    await flush();
  }
}
async function takeAnyway(r: R, row: HTMLElement | null) {
  expect(row, 'the greyed row').toBeTruthy();
  r.click(row!.querySelector('button.tw-break-act'));
  await flush();
  r.click(dialogButton('Take anyway'));
  await flush();
  await flush();
}
const overlay = () => document.querySelector<HTMLElement>('.picker-overlay');
async function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}
async function openCtl(r: R, title: string) {
  const ctl = r.host.querySelector<HTMLElement>(`[data-ctl-title="${title}"]`);
  expect(ctl, `control "${title}"`).toBeTruthy();
  r.click(ctl!.querySelector('.ss-replace') ?? ctl);
  await flush();
}
async function revealOn(root: ParentNode) {
  const rv = root.querySelector<HTMLInputElement>('.tw-reveal input');
  expect(rv, 'the reveal').toBeTruthy();
  expect(rv!.checked, 'the reveal starts off').toBe(false);
  act(() => rv!.click());
  await flush();
}
const rowIn = (root: ParentNode | null, name: string) => [...(root?.querySelectorAll<HTMLElement>('.pick-row, .picker-item, button') ?? [])].find((x) => x.querySelector('.picker-name')?.textContent === name) ?? null;
/* The class spell picker (FilterableSelect). */
const fsel = () => document.querySelector<HTMLElement>('.fsel-results-bar')?.closest<HTMLElement>('.fsel-body') ?? null;
async function fselFind(name: string) {
  await typeInto(fsel()!.querySelector<HTMLInputElement>('.fsel-results-search input')!, name);
  return [...fsel()!.querySelectorAll<HTMLElement>('.pick-row')].find((x) => x.querySelector('.picker-name')?.textContent === name) ?? null;
}
async function popSearch(text: string) {
  const input = overlay()?.querySelector<HTMLInputElement>('input.name-input');
  if (input) await typeInto(input, text);
}

/* ---------------------------------------------------------------- B1 ---------------------------------------- */

describe('B1: the granted-feat open spell choice (a record that GRANTS Adapted Cantrip)', () => {
  // A synthetic human heritage that grants Adapted Cantrip — no printed record does, so the granted path is reached
  // only by homebrew or a future record; the engine's open spell grant reads granted answers the same way.
  const HB = { license: 'homebrew', book: 'Tidewater Notes' };
  const her = { id: 'hb-heritage-adapted-human', name: 'Adapted Human (test)', traits: [], ancestryId: 'human', source: HB, grantsFeats: ['adapted-cantrip'] };
  const withHer = { ...db, heritages: { ...db.heritages, [her.id]: her } } as unknown as ContentDatabase;
  const wiz = (blocks: object[] = [], more: Partial<BuildState> = {}) => hero(db, 'wizard', 1, ov(...blocks), { heritageId: her.id, enabledSources: [...BOOKS, HB.book], ...more });
  const title = featChoicePrompt(db.feats['adapted-cantrip'].choice!.prompt, db.feats['adapted-cantrip'].choice!.flag);
  it('the engine: the granted feat is held and its answer reaches the class entry', () => {
    const ch = built(wiz([], { grantedFeatChoices: { 'adapted-cantrip': 'divine-lance' } }), withHer);
    expect(ch.feats.some((f) => f.featId === 'adapted-cantrip' && f.grantedBy === her.id)).toBe(true);
    expect(ids(mainCasting(ch)?.cantrips)).toContain('divine-lance');
  });
  it('Tweaks off: no reveal and no button; Tweaks on: the reveal starts off, a greyed arcane cantrip takes anyway in ONE write', async () => {
    {
      const { r } = open(off(wiz()), withHer, '1');
      await flush();
      await openCtl(r, title);
      expect(overlay()!.querySelector('.tw-reveal')).toBeNull();
      expect(overlay()!.querySelector('[data-breakable]')).toBeNull();
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
    }
    const { r, saved } = open(wiz(), withHer, '1');
    await flush();
    await openCtl(r, title);
    expect(overlay()!.querySelector('[data-breakable]'), 'nothing greyed before the reveal').toBeNull();
    await revealOn(overlay()!);
    await popSearch('Shield');
    // Adapted Cantrip needs ANOTHER tradition: the wizard's own arcane Shield is the rule grey. The row's name carries
    // the open choice's note ("Shield (Cantrip)").
    const row = [...overlay()!.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => /^Shield\b/.test(x.querySelector('.picker-name')?.textContent ?? '')) ?? null;
    expect(row?.querySelector('.picker-why')?.textContent, 'the tradition rule').toBe('Shield is from your own tradition, and this choice needs another.');
    expect(row!.querySelector<HTMLButtonElement>('button.tw-break-body')!.disabled, 'C20: the body stays disabled').toBe(true);
    await takeAnyway(r, row);
    expect(r.host.querySelector<HTMLElement>(`[data-ctl-title="${title}"]`)!.textContent).toContain('Shield');
    expect(r.host.querySelector('[data-tweak-mark="choice.allowAnywayAnyPicker"][data-tweak-state="live"]'), 'the mark under the control').toBeTruthy();
    await save(r);
    const b = saved()!;
    expect(b.grantedFeatChoices?.['adapted-cantrip']).toBe('shield');
    expect(allowedInPicker(b, 'spell', 'shield')).toBe(true);
    expect(readTweaks(b.overrides).instances).toHaveLength(1);
  });
  it('a stored answer the rule refuses, no tweak: by name, greyed, with the book line (C45); paused: "Tweak paused"', async () => {
    // A kept answer on the wizard's OWN tradition stays unmarked by design (the engine keeps it; openChoice's
    // "a kept one stays unmarked"), so the barred answer here is a cantrip of NO tradition — the openAnswerBarred case.
    const none = Object.values(db.spells).find((s) => s.rank === 0 && !s.traditions.length && !s.traits.includes('focus'))!;
    const stored = { grantedFeatChoices: { 'adapted-cantrip': none.id } };
    {
      const { r } = open(wiz([], stored), withHer, '1');
      await flush();
      expect(r.host.querySelector(`[data-ctl-title="${title}"]`)!.textContent).toContain(none.name);
      const line = r.host.querySelector<HTMLElement>('[data-book-grey]');
      expect(line?.textContent ?? '').toContain(`${none.name} is from no magical tradition, and this choice needs one — choose again.`);
      expect(line!.querySelector('button.tw-break-act'), 'Take anyway on the stored answer (Tweaks page on)').toBeTruthy();
      r.stop();
      stops.pop();
    }
    const { r } = open(wiz([allow('spell', none.id, {}, false)], stored), withHer, '1');
    await flush();
    expect(r.host.querySelector<HTMLElement>('[data-tweak-mark="choice.allowAnywayAnyPicker"]')?.dataset.tweakState).toBe('paused');
  });
});

/* ---------------------------------------------------------------- B2 ---------------------------------------- */

describe('B2: the second class\'s spell picker and a dedication\'s book rank (picker-only: the engine keeps both)', () => {
  it('the engine keeps an off-list spell in the second class and in a dedication\'s book (the read, pinned)', () => {
    const dual = hero(db, 'fighter', 3, ov(), { variantRules: { dualClass: true }, classId2: 'wizard', subclassId2: db.classes.wizard.subclass!.options[0].id, cantrips2: ['divine-lance'], spells2: { 1: ['heal'] } } as Partial<BuildState>);
    const e2 = built(dual).spellcasting.find((e) => e.id === 'wizard-casting')!;
    expect(ids(e2.cantrips)).toContain('divine-lance');
    expect(ids((e2.spellbook ?? {})[1])).toContain('heal');
    const ded = hero(db, 'fighter', 4, ov(), { featPicks: { '2:class:0': 'wizard-dedication', '4:class:0': 'basic-wizard-spellcasting' }, spells: { 1: ['heal'] } });
    expect(ids((built(ded).spellcasting.find((e) => e.id === 'wizard-dedication-casting')!.spellbook ?? {})[1])).toContain('heal');
  });
  it('the second class (Dual Class fighter / wizard): Divine Lance greyed under the reveal, taken anyway into cantrips2, its chip marked', async () => {
    const b = hero(db, 'fighter', 1, ov(), { variantRules: { dualClass: true }, classId2: 'wizard', subclassId2: db.classes.wizard.subclass!.options[0].id } as Partial<BuildState>);
    const { r, saved } = open(b); // the second class's spells are a Level 0 card
    await flush();
    await openCtl(r, 'Cantrip (second class)');
    await revealOn(fsel()!);
    const row = await fselFind('Divine Lance');
    expect(row?.hasAttribute('data-breakable')).toBe(true);
    expect(row!.querySelector('.picker-why')?.textContent).toBe('Not on the Arcane spell list.');
    await takeAnyway(r, row);
    const chip = [...r.host.querySelectorAll<HTMLElement>('.spr-chip')].find((c) => c.textContent?.includes('Divine Lance'));
    expect(chip?.querySelector('[data-tweak-mark][data-tweak-state="live"]'), 'the second class chip is marked').toBeTruthy();
    await save(r);
    expect(saved()!.cantrips2).toContain('divine-lance');
    expect(allowedInPicker(saved()!, 'spell', 'divine-lance')).toBe(true);
  });
  it("a dedication's book rank (fighter + Wizard Dedication + Basic Wizard Spellcasting): Heal taken anyway into the book", async () => {
    const b = hero(db, 'fighter', 4, ov(), { featPicks: { '2:class:0': 'wizard-dedication', '4:class:0': 'basic-wizard-spellcasting' } });
    const { r, saved } = open(b, db, '4');
    await flush();
    await openCtl(r, 'Rank 1 spell');
    await revealOn(fsel()!);
    const row = await fselFind('Heal');
    expect(row?.hasAttribute('data-breakable')).toBe(true);
    expect(row!.querySelector('.picker-why')?.textContent).toBe('Not on the Arcane spell list.');
    await takeAnyway(r, row);
    await save(r);
    expect(saved()!.spells[1]).toContain('heal');
    expect(allowedInPicker(saved()!, 'spell', 'heal')).toBe(true);
  });
  it("two casters (cleric + Wizard Dedication): the Setup card's book rank takes Heal anyway into archetypeSpells", async () => {
    const b = hero(db, 'cleric', 4, ov(), { deityId: 'razmir', enabledSources: BOOKS, featPicks: { '2:class:0': 'wizard-dedication', '4:class:0': 'basic-wizard-spellcasting' } });
    const { r, saved } = open(b);
    await flush();
    const ctl = [...r.host.querySelectorAll<HTMLElement>('[data-ctl-title]')].find((x) => /^Add a spell to your spellbook for 1st rank/.test(x.dataset.ctlTitle ?? ''));
    expect(ctl, 'the book rank picker').toBeTruthy();
    r.click(ctl!);
    await flush();
    await revealOn(overlay()!);
    await popSearch('Heal');
    const row = [...overlay()!.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === 'Heal') ?? null;
    expect(row?.querySelector('.picker-why')?.textContent).toBe('Not on the Arcane spell list.');
    await takeAnyway(r, row);
    await save(r);
    expect(saved()!.archetypeSpells?.spells?.[1]).toContain('heal');
  });
});

/* ---------------------------------------------------------------- B3 ---------------------------------------- */

describe("B3: a dedication that names its cantrips (Oatia Skysage) — the engine seam (mutation-proof) and its pickers", () => {
  const WARN = 'Shield is not one of the cantrips this dedication grants — choose again from the ones it names.';
  const OATIA = (blocks: object[] = []) => hero(db, 'fighter', 2, ov(...blocks), { enabledSources: [...BOOKS, GATEWALKERS], featPicks: { '2:class:0': 'oatia-skysage-dedication' }, cantrips: ['detect-magic', 'shield'] });
  const oatiaEntry = (ch: Character) => ch.spellcasting.find((e) => e.id === 'oatia-skysage-dedication-casting')!;
  const warns = (ch: Character) => (ch.effectWarnings ?? []).map((w) => w.message);
  it('no tweak: Shield is dropped with the warning (today)', () => {
    const ch = built(OATIA());
    expect(ids(oatiaEntry(ch).cantrips)).toEqual(['detect-magic']);
    expect(warns(ch)).toContain(WARN);
  });
  it('a live spell allow: Shield joins the entry, no warning (fails without the seam)', () => {
    const ch = built(OATIA([allow('spell', 'shield')]));
    expect(ids(oatiaEntry(ch).cantrips)).toContain('shield');
    expect(warns(ch)).not.toContain(WARN);
  });
  it('paused, Tweaks off, or an allow naming another spell: dropped again, the pick stays stored', () => {
    for (const b of [OATIA([allow('spell', 'shield', {}, false)]), off(OATIA([allow('spell', 'shield')])), OATIA([allow('spell', 'guidance')])]) {
      const ch = built(b);
      expect(ids(oatiaEntry(ch).cantrips)).toEqual(['detect-magic']);
      expect(warns(ch)).toContain(WARN);
      expect(b.cantrips).toContain('shield');
    }
  });
  it('merge check 1: switching Tweaks off lists the allow under "Stops counting" — the engine drops Shield again', () => {
    const list = tweaksTurnOffList(OATIA([allow('spell', 'shield')]), db).choices;
    expect(list.stops).toEqual([expect.stringContaining('Shield')]);
    expect(list.stays).toEqual([]);
    // Two casters (archetypeSpells) the same; a NAMED cantrip under an allow never stops (the engine keeps it).
    const cleric = hero(db, 'cleric', 2, ov(allow('spell', 'shield')), { deityId: 'razmir', featPicks: { '2:class:0': 'oatia-skysage-dedication' }, archetypeSpells: { cantrips: ['detect-magic', 'shield'], spells: {}, tradition: null, keyAbility: null } } as Partial<BuildState>);
    expect(tweaksTurnOffList(cleric, db).choices.stops).toEqual([expect.stringContaining('Shield')]);
    const named = tweaksTurnOffList(OATIA([allow('spell', 'guidance')]), db).choices;
    expect(named.stops).toEqual([]);
    expect(named.stays).toEqual([expect.stringContaining('Guidance')]);
    // Final check 1: a cantrip the dedication NAMES and the pool holds stays (only the named-list rule says so).
    const namedPooled = tweaksTurnOffList(OATIA([allow('spell', 'detect-magic')]), db).choices;
    expect(namedPooled.stops).toEqual([]);
    expect(namedPooled.stays).toEqual([expect.stringContaining('Detect Magic')]);
  });
  it('final check 2: an older two-casters save with no archetypeSpells reads build.cantrips, as the engine does', () => {
    const cleric = (blocks: object[] = []) => {
      const b = hero(db, 'cleric', 2, ov(...blocks), { deityId: 'razmir', featPicks: { '2:class:0': 'oatia-skysage-dedication' }, cantrips: ['detect-magic', 'shield'] } as Partial<BuildState>);
      delete (b as Partial<BuildState>).archetypeSpells;
      return b;
    };
    // The engine drops Shield from the Oatia entry without the allow, so switching Tweaks off must say it stops.
    // (Detect Magic present proves the engine read build.cantrips, not the empty legacy fallback.)
    expect(ids(oatiaEntry(built(cleric())).cantrips)).toEqual(['detect-magic']);
    expect(ids(oatiaEntry(built(cleric([allow('spell', 'shield')]))).cantrips)).toContain('shield');
    expect(tweaksTurnOffList(cleric([allow('spell', 'shield')]), db).choices.stops).toEqual([expect.stringContaining('Shield')]);
  });
  it('final check 4: an Adaptive Adept slot above the character\'s level grants nothing, so its allow stays', () => {
    const low = hero(db, 'wizard', 3, ov(allow('spell', 'join-pasts')), {
      featPicks: { '1:ancestry:0': 'adapted-cantrip', '5:ancestry:0': 'adaptive-adept' },
      featChoices: { '1:ancestry:0': 'healing-plaster', '5:ancestry:0': 'join-pasts' },
    });
    const list = tweaksTurnOffList(low, db).choices;
    expect(list.stops).toEqual([]);
    expect(list.stays).toEqual([expect.stringContaining('Join Pasts')]);
  });
  it('merge check 1: a GRANTED Adaptive Adept\'s off-tradition answer stops too (grantedFeatChoices)', () => {
    const HB = { license: 'homebrew', book: 'Tidewater Notes' };
    const her = { id: 'hb-heritage-adept-human', name: 'Adept Human (test)', traits: [], ancestryId: 'human', source: HB, grantsFeats: ['adaptive-adept'] };
    const withHer = { ...db, heritages: { ...db.heritages, [her.id]: her } } as unknown as ContentDatabase;
    const b = (blocks: object[]) =>
      hero(db, 'wizard', 5, ov(...blocks), {
        heritageId: her.id,
        enabledSources: [...BOOKS, HB.book],
        featPicks: { '1:ancestry:0': 'adapted-cantrip' },
        featChoices: { '1:ancestry:0': 'healing-plaster' },
        grantedFeatChoices: { 'adaptive-adept': 'join-pasts' },
      } as Partial<BuildState>);
    // The engine: granted, and dropped without the allow (the warning) — so the switch-off must say it stops.
    expect(warns(built(b([]), withHer)).some((m) => /Join Pasts is not from the tradition/.test(m))).toBe(true);
    expect(tweaksTurnOffList(b([allow('spell', 'join-pasts')]), withHer).choices.stops).toEqual([expect.stringContaining('Join Pasts')]);
  });
  it('the two-casters surface (cleric + Oatia, archetypeSpells): the same seam', () => {
    const cleric = (blocks: object[] = []) =>
      hero(db, 'cleric', 2, ov(...blocks), { deityId: 'razmir', featPicks: { '2:class:0': 'oatia-skysage-dedication' }, archetypeSpells: { cantrips: ['detect-magic', 'shield'], spells: {}, tradition: null, keyAbility: null } } as Partial<BuildState>);
    expect(ids(oatiaEntry(built(cleric())).cantrips)).toEqual(['detect-magic']);
    expect(ids(oatiaEntry(built(cleric([allow('spell', 'shield')]))).cantrips)).toContain('shield');
  });
  it('the Builder spell picker (a non-caster): Shield greyed "Not one of the cantrips Oatia Skysage Dedication names." and taken anyway', async () => {
    const b = OATIA();
    b.cantrips = ['detect-magic'];
    const { r, saved } = open(b, db, '2');
    await flush();
    await openCtl(r, 'Cantrip');
    await revealOn(fsel()!);
    const row = await fselFind('Shield');
    expect(row?.querySelector('.picker-why')?.textContent).toBe('Not one of the cantrips Oatia Skysage Dedication names.');
    await takeAnyway(r, row);
    await save(r);
    expect(saved()!.cantrips).toEqual(['detect-magic', 'shield']);
    expect(ids(oatiaEntry(built(saved()!)).cantrips)).toContain('shield');
  });
  it('the Setup "Archetype spellcasting" card (cleric + Oatia): Shield taken anyway into archetypeSpells; Tweaks off, no reveal', async () => {
    const b = hero(db, 'cleric', 2, ov(), { deityId: 'razmir', enabledSources: [...BOOKS, GATEWALKERS], featPicks: { '2:class:0': 'oatia-skysage-dedication' } });
    {
      const { r } = open(off(b));
      await flush();
      await openCtl(r, 'Add a cantrip');
      expect(overlay()!.querySelector('.tw-reveal')).toBeNull();
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
    }
    const { r, saved } = open(b);
    await flush();
    await openCtl(r, 'Add a cantrip');
    await revealOn(overlay()!);
    await popSearch('Shield');
    const row = [...overlay()!.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === 'Shield') ?? null;
    expect(row?.querySelector('.picker-why')?.textContent).toBe('Not one of the cantrips Oatia Skysage Dedication names.');
    await takeAnyway(r, row);
    expect(r.host.querySelector('[data-tweak-mark="choice.allowAnywayAnyPicker"][data-tweak-state="live"]'), 'the chip note marks it').toBeTruthy();
    await save(r);
    expect(saved()!.archetypeSpells?.cantrips).toContain('shield');
  });
});

/* ---------------------------------------------------------------- C1 / C3 ----------------------------------- */

describe('C1: spell chips — the C45 grey, read against the pool\'s EFFECTIVE list', () => {
  const chipOf = (r: R, name: string) => [...r.host.querySelectorAll<HTMLElement>('.spr-chip')].find((c) => c.textContent?.includes(name)) ?? null;
  async function page(r: R, p: string) {
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === p) ?? null);
    await flush();
  }
  it('a stored Heal in a wizard\'s book: greyed with the book line (no tweak; Tweaks off); live / paused: the mark, no grey', async () => {
    const cases: [string, BuildState, 'grey' | 'live' | 'paused'][] = [
      ['no tweak', hero(db, 'wizard', 1, ov(), { spells: { 1: ['heal'] } }), 'grey'],
      ['Tweaks off', off(hero(db, 'wizard', 1, ov(allow('spell', 'heal')), { spells: { 1: ['heal'] } })), 'grey'],
      ['live', hero(db, 'wizard', 1, ov(allow('spell', 'heal')), { spells: { 1: ['heal'] } }), 'live'],
      ['paused', hero(db, 'wizard', 1, ov(allow('spell', 'heal', {}, false)), { spells: { 1: ['heal'] } }), 'paused'],
    ];
    for (const [what, b, want] of cases) {
      const { r } = open(b, db, '1');
      await flush();
      const chip = chipOf(r, 'Heal');
      expect(chip, what).toBeTruthy();
      expect(chip!.hasAttribute('data-pick-grey'), `${what}: greyed`).toBe(want === 'grey');
      const line = [...r.host.querySelectorAll('[data-book-grey]')].find((x) => x.textContent?.includes('Heal: Not on the Arcane spell list.'));
      expect(!!line, `${what}: the book line`).toBe(want === 'grey');
      if (want === 'grey') expect(!!line!.querySelector('button.tw-break-act'), `${what}: Take anyway only with the Tweaks page on`).toBe(what === 'no tweak');
      expect(chip!.querySelector<HTMLElement>('[data-tweak-mark]')?.dataset.tweakState, what).toBe(want === 'grey' ? undefined : want);
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
    }
  });
  it('a spell a feat ADDS to the list (Tupilaq Carver: Summon Construct for a cleric) is on it: never greyed, never "paused"', async () => {
    const b = hero(db, 'cleric', 1, ov(allow('spell', 'summon-construct', {}, false)), {
      deityId: 'razmir',
      enabledSources: [...BOOKS, db.feats['tupilaq-carver'].source!.book],
      featPicks: { '1:ancestry:0': 'tupilaq-carver' },
      spells: { 1: ['summon-construct'] },
    });
    const { r } = open(b, db, '1');
    await flush();
    await page(r, '1');
    const chip = chipOf(r, 'Summon Construct');
    expect(chip, 'the chip').toBeTruthy();
    expect(chip!.hasAttribute('data-pick-grey')).toBe(false);
    expect(chip!.querySelector('[data-tweak-mark]'), 'no "Tweak paused — not on the list"').toBeNull();
  });
});

describe("C3: a prepared caster's second copy of a spell no live allow covers goes through the confirm", () => {
  it('cleric with Force Barrage under a PAUSED allow: the row is "Take anyway", the confirm switches the allow back on', async () => {
    // Level 2: the 1st-rank row holds two (one place free); at level 1 the row is full with the one copy.
    const b = hero(db, 'cleric', 2, ov(allow('spell', 'force-barrage', {}, false)), { deityId: 'razmir', enabledSources: BOOKS, spells: { 1: ['force-barrage'] } });
    const { r, saved } = open(b, db, '2');
    await flush();
    await openCtl(r, 'Rank 1 spell');
    await revealOn(fsel()!);
    const row = await fselFind('Force Barrage');
    expect(row?.hasAttribute('data-breakable'), 'no plain "Add" past a paused allow').toBe(true);
    await takeAnyway(r, row);
    await save(r);
    const s = saved()!;
    expect(s.spells[1]).toEqual(['force-barrage', 'force-barrage']);
    expect(allowedInPicker(s, 'spell', 'force-barrage'), 'the paused allow is back on').toBe(true);
    expect(readTweaks(s.overrides).instances, 'never listed twice').toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- C2 / C4 / C5 / C7 / C8 -------------------- */

describe('C2: only a RULE grey gets "Take anyway"', () => {
  it('a row greyed for another reason (a narrowing) stays a plain grey row even when the rule would also refuse it', async () => {
    const r = renderDom(
      createElement(PopupSelect, {
        title: 'Test pick',
        value: '',
        onChange: noop,
        options: [
          { value: 'a', label: 'Narrowed One', disabled: true, disabledReason: 'Only rubble or underbrush.' },
          { value: 'b', label: 'Ruled One', disabled: true, disabledReason: 'The rule says no.' },
          { value: 'c', label: 'Free One' },
        ],
        breakable: { reasonOf: () => 'The rule says no.', onTakeAnyway: noop },
      }),
    );
    stops.push(r.stop);
    r.click(r.host.querySelector('[data-ctl-title="Test pick"]'));
    await flush();
    const broken = [...document.querySelectorAll<HTMLElement>('[data-breakable]')].map((x) => x.querySelector('.picker-name')?.textContent);
    expect(broken).toEqual(['Ruled One']);
  });
});

describe('C4: a refused write says "Not saved: …"', () => {
  it('a stored tweak list the writer cannot read (written by a newer version) refuses the new one — the player is told, nothing changes', async () => {
    // `blocks` that is not a list: the writer keeps it as it is and refuses to write over it (WP2's door).
    const unreadable = { v: 2, blocks: { a: 1 } } as unknown as BuildOverrides;
    const { r, saved } = open(hero(db, 'fighter', 3, unreadable));
    await flush();
    await openCtl(r, 'Heritage');
    await revealOn(overlay()!);
    await popSearch('Ancient Elf');
    const row = [...overlay()!.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === 'Ancient Elf') ?? null;
    r.click(row!.querySelector('button.tw-break-act'));
    await flush();
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    const modal = document.querySelector('.confirm-modal');
    expect(modal?.textContent, 'the refusal is said').toMatch(/Not saved: /);
    r.click(dialogButton('OK'));
    await flush();
    await save(r);
    expect(saved()!.heritageId).toBe('versatile-human');
    // Merge check 4: the unreadable stored list itself is untouched — nothing written over it, nothing added.
    expect((saved()!.overrides as unknown as { blocks: unknown }).blocks).toEqual({ a: 1 });
  });
});

describe('C5: a greyed read-first row keeps its body disabled; the description has its own button', () => {
  it('BreakableOptionRow with a description: the body is disabled, "View description" opens it, "Take anyway" acts', async () => {
    let opened = 0;
    let acted = 0;
    const r = renderDom(createElement(BreakableOptionRow, { name: 'Heal', reason: 'Not on the Arcane spell list.', onOpenDesc: () => void opened++, onAct: () => void acted++ }));
    stops.push(r.stop);
    const body = r.host.querySelector<HTMLButtonElement>('button.tw-break-body')!;
    expect(body.disabled).toBe(true);
    expect(body.getAttribute('aria-disabled')).toBe('true');
    r.click(r.host.querySelector('button.tw-break-desc'));
    r.click(r.host.querySelector('button.tw-break-act'));
    expect([opened, acted]).toEqual([1, 1]);
  });
});

describe('C7: one look for "the book refuses this stored pick"', () => {
  it('the grey line IS the choice-inert line (the warning triangle); builder.css styles .tw-book-grey only as that', () => {
    const r = renderDom(createElement(StoredPickNote, { host: {}, k: { picker: 'heritage', record: 'desert-elf' }, rule: 'Not a heritage of your Human ancestry.' }));
    stops.push(r.stop);
    const line = r.host.querySelector<HTMLElement>('[data-book-grey]')!;
    expect(line.classList.contains('choice-inert')).toBe(true);
    expect(line.querySelector('i.ti-alert-triangle')).toBeTruthy();
    const css = readFileSync(join(process.cwd(), 'src/builder/builder.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const sels = [...css.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    expect(sels.filter((s) => /\.tw-book-grey(?![-\w])/.test(s) && !s.includes('.choice-inert')), 'a second look for the same message').toEqual([]);
  });
});

describe('C8: the catalog says what the registry says', () => {
  it('every catalog note naming "(applies: X)" matches the registered kind\'s applies', () => {
    const kinds = (JSON.parse(readFileSync(join(process.cwd(), 'src/rules/blocks/catalog.json'), 'utf8')) as { rows: { id: string; note?: string; registry?: boolean }[] }).rows;
    expect(kinds.length).toBeGreaterThan(50);
    const wrong: string[] = [];
    for (const k of kinds) {
      const said = /\(applies: ([\w-]+)\)/.exec(k.note ?? '')?.[1];
      if (!said || !k.registry) continue;
      const is = blockKind(k.id)?.applies;
      if (is !== said) wrong.push(`${k.id}: note says ${said}, registry ${is}`);
    }
    expect(wrong).toEqual([]);
    expect(kinds.find((k) => k.id === 'choice.allowAnywayAnyPicker')?.note).toContain('(applies: blocks)');
  });
});

/* ---------------------------------------------------------------- merge check ------------------------------- */

describe('merge check 2: "— choose again" speaks to the stored answer only', () => {
  it('a row the reveal adds (never picked) reads without it; the kept answer keeps it', () => {
    const wiz = hero(db, 'wizard', 1, ov());
    const ch = built(wiz);
    const from = db.feats['adapted-cantrip'].choice!.from;
    const revealed = openChoiceOptions(from, db, { character: ch, keep: [], reveal: true }).find((o) => o.id === 'allegro');
    expect(revealed?.note).toBe('Cantrip · from no magical tradition');
    expect(revealed?.notAllowed).toBe('Allegro is from no magical tradition, and this choice needs one.');
    const kept = openChoiceOptions(from, db, { character: ch, keep: ['allegro'], reveal: true }).find((o) => o.id === 'allegro');
    expect(kept?.note).toBe('Cantrip · from no magical tradition — choose again');
    expect(kept?.notAllowed).toBe('Allegro is from no magical tradition, and this choice needs one — choose again.');
  });
  it("Adaptive Adept: a revealed spell off the Adapted Cantrip's tradition reads without it too", () => {
    const b = hero(db, 'wizard', 5, ov(), { featPicks: { '1:ancestry:0': 'adapted-cantrip', '5:ancestry:0': 'adaptive-adept' }, featChoices: { '1:ancestry:0': 'healing-plaster' } });
    const from = db.feats['adaptive-adept'].choice!.from;
    const opts = openChoiceOptions(from, db, { character: built(b), keep: [], reveal: true });
    const off = opts.find((o) => o.id === 'join-pasts');
    expect(off?.note).toBe("Cantrip · not from your Adapted Cantrip cantrip's tradition");
    expect(off?.notAllowed).toBe('Join Pasts is not from the tradition of your Adapted Cantrip cantrip.');
    expect(opts.filter((o) => /choose again/.test(`${o.note} ${o.notAllowed ?? ''}`)), 'no unpicked row says "choose again"').toEqual([]);
  });
});

describe('merge check 3: a cantrip a live allow keeps on the sheet is on the Builder row too (retired answers)', () => {
  // The retired answers of a held dedication (build.ts LEGACY_ARCHETYPE_CANTRIP_KEYS: Spellshot's) feed both the sheet
  // and the row. No printed dedication both keeps retired answers AND names its cantrips, so Spellshot is given a
  // named list (as Oatia's) for this test only, and restored after.
  const LEGACY = { 'spellshot-dedication:spellbook-cantrip-1': 'detect-magic', 'spellshot-dedication:spellbook-cantrip-2': 'shield' };
  const GG = db.feats['spellshot-dedication'].source!.book;
  async function withNamed(fn: () => Promise<void>) {
    const cfg = CASTER_ARCHETYPES['spellshot-dedication'] as { cantripOptions?: string[] };
    const was = cfg.cantripOptions;
    cfg.cantripOptions = ['detect-magic'];
    try {
      await fn();
    } finally {
      if (was === undefined) delete cfg.cantripOptions;
      else cfg.cantripOptions = was;
    }
  }
  const names = (els: Iterable<Element>) => [...els].map((c) => c.textContent ?? '');
  it('the level page row (a spellshot gunslinger): Shield shows while a live allow keeps it; with no allow it is gone', async () => {
    await withNamed(async () => {
      const gs = (blocks: object[]) => hero(db, 'gunslinger', 2, ov(...blocks), { subclassId: 'way-of-the-spellshot', enabledSources: [...BOOKS, GG], featPicks: { '2:class:0': 'spellshot-dedication' }, cantrips: [], effectChoices: LEGACY });
      const sheet = (b: BuildState) => ids(built(b).spellcasting.find((e) => e.id === 'spellshot-dedication-casting')?.cantrips);
      expect(sheet(gs([allow('spell', 'shield')])), 'the sheet keeps it').toEqual(['detect-magic', 'shield']);
      expect(sheet(gs([])), 'the sheet drops it').toEqual(['detect-magic']);
      for (const [blocks, want] of [[[allow('spell', 'shield')], true], [[], false]] as [object[], boolean][]) {
        const { r } = open(gs(blocks), db, '2');
        await flush();
        const chips = names(r.host.querySelectorAll('.spr-chip'));
        expect(chips.some((t) => t.includes('Detect Magic')), `allow=${want}: Detect Magic`).toBe(true);
        expect(chips.some((t) => t.includes('Shield')), `allow=${want}: Shield`).toBe(want);
        r.stop();
        stops.pop();
        for (const n of [...document.body.children]) n.remove();
      }
    });
  });
  it('the Setup "Archetype spellcasting" card (cleric + Spellshot): the same', async () => {
    await withNamed(async () => {
      const cl = (blocks: object[]) => hero(db, 'cleric', 2, ov(...blocks), { deityId: 'razmir', enabledSources: [...BOOKS, GG], featPicks: { '2:class:0': 'spellshot-dedication' }, effectChoices: LEGACY });
      for (const [blocks, want] of [[[allow('spell', 'shield')], true], [[], false]] as [object[], boolean][]) {
        const { r } = open(cl(blocks));
        await flush();
        const chips = names(r.host.querySelectorAll('.ec-chip'));
        expect(chips.some((t) => t.includes('Detect Magic')), `allow=${want}: Detect Magic`).toBe(true);
        expect(chips.some((t) => t.includes('Shield')), `allow=${want}: Shield`).toBe(want);
        r.stop();
        stops.pop();
        for (const n of [...document.body.children]) n.remove();
      }
    });
  });
});
