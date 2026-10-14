// @vitest-environment jsdom
import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder, overrideUndoHint, withArticle } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

/**
 * The builder's shell on a phone (owner's phone list, 2026-10-14; audit findings named per test).
 * Each test was run once against the code before the fix and failed there (noted per block), then
 * passed after it.
 */

const PHONE = '(max-width: 720px)';
let realMatchMedia: typeof window.matchMedia | undefined;
function stubViewport(phone: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: phone && q === PHONE,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  realMatchMedia = window.matchMedia;
  stubViewport(true);
});
afterEach(async () => {
  for (let i = 0; i < 3 && document.querySelector('.confirm-modal'); i++) {
    const first = document.querySelector('.confirm-modal .confirm-actions button');
    await act(async () => {
      first?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }
  while (cleanups.length) cleanups.pop()!();
  await settle();
  for (const n of [...document.body.children]) n.remove();
  if (realMatchMedia) window.matchMedia = realMatchMedia;
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}
async function back() {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await settle();
}
async function escape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
}
const confirmBox = () => document.querySelector('.confirm-modal');
const confirmTitle = () => confirmBox()?.querySelector('.picker-head')?.textContent?.trim() ?? null;
async function pressConfirm(label: string) {
  const b = [...(confirmBox()?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === label);
  if (!b) throw new Error(`no "${label}" button in the confirm`);
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

function open(initial?: BuildState) {
  const calls = { cancel: 0 };
  const rendered = renderDom(
    createElement(Builder, { content: content(), initial, onCancel: () => void (calls.cancel += 1), onCreate: () => undefined }),
  );
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    rendered.stop();
  };
  cleanups.push(stop);
  const { host, click } = rendered;
  const page = (label: string) => {
    const chip = [...host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === label);
    if (!chip) throw new Error(`no "${label}" page chip`);
    click(chip);
  };
  const level = () => host.querySelector('.lvl-ctl-val')?.textContent?.trim();
  return { host, click, stop, calls, page, level };
}

const FIGHTER = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 'Shell Fighter',
  level: 2,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
  ...over,
});

/*
 * A4 C3 D2 E2 — "Lower level?" ignored Back and Escape (a hand-built overlay, never on the dismiss
 * stack), and the swallowed Back made the next one leave the app. Before the fix: Escape and Back
 * both left `.confirm-modal` up (this test failed at "Escape closes it").
 */
describe('"Lower level?" is the shared confirm: Back and Escape close it', () => {
  const build = () => FIGHTER({ featPicks: { '2:class:0': 'double-slice' } });

  it('same title, text and buttons as before', async () => {
    const b = open(build());
    b.click(b.host.querySelector('[aria-label="Lower level"]'));
    await settle();
    expect(confirmTitle()).toBe('Lower level?');
    expect(confirmBox()!.querySelector('.confirm-body')?.textContent).toContain('Lowering to level 1 stops applying them.');
    expect(confirmBox()!.querySelector('.confirm-body')?.textContent).toContain("They're kept and will reapply if you raise the level again.");
    const labels = [...confirmBox()!.querySelectorAll('.confirm-actions button')].map((x) => x.textContent?.trim());
    expect(labels).toEqual(['Cancel', 'Lower to level 1']);
    await pressConfirm('Lower to level 1');
    expect(b.level()).toBe('1');
  });

  it('Escape closes it and keeps the level', async () => {
    const b = open(build());
    b.click(b.host.querySelector('[aria-label="Lower level"]'));
    await settle();
    expect(confirmTitle()).toBe('Lower level?');
    await escape();
    expect(confirmBox(), 'Escape closes it').toBeNull();
    expect(b.level()).toBe('2');
  });

  it('phone Back closes it — and only it: the builder stays open', async () => {
    const b = open(build());
    b.click(b.host.querySelector('[aria-label="Lower level"]'));
    await settle();
    await back();
    expect(confirmBox(), 'Back closes it').toBeNull();
    expect(b.level()).toBe('2');
    expect(b.calls.cancel, 'the same Back must not leave the builder').toBe(0);
  });

  it('no hand-built overlay is left in Builder.tsx (every box goes through confirmDialog or a registered picker)', () => {
    const src = readFileSync('src/builder/Builder.tsx', 'utf8');
    expect(src.match(/className="picker-overlay/g) ?? []).toEqual([]);
    expect(src).not.toMatch(/confirmLowerTo/);
  });
});

/*
 * A5 C4 — a page change kept the old page's scroll offset. Before the fix scrollTop stayed 400.
 */
describe('a new builder page opens at its top', () => {
  it('chip tap resets .builder-body scrollTop', () => {
    const b = open(FIGHTER());
    const body = b.host.querySelector('.builder-body') as HTMLElement;
    Object.defineProperty(body, 'scrollTop', { value: 400, writable: true, configurable: true });
    b.page('1');
    expect(body.scrollTop).toBe(0);
    body.scrollTop = 250;
    b.page('2');
    expect(body.scrollTop).toBe(0);
  });

  it('the + stepper (which moves to the new page) resets it too', () => {
    const b = open(FIGHTER());
    const body = b.host.querySelector('.builder-body') as HTMLElement;
    Object.defineProperty(body, 'scrollTop', { value: 300, writable: true, configurable: true });
    b.click(b.host.querySelector('[aria-label="Raise level"]'));
    expect(b.level()).toBe('3');
    expect(body.scrollTop).toBe(0);
  });
});

/*
 * A6 C7 — the CHARACTER row opened only from its 32px chevron. Before the fix the word "Character"
 * sat outside the button (this test failed at "the word is inside the toggle").
 */
describe('the CHARACTER title row is the toggle on a phone', () => {
  it('phone: the word is inside the toggle, and a tap on it opens and closes the stats', () => {
    const b = open(FIGHTER());
    const toggle = b.host.querySelector('.brail-title .brail-toggle') as HTMLElement;
    expect(toggle).toBeTruthy();
    const label = toggle.querySelector('.brail-toggle-label');
    expect(label?.textContent, 'the word is inside the toggle').toBe('Character');
    // Nothing of the title row lives outside the button.
    expect(b.host.querySelector('.brail-title')!.textContent?.trim()).toBe(toggle.textContent?.trim());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    b.click(label);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    b.click(label);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('desktop keeps the plain heading', () => {
    stubViewport(false);
    const b = open(FIGHTER());
    expect(b.host.querySelector('.brail-toggle')).toBeNull();
    expect(b.host.querySelector('.brail-title')!.textContent?.trim()).toBe('Character');
  });
});

/*
 * C5 E5 — "Prerequisites no longer met" lived only in a hover tooltip. Before the fix the page text
 * had no "no longer met" at all.
 */
describe('a picked feat whose prerequisites broke says why, in words', () => {
  it('Battle Medicine without Medicine: the slot prints the unmet prerequisite', () => {
    // Level 2's slots are [class, skill]: the index counts across the level, so the skill feat is 1.
    const b = open(FIGHTER({ featPicks: { '2:skill:1': 'battle-medicine' } }));
    b.page('2');
    const note = b.host.querySelector('[data-invalid="2:skill:1"]');
    expect(note, 'a visible note under the slot').toBeTruthy();
    expect(note!.textContent).toMatch(/Prerequisites no longer met: .*Medicine/i);
    // The icon on the card keeps its tooltip for desktop.
    expect(b.host.querySelector('.lvl-invalid')?.getAttribute('title')).toMatch(/Medicine/);
  });
});

/*
 * C13 — Replace opened with no row marked. Before the fix the Double Slice row had no `chosen`.
 */
describe('Replace marks the feat that is in the slot now', () => {
  it('the current class feat is highlighted with a ✓ and reads "Chosen"', () => {
    const b = open(FIGHTER({ featPicks: { '2:class:0': 'double-slice' } }));
    b.page('2');
    const slot = [...b.host.querySelectorAll('.lvl-slot')].find((s) => s.querySelector('[data-ctl-title="Class feat"]'));
    b.click(slot!.querySelector('.lvl-replace-btn'));
    const rows = [...document.querySelectorAll('.pick-row')];
    // The name cell also holds the feat's action glyph, so match the name's start.
    const current = rows.find((r) => (r.querySelector('.picker-name')?.textContent ?? '').startsWith('Double Slice'));
    expect(current, 'Double Slice is in the list').toBeTruthy();
    expect(current!.classList.contains('chosen')).toBe(true);
    expect(current!.querySelector('.pick-add')?.textContent?.trim()).toBe('Chosen');
    expect(current!.querySelector('.pick-add .ti-check')).toBeTruthy();
    const others = rows.filter((r) => r !== current && r.classList.contains('chosen'));
    expect(others, 'only the current feat is marked').toEqual([]);
  });
});

/*
 * C14 E8 (wording half) — "Choose a archetype feat" / "Choose a ancestry feat".
 */
describe('picker titles use "an" before a vowel', () => {
  it('withArticle', () => {
    expect(withArticle('ancestry feat')).toBe('an ancestry feat');
    expect(withArticle('archetype feat')).toBe('an archetype feat');
    expect(withArticle('impulse feat')).toBe('an impulse feat');
    expect(withArticle('class feat')).toBe('a class feat');
    expect(withArticle('skill feat')).toBe('a skill feat');
  });

  it('the ancestry feat picker reads "Choose an ancestry feat"', () => {
    const b = open(FIGHTER({ level: 1 }));
    b.page('1');
    b.click(b.host.querySelector('[data-ctl-title="Ancestry feat"]'));
    expect(document.querySelector('.fsel-title')?.textContent?.trim()).toBe('Choose an ancestry feat');
  });
});

/*
 * C11 — the "Take anyway" box told a phone player "You can undo with Ctrl+Z". Undo buttons stay hidden
 * on phones (the owner's setting); only the wording changes there.
 */
describe('the override confirm names an undo the device really has', () => {
  it('overrideUndoHint', () => {
    expect(overrideUndoHint(false, true)).toBe('You can undo with Ctrl+Z.');
    expect(overrideUndoHint(false, false)).toBe('You can undo with Ctrl+Z.');
    expect(overrideUndoHint(true, false)).not.toMatch(/Ctrl/);
    expect(overrideUndoHint(true, false)).toMatch(/✕/);
    expect(overrideUndoHint(true, true)).toMatch(/Undo arrow/);
    expect(overrideUndoHint(true, true)).not.toMatch(/Ctrl/);
  });

  it('phone: "Take anyway" never says Ctrl+Z', async () => {
    const b = open(FIGHTER({ options: { ...(emptyBuild().options ?? {}), overridesEnabled: true } }));
    b.page('2');
    b.click(b.host.querySelector('[data-ctl-title="Skill feat"]'));
    const showInel = [...document.querySelectorAll('button')].find((x) => /^Show ineligible/.test((x.textContent ?? '').trim()));
    if (showInel) b.click(showInel);
    const take = [...document.querySelectorAll('.pick-add')].find((x) => /Take anyway/.test(x.textContent ?? ''));
    expect(take, 'a "Take anyway" row').toBeTruthy();
    await act(async () => {
      take!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
    expect(confirmTitle()).toMatch(/anyway\?$/);
    const text = confirmBox()!.querySelector('.confirm-body')?.textContent ?? '';
    expect(text).toContain('deliberate override');
    expect(text).not.toMatch(/Ctrl\+Z/);
  });
});

/*
 * D10 — the signature ★ and the full spellbook explained themselves only by hover tooltip.
 */
describe('spell rows say in words what the star is and why "+ add" is grey', () => {
  it('a sorcerer with spells: one line explains the ★', () => {
    const b = open({
      ...emptyBuild(),
      name: 'Shell Sorc',
      level: 3,
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      classId: 'sorcerer',
      subclassId: 'bloodline-draconic',
      keyAbility: 'cha',
      cantrips: ['electric-arc', 'shield', 'telekinetic-projectile'],
      spells: { 1: ['force-barrage', 'grease'], 2: ['mirror-image'] },
    });
    b.page('1');
    expect(b.host.querySelector('.spr-chip-sig'), 'the star is on screen').toBeTruthy();
    expect(b.host.querySelector('.spr-sig-hint')?.textContent).toMatch(/signature spell/i);
  });

  it('a wizard whose spellbook is full: the reason is printed, not only a tooltip', () => {
    const db = content();
    const rank1 = Object.values(db.spells)
      .filter((s) => s.rank === 1 && (s.traditions ?? []).includes('arcane') && !s.traits.includes('uncommon') && !s.traits.includes('rare'))
      .map((s) => s.id)
      .slice(0, 12);
    const b = open({
      ...emptyBuild(),
      name: 'Shell Wiz',
      level: 1,
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      classId: 'wizard',
      keyAbility: 'int',
      spells: { 1: rank1 },
    });
    b.page('1');
    const add = b.host.querySelector('.spr-add[data-ctl-title="Rank 1 spell"]') as HTMLButtonElement;
    expect(add?.disabled, 'the fixture fills the book').toBe(true);
    expect(b.host.querySelector('.spr-why')?.textContent).toMatch(/Your spellbook holds all \d+ spells it can at this level/);
  });
});
