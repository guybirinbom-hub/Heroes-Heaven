// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';

/**
 * THE TWEAKS PAGE (Tweaks part B, WP6; work/tweaks-part-b-notes/plan.md section 1 "WP6", section 4;
 * docs/overrides-redesign.md decisions 26-29, problem 8).
 *
 * The real Builder, mounted: the top bar's Tweaks button (shown only while Tweaks is on in Setup → Options,
 * with a count of every listed tweak — live, paused, broken and newer-version, B12), the page that takes
 * the level page's place while the Character panel stays, one row per stored tweak grouped in the
 * registry's group order, its own switch, Delete (asks nothing), Show (the stat's breakdown with its
 * Tweak line, or the record's description with PinStar), and the broken / newer / imported / moved /
 * book-changed rows. Synthetic characters only.
 *
 * MUTATION PROOF (wp6-report.md; each run alone in the WP6-only worktree, 2026-10-21): `tweakRows` skipping
 * `brokenWhy` → "a given feat whose id is not in the db…", "a text edit on a missing feat…", "a spell DC
 * tweak on a casting entry that is gone…" and "the button count includes broken rows" fail; the row switch
 * writing nothing → "the on/off switch pauses…" fails; `tweaksBadge` counting live rows only → "the on/off
 * switch…", "the button count…" and "an entry made in a newer version…" fail; the page branch dropped →
 * 22 of the 23 fail ("the Tweaks button shows only when…" alone passes: it never opens the page).
 * Fix round 1 (same worktree method): `brokenWhy` without its language exception → "a given language missing…"
 * fails; `live` greying a newer-mode rank again → "an entry made in a newer version…" fails; the record popup
 * without `descNodeOf`'s null → "a given language missing…" fails (a Show button on nothing); GmEditSheet not
 * passing `derivedBuild` → "the derived flag reaches the Builder…" fails.
 */

vi.mock('../src/sheet/download', () => ({
  downloadText: vi.fn(async () => 'saved'),
  fileSlug: (s: string) => s.replace(/\W+/g, '-').toLowerCase(),
}));

const { Builder } = await import('../src/builder/Builder');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { initialPlay } = await import('../src/rules/play');
import type { SavedChar } from '../src/data/storage';
const { TWEAK_GROUPS, NEWER_TWEAKS_GROUP } = await import('../src/rules/blocks/registry');
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

const db = content();

function hero(classId: string, level: number, overrides?: BuildOverrides, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  const b = {
    ...emptyBuild(),
    name: 'Tweaks page fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ...more,
    ...(overrides ? { overrides } : {}),
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

/** A fighter with one tweak of most kinds, Tweaks on (v: 2 and the option). */
const OV = (): BuildOverrides =>
  ({
    v: 2,
    proficiencies: { stealth: 'expert' },
    addedFeats: [{ featId: 'toughness', level: 3, category: 'general' }],
    addedLanguages: ['draconic'],
    blocks: [
      { id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, reason: 'Guild training' },
      { id: 't2', kind: 'number.add', v: 1, target: 'save:will', value: 1, from: 3 },
      { id: 't3', kind: 'number.add', v: 1, target: 'max-hp', value: 5 },
    ],
    meta: { 'proficiencies:stealth': { reason: 'Thieves guild', of: 'expert', mode: 'atLeast' } },
  }) as BuildOverrides;
const FIGHTER = (ov: BuildOverrides = OV(), more: Partial<BuildState> = {}) => hero('fighter', 5, ov, { options: { overridesEnabled: true }, ...more } as Partial<BuildState>);

/* ─────────────────────────────── the Builder, mounted ─────────────────────────────── */

const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (let i = 0; i < 4 && document.querySelector('.confirm-modal'); i++) {
    const keep = [...document.querySelectorAll('.confirm-modal .confirm-actions button')][0];
    await act(async () => {
      keep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* already unmounted */
    }
  }
  await settle();
  for (const n of [...document.body.children]) n.remove();
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}
const confirmBox = () => document.querySelector('.confirm-modal');
const buttonIn = (root: ParentNode | null | undefined, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

function openBuilder(initial: BuildState, derivedBuild?: boolean) {
  const created: BuildState[] = [];
  const r = renderDom(createElement(Builder, { content: db, initial, derivedBuild, onCancel: () => undefined, onCreate: (b: BuildState) => void created.push(b) }));
  cleanups.push(r.stop);
  return { host: r.host, created };
}
const chip = (host: HTMLElement, label: string) => [...host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === label);
const tweaksButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.builder-head button.b-tweaks');
const page = (host: HTMLElement) => host.querySelector('.tw-page');
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('li.tw-row')];
const rowBy = (host: HTMLElement, what: string | RegExp) =>
  rows(host).find((r) => {
    const t = r.querySelector('.tw-row-what')?.textContent ?? '';
    return typeof what === 'string' ? t === what : what.test(t);
  });
const rowText = (r: Element | undefined) => r?.querySelector('.tw-row-head')?.textContent ?? '';
async function openPage(host: HTMLElement) {
  await press(tweaksButton(host));
  expect(page(host), 'the Tweaks page is open').not.toBeNull();
}
/** The Character panel's maximum HP. */
const panelHp = (host: HTMLElement) => {
  const row = [...host.querySelectorAll('.brail .brow')].find((r) => (r.textContent ?? '').startsWith('Hit points'));
  return Number(/(-?\d+)\s*$/.exec(row?.textContent ?? '')?.[1]);
};

/* ─────────────────────────────── the button and the page ─────────────────────────────── */

describe('the Tweaks button and page (decisions 26-28)', () => {
  it('the Tweaks button shows only when Tweaks is on in Options, with the count', async () => {
    const on = openBuilder(FIGHTER());
    const b = tweaksButton(on.host);
    expect(b, 'Tweaks on: the button is in the top bar').not.toBeNull();
    expect(b!.querySelector('.b-tweaks-count')?.textContent).toBe('6');
    expect(b!.getAttribute('aria-label')).toBe('Tweaks, 6');
    expect(b!.closest('.lstrip'), 'not a level chip').toBeNull();

    const off = openBuilder(FIGHTER(OV(), { options: { overridesEnabled: false } } as Partial<BuildState>));
    expect(tweaksButton(off.host), 'Tweaks off: no button').toBeNull();
    // …switching it on in Setup → Options shows it at once (it asks nothing).
    await press(chip(off.host, 'Setup'));
    await press(off.host.querySelector('button.ovr-opt'));
    expect(confirmBox(), 'switching on asks nothing').toBeNull();
    expect(tweaksButton(off.host)?.querySelector('.b-tweaks-count')?.textContent).toBe('6');
  });

  it('the page replaces the level page and the Character panel stays', async () => {
    const { host } = openBuilder(FIGHTER());
    await press(chip(host, '3'));
    expect(host.querySelector('.bmain .lvl-page')?.textContent).toContain('Level 3');
    await openPage(host);
    const main = host.querySelector('.bmain')!;
    expect(main.querySelectorAll('.card-sec').length, 'one page in .bmain').toBe(1);
    expect(main.textContent).not.toContain('Level 3');
    expect(host.querySelector('aside.brail .brow'), 'the Character panel stays').not.toBeNull();
    expect(tweaksButton(host)!.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.lstrip .lchip.on'), 'no chip is on while Tweaks is open').toBeNull();
  });

  it('clicking a level chip closes the page', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    await press(chip(host, '2'));
    expect(page(host)).toBeNull();
    expect(host.querySelector('.bmain .lvl-page')?.textContent).toContain('Level 2');
    expect(tweaksButton(host)!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the button or Done closes it and returns to the page before', async () => {
    const { host } = openBuilder(FIGHTER());
    await press(chip(host, '4'));
    await openPage(host);
    await press(host.querySelector('.tw-page button.tw-done'));
    expect(page(host)).toBeNull();
    expect(host.querySelector('.lstrip .lchip.on')?.textContent?.trim(), 'Done: back to level 4').toBe('4');
    await openPage(host);
    await press(tweaksButton(host));
    expect(page(host)).toBeNull();
    expect(host.querySelector('.lstrip .lchip.on')?.textContent?.trim(), 'the button again: back to level 4').toBe('4');
  });
});

/* ─────────────────────────────── the list ─────────────────────────────── */

describe('the list (decision 27, sections 4.2-4.4)', () => {
  it("the list is grouped by kind in the registry's group order", async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    const heads = [...host.querySelectorAll('.tw-group .tw-group-name')].map((h) => h.textContent);
    expect(heads).toEqual(['Numbers', 'Ranks', 'Feats', 'Languages']);
    const order = [...TWEAK_GROUPS, NEWER_TWEAKS_GROUP] as string[];
    expect(heads.map((h) => order.indexOf(h!))).toEqual([...heads.map((h) => order.indexOf(h!))].sort((a, b) => a - b));
    const numbers = host.querySelector('.tw-group[data-group="Numbers"]')!;
    expect(numbers.querySelector('.tw-group-count')?.textContent).toBe('3');
    expect([...numbers.querySelectorAll('.tw-row-what')].map((w) => w.textContent), 'stored order inside a group').toEqual(['Athletics +1', 'Will save +1', 'Maximum HP +5']);
  });

  it('a feat taken anyway (choice.allowAnyway) is listed under "Choices", after "Feats" (tweaks p2 C2)', async () => {
    // tweaks p2 WP1: choice.allowAnyway moved from the "Feats" group to the new "Choices" group (plan C2: one
    // family under one heading), and "Choices" sits right after "Feats" in TWEAK_GROUPS.
    expect(TWEAK_GROUPS.indexOf('Choices')).toBe(TWEAK_GROUPS.indexOf('Feats') + 1);
    const { host } = openBuilder(FIGHTER({ ...OV(), allowedFeats: ['toughness'] } as BuildOverrides));
    await openPage(host);
    const heads = [...host.querySelectorAll('.tw-group .tw-group-name')].map((h) => h.textContent);
    expect(heads).toEqual(['Numbers', 'Ranks', 'Feats', 'Choices', 'Languages']);
    const choices = host.querySelector('.tw-group[data-group="Choices"]')!;
    expect(choices.querySelectorAll('li.tw-row').length, 'the one taken-anyway feat').toBe(1);
    expect(host.querySelector('.tw-group[data-group="Feats"]')!.querySelectorAll('li.tw-row').length, 'Feats keeps only the given feat').toBe(1);
  });

  it('tweaks p2 WP2: Choices rows carry their status chips (C29) and the group its own icon', async () => {
    const blocks = [
      // a place above the character's level: "Not reached yet"
      { id: 't1_aaaa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 19, category: 'general', n: 1 },
      // more takes of a feat the character does not hold: "Not in use"
      { id: 't2_aaaa', kind: 'choice.moreTakes', v: 1, record: 'reach-spell', times: 1 },
    ];
    const { host } = openBuilder(FIGHTER({ ...OV(), blocks: [...((OV().blocks as unknown[]) ?? []), ...blocks] } as BuildOverrides));
    await openPage(host);
    const group = host.querySelector('.tw-group[data-group="Choices"]')!;
    expect(group.querySelector('.lvl-group-h i')?.className).toContain('ti-list-check');
    const chips = [...group.querySelectorAll('.tw-chip')].map((c) => [c.className.replace('tw-chip ', ''), c.textContent]);
    expect(chips).toEqual([
      ['tw-chip-notReachedYet', 'Not reached yet (level 19)'],
      ['tw-chip-notInUse', 'Not in use: not on your character'],
    ]);
  });

  it('one line per tweak: what, reason, from level, on/off', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    expect(rows(host).length).toBe(6);
    const ath = rowBy(host, 'Athletics +1')!;
    expect(ath.querySelector('.tw-row-reason')?.textContent).toBe('“Guild training”');
    const will = rowBy(host, 'Will save +1')!;
    expect(will.querySelector('.tw-row-from')?.textContent).toBe('from level 3');
    const stealth = rowBy(host, 'Stealth at least expert')!;
    expect(stealth.querySelector('.tw-row-reason')?.textContent).toBe('“Thieves guild”');
    expect(rowBy(host, 'Toughness')?.querySelector('.tw-row-from')?.textContent, 'a given feat: its stored level').toBe('from level 3');
    for (const r of rows(host)) {
      const sw = r.querySelector('.tw-row-line > button.tw-toggle');
      expect(sw, 'a switch beside the line, never inside its button').not.toBeNull();
      expect(sw!.getAttribute('aria-pressed')).toBe('true');
      expect(sw!.getAttribute('aria-label')).toBe(`Turn off: ${r.querySelector('.tw-row-what')!.textContent}`);
      expect(r.querySelector('.tw-row-head .tw-toggle')).toBeNull();
    }
  });

  it('each row names where the tweak applies (Skills / Saves / Spellcasting (Cleric) / Feats …)', async () => {
    const ov = {
      v: 2,
      addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }],
      blocks: [
        { id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1 },
        { id: 't2', kind: 'number.add', v: 1, target: 'save:fortitude', value: 1 },
        { id: 't3', kind: 'number.add', v: 1, target: 'spell-dc@casting-entry:cleric-casting', value: 1 },
      ],
    } as BuildOverrides;
    const { host } = openBuilder(hero('cleric', 4, ov, { subclassId: 'cloistered-cleric', options: { overridesEnabled: true } } as Partial<BuildState>));
    await openPage(host);
    const where = (what: string | RegExp) => rowBy(host, what)?.querySelector('.tw-row-where')?.textContent;
    expect(where('Athletics +1')).toBe('Skills');
    expect(where('Fortitude save +1')).toBe('Saves');
    const dc = rowBy(host, /^Spell DC \(/)!;
    expect(dc, 'the spell DC row names its casting entry, never its id').toBeDefined();
    expect(dc.querySelector('.tw-row-what')!.textContent).not.toContain('cleric-casting');
    expect(dc.querySelector('.tw-row-where')!.textContent).toMatch(/^Spellcasting \((?!cleric-casting).+\)$/);
    expect(where('Toughness')).toBe('Feats');
    // Where comes first on the second line.
    expect(rowBy(host, 'Athletics +1')!.querySelector('.tw-row-sub')!.firstElementChild!.className).toBe('tw-row-where');
  });

  it('only one tweak is open at a time', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    await press(rowBy(host, 'Athletics +1')!.querySelector('.tw-row-head'));
    expect(host.querySelectorAll('li.tw-row.open').length).toBe(1);
    expect(rowBy(host, 'Athletics +1')!.querySelector('.tw-row-head')!.getAttribute('aria-expanded')).toBe('true');
    await press(rowBy(host, 'Will save +1')!.querySelector('.tw-row-head'));
    expect(host.querySelectorAll('li.tw-row.open').length).toBe(1);
    expect(rowBy(host, 'Will save +1')!.classList.contains('open')).toBe(true);
    expect(rowBy(host, 'Athletics +1')!.querySelector('.tw-editor')).toBeNull();
    // Opening a menu closes the row.
    await press(host.querySelector('.tw-add button.tw-menu'));
    expect(host.querySelectorAll('li.tw-row.open').length).toBe(0);
    expect(host.querySelector('.tw-add .tw-editor')).not.toBeNull();
  });

  it('the on/off switch pauses the tweak and the stats panel changes back', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    const before = panelHp(host);
    expect(Number.isFinite(before)).toBe(true);
    await press(rowBy(host, 'Maximum HP +5')!.querySelector('.tw-toggle'));
    const paused = rowBy(host, 'Maximum HP +5')!;
    expect(paused.classList.contains('off')).toBe(true);
    expect(paused.querySelector('.tw-toggle')!.getAttribute('aria-pressed')).toBe('false');
    expect(paused.querySelector('.tw-row-paused')?.textContent).toBe('paused');
    expect(panelHp(host), 'the panel drops the +5 at once').toBe(before - 5);
    expect(tweaksButton(host)!.querySelector('.b-tweaks-count')!.textContent, 'a paused tweak is still counted').toBe('6');
    await press(rowBy(host, 'Maximum HP +5')!.querySelector('.tw-toggle'));
    expect(panelHp(host), 'and takes it back').toBe(before);
  });

  it('deleting a tweak asks nothing', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    await press(rowBy(host, 'Will save +1')!.querySelector('.tw-row-head'));
    await press(rowBy(host, 'Will save +1')!.querySelector('button.tw-del'));
    expect(confirmBox(), 'no question').toBeNull();
    expect(rowBy(host, 'Will save +1')).toBeUndefined();
    expect(rows(host).length).toBe(5);
    expect(tweaksButton(host)!.querySelector('.b-tweaks-count')!.textContent).toBe('5');
  });

  it("Show on a number tweak opens that stat's breakdown with the Tweak line", async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    await press(rowBy(host, 'Athletics +1')!.querySelector('.tw-row-head'));
    await press(rowBy(host, 'Athletics +1')!.querySelector('button.tw-goto'));
    const modal = document.querySelector('.stat-detail');
    expect(modal, 'the breakdown opens').not.toBeNull();
    expect(modal!.querySelector('.sd-title')?.textContent).toContain('Athletics');
    expect(modal!.textContent).toContain('Tweak');
    expect(modal!.textContent).toContain('Guild training');
  });

  it('Show on a given feat opens its description with PinStar', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    await press(rowBy(host, 'Toughness')!.querySelector('.tw-row-head'));
    await press(rowBy(host, 'Toughness')!.querySelector('button.tw-goto'));
    await settle();
    const card = document.querySelector('.picker-overlay');
    expect(card, 'the description opens').not.toBeNull();
    expect(card!.textContent).toContain('Toughness');
    expect(card!.querySelector('.info-star'), 'PinStar').not.toBeNull();
  });
});

/* ─────────────────────────────── broken, newer, imported, moved ─────────────────────────────── */

describe('rows that need a look (decision 13, problem 8, B11, B12)', () => {
  it('a broken entry (unreadable value) shows Remove and Point to another', async () => {
    const { host } = openBuilder(FIGHTER({ v: 2, attributes: { dex: 'lots' } } as unknown as BuildOverrides));
    await openPage(host);
    const r = rows(host)[0];
    expect(r.classList.contains('broken')).toBe(true);
    expect(r.querySelector('.tw-chip-broken')?.textContent).toContain('is not a number');
    await press(r.querySelector('.tw-row-head'));
    expect(buttonIn(r, 'Remove'), 'Remove').toBeDefined();
    expect(r.querySelector('.tw-repoint'), 'Point to another').not.toBeNull();
    expect(r.querySelector('.tw-repoint')!.textContent).toContain('Point to another');
    expect(r.querySelector('button.tw-goto'), 'nothing to show for a broken tweak').toBeNull();
  });

  it('a given feat whose id is not in the db is listed broken with Remove and Point to another', async () => {
    const { host } = openBuilder(FIGHTER({ v: 2, addedFeats: [{ featId: 'no-such-feat-anywhere', level: 1, category: 'general' }] } as BuildOverrides));
    await openPage(host);
    const r = rows(host)[0];
    expect(r.classList.contains('broken')).toBe(true);
    expect(r.querySelector('.tw-chip-broken')?.textContent).toBe('Broken: "no-such-feat-anywhere" is not in the rules data any more');
    await press(r.querySelector('.tw-row-head'));
    expect(r.querySelector('.tw-problem')?.textContent).toContain('not applied');
    expect(buttonIn(r, 'Remove')).toBeDefined();
    expect(r.querySelector('.tw-repoint[data-part="record"]')).not.toBeNull();
  });

  it('a text edit on a missing feat is listed, and Remove deletes it and its meta', async () => {
    const ov = {
      v: 2,
      contentEdits: { feats: { 'gone-feat-x': { name: 'Mine' } } },
      meta: { 'contentEdits:feats/gone-feat-x': { reason: 'Old house rule', of: 'feats/gone-feat-x' } },
    } as unknown as BuildOverrides;
    const { host, created } = openBuilder(FIGHTER(ov));
    await openPage(host);
    const r = rowBy(host, /^Your text: /)!;
    expect(r, 'the text edit is listed (it was invisible before)').toBeDefined();
    expect(r.classList.contains('broken')).toBe(true);
    await press(r.querySelector('.tw-row-head'));
    await press(buttonIn(rowBy(host, /^Your text: /), 'Remove'));
    expect(confirmBox()).toBeNull();
    expect(rows(host).length).toBe(0);
    expect(host.querySelector('.tw-empty')).not.toBeNull();
    await press(host.querySelector('button.b-create'));
    for (let i = 0; i < 4 && confirmBox(); i++) await press(buttonIn(confirmBox(), 'Save anyway'));
    expect(created.length).toBe(1);
    const saved = created[0].overrides as Record<string, unknown> | undefined;
    expect(JSON.stringify(saved?.contentEdits ?? {})).not.toContain('gone-feat-x');
    expect(JSON.stringify(saved?.meta ?? {}), 'its meta goes with it').not.toContain('gone-feat-x');
  });

  it('a spell DC tweak on a casting entry that is gone is listed broken', async () => {
    const ov = { v: 2, blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'spell-dc@casting-entry:wizard-gone', value: 2 }] } as BuildOverrides;
    const { host } = openBuilder(FIGHTER(ov));
    await openPage(host);
    const r = rows(host)[0];
    expect(r.classList.contains('broken')).toBe(true);
    expect(r.querySelector('.tw-chip-broken')?.textContent).toBe('Broken: the casting entry "wizard-gone" is gone');
    expect(r.querySelector('.tw-row-what')?.textContent).toBe('Spell DC (wizard-gone) +2');
  });

  it('the button count includes broken rows', async () => {
    // A given spell the rules data does not hold: the build skips it (build.ts `liveGivenSpells` filtered by
    // content), so the row is broken — and still counted.
    const ov = { ...OV(), addedSpells: [{ spellId: 'no-such-spell-x', rank: 1 }] } as BuildOverrides;
    const { host } = openBuilder(FIGHTER(ov));
    expect(tweaksButton(host)!.querySelector('.b-tweaks-count')!.textContent).toBe('7');
    await openPage(host);
    expect(host.querySelectorAll('li.tw-row.broken').length).toBe(1);
    expect(rowBy(host, /^no-such-spell-x/)!.classList.contains('broken')).toBe(true);
    expect(rows(host).length).toBe(7);
  });

  it('a given language missing from the rules data is NOT broken: the build lists any id (WP6 fix round 1)', async () => {
    // build.ts adds `liveGivenLanguages` with no content check, so the sheet lists it: the row is live, not
    // greyed, and the switch-off question lists it (it does stop counting).
    const ov = { ...OV(), addedLanguages: ['draconic', 'no-such-language-x'] } as BuildOverrides;
    const { host } = openBuilder(FIGHTER(ov));
    await openPage(host);
    const r = rowBy(host, 'no-such-language-x')!;
    expect(r, 'listed').toBeDefined();
    expect(r.classList.contains('broken')).toBe(false);
    expect(r.classList.contains('off'), 'it counts, so it is not greyed').toBe(false);
    expect(host.querySelectorAll('li.tw-row.broken').length).toBe(0);
    // Nothing to show (no text, no refs, no page of its own): no Show button, never an empty popup.
    await press(r.querySelector('.tw-row-head'));
    expect(buttonIn(host.querySelector('li.tw-row.open'), 'Show'), 'no Show on a record with nothing to show').toBeUndefined();
  });

  it("an old entry says 'Moved from Overrides'", async () => {
    // An old character: no `v`, no meta — the Builder-open stamp marks its entries moved.
    const { host } = openBuilder(hero('fighter', 5, { addedLanguages: ['draconic'] } as BuildOverrides));
    await openPage(host);
    expect(rowBy(host, 'Draconic')!.querySelector('.tw-chip-moved')?.textContent).toBe('Moved from Overrides');
  });

  it('an entry made in a newer version is listed read-only', async () => {
    const ov = {
      v: 3,
      proficiencies: { stealth: 'expert' },
      blocks: [{ id: 't1', kind: 'number.add', v: 9, target: 'skill:athletics', value: 1 }],
      meta: { 'proficiencies:stealth': { of: 'expert', mode: 'atMost' } },
    } as unknown as BuildOverrides;
    const { host } = openBuilder(FIGHTER(ov));
    await openPage(host);
    const group = host.querySelector(`.tw-group[data-group="${NEWER_TWEAKS_GROUP}"]`)!;
    expect(group, 'listed under "Made in a newer version"').not.toBeNull();
    const newer = [...group.querySelectorAll<HTMLElement>('li.tw-row')];
    expect(newer.length).toBe(2);
    // The newer-mode rank still counts (applied as a plain rank, as its note says): read-only, NOT greyed.
    // The block this version cannot read applies nothing: greyed (WP6 fix round 1).
    expect(rowBy(host, /^Stealth/)!.classList.contains('off'), 'the newer-mode rank counts').toBe(false);
    expect(rowBy(host, /^Bonus or penalty/)!.classList.contains('off'), 'the unread block does not').toBe(true);
    for (const r of newer) {
      expect(r.classList.contains('newer')).toBe(true);
      expect(r.querySelector('.tw-toggle'), 'no switch').toBeNull();
      await press(r.querySelector('.tw-row-head'));
      const ed = host.querySelector('li.tw-row.open .tw-editor')!;
      expect(ed.textContent).toContain('newer version');
      expect(ed.querySelector('button.tw-del'), 'no Delete').toBeNull();
    }
    expect(tweaksButton(host)!.querySelector('.b-tweaks-count')!.textContent).toBe('2');
  });

  it('an imported entry says it stays on when Tweaks is off', async () => {
    const ov = { v: 2, addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }], meta: { 'addedFeats:toughness@1': { of: 'toughness@1', source: 'import' } } } as unknown as BuildOverrides;
    const { host } = openBuilder(FIGHTER(ov));
    await openPage(host);
    expect(rowBy(host, 'Toughness')!.querySelector('.tw-chip-imported')?.textContent).toBe('Imported — stays on when Tweaks is off');
  });

  it('a set whose book number changed says so', async () => {
    const ov = { v: 2, attributes: { dex: 16 }, meta: { 'attributes:dex': { of: '16', baseline: 3 } } } as unknown as BuildOverrides;
    const { host } = openBuilder(FIGHTER(ov));
    expect(tweaksButton(host)!.querySelector('.b-tweaks-dot'), 'the button says something needs a look').not.toBeNull();
    await openPage(host);
    expect(rowBy(host, 'Dexterity set to 16')!.querySelector('.tw-chip-bookChanged')?.textContent).toMatch(/^Book number changed: was 3, now \d+$/);
  });

  it('Advanced folds out under Add a tweak with the advanced menus only', async () => {
    const { host } = openBuilder(FIGHTER());
    await openPage(host);
    const main = [...host.querySelectorAll('.tw-add > .tw-menus button.tw-menu')].map((b) => b.textContent?.trim());
    // tweaks p2 WP7: "Add a place" (choice.addPlace, the extra feat place) is built, in the main menus.
    expect(main).toEqual(['Bonus or penalty', 'Set a number', 'Rank (skill, save…)', 'Add a Lore', 'Give a feat', 'Add a language', 'Add a spell', 'Add a place']);
    expect(host.querySelector('.tw-adv'), 'folded').toBeNull();
    const adv = host.querySelector<HTMLButtonElement>('button.tw-adv-toggle')!;
    expect(adv.getAttribute('aria-expanded')).toBe('false');
    await press(adv);
    expect(adv.getAttribute('aria-expanded')).toBe('true');
    expect([...host.querySelectorAll('.tw-adv button.tw-menu')].map((b) => b.textContent?.trim())).toEqual([
      'Give a class feature',
      'Remove something',
      '"Take anyway" in a picker',
      'Change a description or name',
      // tweaks p2 WP4: the other pickers' Take anyway (choice.allowAnywayAnyPicker) is built.
      '"Take anyway" in another picker',
      // tweaks p2 WP5: "Pick from any list" (choice.anyList) is built.
      'Pick from any list',
      // tweaks p2 WP8: "Take a feat more times" (choice.moreTakes) is built.
      'Take a feat more times',
      // tweaks p2 WP6: "Remove a place" (remove.choicePlace) is built.
      'Remove a place',
    ]);
  });

  it('a Builder opened from a reverse build with a rank tweak shows the notice; a stored build does not', async () => {
    const notice = 'This character had no saved build, so it was rebuilt from its sheet: a skill you picked may show as given by a tweak.';
    const derived = openBuilder(FIGHTER(), true);
    await openPage(derived.host);
    expect(derived.host.querySelector('.tw-derived')?.textContent?.trim()).toBe(notice);
    const stored = openBuilder(FIGHTER(), false);
    await openPage(stored.host);
    expect(stored.host.querySelector('.tw-derived')).toBeNull();
    // …and no rank tweak, no notice.
    const noRank = openBuilder(FIGHTER({ v: 2, addedLanguages: ['draconic'] } as BuildOverrides), true);
    await openPage(noRank.host);
    expect(noRank.host.querySelector('.tw-derived')).toBeNull();
  });

  it('the derived flag reaches the Builder from both edit paths (GM edit sheet mounted; App pinned) — WP6 fix round 1', async () => {
    // The GM's edit sheet, mounted: a character with NO stored build (rebuilt from its sheet) and a rank
    // tweak opens the Builder with the notice; the same character WITH its build does not.
    const build = FIGHTER();
    const character = buildCharacter(build, db);
    const openFromGm = async (saved: SavedChar) => {
      const r = renderDom(createElement(GmEditSheet, { initial: saved, live: saved, content: db, campaignId: 'camp-test', playerOwnerId: 'player-test', onExit: () => undefined }));
      cleanups.push(r.stop);
      await settle();
      const edit = r.host.querySelector<HTMLButtonElement>('button[aria-label="Edit in builder"], button[aria-label="Edit character"]');
      await press(edit);
      await openPage(r.host);
      return r.host;
    };
    const derivedHost = await openFromGm({ id: 'gm-derived', character, play: initialPlay(character, db) } as SavedChar);
    expect(derivedHost.querySelector('.tw-derived'), 'no stored build: the notice').not.toBeNull();
    for (const n of [...document.body.children]) n.remove();
    const storedHost = await openFromGm({ id: 'gm-stored', character, build, play: initialPlay(character, db) } as SavedChar);
    expect(storedHost.querySelector('.tw-derived'), 'a stored build: no notice').toBeNull();
    // App's edit path (too large to mount here): pinned at the source — `editableBuildOf`'s flag is kept on
    // `editing` and handed to the Builder.
    const app = readFileSync(join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/setEditing\(\{ id: active\.id, build: eb\.build, derived: eb\.derived \}\)/);
    expect(app).toMatch(/derivedBuild=\{editing\?\.derived\}/);
  });
});
