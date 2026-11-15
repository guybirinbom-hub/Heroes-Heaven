// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP4: "Take anyway" in the other pickers (plan work/tweaks-phase2-notes/plan.md WP4; C5, C19-C21,
 * C33, C35, C45). Synthetic characters only.
 *
 *   - the first gated engine seam (the second, a dedication's named cantrips, is WP4 finish B3, pinned in
 *     tweaks-p2-take-anyway-finish): the open spell grant's `offTradition` skip lifts for a spell a live `spell` allow
 *     names (mutation-proof: the live case fails without the seam), paused / off it returns;
 *   - the missing / owed lines treat a live-allowed pick as answered and return while paused (setupMissing's deity
 *     and subclass lines, levelChoices' sanctification and "choose again" lines);
 *   - the pick reaches the built Character (heritage, background, deity, subclass, spell), and a prepared spell taken
 *     anyway survives Save (the bug-builder-save-lossless chain);
 *   - the Builder: the heritage reveal (Tweaks on only, default off), the greyed row with "Take anyway", ONE write
 *     holding the pick and the tweak (one undo step), the mark; C45's stored-name display on, paused, off, no block;
 *   - the Tweaks page alone creates the allow, and the picker then offers the record un-greyed;
 *   - the C33 switch-off groups; the subclass repoint narrowed to its class's options; the open spell options.
 */
import { createElement, act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content, mainCasting } from './_content';
import { renderDom } from './_render';
import { addEditor, hero, mountTweaks, openMenu, pick as pickPart, press } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, dedicationBlock, deityNamedBy, featChoicePrompt, levelChoices, sanctificationBookReason, setupMissing, takenForDedicationRule, type BuildState } from '../src/rules/build';
import { creatureTraitsOf, deriveStrikes, ownedFeatureIds } from '../src/rules/derive';
import { collectCarried } from '../src/data/carried';
import { contentFor } from '../src/rules/blocks/content';
import { allowedInPicker, isAllowedAnyway } from '../src/rules/blocks/active';
import { blockKind, STILL_TO_ADD } from '../src/rules/blocks/registry';
import { readTweaks } from '../src/rules/blocks/stored';
import { openChoiceOptions } from '../src/rules/openChoice';
import { initialPlay, applyPlayState, playForRebuild } from '../src/rules/play';
import { carryStoredOverrides } from '../src/data/rebuild';
import { tweakRows, tweaksTurnOffList } from '../src/builder/tweaks/model';
import type { BuildOverrides, Character } from '../src/rules/types';

const db = content();
const noop = () => undefined;
let seq = 0;
const allow = (picker: string, record: string, rest: Record<string, unknown> = {}, on = true) => ({
  id: `t${++seq}_wp4${String(seq).padStart(2, '0')}`,
  kind: 'choice.allowAnywayAnyPicker',
  v: 1,
  picker,
  record,
  ...rest,
  ...(on ? {} : { on: false }),
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
/** Tweaks switched off on the character (the master switch). */
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const warns = (ch: Character) => (ch.effectWarnings ?? []).map((w) => w.message);
/** A wizard's spellbook, rank by rank (a prepared caster keeps its book here, not in a repertoire). */
const book = (ch: Character) => Object.values(mainCasting(ch)?.spellbook ?? {}).flat();
const entrySpells =(ch: Character) => (ch.spellcasting ?? []).flatMap((e) => [...Object.values(e.repertoire ?? {}).flat(), ...(e.cantrips ?? [])].map((s) => (typeof s === 'string' ? s : (s as { spellId: string }).spellId)));

/* The parity specs' shapes (scripts/blocks-parity-snapshot.mjs, p2 cases), rebuilt here. */
const BOOKS = ['Pathfinder Player Core', 'Pathfinder Player Core 2', 'Pathfinder GM Core', 'Pathfinder Monster Core', 'Pathfinder Lost Omens Divine Mysteries'];
const ADEPT = (blocks: object[] = []) =>
  hero(db, 'wizard', 5, ov(...blocks), {
    featPicks: { '1:ancestry:0': 'adapted-cantrip', '5:ancestry:0': 'adaptive-adept' },
    featChoices: { '1:ancestry:0': 'healing-plaster', '5:ancestry:0': 'join-pasts' },
  });
const SANCT = (blocks: object[] = []) =>
  hero(db, 'fighter', 2, ov(...blocks), { deityId: 'otolmens', enabledSources: BOOKS, featPicks: { '2:class:0': 'cleric-dedication' }, featChoices: { '2:class:0': 'unholy' } });
const RAZMIRAN = (blocks: object[] = []) =>
  hero(db, 'fighter', 4, ov(...blocks), { deityId: 'kostchtchie', enabledSources: BOOKS, featPicks: { '2:class:0': 'razmiran-priest-dedication', '4:class:0': 'cleric-dedication' } });
const GRANDEUR = (blocks: object[] = []) =>
  // The champion's answer is the Deity feature's choice (`feature:deity-champion`, read by choiceFlagAnswer). The
  // parity case `p2-subclass-anyway` stores it as an effect choice instead, so it never reaches the cause rule.
  hero(db, 'champion', 3, ov(...blocks), { subclassId: 'grandeur', deityId: 'kostchtchie', enabledSources: BOOKS, featChoices: { 'feature:deity-champion': 'unholy' } });
const ELF_ON_HUMAN = (blocks: object[] = []) => hero(db, 'fighter', 3, ov(...blocks), { heritageId: 'desert-elf' });

describe('the open spell grant: the one gated engine seam (mutation-proof)', () => {
  const JOIN = 'Join Pasts is not from the tradition of your Adapted Cantrip cantrip — choose again in the builder.';
  it('no tweak: Join Pasts is not granted, with the warning (today)', () => {
    const ch = built(ADEPT());
    expect(warns(ch)).toContain(JOIN);
    expect(entrySpells(ch)).not.toContain('join-pasts');
  });
  it('a live spell allow: Join Pasts joins the class entry, no warning (fails without the seam)', () => {
    const ch = built(ADEPT([allow('spell', 'join-pasts')]));
    expect(warns(ch)).not.toContain(JOIN);
    expect(entrySpells(ch)).toContain('join-pasts');
  });
  it('paused, or Tweaks switched off: the warning returns and the pick stays stored', () => {
    for (const b of [ADEPT([allow('spell', 'join-pasts', {}, false)]), off(ADEPT([allow('spell', 'join-pasts')]))]) {
      const ch = built(b);
      expect(warns(ch)).toContain(JOIN);
      expect(b.featChoices['5:ancestry:0']).toBe('join-pasts');
    }
  });
  it('"already your … cantrip" and the rank are never lifted: the allow names another spell, the warning stays', () => {
    const b = ADEPT([allow('spell', 'healing-plaster')]);
    b.featChoices = { ...b.featChoices, '5:ancestry:0': 'healing-plaster' };
    expect(warns(built(b)).some((m) => /already your Adapted Cantrip cantrip/.test(m))).toBe(true);
  });
  it('the level page\'s "choose again" line: gone while live, back while paused', () => {
    const line = (b: BuildState) => levelChoices(b, db).some((c) => c.page === 5 && /choose again/i.test(c.label));
    expect(line(ADEPT())).toBe(true);
    expect(line(ADEPT([allow('spell', 'join-pasts')]))).toBe(false);
    expect(line(ADEPT([allow('spell', 'join-pasts', {}, false)]))).toBe(true);
  });
});

describe('the missing / owed lines treat a live-allowed pick as answered; paused, they return', () => {
  it('sanctification the deity refuses (Otolmens: holy or none) — the line goes while live, the answer counts either way', () => {
    const line = (b: BuildState) => levelChoices(b, db).some((c) => c.page === 2 && /Sanctification \(Cleric Dedication\): Unholy — Otolmens allows only/.test(c.label));
    expect(line(SANCT())).toBe(true);
    expect(line(SANCT([allow('sanctification', 'cleric-dedication', { value: 'unholy' })]))).toBe(false);
    expect(line(SANCT([allow('sanctification', 'cleric-dedication', { value: 'unholy' }, false)]))).toBe(true);
    // an allow for another answer lifts nothing
    expect(line(SANCT([allow('sanctification', 'cleric-dedication', { value: 'holy' })]))).toBe(true);
    // Merge check 4: "the answer counts either way" — the creature gains the unholy trait live AND paused.
    const traits = (b: BuildState) => creatureTraitsOf(built(b), db).map((t) => t.trait.toLowerCase());
    expect(traits(SANCT([allow('sanctification', 'cleric-dedication', { value: 'unholy' })])), 'live').toContain('unholy');
    expect(traits(SANCT([allow('sanctification', 'cleric-dedication', { value: 'unholy' }, false)])), 'paused').toContain('unholy');
    const none = SANCT();
    none.featChoices = {};
    expect(traits(none), 'unanswered: no trait (the control)').not.toContain('unholy');
  });
  it("a deity a Razmiran priest's Cleric Dedication refuses", () => {
    const line = (b: BuildState) => setupMissing(b, db).some((l) => l.startsWith('Deity —'));
    expect(line(RAZMIRAN())).toBe(true);
    expect(line(RAZMIRAN([allow('deity', 'kostchtchie')]))).toBe(false);
    expect(line(RAZMIRAN([allow('deity', 'kostchtchie', {}, false)]))).toBe(true);
    expect(built(RAZMIRAN([allow('deity', 'kostchtchie')])).details.deityId).toBe('kostchtchie');
  });
  it('a cause the sanctification refuses: named per class (classId), live only', () => {
    const cause = db.classes.champion.subclass!.name;
    const line = (b: BuildState) => setupMissing(b, db).includes(cause);
    expect(line(GRANDEUR())).toBe(true);
    expect(line(GRANDEUR([allow('subclass', 'grandeur', { classId: 'champion' })]))).toBe(false);
    expect(line(GRANDEUR([allow('subclass', 'grandeur', { classId: 'fighter' })])), 'another class').toBe(true);
    expect(line(GRANDEUR([allow('subclass', 'grandeur', { classId: 'champion' }, false)]))).toBe(true);
    expect(built(GRANDEUR([allow('subclass', 'grandeur', { classId: 'champion' })])).subclassId).toBe('grandeur');
  });
});

describe('the taken pick reaches the built Character', () => {
  it('heritage, background and a spell off the tradition', () => {
    expect(built(ELF_ON_HUMAN([allow('heritage', 'desert-elf')])).heritageId).toBe('desert-elf');
    const dragon = built(hero(db, 'fighter', 3, ov(allow('background', 'sewer-dragon')), { backgroundId: 'sewer-dragon' }));
    expect(dragon.backgroundId).toBe('sewer-dragon');
    // Merge check 4: the background's own grants arrive — Sewer Dragon trains Crafting (Acolyte, the control, does not).
    expect(dragon.proficiencies.skills.crafting, "the background's skill").toBe('trained');
    expect(built(hero(db, 'fighter', 3, ov())).proficiencies.skills.crafting, 'Acolyte: the control').toBe('untrained');
    const wiz = hero(db, 'wizard', 3, ov(allow('spell', 'heal')), { spells: { 1: ['heal'] } });
    expect(book(built(wiz))).toContain('heal');
    // …and a KNOWN (repertoire) list: a bard's occult repertoire holds Heal taken anyway.
    const bard = built(hero(db, 'bard', 3, ov(allow('spell', 'heal')), { spells: { 1: ['heal'] } }));
    expect(Object.values(mainCasting(bard)?.repertoire ?? {}).flat().map((s) => (typeof s === 'string' ? s : (s as { spellId: string }).spellId)), 'the repertoire').toContain('heal');
  });
  it("the deity's font: a Razmiran priest cleric's Cleric Dedication takes Otolmens anyway, and Otolmens' heal font arrives", () => {
    const cleric = (deityId: string, blocks: object[] = []) =>
      // A cloistered cleric (the first doctrine, Battle Creed, swaps the font for a battle font).
      hero(db, 'cleric', 4, ov(...blocks), { deityId, divineFont: 'heal', subclassId: 'cloistered-cleric', enabledSources: BOOKS, featPicks: { '2:class:0': 'razmiran-priest-dedication', '4:class:0': 'cleric-dedication' } } as Partial<BuildState>);
    expect(deityNamedBy(cleric('otolmens'), db)?.id, 'the rule names Razmir').toBe('razmir');
    expect(mainCasting(built(cleric('otolmens', [allow('deity', 'otolmens')])))?.font?.type, 'taken anyway: the heal font').toBe('heal');
    expect(mainCasting(built(cleric('razmir')))?.font, "Razmir (harm only): no heal font — the control").toBeUndefined();
  });
  it('Save: a prepared off-tradition spell taken anyway survives (live and paused)', () => {
    for (const on of [true, false]) {
      const b = hero(db, 'wizard', 3, ov(allow('spell', 'heal', {}, on)), { spells: { 1: ['heal'] } });
      const ch = built(b);
      const play = initialPlay(ch, db);
      const fresh = built(b);
      const saved = { character: carryStoredOverrides(fresh, ch), play: playForRebuild(play, fresh, ch) };
      const sheet = applyPlayState(saved.character, saved.play, db);
      expect(book(sheet), `book, on=${on}`).toContain('heal');
      expect((mainCasting(sheet)?.prepared?.[1] ?? []).map((s) => s.spellId), `prepared, on=${on}`).toContain('heal');
    }
  });
  it('the dedication rule passes through the feat Take anyway (Magaambyan Attendant Dedication)', () => {
    const b = hero(db, 'fighter', 4, { v: 2, allowedFeats: ['magaambyan-attendant-dedication', 'blackjacket-dedication'] } as unknown as BuildOverrides, {
      classSkills: ['athletics', 'stealth', 'nature'],
      featPicks: { '2:class:0': 'magaambyan-attendant-dedication', '4:class:0': 'blackjacket-dedication' },
    });
    expect(dedicationBlock(takenForDedicationRule(b, '4:class:0', 4), db.feats['blackjacket-dedication'], db), 'the gate refuses it').toBeTruthy();
    expect(isAllowedAnyway(b, 'blackjacket-dedication')).toBe(true);
    expect(built(b).feats.some((f) => f.featId === 'blackjacket-dedication'), 'accepted with the allow').toBe(true);
    expect(levelChoices(b, db).filter((c) => c.page === 4 && /class feat/i.test(c.label)), 'the level is not owed').toEqual([]);
  });
  it('merge check 4: the feat picker hides the second dedication without the allow and offers it with the allow', async () => {
    const mag = (allowed: string[]) =>
      hero(db, 'fighter', 4, { v: 2, allowedFeats: allowed } as unknown as BuildOverrides, {
        classSkills: ['athletics', 'stealth', 'nature'],
        featPicks: { '2:class:0': 'magaambyan-attendant-dedication' },
        enabledSources: [...BOOKS, ...['magaambyan-attendant-dedication', 'blackjacket-dedication'].map((id) => db.feats[id].source!.book)],
      });
    const rowOf = async (b: BuildState) => {
      const { r } = open(b);
      r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '4') ?? null);
      await flush();
      r.click(r.host.querySelector('[data-ctl-title="Class feat"][data-ctl-state="empty"]'));
      await flush();
      r.click(document.querySelector('button.fsel-arch'));
      await flush();
      const input = document.querySelector<HTMLInputElement>('.fsel-results-search input')!;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setter.call(input, 'Blackjacket Dedication');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await flush();
      const row = [...document.querySelectorAll<HTMLElement>('.pick-row')].find((x) => (x.querySelector('.picker-name')?.textContent ?? '').startsWith('Blackjacket Dedication'));
      const out = row ? (row.textContent ?? '') : null;
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
      return out;
    };
    expect(await rowOf(mag(['magaambyan-attendant-dedication'])), 'no allow: hidden as ineligible (the dedication gate)').toBeNull();
    expect(await rowOf(mag(['magaambyan-attendant-dedication', 'blackjacket-dedication'])), 'the allow: offered').toContain('Allowed by a tweak.');
  });
});

describe('open spell choices: the reveal and its reasons', () => {
  it('reveal returns the tradition-filtered spells greyed and liftable; never "already your … cantrip"', () => {
    const b = ADEPT();
    const ch = built(b);
    const from = db.feats['adaptive-adept'].choice!.from;
    const plain = openChoiceOptions(from, db, { character: ch, keep: [] });
    const shown = openChoiceOptions(from, db, { character: ch, keep: [], reveal: true });
    expect(shown.length).toBeGreaterThan(plain.length);
    const extra = shown.filter((o) => !plain.some((p) => p.id === o.id));
    expect(extra.every((o) => o.notAllowed && o.liftable)).toBe(true);
    expect(shown.some((o) => o.id === 'healing-plaster'), 'the Adapted Cantrip answer itself is never offered').toBe(false);
    expect(plain.every((o) => !o.notAllowed), 'without the reveal: today\'s list').toBe(true);
    const lifted = openChoiceOptions(from, db, { character: ch, keep: [], allowed: (id) => id === 'join-pasts' });
    expect(lifted.find((o) => o.id === 'join-pasts')?.notAllowed, 'a live allow: offered, unmarked').toBeUndefined();
  });
  it('an allow naming the Adapted Cantrip answer itself never re-offers it to Adaptive Adept (the engine refuses it)', () => {
    const ch = built(ADEPT([allow('spell', 'healing-plaster')]));
    const from = db.feats['adaptive-adept'].choice!.from;
    const opts = openChoiceOptions(from, db, { character: ch, keep: [], allowed: (id) => id === 'healing-plaster' });
    expect(opts.some((o) => o.id === 'healing-plaster')).toBe(false);
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
function open(initial: BuildState) {
  let saved: BuildState | null = null;
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }));
  stops.push(r.stop);
  // A built character opens on a level page; Setup is the strip's '0'.
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
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
const heritageCtl = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-ctl-title="Heritage"]')!;
async function openHeritage(r: ReturnType<typeof open>['r']) {
  const ctl = heritageCtl(r.host);
  r.click(ctl.querySelector('.ss-replace') ?? ctl);
  await flush();
}
const overlay = () => document.querySelector<HTMLElement>('.picker-overlay');
/** Type into the open picker's search box the way React sees a keystroke (the revealed list passes the row cap). */
async function search(text: string) {
  const input = overlay()!.querySelector<HTMLInputElement>('input.name-input')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}

describe('the Setup heritage picker', () => {
  it('Tweaks off: no reveal, no button; the option and live counts match Tweaks on with the reveal off', async () => {
    const counts = (b: BuildState) => {
      const { r } = open(b);
      const d = heritageCtl(r.host).dataset;
      const out = [Number(d.ctlOptions), Number(d.ctlLive)];
      r.stop();
      stops.pop();
      return out;
    };
    const offCounts = counts(off(hero(db, 'fighter', 3, ov())));
    expect(offCounts[0]).toBeGreaterThan(0);
    expect(offCounts[1], 'nothing greyed with Tweaks off').toBe(offCounts[0]);
    expect(counts(hero(db, 'fighter', 3, ov())), 'Tweaks on, reveal off: the same list').toEqual(offCounts);
    const { r } = open(off(hero(db, 'fighter', 3, ov())));
    await openHeritage(r);
    expect(overlay()!.querySelector('.tw-reveal')).toBeNull();
    expect(overlay()!.querySelector('[data-breakable]')).toBeNull();
  });

  it('Tweaks on: the reveal starts off; on, another ancestry\'s heritage is greyed with its reason and "Take anyway" — one write, one undo step', async () => {
    const { r, saved } = open(hero(db, 'fighter', 3, ov()));
    await openHeritage(r);
    const reveal = overlay()!.querySelector<HTMLInputElement>('.tw-reveal input')!;
    expect(reveal.checked, 'default off').toBe(false);
    expect(overlay()!.querySelector('[data-breakable]')).toBeNull();
    act(() => reveal.click());
    await flush();
    // Ancient Elf (Player Core): a book this character has on. (Desert Elf's book is off for it: the reveal lists the
    // books the character uses, like every picker; a stored or allowed record still shows — C45 and the Add flow.)
    await search('Ancient Elf');
    const row = [...overlay()!.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === 'Ancient Elf')!;
    expect(row, 'Ancient Elf greyed with a button').toBeTruthy();
    expect(row.querySelector('.picker-why')?.textContent).toBe('Not a heritage of your Human ancestry.');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('Ancient Elf');
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    // The Setup card: the name with the live mark.
    expect(heritageCtl(r.host).textContent).toContain('Ancient Elf');
    expect(r.host.querySelector('[data-tweak-mark="choice.allowAnywayAnyPicker"][data-tweak-state="live"]')).toBeTruthy();
    // One undo step takes the pick AND the tweak back.
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await flush();
    expect(heritageCtl(r.host).textContent).not.toContain('Ancient Elf');
    expect(r.host.querySelector('[data-tweak-mark]')).toBeNull();
    // Redo, then Save: both are stored.
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })));
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.heritageId).toBe('ancient-elf');
    expect(allowedInPicker(b, 'heritage', 'ancient-elf')).toBe(true);
    expect(readTweaks(b.overrides).instances.filter((i) => i.kind === 'choice.allowAnywayAnyPicker')).toHaveLength(1);
  });

  it('C45: a stored heritage of another ancestry shows by NAME — greyed with the reason with no block / Tweaks off; the mark live or paused', async () => {
    const cases: [string, BuildState, 'grey' | 'live' | 'paused'][] = [
      ['no block', ELF_ON_HUMAN(), 'grey'],
      ['Tweaks off', off(ELF_ON_HUMAN([allow('heritage', 'desert-elf')])), 'grey'],
      ['paused', ELF_ON_HUMAN([allow('heritage', 'desert-elf', {}, false)]), 'paused'],
      ['live', ELF_ON_HUMAN([allow('heritage', 'desert-elf')]), 'live'],
    ];
    for (const [what, b, want] of cases) {
      const { r } = open(b);
      expect(heritageCtl(r.host).querySelector('.popsel-val')?.textContent, `${what}: the name`).toBe('Desert Elf');
      expect(heritageCtl(r.host).hasAttribute('data-pick-grey'), `${what}: greyed`).toBe(want !== 'live');
      const grey = r.host.querySelector('[data-book-grey]');
      const mark = r.host.querySelector<HTMLElement>('[data-tweak-mark="choice.allowAnywayAnyPicker"]');
      if (want === 'grey') {
        expect(grey?.textContent, what).toContain('Not a heritage of your Human ancestry.');
        expect(mark, what).toBeNull();
      } else {
        expect(grey, what).toBeNull();
        expect(mark?.dataset.tweakState, what).toBe(want);
      }
      r.stop();
      stops.pop();
    }
  });

  it('the mark offers "Show in Tweaks" (C28), which opens the Tweaks page', async () => {
    const { r } = open(ELF_ON_HUMAN([allow('heritage', 'desert-elf')]));
    r.click(r.host.querySelector('[data-tweak-mark="choice.allowAnywayAnyPicker"] .tw-mark-chip'));
    await flush();
    const show = r.host.querySelector<HTMLButtonElement>('.tw-mark-show');
    expect(show, 'Show in Tweaks').toBeTruthy();
    r.click(show);
    await flush();
    // The Tweaks page opens with THIS tweak's row open (the focus key is the block's key).
    expect(r.host.querySelector('li.tw-row.open')?.textContent, 'the allow\'s own row, open').toContain('Desert Elf');
  });

  it('Cancel writes nothing: at the Take anyway confirm, and at the loss confirm after it', async () => {
    const start = hero(db, 'fighter', 3, ov(), { heritageId: 'skilled-human', heritageSkill: 'athletics' } as Partial<BuildState>);
    const { r, saved } = open(start);
    const takeElf = async () => {
      await openHeritage(r);
      const reveal = overlay()!.querySelector<HTMLInputElement>('.tw-reveal input')!;
      if (!reveal.checked) act(() => reveal.click());
      await flush();
      await search('Ancient Elf');
      r.click([...overlay()!.querySelectorAll<HTMLElement>('[data-breakable]')].find((x) => x.querySelector('.picker-name')?.textContent === 'Ancient Elf')!.querySelector('button.tw-break-act'));
      await flush();
    };
    await takeElf();
    r.click(dialogButton('Cancel'));
    await flush();
    await flush();
    expect(document.querySelector('.confirm-modal'), 'the first confirm closed').toBeNull();
    for (const o of [...document.querySelectorAll('.picker-overlay .picker-close')]) r.click(o);
    await flush();
    await takeElf();
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent, 'the loss confirm names the heritage skill').toContain('Heritage skill');
    r.click(dialogButton('Cancel'));
    await flush();
    await flush();
    for (const o of [...document.querySelectorAll('.picker-overlay .picker-close')]) r.click(o);
    await flush();
    expect(heritageCtl(r.host).textContent).toContain('Skilled Human');
    expect(r.host.querySelector('[data-tweak-mark]')).toBeNull();
    await save(r);
    const b = saved()!;
    expect(b.heritageId).toBe('skilled-human');
    expect(b.heritageSkill).toBe('athletics');
    expect(readTweaks(b.overrides).instances).toHaveLength(0);
  });
});

describe('the Setup cause card (a champion whose sanctification refuses the stored cause)', () => {
  it('no block: greyed by name with the book line; live: the mark, no grey; paused: the mark says paused', () => {
    const want: [BuildState, 'grey' | 'live' | 'paused'][] = [
      [GRANDEUR(), 'grey'],
      [GRANDEUR([allow('subclass', 'grandeur', { classId: 'champion' })]), 'live'],
      [GRANDEUR([allow('subclass', 'grandeur', { classId: 'champion' }, false)]), 'paused'],
    ];
    for (const [b, state] of want) {
      const { r } = open(b);
      const mark = r.host.querySelector<HTMLElement>('[data-tweak-mark="choice.allowAnywayAnyPicker"]');
      const grey = r.host.querySelector('[data-book-grey]');
      if (state === 'grey') {
        expect(grey?.textContent, state).toContain('Needs a holy sanctification.');
        expect(mark, state).toBeNull();
      } else {
        expect(mark?.dataset.tweakState, state).toBe(state);
        expect(grey, state).toBeNull();
      }
      r.stop();
      stops.pop();
    }
  });
});

describe('the spell picker (a wizard\'s 1st-rank book)', () => {
  async function openRank1(r: ReturnType<typeof open>['r']) {
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
    await flush();
    r.click(r.host.querySelector('[data-ctl-title="Rank 1 spell"]'));
    await flush();
  }
  const fsel = () => document.querySelector<HTMLElement>('.fsel-results-bar')?.closest<HTMLElement>('.fsel-body') ?? null;
  async function find(name: string) {
    const input = fsel()!.querySelector<HTMLInputElement>('.fsel-results-search input')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, name);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flush();
    return [...fsel()!.querySelectorAll<HTMLElement>('.pick-row')].find((x) => x.querySelector('.picker-name')?.textContent === name) ?? null;
  }
  it('Tweaks off: no reveal; Tweaks on: the reveal starts off, on it Heal is greyed with "Not on the Arcane spell list." and one write takes it', async () => {
    {
      const { r } = open(off(hero(db, 'wizard', 1, ov())));
      await openRank1(r);
      expect(fsel()!.querySelector('.tw-reveal')).toBeNull();
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
    }
    const { r, saved } = open(hero(db, 'wizard', 1, ov()));
    await openRank1(r);
    const reveal = fsel()!.querySelector<HTMLInputElement>('.tw-reveal input')!;
    expect(reveal.checked).toBe(false);
    expect(await find('Heal'), 'not listed with the reveal off').toBeNull();
    act(() => reveal.click());
    await flush();
    const row = (await find('Heal'))!;
    expect(row.hasAttribute('data-breakable')).toBe(true);
    expect(row.querySelector('.picker-why')?.textContent).toBe('Not on the Arcane spell list.');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.spells[1]).toContain('heal');
    expect(allowedInPicker(b, 'spell', 'heal')).toBe(true);
  });
});

describe('the Tweaks page alone creates the allow; the picker then offers it un-greyed with the mark', () => {
  it('Add → "Take anyway" in another picker → Heritage → Desert Elf', async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 3, ov()));
    stops.push(t.stop);
    await openMenu(t.host, '"Take anyway" in another picker');
    await pickPart(addEditor(t.host)!, 'Picker', 'Heritage');
    await pickPart(addEditor(t.host)!, 'Heritage', 'Desert Elf');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(allowedInPicker(b, 'heritage', 'desert-elf')).toBe(true);
    const { r } = open(b);
    await openHeritage(r);
    // The reveal stays OFF: an allowed record is offered without it (the plan's "Done when").
    expect(overlay()!.querySelector<HTMLInputElement>('.tw-reveal input')!.checked).toBe(false);
    await search('Desert Elf');
    const row = [...overlay()!.querySelectorAll<HTMLElement>('.pick-row')].find((x) => x.querySelector('.picker-name')?.textContent === 'Desert Elf')!;
    expect(row, 'offered with the reveal off').toBeTruthy();
    expect(row.hasAttribute('data-breakable'), 'un-greyed').toBe(false);
    expect(row.textContent).toContain('Allowed by a tweak');
  });
  it('the Add flow lists the causes of every class the character HOLDS (a leftover second class with Dual Class off is not one)', async () => {
    const t = mountTweaks(db, hero(db, 'champion', 3, ov(), { classId2: 'cleric' } as Partial<BuildState>));
    stops.push(t.stop);
    await openMenu(t.host, '"Take anyway" in another picker');
    await pickPart(addEditor(t.host)!, 'Picker', 'Subclass');
    await pickPart(addEditor(t.host)!, 'Subclass', 'Grandeur');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    expect(allowedInPicker(t.build(), 'subclass', 'grandeur', { classId: 'champion' })).toBe(true);
  });
});

describe('the Tweaks page: registry, switch-off groups, repoint', () => {
  it('the kind is built and off STILL_TO_ADD', () => {
    expect(blockKind('choice.allowAnywayAnyPicker')!.editor!.built).toBe(true);
    expect(blockKind('choice.allowAnywayAnyPicker')!.applies).toBe('blocks');
    expect(STILL_TO_ADD.some((s) => s.id === 'choice.allowAnywayAnyPicker')).toBe(false);
  });
  it('C33: Adaptive Adept\'s off-tradition answer stops counting; the Adapted Cantrip answer and a sanctification stay', () => {
    // Merge check 4: the NAMED item is in its group, not only a group of the right size.
    const adept = ADEPT([allow('spell', 'join-pasts')]);
    expect(tweaksTurnOffList(adept, db).choices.stops).toEqual([expect.stringContaining('Join Pasts')]);
    expect(tweaksTurnOffList(adept, db).choices.stays).toEqual([]);
    const adapted = hero(db, 'wizard', 3, ov(allow('spell', 'frosts-touch')), { featPicks: { '1:ancestry:0': 'adapted-cantrip' }, featChoices: { '1:ancestry:0': 'frosts-touch' } });
    expect(tweaksTurnOffList(adapted, db).choices.stays).toEqual([expect.stringContaining("Frost's Touch")]);
    expect(tweaksTurnOffList(adapted, db).choices.stops).toHaveLength(0);
    const sanct = SANCT([allow('sanctification', 'cleric-dedication', { value: 'unholy' })]);
    expect(tweaksTurnOffList(sanct, db).choices.stays).toEqual([expect.stringMatching(/Cleric Dedication|Unholy/)]);
  });
  it('a broken subclass allow points only at its class\'s own options (the WP2 check finding)', () => {
    const b = hero(db, 'champion', 3, ov(allow('subclass', 'no-such-cause', { classId: 'champion' })));
    const row = tweakRows(b, built(b), db).find((x) => x.kind === 'choice.allowAnywayAnyPicker')!;
    expect(row.broken).toBeTruthy();
    expect(row.repoint).toEqual({ records: ['classFeatures'], only: db.classes.champion.subclass!.options.map((o) => o.id) });
  });
});

/* ------------------------------------------------ WP4 finish: the plan tests the first job left (A1-A6) -------- */

/** Open a page's control by its `data-ctl-title` (a SearchSelect's ✎ or a PopupSelect's face). */
async function openCtl(r: ReturnType<typeof open>['r'], title: string, page?: string) {
  if (page) {
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
    await flush();
  }
  const ctl = r.host.querySelector<HTMLElement>(`[data-ctl-title="${title}"]`);
  expect(ctl, `control "${title}"`).toBeTruthy();
  r.click(ctl!.querySelector('.ss-replace') ?? ctl);
  await flush();
}
const breakRows = () => [...(overlay()?.querySelectorAll<HTMLElement>('[data-breakable]') ?? [])];
// A row's name may carry its option's gloss ("Unholy — gain the unholy trait; …").
const breakRow = (name: string) =>
  breakRows().find((x) => {
    const t = x.querySelector('.picker-name')?.textContent ?? '';
    return t === name || t.startsWith(`${name} — `);
  }) ?? null;
const BROKEN_SCALES = 'Pathfinder Society Quest #10: The Broken Scales';

describe('A1: per picker, "Take anyway" only with Tweaks on, and only on a rule grey', () => {
  /** Mount `b` and its Tweaks-off twin, open the control, and read the greyed row named `name`. */
  async function both(b: BuildState, title: string, name: string, reason: string, o: { page?: string; find?: string; reveal?: boolean } = {}) {
    // Merge check 4 (C20): the control's option and live counts are the same with Tweaks off as with Tweaks on and
    // the reveal off — Take anyway adds a button, never a live option, and Tweaks off is the book's own list.
    const counts: Record<string, [number, number]> = {};
    for (const on of [true, false]) {
      const { r } = open(on ? b : off(b));
      await openCtl(r, title, o.page);
      const d = r.host.querySelector<HTMLElement>(`[data-ctl-title="${title}"]`)!.dataset;
      counts[String(on)] = [Number(d.ctlOptions), Number(d.ctlLive)];
      expect(counts[String(on)][0], `${title}: options counted`).toBeGreaterThan(0);
      if (o.reveal && on) {
        const rv = overlay()!.querySelector<HTMLInputElement>('.tw-reveal input');
        expect(rv, `${title}: the reveal`).toBeTruthy();
        expect(rv!.checked, `${title}: the reveal starts off`).toBe(false);
        act(() => rv!.click());
        await flush();
      }
      if (!on) expect(overlay()!.querySelector('.tw-reveal'), `${title}, Tweaks off: no reveal`).toBeNull();
      if (o.find) await search(o.find);
      if (on) {
        const row = breakRow(name);
        expect(row, `${title}: ${name} greyed with the button`).toBeTruthy();
        expect(row!.querySelector('.picker-why')?.textContent, `${title}: the rule`).toBe(reason);
        expect(row!.querySelector('button.tw-break-act')?.textContent?.trim()).toBe('Take anyway');
        // C20 / C5: the row's own body stays disabled for the plain pick.
        expect(row!.querySelector<HTMLButtonElement>('button.tw-break-body')!.disabled).toBe(true);
      } else {
        expect(breakRows(), `${title}, Tweaks off: no button anywhere`).toEqual([]);
        if (!o.reveal) expect(overlay()!.textContent, `${title}, Tweaks off: still greyed and saying why`).toContain(reason);
      }
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
    }
    expect(counts.false, `${title}: Tweaks off counts = Tweaks on (reveal off) counts`).toEqual(counts.true);
    // A rule grey exists, so with Tweaks off fewer options are live than listed (the grey never became live).
    if (!o.reveal) expect(counts.false[1], `${title}: the greyed option is not live`).toBeLessThan(counts.false[0]);
  }
  it('background: Sewer Dragon on a Human — "Requires the Kobold ancestry."', async () => {
    await both(hero(db, 'fighter', 3, ov(), { enabledSources: [...BOOKS, BROKEN_SCALES] }), 'Background', 'Sewer Dragon', 'Requires the Kobold ancestry.', { find: 'Sewer Dragon' });
  });
  it("deity: a Razmiran priest's Cleric Dedication greys every deity but Razmir", async () => {
    const b = RAZMIRAN();
    b.deityId = 'razmir';
    const name = Object.values(db.deities).find((d) => d.id !== 'razmir' && d.source?.book === 'Pathfinder Lost Omens Divine Mysteries')!.name;
    const reason = `Not allowed: ${deityNamedBy(b, db)!.reason}`;
    await both(b, 'Deity', name, reason, { find: name });
  });
  it('both subclass pickers (Setup and the Level 1 page): a cause the unholy champion may not take', async () => {
    const b = GRANDEUR();
    b.subclassId = 'desecration';
    const cause = db.classes.champion.subclass!.name;
    await both(b, cause, 'Grandeur', 'Needs a holy sanctification.');
    await both(b, cause, 'Grandeur', 'Needs a holy sanctification.', { page: '1' });
  });
  it('both subclass pickers: a champion of Iomedae (must be holy) who has not answered their sanctification yet', async () => {
    // Found 2026-10-27 by the WP13 browser test: with Deity and Cause's own answer empty, Desecration was a plain
    // choice. The deity's Sanctification entry limits the answer before any click (test/champion-cause-sanctification).
    const b = GRANDEUR();
    b.deityId = 'iomedae';
    b.featChoices = {};
    const cause = db.classes.champion.subclass!.name;
    const reason = 'Needs an unholy sanctification. Iomedae allows only: holy.';
    await both(b, cause, 'Desecration', reason);
    await both(b, cause, 'Desecration', reason, { page: '1' });
  });
  it("the Dual Class second class's subclass picker: a Fighter/Champion of Iomedae who has not answered", async () => {
    // 2026-10-27, the independent check of the fix above: the second class's cause picker had no grey at all.
    const b = hero(db, 'fighter', 3, ov(), {
      deityId: 'iomedae',
      enabledSources: BOOKS,
      variantRules: { dualClass: true } as BuildState['variantRules'],
      classId2: 'champion',
      subclassId2: 'justice',
    });
    await both(b, db.classes.champion.subclass!.name, 'Desecration', 'Needs an unholy sanctification. Iomedae allows only: holy.');
  });
  it('Deity and Cause\'s Sanctification shows Holy for a champion of Iomedae who never clicked (shown, not stored)', async () => {
    // 2026-10-27, the third check: the sheet had the holy trait while the picker still looked like an open question.
    const b = GRANDEUR();
    b.deityId = 'iomedae';
    b.subclassId = 'justice';
    b.featChoices = {};
    const { r, saved } = open(b);
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
    await flush();
    expect(r.host.querySelector('[data-ctl-title="Sanctification"]')?.textContent).toContain('Holy');
    await save(r);
    expect(saved()!.featChoices['feature:deity-champion'], 'nothing written').toBeUndefined();
  });
  it('…and pressing "Take anyway" there writes the SECOND class\'s cause and its allow, nothing else', async () => {
    const b = hero(db, 'fighter', 3, ov(), {
      deityId: 'iomedae',
      enabledSources: BOOKS,
      variantRules: { dualClass: true } as BuildState['variantRules'],
      classId2: 'champion',
      subclassId2: 'justice',
    });
    const { r, saved } = open(b);
    await openCtl(r, db.classes.champion.subclass!.name);
    r.click(breakRow('Desecration')!.querySelector('button.tw-break-act'));
    await flush();
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    // The first class's losses are never asked about for the second class's pick.
    expect(document.querySelector('.confirm-modal'), 'no loss confirm').toBeNull();
    await save(r);
    const s = saved()!;
    expect(s.subclassId2).toBe('desecration');
    expect(s.subclassId ?? null, 'the first class untouched').toBe(b.subclassId ?? null);
    expect(allowedInPicker(s, 'subclass', 'desecration', { classId: 'champion' })).toBe(true);
    expect(readTweaks(s.overrides).instances).toHaveLength(1);
  });
  it('sanctification: Otolmens refuses unholy on Cleric Dedication', async () => {
    const b = SANCT();
    b.featChoices = {};
    const reason = sanctificationBookReason('cleric-dedication', 'unholy', b, db)!;
    await both(b, 'Sanctification', 'Unholy', reason, { page: '2' });
  });
  it('open spell (Adaptive Adept): the reveal starts off; on, another tradition\'s cantrip is greyed with the button', async () => {
    const b = ADEPT();
    b.featChoices = { '1:ancestry:0': 'healing-plaster' };
    const from = db.feats['adaptive-adept'].choice!.from;
    const ch = built(b);
    const plain = new Set(openChoiceOptions(from, db, { character: ch, keep: [] }).map((o) => o.id));
    const shown = openChoiceOptions(from, db, { character: ch, keep: [], reveal: true }).find((o) => !plain.has(o.id) && o.liftable && o.notAllowed && db.spells[o.id]?.source?.book === 'Pathfinder Player Core')!;
    const title = featChoicePrompt(db.feats['adaptive-adept'].choice!.prompt, db.feats['adaptive-adept'].choice!.flag);
    await both(b, title, shown.name, shown.notAllowed!, { page: '5', reveal: true, find: shown.name });
  });
});

describe('A2: sanctification — Take anyway on "unholy" writes the answer and the allow in ONE undo step', () => {
  it('Otolmens (holy or none), Cleric Dedication: the pick, the tweak, Ctrl+Z takes both back, Save keeps both', async () => {
    const b = SANCT();
    b.featChoices = {};
    const { r, saved } = open(b);
    await openCtl(r, 'Sanctification', '2');
    r.click(breakRow('Unholy')!.querySelector('button.tw-break-act'));
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('Unholy');
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    const ctl = () => r.host.querySelector<HTMLElement>('[data-ctl-title="Sanctification"]')!;
    expect(ctl().textContent).toContain('Unholy');
    expect(r.host.querySelector('[data-tweak-mark="choice.allowAnywayAnyPicker"][data-tweak-state="live"]')).toBeTruthy();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await flush();
    expect(ctl().textContent, 'one undo: the answer is gone').not.toContain('Unholy');
    expect(r.host.querySelector('[data-tweak-mark]'), 'one undo: the tweak is gone').toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })));
    await flush();
    await save(r);
    const s = saved()!;
    expect(s.featChoices['2:class:0']).toBe('unholy');
    expect(allowedInPicker(s, 'sanctification', 'cleric-dedication', { value: 'unholy' })).toBe(true);
    expect(readTweaks(s.overrides).instances).toHaveLength(1);
  });
});

describe("A3: the taken pick's grants reach the built Character", () => {
  it("the heritage's grants: Spined Azarketi on a Human strikes with its spine", async () => {
    const b = hero(db, 'fighter', 3, ov(allow('heritage', 'spined-azarketi')), { heritageId: 'spined-azarketi' });
    expect(deriveStrikes(built(b), db).some((s) => /spine/i.test(s.name))).toBe(true);
  });
  it("the deity's skill: Kostchtchie taken anyway by a Razmiran priest's Cleric Dedication trains Athletics (Razmir's would be Deception)", () => {
    const skills = (b: BuildState) => built(b).proficiencies.skills;
    const taken = skills(RAZMIRAN([allow('deity', 'kostchtchie')]));
    expect(taken.athletics).toBe('trained');
    expect(taken.deception).toBe('untrained');
    const razmir = RAZMIRAN();
    razmir.deityId = 'razmir';
    expect(skills(razmir).athletics, 'the book pick for contrast').toBe('untrained');
  });
  it("the subclass's grants: an unholy champion's Grandeur brings Flash of Grandeur", async () => {
    const ch = built(GRANDEUR([allow('subclass', 'grandeur', { classId: 'champion' })]));
    expect(ch.subclassId).toBe('grandeur');
    expect(ownedFeatureIds(ch, db).has('flash-of-grandeur')).toBe(true);
  });
});

describe('A4: Adapted Cantrip answered with the wizard\'s OWN (arcane) cantrip through Take anyway (plan r3)', () => {
  const ADAPTED = (cantrip: string, blocks: object[] = []) =>
    hero(db, 'wizard', 3, ov(...blocks), { featPicks: { '1:ancestry:0': 'adapted-cantrip' }, featChoices: { '1:ancestry:0': cantrip } });
  const inEntry = (b: BuildState, id: string) => entrySpells(built(b)).includes(id);
  it('the cantrip joins the class entry; paused and with Tweaks off it STAYS (the engine never dropped it — NUMBER 0)', () => {
    expect(inEntry(ADAPTED('frosts-touch', [allow('spell', 'frosts-touch')]), 'frosts-touch')).toBe(true);
    expect(inEntry(ADAPTED('frosts-touch', [allow('spell', 'frosts-touch', {}, false)]), 'frosts-touch')).toBe(true);
    expect(inEntry(off(ADAPTED('frosts-touch', [allow('spell', 'frosts-touch')])), 'frosts-touch')).toBe(true);
  });
  it('the Builder: taken through the reveal; paused, the answer shows by NAME with "Tweak paused"', async () => {
    const title = featChoicePrompt(db.feats['adapted-cantrip'].choice!.prompt, db.feats['adapted-cantrip'].choice!.flag);
    {
      const b = ADAPTED('');
      b.featChoices = {};
      b.enabledSources = [...BOOKS, 'Pathfinder Treasure Vault (Remastered)'];
      const { r, saved } = open(b);
      await openCtl(r, title, '1');
      act(() => overlay()!.querySelector<HTMLInputElement>('.tw-reveal input')!.click());
      await flush();
      await search("Frost's Touch");
      const row = breakRow("Frost's Touch");
      expect(row, "Frost's Touch greyed (the wizard's own tradition)").toBeTruthy();
      r.click(row!.querySelector('button.tw-break-act'));
      await flush();
      r.click(dialogButton('Take anyway'));
      await flush();
      await flush();
      await save(r);
      expect(saved()!.featChoices['1:ancestry:0']).toBe('frosts-touch');
      expect(allowedInPicker(saved()!, 'spell', 'frosts-touch')).toBe(true);
      r.stop();
      stops.pop();
      for (const n of [...document.body.children]) n.remove();
    }
    const { r } = open(ADAPTED('frosts-touch', [allow('spell', 'frosts-touch', {}, false)]));
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
    await flush();
    const ctl = r.host.querySelector<HTMLElement>(`[data-ctl-title="${title}"]`)!;
    expect(ctl.textContent, 'the name, never the placeholder').toContain("Frost's Touch");
    expect(r.host.querySelector<HTMLElement>('[data-tweak-mark="choice.allowAnywayAnyPicker"]')?.dataset.tweakState).toBe('paused');
  });
  it('a cantrip of NO tradition: paused, the openAnswerBarred line returns while the cantrip still counts', () => {
    const none = Object.values(db.spells).find((s) => s.rank === 0 && !s.traditions.length && !s.traits.includes('focus'))!;
    const line = (b: BuildState) => levelChoices(b, db).some((c) => c.page === 1 && c.label === 'Adapted Cantrip — choose again');
    const live = ADAPTED(none.id, [allow('spell', none.id)]);
    const paused = ADAPTED(none.id, [allow('spell', none.id, {}, false)]);
    expect(line(live), 'live: no line').toBe(false);
    expect(line(paused), 'paused: the line returns').toBe(true);
    expect(inEntry(paused, none.id), 'the cantrip still counts').toBe(true);
  });
});

describe('A5: a homebrew heritage taken anyway travels to the GM\'s device (carried.ts)', () => {
  it('taken through the Setup picker\'s reveal, the saved character carries the homebrew heritage', async () => {
    const HB = { license: 'homebrew', book: 'Tidewater Notes' };
    const hb = { id: 'hb-heritage-mistborn', name: 'Mistborn Elf', traits: [], ancestryId: 'elf', source: HB } as unknown as (typeof db.heritages)[string];
    const withHb = { ...db, heritages: { ...db.heritages, [hb.id]: hb } } as typeof db;
    let saved: BuildState | null = null;
    const r = renderDom(
      createElement(Builder, { content: withHb, initial: hero(db, 'fighter', 3, ov(), { enabledSources: [...BOOKS, HB.book] }), onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }),
    );
    stops.push(r.stop);
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
    await openHeritage(r);
    act(() => overlay()!.querySelector<HTMLInputElement>('.tw-reveal input')!.click());
    await flush();
    await search('Mistborn Elf');
    r.click(breakRow('Mistborn Elf')!.querySelector('button.tw-break-act'));
    await flush();
    r.click(dialogButton('Take anyway'));
    await flush();
    await flush();
    await save(r);
    const b = saved as BuildState | null;
    expect(b?.heritageId).toBe(hb.id);
    const carried = collectCarried({ build: b }, withHb, { isPrinted: (_t, id) => id !== hb.id });
    expect(Object.keys(carried?.heritages ?? {})).toEqual([hb.id]);
  });
});
