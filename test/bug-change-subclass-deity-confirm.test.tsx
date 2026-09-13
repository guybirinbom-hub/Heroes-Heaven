// @vitest-environment jsdom
// bug 2026-09-13: change-subclass-deity-confirm
import { createElement, act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

/**
 * Owner ruling, 2026-09-13 ("yes"): subclass and deity changes must confirm before dropping answered
 * picks, exactly like ancestry / heritage / background do since v0.1.34.
 *
 * Measured on the real Builder before the fix, at HEAD 9749be0:
 *   - sorcerer, Bloodline: Draconic (arcane) -> Bloodline: Angelic (divine), no dialog:
 *     cantrips ['electric-arc','shield','telekinetic-projectile'] -> [],
 *     spells {1:['force-barrage','grease'],2:['mirror-image']} -> {},
 *     signatures {1:['force-barrage']} -> {}.   Six answers, gone, with nothing said.
 *   - the SAME loss from the level page's copy of the picker (Builder.tsx), which is a second call
 *     site into the same reducer.
 *   - cleric, Abadar -> Torag, no dialog: both Domain Initiate domains deleted and the answered
 *     divine font silently switched from Harm to Heal.
 *   - cleric, Warpriest -> Battle Creed, no dialog: the answered level-2 class feat overwritten by
 *     the dedication Battle Creed forces.
 *
 * Rule (the helper's own comment): name what goes, Cancel changes NOTHING, a build with nothing to
 * lose needs no dialog, re-picking the same id is a no-op.
 */
const c = () => content();
const noop = () => undefined;

/** Deities ship in Lost Omens books, so a build that has to SEE one has to enable that shelf. */
const BOOKS = [
  'Pathfinder Player Core',
  'Pathfinder Player Core 2',
  'Pathfinder GM Core',
  'Pathfinder Monster Core',
  'Pathfinder Lost Omens Divine Mysteries',
];

/** A level-3 sorcerer holding one answer of every kind the bloodline swap destroys. */
const SORC: BuildState = {
  ...emptyBuild(),
  name: 'Seoni',
  level: 3,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'sorcerer',
  subclassId: 'bloodline-draconic',
  keyAbility: 'cha',
  cantrips: ['electric-arc', 'shield', 'telekinetic-projectile'],
  spells: { 1: ['force-barrage', 'grease'], 2: ['mirror-image'] },
  signatures: { 1: ['force-barrage'] },
};

/** A cleric of Abadar with two Domain Initiate answers and an answered (two-option) divine font. */
const CLERIC: BuildState = {
  ...emptyBuild(),
  name: 'Kyra',
  level: 3,
  ancestryId: 'human',
  backgroundId: 'acolyte',
  classId: 'cleric',
  subclassId: 'cloistered-cleric',
  keyAbility: 'wis',
  enabledSources: BOOKS,
  deityId: 'abadar',
  divineFont: 'harm',
  featPicks: { '1:class:0': 'domain-initiate', '2:class:0': 'domain-initiate' },
  featChoices: { '1:class:0': 'cities', '2:class:0': 'wealth' },
};

function open(initial: BuildState) {
  let saved: BuildState | null = null;
  const r = renderDom(
    createElement(Builder, { content: c(), initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }),
  );
  return { r, saved: () => saved };
}

/** confirmDialog resolves, then tears its root down on a deferred timer — let one fire. */
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
/** confirmDialog mounts its own root on <body>, so look app-wide — never inside the host. */
const dialog = () => document.querySelector('.confirm-modal');
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) ?? null;
const anyButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;

/** Move to a page of the builder's level strip ('0' = origins/setup, '1'.. = the level pages). */
function page(r: ReturnType<typeof open>['r'], label: string) {
  const b = [...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === label);
  expect(b, `no "${label}" page in the level strip`).toBeTruthy();
  r.click(b!);
}

/** Type into the open picker's search box the way React sees a real keystroke. */
function search(text: string) {
  const ov = [...document.querySelectorAll('.picker-overlay')];
  const input = ov[ov.length - 1]?.querySelector('input.name-input') as HTMLInputElement | null;
  if (!input) return; // a short list (three doctrines) has no search field at all
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Open the picker carrying `title` and choose the option named `name`, as a player does.
 *
 * `root` scopes the search to one page's controls: the subclass picker exists on the Setup page AND
 * on the level page, and a test that means the second one must not silently drive the first.
 */
async function pick(r: ReturnType<typeof open>['r'], title: string, name: string, sel = `[data-ctl-title="${title}"]`) {
  const ctl = r.host.querySelector(sel);
  expect(ctl, `no "${title}" control matching ${sel}`).toBeTruthy();
  r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
  await flush();
  search(name);
  await flush();
  const row = [...document.querySelectorAll('.picker-overlay .pick-row')].find(
    (x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === name,
  );
  const item = [...document.querySelectorAll('.picker-overlay .picker-item')].find(
    (x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === name,
  );
  expect(row ?? item, `no "${name}" row in the ${title} picker`).toBeTruthy();
  if (row) r.click([...row.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Select') ?? null);
  else r.click(item!);
  await flush();
}

/** Press "Save changes" and answer the unfinished-choices confirmation, so the test can read the
 *  build the Builder is actually holding. */
async function save(r: ReturnType<typeof open>['r']) {
  r.click(anyButton('Save changes'));
  await flush();
  for (let i = 0; i < 4; i++) {
    const anyway = anyButton('Save anyway');
    if (!anyway) break;
    r.click(anyway);
    await flush();
  }
}

/* A leg that fails mid-flow never reaches `r.stop()`, and its open picker / confirm root would then
 * be the first one the NEXT leg's document-wide queries find — one real failure reported as a dozen.
 * Every leg mounts its own host, so clearing the body between them keeps each failure its own. */
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

/** Close whatever dialog is still up, so the next test doesn't find a stale one. */
async function dismiss(r: ReturnType<typeof open>['r']) {
  const cancel = dialogButton('Cancel');
  if (cancel) {
    r.click(cancel);
    await flush();
  }
}

describe('changing the subclass asks before it drops answered picks', () => {
  it('names the cantrips, spells and signature a tradition swap destroys', async () => {
    const h = open(SORC);
    page(h.r, '0');
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic');
    const d = dialog();
    expect(d, 'the bloodline swap deleted six answers with no confirmation').toBeTruthy();
    // The app's dialog, never the browser's — project rule.
    expect(d!.getAttribute('role')).toBe('alertdialog');
    const text = d!.textContent ?? '';
    expect(text).toContain('Change bloodline?');
    expect(text).toContain('Cantrips (3)');
    expect(text).toContain('Electric Arc');
    expect(text).toContain('Spells (3)');
    expect(text).toContain('Force Barrage');
    expect(text).toContain('Mirror Image');
    expect(text).toContain('Signature spells (1)');
    await dismiss(h.r);
    h.r.stop();
  });

  it('Cancel changes nothing at all', async () => {
    const h = open(SORC);
    page(h.r, '0');
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic');
    h.r.click(dialogButton('Cancel'));
    await flush();
    expect(dialog(), 'the dialog stayed open after Cancel').toBeFalsy();
    await save(h.r);
    expect(h.saved(), 'Cancel still changed the build').toEqual(SORC);
    h.r.stop();
  });

  it('confirming applies the change — and only then', async () => {
    const h = open(SORC);
    page(h.r, '0');
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic');
    h.r.click(dialogButton('Change bloodline'));
    await flush();
    await save(h.r);
    const out = h.saved()!;
    expect(out.subclassId).toBe('bloodline-angelic');
    expect(out.cantrips).toEqual([]);
    expect(out.spells).toEqual({});
    expect(out.signatures).toEqual({});
    h.r.stop();
  });

  it('the LEVEL PAGE copy of the picker asks too — the second call site', async () => {
    const h = open(SORC);
    page(h.r, '1');
    // `.lvl-subsel` is Builder.tsx's own subclass card, not the Setup card in shared.tsx.
    expect(h.r.host.querySelector('.lvl-subsel'), 'the level page lost its subclass card').toBeTruthy();
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic', '.lvl-subsel');
    expect(dialog(), 'the level-page bloodline picker still drops spells silently').toBeTruthy();
    expect(dialog()!.textContent).toContain('Cantrips (3)');
    h.r.click(dialogButton('Cancel'));
    await flush();
    await save(h.r);
    expect(h.saved(), 'Cancel on the level page still changed the build').toEqual(SORC);
    h.r.stop();
  });

  it('the LEVEL PAGE copy applies the change when confirmed', async () => {
    const h = open(SORC);
    page(h.r, '1');
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic', '.lvl-subsel');
    h.r.click(dialogButton('Change bloodline'));
    await flush();
    await save(h.r);
    const out = h.saved()!;
    expect(out.subclassId).toBe('bloodline-angelic');
    expect(out.cantrips).toEqual([]);
    h.r.stop();
  });

  it('a swap that keeps the tradition loses nothing, so it must not interrupt', async () => {
    const h = open(SORC);
    page(h.r, '0');
    // Genie is arcane, same as Draconic — the reducer keeps every spell, so there is nothing to warn about.
    await pick(h.r, 'Bloodline', 'Bloodline: Genie');
    expect(dialog(), 'a swap with nothing to lose must not be interrupted').toBeFalsy();
    await save(h.r);
    const out = h.saved()!;
    expect(out.subclassId).toBe('bloodline-genie');
    expect(out.cantrips).toEqual(SORC.cantrips);
    expect(out.spells).toEqual(SORC.spells);
    h.r.stop();
  });

  it('a fresh caster with no spells yet changes bloodline with no dialog', async () => {
    const start: BuildState = {
      ...emptyBuild(),
      name: 'New',
      level: 1,
      classId: 'sorcerer',
      keyAbility: 'cha',
      subclassId: 'bloodline-draconic',
    };
    const h = open(start);
    page(h.r, '0');
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic');
    expect(dialog(), 'a build with nothing to lose must not be interrupted').toBeFalsy();
    await save(h.r);
    expect(h.saved()!.subclassId).toBe('bloodline-angelic');
    h.r.stop();
  });

  /*
   * adversarially confirmed 2026-09-13: `subclassChangeLosses` short-circuited on `!b.subclassId`,
   * and that was the one state where the dialog and the reducer disagreed. `changeSubclass` compares
   * `oldOpt?.tradition !== newOpt?.tradition`, and with no subclass picked the old tradition is
   * `undefined` — so the FIRST bloodline a player picks clears every cantrip, spell and signature,
   * which is exactly the loss this lane exists to announce, and it announced nothing.
   */
  it('picking the FIRST bloodline still names the spells the reducer is about to clear', async () => {
    const h = open({ ...SORC, subclassId: null });
    page(h.r, '0');
    await pick(h.r, 'Bloodline', 'Bloodline: Angelic');
    expect(dialog(), 'a first bloodline pick wipes the spell list with nothing said').toBeTruthy();
    expect(dialog()!.textContent).toContain('Cantrips (3)');
    h.r.click(dialogButton('Cancel'));
    await flush();
    await save(h.r);
    expect(h.saved(), 'Cancel still changed the build').toEqual({ ...SORC, subclassId: null });
    h.r.stop();
  });

  it('re-picking the bloodline it already has is a no-op, not a wipe', async () => {
    const h = open(SORC);
    page(h.r, '0');
    await pick(h.r, 'Bloodline', 'Bloodline: Draconic');
    expect(dialog()).toBeFalsy();
    await save(h.r);
    expect(h.saved()).toEqual(SORC);
    h.r.stop();
  });

  it('names the level-2 class feat Battle Creed overwrites', async () => {
    const start: BuildState = { ...CLERIC, subclassId: 'warpriest', featPicks: { '2:class:0': 'emblazon-armament' }, featChoices: {} };
    const h = open(start);
    page(h.r, '0');
    await pick(h.r, 'Doctrine', 'Battle Creed');
    expect(dialog(), 'Battle Creed overwrote an answered class feat with no confirmation').toBeTruthy();
    expect(dialog()!.textContent).toContain('Change doctrine?');
    expect(dialog()!.textContent).toContain('Emblazon Armament');
    h.r.click(dialogButton('Cancel'));
    await flush();
    await save(h.r);
    expect(h.saved(), 'Cancel still changed the build').toEqual(start);
    h.r.stop();
  });
});

describe('changing the deity asks before it drops answered picks', () => {
  it('names every domain it deletes and the divine font it replaces', async () => {
    const h = open(CLERIC);
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Torag');
    const d = dialog();
    expect(d, 'the deity swap deleted two domains and the font with no confirmation').toBeTruthy();
    expect(d!.getAttribute('role')).toBe('alertdialog');
    const text = d!.textContent ?? '';
    expect(text).toContain('Change deity?');
    expect(text).toContain('Cities');
    expect(text).toContain('Wealth');
    expect(text).toContain('Divine font');
    expect(text).toContain('Harm');
    await dismiss(h.r);
    h.r.stop();
  });

  it('Cancel changes nothing at all', async () => {
    const h = open(CLERIC);
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Torag');
    h.r.click(dialogButton('Cancel'));
    await flush();
    expect(dialog(), 'the dialog stayed open after Cancel').toBeFalsy();
    await save(h.r);
    expect(h.saved(), 'Cancel still changed the build').toEqual(CLERIC);
    h.r.stop();
  });

  it('confirming applies the change — and only then', async () => {
    const h = open(CLERIC);
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Torag');
    h.r.click(dialogButton('Change deity'));
    await flush();
    await save(h.r);
    const out = h.saved()!;
    expect(out.deityId).toBe('torag');
    expect(out.featChoices).toEqual({});
    expect(out.divineFont).toBe('heal'); // Torag offers only one font, so it settles rather than asking
    expect(out.featPicks, 'the feats themselves are not the deity’s to drop').toEqual(CLERIC.featPicks);
    h.r.stop();
  });

  it('lists only the domain that actually dies, never the one that survives', async () => {
    // Earth is on BOTH Abadar's and Torag's lists; Wealth is Abadar's alone. A list that named Earth
    // would be scaring the player off a change that costs them nothing.
    const start: BuildState = { ...CLERIC, divineFont: null, featChoices: { '1:class:0': 'earth', '2:class:0': 'wealth' } };
    const h = open(start);
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Torag');
    const text = dialog()?.textContent ?? '';
    expect(text, 'the surviving Earth domain must not be reported as a loss').not.toContain('Earth');
    expect(text).toContain('Wealth');
    h.r.click(dialogButton('Change deity'));
    await flush();
    await save(h.r);
    expect(h.saved()!.featChoices).toEqual({ '1:class:0': 'earth' });
    h.r.stop();
  });

  it('a cleric with no domain answered and no font chosen changes deity with no dialog', async () => {
    const start: BuildState = { ...CLERIC, divineFont: null, featPicks: {}, featChoices: {} };
    const h = open(start);
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Torag');
    expect(dialog(), 'a build with nothing to lose must not be interrupted').toBeFalsy();
    await save(h.r);
    expect(h.saved()!.deityId).toBe('torag');
    h.r.stop();
  });

  /*
   * adversarially confirmed 2026-09-13: the loss list was built only `if (build.deityId)`. But
   * `changeDeity` replaces the divine font whether or not a deity was set first, so a cleric who had
   * answered Harm and then picked their first deity had it switched to Heal with nothing said.
   */
  it('picking the FIRST deity still names the divine font it replaces', async () => {
    const h = open({ ...CLERIC, deityId: null, featPicks: {}, featChoices: {} });
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Torag');
    expect(dialog(), 'a first deity pick replaced the answered font with nothing said').toBeTruthy();
    expect(dialog()!.textContent).toContain('Divine font');
    expect(dialog()!.textContent).toContain('Harm');
    await dismiss(h.r);
    h.r.stop();
  });

  it('re-picking the deity it already has is a no-op, not a wipe', async () => {
    const h = open(CLERIC);
    page(h.r, '0');
    await pick(h.r, 'Deity', 'Abadar');
    expect(dialog()).toBeFalsy();
    await save(h.r);
    expect(h.saved()).toEqual(CLERIC);
    h.r.stop();
  });
});
