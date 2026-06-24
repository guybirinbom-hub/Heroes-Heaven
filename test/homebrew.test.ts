import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadHomebrewSources,
  saveHomebrewSource,
  deleteHomebrewSource,
  loadHomebrewContent,
  saveHomebrewEntry,
  deleteHomebrewEntry,
} from '../src/data/storage';
import { SCHEMA_BY_TYPE, homebrewId } from '../src/sheet/homebrewSchemas';
import { sourceCatalog, enabledBookSet } from '../src/rules/sources';
import { applySources } from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

const feat = (id: string, sourceId: string) =>
  ({ id, name: id, homebrewSourceId: sourceId, level: 1, category: 'general', traits: [], rarity: 'common', description: '' }) as never;

describe('homebrew storage', () => {
  // The test env is 'node' (no DOM) — provide a minimal in-memory localStorage.
  beforeEach(() => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    } as Storage;
  });

  it('creates and lists sources', () => {
    saveHomebrewSource({ id: 's1', name: 'My Source' });
    expect(loadHomebrewSources().s1.name).toBe('My Source');
  });

  it('saves and loads entries across types', () => {
    saveHomebrewEntry('feats', feat('f1', 's1'));
    saveHomebrewEntry('spells', {
      id: 'sp1',
      name: 'Zap',
      homebrewSourceId: 's1',
      rank: 1,
      traditions: ['arcane'],
      cast: { type: 'actions', value: 2 },
      traits: [],
      rarity: 'common',
      description: '',
    } as never);
    const c = loadHomebrewContent();
    expect(c.feats.f1.name).toBe('f1');
    expect(c.spells.sp1.name).toBe('Zap');
  });

  it('deletes a single entry without touching others', () => {
    saveHomebrewEntry('feats', feat('f1', 's1'));
    saveHomebrewEntry('feats', feat('f2', 's1'));
    deleteHomebrewEntry('feats', 'f1');
    const c = loadHomebrewContent();
    expect(c.feats.f1).toBeUndefined();
    expect(c.feats.f2).toBeTruthy();
  });

  it('deleting a source cascades to ONLY its entries', () => {
    saveHomebrewSource({ id: 's1', name: 'S1' });
    saveHomebrewSource({ id: 's2', name: 'S2' });
    saveHomebrewEntry('feats', feat('f1', 's1'));
    saveHomebrewEntry('feats', feat('f2', 's2'));
    deleteHomebrewSource('s1');
    expect(loadHomebrewSources().s1).toBeUndefined();
    expect(loadHomebrewSources().s2).toBeTruthy();
    const c = loadHomebrewContent();
    expect(c.feats.f1).toBeUndefined();
    expect(c.feats.f2).toBeTruthy();
  });

  it('migrates the legacy homebrew-items key', () => {
    localStorage.setItem('wanderers-codex:homebrew-items:v1', JSON.stringify({ leg1: { id: 'leg1', name: 'Legacy Item' } }));
    expect(loadHomebrewContent().items.leg1.name).toBe('Legacy Item');
  });
});

describe('homebrew schemas build valid content objects', () => {
  it('feat: form → Feat with action cost, prereqs, and homebrew source tag', () => {
    const f = SCHEMA_BY_TYPE.feats.toEntry(
      { name: 'Slam', level: '3', category: 'class', actionCost: '2', traits: ['fire'], description: 'd', prerequisites: ['trained in Athletics'] },
      { id: 'hb-feats-slam', sourceId: 's1' },
    );
    expect(f.name).toBe('Slam');
    expect(f.level).toBe(3);
    expect(f.category).toBe('class');
    expect(f.actionCost).toEqual({ type: 'actions', value: 2 });
    expect(f.prerequisites).toEqual(['trained in Athletics']);
    expect(f.traits).toEqual(['fire']);
    expect(f.homebrewSourceId).toBe('s1');
    expect(f.source).toEqual({ license: 'homebrew' });
  });

  it('spell: form → Spell with traditions, cast, and defense', () => {
    const s = SCHEMA_BY_TYPE.spells.toEntry(
      { name: 'Zap', rank: '2', cast: '1', traditions: ['arcane', 'primal'], description: '', defense: 'reflex' },
      { id: 'x', sourceId: 's1' },
    );
    expect(s.rank).toBe(2);
    expect(s.traditions).toEqual(['arcane', 'primal']);
    expect(s.cast).toEqual({ type: 'actions', value: 1 });
    expect(s.defense).toBe('reflex');
  });

  it('ancestry: form → Ancestry with boosts, flaw, and languages', () => {
    const a = SCHEMA_BY_TYPE.ancestries.toEntry(
      { name: 'Stoneborn', hp: '10', size: 'medium', speed: '20', vision: 'darkvision', boosts: ['con', 'wis'], freeBoosts: '1', flaws: ['cha'], languages: ['common'], additional: '0', description: '' },
      { id: 'x', sourceId: 's1' },
    ) as { hp: number; abilityBoosts: unknown[]; abilityFlaws: string[]; languages: { granted: string[] } };
    expect(a.hp).toBe(10);
    expect(a.abilityBoosts).toHaveLength(3); // 2 fixed + 1 free
    expect(a.abilityFlaws).toEqual(['cha']);
    expect(a.languages.granted).toEqual(['common']);
  });

  it('toForm round-trips a feat for editing', () => {
    const built = SCHEMA_BY_TYPE.feats.toEntry({ name: 'X', level: '5', category: 'skill', actionCost: 'reaction', traits: [], description: 'd' }, { id: 'x', sourceId: 's1' });
    const form = SCHEMA_BY_TYPE.feats.toForm(built);
    expect(form.level).toBe('5');
    expect(form.category).toBe('skill');
    expect(form.actionCost).toBe('reaction');
  });

  it('homebrewId is slug-based and stable', () => {
    expect(homebrewId('feats', 'Power Strike')).toBe(homebrewId('feats', 'Power Strike'));
    expect(homebrewId('feats', 'Power Strike')).toMatch(/^hb-feats-power-strike-/);
  });
});

describe('homebrew integrates with the per-character Sources filter', () => {
  const f = (id: string, source: object) =>
    ({ id, name: id, source, traits: [], rarity: 'common', description: '', level: 1, category: 'general' }) as never;
  const content = {
    feats: {
      hbf: f('hbf', { license: 'homebrew', book: 'My Source' }),
      cf: f('cf', { book: 'Pathfinder Player Core' }),
    },
  } as unknown as ContentDatabase;

  it('sourceCatalog lists homebrew separately, not among the books', () => {
    const cat = sourceCatalog(content);
    expect(cat.homebrew).toEqual([{ name: 'My Source', count: 1 }]);
    expect(cat.allBooks).toContain('Pathfinder Player Core');
    expect(cat.allBooks).not.toContain('My Source');
  });

  it('homebrew is off by default (Core only) and on when its source is enabled', () => {
    const coreOnly = applySources(content, enabledBookSet(undefined), new Set());
    expect(coreOnly.feats.hbf).toBeUndefined();
    expect(coreOnly.feats.cf).toBeTruthy();
    const withHb = applySources(content, enabledBookSet(['Pathfinder Player Core', 'My Source']), new Set());
    expect(withHb.feats.hbf).toBeTruthy();
  });

  it('already-chosen homebrew survives even when its source is disabled', () => {
    const kept = applySources(content, enabledBookSet(undefined), new Set(['hbf']));
    expect(kept.feats.hbf).toBeTruthy();
  });
});
