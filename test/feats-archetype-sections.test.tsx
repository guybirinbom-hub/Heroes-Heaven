// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { build, content, firstSubclass } from './_content';
import { ContentContext } from '../src/sheet/ContentContext';
import { FeatsTab, featEntries, featSections } from '../src/sheet/FeatsTab';
import { archetypeSourceOf } from '../src/rules/archetypeSource';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Bug 2026-11-08 (owner): *"feats granted from archytype apearing in class features in feats and features
 * ( we need to have a diffrent filter for each archytype and the class shuld be named the class name
 * insted the class)"*.
 *
 * The Feats & Features page had ONE "Class" and ONE "Archetype" section. A Fighter who took Bastion
 * Dedication was handed Reactive Shield, and since Reactive Shield is a class feat it was listed under
 * "Class", as if the fighter had picked it. Now: one section per held class, named after the class;
 * one per archetype, named after the archetype, holding everything that archetype gives.
 * Characters are synthesized through build() (name 't'); none is the owner's.
 */
const db: ContentDatabase = content();
const rowsOf = (ch: Character) => featEntries(ch, db);
const sectionOf = (ch: Character, featId: string) => rowsOf(ch).find((e) => e.featId === featId)?.bucket;
const labels = (ch: Character) => featSections(rowsOf(ch), ch, db).map((s) => s.label);

describe('Feats & Features sections: each class and each archetype by name', () => {
  it('Bastion Dedication: the Reactive Shield it grants sits under "Bastion", not under the class', () => {
    const ch = build('fighter', 8, { featPicks: { '2:class': 'bastion-dedication' } });
    const rs = rowsOf(ch).find((e) => e.featId === 'reactive-shield');
    expect(rs?.grantedBy).toBe('Bastion Dedication');
    expect(rs?.bucket).toBe('Bastion');
    expect(rs?.bucketKind).toBe('archetype');
    // Its popup still says what the record is: a class feat.
    expect(rs?.featType).toBe('Class');
    expect(sectionOf(ch, 'bastion-dedication')).toBe('Bastion');
    // The class section is the class's own name; neither old shared word is offered.
    expect(labels(ch)[0]).toBe('Fighter');
    expect(labels(ch)).toContain('Bastion');
    expect(labels(ch)).not.toContain('Class');
    expect(labels(ch)).not.toContain('Archetype');
  });

  it('every dedication a fighter can take at 2: nothing it adds lands outside its own archetype section', () => {
    const base = new Set(rowsOf(build('fighter', 8)).map((e) => e.key));
    const leaks: string[] = [];
    let built = 0;
    for (const d of Object.values(db.feats).filter((f) => f.traits.includes('dedication') && f.level <= 2)) {
      const ch = build('fighter', 8, { featPicks: { '2:class': d.id } });
      if (!ch.feats.some((f) => f.featId === d.id)) continue;
      built++;
      const mine = sectionOf(ch, d.id);
      for (const e of rowsOf(ch)) if (!base.has(e.key) && (e.bucketKind !== 'archetype' || e.bucket !== mine)) leaks.push(`${d.id}: ${e.key} under ${e.bucket}`);
    }
    // Measured 2026-11-08: 200 dedications build at fighter 2; 42 of them added a row outside the archetype.
    expect(built).toBeGreaterThan(150);
    expect(leaks).toEqual([]);
  });

  it('a class feature an archetype feat hands over (Ranger Dedication → Hunt Prey) is listed, under that archetype', () => {
    expect(db.feats['ranger-dedication'].grantsClassFeatures).toContain('hunt-prey');
    const ch = build('fighter', 8, { featPicks: { '2:class': 'ranger-dedication' } });
    const rows = rowsOf(ch).filter((e) => e.featureId === 'hunt-prey');
    // Listed once (it was listed nowhere before), under Ranger, saying where it came from.
    expect(rows.map((e) => [e.bucket, e.grantedBy])).toEqual([['Ranger', 'Ranger Dedication']]);
    // A RANGER's own Hunt Prey stays one row, under Ranger the class.
    const ranger = rowsOf(build('ranger', 8)).filter((e) => e.featureId === 'hunt-prey');
    expect(ranger.map((e) => e.bucket)).toEqual(['Ranger']);
    expect(ranger[0].bucketKind).toBe('class');
  });

  it('two archetypes get two sections, each named after its archetype', () => {
    const ch = build('fighter', 8, {
      variantRules: { freeArchetype: true },
      featPicks: { '2:archetype': 'archer-dedication', '4:archetype': 'quick-shot', '6:archetype': 'crossbow-terror', '2:class': 'bastion-dedication' },
    });
    const held = ch.feats.map((f) => f.featId);
    expect(held).toContain('archer-dedication');
    expect(held).toContain('bastion-dedication');
    expect(sectionOf(ch, 'archer-dedication')).toBe('Archer');
    expect(sectionOf(ch, 'reactive-shield')).toBe('Bastion');
    expect(labels(ch).filter((l) => l === 'Archer' || l === 'Bastion').sort()).toEqual(['Archer', 'Bastion']);
  });

  it('an archetype feat with no archetype slug is named from its prerequisite (Advanced Bow Training → Archer)', () => {
    expect(db.feats['advanced-bow-training'].archetype).toBeUndefined();
    const ch = build('fighter', 8, { featPicks: { '2:class': 'archer-dedication' } });
    const src = archetypeSourceOf(ch, db);
    expect(src.ofFeat('advanced-bow-training')).toBe('Archer');
    // …and a chain of them: Expert Necromancer Spellcasting → Basic Necromancer Spellcasting → Necromancer.
    expect(src.ofFeat('expert-necromancer-spellcasting')).toBe('Necromancer');
  });

  it("a class feat of ANOTHER class that the archetype lists (a rogue's Reflexive Shield) sits under the archetype", () => {
    expect(db.feats['reflexive-shield'].archetype).toBe('bastion');
    const rogue = build('rogue', 8, { featPicks: { '2:class': 'bastion-dedication' } });
    expect(archetypeSourceOf(rogue, db).ofFeat('reflexive-shield')).toBe('Bastion');
    // A FIGHTER's own Reflexive Shield is a fighter feat and stays under Fighter.
    const fighter = build('fighter', 8, { featPicks: { '2:class': 'bastion-dedication' } });
    expect(archetypeSourceOf(fighter, db).ofFeat('reflexive-shield')).toBeUndefined();
  });

  it('a class archetype (Warrior of Legend): its substituted class feature and what it grants sit under it', () => {
    const ch = build('fighter', 8, { featPicks: { '2:class': 'warrior-of-legend-dedication' } });
    const rows = rowsOf(ch);
    const feature = rows.find((e) => e.key === 'feature:fighter:warrior-of-legend');
    const arch = sectionOf(ch, 'warrior-of-legend-dedication');
    expect(feature?.bucket).toBe(arch);
    expect(sectionOf(ch, 'diehard')).toBe(arch);
    // The fighter's own class features stay under Fighter.
    const own = rows.filter((e) => e.key.startsWith('feature:fighter:') && e.key !== 'feature:fighter:warrior-of-legend');
    expect(own.length).toBeGreaterThan(3);
    expect(own.map((e) => e.bucket).filter((b) => b !== 'Fighter')).toEqual([]);
  });

  it('Dual Class: one section per class, each named after its class', () => {
    const ch = build('wizard', 5, { variantRules: { dualClass: true }, classId2: 'fighter', subclassId2: firstSubclass('fighter') });
    const ls = labels(ch);
    expect(ls.slice(0, 2)).toEqual(['Wizard', 'Fighter']);
    expect(rowsOf(ch).filter((e) => e.key.startsWith('feature:fighter:')).every((e) => e.bucket === 'Fighter')).toBe(true);
    expect(rowsOf(ch).filter((e) => e.key.startsWith('feature:wizard:')).every((e) => e.bucket === 'Wizard')).toBe(true);
  });

  it("Dual Class: the SECOND class's subclass pick (a cleric's doctrine) sits under that class, not the first", () => {
    const ch = build('fighter', 5, { variantRules: { dualClass: true }, classId2: 'cleric', subclassId2: firstSubclass('cleric') });
    const doctrine = rowsOf(ch).find((e) => e.key.startsWith('choice:Doctrine:'));
    expect(doctrine, 'the doctrine row').toBeTruthy();
    expect(doctrine?.bucket).toBe('Cleric');
  });

  it('a feat open to two archetypes goes under the one the character holds (Cunning Trickster Mask, Druid)', () => {
    // Stamped `wizard`, but its prerequisite reads "Druid Dedication or Wizard Dedication".
    expect(db.feats['cunning-trickster-mask'].archetype).toBe('wizard');
    const ch = build('fighter', 8, { featPicks: { '2:class': 'druid-dedication' } });
    expect(archetypeSourceOf(ch, db).ofFeat('cunning-trickster-mask')).toBe('Druid');
    // …and on a character holding Wizard Dedication, under Wizard.
    const wiz = build('fighter', 8, { featPicks: { '2:class': 'wizard-dedication' } });
    expect(archetypeSourceOf(wiz, db).ofFeat('cunning-trickster-mask')).toBe('Wizard');
  });

  it('Bellflower Tiller is ONE section: its dedication and its feats agree', () => {
    // Release v0.1.46 runs on v0.1.45's rules data, which has no 'bellflower-tiller-dedication' record
    // (it arrived with the 2026-10-30 Archives refresh); the dedication there is 'bellflower-dedication'.
    const ch = build('fighter', 8, { featPicks: { '2:class': 'bellflower-dedication' } });
    const src = archetypeSourceOf(ch, db);
    const names = new Set(['bellflower-dedication', 'scarecrow', 'garden-path', 'tillers-aid', 'tillers-drive'].map((id) => src.ofFeat(id)));
    expect([...names]).toEqual(['Bellflower Tiller']);
  });
});

describe('Feats & Features page: the filter chips a player clicks', () => {
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    if (!window.matchMedia)
      window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
  });
  let stops: (() => void)[] = [];
  afterEach(() => { for (const s of stops) s(); stops = []; });

  it('chips read "All, Fighter, Bastion, …"; clicking Bastion lists Reactive Shield, clicking Fighter does not', async () => {
    const ch = build('fighter', 8, { featPicks: { '2:class': 'bastion-dedication' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<ContentContext.Provider value={db}><FeatsTab character={ch} content={db} /></ContentContext.Provider>); });
    stops.push(() => { act(() => root.unmount()); host.remove(); });
    const chips = () => [...host.querySelectorAll('.ff-filters .fchip')] as HTMLElement[];
    const names = () => [...host.querySelectorAll('.ff-name')].map((n) => n.textContent);
    const heads = () => [...host.querySelectorAll('.ff-sec')].map((n) => n.childNodes[1]?.textContent);
    expect(chips().map((c) => c.textContent)).toEqual(['All', 'Fighter', 'Bastion', ...chips().slice(3).map((c) => c.textContent)]);
    expect(heads()).not.toContain('Class');
    await act(async () => { chips().find((c) => c.textContent === 'Bastion')!.click(); });
    expect(heads()).toEqual(['Bastion']);
    expect(names()).toContain('Reactive Shield');
    expect(names()).toContain('Bastion Dedication');
    await act(async () => { chips().find((c) => c.textContent === 'Bastion')!.click(); });
    await act(async () => { chips().find((c) => c.textContent === 'Fighter')!.click(); });
    expect(heads()).toEqual(['Fighter']);
    expect(names()).not.toContain('Reactive Shield');
    // Another character opened in the SAME sheet (it is not re-mounted): the "Fighter" pick names no
    // section of a wizard's, so it is ignored — All is lit and every section shows, never a blank page.
    const wizard = build('wizard', 8);
    await act(async () => { root.render(<ContentContext.Provider value={db}><FeatsTab character={wizard} content={db} /></ContentContext.Provider>); });
    expect(chips().find((c) => c.textContent === 'All')?.classList.contains('on')).toBe(true);
    expect(heads()[0]).toBe('Wizard');
    expect(names().length).toBeGreaterThan(3);
  });
});
