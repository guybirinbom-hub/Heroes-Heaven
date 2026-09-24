// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { act, createElement } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { EXTRA_FEAT_TAKINGS } from '../src/rules/featFeatGrants';
import { categoryOfBook, NICHE_CATEGORIES } from '../src/rules/sources';
import { loadBucketAst, type AstNode } from '../src/sheet/astStore';
import { AddItemsModal } from '../src/sheet/AddItemsModal';
import { ContentContext } from '../src/sheet/ContentContext';
import { DescriptionModal } from '../src/sheet/DescriptionModal';
import { FeatDetail, type FeatEntry } from '../src/sheet/FeatDetail';
import { descNodeOf } from '../src/sheet/FilterableSelect';
import { TrustMarker } from '../src/sheet/TrustMarker';
import LEDGER from '../src/data/trust-ledger.json';
import { hostSearchRecords } from '../src/integration/hostSearchRecords';
import { GlobalSearch } from '../tracker/src/components/GlobalSearch';
import { HostSearchProvider } from '../tracker/src/data/hostSearchContext';
import { liveEdition, loadLivePages, sameName } from '../scripts/lib/live-pages.mjs';

/**
 * The records `npm run data` CREATED for pages no record answered for (owner, 2026-09-24: "the players'
 * missing data is more important — add it"; scripts/lib/player-create.mjs) are reachable where a player
 * picks them and open onto their OWN page, with their own text, and say that none of their rules apply
 * yet. Each block below is one way the first cut failed a real player (refuted 2026-09-24): a second
 * Fall of Plaguestone Refugee, a feat or item popup showing the OTHER record of its name, books on a
 * hidden shelf, no "not applied" line, the page header left in the text, and no way to find a reprint
 * by its older name.
 */
type Created = Record<string, Record<string, { doc: string }>>;
const created = JSON.parse(readFileSync('scripts/migration/out/player-created.json', 'utf8')) as Created;
const BACKGROUNDS = Object.keys(created.backgrounds ?? {});
const HERITAGES = Object.keys(created.heritages ?? {});
const FEATS = Object.keys(created.feats ?? {});
const noop = () => undefined;
const db = () => content();

/** Let the popups' async ast lookups and deferred timers run. */
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
/** The first words of a record's prose, whitespace-folded the way the DOM text below is. */
const prose = (d = '') => d.replace(/\s+/g, ' ').trim().slice(0, 60);
const bodyText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const NOTE = 'Not yet verified';
/** TrustMarker's wording for a created record with NONE of its rules encoded (the ledger's `unencoded`). */
const NOTHING_APPLIED = 'shown, not applied';
/** The SHIPPED ledger's `unencoded`: the close stage regenerates it after a batch's rows land. */
const UNENCODED = new Set((LEDGER as { unencoded?: string[] }).unencoded ?? []);

/* jsdom cannot fetch public/ast: serve the SHIPPED trees for the records these tests open (through the
 * loader's raw-json fallback) and 404 everything else, so a background popup falls back to its plain
 * description exactly as it does in the app (the Builder opens backgrounds as `key: 'origin'`). */
const SERVE: Record<string, string[]> = {
  heritages: HERITAGES,
  feats: [...FEATS, 'zombie-horde', 'remote-detonation', 'practical-magic', 'keep-pace'],
  items: ['silver-ingot-travel-guide', 'silver-ingot', 'searing-blade'],
};
beforeAll(async () => {
  const served: Record<string, Record<string, AstNode>> = {};
  for (const [bucket, ids] of Object.entries(SERVE)) {
    const shipped = JSON.parse(gunzipSync(readFileSync(`public/ast/${bucket}.json.gz`)).toString('utf8')) as Record<string, AstNode>;
    served[bucket] = Object.fromEntries(ids.filter((id) => shipped[id]).map((id) => [id, shipped[id]]));
  }
  vi.stubGlobal('fetch', async (url: string) => {
    const m = /ast\/([A-Za-z]+)\.json$/.exec(String(url));
    return m && served[m[1]] ? { ok: true, json: async () => served[m[1]] } : { ok: false };
  });
  for (const b of Object.keys(SERVE)) await loadBucketAst(b);
});

function openBuilder(over: Partial<BuildState> = {}) {
  const c = db();
  const books = [...new Set([
    ...BACKGROUNDS.map((id) => c.backgrounds[id]?.source?.book),
    ...HERITAGES.map((id) => c.heritages[id]?.source?.book),
    c.ancestries.automaton?.source?.book,
  ].filter((b): b is string => !!b))];
  // Only these books, so the picker's 100-row cap cannot hide a created row (the chosen ancestry and
  // class are kept whatever the books say — collectChosenIds).
  const build: BuildState = {
    ...emptyBuild(), name: 't', level: 1, ancestryId: 'automaton', classId: 'fighter', keyAbility: 'str',
    enabledSources: books, ...over,
  };
  // Inside the content provider, as src/App.tsx renders every screen (popups resolve through it).
  return renderDom(createElement(ContentContext.Provider, { value: c },
    createElement(Builder, { content: c, initial: build, onCancel: noop, onCreate: noop })));
}
/** Open a page of the Builder's level strip ("0" is the origin page). */
function openLevel(r: ReturnType<typeof renderDom>, level: string) {
  const btn = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === level);
  if (btn) r.click(btn);
}

async function openPicker(r: ReturnType<typeof renderDom>, title: string) {
  const ctl = document.querySelector(`[data-ctl-title="${title}"]`);
  expect(ctl, `no "${title}" control on the level-0 page`).toBeTruthy();
  r.click(ctl!.querySelector('.ss-replace') ?? ctl!);
  await settle();
  return [...document.querySelectorAll('.picker-overlay .pick-row')];
}

describe('created player records reach the Builder with their text', () => {
  it('the importer created the backgrounds and heritages this test expects — and no second Refugee', () => {
    const c = db();
    expect(BACKGROUNDS).toContain('envoys-alliance');
    expect(BACKGROUNDS.length).toBe(25);
    // The Fall of Plaguestone page is the EXISTING record's, repointed; no copy of it is made.
    expect(BACKGROUNDS).not.toContain('refugee-fop');
    expect(c.backgrounds['refugee-fop']).toBeUndefined();
    expect(c.backgrounds['refugee-fall-of-plaguestone'].aonId).toBe('background-40');
    expect(c.backgrounds['refugee-pc2'].aonId).toBe('background-455');
    expect(HERITAGES.sort()).toEqual(['defensive-automaton', 'newly-minted-automaton']);
    for (const id of HERITAGES) expect(c.heritages[id].ancestryId).toBe('automaton');
  });

  it('every created background is a row of the Background picker and opens on its own prose', async () => {
    const c = db();
    const r = openBuilder();
    openLevel(r, '0');
    for (const id of BACKGROUNDS) {
      const rec = c.backgrounds[id];
      const rows = await openPicker(r, 'Background');
      const row = rows.find((x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === rec.name);
      expect(row, `backgrounds/${id} "${rec.name}" is not in the Background picker`).toBeTruthy();
      r.click(row!.querySelector('.pick-body'));
      await settle();
      expect(prose(rec.description).length, `backgrounds/${id} carries no prose`).toBeGreaterThan(20);
      expect(bodyText(), `backgrounds/${id} popup`).toContain(prose(rec.description));
      // Its boosts, skills and feat are encoded now (see below), so there is no "not applied" line —
      // unless its print carries more than that (the ledger's `partly`), and then the line names it.
      const partly = (LEDGER as { partly?: Record<string, string> }).partly?.[`backgrounds/${id}`];
      if (partly) expect(document.querySelector('.sd-choice-note')?.textContent, `backgrounds/${id} popup`).toContain(`partly applied. Not applied: ${partly}`);
      else expect(document.querySelector('.sd-choice-note'), `backgrounds/${id} popup`).toBeNull();
      // close the description, then the picker, before the next one
      r.click(document.querySelector('.ast-modal .picker-close, .info-modal .picker-close'));
      await settle();
      r.click(document.querySelector('.picker-overlay .picker-close'));
      await settle();
    }
    r.stop();
  }, 120_000);

  /*
   * Refuted 2026-09-24: picking Envoy's Alliance showed "Envoy's Alliance / Replace" and nothing else —
   * no boosts, no trained skills, no skill feat — so the player ended two boosts, two trainings and a
   * skill feat short. The Archives state all three as fields, and every shipped background already
   * takes them through `backgroundFacets`; the created ones now do too.
   */
  it('every created background grants its printed boosts and training, and its skill feat where it prints one', () => {
    const c = db();
    // The six rare Bastion of Blasphemies backgrounds print a special ability in place of a skill feat.
    const NO_FEAT = new Set(['art-collector', 'blooded-by-the-dead', 'curse-marked', 'friend-of-a-friend', 'once-possessed', 'trusted-rival']);
    for (const id of BACKGROUNDS) {
      const rec = c.backgrounds[id];
      expect(rec.abilityBoosts, `backgrounds/${id}`).toEqual([{ kind: 'choice', options: expect.any(Array) }, { kind: 'free' }]);
      expect(rec.abilityBoosts[0].options, `backgrounds/${id}`).toHaveLength(2);
      expect(rec.trainedSkill, `backgrounds/${id}`).toBeTruthy();
      if (NO_FEAT.has(id)) expect(rec.grantedFeatId, `backgrounds/${id}`).toBeUndefined();
      else expect(c.feats[rec.grantedFeatId ?? ''], `backgrounds/${id} names no skill feat the app ships`).toBeTruthy();
    }
  });

  it("picked, a created background's card says what it grants and asks for its boosts (Envoy's Alliance)", async () => {
    const r = openBuilder({ backgroundId: 'envoys-alliance' });
    openLevel(r, '0');
    await settle();
    const text = bodyText();
    const card = document.querySelector('[data-ctl-title="Background"]')?.parentElement;
    const note = card?.querySelector('.sd-choice-note');
    r.stop();
    expect(text).toContain('Trained: Medicine, Scouting Lore');
    expect(text).toContain('Battle Medicine');
    expect(text).toContain('Background boosts');
    // Fully applied: no marker on its card (and the card is really there to have none).
    expect(card).toBeTruthy();
    expect(note).toBeFalsy();
  }, 60_000);

  /*
   * Refuted 2026-09-24: once the created backgrounds took their facets, the marker left all 25 —
   * Azlanti Researcher's card read "Trained: Religion · Student of the Canon" and nothing said that its
   * Azlant Lore and Azlanti language do nothing. A partly applied background says so on its card too.
   */
  /*
   * Batch 038 encodes both halves (azlanti-researcher#language: AoN background-654 "Add Azlanti to your
   * list of known languages."; azlanti-researcher#lore: its Azlant Lore), and the close stage then
   * regenerates the ledger without its `partly` entry. So the card follows the SHIPPED ledger, as the
   * picker test above does: the line while it is partly applied, no line once it is not. Any other
   * background still on `partly` keeps the card wording pinned after Azlanti Researcher leaves.
   */
  // batch 038: azlanti-researcher#language
  it("picked, a partly applied background's card says what is not applied (azlanti-researcher, and one still partly applied)", async () => {
    const partlyMap = (LEDGER as { partly?: Record<string, string> }).partly ?? {};
    const other = Object.keys(partlyMap).map((k) => k.replace(/^backgrounds\//, '')).find((id) => id !== 'azlanti-researcher');
    for (const id of ['azlanti-researcher', ...(other ? [other] : [])]) {
      const r = openBuilder({ backgroundId: id });
      openLevel(r, '0');
      await settle();
      const note = document.querySelector('[data-ctl-title="Background"]')?.parentElement?.querySelector('.sd-choice-note')?.textContent ?? '';
      r.stop();
      const partly = partlyMap[`backgrounds/${id}`];
      // batch 038: azlanti-researcher#language
      expect(note, id).toBe(partly ? `Not yet verified — shown, partly applied. Not applied: ${partly}.` : '');
    }
  }, 60_000);

  // batch 038: defensive-automaton#toughness
  // batch 038: newly-minted-automaton#lore
  it('the created heritages are rows of an automaton\'s Heritage picker, open on their own page and say nothing applies yet while the ledger lists them (defensive-automaton, newly-minted-automaton)', async () => {
    const c = db();
    const r = openBuilder();
    openLevel(r, '0');
    for (const id of HERITAGES) {
      const rec = c.heritages[id];
      const rows = await openPicker(r, 'Heritage');
      const row = rows.find((x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === rec.name);
      expect(row, `heritages/${id} "${rec.name}" is not in the Heritage picker`).toBeTruthy();
      r.click(row!.querySelector('.pick-body'));
      await settle();
      expect(bodyText(), `heritages/${id} popup`).toContain(prose(rec.description));
      const popupNote = document.querySelector('.sd-choice-note')?.textContent ?? '';
      // batch 038: defensive-automaton#toughness
      // batch 038: newly-minted-automaton#lore
      // Both leave the ledger's `unencoded` once their batch-038 rows land and the close stage regenerates
      // it: the "nothing applies" line then goes, following the SHIPPED ledger like the backgrounds above.
      if (UNENCODED.has(`heritages/${id}`)) expect(popupNote, `heritages/${id} popup`).toContain(NOTE);
      else expect(popupNote, `heritages/${id} popup`).not.toContain(NOTHING_APPLIED);
      r.click(document.querySelector('.ast-modal .picker-close, .info-modal .picker-close'));
      await settle();
      r.click(document.querySelector('.picker-overlay .picker-close'));
      await settle();
    }
    r.stop();
  }, 60_000);

  // batch 038: defensive-automaton#toughness
  // batch 038: newly-minted-automaton#lore
  it('picked, a created heritage says so on its card, not only inside its popup, while the ledger lists it (defensive-automaton, newly-minted-automaton)', async () => {
    for (const id of HERITAGES) {
      const r = openBuilder({ heritageId: id });
      openLevel(r, '0');
      await settle();
      const ctl = document.querySelector('[data-ctl-title="Heritage"]');
      const note = ctl?.parentElement?.querySelector('.sd-choice-note')?.textContent ?? '';
      r.stop();
      // batch 038: defensive-automaton#toughness (AoN heritage-438 "You also gain the Toughness feat.")
      // and newly-minted-automaton#lore encode them, so after the close stage's ledger regen the card
      // no longer says nothing applies.
      if (UNENCODED.has(`heritages/${id}`)) expect(note, id).toContain(NOTE);
      else expect(note, id).not.toContain(NOTHING_APPLIED);
    }
  }, 60_000);
});

describe('a created record never shows the OTHER record of its name', () => {
  /** The first sentence of a record's own printed text, as its popup renders it. */
  const own = (bucket: 'feats' | 'items', id: string) => prose(db()[bucket][id].description).slice(0, 40);

  it('the picker row of every created feat opens its own page', async () => {
    const c = db();
    for (const id of FEATS) {
      const node = descNodeOf(c.feats[id], 'feats');
      expect(node?.slug, `feats/${id}`).toBe(id);
      const r = renderDom(createElement(DescriptionModal, { root: node!, onClose: noop }));
      await settle();
      expect(bodyText(), `feats/${id} popup`).toContain(own('feats', id));
      r.stop();
    }
    // The case the refuter opened: the Impossible Magic Zombie Horde, never the Clockwork Reanimator feat.
    const r = renderDom(createElement(DescriptionModal, { root: descNodeOf(c.feats['zombie-horde-impossible-magic'], 'feats')!, onClose: noop }));
    await settle();
    expect(bodyText()).toContain('endless torrent of walking corpses');
    expect(bodyText()).not.toContain('Clockwork Reanimator');
    r.stop();
  });

  it("the Builder's filled feat slot opens the picked feat's own page (necromancer, level 6, Zombie Horde)", async () => {
    const r = openBuilder({
      classId: 'necromancer', keyAbility: 'int', level: 6, ancestryId: 'human',
      enabledSources: ['Pathfinder Player Core', 'Pathfinder Impossible Magic'],
      featPicks: { '6:class:0': 'zombie-horde-impossible-magic' },
    });
    openLevel(r, '6');
    const card = [...document.querySelectorAll<HTMLElement>('button.lvl-card[data-ctl-state="picked"]')]
      .find((el) => (el.textContent ?? '').includes('Zombie Horde'));
    expect(card, 'no filled Zombie Horde slot on the level-6 page').toBeTruthy();
    r.click(card!);
    await settle();
    expect(bodyText()).toContain('endless torrent of walking corpses');
    expect(bodyText()).not.toContain('Clockwork Reanimator');
    r.stop();
  }, 60_000);

  it("the sheet's feat detail opens the feat's own page", async () => {
    const c = db();
    const f = c.feats['zombie-horde-impossible-magic'];
    const entry: FeatEntry = {
      key: 'x', name: f.name, level: f.level, traits: f.traits, description: f.description, isFeature: false,
      bucket: 'class', featId: f.id,
    } as FeatEntry;
    const r = renderDom(createElement(ContentContext.Provider, { value: c }, createElement(FeatDetail, { entry, onClose: noop })));
    await settle();
    expect(bodyText()).toContain('endless torrent of walking corpses');
    expect(bodyText()).not.toContain('Clockwork Reanimator');
    r.stop();
  });

  it("Add items: the Travel Guide's Silver (Ingot) opens the Travel Guide page, not GM Core's Silver Ingot", async () => {
    const r = renderDom(createElement(AddItemsModal, { content: db(), currency: { gp: 5000 }, onBuy: noop, onGive: noop, onClose: noop }));
    type(r.host.querySelector<HTMLInputElement>('.fsel-results-search input'), 'silver (ingot)');
    const row = [...r.host.querySelectorAll('.ai-row')].find((x) => (x.querySelector('.ai-name')?.textContent ?? '').trim() === 'Silver (Ingot)');
    expect(row, 'no Silver (Ingot) row').toBeTruthy();
    r.click(row!.querySelector('.ai-info-btn'));
    await settle();
    const popup = (document.querySelector('.ast-modal')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(popup).toContain('Travel Guide');
    expect(popup).not.toContain('GM Core');
    r.stop();
  });
});

describe('a player can reach and find what was created or reprinted', () => {
  it('every created record sits on a shelf the Sources card shows', () => {
    const c = db() as unknown as Record<string, Record<string, { source?: { book?: string } }>>;
    for (const [bucket, m] of Object.entries(created)) {
      for (const id of Object.keys(m)) {
        const book = c[bucket][id].source?.book ?? '';
        expect(NICHE_CATEGORIES.has(categoryOfBook(book)), `${bucket}/${id} (${book}) is on a hidden shelf`).toBe(false);
      }
    }
    // The six the refuter could not reach with every shown shelf on.
    expect(categoryOfBook("Pathfinder The Dead God's Hand")).toBe('Adventure Paths');
  });

  it('Add items: the Core Rulebook name "Flame Tongue" finds its GM Core reprint, Searing Blade', () => {
    expect(db().items['searing-blade'].legacyNames).toEqual(['Flame Tongue']);
    const r = renderDom(createElement(AddItemsModal, { content: db(), currency: { gp: 5000 }, onBuy: noop, onGive: noop, onClose: noop }));
    type(r.host.querySelector<HTMLInputElement>('.fsel-results-search input'), 'flame tongue');
    const names = [...r.host.querySelectorAll('.ai-name')].map((n) => (n.textContent ?? '').trim());
    r.stop();
    expect(names).toContain('Searing Blade');
    expect(names).toContain('Searing Blade (Greater)');
  });

  it('Setup → Sources: a book inside a bundle is found by its own name ("Clockwork", "Hell\'s Destiny")', async () => {
    for (const [q, bundle] of [['Clockwork', 'Pathfinder Society'], ["Hell's Destiny", '']] as const) {
      const r = openBuilder();
      openLevel(r, 'Setup');
      type(r.host.querySelector<HTMLInputElement>('.src-search input'), q);
      await settle();
      const text = r.host.textContent ?? '';
      const rows = [...r.host.querySelectorAll('.src-book-name')].map((n) => (n.textContent ?? '').trim());
      r.stop();
      expect(text, q).not.toContain('No books match');
      expect(rows.length, q).toBeGreaterThan(0);
      if (bundle) expect(rows.some((n) => n.includes(bundle)), `${q}: ${rows.join(' | ')}`).toBe(true);
    }
  }, 60_000);
});

describe('a created record says that none of its rules apply yet', () => {
  /*
   * Batch 038 encodes four created records, each through one field the ledger's CREATED_CONTENT does not
   * list, so the close stage's regen drops them from `unencoded` (scripts/trust-ledger.mjs, the
   * `unencoded` loop). Only these four may leave, and only once their shipped record carries that field;
   * every other created record stays listed and marked.
   */
  // batch 038: zombie-horde-impossible-magic
  // batch 038: defensive-automaton#toughness
  // batch 038: newly-minted-automaton#lore
  // batch 038: lamentation-of-sinister-deals#avatar
  // batch 039: magus#volatile-spark-reloading-cascade
  it('the ledger names every created heritage, feat and class option not yet encoded (zombie-horde-impossible-magic, defensive-automaton, newly-minted-automaton, lamentation-of-sinister-deals leave in batch 038; the magus hybrid study volatile-spark in batch 039), and the marker shows for each', () => {
    const c = db();
    const unencoded = new Set((LEDGER as { unencoded?: string[] }).unencoded ?? []);
    const has = (bucket: string, id: string, field: string) => !!(c as unknown as Record<string, Record<string, Record<string, unknown>>>)[bucket]?.[id]?.[field];
    /** What each of the four carries once encoded — the reason it may leave `unencoded`. */
    const ENCODED_038: Record<string, () => boolean> = {
      // AoN feat-9122 "You learn the zombie horde grave spell"
      'feats/zombie-horde-impossible-magic': () => has('feats', 'zombie-horde-impossible-magic', 'focusSpells'),
      // AoN heritage-438 "You also gain the Toughness feat."
      'heritages/defensive-automaton': () => has('heritages', 'defensive-automaton', 'grantsFeats'),
      // Its Additional Lore is the EXTRA_FEAT_TAKINGS entry (on the ledger's grant registry, so it leaves at
      // the next regen by itself); its language is the data-rows family's languageChoices row.
      'heritages/newly-minted-automaton': () => !!EXTRA_FEAT_TAKINGS['newly-minted-automaton'] || has('heritages', 'newly-minted-automaton', 'languageChoices'),
      // its avatar note (data-rows family)
      'classFeatures/lamentation-of-sinister-deals': () => has('classFeatures', 'lamentation-of-sinister-deals', 'spellNotes'),
      // batch 039: magus#volatile-spark-reloading-cascade — AoN hybrid-study-16 "In addition, you gain the
      // Reloading Cascade action": the created study now carries grantsActions ['reloading-cascade'].
      'classFeatures/volatile-spark': () => has('classFeatures', 'volatile-spark', 'grantsActions'),
    };
    // A created background carries its boosts, skills and feat, so it is not "nothing encoded".
    for (const id of BACKGROUNDS) expect(unencoded.has(`backgrounds/${id}`), `backgrounds/${id}`).toBe(false);
    // batch 038: newly-minted-automaton#lore
    for (const bucket of ['heritages', 'feats', 'classFeatures']) {
      for (const id of Object.keys(created[bucket] ?? {})) {
        // batch 038: zombie-horde-impossible-magic
        // batch 038: defensive-automaton#toughness — the two removed pins (every created record listed and
        // marked) are now the listed/marked branch below plus the ENCODED_038 branch for the four.
        const key = `${bucket}/${id}`;
        const r = renderDom(createElement(TrustMarker, { bucket, id }));
        const text = r.host.textContent ?? '';
        r.stop();
        // batch 038: zombie-horde-impossible-magic — still listed until its row lands and the ledger regenerates.
        if (unencoded.has(key)) {
          expect(text, key).toContain(NOTE);
          continue;
        }
        // batch 038: zombie-horde-impossible-magic
        // batch 038: defensive-automaton#toughness
        // batch 038: newly-minted-automaton#lore
        // batch 038: lamentation-of-sinister-deals#avatar
        expect(ENCODED_038[key], `${key} is not in the ledger's unencoded list`).toBeTruthy();
        expect(ENCODED_038[key](), `${key} left \`unencoded\` without its batch-038 encoding`).toBe(true);
        expect(text, key).not.toContain(NOTHING_APPLIED);
      }
    }
  });

  /*
   * Refuted 2026-09-24: a created feat picked into a Builder feat slot showed only its name on the
   * filled card — the line was in its popup and on the sheet, not where the pick was spent. The slot
   * card carries it now, as the heritage card does. Both cases the refuter took: Remote Detonation in
   * a runesmith's level-1 class slot, Practical Magic in a level-6 free-archetype slot.
   */
  it('a created feat in a filled Builder feat slot says so on the slot card', async () => {
    const c = db();
    const at = (lvl: number, classId: string, cat: string) =>
      levelGrants(lvl, classId, c, null, { freeArchetype: true }).featSlots.indexOf(cat as never);
    const cases = [
      {
        name: 'Remote Detonation', level: 1,
        over: { classId: 'runesmith', keyAbility: c.classes.runesmith.keyAbility?.[0] ?? 'str', featPicks: { [`1:class:${at(1, 'runesmith', 'class')}`]: 'remote-detonation-impossible-magic' } },
      },
      {
        name: 'Practical Magic', level: 6,
        over: { classId: 'wizard', keyAbility: 'int', featPicks: {
          [`2:archetype:${at(2, 'wizard', 'archetype')}`]: 'hedge-mage-dedication',
          [`6:archetype:${at(6, 'wizard', 'archetype')}`]: 'practical-magic-impossible-magic',
        } },
      },
    ];
    for (const { name, level, over } of cases) {
      const r = openBuilder({
        ...over, level, ancestryId: 'human', variantRules: { freeArchetype: true },
        enabledSources: ['Pathfinder Player Core', 'Pathfinder Impossible Magic'],
      } as Partial<BuildState>);
      openLevel(r, String(level));
      await settle();
      const wrap = [...document.querySelectorAll<HTMLElement>('.lvl-slot-wrap')]
        .find((w) => (w.querySelector('button.lvl-card[data-ctl-state="picked"]')?.textContent ?? '').includes(name));
      const note = wrap?.querySelector('.sd-choice-note')?.textContent ?? '';
      r.stop();
      expect(wrap, `no filled ${name} slot on the level-${level} page`).toBeTruthy();
      expect(note, name).toBe('Not yet verified — shown, not applied');
    }
  }, 60_000);

  it("the created records' text is the page's prose: no page header left in it", () => {
    const c = db() as unknown as Record<string, Record<string, { name: string; description?: string }>>;
    for (const [bucket, m] of Object.entries(created)) {
      for (const id of Object.keys(m)) {
        const d = c[bucket][id].description ?? '';
        expect(d.length, `${bucket}/${id}`).toBeGreaterThan(5);
        expect(d, `${bucket}/${id} still opens with its page header`).not.toMatch(/^[^\n]*\n?\s*Source [^\n]*pg\. \d+/);
        expect(d.startsWith(c[bucket][id].name), `${bucket}/${id} opens with its own name`).toBe(false);
      }
    }
  });
});

/*
 * Refuted 2026-09-24: the export lags the live page. Volatile Spark and Lamentation of Sinister Deals
 * shipped common (their pages print Uncommon); three repointed records kept the edition of the page they
 * used to carry, and Stone Blood took the export's "neutral" over its page's Legacy Content banner, so
 * "Hide legacy data" kept the Fall of Plaguestone Refugee and the Faerie Dragon's Breath Weapon.
 */
describe('a created or repointed record says what its live page says', () => {
  it('every created record agrees with its live read: name, level, rarity and edition', () => {
    const c = db() as unknown as Record<string, Record<string, { name: string; level?: number; rarity?: string; edition?: string }>>;
    const live = loadLivePages() as Record<string, { name: string; level: number | null; rarity: string; legacy: boolean }>;
    for (const [bucket, m] of Object.entries(created)) {
      for (const [id, { doc }] of Object.entries(m)) {
        const rec = c[bucket][id];
        const read = live[doc];
        expect(read, `${bucket}/${id}: its page ${doc} was never read`).toBeTruthy();
        expect(sameName(rec.name, read.name), `${bucket}/${id} name`).toBe(true);
        expect(rec.rarity, `${bucket}/${id} rarity`).toBe(read.rarity);
        if (read.level != null) expect(rec.level, `${bucket}/${id} level`).toBe(read.level);
        expect(['legacy', 'legacy-era'].includes(String(rec.edition)), `${bucket}/${id} edition ${rec.edition}`).toBe(read.legacy);
      }
    }
    expect(c.classFeatures['volatile-spark'].rarity).toBe('uncommon');
    expect(c.classFeatures['lamentation-of-sinister-deals'].rarity).toBe('uncommon');
    expect(c.items['silver-ingot-travel-guide'].edition).toBe('legacy-era');
  });

  it("the five repointed records carry their own page's edition, as the live page prints it", () => {
    const c = db();
    expect(c.backgrounds['refugee-fall-of-plaguestone'].edition).toBe('legacy-era');
    expect(c.feats['stone-blood-stonebound'].edition).toBe('legacy-era');
    expect(c.feats['play-to-the-crowd-dandy'].edition).toBe('neutral');
    expect(c.familiarAbilities['breath-weapon'].edition).toBe('legacy-era');
    expect(c.classFeatures['deity-champion'].edition).toBe('remaster');
    expect(liveEdition('neutral', { legacy: true })).toBe('legacy-era');
    expect(liveEdition('remaster', { legacy: false })).toBe('remaster');
    expect(liveEdition('legacy-era', { legacy: false })).toBe('neutral');
  });
});

/*
 * Refuted 2026-09-24: in Campaigns → a table → Search, "Flame Tongue" found nothing (only the pickers
 * read `legacyNames`), and same-named feats were identical "Zombie Horde · FEATS" rows, the Kingmaker
 * Practical Magic twice over (its `aon-` copy, which the pickers hide).
 */
describe('the GM search finds what the pickers find, and tells same-named rows apart', () => {
  async function search(q: string) {
    const records = hostSearchRecords(db());
    const r = renderDom(createElement(HostSearchProvider, { value: { records, open: noop } }, createElement(GlobalSearch, { onClose: noop })));
    type(r.host.querySelector<HTMLInputElement>('input'), q);
    await settle();
    const rows = [...r.host.querySelectorAll('[data-row]')].map((row) => {
      const title = row.firstElementChild as HTMLElement;
      const detail = (title.querySelector('span')?.textContent ?? '').trim();
      return { name: (title.textContent ?? '').replace(detail, '').trim(), detail, kind: (row.lastElementChild?.textContent ?? '').trim().toLowerCase() };
    });
    r.stop();
    return rows;
  }

  it('the Core Rulebook name "Flame Tongue" finds Searing Blade', async () => {
    expect((await search('Flame Tongue')).map((x) => x.name)).toContain('Searing Blade');
  });

  it('two feats of one name read differently, and a hidden duplicate scrape is no second row', async () => {
    for (const q of ['Zombie Horde', 'Keep Pace', 'Remote Detonation', 'Practical Magic']) {
      const feats = (await search(q)).filter((x) => x.kind === 'feats' && x.name === q);
      expect(feats.length, q).toBeGreaterThanOrEqual(2);
      expect(new Set(feats.map((x) => x.detail)).size, `${q}: ${JSON.stringify(feats)}`).toBe(feats.length);
    }
    // The Kingmaker feat once (`aon-practical-magic` hidden) and the Impossible Magic one.
    expect((await search('Practical Magic')).filter((x) => x.kind === 'feats' && x.name === 'Practical Magic')).toHaveLength(2);
  });

  /* Refuted 2026-09-24: the detail line cut "Pathfinder " off every book, so the 13 Clockwork Mystery
   * backgrounds read "Society Clockwork Mystery Player's Guide", a book that does not exist. */
  it("the detail line prints the book's real title", async () => {
    const row = (await search("Envoy's Alliance")).find((x) => x.name === "Envoy's Alliance");
    expect(row?.detail).toBe("Pathfinder Society Clockwork Mystery Player's Guide");
    const detail = (id: string) => hostSearchRecords(db()).find((x) => x.bucket === 'feats' && x.id === id)?.detail;
    expect(detail('remote-detonation-impossible-magic')).toBe('Level 1 · Pathfinder Impossible Magic');
  });
});

/** Type into a React-controlled input the way a player does (native setter + input event). */
function type(input: HTMLInputElement | null, text: string) {
  if (!input) throw new Error('search input not found');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
