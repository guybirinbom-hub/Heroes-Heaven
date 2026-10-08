// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { content } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

/**
 * Card step 15, part 2 — F3b (docs/display-truth-plan.md F3b; docs/card-design.md section 9 row 15): once a
 * subclass is chosen, levelGrants (src/rules/build.ts) lists the subclass's own variant record
 * `${featureId}-${subclassId}` — the rule the Feats tab uses (FeatsTab.tsx variantId) — so the builder's
 * level-3 row for a cloistered cleric names its actual benefit, and its Details card (part 1, the 'mine'
 * card) shows it. With no subclass chosen it still lists the generic record.
 *
 * doctrine-4 (Cloistered Cleric, Player Core) prints the second doctrine as "Your proficiency rank for
 * Fortitude saves increases to expert."
 * Fixtures are synthesized through emptyBuild() (name 't'); none is the owner's.
 *
 * Mutation proofs (each run red, restored byte-exact, green):
 *  - build.ts levelGrants `variantOf` returning `featureId` always → every mapping case red (the
 *    no-subclass and archetype-added cases stay green, as they should).
 *  - the second class's rows `sub: subclassId2` → `sub: null`, and → `sub: subclassId` → the Dual Class case red.
 *  - the archetype-added rows `sub: null` → `sub: subclassId` → the archetype-added case red.
 */

const db: ContentDatabase = content();
const noop = () => undefined;
const FORTITUDE = 'Your proficiency rank for Fortitude saves increases to expert.';
const trees: Record<string, Record<string, AstNode>> = {};
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<ContentContext.Provider value={db}>{el}</ContentContext.Provider>); });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const txt = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (/ast-index\.json$/.test(u)) return { ok: true, json: async () => astIndex };
    const m = /ast\/(\w+)\.json$/.exec(u);
    const t = m ? treeOf(m[1]) : undefined;
    return t ? { ok: true, json: async () => t } : { ok: false };
  });
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = noop;
  await loadAstIndex();
  for (const b of ['feats', 'classFeatures', 'actions', 'categoryPage']) await loadBucketAst(b);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('F3b: levelGrants lists the subclass variant', () => {
  it('a level-3 cloistered cleric lists second-doctrine-cloistered-cleric; no subclass lists the generic second-doctrine', () => {
    expect(levelGrants(3, 'cleric', db, 'cloistered-cleric').features.map((f) => f.id)).toEqual(['second-doctrine-cloistered-cleric']);
    expect(levelGrants(3, 'cleric', db, 'warpriest').features.map((f) => f.id)).toEqual(['second-doctrine-warpriest']);
    expect(levelGrants(3, 'cleric', db, null).features.map((f) => f.id)).toEqual(['second-doctrine']);
  });

  it('every class × subclass × level: a row lists the variant exactly when the variant record exists (the Feats tab\'s rule)', () => {
    let variants = 0;
    for (const cls of Object.values(db.classes)) {
      for (const opt of cls.subclass?.options ?? []) {
        for (let lvl = 1; lvl <= 20; lvl++) {
          const shown = levelGrants(lvl, cls.id, db, opt.id).features.map((f) => f.id);
          const suppressed = new Set(opt.suppressedFeatures ?? []);
          const want = cls.features
            .filter((f) => f.level === lvl && !suppressed.has(f.featureId))
            .map((f) => (db.classFeatures[`${f.featureId}-${opt.id}`] ? `${f.featureId}-${opt.id}` : f.featureId));
          expect(shown, `${cls.id}/${opt.id} level ${lvl}`).toEqual(want);
          variants += want.filter((id) => !cls.features.some((f) => f.featureId === id)).length;
        }
      }
    }
    // Measured: 28 variant records (cleric doctrines 12, alchemist 12, ranger 3, wizard 1).
    expect(variants).toBe(28);
  });

  it('Dual Class: the second class\'s rows map by the SECOND class\'s subclass, never the first\'s', () => {
    const dual = { dualClass: true };
    const ids = (cls: string, sub: string | null, cls2: string, sub2: string | null) =>
      levelGrants(3, cls, db, sub, dual, cls2, sub2).features.map((f) => f.id);
    // Fighter (no subclass) + cloistered cleric: the cleric's level-3 row is the cloistered variant.
    const fc = ids('fighter', null, 'cleric', 'cloistered-cleric');
    expect(fc).toContain('second-doctrine-cloistered-cleric');
    expect(fc).not.toContain('second-doctrine');
    // Each class's rows carry their own class's subclass: warpriest first, cloistered second.
    expect(ids('cleric', 'warpriest', 'cleric', 'cloistered-cleric')).toEqual(['second-doctrine-warpriest', 'second-doctrine-cloistered-cleric']);
    // No second subclass chosen: the second class's row is the generic record.
    expect(ids('fighter', null, 'cleric', null)).toContain('second-doctrine');
  });

  it('an archetype-ADDED row never maps to a subclass variant, even when one exists', () => {
    // No shipped archetype-added feature has a `${featureId}-${subclassId}` record (measured in lane scratch:
    // the 6 class archetypes with addFeatures — flexible spellcaster, wellspring mage, seneschal witch,
    // vindicator, warrior of legend, war mage — 0 hits), so this synthesizes one: a War Magic record for the
    // wizard's own school. The added row (archetype-331: "You gain the war magic class feature at 1st
    // level") stays War Magic itself.
    const synth: ContentDatabase = {
      ...db,
      classFeatures: {
        ...db.classFeatures,
        'war-magic-school-of-battle-magic': { ...db.classFeatures['war-magic'], id: 'war-magic-school-of-battle-magic', name: 'War Magic (synthetic variant)' },
      },
    };
    const b = {
      ...emptyBuild(), name: 't', level: 5, classId: 'wizard', subclassId: 'school-of-battle-magic', keyAbility: 'int',
      ancestryId: 'human', backgroundId: 'acolyte', featPicks: { '2:class:0': 'war-mage-dedication' },
    } as BuildState;
    const ids = levelGrants(1, 'wizard', synth, 'school-of-battle-magic', undefined, null, null, false, ['war-mage-dedication'], b).features.map((f) => f.id);
    expect(ids, 'the archetype adds War Magic at 1st').toContain('war-magic');
    expect(ids).not.toContain('war-magic-school-of-battle-magic');
  });
});

describe('F3b through the real Builder', () => {
  const cleric = (subclassId: string | null): BuildState =>
    ({ ...emptyBuild(), name: 't', level: 3, ancestryId: 'human', backgroundId: 'acolyte', classId: 'cleric', subclassId }) as BuildState;
  async function level3Row(initial: BuildState) {
    const m = await mount(<Builder content={db} initial={initial} onCancel={noop} onCreate={noop} />);
    await click([...m.host.querySelectorAll('button')].find((b) => txt(b) === '3'));
    const names = [...m.host.querySelectorAll('.lvl-gain-block .lvl-gain-name')].map(txt);
    return { m, names };
  }

  it('L3 cloistered cleric: the level-3 row is the doctrine\'s own record and its Details card has "Fortitude", no other doctrine', async () => {
    const { m, names } = await level3Row(cleric('cloistered-cleric'));
    try {
      const name = db.classFeatures['second-doctrine-cloistered-cleric'].name;
      expect(names).toContain(name);
      expect(names).not.toContain(db.classFeatures['second-doctrine'].name);
      const block = [...m.host.querySelectorAll('.lvl-gain-block')].find((b) => txt(b.querySelector('.lvl-gain-name')) === name);
      await click(block!.querySelector('.cc-det'));
      const overlays = m.host.querySelectorAll('.picker-overlay');
      const page = overlays[overlays.length - 1]?.querySelector('.ast-modal.card-mine .ast-body') ?? null;
      expect(page, 'the Details card draws the doctrine page').toBeTruthy();
      const shown = txt(page);
      expect(shown).toContain(FORTITUDE);
      for (const other of ['First Doctrine', 'Third Doctrine', 'Fourth Doctrine', 'Fifth Doctrine', 'Final Doctrine']) expect(shown).not.toContain(other);
    } finally { m.stop(); }
  });

  it('a level-3 cleric with no doctrine chosen still lists the generic Second Doctrine', async () => {
    const { m, names } = await level3Row(cleric(null));
    try {
      expect(names).toContain(db.classFeatures['second-doctrine'].name);
    } finally { m.stop(); }
  });
});
