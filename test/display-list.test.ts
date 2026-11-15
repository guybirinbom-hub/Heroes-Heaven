import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_RAIL_ORDER } from '../src/data/customization';
import { BOXES, PC_PAGES } from '../src/data/sheetBoxes';

/*
 * The display list (docs/redesign/display-list.json; plan.md, "Display list"). Guy, 2026-10-24: the redesign
 * ignores today's look, but everything the app shows today must appear somewhere in the new design. Each
 * item is one thing a screen shows today, with the new box, page, popup or screen it moves to (`home`).
 *
 * This fails when an item has no home (or a home nobody knows), when a listed item disappears without a
 * written reason, when a box, page or popup holds nothing, when a tracked screen file (.tsx in src/ or
 * tracker/src/) is named by no item, and when a rail card has no items.
 *
 * Adding a screen file? Add what it shows to docs/redesign/display-list.json (and its id to
 * test/fixtures/display-list-ids.txt), or give it a `noDisplay` reason if it draws nothing.
 */

interface Item {
  id: string;
  what: string;
  screen: string;
  source: string;
  when?: string;
  home: string;
  note?: string;
}

interface DisplayList {
  screens: Record<string, string>;
  popups: Record<string, string>;
  /** Small parts used inside many boxes and pages (the situational star, the rank letter …). */
  parts: Record<string, string>;
  noDisplay: Record<string, string>;
  /** Items taken off the list on purpose: id → why (the thing is gone from the app, or merged into another). */
  removed: Record<string, string>;
  items: Item[];
}

const root = join(__dirname, '..');
// DISPLAY_LIST_FILE points the test at a planted copy, to prove it fails on a bad item.
const list = JSON.parse(readFileSync(process.env.DISPLAY_LIST_FILE ?? join(root, 'docs/redesign/display-list.json'), 'utf8')) as DisplayList;
const items = list.items;
const fileOf = (source: string) => source.replace(/:\d+(-\d+)?$/, '');

const HEADER = ['header:topBar', 'header:identity', 'header:tabStrip'];
const SCREENS = ['sheet', 'popup', ...Object.keys(list.screens)];
/** Where the old rail and Main tab drew their content: a box's own items come from these files. */
const BOX_SOURCES = ['src/sheet/VitalsRail.tsx', 'src/sheet/MainTab.tsx'];

/** Every home an item may name. */
function knownHomes(): Set<string> {
  return new Set([
    ...BOXES.map((b) => `box:${b.id}`),
    ...PC_PAGES.map((p) => `page:${p}`),
    ...HEADER,
    ...Object.keys(list.popups).map((p) => `popup:${p}`),
    ...Object.keys(list.parts).map((p) => `part:${p}`),
    ...Object.keys(list.screens).map((s) => `screen:${s}`),
    'phone',
  ]);
}

/**
 * The screen files git tracks (committed or staged). Untracked work in progress of another chat is left
 * alone until it is added; from then on it needs its items like every other file. quotePath off and -z, so a
 * name with non-ASCII letters is read as it is instead of quoted (and then silently skipped).
 */
function screenFiles(): string[] {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z', '--', 'src/*.tsx', 'tracker/src/*.tsx'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((f) => f && !/\.test\.tsx$/.test(f) && existsSync(join(root, f)));
}

describe('display list — every item has a new home', () => {
  it('items are well formed, with unique ids', () => {
    expect(items.length).toBeGreaterThan(300);
    const seen = new Set<string>();
    for (const it of items) {
      expect(it.id, JSON.stringify(it)).toMatch(/^[a-z][\w.&-]*$/i);
      expect(seen.has(it.id), `duplicate id ${it.id}`).toBe(false);
      seen.add(it.id);
      expect(it.what?.trim(), `${it.id} says nothing about what it shows`).toBeTruthy();
      expect(SCREENS, `${it.id}: unknown screen "${it.screen}"`).toContain(it.screen);
    }
  });

  it('every item has a home, and every home is a known box, page, popup, part or screen', () => {
    const homes = knownHomes();
    for (const it of items) {
      expect(it.home, `${it.id} has no new home`).toBeTruthy();
      expect(homes.has(it.home), `${it.id}: home "${it.home}" is not a box, page, popup, part or screen anyone knows`).toBe(true);
    }
  });

  it('only phone-only things are left on the phone layout', () => {
    for (const it of items.filter((i) => i.home === 'phone')) {
      // "phone only …" / "phone, …" — and never "phone, or <something the PC also shows>".
      const when = it.when ?? '';
      expect(when, `${it.id} is homed "phone" but its "when" does not start by saying it is phone-only`).toMatch(/^\s*(phone|mobile)/i);
      expect(when, `${it.id} is homed "phone" but its "when" also names a PC case`).not.toMatch(/\bor\b/i);
    }
  });

  it('a box item from outside the old rail or Main tab says how the box shows it', () => {
    // Boxes inherit "show only with content" and "hidden" from the old rail card. Something moved in from
    // another screen (Details, an item card) is not covered by that card's rule unless the note says so.
    for (const it of items.filter((i) => i.home.startsWith('box:'))) {
      if (BOX_SOURCES.includes(fileOf(it.source))) continue;
      expect(it.note?.trim(), `${it.id} moves into ${it.home} from ${fileOf(it.source)} without a note on how the box shows it`).toBeTruthy();
    }
  });

  it('every source file still exists', () => {
    for (const it of items) {
      const file = fileOf(it.source);
      expect(existsSync(join(root, file)), `${it.id}: source ${file} is gone`).toBe(true);
    }
  });
});

describe('display list — nothing listed is lost', () => {
  const frozen = readFileSync(join(root, 'test/fixtures/display-list-ids.txt'), 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = new Set(items.map((i) => i.id));

  it('no listed item disappears without a written reason', () => {
    for (const id of frozen) {
      if (ids.has(id)) continue;
      expect(list.removed?.[id]?.trim(), `item ${id} left the display list; put it back, or say why in "removed"`).toBeTruthy();
    }
  });

  it('every item is in the frozen id list, so it is guarded from now on', () => {
    const known = new Set(frozen);
    for (const id of ids) expect(known.has(id), `add ${id} to test/fixtures/display-list-ids.txt`).toBe(true);
    for (const id of Object.keys(list.removed ?? {})) expect(ids.has(id), `${id} is both listed and "removed"`).toBe(false);
  });
});

describe('display list — nothing in the new design is empty', () => {
  it('every box of src/data/sheetBoxes.ts holds at least one item', () => {
    for (const b of BOXES) {
      expect(items.some((it) => it.home === `box:${b.id}`), `box "${b.id}" holds nothing from the display list`).toBe(true);
    }
  });

  it('every page and every listed popup, part or screen holds at least one item', () => {
    for (const p of PC_PAGES) expect(items.some((it) => it.home === `page:${p}`), `page "${p}" is empty`).toBe(true);
    for (const p of Object.keys(list.popups)) expect(items.some((it) => it.home === `popup:${p}`), `popup "${p}" is empty`).toBe(true);
    for (const p of Object.keys(list.parts)) expect(items.some((it) => it.home === `part:${p}`), `part "${p}" is empty`).toBe(true);
    for (const s of Object.keys(list.screens)) {
      expect(items.some((it) => it.home === `screen:${s}` || it.screen === s), `screen "${s}" has no items`).toBe(true);
    }
  });
});

describe('display list — covers every screen of today’s app', () => {
  it('every tracked .tsx file in src/ and tracker/src/ is named by an item, or says why it shows nothing', () => {
    const cited = new Set(items.map((it) => fileOf(it.source)));
    const files = screenFiles();
    expect(files.length).toBeGreaterThan(100);
    for (const file of files) {
      const reason = list.noDisplay[file];
      expect(
        cited.has(file) || !!reason?.trim(),
        `${file} is in no item of docs/redesign/display-list.json: add what it shows (and the ids to test/fixtures/display-list-ids.txt), or a noDisplay reason`,
      ).toBe(true);
    }
    // A noDisplay entry for a file that is gone, or that items cite after all, is stale.
    for (const file of Object.keys(list.noDisplay)) {
      expect(existsSync(join(root, file)), `noDisplay names ${file}, which is gone`).toBe(true);
      expect(cited.has(file), `noDisplay names ${file}, but items cite it`).toBe(false);
    }
  });

  it('every rail card of today has its items listed', () => {
    for (const card of DEFAULT_RAIL_ORDER) {
      expect(items.some((it) => it.id.startsWith(`sheet.rail.${card}.`)), `rail card "${card}" has no items`).toBe(true);
    }
  });
});
