// @vitest-environment jsdom
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { ActionDetailModal, MainTab } from '../src/sheet/MainTab';
import { ContentContext } from '../src/sheet/ContentContext';
import { PinContext, type PinDescApi } from '../src/sheet/PinContext';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import type { PlayState, PlayUpdater } from '../src/rules/play';
import type { BuildState } from '../src/rules/build';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Card step 2 (docs/card-design.md section 9, row 2): ActionDetailModal leaves MainTab.
 *
 * It was a closure declared INSIDE `export function MainTab`, reading character, content, onPlay,
 * the pinned set (through the closure Star), actionId and actionKey from the enclosing scope. It is
 * now a module-level export that takes every one of those as a prop (the two key functions became
 * module-level pure functions), so step 9 can put it on the card without reaching into MainTab.
 *
 * What this file proves, over seven synthesized characters (all built through build(), name 't';
 * none is the owner's) and EVERY action popup each one can open from the Main tab — the Actions
 * sub-tab's chips (tactics, runes, feat actions, basic, skill and item actions), the Pinned card's
 * full rows, and the Exploration and Downtime lists:
 *
 *  1. ALWAYS: the named cases are in the sample (Halfling Luck, Aid, High Jump with and without Quick
 *     Jump, Leap with Black Powder Boost, Shield Block, a tactic with its prepare toggle both enabled
 *     and disabled, a runesmith rune with its etch toggle, the resonant weapon's Conduct Energy).
 *  2. ALWAYS: the exported ActionDetailModal, rendered on its own with the props MainTab hands it,
 *     prints exactly the markup MainTab's popup prints — the props are the whole interface.
 *  3. ALWAYS: each threaded prop does its job on the bare component (character drives the marked
 *     cost, pinned drives the star, onPlay gates star and prepare toggle and receives the pin).
 *  4. WITH A SNAPSHOT (env CARD_ACTION_HOIST_SNAPSHOT=<json path>): every popup's markup is
 *     byte-equal to the same render on the pre-hoist tree. `CARD_ACTION_HOIST_WRITE=1` writes it
 *     instead (run that before the edit). The snapshot pins one tree on one data stamp, so it is
 *     scratch and never committed; without the variable the block skips and says so.
 *
 * Page trees: the activity popups render the Archives page through DescBody. jsdom cannot fetch
 * public/ast, so the tracked actions and feats buckets are served from public/ast/*.json.gz and the
 * caches warmed before any render, the state the app is in once the buckets have loaded.
 *
 * Measured 2026-10-02: snapshot written on HEAD 525af84 before any edit (693 popups: 2 Pinned rows,
 * 425 encounter chips, 203 exploration, 63 downtime), then compared after the hoist: 0 differences.
 *
 * MUTATION LINES (each measured red on 2026-10-02, then restored byte-exact):
 *  - MainTab render site: drop `onPlay={onPlay}` → blocks 1, 2 (both cases) and 4 red.
 *  - ActionDetailModal: `pinned={new Set()}` on the star → blocks 1, 3 (the pinned case) and 4 red.
 *  - ActionDetailModal: `const cost = a.cost` instead of the marked cost → blocks 1, 3 (the cost case) and 4 red.
 *  - MainTab's row Star: `pinned={new Set()}` → the row-star block red (round-1 refuter finding).
 *  - MainTab's row Star: drop `onPlay={onPlay}` → the row-star block red.
 *
 *  5. ALWAYS: the row stars. MainTab's inner Star now wraps the same PinToggle, and the popup
 *     snapshot never sees a row star, so the Pinned card's action and strike rows (ON), the Strikes
 *     section's unpinned strike (OFF), their clicks reaching onPlay, and no star without onPlay are
 *     asserted on their own.
 */
const SNAP = process.env.CARD_ACTION_HOIST_SNAPSHOT;
const WRITE = process.env.CARD_ACTION_HOIST_WRITE === '1';

const db: ContentDatabase = content();
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8')) as Record<string, AstNode>;
const BUCKETS = ['actions', 'feats'] as const;

beforeAll(async () => {
  const trees: Record<string, Record<string, AstNode>> = {};
  for (const b of BUCKETS) trees[b] = readGz(`public/ast/${b}.json.gz`);
  // The loader's raw-json fallback (the .gz fetch answers not-ok), as test/card-noop.test.tsx does.
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/(\w+)\.json$/.exec(String(url));
    return m && trees[m[1]] ? { ok: true, json: async () => trees[m[1]] } : { ok: false };
  });
  for (const b of BUCKETS) await loadBucketAst(b);
});

const pin: PinDescApi = { has: () => false, toggle: () => undefined };
let stops: (() => void)[] = [];
afterEach(() => {
  for (const s of stops) s();
  stops = [];
});
function mount(el: ReactElement) {
  const r = renderDom(
    <ContentContext.Provider value={db}>
      <PinContext.Provider value={pin}>{el}</PinContext.Provider>
    </ContentContext.Provider>,
  );
  stops.push(r.stop);
  return r;
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const glyphs = (el: Element | null | undefined) => [...(el?.querySelectorAll('.pf2-action') ?? [])].map((g) => g.getAttribute('aria-label'));
const noPlay: PlayUpdater = () => undefined;

/* ------------------------------------------------------------------ the synthesized characters */

const SWORD: InventoryItem[] = [{ instanceId: 'i-sword', itemId: 'longsword', quantity: 1, equipped: true }];
const halfling = (): Character => ({
  ...build('fighter', 2, { ancestryId: 'halfling', featPicks: { '1:ancestry': 'halfling-luck', '2:skill': 'quick-jump' } as never }),
  inventory: SWORD,
});
const tactics = Object.values(db.actions)
  .filter((a) => a.traits?.includes('tactic') && (a.tacticTier ?? 'basic') === 'basic')
  .map((a) => a.id)
  .sort()
  .slice(0, 5);
const commander = (): Character => {
  const c = build('commander', 2, { commanderTactics: tactics } as Partial<BuildState>);
  const max = c.commanderTactics?.preparedMax ?? 3;
  // Fill the prepared slots, so the folio holds prepared tactics AND unprepared ones whose toggle is disabled.
  return { ...c, commanderTactics: { ...c.commanderTactics!, prepared: c.commanderTactics!.folio.slice(0, max) } };
};
const runesmith = (): Character => {
  const picks = Object.values(db.runesmithRune ?? {})
    .filter((r) => (r.level ?? 1) <= 1)
    .map((r) => r.id)
    .sort()
    .slice(0, 4);
  const c = build('runesmith', 1, { runesmithRunes: picks } as Partial<BuildState>);
  return { ...c, runicRepertoire: { ...c.runicRepertoire!, etched: c.runicRepertoire!.known.slice(0, 1) } };
};

interface Scenario {
  id: string;
  character: () => Character;
  onPlay?: PlayUpdater;
}
const SCENARIOS: Scenario[] = [
  { id: 'halfling-pinned', character: () => ({ ...halfling(), pinned: ['action:Aid', 'action:Halfling Luck'] }), onPlay: noPlay },
  { id: 'halfling-noplay', character: halfling },
  { id: 'fighter-plain', character: () => ({ ...build('fighter', 2), inventory: SWORD }), onPlay: noPlay },
  { id: 'fighter-boosted', character: () => ({ ...build('fighter', 5), feats: [{ featId: 'black-powder-boost', level: 1, category: 'class' }] }), onPlay: noPlay },
  { id: 'commander', character: commander, onPlay: noPlay },
  { id: 'runesmith', character: runesmith, onPlay: noPlay },
  {
    id: 'wish-blade',
    character: () => ({ ...build('fighter', 2), inventory: [{ instanceId: 'i-wb', itemId: 'wish-blade', quantity: 1, equipped: true }] }),
    onPlay: noPlay,
  },
];

/** Every action popup this character can open from the Main tab, keyed `scenario|place|n|name`. */
function collect(s: Scenario): Record<string, string> {
  const c = s.character();
  const r = mount(<MainTab character={c} content={db} onPlay={s.onPlay} />);
  const out: Record<string, string> = {};
  const byText = (sel: string, t: string) => [...r.host.querySelectorAll(sel)].find((e) => txt(e) === t) ?? null;
  const open = (place: string, sel: string, nameOf: (el: Element) => string) => {
    const n = r.host.querySelectorAll(sel).length;
    for (let i = 0; i < n; i++) {
      const el = r.host.querySelectorAll(sel)[i];
      r.click(el);
      const overlay = r.host.querySelector('.picker-overlay');
      if (!overlay || !overlay.querySelector('.info-modal')) throw new Error(`${s.id} ${place} #${i}: no popup`);
      out[`${s.id}|${place}|${i}|${nameOf(el)}`] = overlay.outerHTML;
      r.click(overlay.querySelector('.picker-close'));
      if (r.host.querySelector('.picker-overlay')) throw new Error(`${s.id} ${place} #${i}: popup did not close`);
    }
  };
  r.click(byText('.stab', 'Actions'));
  // The row's name is the first text node of .action-name (the use counter and marks follow it).
  open('pinned', '.pinned-card .action.clickable', (el) => (el.querySelector('.action-name')?.firstChild?.textContent ?? '').trim());
  open('enc', '.actions .action-chip', (el) => txt(el.querySelector('.action-chip-name')));
  r.click(byText('.seg-btn', 'Exploration'));
  open('exp', '.actions .action-chip', (el) => txt(el.querySelector('.action-chip-name')));
  r.click(byText('.seg-btn', 'Downtime'));
  open('dt', '.actions .action-chip', (el) => txt(el.querySelector('.action-chip-name')));
  return out;
}

let popups: Record<string, string> = {};
const find = (scenario: string, place: string, name: string) => {
  const k = Object.keys(popups).find((x) => x.startsWith(`${scenario}|${place}|`) && x.endsWith(`|${name}`));
  if (!k) throw new Error(`no popup ${scenario} ${place} ${name}`);
  return popups[k];
};
const frag = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
};

describe('every Main-tab action popup, opened through MainTab', () => {
  beforeAll(() => {
    popups = Object.assign({}, ...SCENARIOS.map((s) => {
      const out = collect(s);
      for (const st of stops) st();
      stops = [];
      return out;
    }));
  }, 300_000);

  it('the sample holds every named case, and is not vacuous', () => {
    const keys = Object.keys(popups);
    expect(keys.length).toBeGreaterThan(200);
    for (const s of SCENARIOS) expect(keys.some((k) => k.startsWith(`${s.id}|enc|`)), s.id).toBe(true);
    // Halfling Luck, from its chip and from its Pinned row, with the star ON (it is pinned).
    for (const place of ['enc', 'pinned']) {
      const hl = frag(find('halfling-pinned', place, 'Halfling Luck'));
      expect(glyphs(hl.querySelector('.action-detail-cost'))).toEqual(['Free action']);
      expect(hl.querySelector('.picker-head .pin-star.on'), `${place}: pinned star`).not.toBeNull();
    }
    expect(frag(find('halfling-noplay', 'enc', 'Halfling Luck')).querySelector('.pin-star'), 'no onPlay, no star').toBeNull();
    expect(frag(find('halfling-pinned', 'enc', 'Aid')).querySelector('.action-detail-desc > .ast-body')).not.toBeNull();
    expect(glyphs(frag(find('halfling-pinned', 'enc', 'High Jump')).querySelector('.action-detail-cost'))).toEqual(['One action']);
    expect(glyphs(frag(find('fighter-plain', 'enc', 'High Jump')).querySelector('.action-detail-cost'))).toEqual(['Two actions']);
    expect(frag(find('fighter-boosted', 'enc', 'Leap')).querySelector('.ast-body')).not.toBeNull();
    expect(txt(frag(find('fighter-plain', 'enc', 'Shield Block')).querySelector('.info-title'))).toBe('Shield Block');
    // Tactics: prepared ones show an ON toggle, the rest a disabled one (all prepared slots are full).
    const tacticPops = tactics.map((id) => frag(find('commander', 'enc', db.actions[id]!.name)));
    const toggles = tacticPops.map((p) => p.querySelector('.picker-head .prep-toggle') as HTMLButtonElement | null);
    expect(toggles.every((t) => !!t)).toBe(true);
    expect(toggles.some((t) => t!.classList.contains('on'))).toBe(true);
    expect(toggles.some((t) => !t!.classList.contains('on') && t!.disabled)).toBe(true);
    // A rune: the etch toggle rides the same prepare slot, never disabled.
    const runePops = Object.keys(popups).filter((k) => k.startsWith('runesmith|enc|')).map((k) => frag(popups[k]));
    expect(runePops.filter((p) => p.querySelector('.prep-toggle.on')).length).toBe(1);
    expect(runePops.filter((p) => p.querySelector('.prep-toggle') && !p.querySelector('.prep-toggle.on')).length).toBe(3);
    // The resonant weapon's granted free action.
    expect(glyphs(frag(find('wish-blade', 'enc', 'Conduct Energy')).querySelector('.action-detail-cost'))).toEqual(['Free action']);
    expect(Object.keys(popups).some((k) => k.includes('|exp|')) && Object.keys(popups).some((k) => k.includes('|dt|'))).toBe(true);
  });

  it.skipIf(!SNAP)('byte-equal to the pre-hoist render (CARD_ACTION_HOIST_SNAPSHOT)', () => {
    if (WRITE) {
      writeFileSync(SNAP!, JSON.stringify(popups));
      return;
    }
    expect(existsSync(SNAP!), `snapshot ${SNAP} missing — write it on the pre-hoist tree with CARD_ACTION_HOIST_WRITE=1`).toBe(true);
    const before = JSON.parse(readFileSync(SNAP!, 'utf8')) as Record<string, string>;
    expect(Object.keys(popups)).toEqual(Object.keys(before));
    let diffs = 0;
    for (const k of Object.keys(before)) {
      if (popups[k] !== before[k]) diffs++;
      expect(popups[k], k).toBe(before[k]);
    }
    expect(diffs).toBe(0);
  });
});

/* ------------------------------------------- the row stars (Star now wraps the shared PinToggle) */

describe('the row stars on strike rows and full action rows', () => {
  // MainTab's inner Star became a one-line wrapper around the module-level PinToggle the popup also
  // uses. The popup snapshot above never sees a row star, so these rows are pinned here, ALWAYS.
  const rows = (c: Character, onPlay?: PlayUpdater) => {
    const r = mount(<MainTab character={c} content={db} onPlay={onPlay} />);
    // The sub-tab is remembered per device (localStorage); the collect() above leaves it on Actions.
    const strikesTab = [...r.host.querySelectorAll('.stab')].find((e) => txt(e) === 'Strikes');
    expect(strikesTab, 'Strikes sub-tab').toBeTruthy();
    r.click(strikesTab!);
    return r;
  };
  const rowName = (el: Element) => (el.querySelector('.action-name')?.firstChild?.textContent ?? '').trim();

  it('pinned actions and a pinned strike show an ON star; an unpinned strike an OFF one; clicks reach onPlay', () => {
    const calls: ((p: PlayState) => PlayState)[] = [];
    const record: PlayUpdater = (fn) => void calls.push(fn);
    const c = { ...halfling(), pinned: ['action:Aid', 'action:Halfling Luck'] };
    const r = rows(c, record);
    const pinnedRows = [...r.host.querySelectorAll('.pinned-card .action')];
    expect(pinnedRows.map(rowName).sort()).toEqual(['Aid', 'Halfling Luck']);
    for (const row of pinnedRows) {
      const star = row.querySelector('.pin-star');
      expect(star?.classList.contains('on'), rowName(row)).toBe(true);
      expect(star?.getAttribute('aria-label')).toBe('Unpin');
    }
    // The longsword's strike row (Strikes section; not pinned, so not in the Pinned card).
    expect(r.host.querySelectorAll('.pinned-card .strike')).toHaveLength(0);
    const strikeStars = [...r.host.querySelectorAll('.strike .pin-star')];
    expect(strikeStars.length).toBeGreaterThan(0);
    for (const s of strikeStars) {
      expect(s.classList.contains('on')).toBe(false);
      expect(s.getAttribute('aria-label')).toBe('Pin to top');
    }
    r.click(strikeStars[0]);
    expect(calls).toHaveLength(1);
    expect(calls[0]({ pinned: [] } as unknown as PlayState).pinned).toEqual(['strike:i-sword']);
    // Unpinning from a pinned action row hands onPlay the removal.
    r.click(pinnedRows.find((x) => rowName(x) === 'Aid')!.querySelector('.pin-star'));
    expect(calls).toHaveLength(2);
    expect(calls[1]({ pinned: ['action:Aid', 'action:Halfling Luck'] } as unknown as PlayState).pinned).toEqual(['action:Halfling Luck']);

    // A pinned strike: its Pinned-card row carries the ON star.
    const s = rows({ ...halfling(), pinned: ['strike:i-sword'] }, record);
    const pinnedStrike = s.host.querySelector('.pinned-card .strike .pin-star');
    expect(pinnedStrike?.classList.contains('on')).toBe(true);
    expect(pinnedStrike?.getAttribute('aria-label')).toBe('Unpin');
  });

  it('without onPlay no row carries a star', () => {
    const r = rows({ ...halfling(), pinned: ['action:Aid', 'strike:i-sword'] });
    expect(r.host.querySelectorAll('.pinned-card .action, .pinned-card .strike').length).toBeGreaterThan(0);
    expect(r.host.querySelectorAll('.strike').length).toBeGreaterThan(0);
    expect(r.host.querySelectorAll('.pin-star')).toHaveLength(0);
  });
});

/* -------------------------------------------------------- the exported component on its own */

describe('ActionDetailModal as a module-level component', () => {
  const featAct = (id: string) => {
    const f = db.feats[id]!;
    return { name: f.name, cost: f.actionCost, desc: f.description, descRefs: f.descRefs, traits: f.traits };
  };
  const actionAct = (id: string) => {
    const a = db.actions[id]!;
    return { id: a.id, name: a.name, cost: a.actionCost, desc: a.description, descRefs: a.descRefs, traits: a.traits };
  };

  it('with the props MainTab hands it, it prints exactly MainTab\'s popup (feat action, pinned)', () => {
    const c = { ...halfling(), pinned: ['action:Aid', 'action:Halfling Luck'] };
    const via = find('halfling-pinned', 'enc', 'Halfling Luck');
    const { host } = mount(
      <ActionDetailModal detail={{ a: featAct('halfling-luck'), pinnable: true }} onClose={() => undefined} character={c} content={db} onPlay={noPlay} pinned={new Set(c.pinned)} />,
    );
    expect(host.querySelector('.picker-overlay')!.outerHTML).toBe(via);
  });

  it('…and for a tactic, prepared and unprepared-but-full', () => {
    const c = commander();
    const max = c.commanderTactics!.preparedMax;
    for (const [i, id] of c.commanderTactics!.folio.entries()) {
      const prepared = c.commanderTactics!.prepared.includes(id);
      const { host, stop } = renderDom(
        <ContentContext.Provider value={db}>
          <PinContext.Provider value={pin}>
            <ActionDetailModal
              detail={{ a: actionAct(id), pinnable: true, prepare: { prepared, disabled: c.commanderTactics!.prepared.length >= max, onToggle: () => undefined } }}
              onClose={() => undefined}
              character={c}
              content={db}
              onPlay={noPlay}
              pinned={new Set(c.pinned ?? [])}
            />
          </PinContext.Provider>
        </ContentContext.Provider>,
      );
      expect(host.querySelector('.picker-overlay')!.outerHTML, `tactic #${i} ${id}`).toBe(find('commander', 'enc', db.actions[id]!.name));
      stop();
    }
  });

  it('character drives the marked cost: High Jump is one action with Quick Jump, two without', () => {
    const hj = { ...actionAct('high-jump'), skill: 'Athletics' };
    const one = mount(<ActionDetailModal detail={{ a: hj, pinnable: true }} onClose={() => undefined} character={halfling()} content={db} onPlay={noPlay} pinned={new Set()} />);
    expect(glyphs(one.host.querySelector('.action-detail-cost'))).toEqual(['One action']);
    const two = mount(<ActionDetailModal detail={{ a: hj, pinnable: true }} onClose={() => undefined} character={build('fighter', 2)} content={db} onPlay={noPlay} pinned={new Set()} />);
    expect(glyphs(two.host.querySelector('.action-detail-cost'))).toEqual(['Two actions']);
  });

  it('pinned drives the star, onPlay receives the pin, and without onPlay neither star nor prepare toggle renders', () => {
    const c = halfling();
    const a = featAct('halfling-luck');
    const calls: ((p: PlayState) => PlayState)[] = [];
    const record: PlayUpdater = (fn) => void calls.push(fn);
    const off = mount(<ActionDetailModal detail={{ a, pinnable: true }} onClose={() => undefined} character={c} content={db} onPlay={record} pinned={new Set()} />);
    const star = off.host.querySelector('.picker-head .pin-star') as HTMLElement;
    expect(star.classList.contains('on')).toBe(false);
    expect(star.getAttribute('aria-label')).toBe('Pin to top');
    off.click(star);
    expect(calls).toHaveLength(1);
    expect(calls[0]({ pinned: [] } as unknown as PlayState).pinned).toEqual(['action:Halfling Luck']);
    const on = mount(<ActionDetailModal detail={{ a, pinnable: true }} onClose={() => undefined} character={c} content={db} onPlay={record} pinned={new Set(['action:Halfling Luck'])} />);
    expect(on.host.querySelector('.picker-head .pin-star.on')?.getAttribute('aria-label')).toBe('Unpin');
    const unpinnable = mount(<ActionDetailModal detail={{ a, pinnable: false }} onClose={() => undefined} character={c} content={db} onPlay={record} pinned={new Set()} />);
    expect(unpinnable.host.querySelector('.pin-star')).toBeNull();
    const prepare = { prepared: false, disabled: false, onToggle: () => undefined };
    const bare = mount(<ActionDetailModal detail={{ a, pinnable: true, prepare }} onClose={() => undefined} character={c} content={db} pinned={new Set(['action:Halfling Luck'])} />);
    expect(bare.host.querySelector('.pin-star')).toBeNull();
    expect(bare.host.querySelector('.prep-toggle')).toBeNull();
  });

  it('the prepare toggle calls onToggle and then closes; the star does not close', () => {
    let toggled = 0;
    let closed = 0;
    const { host, click } = mount(
      <ActionDetailModal
        detail={{ a: actionAct(tactics[0]), pinnable: true, prepare: { prepared: false, disabled: false, onToggle: () => (toggled += 1) } }}
        onClose={() => (closed += 1)}
        character={commander()}
        content={db}
        onPlay={noPlay}
        pinned={new Set()}
      />,
    );
    click(host.querySelector('.pin-star'));
    expect(closed).toBe(0);
    click(host.querySelector('.prep-toggle'));
    expect([toggled, closed]).toEqual([1, 1]);
  });
});
