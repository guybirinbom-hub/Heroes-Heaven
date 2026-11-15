// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { content, firstSubclass } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { ContentContext } from '../src/sheet/ContentContext';
import { loadAstIndex, loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { RecordCard } from '../src/sheet/RecordCard';
import { DetailsTab } from '../src/sheet/DetailsTab';
import { SpellDetail } from '../src/sheet/SpellsTab';
import { FeatDetail, type FeatEntry } from '../src/sheet/FeatDetail';
import { FeatsTab, featEntries } from '../src/sheet/FeatsTab';
import { linkClassOf, scopeOfCharacter } from '../src/sheet/cardScope';
import { SHARED_FEATURE_FOOTER } from '../src/rules/featureText';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * Package M (2026-10-16), found from the owner's swashbuckler "Weapon Expertise" screenshot: what the card
 * shows for a SHARED class feature — one record many classes list, whose page is one class's (Weapon
 * Expertise's is the Thaumaturge's, Reflex Expertise's the Guardian's, Perception Expertise's the
 * Thaumaturge's "master" printing).
 *  (2) a page reached by a LINK inside a card: a class page's "weapon expertise" opens the record that class
 *      lists under that name (featureText.ts classOwnFeatureId: the magus's own page), and where the class
 *      lists the shared record its paragraph is drawn on the no-page lane (RecordCard sharedFeatureView,
 *      read for the class whose page the link sat on, else the character's). Search, with no class known,
 *      still opens the record's own page.
 *  (3) Dual Class: each class-feature row carries its class (FeatsTab featEntries → FeatEntry.classId) and
 *      its card and row preview are read for it (scopeOfCharacter's classId: the second class with its own
 *      subclass).
 *  (4) the shared card's Source line is the class's own book (featureText.ts sharedFeatureBook), never the
 *      shared record's "Pathfinder Dark Archive (Remastered)".
 *  (6) before the descriptions arrive (they load after core.json, not awaited) the card shows the no-page
 *      lane, loading — never the other class's page.
 *
 * REAL components (DetailsTab, RecordCard, FeatDetail, FeatsTab) over the shipped page trees through a fetch
 * stub, on the GATED content (content({ trustGate: true }), what the app runs). Characters are synthesized
 * (name 't'); none is the owner's. Every case reads true both before and after the data lane re-points the
 * swashbuckler's list at weapon-expertise-swashbuckler.
 *
 * MUTATION LINES (each measured red on 2026-10-16 under the heavy-job lock, then the file restored
 * byte-exact from its original bytes, sha1 checked; scratch pm-mutate.mjs runs A and B):
 *  - RecordCard.tsx: `shared` computed for the mine card only again (`(mine || stack.length > 1)` → `mine`)
 *    → the cleric "perception expertise" link case red (the Thaumaturge's "master" page drawn).
 *  - RecordCard.tsx ownId: the class's own record ignored (returns the linked slug) → the swashbuckler class
 *    card, the swashbuckler page from search and the magus cases red (the Thaumaturge's page drawn).
 *  - RecordCard.tsx sharedFeatureView: `book` = the shared record's own book again → the wizard 11 and
 *    cleric Source cases red ("Pathfinder Dark Archive (Remastered)").
 *  - featureText.ts sharedFeatureFallback: null again when the text is absent → the descriptions-not-loaded
 *    case red (the Thaumaturge page drawn).
 *  - FeatsTab.tsx: `classId: clsId` dropped from the class loop → the scope / row-class case, guardian + bard,
 *    swashbuckler + wizard (the wizard second) and the guardian + bard row-preview case red.
 *  - cardScope.ts scopeOfCharacter: the classId argument ignored → the same four Dual Class cases red.
 * The live-data wizard + swashbuckler and thaumaturge + swashbuckler cases stay green under the last two:
 * their rows' truth is the first class's paragraph or the swashbuckler's own page (its list names weapon-
 * expertise-swashbuckler since the data lane), which no scope changes — they hold the screen. The planted
 * "listing the shared record" twins of those two hold the fix.
 * Checker round 1 (measured red 2026-10-16 through vi.mock from a temporary test file that imported this
 * one — a scratch copy of featureText.ts, in-memory cardScope.ts mutations; no repo file changed):
 *  - featureText.ts classOwnFeatureId without its tail pass → the swashbuckler 13 "weapon mastery" and
 *    psychic 13 "weapon specialization" cases red (the Thaumaturge's page drawn).
 *  - cardScope.ts linkClassOf back to the node directly below the link (`trail[trail.length - 1]` only) →
 *    the nearest-class-page case red.
 *  - cardScope.ts scopeOfCharacter: the classId argument ignored → both planted Dual Class cases red.
 */

const db: ContentDatabase = content({ trustGate: true });
const noop = () => undefined;
const trees: Record<string, Record<string, AstNode>> = {};
const astIndex = JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;
function treeOf(b: string): Record<string, AstNode> | undefined {
  if (trees[b]) return trees[b];
  const p = `public/ast/${b}.json.gz`;
  if (!existsSync(p)) return undefined;
  trees[b] = JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));
  return trees[b];
}

/** A synthesized character on the gated content (the _content build helper, gated). */
function build(classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = db.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(db.ancestries)[0],
      backgroundId: Object.keys(db.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: firstSubclass(classId),
      ...over,
    },
    db,
  );
}
const dual = (first: string, second: string, level: number) =>
  build(first, level, { variantRules: { dualClass: true }, classId2: second, subclassId2: firstSubclass(second) } as Partial<BuildState>);

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function mount(el: ReactElement, value: ContentDatabase = db): Promise<{ host: HTMLElement; stop: () => void }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<ContentContext.Provider value={value}>{el}</ContentContext.Provider>);
  });
  await settle();
  return { host, stop: () => { act(() => root.unmount()); host.remove(); } };
}
async function click(el: Element | null | undefined) {
  expect(el, 'a control to click').toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const txt = (el: Element | null | undefined) => norm(el?.textContent);
/** The open popup (the card's overlay). */
const popup = (host: HTMLElement) => host.querySelector('.picker-overlay');
/** The Details tab's Class term (desktop layout: matchMedia is stubbed to "not a phone"). */
const classTerm = (host: HTMLElement, name: string) => [...host.querySelectorAll('.oval.info-term')].find((e) => txt(e) === name);
/** A link on the open card, by its words. */
const linkTo = (host: HTMLElement, words: string) => [...(popup(host)?.querySelectorAll('a.ast-lk') ?? [])].find((a) => txt(a).toLowerCase() === words);

// The pages' own words (the Archives mirror, by-category/class-feature-NNNN).
// class-feature-1178 (Weapon Expertise, Class Thaumaturge): "You've learned the secret ways your weapons work most effectively."
const THAUMATURGE_WE = /secret ways/;
// class-feature-1019 (Weapon Expertise, Class Swashbuckler): "You gain access to the critical specialization effects of all weapons for which you have expert proficiency."
const SWASH_CRIT = /critical specialization effects of all weapons for which you have expert proficiency/;
// The wizard's paragraph of the shared text (class-39 "Through sheer experience").
const WIZARD_WE = /Through sheer experience/;
// class-feature-1127 (Reflex Expertise, Class Guardian): "Even in the heaviest of armors, you can brace yourself against widespread effects."
const GUARDIAN_RX = /Even in the heaviest of armors/;

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
  for (const b of ['classes', 'classFeatures', 'feats', 'actions', 'categoryPage', 'traits']) await loadBucketAst(b);
}, 300_000);
afterAll(() => { vi.unstubAllGlobals(); });

describe('package M (2): a shared feature reached by a link inside a card is read for a class', () => {
  it('swashbuckler 5: its class card → "weapon expertise" reads critical specialization, never the Thaumaturge\'s "secret ways" or book', async () => {
    const ch = build('swashbuckler', 5);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      await click(classTerm(m.host, 'Swashbuckler'));
      expect(m.host.querySelector('.ast-modal.card-mine'), 'the class card (its page lane)').toBeTruthy();
      await click(linkTo(m.host, 'weapon expertise'));
      const text = txt(popup(m.host));
      expect(text).toMatch(SWASH_CRIT);
      expect(text).not.toMatch(THAUMATURGE_WE);
      expect(text).not.toMatch(/Dark Archive/);
      expect(m.host.querySelector('.info-back'), 'Back returns to the class card').toBeTruthy();
    } finally { m.stop(); }
  });

  it('the swashbuckler page opened from search (browse, no character): its link is read for the swashbuckler too', async () => {
    const m = await mount(<RecordCard record={{ bucket: 'classes', id: 'swashbuckler' }} mode="browse" chrome="popup" onExit={noop} />);
    try {
      await click(linkTo(m.host, 'weapon expertise'));
      const text = txt(popup(m.host));
      expect(text).toMatch(SWASH_CRIT);
      expect(text).not.toMatch(THAUMATURGE_WE);
    } finally { m.stop(); }
  });

  it('magus 9: its class card → "weapon expertise" opens the magus\'s own Weapon Expertise page (Impossible Magic), not the Thaumaturge\'s', async () => {
    const ch = build('magus', 9);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      await click(classTerm(m.host, 'Magus'));
      await click(linkTo(m.host, 'weapon expertise'));
      const pop = popup(m.host)!;
      // class-feature-1269 (Weapon Expertise, Class Magus): "You've dedicated yourself to learning the intricacies of your weapons."
      expect(txt(pop)).toMatch(/learning the intricacies of your weapons/);
      expect(txt(pop)).toMatch(/Impossible Magic/);
      expect(txt(pop)).not.toMatch(THAUMATURGE_WE);
      expect(pop.querySelector('.ast-body'), 'the magus record\'s own page is drawn').toBeTruthy();
    } finally { m.stop(); }
  });

  it('cleric 5: its class card → "perception expertise" reads expert (never the Thaumaturge\'s master page), marked ours for the class, Source the cleric\'s book', async () => {
    const ch = build('cleric', 5);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      await click(classTerm(m.host, 'Cleric'));
      await click(linkTo(m.host, 'perception expertise'));
      const pop = popup(m.host)!;
      // class-33 (Cleric): "Perception Expertise … Your proficiency rank for Perception increases to expert."
      expect(txt(pop)).toMatch(/Perception increases to expert/);
      // class-feature-1183 (Perception Expertise, Class Thaumaturge): "Your proficiency rank for Perception increases to master."
      expect(txt(pop)).not.toMatch(/increases to master/);
      expect(txt(pop.querySelector('.card-nopage'))).toBe(SHARED_FEATURE_FOOTER);
      expect(pop.querySelector('.card-nopage')?.closest('[data-ours]')).toBeTruthy();
      expect(txt(pop.querySelector('.card-source'))).toBe('Source Pathfinder Player Core');
      expect(txt(pop)).not.toMatch(/Dark Archive/);
    } finally { m.stop(); }
  });

  // Checker round 1: the table's plain "weapon mastery" / "weapon specialization" where the class lists a
  // class-qualified record (featureText.ts classOwnFeatureId pass 2).
  it('swashbuckler 13: its class card → the table\'s "weapon mastery" opens Martial Weapon Mastery for the swashbuckler, never the Thaumaturge\'s page', async () => {
    const ch = build('swashbuckler', 13);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      await click(classTerm(m.host, 'Swashbuckler'));
      await click(linkTo(m.host, 'weapon mastery'));
      const pop = popup(m.host)!;
      expect(txt(pop.querySelector('.info-title, .ast-name'))).toBe('Martial Weapon Mastery');
      // class-63 (Swashbuckler, Player Core 2) "Weapon Mastery … You fully understand your weapons."
      expect(txt(pop)).toMatch(/You fully understand your weapons/);
      expect(txt(pop)).toMatch(/martial weapons, and unarmed attacks increase to master/);
      expect(txt(pop)).not.toMatch(/Thaumaturge/);
      expect(txt(pop)).not.toMatch(/Dark Archive/);
    } finally { m.stop(); }
  });

  it('psychic 13: its class card → the table\'s "weapon specialization" opens Psychic Weapon Specialization', async () => {
    const ch = build('psychic', 13);
    const m = await mount(<DetailsTab character={ch} content={db} />);
    try {
      await click(classTerm(m.host, 'Psychic'));
      await click(linkTo(m.host, 'weapon specialization'));
      const pop = popup(m.host)!;
      expect(txt(pop.querySelector('.info-title, .ast-name'))).toBe('Psychic Weapon Specialization');
      // class-68 (Psychic) "Weapon Specialization: As you touch a weapon, you glimpse the hands that made and wielded it"
      expect(txt(pop)).toMatch(/glimpse the hands that made and wielded it/);
      expect(txt(pop)).not.toMatch(/Thaumaturge/);
    } finally { m.stop(); }
  });

  // The item's own card (chrome 'inset', as ItemDetail draws it) must follow the same path as the popup card.
  // class-68 Psychic Weapon Specialization; the Bestial Mutagen page links the shared "weapon specialization".
  it('psychic 13: a class-feature link inside an ITEM\'s inset card opens Psychic Weapon Specialization, not the shared page', async () => {
    const ch = build('psychic', 13);
    const m = await mount(
      <RecordCard
        node={{ title: 'Bestial Mutagen', description: '', key: 'items', slug: 'bestial-mutagen' }}
        mode="mine" chrome="inset" scope={scopeOfCharacter(ch)} printed={[]} onExit={noop}
      />,
    );
    try {
      const lk = [...m.host.querySelectorAll('a.ast-lk')].find((a) => txt(a).toLowerCase() === 'weapon specialization');
      await click(lk);
      const pop = popup(m.host)!;
      expect(txt(pop.querySelector('.info-title, .ast-name'))).toBe('Psychic Weapon Specialization');
      expect(txt(pop)).toMatch(/glimpse the hands that made and wielded it/);
    } finally { m.stop(); }
  });

  // The text-only lane (an item whose page did not load: no key, so DescBody draws the string) opens its links
  // through the same linkedId as the pages do — in the inset card and in the popup card.
  const TEXT_ONLY = { title: 'Plain Charm', description: 'Your strikes gain weapon specialization.', descRefs: [{ key: 'classFeatures', label: 'weapon specialization' }] };
  const textLink = (host: Element) => [...host.querySelectorAll('a, button')].find((a) => txt(a).toLowerCase() === 'weapon specialization');
  it('psychic 13: a class-feature link in the TEXT-ONLY lane of the inset card opens Psychic Weapon Specialization', async () => {
    const ch = build('psychic', 13);
    const m = await mount(<RecordCard node={TEXT_ONLY} mode="mine" chrome="inset" scope={scopeOfCharacter(ch)} printed={[]} onExit={noop} />);
    try {
      await click(textLink(m.host));
      expect(txt(popup(m.host))).toMatch(/glimpse the hands that made and wielded it/);
    } finally { m.stop(); }
  });
  it('psychic 13: a class-feature link in the TEXT-ONLY lane of the popup card opens Psychic Weapon Specialization', async () => {
    const ch = build('psychic', 13);
    const m = await mount(<RecordCard node={TEXT_ONLY} mode="mine" chrome="popup" scope={scopeOfCharacter(ch)} printed={[]} onExit={noop} />);
    try {
      await click(textLink(m.host));
      expect(txt(m.host)).toMatch(/glimpse the hands that made and wielded it/);
    } finally { m.stop(); }
  });
  // A class that lists the shared record itself (the fighter): the link opens the shared record READ FOR that
  // class (the node carries its classId), never the Thaumaturge's page.
  it('fighter 7: the TEXT-ONLY lane link to weapon specialization is read for the fighter, not the Thaumaturge', async () => {
    const ch = build('fighter', 7);
    const m = await mount(<RecordCard node={TEXT_ONLY} mode="mine" chrome="inset" scope={scopeOfCharacter(ch)} printed={[]} onExit={noop} />);
    try {
      await click(textLink(m.host));
      const t = txt(popup(m.host));
      expect(t).toMatch(/Weapon Specialization/);
      expect(t).not.toMatch(/glimpse the hands/);
      expect(t).not.toMatch(/thaumaturge/i);
    } finally { m.stop(); }
  });
  // Spell pages link classFeatures:weapon-specialization / spell-repertoire; the spell card reads the character's class.
  it('psychic 13: the Moon Frenzy spell page\'s "weapon specialization" link opens Psychic Weapon Specialization', async () => {
    const ch = build('psychic', 13);
    const m = await mount(<SpellDetail spell={db.spells['moon-frenzy']} classId={ch.classId} onClose={noop} />);
    try {
      const lk = [...m.host.querySelectorAll('a.ast-lk')].find((a) => txt(a).toLowerCase() === 'weapon specialization');
      await click(lk);
      expect(txt(m.host)).toMatch(/glimpse the hands that made and wielded it/);
    } finally { m.stop(); }
  });

  it('search, no class known: classFeatures:weapon-expertise is still its own page (the Thaumaturge\'s)', async () => {
    const m = await mount(<RecordCard record={{ bucket: 'classFeatures', id: 'weapon-expertise' }} mode="browse" chrome="popup" onExit={noop} />);
    try {
      expect(txt(popup(m.host))).toMatch(THAUMATURGE_WE);
      expect(m.host.querySelector('.card-nopage')).toBeNull();
    } finally { m.stop(); }
  });
});

/** The real FeatDetail popup of a row FeatsTab built. */
async function rowCard(entry: FeatEntry, ch: Character, value: ContentDatabase = db) {
  return mount(<FeatDetail entry={entry} character={ch} onClose={noop} />, value);
}
/** A class-feature row of `classId`, found by the row's key (`feature:<class>:<id>`), not by the classId field
 *  this package added — so a row that lost its class is still found, and its card is what goes red. */
const rowOf = (ch: Character, classId: string, featureId: RegExp, value: ContentDatabase = db) => {
  const e = featEntries(ch, value).find((x) => x.key.startsWith(`feature:${classId}:`) && !!x.featureId && featureId.test(x.featureId));
  expect(e, `a ${classId} row ${featureId}`).toBeTruthy();
  return e!;
};

describe('package M (4): the shared card names the class\'s own book', () => {
  it('a wizard 11\'s Weapon Expertise: the wizard\'s paragraph, Source Pathfinder Player Core — never Dark Archive', async () => {
    const ch = build('wizard', 11);
    const m = await rowCard(rowOf(ch, 'wizard', /^weapon-expertise$/), ch);
    try {
      const pop = popup(m.host)!;
      expect(txt(pop)).toMatch(WIZARD_WE);
      expect(txt(pop.querySelector('.card-source'))).toBe('Source Pathfinder Player Core');
      expect(txt(pop)).not.toMatch(/Dark Archive/);
    } finally { m.stop(); }
  });

  it('a swashbuckler 5\'s Weapon Expertise row (whichever record its list names) shows no "Dark Archive"', async () => {
    const ch = build('swashbuckler', 5);
    const m = await rowCard(rowOf(ch, 'swashbuckler', /^weapon-expertise/), ch);
    try {
      const text = txt(popup(m.host));
      expect(text).toMatch(SWASH_CRIT);
      expect(text).not.toMatch(/Dark Archive/);
      expect(text).not.toMatch(THAUMATURGE_WE);
    } finally { m.stop(); }
  });
});

describe('package M (6): before the descriptions arrive, the no-page lane — never another class\'s page', () => {
  it('a wizard 11\'s Weapon Expertise with its text not loaded: loading placeholder, the shared footer, no Thaumaturge page', async () => {
    const { description: _d, ...rest } = db.classFeatures['weapon-expertise'];
    void _d;
    const noText = { ...db, classFeatures: { ...db.classFeatures, 'weapon-expertise': rest as typeof db.classFeatures[string] } } as ContentDatabase;
    const ch = build('wizard', 11);
    const m = await rowCard(rowOf(ch, 'wizard', /^weapon-expertise$/, noText), ch, noText);
    try {
      const pop = popup(m.host)!;
      expect(pop.querySelector('.ast-body'), 'no page is drawn').toBeNull();
      expect(pop.querySelector('.card-mine .ast-loading[aria-busy="true"]'), 'the quiet placeholder').toBeTruthy();
      expect(txt(pop)).not.toMatch(THAUMATURGE_WE);
      expect(txt(pop.querySelector('.card-nopage'))).toBe(SHARED_FEATURE_FOOTER);
    } finally { m.stop(); }
  });
});

describe('package M (2): the class a link is read for is the nearest class page on the stack', () => {
  it('a link however many links deep below a class page keeps that class; none on the trail: the character\'s; neither: none', () => {
    const wizardPage = { key: 'classes', slug: 'wizard' };
    const shared = { key: 'classFeatures', slug: 'weapon-expertise' };
    const deeper = { key: 'classFeatures', slug: 'weapon-specialization' };
    // The Wizard page → Weapon Expertise (the wizard's paragraph) → a link there: still the wizard, not a
    // cleric viewer's own class (checker round 1: depth 3 fell back to the scope's class).
    expect(linkClassOf([wizardPage, shared, deeper], 'cleric')).toBe('wizard');
    expect(linkClassOf([wizardPage, shared], 'cleric')).toBe('wizard');
    expect(linkClassOf([wizardPage], 'cleric')).toBe('wizard');
    // A class page reached from another class's page: the nearer one.
    expect(linkClassOf([wizardPage, shared, { key: 'classes', slug: 'magus' }, deeper], 'cleric')).toBe('magus');
    // No class page on the trail: the character's class (a mine card), else none (search).
    expect(linkClassOf([shared, deeper], 'cleric')).toBe('cleric');
    expect(linkClassOf([shared, deeper], undefined)).toBeUndefined();
    expect(linkClassOf([], undefined)).toBeUndefined();
  });
});

describe('package M (3): Dual Class — each class\'s row reads its own class', () => {
  it('the second class\'s scope is that class and its own subclass', () => {
    const ch = dual('guardian', 'bard', 11);
    expect(ch.classId2).toBe('bard');
    const s = scopeOfCharacter(ch, 'bard')!;
    expect(s.classId).toBe('bard');
    expect(s.subclassId).toBe(ch.subclassId2 ?? undefined);
    // The first class, an unheld class, or none: the scope it always was.
    expect(scopeOfCharacter(ch, 'guardian')).toEqual(scopeOfCharacter(ch));
    expect(scopeOfCharacter(ch, 'wizard')).toEqual(scopeOfCharacter(ch));
    expect(scopeOfCharacter(ch, undefined)).toEqual(scopeOfCharacter(ch));
    // FeatsTab puts each class-feature row's class on it.
    expect(rowOf(ch, 'bard', /^reflex-expertise$/).classId).toBe('bard');
    expect(rowOf(ch, 'guardian', /^reflex-expertise$/).classId).toBe('guardian');
  });

  it('guardian + bard: the bard\'s Reflex Expertise is the generic paragraph (ours, for the bard), not the Guardian page; the guardian\'s is its page', async () => {
    const ch = dual('guardian', 'bard', 11);
    const bard = await rowCard(rowOf(ch, 'bard', /^reflex-expertise$/), ch);
    try {
      const pop = popup(bard.host)!;
      expect(txt(pop)).not.toMatch(GUARDIAN_RX);
      expect(txt(pop)).toMatch(/dodging danger/);
      expect(txt(pop.querySelector('.card-nopage'))).toBe(SHARED_FEATURE_FOOTER);
    } finally { bard.stop(); }
    const guardian = await rowCard(rowOf(ch, 'guardian', /^reflex-expertise$/), ch);
    try {
      expect(txt(popup(guardian.host))).toMatch(GUARDIAN_RX);
    } finally { guardian.stop(); }
  });

  it('wizard + swashbuckler: the wizard row reads the wizard, the swashbuckler row critical specialization', async () => {
    const ch = dual('wizard', 'swashbuckler', 11);
    const w = await rowCard(rowOf(ch, 'wizard', /^weapon-expertise$/), ch);
    try {
      expect(txt(popup(w.host))).toMatch(WIZARD_WE);
      expect(txt(popup(w.host))).not.toMatch(SWASH_CRIT);
    } finally { w.stop(); }
    const s = await rowCard(rowOf(ch, 'swashbuckler', /^weapon-expertise/), ch);
    try {
      expect(txt(popup(s.host))).toMatch(SWASH_CRIT);
      expect(txt(popup(s.host))).not.toMatch(WIZARD_WE);
      expect(txt(popup(s.host))).not.toMatch(THAUMATURGE_WE);
    } finally { s.stop(); }
  });

  it('swashbuckler + wizard (the wizard second): the wizard row reads the wizard paragraph, never the Thaumaturge page', async () => {
    const ch = dual('swashbuckler', 'wizard', 11);
    const w = await rowCard(rowOf(ch, 'wizard', /^weapon-expertise$/), ch);
    try {
      expect(txt(popup(w.host))).toMatch(WIZARD_WE);
      expect(txt(popup(w.host))).not.toMatch(THAUMATURGE_WE);
    } finally { w.stop(); }
  });

  it('thaumaturge + swashbuckler: the thaumaturge row is its page ("secret ways"), the swashbuckler row critical specialization', async () => {
    const ch = dual('thaumaturge', 'swashbuckler', 11);
    const t = await rowCard(rowOf(ch, 'thaumaturge', /^weapon-expertise$/), ch);
    try {
      expect(txt(popup(t.host))).toMatch(THAUMATURGE_WE);
    } finally { t.stop(); }
    const s = await rowCard(rowOf(ch, 'swashbuckler', /^weapon-expertise/), ch);
    try {
      expect(txt(popup(s.host))).toMatch(SWASH_CRIT);
      expect(txt(popup(s.host))).not.toMatch(THAUMATURGE_WE);
    } finally { s.stop(); }
  });

  /* The two cases above hold the screen on live data, where the swashbuckler lists its own record. These
     plant the shape the fix is for — the swashbuckler listing the SHARED weapon-expertise, as it did before
     the data lane — so the swashbuckler row's paragraph can only come from the row's own class: read for the
     first class (the bug), the row shows the wizard's paragraph or the Thaumaturge's page. */
  const swashShared = (() => {
    const s = db.classes.swashbuckler;
    return { ...db, classes: { ...db.classes, swashbuckler: { ...s, features: s.features.map((f) => (f.featureId === 'weapon-expertise-swashbuckler' ? { ...f, featureId: 'weapon-expertise' } : f)) } } } as ContentDatabase;
  })();

  it('wizard + swashbuckler, the swashbuckler listing the shared record: each row reads its own class\'s paragraph', async () => {
    expect(swashShared.classes.swashbuckler.features.some((f) => f.featureId === 'weapon-expertise')).toBe(true);
    const ch = dual('wizard', 'swashbuckler', 11);
    const s = await rowCard(rowOf(ch, 'swashbuckler', /^weapon-expertise$/, swashShared), ch, swashShared);
    try {
      expect(txt(popup(s.host))).toMatch(SWASH_CRIT);
      expect(txt(popup(s.host))).not.toMatch(WIZARD_WE);
      expect(txt(popup(s.host))).not.toMatch(THAUMATURGE_WE);
    } finally { s.stop(); }
    const w = await rowCard(rowOf(ch, 'wizard', /^weapon-expertise$/, swashShared), ch, swashShared);
    try {
      expect(txt(popup(w.host))).toMatch(WIZARD_WE);
      expect(txt(popup(w.host))).not.toMatch(SWASH_CRIT);
    } finally { w.stop(); }
  });

  it('thaumaturge + swashbuckler, the swashbuckler listing the shared record: the swashbuckler row reads its paragraph, not the Thaumaturge page', async () => {
    const ch = dual('thaumaturge', 'swashbuckler', 11);
    const s = await rowCard(rowOf(ch, 'swashbuckler', /^weapon-expertise$/, swashShared), ch, swashShared);
    try {
      expect(txt(popup(s.host))).toMatch(SWASH_CRIT);
      expect(txt(popup(s.host))).not.toMatch(THAUMATURGE_WE);
      expect(txt(popup(s.host)?.querySelector('.card-nopage'))).toBe(SHARED_FEATURE_FOOTER);
    } finally { s.stop(); }
    const t = await rowCard(rowOf(ch, 'thaumaturge', /^weapon-expertise$/, swashShared), ch, swashShared);
    try {
      expect(txt(popup(t.host))).toMatch(THAUMATURGE_WE);
    } finally { t.stop(); }
  });

  it('guardian + bard on the Feats tab: the two Reflex Expertise rows preview their own popups\' first lines', async () => {
    const ch = dual('guardian', 'bard', 11);
    const m = await mount(<FeatsTab character={ch} content={db} />);
    try {
      const rows = [...m.host.querySelectorAll('.ff-row')].filter((r) => txt(r.querySelector('.ff-name')) === 'Reflex Expertise');
      expect(rows).toHaveLength(2);
      const previews = rows.map((r) => txt(r.querySelector('.ff-preview')));
      expect(previews.filter((p) => GUARDIAN_RX.test(p)), previews.join(' | ')).toHaveLength(1);
      expect(previews.filter((p) => /dodging danger/.test(p)), previews.join(' | ')).toHaveLength(1);
    } finally { m.stop(); }
  });
});
