// @vitest-environment jsdom
import { createElement, act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { sourceCatalog } from '../src/rules/sources';
import { readFileSync } from 'node:fs';
import { buildCharacter, emptyBuild, levelChoices, levelGrants, type BuildState } from '../src/rules/build';
import { requestRulesChange, useBuilderActions } from '../src/builder/shared';
import { DefaultsEditor } from '../src/sheet/CampaignsPage';

/**
 * WAVE 2 — the three Builder items that only a rendered page can answer.
 *
 *  (1) SOURCES FIRST. The Setup step opened on Campaigns, Options, Variant rules, Campaign, Sources —
 *      the card that decides what every other card can even offer came fifth.
 *
 *  (2) HERITAGES vs VERSATILE. One mixed alphabetical list: a human's own six heritages were scattered
 *      through the thirty-odd versatile ones (Aiuvarin, Beastkin, Changeling, Dromaar, Nephilim, …)
 *      with nothing saying which were which. Now two headed groups in the same picker, the ancestry's
 *      own first, with search still spanning both.
 *
 *  (4) FREE ARCHETYPE OFF. Turning the variant off deleted the slots but not the picks:
 *      `buildCharacter` reads every entry of `featPicks` whether or not a slot still grants it, so a
 *      Rogue Dedication taken in a free slot — and the Stealth training it came with — stayed on the
 *      character and on the sheet with the variant switched off.
 */
const c = () => content();
const noop = () => undefined;
const ALL_BOOKS = sourceCatalog(content()).allBooks;

function open(initial: BuildState) {
  let saved: BuildState | null = null;
  const r = renderDom(
    createElement(Builder, { content: c(), initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }),
  );
  return { r, saved: () => saved };
}

const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
const dialog = () => document.querySelector('.confirm-modal');
const anyButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;

/** Click a level-strip chip by its label ("Setup", "0", "1", …) — the player's own route. */
function goPage(r: ReturnType<typeof open>['r'], label: string) {
  const chip = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === label);
  expect(chip, `no "${label}" page chip`).toBeTruthy();
  r.click(chip!);
}

/* A leg that fails mid-flow never reaches `r.stop()`, and its still-mounted Builder would then be the
 * first tree the NEXT leg's document-wide queries find — one real failure reported as several. */
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

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

/** Type into a React-controlled input the way a player does (native setter + input event). */
function type(input: HTMLInputElement | null, text: string) {
  if (!input) throw new Error('search input not found');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const BASE: BuildState = {
  ...emptyBuild(),
  name: 't',
  level: 2,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
  enabledSources: ALL_BOOKS,
};

// ───────────────────────────────────────────────────────────────────── (1) Sources first

describe('(1) the Setup step opens with Sources', () => {
  it('Sources is the first card, and the cards after it keep the order they had', async () => {
    const { r } = open(BASE);
    goPage(r, 'Setup');
    await flush();
    const labels = [...r.host.querySelectorAll('.card-sec .lvl-cards > [data-setupcard]')].map((n) =>
      n.getAttribute('data-setupcard'),
    );
    expect(labels[0]).toBe('Sources');
    // Everything below Sources keeps the order it had. (Campaigns is signed-in only, so it is not
    // rendered here — the three that follow it are.)
    expect(labels.slice(1, 4)).toEqual(['Options', 'Variant rules', 'Campaign']);
    r.stop();
  });
});

// ───────────────────────────────────────────────────────────── (2) heritage groups

/** Open the Heritage picker on the level-0 page and read the rows grouped under their headings. */
async function heritageGroups(r: ReturnType<typeof open>['r']) {
  const ctl = r.host.querySelector('[data-ctl-title="Heritage"]');
  expect(ctl, 'no Heritage control on the page').toBeTruthy();
  r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
  await flush();
  return ctl!;
}

function readGroups(): { head: string; rows: string[] }[] {
  const list = document.querySelector('.picker-overlay .picker-list');
  expect(list, 'the heritage picker did not open').toBeTruthy();
  const out: { head: string; rows: string[] }[] = [];
  for (const node of [...list!.children]) {
    if (node.classList.contains('picker-group-h')) out.push({ head: (node.textContent ?? '').trim(), rows: [] });
    else if (node.classList.contains('pick-row'))
      out[out.length - 1]?.rows.push((node.querySelector('.picker-name')?.textContent ?? '').trim());
  }
  return out;
}

describe('(2) the heritage picker separates the ancestry’s own from the versatile ones', () => {
  it('two headed groups, the human ones first, and no human heritage in the versatile group', async () => {
    const { r } = open(BASE);
    goPage(r, '0');
    await flush();
    await heritageGroups(r);
    const groups = readGroups();
    expect(groups.length).toBe(2);
    expect(groups[0].head).toBe('Human heritages');
    expect(groups[1].head).toBe('Versatile heritages');

    // The human list is the ancestry's own, and it leads.
    expect(groups[0].rows).toContain('Skilled Human');
    expect(groups[0].rows).toContain('Versatile Human');
    // The versatile list carries the ones any ancestry may take…
    expect(groups[1].rows).toContain('Nephilim');
    expect(groups[1].rows).toContain('Aiuvarin');
    // …and none of the human ones. (Before the fix there was one mixed list and this could not hold.)
    for (const h of groups[0].rows) expect(groups[1].rows, `"${h}" is in both groups`).not.toContain(h);
    // The versatile group reads alphabetically (it arrived in data order); the ancestry's own keeps
    // the ancestry's order.
    expect(groups[1].rows).toEqual([...groups[1].rows].sort((a, b) => a.localeCompare(b)));
    const humanOrder = Object.values(c().heritages).filter((h) => h.ancestryId === 'human').map((h) => h.name);
    expect(groups[0].rows).toEqual(humanOrder.filter((n) => groups[0].rows.includes(n)));
    r.stop();
  });

  it('search still spans both groups', async () => {
    const { r } = open(BASE);
    goPage(r, '0');
    await flush();
    await heritageGroups(r);
    // "versatile" matches a HUMAN heritage (Versatile Human) and a versatile one (Versatile Heritage
    // records name themselves too) — the query is answered across the whole list, not one section.
    type(document.querySelector('.picker-overlay input.name-input'), 'human');
    await flush();
    const groups = readGroups();
    const all = groups.flatMap((g) => g.rows);
    expect(all).toContain('Versatile Human');
    expect(all).toContain('Skilled Human');
    // A group with nothing matching is not headed at all.
    for (const g of groups) expect(g.rows.length).toBeGreaterThan(0);
    r.stop();
  });
});

// ─────────────────────────────────────────── (4) Free Archetype off removes its effects

/** A level-2 fighter with Free Archetype on and a Rogue Dedication sitting in the free slot — keyed
 *  exactly as the level page writes it (`<level>:<category>:<index in that level's slot list>`). */
const FREE_SLOT = '2:archetype:2';
const FREE_ARCH: BuildState = {
  ...BASE,
  variantRules: { freeArchetype: true },
  featPicks: { '1:class:1': 'sudden-charge', [FREE_SLOT]: 'rogue-dedication' },
};

describe('(4) turning Free Archetype off takes back what sat in its slots', () => {
  it('the fixture sits in the real free slot', () => {
    const g = levelGrants(2, 'fighter', c(), null, { freeArchetype: true });
    expect(g.featSlots[2]).toBe('archetype');
  });

  it('names the feat in a confirmation, then drops it and everything it granted', async () => {
    const before = buildCharacter(FREE_ARCH, c());
    expect(before.feats.some((f) => f.featId === 'rogue-dedication')).toBe(true);
    expect(before.proficiencies.skills.stealth).toBe('trained'); // the dedication's own grant

    const { r, saved } = open(FREE_ARCH);
    goPage(r, 'Setup');
    await flush();
    r.click(anyButton('Free Archetype'));
    await flush();

    expect(dialog(), 'no confirmation before dropping an answered pick').toBeTruthy();
    expect(dialog()!.textContent).toContain('Rogue Dedication');
    expect(dialog()!.textContent).toContain('Level 2');
    r.click(anyButton('Turn it off'));
    await flush();

    await save(r);
    const b = saved();
    expect(b, 'the builder never handed the build back').toBeTruthy();
    expect(b!.variantRules?.freeArchetype).toBeFalsy();
    expect(Object.keys(b!.featPicks).filter((k) => k.split(':')[1] === 'archetype')).toEqual([]);
    // The ordinary class feat is NOT collateral.
    expect(b!.featPicks['1:class:1']).toBe('sudden-charge');

    const after = buildCharacter(b!, c());
    expect(after.feats.some((f) => f.featId === 'rogue-dedication')).toBe(false);
    expect(after.proficiencies.skills.stealth).toBe('untrained');
    expect(after.feats.some((f) => f.featId === 'sudden-charge')).toBe(true);
    r.stop();
  });

  it('Cancel changes nothing at all', async () => {
    const { r, saved } = open(FREE_ARCH);
    goPage(r, 'Setup');
    await flush();
    r.click(anyButton('Free Archetype'));
    await flush();
    r.click(anyButton('Cancel'));
    await flush();

    await save(r);
    const b = saved();
    expect(b!.variantRules?.freeArchetype).toBe(true);
    expect(b!.featPicks[FREE_SLOT]).toBe('rogue-dedication');
    r.stop();
  });

  it('a character that never used the free slots turns it off with no dialog and loses nothing', async () => {
    const { r, saved } = open({ ...BASE, variantRules: { freeArchetype: true }, featPicks: { '1:class:1': 'sudden-charge' } });
    goPage(r, 'Setup');
    await flush();
    r.click(anyButton('Free Archetype'));
    await flush();
    expect(dialog(), 'a dialog with nothing to lose').toBeFalsy();

    await save(r);
    const b = saved();
    expect(b!.variantRules?.freeArchetype).toBeFalsy();
    expect(b!.featPicks['1:class:1']).toBe('sudden-charge');
    r.stop();
  });

  it("the refuter's case: a Mythic feat beside the free slot stays in ITS slot when Free Archetype goes off", async () => {
    // Slots at 2nd: [class, skill, archetype, mythic] → [class, skill, mythic]. Before the fix the
    // mythic pick stayed at 2:mythic:3 — kept on the sheet, gone from the Builder, its slot empty.
    const start: BuildState = {
      ...FREE_ARCH,
      mythicEnabled: true,
      featPicks: { ...FREE_ARCH.featPicks, '2:class:0': 'intimidating-strike', '2:mythic:3': 'arms-that-cut-the-waves' },
      featChoices: { '2:mythic:3': 'answer' },
    };
    const { r, saved } = open(start);
    goPage(r, 'Setup');
    await flush();
    r.click(anyButton('Free Archetype'));
    await flush();
    // Only the free-slot feat is named: the mythic one is not being taken.
    expect(dialog()!.textContent).toContain('Rogue Dedication');
    expect(dialog()!.textContent).not.toContain('Arms that Cut');
    r.click(anyButton('Turn it off'));
    await flush();

    await save(r);
    const b = saved()!;
    expect(b.featPicks).toEqual({ '1:class:1': 'sudden-charge', '2:class:0': 'intimidating-strike', '2:mythic:2': 'arms-that-cut-the-waves' });
    expect(b.featChoices).toEqual({ '2:mythic:2': 'answer' });
    // Nothing else on the build moved.
    const rest = (x: BuildState) => ({ ...x, featPicks: {}, featChoices: {}, variantRules: {} });
    expect(rest(b)).toEqual(rest(start));
    expect(levelChoices(b, c()).map((m) => m.label)).not.toContain('Level 2 — mythic feat');
    r.stop();
  });
});

// ───────────────── (4) "Use defaults" goes through the same door as the Setup toggle

/** The Builder's own reducer (`useBuilderActions`, which re-keys every change) over a plain variable:
 *  the state the Builder holds, without a page around it. */
function held(start: BuildState, db = c()) {
  let s = start;
  const actions = useBuilderActions((u) => void (s = typeof u === 'function' ? u(s) : u), db);
  return { actions, get: () => s };
}
const turnItOff = async () => {
  await flush();
  act(() => anyButton('Turn it off')!.click());
  await flush();
};

describe('(4) a campaign\'s defaults switch Free Archetype off only through the Setup toggle\'s confirm', () => {
  /** What "Use defaults" hands the door: a campaign whose defaults have Free Archetype off. */
  const DEFAULTS = { variantRules: {}, enabledSources: ALL_BOOKS, mythicEnabled: false, kingmakerEnabled: false };

  it('names the free-slot feat, and on yes applies the defaults WITH the feats removed', async () => {
    const h = held(FREE_ARCH);
    requestRulesChange(DEFAULTS, h.get(), c(), h.actions);
    await flush();
    expect(dialog()!.textContent).toContain('Rogue Dedication');
    expect(h.get(), 'nothing until the player answers').toBe(FREE_ARCH);
    await turnItOff();
    expect(h.get()).toMatchObject(DEFAULTS);
    expect(h.get().featPicks).toEqual({ '1:class:1': 'sudden-charge' });
  });

  it('Cancel applies nothing — not the defaults, not the removal', async () => {
    const h = held(FREE_ARCH);
    requestRulesChange(DEFAULTS, h.get(), c(), h.actions);
    await flush();
    act(() => anyButton('Cancel')!.click());
    await flush();
    expect(h.get()).toBe(FREE_ARCH);
  });

  /* REFUTED: "Turn it off" wrote back six maps computed from the build the door was handed. The join
   * hands it the build from before `await fetchCampaignByCode`, and the Builder stays usable during the
   * fetch — a class feat picked meanwhile went back to the old one. */
  it('a pick made after the door read the build survives the yes — and so does a free-slot pick it never named', async () => {
    const h = held({ ...FREE_ARCH, featPicks: { ...FREE_ARCH.featPicks, '2:class:0': 'combat-assessment' } });
    const snapshot = h.get();
    h.actions.setFeat('2:class:0', 'lunge');
    requestRulesChange(DEFAULTS, snapshot, c(), h.actions);
    await turnItOff();
    expect(h.get().featPicks).toEqual({ '1:class:1': 'sudden-charge', '2:class:0': 'lunge' });

    // The named slot re-filled with another feat before the answer: that one was not what the player agreed to lose.
    const g = held(FREE_ARCH);
    requestRulesChange({ variantRules: {} }, g.get(), c(), g.actions);
    await flush();
    g.actions.setFeat(FREE_SLOT, 'fighter-dedication');
    await turnItOff();
    expect(g.get().variantRules?.freeArchetype).toBeFalsy();
    expect(g.get().featPicks[FREE_SLOT]).toBe('fighter-dedication');
  });

  it('the join path calls that door with the LIVE build, and the door is the ONLY caller of the removal', () => {
    const src = readFileSync('src/builder/shared.tsx', 'utf8');
    // Before: `if (use) { actions.patch({ variantRules: … }) }` — no confirm, feats left behind.
    const join = src.slice(src.indexOf('const join = async'), src.indexOf('return (', src.indexOf('const join = async')));
    expect(join).toMatch(/if \(use\) \{\s*requestRulesChange\(/);
    expect(join).not.toMatch(/actions\.patch\(\{\s*variantRules/);
    // Nothing after the first await reads the `build` the closure caught.
    expect(join.slice(join.indexOf('await fetchCampaignByCode'))).not.toMatch(/\bbuild\b/);
    expect(join).toContain('live.current,');
    // One definition + two calls — the toggles' door and the no-slot Remove — each on a confirm's yes, on the live build.
    expect(src.match(/withoutPicks\(/g)).toHaveLength(3);
    const body = (fn: string) => src.slice(src.indexOf(`export function ${fn}`), src.indexOf('\n}\n', src.indexOf(`export function ${fn}`)));
    expect(body('requestRulesChange')).toContain('() => actions.patch((b) => ({ ...p, ...withoutPicks(b, picks) }))');
    expect(body('requestRemovePick')).toMatch(/confirmLoss\([\s\S]*actions\.patch\(\(b\) => withoutPicks\(b, \[\[key, id\]\]\)\)/);
    for (const f of ['src/builder/Builder.tsx', 'src/sheet/CampaignsPage.tsx']) expect(readFileSync(f, 'utf8'), f).not.toContain('withoutPicks');
  });
});

/* REFUTED: Mythic off left its pick under its old key and nothing ever moved it again, so another
 * shift at that level while Mythic was off stranded it — on the sheet, gone from the Builder. The Mythic
 * chip now asks first (the four-toggles describe below); `patch` here is a slot taken with no confirm
 * — a save from before it — and the reducer still keeps that pick's place. */
describe('(4) Mythic off, another toggle, Mythic on — through the Builder\'s reducer and the real confirm', () => {
  const ARMS = 'arms-that-cut-the-waves';
  const drawn = (b: BuildState) =>
    levelGrants(2, b.classId, c(), b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, Object.values(b.featPicks)).featSlots;

  it('Free Archetype on: Mythic off → Free Archetype off (Turn it off) → Mythic on', async () => {
    const h = held({ ...FREE_ARCH, mythicEnabled: true, featPicks: { ...FREE_ARCH.featPicks, '2:mythic:3': ARMS }, featChoices: { '2:mythic:3': 'answer' } });
    h.actions.patch({ mythicEnabled: false });
    requestRulesChange({ variantRules: {} }, h.get(), c(), h.actions);
    await turnItOff();
    h.actions.patch({ mythicEnabled: true });
    expect(drawn(h.get())).toEqual(['class', 'skill', 'mythic']);
    expect(h.get().featPicks).toEqual({ '1:class:1': 'sudden-charge', '2:mythic:2': ARMS });
    expect(h.get().featChoices).toEqual({ '2:mythic:2': 'answer' });
    expect(levelChoices(h.get(), c()).map((m) => m.label)).not.toContain('Level 2 — mythic feat');
  });

  it('Free Archetype off: Mythic off → Free Archetype on → Mythic on', async () => {
    const h = held({ ...BASE, mythicEnabled: true, featPicks: { '2:mythic:2': ARMS } });
    h.actions.patch({ mythicEnabled: false });
    requestRulesChange({ variantRules: { freeArchetype: true } }, h.get(), c(), h.actions);
    await flush();
    expect(dialog(), 'turning it on asks nothing').toBeFalsy();
    h.actions.patch({ mythicEnabled: true });
    expect(drawn(h.get())).toEqual(['class', 'skill', 'archetype', 'mythic']);
    expect(h.get().featPicks).toEqual({ '2:mythic:3': ARMS });
    expect(levelChoices(h.get(), c()).map((m) => m.label)).not.toContain('Level 2 — mythic feat');
  });

});

// ───────────── (A) the four toggles: the same confirm, naming every feat that loses its slot

/**
 * A 3rd-level human fighter with every slot-adding toggle on and every slot filled: Free Archetype,
 * Ancestry Paragon, Dual Class (rogue) and Mythic. One Lore answer hangs under each pick's key, so an
 * answer left behind — or carried off with the wrong feat — shows.
 */
const ARMS = 'arms-that-cut-the-waves';
const ALL_PICKS: Record<string, string> = {
  '1:ancestry:0': 'cooperative-nature',
  '1:ancestry:1': 'haughty-obstinacy',
  '1:class:2': 'sudden-charge',
  '1:class:3': 'nimble-dodge',
  '2:class:0': 'intimidating-strike',
  '2:class:1': 'mobility',
  '2:skill:2': 'cat-fall',
  '2:archetype:3': 'rogue-dedication',
  '2:mythic:4': ARMS,
  '3:ancestry:0': 'courteous-comeback',
  '3:general:1': 'toughness',
};
const answers = (picks: Record<string, string>) => Object.fromEntries(Object.entries(picks).map(([k, id]) => [`${k}:0`, `lore-${id}`]));
const ALL_ON: BuildState = {
  ...BASE,
  level: 3,
  mythicEnabled: true,
  variantRules: { freeArchetype: true, ancestryParagon: true, dualClass: true },
  classId2: 'rogue',
  featPicks: ALL_PICKS,
  featLoreChoices: answers(ALL_PICKS),
};
/** [the chip, is it on?, the keys whose slot it takes, in the order the confirm names them]. */
const TOGGLES: [string, (b: BuildState) => boolean, string[]][] = [
  ['Free Archetype', (b) => !!b.variantRules?.freeArchetype, ['2:archetype:3']],
  ['Mythic', (b) => !!b.mythicEnabled, ['2:mythic:4']],
  ['Ancestry Paragon', (b) => !!b.variantRules?.ancestryParagon, ['1:ancestry:1', '3:ancestry:0']],
  ['Dual Class', (b) => !!b.variantRules?.dualClass, ['1:class:3', '2:class:1']],
];
const nameOf = (id: string) => c().feats[id]!.name;
const slotsOf = (b: BuildState, lvl: number) =>
  levelGrants(lvl, b.classId, c(), b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, Object.values(b.featPicks)).featSlots;
/** Every pick is in a slot the Builder draws, and each still has its own answer under its key. */
function expectAllSlottedWithAnswers(b: BuildState, ids: string[]) {
  expect(Object.values(b.featPicks).sort()).toEqual([...ids].sort());
  for (const [k, id] of Object.entries(b.featPicks)) {
    const [lvl, cat, idx] = k.split(':');
    expect(slotsOf(b, Number(lvl))[Number(idx)], `${id} at ${k} is in no drawn slot`).toBe(cat);
    expect(b.featLoreChoices?.[`${k}:0`], `${id}'s answer`).toBe(`lore-${id}`);
  }
  expect(Object.keys(b.featLoreChoices ?? {}).length).toBe(ids.length);
}
const chip = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[data-setupcard] button.inv-toggle')].find((b) => (b.textContent ?? '').trim() === label)!;

describe('(A) Free Archetype, Mythic, Ancestry Paragon and Dual Class off: one confirm, the same for all four', () => {
  it('the fixture fills every slot at 1st–3rd', () => {
    expect([1, 2, 3].map((l) => slotsOf(ALL_ON, l))).toEqual([
      ['ancestry', 'ancestry', 'class', 'class'],
      ['class', 'class', 'skill', 'archetype', 'mythic'],
      ['ancestry', 'general'],
    ]);
    expectAllSlottedWithAnswers(ALL_ON, Object.values(ALL_PICKS));
  });

  for (const [label, isOn, keys] of TOGGLES) {
    const gone = keys.map((k) => ALL_PICKS[k]);
    const stay = Object.values(ALL_PICKS).filter((id) => !gone.includes(id));

    it(`${label} off names exactly the feats that lose their slot; "Turn it off" removes those and their answers; on again removes nothing`, async () => {
      const { r, saved } = open(ALL_ON);
      goPage(r, 'Setup');
      await flush();
      r.click(chip(label));
      await flush();
      const text = dialog()?.textContent ?? '';
      expect(text, 'no confirm').toContain(`Turn off ${label}?`);
      for (const k of keys) expect(text).toContain(`Level ${k.split(':')[0]} ${k.split(':')[1] === 'archetype' ? 'free archetype' : k.split(':')[1]} feat — ${nameOf(ALL_PICKS[k])}`);
      for (const id of stay) expect(text, `${id} is not losing its slot`).not.toContain(nameOf(id));
      r.click(anyButton('Turn it off'));
      await flush();
      expect(isOn(ALL_ON)).toBe(true);

      await save(r);
      const b = saved()!;
      expect(isOn(b)).toBe(false);
      expectAllSlottedWithAnswers(b, stay);

      // Back on: the slots return empty, and nothing is taken.
      goPage(r, 'Setup');
      await flush();
      r.click(chip(label));
      await flush();
      expect(dialog(), 'turning it on asks nothing').toBeFalsy();
      await save(r);
      const again = saved()!;
      expect(isOn(again)).toBe(true);
      expectAllSlottedWithAnswers(again, stay);
      r.stop();
    });

    it(`${label} off, Cancel: nothing changes, the toggle included`, async () => {
      const { r, saved } = open(ALL_ON);
      goPage(r, 'Setup');
      await flush();
      r.click(chip(label));
      await flush();
      r.click(anyButton('Cancel'));
      await flush();
      await save(r);
      const b = saved()!;
      expect(isOn(b)).toBe(true);
      expect(b.featPicks).toEqual(ALL_PICKS);
      expect(b.featLoreChoices).toEqual(ALL_ON.featLoreChoices);
      r.stop();
    });

    it(`${label} off with those slots empty: no dialog, nothing removed`, async () => {
      const kept = Object.fromEntries(Object.entries(ALL_PICKS).filter(([k]) => !keys.includes(k)));
      const { r, saved } = open({ ...ALL_ON, featPicks: kept, featLoreChoices: answers(kept) });
      goPage(r, 'Setup');
      await flush();
      r.click(chip(label));
      await flush();
      expect(dialog(), 'a dialog with nothing to lose').toBeFalsy();
      await save(r);
      const b = saved()!;
      expect(isOn(b)).toBe(false);
      expectAllSlottedWithAnswers(b, stay);
      r.stop();
    });
  }

  it('a toggle going ON in the same change as one going off takes nothing (a campaign\'s defaults)', async () => {
    // A homebrew fighter with an ancestry slot at 2nd: Ancestry Paragon REPLACES that progression, so
    // turning it on drops the 2nd-level ancestry slot. Its pick is shown as a feat with no slot — never
    // named or removed by the Free Archetype confirm that shares the change.
    const fighter = c().classes.fighter!;
    const db = { ...c(), classes: { ...c().classes, fighter: { ...fighter, featProgression: { ...fighter.featProgression, ancestry: [1, 2, 5, 9, 13, 17] } } } };
    const start: BuildState = { ...BASE, variantRules: { freeArchetype: true }, featPicks: { '2:ancestry:0': 'cooperative-nature', '2:archetype:3': 'rogue-dedication' } };
    const h = held(start, db);
    requestRulesChange({ variantRules: { freeArchetype: true, ancestryParagon: true } }, h.get(), db, h.actions);
    await flush();
    expect(dialog(), 'Paragon on alone asks nothing').toBeFalsy();
    expect(Object.values(h.get().featPicks).sort()).toEqual(['cooperative-nature', 'rogue-dedication']);

    const both = held(start, db);
    requestRulesChange({ variantRules: { ancestryParagon: true } }, both.get(), db, both.actions);
    await flush();
    expect(dialog()!.textContent).toContain('Rogue Dedication');
    expect(dialog()!.textContent).not.toContain('Cooperative Nature');
    await turnItOff();
    expect(Object.values(both.get().featPicks)).toEqual(['cooperative-nature']);
  });

  /* REFUTED: Ultimate Flexibility in the second-class slot carries a bonus slot at 20th. Dual Class off
   * named only Ultimate Flexibility; "Turn it off" took the bonus slot too, and Sudden Charge in it lost
   * its slot unnamed. */
  it('Dual Class off names the feat in a slot a named feat carries (Ultimate Flexibility\'s bonus slot) and removes both', async () => {
    const start: BuildState = {
      ...BASE,
      level: 20,
      variantRules: { dualClass: true },
      classId2: 'wizard',
      featPicks: { '2:class:0': 'intimidating-strike', '20:class:1': 'ultimate-flexibility', '20:bonus:3': 'sudden-charge' },
      featLoreChoices: { '20:bonus:3:0': 'lore-sudden-charge', '2:class:0:0': 'kept' },
    };
    expect(slotsOf(start, 20)).toEqual(['class', 'class', 'skill', 'bonus']);
    const { r, saved } = open(start);
    goPage(r, 'Setup');
    await flush();
    r.click(chip('Dual Class'));
    await flush();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('Level 20 class feat — Ultimate Flexibility');
    expect(text).toContain('Level 20 bonus feat — Sudden Charge');
    expect(text).not.toContain('Intimidating Strike');
    r.click(anyButton('Turn it off'));
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.variantRules?.dualClass).toBeFalsy();
    expect(b.featPicks).toEqual({ '2:class:0': 'intimidating-strike' });
    expect(b.featLoreChoices).toEqual({ '2:class:0:0': 'kept' });
    r.stop();
  });

  /* REFUTED: the confirm named picks by position. With Dual Class on both class slots take both classes'
   * feats, so Mobility sat in the fighter's own slot: Dual Class off named only Intimidating Strike, "Turn
   * it off" removed the fighter's feat and left Mobility in a slot that refuses it, as a normal pick. */
  it("Dual Class off names a rogue feat in the fighter's OWN slot; nothing is left in a slot that refuses it", async () => {
    const start: BuildState = {
      ...BASE,
      variantRules: { dualClass: true },
      classId2: 'rogue',
      featPicks: { '1:class:1': 'sudden-charge', '2:class:0': 'mobility', '2:class:1': 'intimidating-strike' },
      featLoreChoices: { '2:class:0:0': 'lore-mobility', '2:class:1:0': 'lore-is', '1:class:1:0': 'kept' },
    };
    const { r, saved } = open(start);
    goPage(r, 'Setup');
    await flush();
    r.click(chip('Dual Class'));
    await flush();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('Level 2 class feat — Mobility');
    expect(text).toContain('Level 2 class feat — Intimidating Strike');
    expect(text).not.toContain('Sudden Charge');
    r.click(anyButton('Turn it off'));
    await flush();
    goPage(r, '2');
    await flush();
    expect(r.host.querySelectorAll('[data-unfit]').length, 'a feat left in a slot that refuses it').toBe(0);
    expect(noSlotRows(r.host)).toEqual([]);
    await save(r);
    const b = saved()!;
    expect(b.variantRules?.dualClass).toBeFalsy();
    expect(b.featPicks).toEqual({ '1:class:1': 'sudden-charge' });
    expect(b.featLoreChoices).toEqual({ '1:class:1:0': 'kept' });
    r.stop();

    // Two rogue feats: both named.
    const two = open({ ...start, featPicks: { '2:class:0': 'mobility', '2:class:1': 'trap-finder' }, featLoreChoices: {} });
    goPage(two.r, 'Setup');
    await flush();
    two.r.click(chip('Dual Class'));
    await flush();
    expect(dialog()?.textContent).toContain('Level 2 class feat — Mobility');
    expect(dialog()?.textContent).toContain('Level 2 class feat — Trap Finder');
    two.r.stop();
  });
});

// ───────────────────── (B) a feat with no slot is SHOWN at its level, to move or remove

/** The rows the level page lists as "Feat with no slot: …", in page order. */
const noSlotRows = (host: Element) =>
  [...host.querySelectorAll('[data-noslot]')].map((n) => (n.querySelector('.lvl-card-label')?.textContent ?? '').trim());
const rowFor = (host: Element, key: string) => host.querySelector(`[data-noslot="${key}"]`)!;
const buttonIn = (el: Element | null, label: string) =>
  [...(el?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) ?? null;

/**
 * The refuter's fixture: a level-2 fighter, Mythic on, Free Archetype off. v0.1.40 turned Free
 * Archetype off and left the mythic feat at 2:mythic:3 (and the dedication at 2:archetype:2); the
 * player then filled the mythic slot it showed empty. No sequence of toggles showed the stranded feat
 * again, while the sheet kept granting it.
 */
const REFUTER: BuildState = {
  ...BASE,
  mythicEnabled: true,
  featPicks: { '2:class:0': 'intimidating-strike', '2:archetype:2': 'rogue-dedication', '2:mythic:2': 'binds-that-tie', '2:mythic:3': ARMS },
  featChoices: { '2:mythic:2': 'theirs', '2:mythic:3': 'mine' },
};

describe('(B) nothing hidden: a pick no slot draws is listed at its level with Remove and Move to slot', () => {
  it("the refuter's fixture: both stranded feats are listed at level 2 — and the sheet still grants them", async () => {
    const ch = buildCharacter(REFUTER, c());
    for (const id of [ARMS, 'rogue-dedication', 'binds-that-tie']) expect(ch.feats.some((f) => f.featId === id), id).toBe(true);
    const { r } = open(REFUTER);
    goPage(r, '1');
    await flush();
    expect(noSlotRows(r.host)).toEqual([]);
    goPage(r, '2');
    await flush();
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Rogue Dedication', 'Feat with no slot: Arms that Cut the Waves']);
    // The player's own mythic pick keeps the drawn slot, so neither can move; there is no archetype slot at all.
    expect(buttonIn(rowFor(r.host, '2:mythic:3'), 'Move to slot')).toBeNull();
    expect(buttonIn(rowFor(r.host, '2:archetype:2'), 'Move to slot')).toBeNull();
    r.stop();
  });

  it('Remove names the feat; yes drops only it and its answers', async () => {
    const { r, saved } = open(REFUTER);
    goPage(r, '2');
    await flush();
    r.click(buttonIn(rowFor(r.host, '2:mythic:3'), 'Remove'));
    await flush();
    expect(dialog()!.textContent).toContain('Remove Arms that Cut the Waves?');
    expect(dialog()!.textContent).toContain('Level 2 mythic feat with no slot — Arms that Cut the Waves');
    r.click(buttonIn(dialog(), 'Remove'));
    await flush();
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Rogue Dedication']);

    await save(r);
    const b = saved()!;
    expect(b.featPicks).toEqual({ '2:class:0': 'intimidating-strike', '2:archetype:2': 'rogue-dedication', '2:mythic:2': 'binds-that-tie' });
    expect(b.featChoices).toEqual({ '2:mythic:2': 'theirs' });
    expect(buildCharacter(b, c()).feats.some((f) => f.featId === ARMS)).toBe(false);
    r.stop();
  });

  it('Remove, Cancel: nothing changes — and opening the character wrote nothing', async () => {
    const { r, saved } = open(REFUTER);
    goPage(r, '2');
    await flush();
    r.click(buttonIn(rowFor(r.host, '2:mythic:3'), 'Remove'));
    await flush();
    r.click(anyButton('Cancel'));
    await flush();
    expect(noSlotRows(r.host)).toHaveLength(2);
    await save(r);
    expect(saved()!.featPicks).toEqual(REFUTER.featPicks);
    expect(saved()!.featChoices).toEqual(REFUTER.featChoices);
    r.stop();
  });

  it('Move to slot puts it in the empty slot of its kind with its own answers; what the cleared slot left takes the old key', async () => {
    const start: BuildState = { ...BASE, mythicEnabled: true, featPicks: { '2:mythic:3': ARMS }, featChoices: { '2:mythic:3': 'mine' }, featLoreChoices: { '2:mythic:2:0': 'Old' } };
    const { r, saved } = open(start);
    goPage(r, '2');
    await flush();
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Arms that Cut the Waves']);
    r.click(buttonIn(rowFor(r.host, '2:mythic:3'), 'Move to slot'));
    await flush();
    expect(noSlotRows(r.host)).toEqual([]);
    const slot = r.host.querySelector('button[data-ctl="slot"][data-ctl-title="Mythic feat"]');
    expect(slot?.getAttribute('data-ctl-state')).toBe('picked');
    expect(slot?.textContent).toContain('Arms that Cut the Waves');

    await save(r);
    const b = saved()!;
    expect(b.featPicks).toEqual({ '2:mythic:2': ARMS });
    expect(b.featChoices).toEqual({ '2:mythic:2': 'mine' });
    expect(b.featLoreChoices).toEqual({ '2:mythic:3:0': 'Old' });
    r.stop();
  });

  /* REFUTED: Move to slot matched only the kind of slot. Nimble Dodge, left by a second class changed
   * from rogue to wizard, went into the fighter's own class slot — whose picker lists it as not valid —
   * and then looked like a normal pick. Reach Spell after "Clear — no second class" went the same way. */
  it('Move to slot is not offered where the slot would refuse the feat: Remove only, the slot left empty', async () => {
    const nd = held({ ...BASE, level: 1, variantRules: { dualClass: true }, classId2: 'rogue', featPicks: { '1:class:2': 'nimble-dodge' } });
    nd.actions.setSecondClass('wizard');
    const [k] = Object.keys(nd.get().featPicks);
    const { r, saved } = open(nd.get());
    goPage(r, '1');
    await flush();
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Nimble Dodge']);
    expect(buttonIn(rowFor(r.host, k), 'Move to slot')).toBeNull();
    expect(buttonIn(rowFor(r.host, k), 'Remove')).toBeTruthy();
    expect(r.host.querySelector('button[data-ctl="slot"][data-ctl-title="Class feat"]')?.getAttribute('data-ctl-state')).toBe('empty');
    await save(r);
    expect(saved()!.featPicks).toEqual(nd.get().featPicks);
    r.stop();

    const rs = held({ ...BASE, variantRules: { dualClass: true }, classId2: 'wizard', featPicks: { '2:class:1': 'reach-spell' } });
    rs.actions.setSecondClass(null);
    const [k2] = Object.keys(rs.get().featPicks);
    const second = open(rs.get());
    goPage(second.r, '2');
    await flush();
    expect(noSlotRows(second.r.host)).toEqual(['Feat with no slot: Reach Spell']);
    expect(buttonIn(rowFor(second.r.host, k2), 'Move to slot')).toBeNull();
    expect(second.r.host.querySelector('button[data-ctl="slot"][data-ctl-title="Class feat"]')?.getAttribute('data-ctl-state')).toBe('empty');
    second.r.stop();
  });

  /* REFUTED: "nothing is hidden" held only for a feat whose slot went away. Move to slot put Nimble Dodge
   * in the fighter's own class slot (it took it, Dual Class rogue); Trap Finder went in the second slot;
   * the second class changed to wizard. Trap Finder was listed with no slot, but Nimble Dodge — and
   * Mobility at 2:class:0 — stayed in slots that no longer take them, shown as normal picks. */
  it('a pick its slot no longer takes is flagged in that slot — after Move to slot and a second-class change', async () => {
    const start: BuildState = {
      ...BASE,
      variantRules: { dualClass: true },
      classId2: 'rogue',
      featPicks: { '1:class:3': 'nimble-dodge', '1:class:2': 'trap-finder', '2:class:0': 'mobility' },
      featLoreChoices: { '1:class:3:0': 'Mine' },
    };
    const { r, saved } = open(start);
    goPage(r, '1');
    await flush();
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Nimble Dodge']);
    r.click(buttonIn(rowFor(r.host, '1:class:3'), 'Move to slot'));
    await flush();
    const classSlot = () => r.host.querySelector('button[data-ctl="slot"][data-ctl-title="Class feat"]');
    expect(classSlot()?.textContent).toContain('Nimble Dodge');
    expect(r.host.querySelectorAll('[data-unfit]').length, 'it takes it while the second class is a rogue').toBe(0);

    // The second class → wizard, on the Level 0 page's own control.
    goPage(r, '0');
    await flush();
    const ctl = r.host.querySelector('[data-ctl-title="Second class"]')!;
    r.click(ctl.querySelector('.ss-replace') ?? ctl);
    await flush();
    const wizard = [...document.querySelectorAll('.picker-overlay .pick-row')].find((n) => (n.querySelector('.picker-name')?.textContent ?? '').trim() === 'Wizard');
    r.click(wizard!.querySelector('.pick-add'));
    await flush();

    goPage(r, '1');
    await flush();
    expect(classSlot()?.textContent, 'flagged in place, never moved').toContain('Nimble Dodge');
    expect(r.host.querySelector('[data-unfit="1:class:1"]')?.textContent).toContain('Not valid for this slot');
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Trap Finder']);
    expect(buttonIn(rowFor(r.host, '1:class:2'), 'Move to slot')).toBeNull();
    goPage(r, '2');
    await flush();
    expect([...r.host.querySelectorAll('[data-unfit]')].map((n) => n.getAttribute('data-unfit'))).toEqual(['2:class:0']);

    // Nothing was written for the flag: every pick and answer is where the player left it.
    await save(r);
    const b = saved()!;
    expect(b.classId2).toBe('wizard');
    expect(b.featPicks).toEqual({ '1:class:1': 'nimble-dodge', '1:class:2': 'trap-finder', '2:class:0': 'mobility' });
    expect(b.featLoreChoices).toEqual({ '1:class:1:0': 'Mine' });
    r.stop();
  });

  it('Free Archetype on puts the dedication back in its own free slot with no dialog; off names it; the mythic feat is listed every time', async () => {
    const { r, saved } = open(REFUTER);
    goPage(r, 'Setup');
    await flush();
    r.click(chip('Free Archetype'));
    await flush();
    expect(dialog(), 'turning it on asks nothing').toBeFalsy();
    goPage(r, '2');
    await flush();
    // The dedication is back in the free slot it was taken in (its key means "the first free slot"),
    // so the off below can name it; the mythic feat's slot is the player's own pick, so it stays listed.
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Arms that Cut the Waves']);
    const free = r.host.querySelector('button[data-ctl="slot"][data-ctl-title="Archetype feat"]');
    expect(free?.textContent).toContain('Rogue Dedication');

    goPage(r, 'Setup');
    await flush();
    r.click(chip('Free Archetype'));
    await flush();
    expect(dialog()!.textContent).toContain('Rogue Dedication');
    expect(dialog()!.textContent).not.toContain('Arms that Cut');
    r.click(anyButton('Turn it off'));
    await flush();
    goPage(r, '2');
    await flush();
    expect(noSlotRows(r.host)).toEqual(['Feat with no slot: Arms that Cut the Waves']);
    await save(r);
    expect(Object.values(saved()!.featPicks).sort()).toEqual([ARMS, 'binds-that-tie', 'intimidating-strike'].sort());
    r.stop();
  });
});

// ─────────── (A) a dual-gate kineticist's impulses stay in their slots through Paragon and Dual Class

/*
 * REFUTED: the impulse slot's element came from its index in the whole 1st-level list. Paragon off
 * named and removed both impulses (both slots stay); Paragon on flagged both "Not valid for this slot".
 */
describe('(A) a dual-gate kineticist: Paragon and Dual Class never name, move or flag the impulse feats', () => {
  const AIR = 'aerial-boomerang';
  const FIRE = 'burning-jet';
  const KIN: BuildState = {
    ...BASE,
    level: 1,
    classId: 'kineticist',
    keyAbility: 'con',
    extraChoices: { element: ['air-gate', 'fire-gate'] },
    featChoices: { 'feature:kinetic-gate': 'dual' },
  };
  /** Level 1: the impulse slots' feats in page order, and every slot flagged as refusing its feat. */
  async function page1(r: ReturnType<typeof open>['r']) {
    goPage(r, '1');
    await flush();
    const impulses = [...r.host.querySelectorAll('button[data-ctl="slot"][data-ctl-title="Impulse feat"] .lvl-card-val')].map((n) => (n.textContent ?? '').trim());
    const unfit = [...r.host.querySelectorAll('[data-unfit]')].map((n) => n.getAttribute('data-unfit'));
    return { impulses, unfit, noSlot: noSlotRows(r.host) };
  }
  const SEEN = { impulses: ['Aerial Boomerang', 'Burning Jet'], unfit: [], noSlot: [] };

  it('Paragon off names only the paragon feat and keeps both impulses in their slots; Paragon on flags nothing', async () => {
    const start: BuildState = {
      ...KIN,
      variantRules: { ancestryParagon: true },
      featPicks: { '1:ancestry:0': 'cooperative-nature', '1:ancestry:1': 'haughty-obstinacy', '1:impulse:3': AIR, '1:impulse:4': FIRE },
    };
    const { r, saved } = open(start);
    expect(await page1(r)).toEqual(SEEN);
    goPage(r, 'Setup');
    await flush();
    r.click(chip('Ancestry Paragon'));
    await flush();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('Level 1 ancestry feat — Haughty Obstinacy');
    expect(text).not.toContain('Aerial Boomerang');
    expect(text).not.toContain('Burning Jet');
    r.click(anyButton('Turn it off'));
    await flush();
    expect(await page1(r)).toEqual(SEEN);
    await save(r);
    expect(saved()!.featPicks).toEqual({ '1:ancestry:0': 'cooperative-nature', '1:impulse:2': AIR, '1:impulse:3': FIRE });

    goPage(r, 'Setup');
    await flush();
    r.click(chip('Ancestry Paragon'));
    await flush();
    expect(dialog(), 'turning it on asks nothing').toBeFalsy();
    expect(await page1(r)).toEqual(SEEN);
    await save(r);
    expect(saved()!.featPicks).toEqual({ '1:ancestry:0': 'cooperative-nature', '1:impulse:3': AIR, '1:impulse:4': FIRE });
    r.stop();
  });

  it('Dual Class off names only the second class feat; on again flags nothing', async () => {
    const start: BuildState = {
      ...KIN,
      variantRules: { dualClass: true },
      classId2: 'fighter',
      featPicks: { '1:class:2': 'sudden-charge', '1:impulse:3': AIR, '1:impulse:4': FIRE },
    };
    const { r, saved } = open(start);
    expect(await page1(r)).toEqual(SEEN);
    goPage(r, 'Setup');
    await flush();
    r.click(chip('Dual Class'));
    await flush();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('Level 1 class feat — Sudden Charge');
    expect(text).not.toContain('Aerial Boomerang');
    expect(text).not.toContain('Burning Jet');
    r.click(anyButton('Turn it off'));
    await flush();
    expect(await page1(r)).toEqual(SEEN);
    await save(r);
    expect(saved()!.featPicks).toEqual({ '1:impulse:2': AIR, '1:impulse:3': FIRE });

    goPage(r, 'Setup');
    await flush();
    r.click(chip('Dual Class'));
    await flush();
    expect(dialog(), 'turning it on asks nothing').toBeFalsy();
    expect(await page1(r)).toEqual(SEEN);
    await save(r);
    const b = saved()!;
    expect(b.variantRules?.dualClass).toBe(true);
    const at = slotsOf(b, 1).flatMap((cat, i) => (cat === 'impulse' ? [`1:impulse:${i}`] : []));
    expect(Object.fromEntries(at.map((k) => [k, b.featPicks[k]]))).toEqual({ [at[0]]: AIR, [at[1]]: FIRE });
    r.stop();
  });
});

// ────────────────────── (4) the campaign defaults editor shows the Setup cards in the Setup order

describe('(4) the Campaigns page defaults editor opens with Sources, like Setup', () => {
  it('Sources, Variant rules, Campaign — the order RuleCards gives the Setup page', () => {
    const r = renderDom(createElement(DefaultsEditor, { content: c(), build: { ...emptyBuild(), variantRules: {} }, setBuild: noop }));
    const labels = [...r.host.querySelectorAll('[data-setupcard]')].map((n) => n.getAttribute('data-setupcard'));
    expect(labels).toEqual(['Sources', 'Variant rules', 'Campaign']);
    r.stop();
  });
});

// ─────────────────────────────────── a refused Add button LOOKS refused

describe('a disabled primary button has a disabled look', () => {
  it('.btn-primary:disabled dims, drops the pointer and the hover', () => {
    const css = readFileSync('src/sheet.css', 'utf8');
    const rule = /\.btn-primary:disabled[^{]*\{([^}]*)\}/.exec(css);
    expect(rule, 'no .btn-primary:disabled rule').toBeTruthy();
    expect(rule![1]).toMatch(/opacity:\s*0\.5/);
    expect(rule![1]).toMatch(/cursor:\s*default/);
    expect(rule![0]).toContain('.btn-primary:disabled:hover');
  });
});

// ────────────────────────────────────────────── (5) the new toggle is on the Setup page

describe('(5) "Lore instead of language" is a Setup toggle, off by default', () => {
  it('sits in the Variant rules card with its one-line hint, and starts off', async () => {
    const { r } = open(BASE);
    goPage(r, 'Setup');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Variant rules"]');
    expect(card, 'no Variant rules card').toBeTruthy();
    const toggle = [...card!.querySelectorAll('button.inv-toggle')].find(
      (b) => (b.textContent ?? '').trim() === 'Lore instead of language',
    );
    expect(toggle, 'no "Lore instead of language" toggle').toBeTruthy();
    expect(toggle!.classList.contains('on')).toBe(false);

    // Its "i" opens the hint the owner asked for, word for word.
    const info = toggle!.parentElement!.querySelector('button.rule-info');
    r.click(info!);
    await flush();
    expect(document.body.textContent).toContain(
      'Each time your Intelligence would grant an extra language, you may become trained in a new Lore instead',
    );
    r.stop();
  });
});

/** A dwarf fighter with Int +3 at 1st level: three Int-granted language slots and no other. */
const INT_DWARF: BuildState = {
  ...emptyBuild(),
  name: 't',
  level: 1,
  ancestryId: 'dwarf',
  heritageId: 'ancient-blooded-dwarf',
  backgroundId: 'scholar',
  classId: 'fighter',
  keyAbility: 'str',
  ancestryBoosts: ['int'],
  backgroundBoosts: ['int'],
  levelBoosts: ['int', 'str', 'dex', 'con'],
  enabledSources: ALL_BOOKS,
};

describe('(5) the Languages card offers each open Int slot as a language OR a Lore', () => {
  it('rule on: an open slot says so, and taking a Lore there trains it without touching the language', async () => {
    const { r, saved } = open({ ...INT_DWARF, variantRules: { loreInsteadOfLanguage: true }, languages: ['elven'] });
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]');
    expect(card, 'no Languages card').toBeTruthy();
    const open1 = card!.querySelector('[data-ctl-title="Add a language — or a Lore instead"]');
    expect(open1, 'the open slot does not offer the Lore').toBeTruthy();
    r.click(open1);
    await flush();
    r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.includes('Learn a Lore instead')) ?? null);
    await flush();
    type(document.querySelector('.picker-overlay .popsel-custom input'), 'Warfare');
    r.click(document.querySelector('.picker-overlay .popsel-custom-actions .btn-primary'));
    await flush();
    expect(card!.textContent).toContain('Warfare Lore');

    await save(r);
    const b = saved()!;
    // Stored as the key the card showed, so the engine cannot key the typed text another way.
    expect(b.languageLores).toEqual(['lore:warfare']);
    expect(b.languages).toEqual(['elven']);
    expect(buildCharacter(b, c()).proficiencies.skills['lore:warfare']).toBe('trained');
    r.stop();
  });

  it('rule off: the same slot is a language slot only', async () => {
    const { r } = open({ ...INT_DWARF, languages: ['elven'] });
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]');
    expect(card!.querySelector('[data-ctl-title="Add a language — or a Lore instead"]')).toBeNull();
    expect(card!.querySelectorAll('[data-ctl-title="Add a language"]').length).toBe(2);
    r.stop();
  });

  it('a stored Lore the current Int cannot hold is shown as kept, and removing another never writes it away', async () => {
    // Four stored (a 5th-level Int +4 build), at Int +3: three count, the fourth is on the card as kept.
    const { r, saved } = open({
      ...INT_DWARF,
      variantRules: { loreInsteadOfLanguage: true },
      languageLores: ['lore:warfare', 'lore:sailing', 'lore:mining', 'lore:heraldry'],
    });
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]')!;
    expect(idleLores(card)).toEqual(['Heraldry Lore']);
    r.click(card.querySelector('button[aria-label="Remove Warfare Lore"]'));
    await flush();
    expect(idleLores(card)).toEqual([]); // the kept fourth moves into the freed slot
    expect(card.textContent).toContain('Heraldry Lore');

    await save(r);
    expect(saved()!.languageLores).toEqual(['lore:sailing', 'lore:mining', 'lore:heraldry']);
    r.stop();
  });
});

/** The Lores on the Languages card that are kept but do not count, by name. */
const idleLores = (card: Element) =>
  [...card.querySelectorAll('.lvl-card-idle .lvl-card-val')].map((n) => (n.textContent ?? '').trim());

/** Flip the "Lore instead of language" toggle on the Setup step. */
async function flipLoreRule(r: ReturnType<typeof open>['r']) {
  goPage(r, 'Setup');
  await flush();
  const toggle = [...r.host.querySelectorAll('[data-setupcard="Variant rules"] button.inv-toggle')].find(
    (b) => (b.textContent ?? '').trim() === 'Lore instead of language',
  );
  expect(toggle, 'no "Lore instead of language" toggle').toBeTruthy();
  r.click(toggle!);
  await flush();
}

describe('(5) the Lore rule never takes a picked language away, and a Lore slot buys a NEW Lore', () => {
  it('Lores → rule off → languages picked → rule on: the card and the character both keep the languages', async () => {
    const { r, saved } = open({
      ...INT_DWARF,
      variantRules: { loreInsteadOfLanguage: true },
      languageLores: ['lore:warfare', 'lore:sailing', 'lore:mining'],
    });
    await flipLoreRule(r); // off
    goPage(r, '0');
    await flush();
    for (const name of ['Elven', 'Gnomish', 'Jotun']) {
      const card = r.host.querySelector('[data-setupcard="Languages"]')!;
      r.click(card.querySelector('[data-ctl-title="Add a language"]'));
      await flush();
      r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.startsWith(name)) ?? null);
      await flush();
    }
    await flipLoreRule(r); // back on
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]')!;
    // Before the fix: the card listed all three under "6/3 bonus" while the character knew none of them.
    expect(card.textContent).toContain('3/3 bonus');
    for (const name of ['Elven', 'Gnomish', 'Jotun']) expect(card.textContent).toContain(name);
    expect(idleLores(card)).toEqual(['Warfare Lore', 'Sailing Lore', 'Mining Lore']);
    expect(card.textContent).toContain('not counted: no free language slot from Intelligence');

    await save(r);
    const b = saved()!;
    expect(b.languageLores).toEqual(['lore:warfare', 'lore:sailing', 'lore:mining']); // kept, not written away
    expect(buildCharacter(b, c()).languages).toEqual(expect.arrayContaining(['elven', 'gnomish', 'jotun']));
    r.stop();
  });

  it('a Lore the character already has is refused with the reason, and "Lore of the Sea" is stored as the Lore shown', async () => {
    const { r, saved } = open({ ...INT_DWARF, variantRules: { loreInsteadOfLanguage: true } });
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]')!;
    r.click(card.querySelector('[data-ctl-title="Add a language — or a Lore instead"]'));
    await flush();
    r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.includes('Learn a Lore instead')) ?? null);
    await flush();
    const input = document.querySelector<HTMLInputElement>('.picker-overlay .popsel-custom input');
    const addBtn = () => document.querySelector<HTMLButtonElement>('.picker-overlay .popsel-custom-actions .btn-primary')!;
    // The Scholar background already trains Academia Lore: before the fix this spent a slot on nothing.
    type(input, 'Academia');
    expect(document.querySelector('.popsel-custom-refusal')?.textContent).toContain('Already trained in Academia Lore');
    expect(addBtn().disabled).toBe(true);
    type(input, 'Lore of the Sea');
    expect(document.querySelector('.popsel-custom-refusal')).toBeNull();
    r.click(addBtn());
    await flush();
    expect(card.textContent).toContain('Sea Lore');
    expect(card.textContent).not.toContain('Of The Sea');

    await save(r);
    const b = saved()!;
    expect(b.languageLores).toEqual(['lore:sea']);
    const ch = buildCharacter(b, c());
    expect(ch.proficiencies.skills['lore:sea']).toBe('trained');
    expect(ch.proficiencies.skills['lore:lore-of-the-sea']).toBeUndefined();
    expect(ch.proficiencies.skills['lore:of-the-sea']).toBeUndefined();
    // The builder has no keyer of its own any more: shared.tsx imports the engine's.
    expect(readFileSync('src/builder/shared.tsx', 'utf8')).not.toMatch(/export (const|function) loreKey/);
    r.stop();
  });
});

/** Open a card's add slot by its title, choose the "type your own" entry, and return the field. */
async function openCustom(r: ReturnType<typeof open>['r'], card: Element, title: string, entry: string) {
  r.click(card.querySelector(`[data-ctl-title="${title}"]`));
  await flush();
  r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.includes(entry)) ?? null);
  await flush();
  return document.querySelector<HTMLInputElement>('.picker-overlay .popsel-custom input');
}
const refusal = () => document.querySelector('.popsel-custom-refusal')?.textContent ?? null;
const addBtn = () => document.querySelector<HTMLButtonElement>('.picker-overlay .popsel-custom-actions .btn-primary')!;

describe('(5) the Trained skills card refuses a Lore the character already has', () => {
  it('a language Lore, a background Lore: refused with the source; a new one is taken, and the rule off moves nothing', async () => {
    const { r, saved } = open({ ...INT_DWARF, variantRules: { loreInsteadOfLanguage: true }, languageLores: ['lore:warfare'] });
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Trained skills"]')!;
    expect(card, 'no Trained skills card').toBeTruthy();
    const input = await openCustom(r, card, 'Add a trained skill', 'Learn a new lore');
    // Before the fix: the popup closed, the pick was stored hidden, and the rule off pushed a skill out.
    type(input, 'Warfare');
    expect(refusal()).toContain('Already trained in Warfare Lore — from a Lore taken instead of a language');
    expect(addBtn().disabled).toBe(true);
    type(input, 'Academia Lore'); // the Scholar's own
    expect(refusal()).toContain('Already trained in Academia Lore — from your background');
    type(input, 'Sailing');
    expect(refusal()).toBeNull();
    r.click(addBtn());
    await flush();
    expect(card.textContent).toContain('Sailing Lore');

    await save(r);
    const b = saved()!;
    expect(b.classSkills).toEqual(['lore:sailing']);
    // The rule off takes back its own Lore and touches nothing else.
    const on = buildCharacter(b, c()).proficiencies.skills;
    const off = buildCharacter({ ...b, variantRules: {} }, c()).proficiencies.skills;
    expect(on['lore:warfare']).toBe('trained');
    expect(off['lore:warfare'] ?? 'untrained').toBe('untrained');
    for (const k of new Set([...Object.keys(on), ...Object.keys(off)])) {
      if (k !== 'lore:warfare') expect(off[k as keyof typeof off], k).toBe(on[k as keyof typeof on]);
    }
    r.stop();
  });
});

describe('a printed background Lore is refused WITH its source', () => {
  it('Acolyte → Scribing: "— from your background", and Add stays off', async () => {
    // Before: the Acolyte's Scribing Lore was trained without a lock, so the refusal could not say
    // where it came from — "Already trained in Scribing Lore. Choose a new Lore."
    const { r } = open(BASE);
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Trained skills"]')!;
    type(await openCustom(r, card, 'Add a trained skill', 'Learn a new lore'), 'Scribing');
    expect(refusal()).toBe('Already trained in Scribing Lore — from your background. Choose a new Lore.');
    expect(addBtn().disabled).toBe(true);
    r.stop();
  });
});

describe('(5) only the slots that can still take a Lore say "Language or Lore"', () => {
  /** A human fighter with Int +1: the ancestry's own slot plus ONE Int slot. */
  const INT1_HUMAN: BuildState = {
    ...BASE,
    levelBoosts: ['int', 'str', 'dex', 'con'],
    variantRules: { loreInsteadOfLanguage: true },
  };
  const LORE_SLOT = '[data-ctl-title="Add a language — or a Lore instead"]';
  const LANG_SLOT = '[data-ctl-title="Add a language"]';

  it('two open slots, one of them a Lore slot; a Lore taken there leaves the other a language', async () => {
    expect(buildCharacter(INT1_HUMAN, c()).abilities.int).toBe(12);
    const { r, saved } = open(INT1_HUMAN);
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]')!;
    // Before the fix both said "Language or Lore" at 0/2, though only one Int slot exists.
    expect(card.querySelectorAll(LORE_SLOT).length).toBe(1);
    expect(card.querySelectorAll(LANG_SLOT).length).toBe(1);
    type(await openCustom(r, card, 'Add a language — or a Lore instead', 'Learn a Lore instead'), 'Warfare');
    r.click(addBtn());
    await flush();
    expect(card.querySelectorAll(LORE_SLOT).length).toBe(0);
    expect(card.querySelectorAll(LANG_SLOT).length).toBe(1);

    await save(r);
    expect(saved()!.languageLores).toEqual(['lore:warfare']);
    r.stop();
  });

  it('a language picked first moves the Lore label onto the slot that is left', async () => {
    const { r } = open(INT1_HUMAN);
    goPage(r, '0');
    await flush();
    const card = r.host.querySelector('[data-setupcard="Languages"]')!;
    r.click(card.querySelector(LANG_SLOT));
    await flush();
    r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.startsWith('Elven')) ?? null);
    await flush();
    expect(card.querySelectorAll(LORE_SLOT).length).toBe(1);
    expect(card.querySelectorAll(LANG_SLOT).length).toBe(0);
    r.stop();
  });
});
