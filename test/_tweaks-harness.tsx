import { act, createElement, useMemo, useState } from 'react';
import { expect } from 'vitest';
import { renderDom } from './_render';
import type { BuilderActions } from '../src/builder/shared';
import { TweaksPage } from '../src/builder/tweaks/TweaksPage';
import { contentFor } from '../src/rules/blocks/content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { BuildOverrides, ContentDatabase } from '../src/rules/types';

/**
 * Shared steps for the Tweaks editor tests (plan B WP7: test/tweaks-screen-registry.test.tsx,
 * test/tweaks-editors.test.tsx, test/overrides-write.test.tsx). The Tweaks page over a live build: its
 * writes go through `actions.patch` exactly as in the Builder (the draft really changes), the content is
 * the Builder's full view (`contentFor`, the live text edits laid over) and the character is rebuilt
 * from the draft after every change. Every step drives the page as a player does: menus, pickers, boxes.
 * Synthetic characters only.
 */

export async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** A level-`level` character of `classId`, Tweaks switched on, holding `overrides`. */
export function hero(db: ContentDatabase, classId: string, level: number, overrides?: BuildOverrides, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  const b = {
    ...emptyBuild(),
    name: 'Tweaks editor fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    options: { overridesEnabled: true },
    ...more,
    ...(overrides ? { overrides } : {}),
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

/** The Tweaks page over a live build. `build()` is the draft as the page last wrote it. `newer`: the FIRST
 *  patch's updater is handed `newer(build)` instead of the build the page rendered (another write landed in
 *  between — a second tab's pull, two writes in one tick), the case the page's updater writes again for. */
export function mountTweaks(db: ContentDatabase, initial: BuildState, opts: { onPending?: (dirty: boolean) => void; newer?: (b: BuildState) => BuildState } = {}) {
  let latest = initial;
  let patches = 0;
  let newer = opts.newer;
  function Host() {
    const [b, setB] = useState(initial);
    latest = b;
    const actions = useMemo(
      () =>
        new Proxy({} as BuilderActions, {
          get: (_t, prop) =>
            prop === 'patch'
              ? (p: Partial<BuildState> | ((x: BuildState) => Partial<BuildState>)) => {
                  patches++;
                  const first = newer;
                  newer = undefined;
                  setB((x0) => {
                    const x = first ? first(x0) : x0;
                    return { ...x, ...(typeof p === 'function' ? p(x) : p) };
                  });
                }
              : () => undefined,
        }),
      [],
    );
    const view = useMemo(() => contentFor(db, b), [b]);
    const character = useMemo(() => buildCharacter(b, view), [b, view]);
    return createElement(TweaksPage, { build: b, actions, content: view, bookContent: db, character, onDone: () => undefined, onPendingChange: opts.onPending });
  }
  const r = renderDom(createElement(Host));
  return { ...r, build: () => latest, patches: () => patches };
}

export async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
export const buttonIn = (root: ParentNode | null | undefined, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;

/** Type into a box the way a keystroke does (the native setter, then an input event). */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
export function focus(el: HTMLElement) {
  act(() => el.focus());
}
export function leave(el: HTMLElement) {
  act(() => el.blur());
}
/** Focus, type, leave: one finished entry. */
export async function enter(el: HTMLInputElement | HTMLTextAreaElement | null | undefined, text: string) {
  if (!el) throw new Error('no such box');
  focus(el);
  typeInto(el, text);
  leave(el);
  await settle();
}

/** The "Add a tweak" menu buttons (the Advanced ones only once folded out). */
export const menuButtons = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('.tw-add button.tw-menu')];
/** Open one "Add a tweak" menu, folding out Advanced first when it lives there. */
export async function openMenu(host: HTMLElement, name: string) {
  let b = menuButtons(host).find((x) => (x.textContent ?? '').trim() === name);
  if (!b) {
    const adv = host.querySelector<HTMLButtonElement>('button.tw-adv-toggle');
    if (adv?.getAttribute('aria-expanded') === 'false') await press(adv);
    b = menuButtons(host).find((x) => (x.textContent ?? '').trim() === name);
  }
  expect(b, `no "${name}" menu`).toBeTruthy();
  await press(b);
  const ed = addEditor(host);
  expect(ed, `the "${name}" editor opens`).not.toBeNull();
  return ed!;
}
export const addEditor = (host: ParentNode) => host.querySelector<HTMLElement>('.tw-add-editor');
/** The parts an editor shows outside its own Advanced fold, in order. */
export const partsOf = (ed: Element) => [...ed.querySelectorAll<HTMLElement>(':scope > .tw-parts > [data-part]')].map((e) => e.dataset.part);
/** The parts inside the editor's own Advanced fold, in order. */
export const advancedPartsOf = (ed: Element) => [...ed.querySelectorAll<HTMLElement>(':scope > .tw-editor-adv [data-part]')].map((e) => e.dataset.part);
export const chooserLabels = (ed: Element) => [...ed.querySelectorAll('.tw-chooser button.tw-opt')].map((b) => (b.textContent ?? '').trim());
export const pressedOption = (ed: Element) => (ed.querySelector('.tw-chooser button.tw-opt[aria-pressed="true"]')?.textContent ?? '').trim();
export const numberBox = (ed: ParentNode) => ed.querySelector<HTMLInputElement>('[data-part="number"] input');
export const levelBox = (ed: ParentNode) => ed.querySelector<HTMLInputElement>('input[aria-label="From level"]');
export const reasonBox = (ed: ParentNode) => ed.querySelector<HTMLInputElement>('input[aria-label="Reason"]');

/**
 * Open the picker carrying `title` (its `data-ctl-title`) inside `root` and choose the option named `name`,
 * as a player does: search it, then the row's Select button (a row with a description) or the row itself.
 */
export async function pick(root: ParentNode, title: string, name: string) {
  const ctl = root.querySelector(`[data-ctl-title="${title}"]`);
  expect(ctl, `no "${title}" picker`).toBeTruthy();
  await press(ctl!.querySelector('.ss-replace') ?? ctl!);
  const overlays = [...document.querySelectorAll('.picker-overlay')];
  const ov = overlays[overlays.length - 1];
  const search = ov?.querySelector<HTMLInputElement>('input.name-input');
  if (search) {
    typeInto(search, name);
    await settle();
  }
  const named = (x: Element) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === name;
  const row = [...(ov?.querySelectorAll('.pick-row') ?? [])].find(named);
  const item = [...(ov?.querySelectorAll('.picker-item') ?? [])].find(named);
  expect(row ?? item, `no "${name}" in the ${title} picker`).toBeTruthy();
  if (row) await press(buttonIn(row, 'Select'));
  else await press(item);
}

/** The rows of the list, and one by its "what" text. */
export const rows = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>('li.tw-row')];
export const rowBy = (host: ParentNode, what: string | RegExp) =>
  rows(host).find((r) => {
    const t = r.querySelector('.tw-row-what')?.textContent ?? '';
    return typeof what === 'string' ? t === what : what.test(t);
  });
export const openRow = (host: ParentNode) => host.querySelector<HTMLElement>('li.tw-row.open');
