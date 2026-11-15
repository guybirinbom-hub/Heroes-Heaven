// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP6 step 1 (plan work/tweaks-phase2-notes/plan.md WP6): the Builder's feat slot cards drawn by
 * ONE shared component, behaviour-neutral — the level pages' slot cards and "Feat with no slot" rows of these
 * synthetic characters are byte-equal to the DOM the inline cards drew (test/fixtures/slot-card-dom.json, written
 * from the code before the change: `HH_WRITE_SLOT_CARD_DOM=1 node scripts/vt.mjs run test/slot-card-dom.test.tsx`).
 *
 * The characters cover every part of the card: empty and filled slots, Replace / Clear, the prerequisite triangle and
 * its note, "Not valid for this slot", the "Pick from any list" mark live and paused, a phase-1 Take anyway mark, the
 * TrustMarker line, a feat's own questions, a no-slot row with Move to slot, Dual Class + Free Archetype + Mythic
 * slots, and Tweaks switched off. A later change that MEANS to change the card re-writes the fixture with its reason.
 *
 * Re-written: WP6 step 2 (2026-10-24) — the card menu's "⋯" button on every card while Tweaks is on. Measured before
 * re-writing: stripping that one button from the new DOM gives the old fixture byte for byte (41 buttons, none on the
 * Tweaks-off character).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { hero } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import type { BuildState, BuildOverrides } from '../src/rules/types';

const db = content();
const FIXTURE = join(__dirname, 'fixtures', 'slot-card-dom.json');
const WRITE = process.env.HH_WRITE_SLOT_CARD_DOM === '1';
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const list = (id: string, record: string, rule: string, on = true) => ({ id, kind: 'choice.anyList', v: 1, record, rule, ...(on ? {} : { on: false }) });

const CHARS: Record<string, BuildState> = {
  'fighter-4-mixed': hero(db, 'fighter', 4, ov(), {
    featPicks: { '1:class:1': 'sudden-charge', '2:skill:1': 'quick-jump', '3:general:0': 'toughness', '2:class:5': 'power-attack' },
  }),
  'fighter-3-anylist-live': hero(db, 'fighter', 3, ov(list('t1_slotdom01', 'toughness', 'list')), { featPicks: { '2:class:0': 'toughness' } }),
  'fighter-3-anylist-paused': hero(db, 'fighter', 3, ov(list('t2_slotdom02', 'toughness', 'list', false)), { featPicks: { '2:class:0': 'toughness' } }),
  'fighter-3-tweaks-off': {
    ...hero(db, 'fighter', 3, ov(list('t3_slotdom03', 'toughness', 'list')), { featPicks: { '2:class:0': 'toughness' } }),
    options: { overridesEnabled: false },
  },
  'wizard-3-invalid': hero(db, 'wizard', 3, ov(), { featPicks: { '2:skill:1': 'quick-jump', '1:class:1': 'reach-spell' } }),
  'rogue-4-dual-fa-mythic': hero(db, 'rogue', 4, ov(), {
    variantRules: { dualClass: true, freeArchetype: true },
    classId2: 'fighter',
    subclassId2: null,
    mythicEnabled: true,
    featPicks: { '2:archetype:0': 'fighter-dedication', '1:ancestry:0': 'natural-ambition' },
  }),
  'champion-2-legacy-anyway': hero(db, 'champion', 2, { v: 2, allowedFeats: ['quick-jump'] } as unknown as BuildOverrides, { featPicks: { '2:skill:1': 'quick-jump' } }),
};

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

async function slotDom(initial: BuildState): Promise<Record<string, string[]>> {
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => undefined, onCreate: () => undefined }));
  stops.push(r.stop);
  const out: Record<string, string[]> = {};
  for (let lvl = 1; lvl <= initial.level; lvl++) {
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === String(lvl)) ?? null);
    await flush();
    out[lvl] = [...r.host.querySelectorAll<HTMLElement>('.lvl-slot-wrap, .lvl-noslot-row')].map((e) => e.outerHTML);
  }
  return out;
}

describe('the shared slot card draws exactly what the inline cards drew', () => {
  it('every fixture character, every level: the slot cards and no-slot rows byte-equal', async () => {
    const got: Record<string, Record<string, string[]>> = {};
    for (const [name, b] of Object.entries(CHARS)) got[name] = await slotDom(b);
    // The fixture is not trivial: slot cards were drawn, and the parts the card owns appear somewhere.
    const all = Object.values(got).flatMap((x) => Object.values(x).flat()).join('\n');
    for (const needle of ['lvl-card empty', 'lvl-replace-btn', 'lvl-clear-btn', 'data-unfit', 'data-invalid', 'data-noslot', 'data-tweak-mark="choice.anyList"', 'data-tweak-mark="choice.allowAnyway"'])
      expect(all, needle).toContain(needle);
    if (WRITE) {
      writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
      return;
    }
    const want = JSON.parse(readFileSync(FIXTURE, 'utf8')) as typeof got;
    for (const name of Object.keys(CHARS))
      for (const lvl of Object.keys(want[name] ?? {})) expect(got[name]?.[lvl], `${name} level ${lvl}`).toEqual(want[name]![lvl]);
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
  });
});
