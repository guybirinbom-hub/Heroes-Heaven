// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { CAMPAIGN_OPTION_TOGGLES, PopupSelect, SearchSelect, VARIANT_RULE_TOGGLES } from '../src/builder/shared';
import { ContentContext } from '../src/sheet/ContentContext';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { rankBySearch, searchMatches } from '../src/data/searchRank';
import { FilterableSelect, PickerRow } from '../src/sheet/FilterableSelect';

/**
 * Phone audit 2026-10-14 — the shared builder pickers (src/builder/shared.tsx). One guard per finding:
 *
 *  B2/C8/D7/E1  A choice popup with a search box (> 6 options) focused it on open, so the phone keyboard
 *               jumped up over the short list — every skill increase, Heritage skill, language, Arcane
 *               School, bloodline. Desktop keeps the focus; the custom-Lore field keeps it everywhere.
 *  B7           In the custom-Lore field, Escape / Android Back closed the whole popup and threw away the
 *               typed name. They step back to the list now, like the popup's own Back button.
 *  B3           Long lists stopped dead at 100 rows ("refine your search"). The 101st row is "Show all N".
 *  D3           A new cleric's Deity popup said only "No matches." — every deity is printed outside the
 *               Core books. The list (and the card) say books are off, with a one-tap way to Sources.
 *  E2/A-M1/D-M1 The "Change class?" box was drawn by hand and never joined the dismiss stack: Escape did
 *               nothing, Back was swallowed with the box still open, and the NEXT Back left the builder.
 *               It is the shared confirmDialog now. A static check keeps every popup in shared.tsx on the
 *               dismiss stack.
 *  B8           The Voluntary flaw and Key attribute popups were titled "Attribute boost", and a picked
 *               flaw looked exactly like a boost.
 *  D14          Free Archetype's (i) opened War of Immortals' mythic sidebar, not the Free Archetype rule.
 */

const noop = () => undefined;
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));

/** A viewport of `w` px for every media query the app asks (jsdom implements none). */
function setViewport(w: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = max ? w <= Number(max[1]) : min ? w >= Number(min[1]) : false;
    return { matches, media: query, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false };
  }) as typeof window.matchMedia;
}

beforeEach(() => setViewport(1280));
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

const escape = (target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
/** Android Back: the webview pops the dismiss trap's history entry. */
const back = () =>
  act(() => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
function typeInto(el: HTMLInputElement | null, text: string) {
  if (!el) throw new Error('no input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const overlay = () => document.querySelector('.picker-overlay');
const searchBox = () => document.querySelector<HTMLInputElement>('.picker-overlay input.name-input');
const skills = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `s${i}`, label: `Skill ${i}` }));

describe('B2/C8/D7/E1: a choice popup does not open the phone keyboard by itself', () => {
  for (const [w, focused] of [
    [360, false],
    [412, false],
    [1280, true],
  ] as const) {
    it(`${w}px: the search box is ${focused ? '' : 'NOT '}focused when the popup opens`, () => {
      setViewport(w);
      const r = renderDom(createElement(PopupSelect, { title: 'Skill increase', value: '', onChange: noop, options: skills(7) }));
      r.click(r.host.querySelector('[data-ctl-title="Skill increase"]'));
      expect(searchBox(), 'a 7-option popup has a search box').toBeTruthy();
      expect(document.activeElement === searchBox()).toBe(focused);
      r.stop();
    });
  }

  // Real-phone check (owner's Pixel 7 Pro, Chrome, 2026-10-14): the FULL-SCREEN feat / spell picker
  // focused its search on open too, and the keyboard covered all but 3½ feats of the list.
  for (const [w, focused] of [
    [412, false],
    [1280, true],
  ] as const) {
    it(`${w}px: the full-screen feat picker's search is ${focused ? '' : 'NOT '}focused when it opens`, () => {
      setViewport(w);
      const items = [{ id: 'a', name: 'Power Attack' }, { id: 'b', name: 'Sudden Charge' }];
      const r = renderDom(
        createElement(FilterableSelect<{ id: string; name: string }>, {
          title: 'Choose a class feat',
          items,
          spec: { fields: [{ id: 'q', label: 'Name', kind: 'text', accessor: (i) => i.name }] },
          rowKey: (i) => i.id,
          onClose: noop,
          renderRow: (i) => createElement(PickerRow, { name: i.name }),
        }),
      );
      const box = document.querySelector<HTMLInputElement>('.fsel-results-search input');
      expect(box, 'the picker has a search box').toBeTruthy();
      expect(document.activeElement === box).toBe(focused);
      r.stop();
    });
  }

  it('the custom-Lore field still takes focus on a phone (typing IS the task there)', () => {
    setViewport(360);
    const r = renderDom(
      createElement(PopupSelect, {
        title: 'Add a trained skill',
        value: '',
        onChange: noop,
        options: skills(7),
        addCustom: { label: '✎ Learn a new lore', placeholder: 'Lore subject', onAdd: noop },
      }),
    );
    r.click(r.host.querySelector('[data-ctl-title="Add a trained skill"]'));
    r.click([...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.includes('Learn a new lore')) ?? null);
    const field = document.querySelector<HTMLInputElement>('.popsel-custom input');
    expect(field).toBeTruthy();
    expect(document.activeElement).toBe(field);
    r.stop();
  });
});

describe('B7: Escape / Back in the custom-Lore field step back to the list', () => {
  for (const [name, press] of [
    ['Escape', () => escape(document.querySelector('.popsel-custom input') ?? window)],
    ['Android Back', back],
  ] as const) {
    it(`${name}: the popup stays open, the list comes back, and the typed name is kept`, () => {
      setViewport(412);
      const r = renderDom(
        createElement(PopupSelect, {
          title: 'Add a trained skill',
          value: '',
          onChange: noop,
          options: skills(7),
          addCustom: { label: '✎ Learn a new lore', placeholder: 'Lore subject', onAdd: noop },
        }),
      );
      r.click(r.host.querySelector('[data-ctl-title="Add a trained skill"]'));
      const lore = () => [...document.querySelectorAll('.picker-overlay .picker-item')].find((b) => b.textContent?.includes('Learn a new lore')) ?? null;
      r.click(lore());
      typeInto(document.querySelector<HTMLInputElement>('.popsel-custom input'), 'Sailing');
      press();
      expect(overlay(), `${name} closed the whole popup`).toBeTruthy();
      expect(document.querySelector('.popsel-custom'), `${name} did not leave the typing field`).toBeNull();
      expect(searchBox(), 'the list (with its search) is back').toBeTruthy();
      r.click(lore());
      expect(document.querySelector<HTMLInputElement>('.popsel-custom input')?.value).toBe('Sailing');
      // Back in the field again: one press returns to the list, the next closes the popup.
      press();
      expect(overlay()).toBeTruthy();
      press();
      expect(overlay()).toBeNull();
      r.stop();
    });
  }
});

describe('B3: a long list offers "Show all N" instead of stopping at 100', () => {
  it('150 options: 100 rows, then Show all 150, then every row in the same order', () => {
    const opts = Array.from({ length: 150 }, (_, i) => ({ id: `b${i}`, name: `Background ${String(150 - i).padStart(3, '0')}` }));
    const r = renderDom(createElement(SearchSelect, { label: 'Background', value: null, onChange: noop, options: opts }));
    r.click(r.host.querySelector('[data-ctl-title="Background"]'));
    const rows = () => [...document.querySelectorAll('.picker-overlay button.picker-item:not(.picker-show-all) .picker-name')].map((n) => n.textContent);
    expect(rows()).toHaveLength(100);
    expect(document.querySelector('.picker-overlay')?.textContent).not.toContain('refine your search');
    const more = document.querySelector('.picker-overlay .picker-show-all');
    expect(more?.textContent).toContain('Show all 150');
    r.click(more);
    expect(rows()).toEqual(opts.map((o) => o.name));
    expect(document.querySelector('.picker-overlay .picker-show-all')).toBeNull();
    r.stop();
  });

  // Round 2: "Show all" made every row reachable, but the lists that come straight from the content are
  // in BOOK order — the deep background's skill feats opened "Assurance (Religion), Student of the Canon,
  // Battle Medicine…", every-book Background "Acolyte, Lesser Scion, Lost and Alone…". `sortByName` lists
  // them A→Z while nothing is typed (pinned entries first); a typed search keeps its own ranking.
  const pickerRows = () => [...document.querySelectorAll('.picker-overlay .picker-name')].map((n) => n.textContent ?? '').filter((t) => !t.startsWith('Show all'));
  const az = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));

  it('sortByName: A→Z with nothing typed, the pinned entry first, search ranking untouched, Show all keeps A→Z', () => {
    // Given in reverse-ish order ("Feat Z130", "Feat Y129", …), so the caller's order is never A→Z.
    const names = Array.from({ length: 130 }, (_, i) => `Feat ${String.fromCharCode(90 - (i % 26))}${130 - i}`);
    const opts = [{ id: 'custom', name: '✎ Custom…', pin: true }, ...names.map((n, i) => ({ id: `f${i}`, name: n }))];
    const r = renderDom(createElement(SearchSelect, { label: 'Skill feat', value: null, onChange: noop, options: opts, sortByName: true }));
    r.click(r.host.querySelector('[data-ctl-title="Skill feat"]'));
    const first = pickerRows();
    expect(first[0], 'the pinned entry stays on top').toBe('✎ Custom…');
    expect(first.slice(1), 'the first 100 rows are the first 99 names A→Z after the pinned one').toEqual(az(names).slice(0, 99));
    r.click(document.querySelector('.picker-overlay .picker-show-all'));
    expect(pickerRows()).toEqual(['✎ Custom…', ...az(names)]);
    // A typed search is ranked exactly as before (rankBySearch over the caller's options).
    const q = 'feat a';
    typeInto(searchBox(), q);
    const ranked = rankBySearch(opts.filter((o) => searchMatches(q, o.name)), q, (o) => o.name).map((o) => o.name);
    expect(ranked.length).toBeGreaterThan(1);
    expect(pickerRows()).toEqual(ranked);
    r.stop();
  });

  it('without sortByName the caller’s order stands (spells by rank, formulas by level)', () => {
    const opts = [
      { id: 'b', name: 'Bless' },
      { id: 'a', name: 'Air Bubble' },
    ];
    const r = renderDom(createElement(SearchSelect, { label: 'Spell', value: null, onChange: noop, options: opts }));
    r.click(r.host.querySelector('[data-ctl-title="Spell"]'));
    expect(pickerRows()).toEqual(['Bless', 'Air Bubble']);
    r.stop();
  });

  it('the real builder: Background (custom entry first), Ancestry, Class and the deep background’s Skill feat open A→Z', () => {
    const db = content();
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      ancestryId: 'human',
      backgroundId: '__custom__',
      options: { ...(emptyBuild().options ?? {}), deepBackground: true },
    };
    const r = renderDom(createElement(ContentContext.Provider, { value: db }, createElement(Builder, { content: db, initial: b, onCancel: noop, onCreate: noop })));
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);

    /** Open a Setup card's picker (its Replace button when filled), list every row, close it again. */
    const allRows = (card: string) => {
      const box = r.host.querySelector(`[data-setupcard="${card}"]`);
      expect(box, `no ${card} card`).toBeTruthy();
      r.click(box!.querySelector('.ss-replace') ?? box!.querySelector(`[data-ctl-title="${card}"]`));
      expect(overlay(), `the ${card} picker did not open`).toBeTruthy();
      const more = document.querySelector('.picker-overlay .picker-show-all');
      if (more) r.click(more);
      const rows = pickerRows();
      escape();
      expect(overlay()).toBeNull();
      return rows;
    };
    const bg = allRows('Background');
    expect(bg[0]).toBe('✎ Custom background…');
    expect(bg.length).toBeGreaterThan(20);
    expect(bg.slice(1), 'Background is not in name order').toEqual(az(bg.slice(1)));
    for (const card of ['Ancestry', 'Class']) {
      const rows = allRows(card);
      expect(rows.length, card).toBeGreaterThan(5);
      expect(rows, `${card} is not in name order`).toEqual(az(rows));
    }

    const sf = r.host.querySelector('[data-ctl-title="Skill feat"]');
    expect(sf, 'no Skill feat control in the deep background').toBeTruthy();
    expect(Number(sf!.getAttribute('data-ctl-options'))).toBeGreaterThan(100);
    r.click(sf);
    r.click(document.querySelector('.picker-overlay .picker-show-all'));
    const feats = pickerRows();
    expect(feats.length).toBe(Number(sf!.getAttribute('data-ctl-options')));
    expect(feats, 'Skill feat is not in name order').toEqual(az(feats));
    r.stop();
  });
});

describe('D3: a list emptied by switched-off books says so, with a way to Sources', () => {
  it('SearchSelect: no "No matches." — the count, and a button that opens Sources', () => {
    const onOpenSources = vi.fn();
    const r = renderDom(
      createElement(SearchSelect, { label: 'Deity', value: null, onChange: noop, options: [], sourcesHidden: { names: ['Sarenrae', 'Desna', 'Abadar'], onOpenSources } }),
    );
    r.click(r.host.querySelector('[data-ctl-title="Deity"]'));
    const text = overlay()?.textContent ?? '';
    expect(text).not.toContain('No matches.');
    expect(text).toContain('3 more are in books this character has switched off');
    typeInto(searchBox(), 'sar');
    expect(overlay()?.textContent).toContain('1 more is in books this character has switched off');
    r.click(document.querySelector('.picker-overlay .picker-src-btn'));
    expect(onOpenSources).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('PopupSelect (Mythic Calling): the same note', () => {
    const r = renderDom(createElement(PopupSelect, { title: 'Mythic Calling', value: '', onChange: noop, options: [], sourcesHidden: { names: ['Acrobat', 'Archmage'], onOpenSources: noop } }));
    r.click(r.host.querySelector('[data-ctl-title="Mythic Calling"]'));
    expect(overlay()?.textContent).not.toContain('No matches.');
    expect(overlay()?.textContent).toContain('2 more are in books this character has switched off');
    r.stop();
  });

  it('a new Core-only cleric: the Deity card says why, and one tap reaches Sources and fills the list', async () => {
    const db = content();
    const cleric: BuildState = { ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', backgroundId: 'acolyte', classId: 'cleric' };
    const r = renderDom(
      createElement(ContentContext.Provider, { value: db }, createElement(Builder, { content: db, initial: cleric, onCancel: noop, onCreate: noop })),
    );
    r.click([...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0') ?? null);
    const card = () => r.host.querySelector('[data-setupcard="Deity"]');
    expect(card(), 'no Deity card for a cleric').toBeTruthy();
    expect(card()!.querySelector('[data-ctl-title="Deity"]')?.getAttribute('data-ctl-options')).toBe('0');
    expect(card()!.textContent).toContain('Every deity is printed in a book this character has switched off');
    r.click(card()!.querySelector('.picker-src-btn'));
    const popup = document.querySelector('[role="dialog"][aria-label="Sources"]');
    expect(popup, 'the button did not open Sources').toBeTruthy();
    expect(popup!.querySelector('[data-setupcard="Sources"]')).toBeTruthy();
    r.click([...popup!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Enable everything') ?? null);
    r.click([...popup!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Done') ?? null);
    await flush();
    expect(document.querySelector('[aria-label="Sources"]')).toBeNull();
    expect(Number(card()!.querySelector('[data-ctl-title="Deity"]')?.getAttribute('data-ctl-options'))).toBeGreaterThan(100);
    expect(card()!.textContent).not.toContain('Every deity is printed');
    r.stop();
  });
});

describe('E2 / A-M1 / D-M1: the "Change class?" box answers Escape and Android Back', () => {
  const WIZ: BuildState = { ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', backgroundId: 'acolyte', classId: 'wizard', classSkills: ['athletics'] };
  const className = (r: ReturnType<typeof renderDom>) => r.host.querySelector('[data-setupcard="Class"] .popsel-val')?.textContent;
  async function askForFighter(r: ReturnType<typeof renderDom>) {
    r.click(r.host.querySelector('[data-setupcard="Class"] .ss-replace'));
    const row = [...document.querySelectorAll('.picker-overlay .pick-row')].find((x) => x.querySelector('.picker-name')?.textContent === 'Fighter');
    r.click(row?.querySelector('.pick-add') ?? null);
    await flush();
    const box = document.querySelector('.confirm-modal');
    expect(box?.textContent, 'no "Change class?" box').toContain('Change class?');
    expect(box?.textContent).toContain('Switching to Fighter clears your class feats, class skills, and any chosen spells & cantrips');
  }

  it('Escape, then Back, each cancel it; Change class still changes the class', async () => {
    setViewport(412);
    const r = renderDom(createElement(Builder, { content: content(), initial: WIZ, onCancel: noop, onCreate: noop }));
    r.click([...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0') ?? null);
    expect(className(r)).toBe('Wizard');

    await askForFighter(r);
    await escape();
    await flush();
    expect(document.querySelector('.confirm-modal'), 'Escape left the box open').toBeNull();
    expect(className(r)).toBe('Wizard');

    await askForFighter(r);
    await back();
    await flush();
    expect(document.querySelector('.confirm-modal'), 'Android Back left the box open').toBeNull();
    expect(className(r)).toBe('Wizard');

    await askForFighter(r);
    r.click([...document.querySelectorAll('.confirm-modal button')].find((b) => b.textContent?.trim() === 'Change class') ?? null);
    await flush();
    expect(className(r)).toBe('Fighter');
    r.stop();
  });

  it('every component in shared.tsx that draws a popup puts it on the dismiss stack', () => {
    const src = readFileSync('src/builder/shared.tsx', 'utf8');
    const starts = [...src.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)];
    const offenders = starts
      .map((m, i) => ({ name: m[1], body: src.slice(m.index, starts[i + 1]?.index ?? src.length) }))
      .filter((f) => /className=(?:"|\{')picker-overlay/.test(f.body) && !/useEscapeClose\(|useBackHandler\(/.test(f.body))
      .map((f) => f.name);
    expect(offenders, 'a popup that Escape and Android Back cannot close').toEqual([]);
  });
});

describe('B8: the flaw and key-attribute popups say what they are', () => {
  it('Voluntary flaw: its own title, a down arrow, the flaw class; Key attribute: its own title', () => {
    const b: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      ancestryId: 'dwarf',
      backgroundId: 'acolyte',
      classId: 'fighter',
      options: { ...(emptyBuild().options ?? {}), voluntaryFlaw: true, voluntaryFlawAbility: 'cha' },
    };
    const r = renderDom(createElement(Builder, { content: content(), initial: b, onCancel: noop, onCreate: noop }));
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
    const flaw = r.host.querySelector('[data-subcard="Voluntary flaw"] .popsel');
    expect(flaw?.getAttribute('data-ctl-title')).toBe('Voluntary flaw');
    expect(flaw?.classList.contains('is-flaw')).toBe(true);
    expect(flaw?.querySelector('.ti-arrow-down')).toBeTruthy();
    expect(flaw?.querySelector('.ti-check'), 'a picked flaw drew the boost check').toBeNull();
    r.click(flaw);
    expect(document.querySelector('.picker-overlay .picker-head')?.textContent).toContain('Voluntary flaw');
    escape();

    const key = r.host.querySelector('[data-subcard="Key attribute"] .popsel');
    expect(key?.getAttribute('data-ctl-title')).toBe('Key attribute');
    r.click(key);
    expect(document.querySelector('.picker-overlay .picker-head')?.textContent).toContain('Key attribute');
    r.stop();
  });
});

describe('D14: every Setup (i) opens the rule it is about', () => {
  // The book each published rules page must come from. Free Archetype's slug without the suffix is
  // War of Immortals' sidebar on mixing it with mythic progression — the page the (i) used to open.
  const SOURCE: Record<string, string> = {
    'ancestry-paragon': 'Gamemastery Guide',
    'free-archetype-gm-core': 'GM Core',
    'gradual-ability-boosts': 'Gamemastery Guide',
    'proficiency-without-level': 'GM Core',
    'automatic-bonus-progression': 'GM Core',
    'dual-class-pcs': 'Gamemastery Guide',
    'pervasive-magic': 'Secrets of Magic',
    'mythic-rules': 'War of Immortals',
    'deviant-abilities': 'Dark Archive',
  };
  type Node = { t?: string; v?: string; c?: Node[] };
  const text = (n: Node | undefined): string => (n ? (n.v ?? '') + ' ' + (n.c ?? []).map(text).join(' ') : '');
  const firstTitle = (n: Node): string => {
    const q: Node[] = [n];
    while (q.length) {
      const x = q.shift()!;
      if (x.t === 'title') return text(x).replace(/\s+/g, ' ').trim();
      q.push(...(x.c ?? []));
    }
    return '';
  };
  const buckets = new Map<string, Record<string, Node>>();
  const page = (bucket: string, slug: string) => {
    if (!buckets.has(bucket)) buckets.set(bucket, JSON.parse(gunzipSync(readFileSync(`public/ast/${bucket}.json.gz`)).toString('utf8')));
    return buckets.get(bucket)![slug];
  };

  for (const [, label, , rule] of [...VARIANT_RULE_TOGGLES, ...CAMPAIGN_OPTION_TOGGLES]) {
    if (!rule) continue;
    it(`${label} → ${rule}`, () => {
      const [bucket, slug] = rule.split(':');
      const p = page(bucket, slug);
      expect(p, `${rule} is not in public/ast/${bucket}`).toBeTruthy();
      const first = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean)[0];
      expect(first(firstTitle(p)), `${rule}'s page is titled "${firstTitle(p)}"`).toBe(first(label));
      const source = /Source\s+(.+?)\s+pg\./.exec(text(p).replace(/\s+/g, ' '))?.[1] ?? '';
      expect(SOURCE[slug], `no expected book for ${slug} — add it above`).toBeTruthy();
      expect(source, `${rule} opens a page from ${source}`).toContain(SOURCE[slug]);
    });
  }
});
