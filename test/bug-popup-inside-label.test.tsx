// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { CUSTOM_BACKGROUND_ID, emptyBuild, type BuildState } from '../src/rules/build';

/**
 * BUG 2026-10-14 (owner's phone video): in the deep (custom) background, the Boost 1 / Boost 2 /
 * Trained skill popups would not close when you tapped outside them — they shut and opened again.
 *
 * Cause: each of those pickers sat inside a `<label>`, and the popup is rendered in place, so it was
 * INSIDE the label too. A click on a label that does not land on a button or field is forwarded by the
 * browser to the label's first control — the picker's own trigger button — which re-opened the popup
 * the backdrop had just closed. Same for a tap on the popup's title. jsdom implements that label
 * forwarding, so this test sees exactly what the phone did.
 *
 * Guards: (1) every deep-background popup closes on a backdrop tap; (2) no builder choice control
 * sits inside a <label> anywhere on the level-0 page, so the next picker put in a label fails here.
 */
const noop = () => undefined;

afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

function deepBackgroundBuild(): BuildState {
  return {
    ...emptyBuild(),
    level: 1,
    options: { ...(emptyBuild().options ?? {}), deepBackground: true },
    backgroundId: CUSTOM_BACKGROUND_ID,
  } as BuildState;
}

function openLevel0() {
  const r = renderDom(createElement(Builder, { content: content(), initial: deepBackgroundBuild(), onCancel: noop, onCreate: noop }));
  const chip = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0');
  expect(chip, 'no "0" page chip').toBeTruthy();
  r.click(chip!);
  return r;
}

describe('a builder popup closes when you tap outside it', () => {
  for (const title of ['Boost 1', 'Boost 2', 'Trained skill']) {
    it(`deep background: ${title}`, () => {
      const r = openLevel0();
      const trigger = r.host.querySelector(`.custom-bg [data-ctl-title="${title}"]`);
      expect(trigger, `no ${title} control in the custom background form`).toBeTruthy();
      r.click(trigger);
      expect(document.querySelector('.picker-overlay'), 'the popup did not open').toBeTruthy();
      // A tap on the popup's own title must not close it (nor re-open/reset it).
      r.click(document.querySelector('.picker-overlay .picker-head'));
      expect(document.querySelector('.picker-overlay'), 'tapping the title closed the popup').toBeTruthy();
      // A tap on the dim backdrop closes it — and it must STAY closed.
      r.click(document.querySelector('.picker-overlay'));
      expect(document.querySelector('.picker-overlay'), 'the popup re-opened after a tap outside it').toBeNull();
      r.stop();
    });
  }
});

describe('no builder choice control sits inside a <label>', () => {
  it('level-0 page with the deep background open', () => {
    const r = openLevel0();
    const inLabel = [...r.host.querySelectorAll('label [data-ctl], label .popsel, label .picker-overlay')].map(
      (el) => el.getAttribute('data-ctl-title') ?? el.className,
    );
    expect(inLabel).toEqual([]);
    r.stop();
  });
});
