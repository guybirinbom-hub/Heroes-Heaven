import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildReprintMap, newestPrinting, repointDoc, shippedTwin, slugify } from '../scripts/lib/reprint.mjs';

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

  it('EXCEPTION 1 lives in the callers, and both readers still spell a pin the same way', () => {
    // repointDoc takes (index, docId, key, hasKey) — no pin argument. The pin is the caller's.
    expect(repointDoc.length).toBe(4);
    const pin = /r\.field === 'aonId' \|\| \(r\.create && r\.value\?\.aonId !== undefined\)/;
    expect(readFileSync('scripts/migration/build-map.mjs', 'utf8')).toMatch(pin);
    expect(readFileSync('scripts/reprint-check.mjs', 'utf8')).toMatch(pin);
  });
});
