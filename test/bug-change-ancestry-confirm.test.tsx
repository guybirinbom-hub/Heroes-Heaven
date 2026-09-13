// @vitest-environment jsdom
// bug 2026-09-12 #3b: change-ancestry-confirm
import { createElement, act } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

/**
 * "i come back to edit and things are different." — owner, 2026-09-12.
 *
 * Changing the ancestry silently dropped the heritage, the ancestry boosts, the heritage skill and
 * feat, every language and every ancestry feat pick. Changing CLASS and lowering the LEVEL both stop
 * and ask; one misclick in the ancestry search list did not, and there is no way back from it.
 *
 * The guard, on the real Builder: an origin swap that would throw away an answered pick opens the
 * app's confirm dialog naming what goes, Cancel changes NOTHING, and a build with nothing to lose
 * still changes with no dialog at all. Heritage and background are the same shape and same rule.
 */
const c = () => content();
const noop = () => undefined;

/** A level-3 catfolk bard with an answered pick of every kind the ancestry swap destroys. */
const FILLED: BuildState = {
  ...emptyBuild(),
  name: 'Kyra',
  level: 3,
  ancestryId: 'catfolk',
  heritageId: 'clawed-catfolk',
  backgroundId: 'acolyte',
  classId: 'bard',
  subclassId: 'maestro',
  keyAbility: 'cha',
  ancestryBoosts: ['int'],
  languages: ['amurrun'],
  featPicks: { '1:ancestry:0': 'cats-luck', '2:class:0': 'bardic-lore' },
};

function open(initial: BuildState) {
  let saved: BuildState | null = null;
  const r = renderDom(
    createElement(Builder, { content: c(), initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }),
  );
  // Editing an existing build opens on the Setup (campaign options) page; the origin pickers live on
  // the level strip's "0" page, one click away, exactly as for the player.
  const zero = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0');
  if (zero) r.click(zero);
  return { r, saved: () => saved };
}

/** confirmDialog resolves, then tears its root down on a deferred timer — so let one fire before
 *  asking whether the dialog is gone (and before the next test looks for one). */
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
/** confirmDialog mounts its own root on <body>, so look app-wide — never inside the host. */
const dialog = () => document.querySelector('.confirm-modal');
const dialogButton = (label: string) =>
  [...(dialog()?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) ?? null;
const anyButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label) ?? null;

/** Open a SearchSelect by its harness title and choose the option named `name`, as a player does. */
async function pick(r: ReturnType<typeof open>['r'], title: string, name: string) {
  const ctl = document.querySelector(`[data-ctl-title="${title}"]`);
  expect(ctl, `no "${title}" control on the setup page`).toBeTruthy();
  // A filled control reads first: the pencil "Replace" button re-opens the list. An empty one IS the button.
  r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
  await flush();
  const row = [...document.querySelectorAll('.picker-overlay .pick-row')].find(
    (x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === name,
  );
  expect(row, `no "${name}" row in the ${title} picker`).toBeTruthy();
  r.click([...row!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Select') ?? null);
  await flush();
}

/** Press "Save changes" and answer the unfinished-choices confirmation, so the test can read the
 *  build the Builder is actually holding. */
async function save(r: ReturnType<typeof open>['r']) {
  r.click(anyButton('Save changes'));
  await flush();
  const anyway = anyButton('Save anyway');
  if (anyway) {
    r.click(anyway);
    await flush();
  }
}

describe('changing the ancestry asks before it drops answered picks', () => {
  it('opens the app dialog and lists every pick that would be lost', async () => {
    const h = open(FILLED);
    await pick(h.r, 'Ancestry', 'Elf');
    const d = dialog();
    expect(d, 'changing ancestry destroyed six answers with no confirmation').toBeTruthy();
    // The app's dialog, never the browser's — project rule.
    expect(d!.getAttribute('role')).toBe('alertdialog');
    const text = d!.textContent ?? '';
    expect(text).toContain('Clawed Catfolk'); // the heritage, by name
    expect(text).toContain('Ancestry attribute boosts');
    expect(text).toContain('Languages (1)');
    expect(text).toMatch(/Ancestry feat/);
    h.r.click(dialogButton('Cancel'));
    await flush();
    h.r.stop();
  });

  it('Cancel changes nothing at all', async () => {
    const h = open(FILLED);
    await pick(h.r, 'Ancestry', 'Elf');
    h.r.click(dialogButton('Cancel'));
    await flush();
    expect(dialog(), 'the dialog stayed open after Cancel').toBeFalsy();
    await save(h.r);
    expect(h.saved(), 'Cancel still changed the build').toEqual(FILLED);
    h.r.stop();
  });

  it('confirming applies the change — and only then', async () => {
    const h = open(FILLED);
    await pick(h.r, 'Ancestry', 'Elf');
    h.r.click(dialogButton('Change ancestry'));
    await flush();
    await save(h.r);
    const out = h.saved()!;
    expect(out.ancestryId).toBe('elf');
    expect(out.heritageId).toBeNull();
    expect(out.languages).toEqual([]);
    expect(out.ancestryBoosts.some((a) => a)).toBe(false);
    expect(out.featPicks['1:ancestry:0']).toBeUndefined();
    expect(out.featPicks['2:class:0'], 'a class pick is not the ancestry’s to drop').toBe('bardic-lore');
    h.r.stop();
  });

  it('a fresh build changes ancestry with no dialog', async () => {
    const h = open({ ...emptyBuild(), name: 'New' });
    await pick(h.r, 'Ancestry', 'Elf');
    expect(dialog(), 'a build with nothing to lose must not be interrupted').toBeFalsy();
    await save(h.r);
    expect(h.saved()!.ancestryId).toBe('elf');
    h.r.stop();
  });

  it('re-picking the ancestry it already has is a no-op, not a wipe', async () => {
    const h = open(FILLED);
    await pick(h.r, 'Ancestry', 'Catfolk');
    expect(dialog()).toBeFalsy();
    await save(h.r);
    expect(h.saved()).toEqual(FILLED);
    h.r.stop();
  });
});

describe('the siblings that drop picks the same way', () => {
  it('changing heritage asks before dropping the heritage skill', async () => {
    const start: BuildState = {
      ...emptyBuild(),
      name: 'Sel',
      level: 1,
      ancestryId: 'human',
      heritageId: 'skilled-human',
      heritageSkill: 'acrobatics',
    };
    const h = open(start);
    await pick(h.r, 'Heritage', 'Versatile Human');
    expect(dialog(), 'the heritage swap dropped the chosen skill with no confirmation').toBeTruthy();
    expect(dialog()!.textContent).toContain('Heritage skill');
    h.r.click(dialogButton('Cancel'));
    await flush();
    await save(h.r);
    expect(h.saved()).toEqual(start);
    h.r.stop();
  });

  it('changing background asks before dropping its answered boosts', async () => {
    const start: BuildState = {
      ...emptyBuild(),
      name: 'Sel',
      level: 1,
      ancestryId: 'human',
      backgroundId: 'acolyte',
      backgroundBoosts: ['wis', null],
    };
    const h = open(start);
    await pick(h.r, 'Background', 'Criminal');
    expect(dialog(), 'the background swap dropped its boosts with no confirmation').toBeTruthy();
    expect(dialog()!.textContent).toContain('Background attribute boosts');
    h.r.click(dialogButton('Cancel'));
    await flush();
    await save(h.r);
    expect(h.saved()).toEqual(start);
    h.r.stop();
  });
});
