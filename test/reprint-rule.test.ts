import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildReprintMap, newestPrinting, repointDoc, shippedTwin, slugify, whyUnpaired } from '../scripts/lib/reprint.mjs';

/**
 * WHY THIS FILE EXISTS.
 *
 * scripts/lib/reprint.mjs is THE rule behind gold-set R12 ("the newest printing wins, whole"): it
 * decides, for every record that carries an aonId, which Archives document the record, its facets and
 * its description page are built from. Three call sites read it — scripts/import-core-v2.mjs (the join
 * and the AST writer), scripts/migration/build-map.mjs (so stamp-aonid.mjs stamps the same document)
 * and scripts/reprint-check.mjs (the verify-time guard) — and all three run only inside `npm run data`
 * or `npm run verify`, against a 45,500-document export this suite must not load. So the rule itself
 * is pinned here, on synthetic documents, where every branch is cheap and exact.
 *
 * The real-data half is scripts/reprint-check.mjs in `npm run verify`.
 *
 * NOT covered here, deliberately:
 *   • EXCEPTION 1, the overlay `aonId` ruling. It is not in the lib — repointDoc() takes no pin
 *     argument — because only a caller knows about the pin; the pinned set is built from
 *     scripts/data/effect-backfill.json by build-map.mjs (`AON_PINNED`) and by reprint-check.mjs
 *     (`pinned`). The one assertion practical from here is that both readers still agree on what a pin
 *     IS; that is the last `it()` below. There are 0 pinned records today, so there is nothing in
 *     public/core.json to assert against.
 *   • `caseOnlyRename` in scripts/import-core-v2.mjs. It is a module-local const in a script whose
 *     top level RUNS the whole import (it reads the export and writes public/core.json on import), so
 *     it cannot be imported from a test, and exporting it would mean restructuring the importer for a
 *     test's benefit. Left where it is; its effect is pinned instead by the 28 `name` rows in
 *     scripts/data/effect-backfill.json, which assert the shipped spellings directly.
 */

/* `url` and `data.class` are here for the class hop: AoN expresses "the features of class-17" as
 * every feature carrying that class page's url, and names the class in `data.class`. */
type Doc = { id: string; category: string; name?: string; edition?: string; release_date?: string; url?: string; data?: { legacy_id?: string[]; remaster_id?: string[]; class?: string } };

const doc = (id: string, category: string, extra: Partial<Doc> = {}): [string, Doc] =>
  [id, { id, category, name: extra.name ?? id, edition: extra.edition ?? 'legacy', release_date: extra.release_date ?? '2020-01-01', url: extra.url, data: extra.data ?? {} }];

/** The reprint names what it replaces — the direction action-4260 uses (`legacy_id: ['action-755']`). */
const reprintOf = (id: string, category: string, replaces: string[], release_date: string, name?: string) =>
  doc(id, category, { data: { legacy_id: replaces }, release_date, name });

const never = () => false;

describe('reprint.mjs — the newest printing wins', () => {
  it('follows a single hop stated by the reprint (legacy_id)', () => {
    const index = buildReprintMap([doc('a-1', 'action'), reprintOf('a-2', 'action', ['a-1'], '2026-07-30')]);
    expect(newestPrinting(index, 'a-1')).toBe('a-2');
    expect(repointDoc(index, 'a-1', 'thing', never)).toBe('a-2');
  });

  it('follows a single hop stated by the REPLACED document (remaster_id)', () => {
    const index = buildReprintMap([
      doc('s-1', 'spell', { data: { remaster_id: ['s-2'] } }),
      doc('s-2', 'spell', { release_date: '2023-11-15' }),
    ]);
    expect(newestPrinting(index, 's-1')).toBe('s-2');
  });

  it('walks a two-hop chain to the end', () => {
    const index = buildReprintMap([
      doc('f-1', 'feat'),
      reprintOf('f-2', 'feat', ['f-1'], '2023-11-15'),
      reprintOf('f-3', 'feat', ['f-2'], '2026-07-30'),
    ]);
    expect(newestPrinting(index, 'f-1')).toBe('f-3');
    expect(newestPrinting(index, 'f-2')).toBe('f-3');
    expect(newestPrinting(index, 'f-3')).toBeNull();
  });

  it('lets release_date, not insertion order, decide a three-way link', () => {
    const entries = [
      doc('e-1', 'equipment'),
      reprintOf('e-3', 'equipment', ['e-1'], '2026-02-04'), // newest, offered FIRST
      reprintOf('e-2', 'equipment', ['e-1'], '2023-11-15'),
    ];
    expect(newestPrinting(buildReprintMap(entries), 'e-1')).toBe('e-3');
    expect(newestPrinting(buildReprintMap([...entries].reverse()), 'e-1')).toBe('e-3');
  });

  it('terminates on a cycle instead of looping', () => {
    const index = buildReprintMap([
      doc('c-1', 'ritual', { data: { remaster_id: ['c-2'] }, release_date: '2021-01-01' }),
      doc('c-2', 'ritual', { data: { remaster_id: ['c-1'] }, release_date: '2026-01-01' }),
    ]);
    // The walk stops at the first id it has already seen; what matters is that it returns at all.
    expect(newestPrinting(index, 'c-1')).toBe('c-2');
    expect(['c-1', null]).toContain(newestPrinting(index, 'c-2'));
  });

  it('caps a long chain instead of walking for ever', () => {
    const entries = [doc('h-0', 'feat')];
    for (let i = 1; i <= 12; i++) entries.push(reprintOf(`h-${i}`, 'feat', [`h-${i - 1}`], `20${10 + i}-01-01`));
    // 8 hops from h-0 is h-8: the cap holds, and it never runs away to h-12.
    expect(newestPrinting(buildReprintMap(entries), 'h-0')).toBe('h-8');
  });

  it('ignores a link that crosses categories', () => {
    const index = buildReprintMap([
      doc('x-1', 'spell'),
      reprintOf('x-2', 'equipment', ['x-1'], '2026-07-30'),
    ]);
    expect(newestPrinting(index, 'x-1')).toBeNull();
    expect(repointDoc(index, 'x-1', 'thing', never)).toBeNull();
  });

  it('ignores a link to a document the export does not hold', () => {
    // feat-11 really does carry `remaster_id: ["0"]` in the export; there is no document "0".
    const index = buildReprintMap([doc('g-1', 'feat', { data: { remaster_id: ['0'] } })]);
    expect(newestPrinting(index, 'g-1')).toBeNull();
  });

  it('EXCEPTION 2: does not follow a reprint whose slug already ships as its own record', () => {
    const index = buildReprintMap([
      doc('t-1', 'spell', { name: 'Acid Splash' }),
      reprintOf('t-2', 'spell', ['t-1'], '2023-11-15', 'Caustic Blast'),
    ]);
    const ships = (k: string) => k === 'caustic-blast';
    expect(repointDoc(index, 't-1', 'acid-splash', ships)).toBeNull();
    // …and the same pair repoints for a bucket that does NOT already ship the reprint.
    expect(repointDoc(index, 't-1', 'acid-splash', never)).toBe('t-2');
  });

  it('EXCEPTION 2 does not fire when the reprint keeps the record OWN slug', () => {
    const index = buildReprintMap([
      doc('u-1', 'action', { name: 'Spellstrike' }),
      reprintOf('u-2', 'action', ['u-1'], '2026-07-30', 'Spellstrike'),
    ]);
    // hasKey is true for `spellstrike` — it is this very record. Blocking here would freeze every
    // record that kept its name, which is nearly all 384 of them.
    expect(repointDoc(index, 'u-1', 'spellstrike', (k) => k === 'spellstrike')).toBe('u-2');
  });

  it('leaves a document with no reprint alone (legacy content that was never reprinted)', () => {
    const index = buildReprintMap([doc('l-1', 'equipment'), doc('l-2', 'equipment')]);
    expect(newestPrinting(index, 'l-1')).toBeNull();
    expect(repointDoc(index, 'l-1', 'anything', never)).toBeNull();
    expect(repointDoc(index, '', 'anything', never)).toBeNull();
  });

  it('slugify matches the record keys the exception is tested against', () => {
    expect(slugify("The World's a Stage")).toBe('the-worlds-a-stage');
    expect(slugify('Five-Feather Wreath')).toBe('five-feather-wreath');
  });

  /*
   * desk 158/160/161/152: shippedTwin
   *
   * The owner ruled exception 2 on 2026-09-12 — "keep both, mark the old one legacy, add a
   * 'remastered as …' link" — so the case now needs a NAME, shared by the stamp
   * (build-map.mjs -> stamp-aonid.mjs) and the guard (reprint-check.mjs). Spelling it twice is how the
   * two drift apart and the guard starts asserting something the stamp never writes.
   */
  describe('shippedTwin — exception 2, named for the stamp and the guard to share', () => {
    const acidSplash = () =>
      buildReprintMap([
        doc('t-1', 'spell', { name: 'Acid Splash' }),
        reprintOf('t-2', 'spell', ['t-1'], '2023-11-15', 'Caustic Blast'),
      ]);
    const ships = (k: string) => k === 'caustic-blast';

    it('names the reprint record the old page should link to', () => {
      expect(shippedTwin(acidSplash(), 't-1', 'acid-splash', ships)).toEqual({
        id: 'caustic-blast',
        name: 'Caustic Blast',
        docId: 't-2',
      });
    });

    it('is null exactly where repointDoc DOES repoint — the two cases cannot both fire', () => {
      const index = acidSplash();
      // nothing ships as caustic-blast: the record takes the reprint, so there is no twin to link to
      expect(repointDoc(index, 't-1', 'acid-splash', never)).toBe('t-2');
      expect(shippedTwin(index, 't-1', 'acid-splash', never)).toBeNull();
    });

    it('is null when the reprint kept the record\'s own slug (Spellstrike)', () => {
      const index = buildReprintMap([
        doc('u-1', 'action', { name: 'Spellstrike' }),
        reprintOf('u-2', 'action', ['u-1'], '2026-07-30', 'Spellstrike'),
      ]);
      expect(shippedTwin(index, 'u-1', 'spellstrike', (k) => k === 'spellstrike')).toBeNull();
    });

    it('is null for a document with no reprint at all (legacy content nobody reprinted)', () => {
      const index = buildReprintMap([doc('l-1', 'equipment'), doc('l-2', 'equipment')]);
      expect(shippedTwin(index, 'l-1', 'anything', never)).toBeNull();
      expect(shippedTwin(index, '', 'anything', never)).toBeNull();
    });

    /*
     * THE ONE RECORD THIS EXCLUDES, and the reason the edition is read at all. Measured over the
     * shipped artefact on 2026-09-12: 182 records take exception 2 and 181 sit on a legacy document.
     * The odd one is items/rounds-dragon-mouth-pistol, whose own document (weapon-200) is itself a
     * `remaster` printing carrying an Archives link to the pistol's page. Marking that legacy would
     * hide CURRENT content from a remaster-only character — the exact harm edition-drift-check.mjs
     * exists to prevent — so a record already on a current printing is never marked.
     */
    it('refuses to call a CURRENT printing the old page', () => {
      const index = buildReprintMap([
        doc('w-200', 'weapon', { name: 'Rounds, Dragon-Mouth Pistol', edition: 'remaster' }),
        reprintOf('w-519', 'weapon', ['w-200'], '2026-07-30', 'Dragon-Mouth Pistol'),
      ]);
      const shipsPistol = (k: string) => k === 'dragon-mouth-pistol';
      // repointDoc still blocks (the twin ships), so the record keeps its own page …
      expect(repointDoc(index, 'w-200', 'rounds-dragon-mouth-pistol', shipsPistol)).toBeNull();
      // … but it is not marked legacy and carries no link.
      expect(shippedTwin(index, 'w-200', 'rounds-dragon-mouth-pistol', shipsPistol)).toBeNull();
    });
  });

  /*
   * THE CLASS HOP (owner, 2026-09-23). AoN links a reprinted class feature to the legacy CLASS page,
   * never to the feature it replaces: class-feature-1258 "Magus Spellcasting" says
   * legacy_id: ['class-17']. The shapes below are that data, shrunk — a legacy class with three
   * features, a reprint class with the same three, and every feature naming the legacy CLASS.
   */
  describe('the class hop', () => {
    const cls = (id: string, name: string, url: string, extra: Partial<Doc> = {}) =>
      doc(id, 'class', { name, url, ...extra });
    const feat = (id: string, name: string, url: string, extra: Partial<Doc> = {}) =>
      doc(id, 'class-feature', { name, url, ...extra });

    /** Legacy class c-17 with Spellstrike / Weapon Expertise / Alertness, reprinted as c-74. */
    const magus = () => buildReprintMap([
      cls('c-17', 'Magus', '/Classes.aspx?ID=17'),
      cls('c-74', 'Magus', '/Classes.aspx?ID=74', { release_date: '2026-07-30' }),
      feat('cf-419', 'Spellstrike', '/Classes.aspx?ID=17', { data: { class: 'Magus' } }),
      feat('cf-430', 'Weapon Expertise', '/Classes.aspx?ID=17', { data: { class: 'Magus' } }),
      feat('cf-433', 'Alertness', '/Classes.aspx?ID=17', { data: { class: 'Magus' } }),
      feat('cf-1259', 'Spellstrike', '/Classes.aspx?ID=74', { release_date: '2026-07-30', data: { legacy_id: ['c-17'], class: 'Magus' } }),
      feat('cf-1269', 'Weapon Expertise', '/Classes.aspx?ID=74', { release_date: '2026-07-30', data: { legacy_id: ['c-17'], class: 'Magus' } }),
      feat('cf-1273', 'Perception Expertise', '/Classes.aspx?ID=74', { release_date: '2026-07-30', data: { legacy_id: ['c-17'], class: 'Magus' } }),
    ]);

    it('follows a class-level legacy_id into that class\'s feature of the same name', () => {
      const index = magus();
      expect(newestPrinting(index, 'cf-419')).toBe('cf-1259');
      expect(repointDoc(index, 'cf-419', 'spellstrike', never)).toBe('cf-1259');
    });

    it('marks the pair DERIVED — the documents never stated it', () => {
      const index = magus();
      expect(index.derived.get('cf-419')).toEqual({ name: 'Spellstrike', class: 'Magus' });
      // a link AoN wrote down itself is not derived
      const plain = buildReprintMap([doc('a-1', 'action'), reprintOf('a-2', 'action', ['a-1'], '2026-07-30')]);
      expect(plain.derived.has('a-1')).toBe(false);
    });

    /*
     * THE GUARD THAT MATTERS. classFeatures/weapon-expertise-swashbuckler really does sit on the
     * MAGUS document cf-430 in the shipped artefact. Without this it would follow the magus into
     * Impossible Magic and come back telling a swashbuckler their feature is from a magus book.
     */
    it('refuses a record whose key is another class\'s', () => {
      const index = magus();
      expect(repointDoc(index, 'cf-430', 'weapon-expertise-swashbuckler', never)).toBeNull();
      expect(repointDoc(index, 'cf-430', 'weapon-expertise', never)).toBe('cf-1269');
      expect(repointDoc(index, 'cf-430', 'weapon-expertise-magus', never)).toBe('cf-1269');
    });

    it('does not follow a RENAME — that is a class-table change, not a repoint', () => {
      // Alertness -> Perception Expertise share a level and a class but not a name, and the legacy
      // slug is shared by a dozen other classes, so nothing is offered.
      const index = magus();
      expect(newestPrinting(index, 'cf-433')).toBeNull();
      expect(index.derived.has('cf-433')).toBe(false);
    });

    it('does not apply the shipped-twin exception to a derived pair', () => {
      // `signature-spells` ships as another class's record; the summoner's own feature must still
      // move, and must NOT be marked legacy and pointed at that stranger.
      const index = buildReprintMap([
        cls('c-18', 'Summoner', '/Classes.aspx?ID=18'),
        cls('c-77', 'Summoner', '/Classes.aspx?ID=77', { release_date: '2026-07-30' }),
        feat('cf-447', 'Spell Repertoire', '/Classes.aspx?ID=18', { data: { class: 'Summoner' } }),
        feat('cf-1339', 'Spell Repertoire', '/Classes.aspx?ID=77', { release_date: '2026-07-30', data: { legacy_id: ['c-18'], class: 'Summoner' } }),
      ]);
      const shipsIt = (k: string) => k === 'spell-repertoire';
      expect(repointDoc(index, 'cf-447', 'spell-repertoire-summoner', shipsIt)).toBe('cf-1339');
      expect(shippedTwin(index, 'cf-447', 'spell-repertoire-summoner', shipsIt)).toBeNull();
      // and the OTHER classes' copies of that same document are still refused
      expect(repointDoc(index, 'cf-447', 'spell-repertoire-bard', shipsIt)).toBeNull();
    });

    it('refuses when the name does not identify exactly one feature of that class', () => {
      const index = buildReprintMap([
        cls('c-9', 'Ranger', '/Classes.aspx?ID=9'),
        feat('cf-a', 'Trackless Step', '/Classes.aspx?ID=9'),
        feat('cf-b', 'Trackless Step', '/Classes.aspx?ID=9'),
        feat('cf-c', 'Trackless Step', '/Classes.aspx?ID=99', { release_date: '2026-07-30', data: { legacy_id: ['c-9'] } }),
      ]);
      expect(newestPrinting(index, 'cf-a')).toBeNull();
      expect(newestPrinting(index, 'cf-b')).toBeNull();
    });

    it('never hops backwards in time', () => {
      const index = buildReprintMap([
        cls('c-17', 'Magus', '/Classes.aspx?ID=17', { release_date: '2026-07-30' }),
        feat('cf-new', 'Spellstrike', '/Classes.aspx?ID=17', { release_date: '2026-07-30' }),
        feat('cf-old', 'Spellstrike', '/Classes.aspx?ID=74', { release_date: '2021-01-01', data: { legacy_id: ['c-17'] } }),
      ]);
      expect(newestPrinting(index, 'cf-new')).toBeNull();
    });
  });

  /*
   * NAME-PAIRED CATEGORIES. `hybrid-study` carries no legacy_id or remaster_id anywhere in the
   * corpus, so there is no link to follow; it is a closed per-class option set where a repeated name
   * is always a reprint. Only categories on that list are paired this way.
   */
  describe('name-paired categories', () => {
    it('pairs a hybrid study with its newest printing', () => {
      const index = buildReprintMap([
        doc('hybrid-study-2', 'hybrid-study', { name: 'Laughing Shadow' }),
        doc('hybrid-study-11', 'hybrid-study', { name: 'Laughing Shadow', release_date: '2026-07-30' }),
      ]);
      expect(newestPrinting(index, 'hybrid-study-2')).toBe('hybrid-study-11');
      expect(repointDoc(index, 'hybrid-study-2', 'laughing-shadow', never)).toBe('hybrid-study-11');
      expect(index.derived.has('hybrid-study-2')).toBe(true);
    });

    it('does NOT pair by name in an ordinary category', () => {
      // two different feats really are both called Zombie Horde — see the header
      const index = buildReprintMap([
        doc('feat-3654', 'feat', { name: 'Zombie Horde' }),
        doc('feat-9122', 'feat', { name: 'Zombie Horde', release_date: '2026-07-30' }),
      ]);
      expect(newestPrinting(index, 'feat-3654')).toBeNull();
    });

    it('refuses a tie rather than picking one', () => {
      const index = buildReprintMap([
        doc('hybrid-study-20', 'hybrid-study', { name: 'Twofold Tine', release_date: '2026-07-30' }),
        doc('hybrid-study-21', 'hybrid-study', { name: 'Twofold Tine', release_date: '2026-07-30' }),
      ]);
      expect(newestPrinting(index, 'hybrid-study-20')).toBeNull();
      expect(newestPrinting(index, 'hybrid-study-21')).toBeNull();
    });
  });

  /*
   * THE SUB-PAGE RULES (reprint lane 2026-09-25; desk #158, #165). The Archives link a bonus line, a
   * grade and a sidebar mostly through their PAGE. The shapes below are the real documents, shrunk:
   * Endless Grimoire (equipment-992 -> equipment-5127) with a base line and a named grade line, Sage's
   * Lash (one line each side), Fulu Compendium (one line becomes four), and the magus page's sidebar.
   */
  describe('the sub-page rules', () => {
    type D2 = Doc & { data?: Doc['data'] & { remaster_name?: string[]; legacy_name?: string[] } };
    const d = (id: string, category: string, name: string, url: string, release_date: string, data: D2['data'] = {}): [string, D2] =>
      [id, { id, category, name, url, release_date, edition: release_date > '2025' ? 'remaster' : 'legacy', data }];
    const OLD = '2021-09-01';
    const NEW = '2026-07-30';
    const grimoire = () => buildReprintMap([
      d('e-992', 'equipment', 'Endless Grimoire', '/E?ID=992', OLD, { remaster_id: ['e-5127'] }),
      d('e-992-945', 'equipment', 'Endless Grimoire', '/E?ID=992', OLD, { remaster_id: ['e-5127'] }),
      d('e-992-946', 'equipment', 'Endless Grimoire (Greater)', '/E?ID=992', OLD, { remaster_id: ['e-5127'], remaster_name: ['Greater Endless Grimoire'] }),
      d('e-992-945-bonus-453', 'item-bonus', 'Endless Grimoire', '/E?ID=992', OLD, { remaster_id: ['e-5127'] }),
      d('e-992-946-bonus-454', 'item-bonus', 'Endless Grimoire (Greater)', '/E?ID=992', OLD, { remaster_id: ['e-5127'], remaster_name: ['Greater Endless Grimoire'] }),
      d('e-5127', 'equipment', 'Endless Grimoire', '/E?ID=5127', NEW, { legacy_id: ['e-992'] }),
      d('e-5127-4603', 'equipment', 'Endless Grimoire', '/E?ID=5127', NEW, { legacy_id: ['e-992'] }),
      d('e-5127-4604', 'equipment', 'Greater Endless Grimoire', '/E?ID=5127', NEW, { legacy_id: ['e-992'], legacy_name: ['Endless Grimoire (Greater)'] }),
      d('e-5127-4603-bonus-1696', 'item-bonus', 'Endless Grimoire', '/E?ID=5127', NEW, { legacy_id: ['e-992'] }),
      d('e-5127-4604-bonus-1697', 'item-bonus', 'Greater Endless Grimoire', '/E?ID=5127', NEW, { legacy_id: ['e-992'], legacy_name: ['Endless Grimoire (Greater)'] }),
    ]);

    it('A: the old grade names its reprint, so it links to that GRADE, not the base page', () => {
      const index = grimoire();
      expect(index.next.get('e-992-946')).toBe('e-5127-4604');
      // the grade ships as its own record: a #158 twin naming the exact grade
      const ships = (k: string) => k === 'greater-endless-grimoire';
      expect(shippedTwin(index, 'e-992-946', 'endless-grimoire-greater', ships)).toEqual({ id: 'greater-endless-grimoire', name: 'Greater Endless Grimoire', docId: 'e-5127-4604' });
      // a named pair is a STATED link: no key guard
      expect(index.derived.has('e-992-946')).toBe(false);
      // …and the bonus line of that grade follows the same statement across the category the link names
      expect(index.next.get('e-992-946-bonus-454')).toBe('e-5127-4604-bonus-1697');
    });

    it('A is refused when the name is ambiguous on the linked page', () => {
      const index = buildReprintMap([
        d('e-1', 'equipment', 'Thing', '/E?ID=1', OLD, { remaster_id: ['e-2'] }),
        d('e-1-1', 'equipment', 'Thing (Greater)', '/E?ID=1', OLD, { remaster_id: ['e-2'], remaster_name: ['Greater Thing'] }),
        d('e-2', 'equipment', 'Thing', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
        d('e-2-1', 'equipment', 'Greater Thing', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
        d('e-2-2', 'equipment', 'Greater Thing', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
      ]);
      expect(index.next.get('e-1-1')).toBe('e-2'); // only the page link AoN states; no grade chosen
    });

    it('B (desk #165): a bonus line pairs with the one line of its title on the reprint page, after A took the named ones', () => {
      const index = grimoire();
      expect(index.next.get('e-992-945-bonus-453')).toBe('e-5127-4603-bonus-1696');
      expect(index.derived.get('e-992-945-bonus-453')).toEqual({ name: 'Endless Grimoire', class: '', sub: true });
      expect(repointDoc(index, 'e-992-945-bonus-453', 'endless-grimoire', (k) => k === 'endless-grimoire')).toBe('e-5127-4603-bonus-1696');
    });

    it('B is the ruled rule — one line WITH THAT TITLE on each page, not one line in all: two differently titled lines both pair', () => {
      // The question he answered: "pair with the reprint page's line of the same title, only when exactly one
      // line on each page has that title". A page with several lines of different titles pairs each of them.
      const index = buildReprintMap([
        d('e-1', 'equipment', 'Mutagen', '/E?ID=1', OLD, { remaster_id: ['e-2'] }),
        d('e-1-1-bonus-1', 'item-bonus', 'Mutagen (Lesser)', '/E?ID=1', OLD, { remaster_id: ['e-2'] }),
        d('e-1-2-bonus-2', 'item-bonus', 'Mutagen (Greater)', '/E?ID=1', OLD, { remaster_id: ['e-2'] }),
        d('e-2', 'equipment', 'Mutagen', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
        d('e-2-1-bonus-7', 'item-bonus', 'Mutagen (Lesser)', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
        d('e-2-2-bonus-8', 'item-bonus', 'Mutagen (Greater)', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
      ]);
      expect(index.next.get('e-1-1-bonus-1')).toBe('e-2-1-bonus-7');
      expect(index.next.get('e-1-2-bonus-2')).toBe('e-2-2-bonus-8');
    });

    it('B refuses one line that became four (Fulu Compendium) and says why', () => {
      const index = buildReprintMap([
        d('e-988', 'equipment', 'Fulu Compendium', '/E?ID=988', OLD, { remaster_id: ['e-5088'] }),
        d('e-988-bonus-451', 'item-bonus', 'Fulu Compendium', '/E?ID=988', OLD, { remaster_id: ['e-5088'] }),
        d('e-5088', 'equipment', 'Fulu Compendium', '/E?ID=5088', NEW, { legacy_id: ['e-988'] }),
        ...[1676, 1677, 1678, 1679].map((k) => d(`e-5088-bonus-${k}`, 'item-bonus', 'Fulu Compendium', '/E?ID=5088', NEW, { legacy_id: ['e-988'] })),
      ]);
      expect(index.next.has('e-988-bonus-451')).toBe(false);
      expect(whyUnpaired(index, 'e-988-bonus-451')).toContain('one line titled "Fulu Compendium" on each page is required (desk #165) — 1 on the old page, 4 on e-5088');
    });

    const magusPage = (extraNew: [string, D2][] = []) => buildReprintMap([
      d('class-17', 'class', 'Magus', '/C?ID=17', OLD, { remaster_id: ['class-74'] }),
      d('class-74', 'class', 'Magus', '/C?ID=74', NEW, { legacy_id: ['class-17'] }),
      d('sidebar-1572', 'sidebar', 'Combining Your Abilities', '/C?ID=17', OLD, { remaster_id: ['class-74'] }),
      d('sidebar-1573', 'sidebar', 'Spellstrike Options', '/C?ID=17', OLD, { remaster_id: ['class-74'] }),
      d('sidebar-3749', 'sidebar', 'Combining your Abilities', '/C?ID=74', NEW, { legacy_id: ['class-17'] }),
      ...extraNew,
    ]);

    it('B (desk #165), a sidebar: it pairs with the one sidebar of its title on the reprint page', () => {
      const index = magusPage();
      expect(index.next.get('sidebar-1572')).toBe('sidebar-3749');
      expect(repointDoc(index, 'sidebar-1572', 'combining-your-abilities', (k) => k === 'combining-your-abilities')).toBe('sidebar-3749');
    });

    it('B refuses a sidebar whose title is not on the reprint page — the sole sidebar is NOT paired', () => {
      // "Spellstrike Options" has no same-titled sidebar on class-74; pairing it with the only other one
      // there would be the rejected sole-sidebar rule (Specific Armor and Weapons -> Upgrading Runes, 0%).
      const index = magusPage();
      expect(index.next.has('sidebar-1573')).toBe(false);
      expect(whyUnpaired(index, 'sidebar-1573')).toContain('one line titled "Spellstrike Options" on each page is required (desk #165) — 1 on the old page, 0 on class-74');
    });

    it('B refuses a tie on the reprint page', () => {
      const index = magusPage([d('sidebar-3750', 'sidebar', 'Combining Your Abilities', '/C?ID=74', NEW, { legacy_id: ['class-17'] })]);
      expect(index.next.has('sidebar-1572')).toBe(false);
    });

    it('the key guard: only the record keyed by the old title follows a sub-page pair', () => {
      const index = magusPage();
      expect(repointDoc(index, 'sidebar-1572', 'some-other-record', never)).toBeNull();
    });

    it('a sub-page pair keeps the ordinary hasKey test: a reprint shipping under another slug is a #158 twin', () => {
      const index = buildReprintMap([
        d('e-1', 'equipment', 'Old Tool', '/E?ID=1', OLD, { remaster_id: ['e-2'] }),
        d('e-1-bonus-1', 'item-bonus', 'Old Tool', '/E?ID=1', OLD, { remaster_id: ['e-2'] }),
        d('e-2', 'equipment', 'Old Tool', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
        d('e-2-bonus-9', 'item-bonus', 'Old Tool', '/E?ID=2', NEW, { legacy_id: ['e-1'] }),
      ]);
      expect(index.next.get('e-1-bonus-1')).toBe('e-2-bonus-9');
      // same title, so the record simply moves; hasKey on its own slug does not block it
      expect(repointDoc(index, 'e-1-bonus-1', 'old-tool', (k) => k === 'old-tool')).toBe('e-2-bonus-9');
    });
  });

  /*
   * RULE C (desk #167, owner 2026-09-25 "yes"): a legacy grade whose link names only the renamed FAMILY pairs
   * with the new family's grade of the same suffix, when exactly one carries it on each side. The fixtures are
   * the two pairs his question named, shrunk from the export (level and price as the Archives print them).
   */
  describe('rule C — a grade linked only to its family pairs by suffix (desk #167)', () => {
    type D3 = Doc & { level?: number; price?: number; data?: Doc['data'] & { remaster_name?: string[]; legacy_name?: string[] } };
    const g = (id: string, name: string, url: string, release_date: string, level: number, price: number | undefined, data: D3['data']): [string, D3] =>
      [id, { id, category: 'equipment', name, url, release_date, level, price, edition: release_date > '2023' ? 'remaster' : 'legacy', data }];
    const OLD = '2019-08-01';
    const NEW = '2023-11-15';
    const cloakOld = { remaster_id: ['equipment-3069'], remaster_name: ['Cloak of Illusions'] };
    const cloakNew = { legacy_id: ['equipment-424'], legacy_name: ['Cloak of Elvenkind'] };
    const bootsOld = { remaster_id: ['equipment-3056'], remaster_name: ['Arboreal Boots'] };
    const bootsNew = { legacy_id: ['equipment-413'], legacy_name: ['Boots of Elvenkind'] };
    const elvenkind = () => buildReprintMap([
      g('equipment-424', 'Cloak of Elvenkind', '/E?ID=424', OLD, 7, undefined, cloakOld),
      g('equipment-424-513', 'Cloak of Elvenkind', '/E?ID=424', OLD, 7, 36000, cloakOld),
      g('equipment-424-514', 'Cloak of Elvenkind (Greater)', '/E?ID=424', OLD, 12, 175000, cloakOld),
      g('equipment-3069', 'Cloak of Illusions', '/E?ID=3069', NEW, 7, undefined, cloakNew),
      g('equipment-3069-3000', 'Cloak of Illusions', '/E?ID=3069', NEW, 7, 36000, cloakNew),
      g('equipment-3069-3001', 'Cloak of Illusions (Greater)', '/E?ID=3069', NEW, 12, 175000, cloakNew),
      g('equipment-413', 'Boots of Elvenkind', '/E?ID=413', OLD, 5, undefined, bootsOld),
      g('equipment-413-502', 'Boots of Elvenkind', '/E?ID=413', OLD, 5, 14500, bootsOld),
      g('equipment-413-503', 'Boots of Elvenkind (Greater)', '/E?ID=413', OLD, 11, 125000, bootsOld),
      g('equipment-3056', 'Arboreal Boots', '/E?ID=3056', NEW, 5, undefined, bootsNew),
      g('equipment-3056-2980', 'Arboreal Boots', '/E?ID=3056', NEW, 5, 16000, bootsNew),
      g('equipment-3056-2981', 'Arboreal Boots (Greater)', '/E?ID=3056', NEW, 9, 70000, bootsNew),
    ]);
    const ships = (...ids: string[]) => (k: string) => ids.includes(k);

    it('the two pairs he named: Cloak of Elvenkind (Greater) -> Cloak of Illusions (Greater), Boots of Elvenkind (Greater) -> Arboreal Boots (Greater)', () => {
      const index = elvenkind();
      expect(index.next.get('equipment-424-514')).toBe('equipment-3069-3001');
      expect(index.next.get('equipment-413-503')).toBe('equipment-3056-2981');
      // both reprints ship as records, so the old grades are #158 twins naming the grade, not the base
      expect(shippedTwin(index, 'equipment-424-514', 'cloak-of-elvenkind-greater', ships('cloak-of-illusions', 'cloak-of-illusions-greater')))
        .toEqual({ id: 'cloak-of-illusions-greater', name: 'Cloak of Illusions (Greater)', docId: 'equipment-3069-3001' });
      expect(shippedTwin(index, 'equipment-413-503', 'boots-of-elvenkind-greater', ships('arboreal-boots', 'arboreal-boots-greater')))
        .toEqual({ id: 'arboreal-boots-greater', name: 'Arboreal Boots (Greater)', docId: 'equipment-3056-2981' });
      // the ungraded base pairs with the ungraded base where the numbers agree
      expect(index.next.get('equipment-424-513')).toBe('equipment-3069-3000');
    });

    it('any other pair whose level or price disagrees is refused and said — the Boots base (145 gp against 160) keeps its family link', () => {
      const index = elvenkind();
      expect(index.next.get('equipment-413-502')).toBe('equipment-3056');
      expect(index.gradeRefused.get('equipment-413-502')).toContain('level|price 5|14500 against 5|16000');
      // the Greater Boots disagree too (Item 11 against 9) and pair only because the owner named them
      expect(index.gradeRefused.has('equipment-413-503')).toBe(false);
    });

    it('refused when the suffix is ambiguous: two "(Greater)" blocks on the new page', () => {
      const index = buildReprintMap([
        g('equipment-1', 'Veil', '/E?ID=1', OLD, 4, undefined, { remaster_id: ['equipment-2'], remaster_name: ['Shroud'] }),
        g('equipment-1-1', 'Veil (Greater)', '/E?ID=1', OLD, 9, 60000, { remaster_id: ['equipment-2'], remaster_name: ['Shroud'] }),
        g('equipment-2', 'Shroud', '/E?ID=2', NEW, 4, undefined, { legacy_id: ['equipment-1'] }),
        g('equipment-2-1', 'Shroud (Greater)', '/E?ID=2', NEW, 9, 60000, { legacy_id: ['equipment-1'] }),
        g('equipment-2-2', 'Shroud (Greater)', '/E?ID=2', NEW, 9, 60000, { legacy_id: ['equipment-1'] }),
      ]);
      expect(index.next.get('equipment-1-1')).toBe('equipment-2');
      expect(index.gradeRefused.get('equipment-1-1')).toContain('"(Greater)": 1 block(s) on the old page, 2 on equipment-2');
    });

    it('a suffix only: a prefix-spelt grade ("Greater Healer\'s Gel", a re-indexed ladder) is never read as one', () => {
      const index = buildReprintMap([
        g('equipment-7', 'Gel', '/E?ID=7', OLD, 5, undefined, { remaster_id: ['equipment-8'] }),
        g('equipment-7-2', 'Gel (Greater)', '/E?ID=7', OLD, 13, 50000, { remaster_id: ['equipment-8'] }),
        g('equipment-8', 'Gel', '/E?ID=8', NEW, 5, undefined, { legacy_id: ['equipment-7'] }),
        g('equipment-8-2', 'Greater Gel', '/E?ID=8', NEW, 9, 12500, { legacy_id: ['equipment-7'] }),
      ]);
      expect(index.next.get('equipment-7-2')).toBe('equipment-8');
    });

    it('rule A wins where the Archives name the grade, and a derived pair keeps the key guard', () => {
      const index = buildReprintMap([
        g('equipment-5', 'Lamp', '/E?ID=5', OLD, 9, undefined, { remaster_id: ['equipment-6'] }),
        g('equipment-5-1', 'Lamp (Greater)', '/E?ID=5', OLD, 12, 180000, { remaster_id: ['equipment-6'], remaster_name: ['Lantern (Greater)'] }),
        g('equipment-5-2', 'Lamp (Major)', '/E?ID=5', OLD, 15, 600000, { remaster_id: ['equipment-6'] }),
        g('equipment-6', 'Lantern', '/E?ID=6', NEW, 9, undefined, { legacy_id: ['equipment-5'] }),
        g('equipment-6-1', 'Lantern (Greater)', '/E?ID=6', NEW, 12, 180000, { legacy_id: ['equipment-5'] }),
        g('equipment-6-2', 'Lantern (Major)', '/E?ID=6', NEW, 15, 600000, { legacy_id: ['equipment-5'] }),
      ]);
      // the Archives name the Greater's reprint: a stated pair (rule A), not a derived one
      expect(index.next.get('equipment-5-1')).toBe('equipment-6-1');
      expect(index.derived.has('equipment-5-1')).toBe(false);
      // the Major's link names only the family: rule C, derived, held to the old title's key
      expect(index.next.get('equipment-5-2')).toBe('equipment-6-2');
      expect(index.derived.get('equipment-5-2')).toEqual({ name: 'Lamp (Major)', class: '', sub: true, grade: true });
      expect(repointDoc(index, 'equipment-5-2', 'some-other-record', never)).toBeNull();
      expect(repointDoc(index, 'equipment-5-2', 'lamp-major', never)).toBe('equipment-6-2');
    });
  });

  it('EXCEPTION 1 lives in the callers, and both readers still spell a pin the same way', () => {
    // repointDoc takes (index, docId, key, hasKey) — no pin argument. The pin is the caller's.
    expect(repointDoc.length).toBe(4);
    const pin = /r\.field === 'aonId' \|\| \(r\.create && r\.value\?\.aonId !== undefined\)/;
    expect(readFileSync('scripts/migration/build-map.mjs', 'utf8')).toMatch(pin);
    expect(readFileSync('scripts/reprint-check.mjs', 'utf8')).toMatch(pin);
  });
});
