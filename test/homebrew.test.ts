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
import { applySources, buildCharacter, emptyBuild } from '../src/rules/build';
import { rebuildContent } from '../src/data';
import { domainPoolFor } from '../src/rules/derive';
import { mergeBundles } from '../src/data/cloudMerge';
import { content as fullContent } from './_content';
import type { ContentDatabase, Deity } from '../src/rules/types';

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

/* ---- Homebrew DEITIES ---------------------------------------------------------------------------
 * Owner, 2026-09-02: "i cant add a deity to home brew its a problem". `deities` was the one content
 * bucket the Homebrew manager had no schema for AND the one bucket mergeWithSeed left out of the
 * homebrew layer — so even a hand-written record would never have reached the builder. These pin both
 * halves: the record a homebrew deity produces is shaped like a printed one, and every engine reader
 * (font, deity skill, favored-weapon proficiency, Domain Initiate's pool, the cleric spell list)
 * treats it identically. */
describe('homebrew deities', () => {
  const DEITY_FORM = {
    name: 'Guyros',
    edicts: ['Share your fire'],
    anathema: ['Hoard warmth'],
    divineFont: ['heal'],
    skill: 'occultism',
    sanctification: 'holy',
    favoredWeapons: ['Scimitar'],
    domains: ['fire', 'sun'],
    alternateDomains: ['healing'],
    spells: ['Fireball', 'Wall of Fire'],
    traits: [],
    rarity: 'common',
    description: '<p>A homebrew god.</p>',
  };
  const makeDeity = (over: Record<string, string | string[]> = {}) =>
    SCHEMA_BY_TYPE.deities.toEntry({ ...DEITY_FORM, ...over }, { id: 'hb-deities-guyros', sourceId: 's1', content: fullContent() }) as unknown as Deity;

  it('is registered as an authorable homebrew type', () => {
    expect(SCHEMA_BY_TYPE.deities?.label).toBe('Deity');
    // The page pluralizes a label ending in "y" as "…ies", so the section reads "Deities".
    expect(SCHEMA_BY_TYPE.deities.label.slice(0, -1) + 'ies').toBe('Deities');
  });

  it('toEntry produces a record shaped like a printed deity, with NAMES resolved to ids', () => {
    const d = makeDeity();
    // Every field a real record carries, in the same shape (compared against Sarenrae).
    const real = fullContent().deities.sarenrae;
    for (const k of ['domains', 'alternateDomains', 'divineFont', 'favoredWeapons', 'spells'] as const) {
      expect(Array.isArray(d[k])).toBe(true);
      expect(typeof d[k]![0]).toBe(typeof real[k]![0]);
    }
    expect(d.favoredWeapons).toEqual(['scimitar']); // "Scimitar" → the item id
    expect(d.spells).toEqual(['fireball', 'wall-of-fire']); // spell NAMES → spell ids
    expect(d.skill).toBe('occultism');
    expect(d.divineFont).toEqual(['heal']);
    expect(d.edicts).toEqual(['Share your fire']);
    expect(d.anathema).toEqual(['Hoard warmth']);
    // The exact sanctification shape printed deities use, so buildCharacter's
    // `<deityId>:sanctification` answer and the builder's EffectChoicesPicker read it identically.
    expect(d.effectChoices).toEqual(real.effectChoices);
    expect(d.source).toEqual({ license: 'homebrew' });
  });

  it('sanctification modes map to the real option shapes (and "none" carries no choice at all)', () => {
    expect(makeDeity({ sanctification: '' }).effectChoices).toBeUndefined();
    expect(makeDeity({ sanctification: 'unholy' }).effectChoices![0].options!.map((o) => o.value)).toEqual(['unholy', 'none']);
    expect(makeDeity({ sanctification: 'either' }).effectChoices![0].options!.map((o) => o.value)).toEqual(['holy', 'unholy', 'none']);
  });

  it('an unmatched weapon/spell name is kept verbatim and the engine simply ignores it', () => {
    const d = makeDeity({ favoredWeapons: ['Nonexistent Blade'], spells: ['Nonexistent Spell'] });
    expect(d.favoredWeapons).toEqual(['Nonexistent Blade']);
    // Round-trips back into the editor unchanged, so the typo stays visible and fixable.
    expect(SCHEMA_BY_TYPE.deities.toForm(d as unknown as Record<string, unknown>, fullContent()).favoredWeapons).toEqual(['Nonexistent Blade']);
  });

  it('toForm(toEntry(form)) round-trips every field', () => {
    const back = SCHEMA_BY_TYPE.deities.toForm(makeDeity() as unknown as Record<string, unknown>, fullContent());
    for (const k of Object.keys(DEITY_FORM) as (keyof typeof DEITY_FORM)[]) expect(back[k]).toEqual(DEITY_FORM[k]);
  });

  it('saving one and rebuilding content puts it in content.deities, tagged with its source book', () => {
    saveHomebrewSource({ id: 's1', name: 'My Pantheon' });
    saveHomebrewEntry('deities', makeDeity());
    expect(loadHomebrewContent().deities['hb-deities-guyros'].name).toBe('Guyros');
    const db = rebuildContent();
    expect(db.deities['hb-deities-guyros']?.name).toBe('Guyros');
    // The per-character Sources filter governs it like every other homebrew record.
    expect(db.deities['hb-deities-guyros'].source).toEqual({ license: 'homebrew', book: 'My Pantheon' });
  });

  it('survives homebrew export → import (the generic file round-trip)', () => {
    saveHomebrewEntry('deities', makeDeity());
    const exported = JSON.parse(JSON.stringify({ sources: loadHomebrewSources(), content: loadHomebrewContent() }));
    localStorage.clear();
    for (const [type, entries] of Object.entries(exported.content) as [never, Record<string, never>][])
      for (const e of Object.values(entries)) saveHomebrewEntry(type, e);
    expect(loadHomebrewContent().deities['hb-deities-guyros'].spells).toEqual(['fireball', 'wall-of-fire']);
  });

  it('survives the cloud bundle merge', () => {
    const d = makeDeity();
    const empty = { roster: [], homebrew: loadHomebrewContent(), homebrewSources: {}, modes: {}, charUpdated: {} };
    const local = { ...empty, homebrew: { ...empty.homebrew, deities: { 'hb-deities-guyros': d } } };
    const merged = mergeBundles(local, empty);
    expect(merged.homebrew.deities['hb-deities-guyros'].name).toBe('Guyros');
  });

  it('a level-1 cleric of a homebrew deity gets its font, skill, favored weapon, domains and spells', () => {
    const d = makeDeity();
    const db = { ...fullContent(), deities: { ...fullContent().deities, [d.id]: d } } as ContentDatabase;
    const ch = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 1,
        classId: 'cleric',
        subclassId: 'cloistered-cleric',
        keyAbility: 'wis',
        ancestryId: 'human',
        backgroundId: Object.keys(db.backgrounds)[0],
        deityId: d.id,
        divineFont: 'heal',
      },
      db,
    );
    // Divine font — constrained by the deity's own list.
    expect(ch.spellcasting.find((s) => s.type === 'prepared')?.font?.type).toBe('heal');
    // "Your deity grants you the trained proficiency rank in one skill…"
    expect(ch.proficiencies.skills.occultism).toBe('trained');
    // "…and with the deity's favored weapon."
    expect(ch.proficiencies.weaponOverrides?.scimitar).toBe('trained');
    // Domain Initiate offers the deity's domains.
    expect(domainPoolFor(d.id, db, 'deity')).toEqual(['fire', 'sun']);
    expect(domainPoolFor(d.id, db, 'deity+alternate')).toEqual(['fire', 'sun', 'healing']);
    // The cleric's Deity feature adds the deity's spells to the cleric spell list.
    expect(ch.spellListAdditions?.['cleric-casting']).toEqual(expect.arrayContaining(['fireball', 'wall-of-fire']));
  });
});
