// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP9 step 4 only: a stored answer the picker's list does not offer is drawn as its own row BY NAME,
 * greyed with the book's look and words saying what the sheet does with it — never as the picker's placeholder
 * (plan C26's kept row, C45's spirit; gold-set Q27). Display only: nothing is written, and the engine is untouched.
 *
 * One case per picker family (11), Tweaks on and off, plus the unanswered placeholder, the picker's own rows, the
 * no-write check, and the two derived-sheet numbers the words rest on (K2). Synthetic characters only.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement, act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { OriginPickers, type BuilderActions } from '../src/builder/shared';
import { KEPT_WORDS, keptValues, withKeptAnswer } from '../src/builder/keptAnswer';
import { buildCharacter, emptyBuild, featChoicePrompt, withCustomAnswer, type BuildState } from '../src/rules/build';
import { deriveDefenses, deriveSize } from '../src/rules/derive';
import type { FeatChoiceDef } from '../src/rules/types';

const db = content();
const noop = () => undefined;
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
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

/** A level-5 fighter, Tweaks on unless `off`. */
const pc = (over: Partial<BuildState> = {}, off = false): BuildState =>
  JSON.parse(
    JSON.stringify({
      ...emptyBuild(),
      name: 'Kept answer fixture',
      level: 5,
      classId: 'fighter',
      keyAbility: 'str',
      subclassSkill: 'acrobatics',
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      options: { overridesEnabled: !off },
      ...over,
    }),
  ) as BuildState;

/** The origins page, with an `actions` that records every call (rendering must make none). */
function origin(build: BuildState) {
  const calls: string[] = [];
  const actions = new Proxy({}, { get: (_t, k) => (..._a: unknown[]) => void calls.push(String(k)) }) as unknown as BuilderActions;
  const r = renderDom(createElement(OriginPickers, { build, actions, content: db }));
  stops.push(r.stop);
  return { host: r.host, calls };
}

/** A Builder page (the level strip's button), and whether anything was saved. */
function page(initial: BuildState, lvl: string) {
  let saved = false;
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: noop, onCreate: () => void (saved = true) }));
  stops.push(r.stop);
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === lvl) ?? null);
  return { host: r.host, saved: () => saved };
}

/** The picker control titled `title` (a PopupSelect's `.popsel`), the `n`-th when several share it. */
function control(host: HTMLElement, title: string, n = 0): HTMLElement | null {
  const all = [...host.querySelectorAll<HTMLElement>('.popsel[data-ctl-title]')].filter((el) => el.getAttribute('data-ctl-title') === title);
  return all[n] ?? null;
}
/** The book's grey line drawn right after a control (C45's `BookGreyLine`). */
const lineAfter = (el: HTMLElement | null) => {
  const next = el?.nextElementSibling;
  return next?.hasAttribute('data-book-grey') ? (next.textContent ?? '').trim() : null;
};

/** One picker family's expectations. */
type Fam = {
  name: string;
  /** The stored off-list value on the character, and the same character unanswered. */
  kept: BuildState;
  bare: BuildState;
  where: 'origin' | string;
  title: string;
  label: string;
  words: string;
  placeholder?: string;
};

const fetchling = { ancestryId: 'fetchling', heritageId: 'deep-fetchling' };
const dwarf = { ancestryId: 'dwarf', heritageId: 'elemental-heart-dwarf' };
const automaton = { ancestryId: 'automaton', heritageId: null };
const kobold = { ancestryId: 'kobold', heritageId: 'dragonscaled-kobold' };
const hdef = db.heritages['elemental-heart-dwarf'].choice!;
const adef = db.ancestries.automaton.choice!;
const bdef = db.backgrounds['energy-scarred'].choice!;
const cdef = db.feats['canny-acumen'].choice!;
const vdef = db.feats['specialty-crafting'].choice!;
const words = (label: string, tail: string) => `${label} — ${tail}`;
const ignoredFor = (instead: string) => `${KEPT_WORDS.ignored.slice(0, -1)}; it uses ${instead} instead)`;

const FAMILIES: Fam[] = [
  {
    name: 'heritage resistance (counts)',
    kept: pc({ ...fetchling, heritageResistanceChoice: 'fire' }),
    bare: pc({ ...fetchling, heritageResistanceChoice: null }),
    where: 'origin',
    title: 'Resistance type',
    label: 'Fire',
    words: words('Fire', KEPT_WORDS.counts),
    placeholder: 'Choose a resistance',
  },
  {
    name: 'the heritage choice (no option grants: maybe)',
    kept: pc({ ...dwarf, featChoices: { 'heritage:elemental-heart-dwarf': 'sonic' } }),
    bare: pc({ ...dwarf }),
    where: 'origin',
    title: hdef.prompt,
    label: 'Sonic',
    words: words('Sonic', KEPT_WORDS.maybe),
  },
  {
    name: 'the ancestry body size (ignored, the record size stands)',
    kept: pc({ ...automaton, featChoices: { 'ancestry:automaton': 'large' } }),
    bare: pc({ ...automaton }),
    where: 'origin',
    title: adef.prompt,
    label: 'Large',
    words: words('Large', ignoredFor('Medium')),
  },
  {
    name: 'the background choice (counts)',
    kept: pc({ backgroundId: 'energy-scarred', featChoices: { 'background:energy-scarred': 'poison' } }),
    // Unanswered, the engine's own default (options[0]) shows as picked, as today.
    bare: pc({ backgroundId: 'energy-scarred' }),
    where: 'origin',
    title: featChoicePrompt(bdef.prompt, bdef.flag),
    label: 'Poison',
    words: words('Poison', KEPT_WORDS.counts),
  },
  {
    name: 'the class key attribute (counts)',
    kept: pc({ keyAbility: 'int' }),
    bare: pc({ keyAbility: null }),
    where: 'origin',
    title: 'Key attribute',
    // The pills' own word (ABILITY_LABEL), as the picker's other rows read.
    label: 'Int',
    words: words('Int', KEPT_WORDS.counts),
  },
  {
    name: 'the background trained skill (ignored, the first option instead)',
    kept: pc({ backgroundId: 'animal-wrangler', backgroundSkillChoice: 'stealth' }),
    bare: pc({ backgroundId: 'animal-wrangler', backgroundSkillChoice: null }),
    where: 'origin',
    title: 'Background trained skill',
    label: 'Stealth',
    words: words('Stealth', ignoredFor('Athletics')),
    placeholder: 'Choose a skill',
  },
  {
    name: 'the background named Lore (ignored, the earliest unpicked option instead)',
    kept: pc({ backgroundId: 'ex-con-token-guard', backgroundLore: 'sailing' }),
    bare: pc({ backgroundId: 'ex-con-token-guard', backgroundLore: null }),
    where: 'origin',
    title: 'Background Lore',
    label: 'Sailing Lore',
    words: words('Sailing Lore', ignoredFor('Legal Lore')),
    placeholder: 'Choose a Lore…',
  },
  {
    name: 'the class skill (ignored, the first option instead)',
    kept: pc({ subclassSkill: 'stealth' as never }),
    bare: pc({ subclassSkill: null }),
    where: 'origin',
    title: 'Trained skill',
    label: 'Stealth',
    words: words('Stealth', ignoredFor('Acrobatics')),
  },
  {
    name: "a feat's own choice, renderChoice (keyed by answer: ignored)",
    kept: pc({ level: 3, featPicks: { '3:general:0': 'canny-acumen' }, featChoices: { '3:general:0': 'athletics' } }),
    bare: pc({ level: 3, featPicks: { '3:general:0': 'canny-acumen' } }),
    where: '3',
    title: featChoicePrompt(cdef.prompt, cdef.flag),
    label: 'Athletics',
    words: words('Athletics', KEPT_WORDS.ignored),
  },
  {
    name: "a granted feat's choice, grantedChoicePicker (no option grants: maybe)",
    kept: pc({ level: 1, backgroundId: 'local-scion', grantedFeatChoices: { 'specialty-crafting': 'cooking' } }),
    bare: pc({ level: 1, backgroundId: 'local-scion' }),
    where: '1',
    title: featChoicePrompt(vdef.prompt, vdef.flag),
    label: 'Cooking',
    words: words('Cooking', KEPT_WORDS.maybe),
  },
  {
    name: 'a FEAT_GRANTS skill slot (ignored, the first option instead)',
    kept: pc({ level: 1, ...kobold, featPicks: { '1:ancestry:0': 'dragonscaled-lore' }, featSkillChoices: { 'dragonscaled-lore:0': 'stealth' } }),
    bare: pc({ level: 1, ...kobold, featPicks: { '1:ancestry:0': 'dragonscaled-lore' } }),
    where: '1',
    title: 'Trained skill',
    label: 'Stealth',
    words: words('Stealth', ignoredFor('Arcana')),
    placeholder: 'Choose a skill…',
  },
];

function mount(f: Fam, b: BuildState) {
  if (f.where === 'origin') {
    const o = origin(b);
    return { host: o.host, wrote: () => o.calls.length > 0 };
  }
  const p = page(b, f.where);
  return { host: p.host, wrote: p.saved };
}

describe('WP9 step 4: a stored answer the list does not offer is shown by name, greyed, saying what the sheet does', () => {
  it('the fixtures hold off-list values (each is NOT one of its book options)', () => {
    expect(db.heritages['deep-fetchling'].choiceResistance!.options.map((o) => o.value)).not.toContain('fire');
    expect((hdef.options ?? []).map((o) => o.value)).not.toContain('sonic');
    expect((adef.options ?? []).map((o) => o.value)).not.toContain('large');
    expect((bdef.options ?? []).map((o) => o.value)).not.toContain('poison');
    expect(db.classes.fighter.keyAbility).not.toContain('int');
    expect(db.backgrounds['animal-wrangler'].trainedSkillChoice).not.toContain('stealth');
    expect(db.backgrounds['ex-con-token-guard'].trainedLoreOptions).not.toContain('sailing');
    expect(db.classes.fighter.trainedSkills.choice).not.toContain('stealth');
    expect((cdef.options ?? []).map((o) => o.value)).not.toContain('athletics');
    expect((vdef.options ?? []).map((o) => o.value)).not.toContain('cooking');
    expect(FAMILIES).toHaveLength(11);
  });

  for (const f of FAMILIES) {
    for (const off of [false, true]) {
      it(`${f.name}${off ? ' — Tweaks off' : ''}: the kept row by name, greyed, with its words; nothing written`, () => {
        const b = off ? { ...f.kept, options: { ...(f.kept.options ?? {}), overridesEnabled: false } } : f.kept;
        const m = mount(f, b);
        const el = control(m.host, f.title);
        expect(el, `no "${f.title}" control`).toBeTruthy();
        expect(el!.classList.contains('is-empty'), 'drawn as the placeholder').toBe(false);
        expect(el!.querySelector('.popsel-val')?.textContent).toBe(f.label);
        expect(el!.classList.contains('tw-grey-pick') && el!.hasAttribute('data-pick-grey'), 'not greyed').toBe(true);
        expect(lineAfter(el)).toBe(f.words);
        if (f.placeholder) expect(el!.textContent).not.toContain(f.placeholder);
        expect(m.wrote(), 'rendering wrote').toBe(false);
      });
    }
    it(`${f.name}: unanswered → as today (no kept row; the picker's own rows unchanged)`, () => {
      const bare = mount(f, f.bare);
      const el = control(bare.host, f.title);
      expect(el).toBeTruthy();
      expect(lineAfter(el)).toBeNull();
      expect(el!.classList.contains('tw-grey-pick')).toBe(false);
      if (f.placeholder) expect(el!.textContent).toContain(f.placeholder);
      const rowsBare = Number(el!.getAttribute('data-ctl-options'));
      const liveBare = el!.getAttribute('data-ctl-live');
      for (const s of stops) s();
      stops = [];
      for (const n of [...document.body.children]) n.remove();
      const kept = control(mount(f, f.kept).host, f.title);
      // One row more (the kept one), and not a live one.
      expect(Number(kept!.getAttribute('data-ctl-options'))).toBe(rowsBare + 1);
      expect(kept!.getAttribute('data-ctl-live')).toBe(liveBare);
    });
  }

  it('the kept row in the open list is greyed and unpickable, its reason the words', () => {
    const f = FAMILIES[0];
    const r = origin(f.kept);
    const el = control(r.host, f.title)!;
    act(() => el.click());
    const row = [...document.querySelectorAll<HTMLButtonElement>('.picker-item')].find((b) => (b.textContent ?? '').includes('Fire'));
    expect(row).toBeTruthy();
    expect(row!.disabled).toBe(true);
    expect(row!.getAttribute('aria-label')).toBe(f.words);
    act(() => row!.click());
    expect(r.calls).toEqual([]);
  });
});

describe('withKeptAnswer (the pure helper)', () => {
  const rows = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];
  it('no stored value, or one already a row → the rows themselves', () => {
    expect(withKeptAnswer(rows, null, { how: () => ({ counts: true }) })).toBe(rows);
    expect(withKeptAnswer(rows, 'a', { how: () => ({ counts: true }) })).toBe(rows);
  });
  it('a comma-joined answer: each off-list part on its own', () => {
    expect(keptValues(rows, 'a,z, y')).toEqual(['z', 'y']);
    expect(keptValues(rows, ['z', null, 'b', 'z'])).toEqual(['z']);
  });
  it('an allowCustom answer withCustomAnswer already rowed never gets a second row', () => {
    const def = { kind: 'array', prompt: 'Terrain', options: rows, allowCustom: { label: 'x', placeholder: 'y' } } as unknown as FeatChoiceDef;
    const out = withKeptAnswer(withCustomAnswer(rows.slice(), def, 'tundra'), 'tundra', { how: () => ({ counts: true }) });
    expect(out.filter((o) => o.value === 'tundra')).toHaveLength(1);
    expect(out.find((o) => o.value === 'tundra')).not.toHaveProperty('kept');
  });
  it('the mark slot is carried, unused by every caller today', () => {
    const [k] = withKeptAnswer(rows, 'z', { how: () => ({ counts: false }), mark: 'm' }) as { keptMark?: unknown }[];
    expect(k.keptMark).toBe('m');
  });
  it('no engine file imports it (display only)', () => {
    const files = readdirSync('src/rules', { recursive: true }) as string[];
    const hits = files.filter((f) => /\.tsx?$/.test(f) && readFileSync(join('src/rules', f), 'utf8').includes('keptAnswer'));
    expect(hits).toEqual([]);
  });
});

describe('K2: the words rest on what the derived sheet does with the off-list value', () => {
  it('deep fetchling: an off-list resistance COUNTS (deriveDefenses reads it with no list check)', () => {
    const c = buildCharacter(pc({ ...fetchling, heritageResistanceChoice: 'fire' }), db);
    expect(deriveDefenses(c, db).resistances.find((r) => r.type === 'fire')?.value).toBe(2);
  });
  it('automaton: an off-list body size does NOT count (ancestryBodySize ignores it; the record size stands)', () => {
    const c = buildCharacter(pc({ ...automaton, featChoices: { 'ancestry:automaton': 'large' } }), db);
    expect(deriveSize(c, db).size.toLowerCase()).toBe('medium');
    const small = buildCharacter(pc({ ...automaton, featChoices: { 'ancestry:automaton': 'small' } }), db);
    expect(deriveSize(small, db).size.toLowerCase()).toBe('small');
  });
  it('the key attribute counts, the skill picks fall back to their first option, the background answer counts', () => {
    expect(buildCharacter(pc({ keyAbility: 'int' }), db).keyAbility).toBe('int');
    const bg = buildCharacter(pc({ backgroundId: 'animal-wrangler', backgroundSkillChoice: 'stealth' }), db).proficiencies.skills;
    expect(bg.athletics).toBe('trained');
    const lore = buildCharacter(pc({ backgroundId: 'ex-con-token-guard', backgroundLore: 'sailing' }), db).proficiencies.skills;
    expect(lore['lore:legal']).toBe('trained');
    expect(lore['lore:sailing']).toBeUndefined();
    const scarred = buildCharacter(pc({ backgroundId: 'energy-scarred', featChoices: { 'background:energy-scarred': 'poison' } }), db).proficiencies.skills;
    expect(scarred['lore:poison']).toBe('trained');
  });
  it('a keyed feat answer off the list (Canny Acumen "athletics") changes no proficiency: ignored', () => {
    // A wizard, so the on-list control really moves a save (a fighter is already expert in all of them).
    const ca = { level: 3, classId: 'wizard', keyAbility: 'int' as const, featPicks: { '3:general:0': 'canny-acumen' } };
    const prof = (answer?: string) => buildCharacter(pc({ ...ca, ...(answer ? { featChoices: { '3:general:0': answer } } : {}) }), db).proficiencies;
    expect(prof('reflex').saves.reflex).toBe('expert');
    expect(prof().saves.reflex).toBe('trained');
    expect(prof('athletics')).toEqual(prof());
  });
});
