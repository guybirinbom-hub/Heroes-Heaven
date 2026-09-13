// @vitest-environment jsdom
// bug 2026-09-13: export menu clipped
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { RosterScreen } from '../src/sheet/RosterScreen';
import { exportNative, exportWg } from '../src/data/transfer';
import { downloadText } from '../src/sheet/download';
import type { SavedChar } from '../src/data/storage';

/**
 * "the export pop up is cut off." — owner, 2026-09-13 (with a screenshot).
 *
 * The roster card's export button opened a popup positioned INSIDE the card, and `.rcard` carries
 * `overflow: hidden` for its rounded corners — so the card ate the top choice and the popup's left
 * edge ran past it. A popup can never be safely parented to a box that clips; the fix moves the
 * choice into the app's own dialog, which mounts its own root on <body>.
 *
 * The legs: both choices reach the screen outside every clipping container, each one runs its own
 * export, and the ways OUT of a two-way choice (Escape, click-outside) export nothing at all.
 */
vi.mock('../src/data/transfer', async (orig) => ({
  ...(await orig<typeof import('../src/data/transfer')>()),
  exportWg: vi.fn(() => '{"wg":true}'),
  exportNative: vi.fn(() => '{"codex":true}'),
}));
vi.mock('../src/sheet/download', () => ({ downloadText: vi.fn() }));

/* Every selector in the REAL stylesheet whose block clips its children. jsdom has no CSS engine, so
 * "would this be clipped" can only be answered by reading the rules the app actually ships. */
const CLIPPERS: string[] = (() => {
  const css = readFileSync('src/sheet.css', 'utf8');
  const out: string[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/overflow(-[xy])?\s*:\s*hidden/.test(rule[2])) continue;
    for (const sel of rule[1].split(',')) {
      // Pseudo-classes/elements are state, not structure — drop them so `.x:hover` still tests `.x`.
      const s = sel.trim().replace(/::?[a-z-]+(\([^)]*\))?/g, '').trim();
      if (s && !s.startsWith('@') && !s.includes('%')) out.push(s);
    }
  }
  return out;
})();

function matchesSafely(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false; // a selector jsdom can't parse tells us nothing
  }
}

/** The nearest ancestor that would CLIP this element. The walk starts above the popup's own box
 *  (`.picker`), which clips only its own rounded corners and sizes itself to its content — the
 *  defect is a popup parented to a FOREIGN box that clips, which is what `.rcard` was. */
function clippingAncestor(el: Element): Element | null {
  const from = el.closest('.picker') ?? el;
  for (let p = from.parentElement; p && p !== document.body; p = p.parentElement) {
    if (CLIPPERS.some((s) => matchesSafely(p!, s))) return p;
  }
  return null;
}

const noop = () => undefined;

function openRoster(db: ReturnType<typeof content> | null = content()) {
  const roster: SavedChar[] = [{ id: 'r1', character: build('fighter', 1, { name: 'Kyra' }) }];
  const onArchive = vi.fn();
  return {
    onArchive,
    ...renderDom(
      createElement(RosterScreen, {
        roster,
        activeId: 'r1',
        content: db,
        onOpen: noop,
        onNew: noop,
        onImport: noop,
        onDuplicate: noop,
        onArchive,
        onDelete: noop,
      }),
    ),
  };
}

/** The dialog mounts (and later tears down) on a deferred timer — let one fire before looking. */
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));

/** App-wide: the choice must be findable wherever it renders, in-card popup or dialog alike. */
const choice = (needle: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').includes(needle)) ?? null;

const wgChoice = () => choice("Wanderer's Guide");
const nativeChoice = () => choice('Heroes Heaven file');

async function pressExport(r: ReturnType<typeof openRoster>) {
  r.click(r.host.querySelector('.rcard-actions button[title="Export"]'));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the roster export choice is not clipped by the card', () => {
  it('offers both choices, outside every clipping container', async () => {
    const r = openRoster();
    await pressExport(r);

    for (const [what, btn] of [
      ["Wanderer's Guide", wgChoice()],
      ['Heroes Heaven file', nativeChoice()],
    ] as const) {
      expect(btn, `the "${what}" choice never reached the screen`).toBeTruthy();
      const clipper = clippingAncestor(btn!);
      expect(
        clipper?.className ?? null,
        `the "${what}" choice renders inside a container that clips its overflow — it will be cut off`,
      ).toBeNull();
      // Keyboard users reach a choice only if it is a real, enabled control.
      expect(btn!.tagName, `"${what}" is not a focusable control`).toBe('BUTTON');
      expect(btn!.disabled, `"${what}" is unreachable`).toBe(false);
    }

    r.click(nativeChoice());
    await flush();
    r.stop();
  });

  it('Wanderer’s Guide exports the WG file and closes', async () => {
    const r = openRoster();
    await pressExport(r);
    r.click(wgChoice());
    await flush();

    expect(vi.mocked(exportWg)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportNative)).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText).mock.calls[0][0]).toBe('kyra.wg.json');
    expect(wgChoice(), 'the choice stayed open after choosing').toBeNull();
    r.stop();
  });

  it('Heroes Heaven file exports the .codex file and closes', async () => {
    const r = openRoster();
    await pressExport(r);
    r.click(nativeChoice());
    await flush();

    expect(vi.mocked(exportNative)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportWg)).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText).mock.calls[0][0]).toBe('kyra.codex.json');
    expect(nativeChoice(), 'the choice stayed open after choosing').toBeNull();
    r.stop();
  });

  it('Escape closes it and exports nothing', async () => {
    const r = openRoster();
    await pressExport(r);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((res) => setTimeout(res, 0));
    });

    expect(wgChoice(), 'Escape left the choice open').toBeNull();
    expect(nativeChoice()).toBeNull();
    expect(vi.mocked(exportWg)).not.toHaveBeenCalled();
    expect(vi.mocked(exportNative)).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText)).not.toHaveBeenCalled();
    r.stop();
  });

  it('the X closes it and exports nothing', async () => {
    const r = openRoster();
    await pressExport(r);
    const x = document.querySelector('.confirm-modal .picker-close');
    expect(x, 'the choice has no X to close it with').toBeTruthy();
    r.click(x);
    await flush();

    expect(wgChoice(), 'the X left the choice open').toBeNull();
    expect(vi.mocked(exportWg)).not.toHaveBeenCalled();
    expect(vi.mocked(exportNative)).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText)).not.toHaveBeenCalled();
    r.stop();
  });

  it('offers NO Wanderer’s Guide choice while the content database is still loading', async () => {
    // A WG export resolves against the database, so before it arrives there is no such export — not
    // a greyed one. MUTATION PROOF: offer the button always (the old inline menu rendered a
    // `disabled` one) and the next line finds a control the player can see and cannot use.
    const r = openRoster(null);
    await pressExport(r);
    expect(wgChoice(), 'a dead Wanderer’s Guide button was offered with nothing to resolve it against').toBeNull();
    const native = nativeChoice()!;
    expect(native).toBeTruthy();
    expect(native.disabled).toBe(false);
    r.click(native);
    await flush();
    expect(vi.mocked(exportNative)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportWg)).not.toHaveBeenCalled();
    r.stop();
  });

  it('the archive-first choice, which already used this dialog, still answers', async () => {
    // The same dialog now takes a ReactNode label. Its existing plain-string callers must be
    // untouched — MUTATION PROOF for keying the buttons off the label rather than the value.
    const r = openRoster();
    r.click(r.host.querySelector('.rcard-actions button[title="Delete"]'));
    await flush();
    const archiveNow = choice('Archive now');
    expect(archiveNow, 'the archive-first choice never opened').toBeTruthy();
    r.click(archiveNow);
    await flush();
    expect(r.onArchive).toHaveBeenCalledWith('r1', true);
    r.stop();
  });

  it('clicking outside closes it and exports nothing', async () => {
    const r = openRoster();
    await pressExport(r);
    const outside = document.querySelector('.picker-overlay');
    expect(outside, 'nothing to click outside of — the choice has no dismissable layer').toBeTruthy();
    r.click(outside);
    await flush();

    expect(wgChoice(), 'clicking outside left the choice open').toBeNull();
    expect(nativeChoice()).toBeNull();
    expect(vi.mocked(exportWg)).not.toHaveBeenCalled();
    expect(vi.mocked(exportNative)).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText)).not.toHaveBeenCalled();
    r.stop();
  });
});
