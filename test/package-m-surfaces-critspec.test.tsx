// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import { ContentContext } from '../src/sheet/ContentContext';
import { MainTab } from '../src/sheet/MainTab';
import { StrikeDetailModal } from '../src/sheet/StrikeDetailModal';
import type { Character, ContentDatabase, InventoryItem } from '../src/rules/types';

/**
 * Package M round 2 (2026-10-16) (c): the designated critical specialization reaches the SHEET.
 *
 * class-feature-490, Inventor Weapon Expertise (Guns & Gears (Remastered) pg. 15, 5th level): "If you have a
 * weapon innovation, you gain access to the critical specialization effect with your innovation." The record
 * carries it as critSpecWeapons.designated = 'innovation' (the one weapon the player marked, InventoryItem
 * .designations), and derive.ts weaponMatches reads that mark off the CHARACTER — its third argument. The
 * Main tab's strike rows and the strike popup called strikeShowsCritSpec / critSpecConditionFor with two
 * arguments, so every designated grant (the inventor's weapon innovation, the thaumaturge's weapon implement,
 * Rod of Rule's bonded weapon) matched nothing on the sheet.
 *
 * REAL components (MainTab, StrikeDetailModal) on the GATED content; a synthesized inventor (name 't').
 *
 * MUTATION LINES (each measured red on 2026-10-16 under the heavy-job lock, the file restored byte-exact,
 * sha1 checked — scratch pm2-mutate.mjs):
 *  - MainTab.tsx `strikeShowsCritSpec(s, critSources, character)` → `(s, critSources)` → the Main tab case red,
 *    and the every-caller scan red.
 *  - StrikeDetailModal.tsx `…critSpecSources(character, content), character)` → without `character` → the
 *    popup case red, and the scan red.
 */

const db: ContentDatabase = content({ trustGate: true });
const noop = () => undefined;

const held = (instanceId: string, itemId: string, designations?: InventoryItem['designations']): InventoryItem => ({
  instanceId, itemId, quantity: 1, equipped: true, ...(designations ? { designations } : {}),
});
/** A synthesized weapon-innovation inventor holding a longsword (marked as the innovation) and a battle axe. */
function inventor(level: number, mark = true): Character {
  const ch = buildCharacter(
    { ...emptyBuild(), name: 't', level, classId: 'inventor', subclassId: 'weapon-innovation', ancestryId: Object.keys(db.ancestries)[0], backgroundId: Object.keys(db.backgrounds)[0], keyAbility: 'int' } as BuildState,
    db,
  );
  return { ...ch, inventory: [held('inno', 'longsword', mark ? ['innovation'] : undefined), held('other', 'battle-axe')] };
}

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>); });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The Main tab's strike row of a weapon, by its name. */
const strikeRow = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('.strike')].find((r) => txt(r.querySelector('.strike-name')) === name);

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The strike popup's card looks its weapon page up; no page in this test (no fetch): the no-page lane.
  (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterAll(() => { delete (globalThis as { fetch?: unknown }).fetch; });

describe('package M round 2 (c): the shipped grant', () => {
  // batch package-m premise: class-feature-490 "If you have a weapon innovation, you gain access to the critical specialization effect with your innovation."
  it('Inventor Weapon Expertise is a 5th-level inventor feature narrowed to the designated innovation', () => {
    expect(db.classFeatures['inventor-weapon-expertise']).toMatchObject({ critSpec: true, critSpecWeapons: { designated: 'innovation' } });
    expect(db.classes.inventor.features).toContainEqual({ level: 5, featureId: 'inventor-weapon-expertise' });
    expect(db.items.longsword.group).toBe('sword');
    expect(db.items['battle-axe'].group).toBe('axe');
  });
});

describe('package M round 2 (c): a weapon-innovation inventor\'s marked weapon shows its critical specialization on the sheet', () => {
  it('Main tab, 5th level: the marked longsword\'s row has the Crit line, the battle axe\'s does not', async () => {
    const ch = inventor(5);
    const m = await mount(<MainTab character={ch} content={db} onPlay={noop} />);
    try {
      const sword = strikeRow(m.host, 'Longsword');
      const axe = strikeRow(m.host, 'Battle Axe');
      expect(sword, 'the longsword strike row').toBeTruthy();
      expect(axe, 'the battle axe strike row').toBeTruthy();
      expect(sword!.querySelector('.strike-crit'), 'the innovation shows its critical specialization').toBeTruthy();
      expect(axe!.querySelector('.strike-crit'), 'another weapon does not').toBeNull();
    } finally { m.stop(); }
  });

  it('Main tab, 4th level (before the printed level) and 5th level with nothing marked: no Crit line anywhere', async () => {
    for (const ch of [inventor(4), inventor(5, false)]) {
      const m = await mount(<MainTab character={ch} content={db} onPlay={noop} />);
      try {
        expect(m.host.querySelectorAll('.strike').length).toBeGreaterThan(0);
        expect(m.host.querySelector('.strike-crit')).toBeNull();
      } finally { m.stop(); }
    }
  });

  it('the strike popup: the marked longsword shows its critical specialization, the battle axe does not', async () => {
    const ch = inventor(5);
    const strikes = deriveStrikes(ch, db);
    const sword = strikes.find((s) => s.instanceId === 'inno')!;
    const axe = strikes.find((s) => s.instanceId === 'other')!;
    expect(sword && axe).toBeTruthy();
    const a = await mount(<StrikeDetailModal strike={sword} character={ch} content={db} onClose={noop} />);
    try {
      expect(a.host.querySelector('.strike-detail-crit'), 'the innovation\'s popup').toBeTruthy();
    } finally { a.stop(); }
    const b = await mount(<StrikeDetailModal strike={axe} character={ch} content={db} onClose={noop} />);
    try {
      expect(b.host.querySelector('.strike-detail-crit'), 'another weapon\'s popup').toBeNull();
    } finally { b.stop(); }
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* The guard for "every caller": a call of either function with fewer than three arguments.           */
/* ------------------------------------------------------------------------------------------------ */

const NAMES = ['strikeShowsCritSpec', 'critSpecConditionFor'];

/** Each call of NAMES in `src` with fewer than three top-level arguments (declarations skipped). */
function critSpecCallsMissingCharacter(src: string, file: string): string[] {
  const out: string[] = [];
  for (const name of NAMES) {
    const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const before = src.slice(Math.max(0, m.index - 16), m.index);
      if (/function\s+$/.test(before)) continue;
      let depth = 0;
      let args = 1;
      let i = m.index + m[0].length;
      let empty = true;
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
          if (depth === 0) break;
          depth--;
        } else if (ch === ',' && depth === 0) args++;
        if (!/\s/.test(ch)) empty = false;
      }
      const n = empty ? 0 : args;
      if (n < 3) out.push(`${file}:${src.slice(0, m.index).split('\n').length} ${name}(…) with ${n} argument(s)`);
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe('package M round 2 (c): every caller passes the character', () => {
  it('the scan finds a two-argument call (planted, in memory) and passes a three-argument one', () => {
    expect(critSpecCallsMissingCharacter('x = strikeShowsCritSpec(s, critSources) && y;', 'planted.tsx')).toHaveLength(1);
    expect(critSpecCallsMissingCharacter('critSpecConditionFor(s, f(a, b))', 'planted.tsx')).toHaveLength(1);
    expect(critSpecCallsMissingCharacter('strikeShowsCritSpec(s, critSpecSources(c, db), c)', 'ok.tsx')).toHaveLength(0);
    expect(critSpecCallsMissingCharacter('export function strikeShowsCritSpec(strike: Strike, sources: CritSpecSource[], c?: Character)', 'decl.ts')).toHaveLength(0);
  });

  it('no call in src/ or tracker/src/ leaves the character out', () => {
    const files = [...sourceFiles('src'), ...sourceFiles('tracker/src')];
    const calls = files.flatMap((f) => {
      const s = readFileSync(f, 'utf8');
      return NAMES.some((n) => s.includes(n)) ? [f] : [];
    });
    expect(calls.length, 'the scan reaches the callers').toBeGreaterThanOrEqual(3);
    expect(files.flatMap((f) => critSpecCallsMissingCharacter(readFileSync(f, 'utf8'), f))).toEqual([]);
  });
});
