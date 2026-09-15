// @vitest-environment jsdom
// tracker 2026-09-15: data
/*
 * The owner's data rulings of 2026-09-15, as tests:
 *
 *   1. a condition's description is the FULL Archives entry, in BOTH apps
 *   2. public/data/images.json and public/data/spells/ are gone, with no reader left behind
 *   3. the tracker paints after three small files, not after all thirteen
 *   4. an installed web app keeps /data/ (the bestiary) offline
 *
 * Rulings 1 and 3 are mutation-proved rather than merely asserted: a doctored copy of the description
 * file must make scripts/condition-text-check.mjs exit 1, and the load-order test would fail if the
 * thirteen loaders went back into one Promise.all (the first wave could not resolve before the heavy
 * ones, which is exactly what the middle assertion checks).
 */
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareForm } from '../scripts/lib/condition-prose.mjs';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/* One distinctive sentence per record, copied from the printed entry rather than derived, so this
 * test fails even if the mirror and the shipped data drift together. Each is the entry's LAST
 * sentence: every shortening this lane found cut from the end. */
const PRINTED: Record<string, { hh: string; tracker: string; sentence: string }> = {
  'off-guard': { hh: 'off-guard', tracker: 'Off-Guard', sentence: 'it applies to all of them, such as "the target is off-guard."' },
  frightened: { hh: 'frightened', tracker: 'Frightened', sentence: 'at the end of each of your turns, the value of your frightened condition decreases by 1.' },
  stupefied: { hh: 'stupefied', tracker: 'Stupefied', sentence: 'the spell is disrupted unless you succeed at a flat check with a dc equal to 5 + your stupefied value.' },
  drained: { hh: 'drained', tracker: 'Drained', sentence: "this increases your maximum hit points, but you don't immediately recover the lost hit points." },
};

describe('condition descriptions are the full printed Archives text', () => {
  const descs = JSON.parse(read('public/core-descriptions.json')).conditions as Record<string, { d?: string }>;
  const tracker = JSON.parse(read('public/data/conditions.json')).condition as Array<{ name: string; text?: string }>;

  for (const [id, { hh, tracker: name, sentence }] of Object.entries(PRINTED)) {
    it(`${id} — Heroes Heaven`, () => {
      expect(compareForm(descs[hh]?.d)).toContain(sentence);
    });
    it(`${id} — the tracker`, () => {
      // The remaster printing is last in the file and is the one loadConditions keeps (Map.set wins).
      const recs = tracker.filter((r) => r.name === name);
      expect(recs.length).toBeGreaterThan(0);
      expect(compareForm(recs[recs.length - 1].text)).toContain(sentence);
    });
  }

  it('persistent damage keeps the whole "Persistent Damage Rules" sidebar Foundry dropped', () => {
    // 596 characters shipped where the Archives print 3,433 — the sidebar was the missing 2,800.
    const hh = compareForm(descs['persistent-damage']?.d);
    expect(hh).toContain('assisted recovery');
    expect(hh).toContain('roll a dc 15 flat check to see if you recover'); // the lost @Check inline
    expect(hh.length).toBeGreaterThan(3000);
  });

  it('sickened is not empty', () => {
    expect(compareForm(descs.sickened?.d).length).toBeGreaterThan(400);
  });

  it('the guard exits 1 on a doctored copy with ONE shortened description', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cond-guard-'));
    const core = JSON.parse(read('public/core.json')).conditions;
    const corePath = join(dir, 'core.json');
    writeFileSync(corePath, JSON.stringify({ conditions: core }));

    const faithful = join(dir, 'descs.json');
    writeFileSync(faithful, JSON.stringify({ conditions: descs }));

    const doctored = join(dir, 'descs-doctored.json');
    const cut = JSON.parse(JSON.stringify(descs));
    cut.frightened.d = String(cut.frightened.d).slice(0, 120); // one record, truncated
    writeFileSync(doctored, JSON.stringify({ conditions: cut }));

    const run = (descsPath: string) =>
      spawnSync(process.execPath, ['--max-old-space-size=4096', 'scripts/condition-text-check.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, HH_CORE: corePath, HH_DESCS: descsPath, HH_TRACKER_CONDITIONS: join(ROOT, 'public/data/conditions.json') },
      });

    expect(run(faithful).status, 'the real data must pass').toBe(0);
    const bad = run(doctored);
    expect(bad.status, 'a shortened description must fail the build').toBe(1);
    expect(bad.stderr).toContain('frightened');
  }, 120_000);
});

describe('dead tracker data is gone', () => {
  it('public/data/images.json is deleted and nothing loads it', () => {
    expect(existsSync(join(ROOT, 'public/data/images.json'))).toBe(false);
    const store = read('tracker/src/data/dataStore.ts');
    expect(store).not.toMatch(/fetchJSON<[^>]*>\('images\.json'\)/);
    expect(store).not.toMatch(/export async function loadImages/);
    expect(store).not.toMatch(/\b_images\b/);
  });

  it('public/data/spells/ is deleted (it had no reader anywhere)', () => {
    expect(existsSync(join(ROOT, 'public/data/spells'))).toBe(false);
    // spells-index.json is a DIFFERENT file and is still read — it must survive.
    expect(existsSync(join(ROOT, 'public/data/spells-index.json'))).toBe(true);
  });

  it('the pre-archives backups no longer ship inside public/', () => {
    // 3.9 MB that `public/` copying would have shipped in the next installer. Moved to work/, where
    // .gitignore's `work/*.bak` also keeps them out of the repo.
    expect(existsSync(join(ROOT, 'public/data/hazards.json.pre-archives.bak'))).toBe(false);
    expect(existsSync(join(ROOT, 'public/data/index.json.pre-archives.bak'))).toBe(false);
    expect(existsSync(join(ROOT, 'work/hazards.json.pre-archives.bak'))).toBe(true);
    expect(existsSync(join(ROOT, 'work/index.json.pre-archives.bak'))).toBe(true);
  });
});

describe('the tracker paints before the heavy files land', () => {
  it('conditions, traits and the creature index resolve into their own setData', async () => {
    const heavy = { conditions: null as ((v: unknown) => void) | null };
    const gate = new Promise((res) => { heavy.conditions = res as (v: unknown) => void; });
    const later = <T,>(value: T) => gate.then(() => value);

    // Both tests in this file touch the dataStore module registry, so each one starts from a clean
    // slate rather than inheriting whichever ran first.
    vi.resetModules();
    vi.doMock('../tracker/src/data/dataStore', () => ({
      loadConditions: () => Promise.resolve(new Map([['frightened', 'eager']])),
      loadTraits: () => Promise.resolve(new Map([['auditory', 'eager']])),
      loadCreatureNameIndex: () => Promise.resolve(new Map([['goblin', 'eager']])),
      loadSpells: () => later(new Map()),
      loadRituals: () => later(new Map()),
      loadActions: () => later(new Map([['demoralize', 'heavy']])),
      loadActionTraits: () => later(new Map()),
      loadSkills: () => later(new Map()),
      loadAbilitiesGlossary: () => later(new Map()),
      loadEquipment: () => later(new Map()),
      loadFamilies: () => later(new Map()),
      loadCreatureLinks: () => later(new Map()),
      loadRules: () => later(new Map()),
    }));

    // react-dom BY PATH, not as the bare specifier. `tracker/` is a second npm project with its own
    // node_modules, and vitest.config.ts's dedupe cannot reach react-dom for the reason its own
    // comment gives: a bare `react-dom/client` is externalized to Node's resolver, which then hands it
    // the copy of React that Vite's dedupe did NOT pick — two dispatchers, and every hook throws
    // "Invalid hook call" from inside GameDataProvider. Importing it by path makes Vite inline it, so
    // its own `react` goes through the same dedupe the component's does.
    const { createElement, act } = await import('react');
    const { createRoot } = await import('../node_modules/react-dom/client.js');
    const { GameDataProvider, useGameData } = await import('../tracker/src/data/gameDataContext');

    const seen: Array<{ conditions: number; actions: number }> = [];
    const Probe = () => {
      const d = useGameData();
      seen.push({ conditions: d.conditions.size, actions: d.actions.size });
      return null;
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(createElement(GameDataProvider, null, createElement(Probe))); });

    // THE POINT: the first wave has already painted while the nine heavy loaders are still pending.
    // With all thirteen back in one Promise.all this is still {0, 0}.
    const afterFirstWave = seen[seen.length - 1];
    expect(afterFirstWave.conditions).toBe(1);
    expect(afterFirstWave.actions).toBe(0);

    await act(async () => { heavy.conditions?.(undefined); await gate; });
    const afterSecondWave = seen[seen.length - 1];
    expect(afterSecondWave.conditions).toBe(1);   // the first wave's data is not thrown away
    expect(afterSecondWave.actions).toBe(1);
    expect(seen.length).toBeGreaterThan(1);       // two setData calls, not one

    root.unmount();
    vi.doUnmock('../tracker/src/data/dataStore');
  });
});

describe('the bestiary pre-filter does not drop out-of-order words', () => {
  it('matches "rat giant" and still behaves like .includes for one word', async () => {
    // The load-order test above mocks dataStore wholesale; this one needs the REAL module.
    vi.doUnmock('../tracker/src/data/dataStore');
    vi.resetModules();
    vi.doMock('../tracker/src/utils/parseCreature', () => ({ parseCreature: () => ({}), parseHazard: () => ({}) }));
    const store = await import('../tracker/src/data/dataStore');
    const index = [
      { name: 'Giant Rat', level: 0, traits: [], source: 'Monster Core', file: 'mc.json' },
      { name: 'Goblin Warrior', level: -1, traits: [], source: 'Monster Core', file: 'mc.json' },
    ];
    // loadIndex fetches index.json; a stub fetch is enough for a pure filter test.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => index })) as unknown as typeof fetch;
    try {
      // The bug: two words in the creature's own order worked, the reverse order returned nothing.
      expect((await store.searchCreatures('rat giant')).map((e) => e.name)).toEqual(['Giant Rat']);
      expect((await store.searchCreatures('giant   rat')).map((e) => e.name)).toEqual(['Giant Rat']);
      // …and a single word is still a plain substring test, matching nothing new.
      expect((await store.searchCreatures('rat')).map((e) => e.name)).toEqual(['Giant Rat']);
      expect((await store.searchCreatures('gobl')).map((e) => e.name)).toEqual(['Goblin Warrior']);
      expect(await store.searchCreatures('kobold')).toEqual([]);
      expect((await store.searchCreatures('')).length).toBe(2);
    } finally {
      globalThis.fetch = realFetch;
      vi.doUnmock('../tracker/src/utils/parseCreature');
      vi.resetModules();
    }
  });
});

describe('an installed web app keeps the bestiary offline', () => {
  it('the service worker runtime-caches /data/', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toContain("url.pathname.startsWith('/data/')");
    expect(cfg).toContain("cacheName: 'heroes-heaven-tracker-data'");
    expect(cfg).toContain("handler: 'StaleWhileRevalidate'");
  });
});
