// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP2: the Tweak mark (C28), the picker-row confirm's words (C21) and the zero-marks sweep.
 *   - `tweakMarkState`: Tweaks off → no mark (an import-stamped tweak ignores the master switch), the tweak's own
 *     switch off → paused, else live;
 *   - the mark: "Tweak" / "Tweak paused" + the book's warning; a tap opens the popover (the rule, the reason, "Show
 *     in Tweaks"); Escape and "Show in Tweaks" close it; the chip's tap never reaches the card around it;
 *   - `confirmTweakWords`: the three actions' titles, one rule and two (C22: two tweaks, one confirm);
 *   - the sweep (test/_p2-marks.tsx): ZERO marks on every snapshot character that names no pick.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { marksIn, namesAPick, sweepCharacters, sweepHeroes } from './_p2-marks';
import { TweakMark, tweakMarkState } from '../src/builder/tweaks/TweakMark';
import { confirmTweak, confirmTweakWords } from '../src/builder/tweaks/confirmTweak';
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

const ON = { overrides: { v: 2 } as BuildOverrides, options: { overridesEnabled: true } };
const OFF = { overrides: { v: 2, enabled: false } as BuildOverrides, options: { overridesEnabled: false } };

describe('tweakMarkState', () => {
  it('live, paused by its own switch, and no mark at all while Tweaks are off — unless an import stamped it', () => {
    expect(tweakMarkState(ON, { on: true })).toBe('live');
    expect(tweakMarkState(ON, { on: false })).toBe('paused');
    expect(tweakMarkState(ON, { on: true, broken: 'gone' })).toBe('paused');
    expect(tweakMarkState(OFF, { on: true })).toBe('off');
    expect(tweakMarkState(OFF, { on: false })).toBe('off');
    expect(tweakMarkState(OFF, { on: true, imported: true })).toBe('live');
  });
});

describe('the Tweak mark', () => {
  const mount = (props: Partial<Parameters<typeof TweakMark>[0]> = {}) => {
    let shown = 0;
    let cardClicks = 0;
    const r = renderDom(
      <div onClick={() => cardClicks++}>
        <TweakMark kind="choice.anyList" state="live" rule="Requires the Elf ancestry" reason="GM allowed it" onShow={() => shown++} {...props} />
      </div>,
    );
    return { r, shown: () => shown, cardClicks: () => cardClicks };
  };

  it('live: the chip reads "Tweak"; a tap opens the rule, the reason and "Show in Tweaks", and never taps the card', () => {
    const m = mount();
    try {
      const mark = m.r.host.querySelector<HTMLElement>('[data-tweak-mark="choice.anyList"]');
      expect(mark?.dataset.tweakState).toBe('live');
      expect(m.r.host.querySelector('.tw-mark-chip')?.textContent?.trim()).toBe('Tweak');
      expect(m.r.host.querySelector('.tw-mark-pop'), 'closed until tapped').toBeNull();
      m.r.click(m.r.host.querySelector('.tw-mark-chip'));
      const pop = m.r.host.querySelector('.tw-mark-pop');
      expect(pop?.querySelector('.tw-mark-rule')?.textContent).toBe('Requires the Elf ancestry');
      expect(pop?.querySelector('.tw-mark-reason')?.textContent).toBe('“GM allowed it”');
      expect(m.cardClicks(), 'the chip tap stops at the chip').toBe(0);
      m.r.click(pop!.querySelector('.tw-mark-show'));
      expect(m.shown()).toBe(1);
      expect(m.r.host.querySelector('.tw-mark-pop'), '"Show in Tweaks" closes it').toBeNull();
    } finally {
      m.r.stop();
    }
  });

  it('the popover heading: an added place says the book does not give it; a pick says it broke a book rule', () => {
    // Guy's taste answer (2026-10-24, "Normal card + chip"): the extra place's reason moved off the card into this popover.
    for (const [kind, head] of [
      ['choice.addPlace', 'A place the book doesn’t give'],
      ['choice.anyList', 'Taken past a book rule'],
    ] as const) {
      const m = mount({ kind });
      try {
        m.r.click(m.r.host.querySelector('.tw-mark-chip'));
        expect(m.r.host.querySelector('.tw-mark-pop-h')?.textContent, kind).toBe(head);
      } finally {
        m.r.stop();
      }
    }
  });

  it('Escape closes the popover; a second tap closes it too', () => {
    const m = mount();
    try {
      m.r.click(m.r.host.querySelector('.tw-mark-chip'));
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });
      expect(m.r.host.querySelector('.tw-mark-pop')).toBeNull();
      m.r.click(m.r.host.querySelector('.tw-mark-chip'));
      expect(m.r.host.querySelector('.tw-mark-pop')).not.toBeNull();
      m.r.click(m.r.host.querySelector('.tw-mark-chip'));
      expect(m.r.host.querySelector('.tw-mark-pop')).toBeNull();
    } finally {
      m.r.stop();
    }
  });

  it('paused: "Tweak paused" with the book\'s own warning beside it; off: nothing at all', () => {
    const p = mount({ state: 'paused', bookWarning: 'Not valid for this slot' });
    try {
      expect(p.r.host.querySelector('.tw-mark-chip')?.textContent?.trim()).toBe('Tweak paused');
      expect(p.r.host.querySelector('.tw-mark-book')?.textContent).toBe('Not valid for this slot');
    } finally {
      p.r.stop();
    }
    const o = mount({ state: 'off', bookWarning: 'Not valid for this slot' });
    try {
      expect(o.r.host.querySelector('[data-tweak-mark]')).toBeNull();
    } finally {
      o.r.stop();
    }
  });

  it('never wears the book\'s invalid look', () => {
    const m = mount();
    try {
      expect(m.r.host.querySelector('.lvl-invalid, [data-invalid]')).toBeNull();
    } finally {
      m.r.stop();
    }
  });
});

describe('confirmTweakWords (C21, C22)', () => {
  it('one rule: the picker\'s own "Take X anyway?" plus the device\'s undo hint', () => {
    const w = confirmTweakWords({ name: 'Ancient Elf', rules: 'Requires the Elf ancestry', undoHint: 'Undo with Ctrl+Z.' });
    expect(w.title).toBe('Take Ancient Elf anyway?');
    expect(w.confirmLabel).toBe('Take anyway');
    expect(w.rules).toEqual(['Requires the Elf ancestry']);
    expect(w.note).toBe('This records a tweak for this pick only; it is listed on the Tweaks page. Undo with Ctrl+Z.');
  });
  it('"Allow here" and "Take again"; two rules are two tweaks after ONE confirm', () => {
    expect(confirmTweakWords({ name: 'Stealth', rules: 'x', action: 'allow' }).title).toBe('Allow Stealth here?');
    expect(confirmTweakWords({ name: 'Toughness', rules: 'x', action: 'again' }).title).toBe('Take Toughness again?');
    const two = confirmTweakWords({ name: 'Sudden Leap', rules: ['A level 8 feat', 'Not a fighter feat'] });
    expect(two.rules).toEqual(['A level 8 feat', 'Not a fighter feat']);
    expect(two.note).toContain('This records 2 tweaks for this pick, one per rule; they are listed');
  });
  it('the dialog draws each rule on its own line, with the red button of the feat picker\'s own confirm', async () => {
    const p = confirmTweak({ name: 'Sudden Leap', rules: ['A level 8 feat', 'Not a fighter feat'] });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const box = document.querySelector('.confirm-modal')!;
    expect([...box.querySelectorAll('.tw-confirm-rules li')].map((l) => l.textContent)).toEqual(['A level 8 feat', 'Not a fighter feat']);
    const go = [...box.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Take anyway')!;
    expect(go.className).toContain('btn-danger');
    await act(async () => {
      [...box.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Cancel')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(await p).toBe(false);
  });
});

/* ---- the zero-marks sweep ---------------------------------------------------------------------------------- */

// The parity snapshot's own specs cannot load here: its script resolves its folder from `import.meta.url`, which is
// no file: URL under jsdom. The sweep's characters are made the same way instead (`sweepHeroes`): every class, at
// four levels, half of them holding the number / rank / given-feat / language tweaks a mark must never answer to.
const db = content();
type SweepFixture = { zero: { id: string; build: BuildState }[]; marked: { id: string; build: BuildState; off?: { id: string; build: BuildState } }[] };
const SWEEP = JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/p2-sweep-specs.json'), 'utf8')) as SweepFixture;

describe('the zero-marks sweep', () => {
  it('namesAPick: a Take anyway or a phase-2 choice block names a pick; a number tweak does not', () => {
    const b = (overrides: unknown) => ({ overrides }) as unknown as BuildState;
    expect(namesAPick(b({ allowedFeats: ['toughness'] }))).toBe(true);
    expect(namesAPick(b({ blocks: [{ kind: 'choice.moreTakes' }] }))).toBe(true);
    expect(namesAPick(b({ blocks: [{ kind: 'remove.choicePlace' }] }))).toBe(true);
    expect(namesAPick(b({ blocks: [{ kind: 'number.add' }] }))).toBe(false);
    expect(namesAPick(b(undefined))).toBe(false);
  });

  // tweaks p2 WP4 (the WP2 check finding): the sweep reads the parity snapshot's OWN specs, dumped by a node step
  // (scripts/p2-sweep-fixture.mjs → test/fixtures/p2-sweep-specs.json): every phase-2 case's no-tweak twin and the old
  // `overrides:` characters that name no pick, plus a positive control — the cases whose pick a mark names show one.
  it('ZERO Tweak marks on Setup and every level page of each parity character that names no pick', () => {
    const chars = SWEEP.zero;
    expect(chars.filter((s) => /^overrides:p2-/.test(s.id)).length, 'every phase-2 case twin').toBeGreaterThanOrEqual(40);
    // Every old `overrides:` character that names no pick (20 at this snapshot; the fixture samples 30 past that).
    expect(chars.filter((s) => !/^overrides:p2-/.test(s.id)).length, 'old overrides characters').toBeGreaterThanOrEqual(20);
    expect(chars.filter((s) => namesAPick(s.build)), 'none names a pick').toEqual([]);
    const seen: string[] = [];
    let pages = 0;
    for (const s of chars) {
      for (const p of marksIn(db, s.build)) {
        pages++;
        if (p.marks) seen.push(`${s.id} page ${p.page}: ${p.marks}`);
      }
    }
    expect(pages, 'every character opened on its pages').toBeGreaterThan(chars.length * 2);
    expect(seen).toEqual([]);
  }, 900_000);

  it('positive control: each parity case whose pick a tweak names shows a Tweak mark; with Tweaks off, none', () => {
    const missing: string[] = [];
    const offSeen: string[] = [];
    for (const s of SWEEP.marked) {
      if (!marksIn(db, s.build).some((p) => p.marks > 0)) missing.push(s.id);
      if (s.off) for (const p of marksIn(db, s.off.build)) if (p.marks) offSeen.push(`${s.off.id} page ${p.page}: ${p.marks}`);
    }
    expect(SWEEP.marked.length).toBeGreaterThanOrEqual(7);
    // WP4 finish, A6: the spell chip's mark is in the control (a wizard's Heal kept by a live allow).
    expect(SWEEP.marked.map((s) => s.id)).toContain('overrides:p2-spell-anyway:wizard-L3');
    expect(missing, 'a mark on every named pick (allowedFeats included: dedication-early)').toEqual([]);
    expect(offSeen).toEqual([]);
  }, 600_000);

  it('the generated heroes (every class) still show ZERO marks', () => {
    const chars = sweepCharacters(sweepHeroes(db)).filter((_, i) => i % 3 === 0);
    const seen: string[] = [];
    for (const s of chars) for (const p of marksIn(db, s.build)) if (p.marks) seen.push(`${s.id} page ${p.page}: ${p.marks}`);
    expect(seen).toEqual([]);
  }, 600_000);

  it('the sweep counts: a page that draws a mark is seen (the instrument itself)', () => {
    const r = renderDom(<TweakMark kind="choice.anyList" state="live" rule="x" />);
    try {
      expect(r.host.querySelectorAll('[data-tweak-mark]').length).toBe(1);
    } finally {
      r.stop();
    }
  });
});
