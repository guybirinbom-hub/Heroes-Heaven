// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, buttonIn, openMenu, pick, press } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { choicesToName, emptyBuild, levelChoices, TWEAKS_PAGE, type BuildState } from '../src/rules/build';
import { heldFeatIds } from '../src/rules/heldFeats';
import type { FeatCategory } from '../src/rules/types';

/**
 * A FEAT GIVEN THROUGH TWEAKS ASKS ITS OWN QUESTIONS (plan B WP8; case D, D2). The level page's twelve
 * question cards moved into one closure beside renderChoice (Builder `featQuestions(picked, key)`): the slot
 * card calls it with its slot key, and the Tweaks page draws it under an ACTIVE given feat's open row with
 * `override:<featId>` — where a given feat's answers are stored. `levelChoices` counts a given feat's
 * unanswered question on `TWEAKS_PAGE` ("Tweaks — <feat> — choose"), so the Tweaks page's tag, the row's
 * chip and the Tweaks button's dot say it is owed, and the Save confirm lists it.
 *
 * The first test was written on the code BEFORE the move, with the labels it drew then (the whole slot
 * card's HTML and every levelChoices list over a 522-character grid were also compared byte for byte, before
 * and after, in a scratch run — wp8-report.md). Synthetic characters only.
 */

const db = content();
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  for (const n of [...document.body.children]) n.remove();
});

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ...more,
  } as BuildState;
}

/** The same feat GIVEN through Tweaks (Tweaks on; its answer, if any, under `override:<featId>`). */
function given(base: BuildState, featId: string, answer?: string): BuildState {
  const f = db.feats[featId]!;
  return {
    ...base,
    options: { ...(base.options ?? {}), overridesEnabled: true },
    overrides: { v: 2, addedFeats: [{ featId, level: f.level, category: f.category as FeatCategory }] },
    featChoices: { ...base.featChoices, ...(answer ? { [`override:${featId}`]: answer } : {}) },
  };
}

function openBuilder(b: BuildState) {
  const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
  cleanups.push(r.stop);
  return r;
}
const atPage = (r: ReturnType<typeof openBuilder>, page: string) =>
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const subcards = (root: Element | null | undefined) => [...(root?.querySelectorAll('[data-subcard]') ?? [])].map((e) => e.getAttribute('data-subcard'));
const ctls = (root: Element | null | undefined) => [...(root?.querySelectorAll('[data-ctl-title]') ?? [])].map((e) => e.getAttribute('data-ctl-title'));
/** Card 1's value: the armor this taking trained. */
const trainsYouIn = (root: Element | null | undefined) => squash(root?.querySelector('[data-subcard="Trains you in"] .lvl-card-val')?.textContent);
/** How many options a search picker greys (its harness markers: all options minus the live ones). */
const greyed = (ctl: Element | null | undefined) => Number(ctl?.getAttribute('data-ctl-options')) - Number(ctl?.getAttribute('data-ctl-live'));

/** The slot card holding `feat` on a level page. */
function slotWrap(b: BuildState, page: string, feat: string) {
  const r = openBuilder(b);
  atPage(r, page);
  const wrap = [...r.host.querySelectorAll('.lvl-slot-wrap')].find((w) => squash(w.querySelector('.lvl-card-val')?.textContent) === feat);
  expect(wrap, `${feat} sits in a slot on level ${page}`).toBeTruthy();
  return wrap!;
}

/** The Builder's Tweaks page, the given feat's row opened; its questions. */
async function givenEditor(b: BuildState, featId: string) {
  const r = openBuilder(b);
  await press(r.host.querySelector('.builder-head button.b-tweaks'));
  const row = r.host.querySelector(`li.tw-row[data-key^="addedFeats:${featId}@"]`);
  expect(row, `the ${featId} row`).toBeTruthy();
  await press(row!.querySelector('.tw-row-head'));
  return { r, row: row!, questions: () => r.host.querySelector(`[data-feat-questions="${featId}"]`) };
}

/* The fixtures, each as a slot pick and as a given feat. `slot` is the drawn slot key on that page. */
const FIX = {
  domainInitiate: { feat: 'domain-initiate', name: 'Domain Initiate', base: () => hero('cleric', 2, { deityId: 'sarenrae' }), slot: '2:class:0', page: '2', answer: 'fire' },
  rogueDedication: { feat: 'rogue-dedication', name: 'Rogue Dedication', base: () => hero('fighter', 2), slot: '2:class:0', page: '2' },
  generalTraining: { feat: 'general-training', name: 'General Training', base: () => hero('fighter', 1), slot: '1:ancestry:0', page: '1' },
  additionalLore: { feat: 'additional-lore', name: 'Additional Lore', base: () => hero('fighter', 2), slot: '2:skill:1', page: '2' },
  clericDedication: { feat: 'cleric-dedication', name: 'Cleric Dedication', base: () => hero('fighter', 2, { deityId: 'sarenrae' }), slot: '2:class:0', page: '2' },
  horizonWalker: { feat: 'horizon-walker-dedication', name: 'Horizon Walker Dedication', base: () => hero('fighter', 2), slot: '2:class:0', page: '2' },
  // Card 1 (armorCascade): no dropdown; "Trains you in" names the armor THIS taking trained, found by its row's
  // `slotKey` + `featId` (a given feat's row is `override:armor-proficiency`).
  armorProficiency: { feat: 'armor-proficiency', name: 'Armor Proficiency', base: () => hero('wizard', 3), slot: '3:general:0', page: '3' },
  // Card 11 (effectChoices with a spellFilter, "choose a different spell each time" — distinctAcrossTakes).
  qiSpells: { feat: 'qi-spells', name: 'Qi Spells', base: () => hero('monk', 2), slot: '2:class:0', page: '2' },
} as const;
const QI_PROMPT = 'Qi Spells: choose a 1st-rank monk qi spell (Inner Upheaval, Qi Rush, or another you have access to)';
type Fx = (typeof FIX)[keyof typeof FIX];
const slotted = (f: Fx, answer?: string): BuildState => {
  const b = f.base();
  return { ...b, featPicks: { ...b.featPicks, [f.slot]: f.feat }, featChoices: { ...b.featChoices, ...(answer ? { [f.slot]: answer } : {}) } };
};

/* The labels the slot card drew on the code BEFORE the move (recorded 2026-10-22). */
const BEFORE: Record<string, { subcards: string[]; ctls: string[] }> = {
  'domain-initiate': { subcards: ['Domain'], ctls: ['Class feat', 'Domain', 'Initial domain spell'] },
  'rogue-dedication': { subcards: ['Trained skill', 'Trained skill', 'Bonus skill feat'], ctls: ['Class feat', 'Trained skill', 'Trained skill', 'Bonus skill feat'] },
  'general-training': { subcards: ['Choose a general feat'], ctls: ['Ancestry feat', 'Choose a general feat'] },
  'additional-lore': { subcards: ['Trained Lore'], ctls: ['Skill feat'] },
  'cleric-dedication': { subcards: ['Sanctification', 'Already trained in Religion — replacement skill'], ctls: ['Class feat', 'Sanctification', 'Replacement skill'] },
  'horizon-walker-dedication': { subcards: ['Favored Terrain: Favored terrain'], ctls: ['Class feat', 'Favored terrain'] },
  /* Added by the leftovers run (2026-10-22), recorded on the current code; the pre-WP8 block
   * (`git show 2340cf0:src/builder/Builder.tsx`, the level page's question cards) draws the same: card 1's
   * `<SubCard icon="ti-shield" label="Trains you in">` and card 11's `<SubCard … label={ch.prompt}>` holding
   * `<SearchSelect bare label="Spell" …>` (leftovers-tests-report.md). */
  'armor-proficiency': { subcards: ['Trains you in'], ctls: ['General feat'] },
  'qi-spells': { subcards: [QI_PROMPT], ctls: ['Class feat', 'Spell'] },
};

describe('a feat given through Tweaks asks its own questions under its row (plan B WP8)', () => {
  it("a slot pick's questions render the same after the move (Domain Initiate, Rogue Dedication, General Training)", () => {
    for (const f of Object.values(FIX)) {
      const wrap = slotWrap(slotted(f, 'answer' in f ? f.answer : undefined), f.page, f.name);
      expect({ subcards: subcards(wrap), ctls: ctls(wrap) }, f.feat).toEqual(BEFORE[f.feat]);
      if (f.feat === 'armor-proficiency') expect(trainsYouIn(wrap), 'the slot taking trained light armor').toBe('Light armor');
    }
  });

  it("a given feat's choice, bonus skill feat, pick-a-feat, Lore and sanctification render under its Give-a-feat editor with the slot pick's labels", async () => {
    for (const f of Object.values(FIX)) {
      const { questions } = await givenEditor(given(f.base(), f.feat, 'answer' in f ? f.answer : undefined), f.feat);
      const qs = questions();
      expect(qs, `${f.feat}: questions under its row`).toBeTruthy();
      // The slot's own child cards, in the slot's order — the slot card's own title aside.
      expect(subcards(qs), f.feat).toEqual(BEFORE[f.feat].subcards);
      expect(ctls(qs), f.feat).toEqual(BEFORE[f.feat].ctls.slice(1));
      if (f.feat === 'armor-proficiency') expect(trainsYouIn(qs), 'the given taking trained light armor').toBe('Light armor');
      while (cleanups.length) cleanups.pop()!();
      for (const n of [...document.body.children]) n.remove();
    }
  });

  it("answering it clears its 'choices left' line (page TWEAKS_PAGE)", async () => {
    const f = FIX.domainInitiate;
    const b = given(f.base(), f.feat);
    expect(levelChoices(b, db).filter((m) => m.page === TWEAKS_PAGE)).toEqual([{ page: TWEAKS_PAGE, label: 'Tweaks — Domain Initiate — choose', required: true, featId: 'domain-initiate' }]);
    const { r, questions } = await givenEditor(b, f.feat);
    const tag = () => squash(r.host.querySelector('.tw-page .tw-pending')?.textContent);
    const chip = () => squash(r.host.querySelector('li.tw-row[data-key^="addedFeats:domain-initiate@"] .tw-chip-choicesLeft')?.textContent);
    expect(tag()).toBe('1 choice left');
    expect(chip()).toBe('1 choice left');
    expect(r.host.querySelector('.builder-head button.b-tweaks.has-dot'), 'the Tweaks button says one needs a look').toBeTruthy();
    await pick(questions()!, 'Domain', 'Fire');
    expect(tag()).toBe('');
    expect(chip()).toBe('');
    expect(r.host.querySelector('.builder-head button.b-tweaks.has-dot')).toBeNull();
  });

  it("an off-deity sanctification on a given Cleric Dedication is listed, labelled 'Tweaks — …', and no levelChoices label contains 'Level -'", () => {
    const b = given(FIX.clericDedication.base(), 'cleric-dedication', 'unholy');
    const off = levelChoices(b, db).filter((m) => m.label.includes('Sanctification (Cleric Dedication)'));
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ page: TWEAKS_PAGE, required: true, featId: 'cleric-dedication' });
    expect(off[0].label).toMatch(/^Tweaks — Sanctification \(Cleric Dedication\): Unholy — Sarenrae allows only: /);
    // No line anywhere prints a page as "Level -1": every class, many levels, given feats of each kind.
    for (const cid of Object.keys(db.classes)) {
      for (const L of [1, 2, 6, 12, 20]) {
        for (const f of Object.values(FIX)) {
          const ch = levelChoices(given(hero(cid, L, { deityId: 'sarenrae' }), f.feat, f.feat === 'cleric-dedication' ? 'unholy' : undefined), db);
          const bad = ch.filter((m) => /Level -/.test(m.label) || (m.page === TWEAKS_PAGE) !== m.label.startsWith('Tweaks — '));
          expect(bad, `${cid} ${L} ${f.feat}`).toEqual([]);
        }
      }
    }
  });

  it("a given feat's granted feats ask their questions under its editor, not on a level page", async () => {
    const f = FIX.horizonWalker;
    const b = given(f.base(), f.feat);
    const page = openBuilder(b);
    atPage(page, '2');
    const lvl = page.host.querySelector('.lvl-page');
    expect(lvl, 'the level-2 page').toBeTruthy();
    expect(subcards(lvl).filter((s) => /favored terrain/i.test(s ?? '')), 'nothing about Favored Terrain on the level page').toEqual([]);
    expect(ctls(lvl).filter((s) => /favored terrain/i.test(s ?? ''))).toEqual([]);
    while (cleanups.length) cleanups.pop()!();
    for (const n of [...document.body.children]) n.remove();
    const { questions } = await givenEditor(b, f.feat);
    expect(subcards(questions())).toEqual(['Favored Terrain: Favored terrain']);
  });

  /* Card 11 — "choose a different spell each time" (Qi Spells). Leftovers run 2026-10-22, MUTATION PROOF in
   * leftovers-tests-report.md: the walk without its slot takings turns this red.
   * A slot taking and a given taking of the SAME feat never coexist: a feat a slot already holds is not a held
   * given feat (heldFeats.ts, buildCharacter's `takenFeats.has`), so its row asks nothing and the walk's given
   * branch has no second taking to grey against. What can be checked: two slot takings grey each other, and a
   * given taking twinned by a slot asks nothing under its row. */
  it("Qi Spells: two takings grey each other's spell; a given twin of a slot pick asks nothing", async () => {
    const f = FIX.qiSpells;
    const b0 = hero('monk', 4);
    const two = (answers: Record<string, string>): BuildState => ({ ...b0, featPicks: { ...b0.featPicks, '2:class:0': f.feat, '4:class:0': f.feat }, effectChoices: answers });
    const spellCtl = (b: BuildState, page: string) => slotWrap(b, page, f.name).querySelector('[data-ctl-title="Spell"]');
    const reset = () => {
      while (cleanups.length) cleanups.pop()!();
      for (const n of [...document.body.children]) n.remove();
    };
    expect(greyed(spellCtl(two({}), '2')), 'nothing answered: nothing greyed').toBe(0);
    reset();
    const answered = two({ '2:class:0:qi-spell': 'inner-upheaval', '4:class:0:qi-spell': 'qi-rush' });
    const at2 = spellCtl(answered, '2');
    expect(greyed(at2), "level 2 greys level 4's spell").toBe(1);
    expect(squash(at2?.querySelector('.popsel-val')?.textContent), 'its own answer stays').toBe('Inner Upheaval');
    reset();
    const at4 = spellCtl(answered, '4');
    expect(greyed(at4), "level 4 greys level 2's spell").toBe(1);
    expect(squash(at4?.querySelector('.popsel-val')?.textContent)).toBe('Qi Rush');
    reset();
    // The given twin of a slot pick: listed on the Tweaks page, not held, so no questions under its row.
    const twin = given(slotted(f), f.feat);
    expect(heldFeatIds(twin).filter((id) => id === f.feat), 'held once, by the slot').toHaveLength(1);
    const { questions } = await givenEditor(twin, f.feat);
    expect(questions(), 'the given twin asks nothing').toBeNull();
  });

  it('re-giving a feat shows its old answer', async () => {
    // Domain Initiate was given, answered "fire" and deleted: its answer stays under override:domain-initiate (B7).
    const b: BuildState = { ...hero('cleric', 2, { deityId: 'sarenrae' }), options: { overridesEnabled: true }, featChoices: { 'override:domain-initiate': 'fire' } };
    const r = openBuilder(b);
    await press(r.host.querySelector('.builder-head button.b-tweaks'));
    await openMenu(r.host, 'Give a feat');
    await pick(addEditor(r.host)!, 'Feat', 'Domain Initiate');
    await press(addEditor(r.host)!.querySelector('button.tw-add-go'));
    // The tweak just added opens as its row, with the feat's questions under it.
    const qs = r.host.querySelector('[data-feat-questions="domain-initiate"]');
    expect(qs, 'the given feat asks under its row').toBeTruthy();
    expect(squash(qs!.querySelector('[data-ctl-title="Domain"] .popsel-val')?.textContent)).toBe('Fire');
  });

  it('slot-only characters: levelChoices deep-equal before and after', () => {
    // Recorded on the code before the move (2026-10-22): a slot pick's lines are unchanged, and none carries
    // a featId or the Tweaks page.
    expect(levelChoices(slotted(FIX.domainInitiate), db)).toEqual([
      { page: 0, label: 'Ancestry boosts (2)', required: true },
      { page: 0, label: 'Background boosts (2)', required: true },
      { page: 0, label: 'Sanctification (Sarenrae)', required: true },
      { page: 0, label: 'Heritage general feat', required: true },
      { page: 0, label: 'Free attribute boosts (4)', required: true },
      { page: 1, label: 'Level 1 — ancestry feat', required: true },
      { page: 2, label: 'Level 2 — skill feat', required: true },
      { page: 2, label: 'Domain Initiate — choose', required: true },
    ]);
    expect(levelChoices(slotted(FIX.clericDedication), db)).toEqual([
      { page: 0, label: 'Ancestry boosts (2)', required: true },
      { page: 0, label: 'Background boosts (2)', required: true },
      { page: 0, label: 'Heritage general feat', required: true },
      { page: 0, label: 'Free attribute boosts (4)', required: true },
      { page: 0, label: 'Class trained skill', required: true },
      { page: 1, label: 'Level 1 — ancestry feat', required: true },
      { page: 1, label: 'Level 1 — class feat', required: true },
      { page: 2, label: 'Level 2 — skill feat', required: true },
      { page: 2, label: 'Cleric Dedication — choose', required: true },
    ]);
    // …and the given twin with Tweaks OFF asks nothing on a page that is not there (an import-stamped one
    // stays held, but no Tweaks page would draw its question).
    for (const f of Object.values(FIX)) {
      const b = given(f.base(), f.feat);
      const off = { ...b, options: { overridesEnabled: false }, overrides: { ...b.overrides, meta: { [`addedFeats:${f.feat}@${db.feats[f.feat]!.level}`]: { source: 'import' as const } } } };
      // The fixture really holds it (an import-stamped given feat stays on with the switch off), so the empty
      // list below is about the question, not about a feat that is not there.
      expect(heldFeatIds(off), `${f.feat} is held with Tweaks off`).toContain(f.feat);
      expect(levelChoices(off, db).filter((m) => m.page === TWEAKS_PAGE || m.featId), f.feat).toEqual([]);
    }
  });

  /* WP10 fix round 1 (browser test step 9): the Save confirm names twelve lines, then "…and N more". A given feat's
   * line comes after every level page's, so on a character with many open choices it was counted but never named —
   * and no level chip leads to it. MUTATION PROOF (wp10-fix-report.md): Builder `submit` back on
   * `missing.slice(0, 12)` turns this red. */
  it("Save's 'choices left' names a given feat's Tweaks line even past the twelfth line", async () => {
    const b = given(hero('fighter', 20), 'assurance');
    const all = levelChoices(b, db);
    const tw = all.filter((m) => m.page === TWEAKS_PAGE);
    expect(tw.map((m) => m.label)).toEqual(['Tweaks — Assurance — choose']);
    expect(all.indexOf(tw[0]), 'fixture: the Tweaks line sits past the twelfth').toBeGreaterThanOrEqual(12);
    // The helper: the Tweaks line, then the others from the top, in levelChoices order; a short list whole.
    const shown = choicesToName(all, 12);
    expect(shown).toEqual([...all.filter((m) => m !== tw[0]).slice(0, 11), tw[0]]);
    expect(choicesToName(all.slice(0, 5), 12)).toEqual(all.slice(0, 5));
    // The mounted Save.
    const r = openBuilder(b);
    await press(r.host.querySelector('button.b-create'));
    const modal = document.querySelector('.confirm-modal');
    expect(modal?.querySelector('.picker-head')?.textContent?.trim()).toBe('Save with choices left?');
    const items = [...(modal?.querySelectorAll('li') ?? [])].map((li) => squash(li.textContent));
    expect(items).toHaveLength(12);
    expect(items).toContain('Tweaks — Assurance — choose');
    expect(squash(modal?.textContent)).toContain(`…and ${all.length - 12} more.`);
    await press(buttonIn(modal, 'Keep editing'));
    expect(document.querySelector('.confirm-modal')).toBeNull();
  });
});
