// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';

/**
 * THE OPTIONS SWITCH-OFF QUESTION (Tweaks part B, WP6; work/tweaks-part-b-notes/plan.md section 5.3;
 * docs/overrides-redesign.md decisions 8 and 28, spec 2).
 *
 * Setup → Options → Tweaks is written ONLY by blocks/write.ts `setTweaksSwitch` (`v` and the option in one
 * result). Switching it off asks first — "Turn off Tweaks?" with what stops counting (grouped; an old given
 * feat "may have come from an import"), what stays on (import-stamped) and what a newer version made — and
 * "Keep on" writes nothing. Switching on asks nothing. Synthetic characters only.
 *
 * MUTATION PROOF (wp6-report.md; each run alone in the WP6-only worktree, 2026-10-21): the toggle not asking →
 * "switching Tweaks off asks first…", "Cancel keeps it on…" and "the switch writes v: 2…" fail; the toggle
 * writing `options` alone (no setTweaksSwitch) passed every mounted assert (the open stamp already wrote `v`),
 * so "the switch writes v: 2…" pins the source too — with the pin, that mutation fails it. Fix round 1: the list
 * without its start-level check → "switching Tweaks off asks first…" fails (the level-7 Reflex line).
 */

vi.mock('../src/sheet/download', () => ({
  downloadText: vi.fn(async () => 'saved'),
  fileSlug: (s: string) => s.replace(/\W+/g, '-').toLowerCase(),
}));

const { Builder } = await import('../src/builder/Builder');
const { emptyBuild } = await import('../src/rules/build');
const { tweaksTurnOffList } = await import('../src/builder/tweaks/model');
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

const db = content();

function fighter(overrides?: BuildOverrides, more: Partial<BuildState> = {}): BuildState {
  const b = {
    ...emptyBuild(),
    name: 'Switch fixture',
    level: 5,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (db.classes.fighter.subclass?.options[0]?.id as string) ?? null,
    ...more,
    ...(overrides ? { overrides } : {}),
  } as BuildState;
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

/** An OLD character (no `v`): a given feat, a ritual-free spell, a language, a rank — plus an imported feat,
 *  a block a newer version wrote, and a paused tweak (already off: not listed). */
const OLD = (): BuildOverrides =>
  ({
    addedFeats: [
      { featId: 'toughness', level: 1, category: 'general' },
      { featId: 'fleet', level: 1, category: 'general' },
    ],
    // 'no-such-language-x': the build lists any given language id, so it counts and stops counting too.
    addedLanguages: ['draconic', 'elven', 'no-such-language-x'],
    proficiencies: { stealth: 'expert' },
    blocks: [
      { id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1 },
      { id: 't2', kind: 'number.add', v: 1, target: 'save:will', value: 1, on: false },
      { id: 't3', kind: 'number.add', v: 7, target: 'skill:diplomacy', value: 2 },
      // Starts at level 7 on a level-5 fighter: counts for nothing today, so switching off changes nothing.
      { id: 't4', kind: 'number.add', v: 1, target: 'save:reflex', value: 1, from: 7 },
    ],
    meta: { 'addedFeats:fleet@1': { of: 'fleet@1', source: 'import' } },
  }) as unknown as BuildOverrides;

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
const confirmTitle = () => confirmBox()?.querySelector('.picker-head')?.textContent?.trim() ?? null;
const buttonIn = (root: ParentNode | null | undefined, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
async function openOptions(initial: BuildState) {
  const created: BuildState[] = [];
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => undefined, onCreate: (b: BuildState) => void created.push(b) }));
  cleanups.push(r.stop);
  // An existing character opens on Setup.
  const toggle = () => r.host.querySelector<HTMLButtonElement>('button.ovr-opt');
  expect(toggle(), 'the Tweaks switch in Setup → Options').not.toBeNull();
  return { host: r.host, created, toggle };
}
async function save(host: HTMLElement) {
  await press(host.querySelector('button.b-create'));
  for (let i = 0; i < 4 && confirmBox(); i++) await press(buttonIn(confirmBox(), 'Save anyway'));
}
const items = (sel: string) => [...(confirmBox()?.querySelectorAll(`${sel} li`) ?? [])].map((l) => l.textContent);

describe('the Options switch-off question (section 5.3)', () => {
  it('switching Tweaks off asks first and lists what turns off, what stays on (imports) and what was made in a newer version', async () => {
    const o = await openOptions(fighter(OLD()));
    expect(o.toggle()!.textContent?.trim()).toBe('Tweaks');
    expect(o.toggle()!.classList.contains('on'), 'an old character reads ON').toBe(true);
    await press(o.toggle());
    expect(confirmTitle()).toBe('Turn off Tweaks?');
    const box = confirmBox()!;
    expect(box.textContent).toContain('These stop counting until you turn Tweaks back on. Nothing is deleted.');
    const groups = [...box.querySelectorAll('.tw-off-group')].map((g) => g.querySelector('strong')?.textContent);
    expect(groups, 'grouped by kind, in the registry order').toEqual(['Numbers', 'Ranks', 'Feats', 'Languages']);
    const off = items('.tw-off-list');
    expect(off).toContain('Athletics +1');
    expect(off).toContain('Stealth at least expert');
    expect(off, 'an old given feat may have come from an import (spec 2)').toContain('Toughness — may have come from an import');
    expect(off).toContain('Draconic');
    expect(off).toContain('Elven');
    expect(off.some((l) => l?.startsWith('Will save')), 'a paused tweak is already off').toBe(false);
    // WP6 fix round 1: a tweak that starts later is not live, so it is not listed (plan 5.3 "the live tweaks");
    // a given language missing from the rules data still counts on the sheet, so it is listed.
    expect(off.some((l) => l?.startsWith('Reflex save')), 'a tweak starting at level 7 counts for nothing at 5').toBe(false);
    expect(off).toContain('no-such-language-x');
    expect(items('.tw-off-stay'), 'the imported feat stays on').toEqual(['Fleet']);
    expect(items('.tw-off-newer'), 'the block a newer version wrote').toEqual(['Bonus or penalty: Diplomacy']);
    expect(buttonIn(box, 'Turn off')!.className).toContain('btn-danger');
    await press(buttonIn(box, 'Turn off'));
    expect(o.toggle()!.classList.contains('on')).toBe(false);
    // The pure list agrees with the dialog.
    const l = tweaksTurnOffList(fighter(OLD()), db, null);
    expect(l.stayOn).toEqual(['Fleet']);
  });

  it('Cancel keeps it on and writes nothing', async () => {
    const initial = fighter(OLD());
    const o = await openOptions(initial);
    await press(o.toggle());
    await press(buttonIn(confirmBox(), 'Keep on'));
    expect(confirmBox()).toBeNull();
    expect(o.toggle()!.classList.contains('on'), 'still on').toBe(true);
    expect(o.host.querySelector('.builder-head button.b-tweaks'), 'the Tweaks button stays').not.toBeNull();
    await save(o.host);
    expect(o.created.length).toBe(1);
    expect(o.created[0].options?.overridesEnabled, 'the stamped switch, ON').toBe(true);
  });

  it('switching on asks nothing', async () => {
    const o = await openOptions(fighter({ v: 2, addedLanguages: ['draconic'] } as BuildOverrides, { options: { overridesEnabled: false } } as Partial<BuildState>));
    expect(o.toggle()!.classList.contains('on')).toBe(false);
    await press(o.toggle());
    expect(confirmBox(), 'no question').toBeNull();
    expect(o.toggle()!.classList.contains('on')).toBe(true);
    // With no tweak at all, switching off asks nothing either.
    const empty = await openOptions(fighter(undefined, { options: { overridesEnabled: true } } as Partial<BuildState>));
    await press(empty.toggle());
    expect(confirmBox(), 'nothing to list: no dialog').toBeNull();
    expect(empty.toggle()!.classList.contains('on')).toBe(false);
  });

  it('the switch writes v: 2 and overridesEnabled together', async () => {
    const o = await openOptions(fighter(OLD()));
    await press(o.toggle());
    await press(buttonIn(confirmBox(), 'Turn off'));
    await save(o.host);
    expect(o.created.length).toBe(1);
    const saved = o.created[0];
    expect(saved.overrides?.v).toBe(2);
    expect(saved.options?.overridesEnabled).toBe(false);
    // …and a newer app's v is kept (B27).
    const v3 = await openOptions(fighter({ ...OLD(), v: 3 } as BuildOverrides, { options: { overridesEnabled: true } } as Partial<BuildState>));
    await press(v3.toggle());
    await press(buttonIn(confirmBox(), 'Turn off'));
    await save(v3.host);
    expect(v3.created[0].overrides?.v).toBe(3);
    expect(v3.created[0].options?.overridesEnabled).toBe(false);
    // SOURCE PIN: the Builder's open stamp already wrote `v`, so no mounted run can tell the one writer from
    // a toggle writing `options` alone (mutation M5 survived the mounted asserts above). The toggle must go
    // through setTweaksSwitch — the ONE writer of the switch (plan B section 5.3, blocks/write.ts).
    const src = readFileSync(join(__dirname, '..', 'src', 'builder', 'shared.tsx'), 'utf8');
    const card = src.slice(src.indexOf('export function OptionsCard('), src.indexOf('export function SetupCard('));
    expect(card, 'OptionsCard found').toContain('label="Tweaks"');
    expect(card).toMatch(/actions\.patch\(\(b\) => setTweaksSwitch\(b, !tweaksOn\)\)/);
    expect(card, 'no second writer of the switch').not.toMatch(/overridesEnabled\s*:/);
  });
});

/* tweaks p2 WP2 (C33): the Choices group is listed by what switching off does to each pick — what a tweak ADDED
 * stops counting, what it only ALLOWED stays picked and still counts (phase 1's Take anyway among them), what it
 * REMOVED comes back. A place above the character's level counts for nothing today and is not listed. */
describe('the switch-off question names the Choices group in three lists (tweaks p2 C33)', () => {
  const CHOICES = (): BuildOverrides =>
    ({
      v: 2,
      allowedFeats: ['toughness'],
      blocks: [
        { id: 't1_aaaa', kind: 'choice.moreTakes', v: 1, record: 'toughness', times: 1 },
        { id: 't2_aaaa', kind: 'remove.choicePlace', v: 1, place: 'feat', level: 2, category: 'class', ordinal: 0 },
        { id: 't3_aaaa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 9, category: 'general', n: 1 },
      ],
    }) as unknown as BuildOverrides;

  it('stops / stays / returns, each with its pick; a place not reached yet is left out', async () => {
    const b = fighter(CHOICES(), { options: { overridesEnabled: true } } as Partial<BuildState>);
    const l = tweaksTurnOffList(b, db, null);
    expect(l.off.map((g) => g.group), 'no Choices line among the kind groups').not.toContain('Choices');
    expect(l.choices.stops).toHaveLength(1);
    expect(l.choices.stays).toHaveLength(1);
    expect(l.choices.returns).toHaveLength(1);
    expect(l.choices.stays[0]).toContain('Toughness');
    const o = await openOptions(b);
    await press(o.toggle());
    const box = confirmBox()!;
    const groups = [...box.querySelectorAll<HTMLElement>('.tw-off-choices')].map((g) => [g.dataset.choiceRole, g.querySelector('strong')?.textContent, g.querySelectorAll('li').length]);
    expect(groups).toEqual([
      ['stops', 'Choices: stops counting', 1],
      ['stays', 'Choices: stays picked and still counts', 1],
      ['returns', 'Choices: comes back and counts again', 1],
    ]);
  });

  it('a character whose only tweaks are choices still asks before switching off', async () => {
    const o = await openOptions(fighter({ v: 2, allowedFeats: ['toughness'] } as unknown as BuildOverrides, { options: { overridesEnabled: true } } as Partial<BuildState>));
    await press(o.toggle());
    expect(confirmTitle()).toBe('Turn off Tweaks?');
    expect(items('.tw-off-choices')).toHaveLength(1);
  });
});
