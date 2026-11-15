// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { skillTweakNotes } from '../src/builder/tweaks/skillNotes';
import { emptyBuild, type BuildState } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

/**
 * THE SKILL-INCREASE PICKER AND THE RANK TWEAKS (plan B WP8; spec item 9, D8). The level's increase, the
 * class's bonus increase and the background's ask `skillTweakNotes` (src/builder/tweaks/skillNotes.ts) per
 * option, and read the ranks "before this level" with the tweaks as they stand AT the viewed level
 * (Builder `baseSkills`, `overridesAsOf`):
 *   - a skill held "exactly" is greyed with the reason (the clamp is final, so any level);
 *   - the stored pick of the level is never greyed, and says so under it;
 *   - a stored pick a floor made useless is flagged, naming the floor;
 *   - a floor that starts at 5th does not show while the 3rd-level increase is picked.
 * Synthetic characters only.
 */

const db = content();
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  for (const n of [...document.body.children]) n.remove();
});
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));

/** A fighter with Tweaks on, holding these rank tweaks (meta stamped: mode and of, as the Tweaks page writes them). */
function fighter(level: number, overrides?: BuildOverrides, more: Partial<BuildState> = {}): BuildState {
  return {
    ...emptyBuild(),
    name: 'Skill picker fixture',
    level,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    options: { overridesEnabled: true },
    ...(overrides ? { overrides } : {}),
    ...more,
  } as BuildState;
}
const HELD_STEALTH: BuildOverrides = { v: 2, proficiencies: { stealth: 'trained' }, meta: { 'proficiencies:stealth': { of: 'trained', mode: 'exactly' } } };
const FLOOR_THIEVERY = (from?: number): BuildOverrides => ({
  v: 2,
  proficiencies: { thievery: 'expert' },
  meta: { 'proficiencies:thievery': { of: 'expert', mode: 'atLeast', ...(from ? { from } : {}) } },
});

function openOn(b: BuildState, page: string) {
  const r = renderDom(createElement(Builder, { content: db, initial: b, onCancel: () => undefined, onCreate: () => undefined }));
  cleanups.push(r.stop);
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
  return r;
}
/** The level's "Skill increase" picker, opened; its rows. */
async function increaseRows(r: ReturnType<typeof openOn>) {
  const ctl = r.host.querySelector('[data-ctl-title="Skill increase"]');
  expect(ctl, 'a skill-increase control').toBeTruthy();
  r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
  await flush();
  return [...document.querySelectorAll('.picker-overlay .picker-item')] as HTMLButtonElement[];
}
const rowNamed = (rows: HTMLButtonElement[], skill: string) => rows.find((x) => (x.querySelector('.picker-name')?.textContent ?? '').trim().startsWith(`${skill} (`));
const why = (row: Element | undefined) => (row?.querySelector('.picker-why')?.textContent ?? '').trim();

describe('the skill-increase picker reads the rank tweaks (plan B WP8)', () => {
  it('a skill held "exactly" is greyed with the reason', async () => {
    const r = openOn(fighter(5, HELD_STEALTH), '3');
    const rows = await increaseRows(r);
    const stealth = rowNamed(rows, 'Stealth');
    expect(stealth, 'Stealth is listed').toBeTruthy();
    expect(stealth!.disabled).toBe(true);
    expect(why(stealth)).toBe('Held at Trained by a tweak ("exactly") — an increase would change nothing.');
    // …and only Stealth: a skill no tweak holds stays live.
    expect(rowNamed(rows, 'Athletics')!.disabled).toBe(false);
  });

  it('the stored pick of this level stays visible when held', async () => {
    const r = openOn(fighter(5, HELD_STEALTH, { skillIncreases: { 3: 'stealth' } }), '3');
    const ctl = r.host.querySelector('[data-ctl-title="Skill increase"]');
    expect((ctl?.querySelector('.popsel-val')?.textContent ?? '').trim()).toMatch(/^Stealth \(/);
    expect((r.host.querySelector('[data-skill-note="stealth"]')?.textContent ?? '').trim()).toBe('Held at Trained by a tweak ("exactly") — an increase would change nothing.');
    const stealth = rowNamed(await increaseRows(r), 'Stealth');
    expect(stealth!.disabled, 'never greyed under the player').toBe(false);
  });

  it('an increase a floor made useless is flagged', async () => {
    const r = openOn(fighter(5, FLOOR_THIEVERY(), { skillIncreases: { 3: 'thievery' } }), '3');
    expect((r.host.querySelector('[data-skill-note="thievery"]')?.textContent ?? '').trim()).toBe(
      'Thievery is already Expert here (Tweak: at least Expert) — this increase changes nothing. Pick another.',
    );
    // With no tweak, the same pick is a real step: no note.
    const plain = openOn(fighter(5, undefined, { skillIncreases: { 3: 'thievery' } }), '3');
    expect(plain.host.querySelector('[data-skill-note]')).toBeNull();
  });

  it('a floor from level 5 does not show while picking the level 3 increase (spec 9)', async () => {
    const at3 = await increaseRows(openOn(fighter(6, FLOOR_THIEVERY(5)), '3'));
    const t3 = rowNamed(at3, 'Thievery');
    expect((t3?.querySelector('.picker-name')?.textContent ?? '').trim()).toBe('Thievery (U → T)');
    expect(t3!.disabled).toBe(false);
    for (const n of [...document.body.children]) if (n.classList.contains('picker-overlay') || n.querySelector('.picker-overlay')) n.remove();
    while (cleanups.length) cleanups.pop()!();
    // At 5th the floor is there: the increase starts from Expert, and 5th caps at Expert.
    const at5 = await increaseRows(openOn(fighter(6, FLOOR_THIEVERY(5)), '5'));
    const t5 = rowNamed(at5, 'Thievery');
    expect((t5?.querySelector('.picker-name')?.textContent ?? '').trim()).toBe('Thievery (E → M)');
    expect(t5!.disabled).toBe(true);
  });
});

describe('skillTweakNotes (pure)', () => {
  const host = (ov?: BuildOverrides, level = 5) => ({ overrides: ov, options: { overridesEnabled: true }, level });
  it('names the floor only when a floor live at that level is the reason', () => {
    // The floor starts at 5th: at 3rd the skill is Expert for another reason, so no tweak is named.
    expect(skillTweakNotes(host(FLOOR_THIEVERY(5)), 3, 'thievery', 'expert', true).note).toBe('Thievery is already Expert here — this increase changes nothing. Pick another.');
    expect(skillTweakNotes(host(FLOOR_THIEVERY(5)), 5, 'thievery', 'expert', true).note).toBe(
      'Thievery is already Expert here (Tweak: at least Expert) — this increase changes nothing. Pick another.',
    );
    // A real step: nothing to say, and an option that is not the stored pick never gets the note.
    expect(skillTweakNotes(host(FLOOR_THIEVERY()), 7, 'thievery', 'expert', true)).toEqual({});
    expect(skillTweakNotes(host(FLOOR_THIEVERY()), 3, 'thievery', 'expert', false)).toEqual({});
  });
  it('a hold greys every option but the stored pick; a paused hold or Tweaks off greys nothing', () => {
    expect(skillTweakNotes(host(HELD_STEALTH), 3, 'stealth', 'trained')).toEqual({ disabled: true, reason: 'Held at Trained by a tweak ("exactly") — an increase would change nothing.' });
    expect(skillTweakNotes(host(HELD_STEALTH), 3, 'stealth', 'trained', true)).toEqual({ note: 'Held at Trained by a tweak ("exactly") — an increase would change nothing.' });
    const paused: BuildOverrides = { ...HELD_STEALTH, meta: { 'proficiencies:stealth': { of: 'trained', mode: 'exactly', on: false } } };
    expect(skillTweakNotes(host(paused), 3, 'stealth', 'trained')).toEqual({});
    expect(skillTweakNotes({ overrides: HELD_STEALTH, options: { overridesEnabled: false }, level: 5 }, 3, 'stealth', 'trained')).toEqual({});
  });
});
