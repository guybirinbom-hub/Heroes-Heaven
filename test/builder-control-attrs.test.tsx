// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, levelGrants, type BuildState } from '../src/rules/build';

/**
 * THE `data-ctl` MARKERS THE EXPERIENCE HARNESS READS.
 *
 * Gate 9 (EXPERIENCE) observes the real builder in jsdom and lists every control through
 * `[data-ctl]` on the shared primitives (PopupSelect, SearchSelect, the free-text choice input, feat
 * slots, spell "+ add"). If a primitive loses its marker the harness goes blind and reports every
 * record as asking nothing — which reads exactly like "matches WG". So the markers are pinned here,
 * on a rendered page, against a feat whose picker is known to exist (Cleric Dedication's trained
 * skill — the same control test/daily-choices-not-in-builder.test.tsx uses as its positive control)
 * and against the slot buttons every level page has.
 */
const noop = () => undefined;

function classSlotKey(level: number, classId: string): string {
  const g = levelGrants(level, classId, content(), null, undefined, null, null, false, []);
  const i = g.featSlots.findIndex((s) => s === 'class');
  expect(i).toBeGreaterThanOrEqual(0);
  return `${level}:class:${i}`;
}

const buildWith = (level: number, slot: string, featId: string): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level,
  classId: 'fighter',
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  keyAbility: 'str',
  featPicks: { [slot]: featId },
});

function pageControls(b: BuildState, page: string) {
  const r = renderDom(<Builder content={content()} initial={b} onCancel={noop} onCreate={noop} />);
  const tab = [...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page);
  r.click(tab ?? null);
  const ctls = [...r.host.querySelectorAll<HTMLElement>('[data-ctl]')].map((el) => ({
    ctl: el.dataset.ctl,
    title: el.dataset.ctlTitle,
    options: el.dataset.ctlOptions,
    state: el.dataset.ctlState,
    subcard: el.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ?? null,
  }));
  r.stop();
  return ctls;
}

describe('builder controls carry data-ctl markers', () => {
  it("Cleric Dedication's trained-skill picker is a marked PopupSelect inside its SubCard", () => {
    const slot = classSlotKey(4, 'fighter');
    const ctls = pageControls(buildWith(4, slot, 'cleric-dedication'), '4');
    const skill = ctls.find((c) => c.ctl === 'popup' && c.title === 'Trained skill');
    expect(skill, JSON.stringify(ctls.map((c) => `${c.ctl}:${c.title}`))).toBeTruthy();
    expect(Number(skill!.options)).toBeGreaterThan(0);
    expect(skill!.state).toBe('empty');
    expect(skill!.subcard).toBe('Trained skill');
  });

  it('the feat slot on a level page is a marked slot control, picked or empty', () => {
    const slot = classSlotKey(4, 'fighter');
    const ctls = pageControls(buildWith(4, slot, 'cleric-dedication'), '4');
    const slots = ctls.filter((c) => c.ctl === 'slot');
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((c) => c.title === 'Class feat' && c.state === 'picked')).toBe(true);
  });

  it('the origin page (strip page "0") exposes Ancestry as a marked SearchSelect inside a labelled setup card', () => {
    // The strip reads Setup · 0 · 1 …: "Setup" is campaign options, "0" is where ancestry / heritage /
    // background / class live. The harness visits both; this pins that the markers reach page 0.
    const r = renderDom(<Builder content={content()} initial={buildWith(1, classSlotKey(1, 'fighter'), 'reactive-shield')} onCancel={noop} onCreate={noop} />);
    const tab = [...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '0');
    r.click(tab ?? null);
    const ancestry = r.host.querySelector<HTMLElement>('[data-ctl="search"][data-ctl-title="Ancestry"]');
    expect(ancestry).toBeTruthy();
    expect(ancestry!.dataset.ctlState).toBe('picked');
    expect(Number(ancestry!.dataset.ctlOptions)).toBeGreaterThan(10);
    expect(ancestry!.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard).toBe('Ancestry');
    r.stop();
  });
});
