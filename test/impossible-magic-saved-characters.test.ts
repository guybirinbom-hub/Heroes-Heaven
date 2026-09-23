import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { content, build } from './_content';

/**
 * A CHARACTER SAVED BEFORE IMPOSSIBLE MAGIC MUST STILL OPEN.
 *
 * On 2026-09-23 the magus and summoner content was moved onto its Impossible Magic printing: the
 * reprint rule gained a CLASS HOP (scripts/lib/reprint.mjs — AoN links a reprinted class feature to
 * the legacy CLASS page, never to the feature it replaces), the five reprinted hybrid studies were
 * paired by name, and the two features Impossible Magic RENAMED were pinned by an aonId ruling.
 *
 * Every one of those is a change of DOCUMENT, never of key. That is the whole safety argument, and it
 * is the thing this file exists to keep true: a save from v0.1.40 holds `classId`, `subclassId` and
 * feat ids as strings, and if any of those strings stops resolving the player silently loses a choice.
 * So the shapes below are written out as a saved build would carry them — the v0.1.40 spellings, typed
 * literally rather than read back out of today's database, because reading them from the database
 * would make the test agree with whatever the database now says.
 *
 * ⚠ These are synthetic builds. Nothing here is anyone's character.
 */

/** The magus/summoner keys a v0.1.40 save could be holding, typed out as they were then. */
const V0_1_40_MAGUS_FEATURES = [
  'spellstrike', 'arcane-cascade', 'conflux-spells', 'hybrid-study', 'arcane-spellcasting-magus',
  'double-spellstrike', 'studious-spells', 'weapon-expertise', 'reflex-expertise',
  'expert-spellcaster', 'master-spellcaster', 'medium-armor-expertise', 'medium-armor-mastery',
  'weapon-mastery', 'weapon-specialization', 'greater-weapon-specialization',
  'alertness', 'resolve', 'juggernaut',
];
const V0_1_40_SUMMONER_FEATURES = [
  'eidolon', 'summoner-spellcasting', 'link-spells', 'evolution-feat', 'spell-repertoire',
  // The level-3 row moved: Impossible Magic reprints class-feature-455 as class-feature-1346, and the
  // table now names `signature-spells-summoner`. `unlimited-signature-spells` stays in the database as
  // a kept orphan on its own Secrets of Magic page, so an Override a v0.1.40 player saved against it
  // still resolves — both keys are listed here, because both must keep resolving.
  'shared-vigilance', 'signature-spells-summoner', 'unlimited-signature-spells',
  'eidolon-unarmed-expertise', 'eidolon-symbiosis',
  'eidolon-weapon-specialization', 'expert-spellcaster', 'shared-reflexes',
  'eidolon-defensive-expertise', 'simple-weapon-expertise', 'twin-juggernauts', 'defensive-robes',
  'eidolon-unarmed-mastery', 'weapon-specialization', 'greater-eidolon-specialization',
  'shared-resolve', 'eidolon-transcendence', 'master-spellcaster', 'eidolon-defensive-mastery',
  'instant-manifestation',
];
const V0_1_40_HYBRID_STUDIES = [
  'inexorable-iron', 'laughing-shadow', 'sparkling-targe', 'starlit-span', 'twisting-tree',
  'aloof-firmament', 'unfurling-brocade', 'resurgent-maelstrom',
];
const V0_1_40_EIDOLONS = [
  'angel-eidolon', 'anger-phantom-eidolon', 'beast-eidolon', 'construct-eidolon', 'demon-eidolon',
  'devotion-phantom-eidolon', 'dragon-eidolon', 'fey-eidolon', 'plant-eidolon', 'psychopomp-eidolon',
];

describe('Impossible Magic — a v0.1.40 magus or summoner still resolves', () => {
  it('keeps every class-feature key a saved magus or summoner can name', () => {
    const db = content();
    const missing = [...V0_1_40_MAGUS_FEATURES, ...V0_1_40_SUMMONER_FEATURES]
      .filter((id) => !db.classFeatures[id]);
    expect(missing, 'a class-feature key a v0.1.40 save can hold stopped resolving').toEqual([]);
  });

  it('keeps every hybrid study and eidolon a saved character can have chosen', () => {
    const db = content();
    expect(V0_1_40_HYBRID_STUDIES.filter((id) => !db.hybridStudy?.[id])).toEqual([]);
    const magusOptions = new Set((db.classes.magus?.subclass?.options ?? []).map((o) => o.id));
    expect(V0_1_40_HYBRID_STUDIES.filter((id) => !magusOptions.has(id))).toEqual([]);
    const eidolons = new Set((db.classes.summoner?.subclass?.options ?? []).map((o) => o.id));
    expect(V0_1_40_EIDOLONS.filter((id) => !eidolons.has(id))).toEqual([]);
  });

  /*
   * The class TABLE is what a level-up actually reads, and the one thing that would silently drop a
   * feature from an existing character is a table row pointing at a key that no longer exists.
   */
  it('every row of the magus and summoner tables names a record that exists', () => {
    const db = content();
    for (const classId of ['magus', 'summoner']) {
      const rows = db.classes[classId]?.features ?? [];
      expect(rows.length, `${classId} has no feature table`).toBeGreaterThan(10);
      const dangling = rows.filter((f) => !db.classFeatures[f.featureId]).map((f) => `${f.featureId}@${f.level}`);
      expect(dangling, `${classId} table row with no record`).toEqual([]);
    }
  });

  it('builds a level-20 magus saved with the old hybrid study and keeps the same features', () => {
    const ch = build('magus', 20, { subclassId: 'laughing-shadow' });
    expect(ch.classId).toBe('magus');
    expect(ch.subclassId).toBe('laughing-shadow');
    const table = (content().classes.magus?.features ?? []).filter((f) => f.level <= 20);
    // Every feature the table hands a level-20 magus still resolves to a named record.
    for (const f of table) expect(content().classFeatures[f.featureId]?.name, f.featureId).toBeTruthy();
    // and the proficiencies the sheet shows are unchanged by the repoint
    expect(ch.proficiencies.perception).toBe('expert');
    expect(ch.proficiencies.saves.will).toBe('master');
    expect(ch.proficiencies.saves.fortitude).toBe('master');
  });

  /*
   * A SAVED SUMMONER KEEPS ITS SIGNATURE SPELLS.
   *
   * Impossible Magic reprints Secrets of Magic's Unlimited Signature Spells ("All of your spells are
   * signature spells") as the ordinary one-per-rank Signature Spells (class-feature-1346: "For each
   * spell rank you can cast, choose one spell of that rank to be a signature spell"), and the newest
   * printing now wins in the record AND in the engine — see test/summoner-signatures.test.ts.
   *
   * WHAT A SAVE MUST NOT LOSE IS ITS REPERTOIRE, and that is what this asserts. An old save holds
   * nothing in `build.signatures` (the whole repertoire came back signature from the engine, so there
   * was never anything to store), so it comes back with an empty signature set and a live star per
   * rank — the printed rule — while every spell it knows is still in the repertoire and still castable.
   */
  it('builds a level-20 summoner and keeps every spell it knows', () => {
    const ch = build('summoner', 20, {
      subclassId: 'angel-eidolon',
      spells: { 1: ['bless', 'heal'], 2: ['acid-arrow'] },
    });
    expect(ch.subclassId).toBe('angel-eidolon');
    const entry = ch.spellcasting.find((e) => e.id === 'summoner-casting');
    expect(entry, 'summoner spellcasting entry').toBeTruthy();
    const known = [...new Set(Object.values(entry!.repertoire ?? {}).flat())];
    for (const id of ['bless', 'heal', 'acid-arrow']) expect(known, `${id} stayed in the repertoire`).toContain(id);
    expect(entry!.repertoire?.[1] ?? []).toContain('bless');
    // No stored pick, so no signature — and never a crash or a dropped spell.
    expect(entry!.signature ?? []).toEqual([]);
    // …and a stored pick comes back.
    const picked = build('summoner', 20, {
      subclassId: 'angel-eidolon',
      spells: { 1: ['bless', 'heal'], 2: ['acid-arrow'] },
      signatures: { 2: 'acid-arrow' },
    });
    expect(picked.spellcasting.find((e) => e.id === 'summoner-casting')!.signature).toEqual(['acid-arrow']);
  });

  /*
   * …and the table row that makes it so. Both of these sent a summoner to ANOTHER class's page before:
   * `spell-repertoire` renders class-feature-1141, the PSYCHIC's Dark Archive repertoire (occult, three
   * cantrips, conscious mind), and FeatsTab only ever tries `<featureId>-<subclassId>` — a summoner's
   * subclassId is the eidolon, so the summoner's own record was unreachable.
   */
  it('the summoner table names the summoner\'s own repertoire and signature rows', () => {
    const db = content();
    const rows = new Map((db.classes.summoner?.features ?? []).map((f) => [f.featureId, f.level]));
    expect(rows.get('spell-repertoire-summoner'), 'summoner level-1 repertoire row').toBe(1);
    expect(rows.has('spell-repertoire'), 'the shared psychic repertoire record').toBe(false);
    /*
     * …and the signature row, pinned by ID as well as by level. `signature-spells` is the record all
     * four other spontaneous classes name and it sits on class-feature-1149, the PSYCHIC's page;
     * `signature-spells-summoner` is class-feature-1346, Impossible Magic, Class Summoner. Only one
     * of the two opens the summoner's own printing, and it is also the one the engine reads, so it is
     * both halves of the answer and the id is asserted.
     */
    expect(rows.get('signature-spells-summoner'), 'summoner reaches signature spells at 3').toBe(3);
    expect(rows.has('signature-spells'), 'the shared psychic signature record').toBe(false);
    expect(rows.has('unlimited-signature-spells'), 'the retired Secrets of Magic printing').toBe(false);

    /*
     * EVERY ROW OF THIS TABLE OPENS A SUMMONER PAGE. Five rows used to resolve to another class's
     * document — weapon-specialization to the Thaumaturge's, expert/master-spellcaster to the
     * Psychic's, defensive-robes to the Sorcerer's, simple-weapon-expertise to the Animist's — and
     * "present at the right level" said nothing about it. scripts/class-table-diff.mjs now asserts the
     * document's own `class` field per row for all four Impossible Magic classes.
     */
    for (const [id, level] of [
      ['weapon-specialization-summoner', 13], ['expert-spellcaster-summoner', 9],
      ['master-spellcaster-summoner', 17], ['defensive-robes-summoner', 13],
      ['simple-weapon-expertise-summoner', 11],
    ] as [string, number][]) {
      expect(rows.get(id), `${id} at ${level}`).toBe(level);
      expect(db.classFeatures[id]?.source?.book, `${id} is an Impossible Magic record`).toBe('Pathfinder Impossible Magic');
    }
  });

  /*
   * A RENAMED REPRINT HAS TO RENAME THE RECORD TOO, or the Feats-tab row and the popup header disagree
   * on the same feature — the list saying "Arcane Spellcasting (Magus)" while the page it opens is
   * headed "Magus Spellcasting". The KEY never changes; only the displayed name follows the page.
   */
  it('the two renamed reprints display the name their page prints', () => {
    const db = content();
    expect(db.classFeatures['arcane-spellcasting-magus']?.name).toBe('Magus Spellcasting');
    expect(db.classFeatures['signature-spells-summoner']?.name).toBe('Signature Spells');
  });

  /*
   * BOTH IMPOSSIBLE MAGIC HYBRID STUDIES CAN BE PICKED. `core.hybridStudy` held ten records while the
   * array the Builder offers held eight, so Twofold Tine and Volatile Spark existed and no magus could
   * choose them at any level.
   */
  it('offers every hybrid study the database holds', () => {
    const db = content();
    const offered = new Set((db.classes.magus?.subclass?.options ?? []).map((o) => o.id));
    expect(Object.keys(db.hybridStudy ?? {}).filter((id) => !offered.has(id))).toEqual([]);
    for (const id of ['twofold-tine', 'volatile-spark']) {
      const opt = (db.classes.magus?.subclass?.options ?? []).find((o) => o.id === id);
      expect(opt?.description?.length ?? 0, `${id} description`).toBeGreaterThan(200);
      expect(opt?.focusSpells?.length ?? 0, `${id} conflux spell`).toBe(1);
    }
  });

  /*
   * THE LEVEL 1 PAGE STILL OFFERS THE BACKGROUND'S FEAT. `grantedFeatId` is not redundant beside
   * `grantedFeatByChoice`: src/builder/Builder.tsx reads it DIRECTLY, and that read gates the whole
   * granted-feat block — the feat, its sub-choice and its Additional Lore box. The value used to be
   * re-derived every run from the Archives' `feat_markdown`, which the 2026-09-23 refresh emptied on
   * exactly the backgrounds whose feat depends on the skill you pick, so twelve of them lost the
   * block while the sheet went on granting the feat.
   */
  it('every branching background still carries the flat granted feat the builder gates on', () => {
    const db = content();
    /* …except where the overlay RULES IT OUT. `brevic-noble` and `child-of-notoriety` carry an
     * explicit `grantedFeatId: null` row — the documented idiom for removing a field — because their
     * six/two lineages pick a Lore as well as a feat and are modelled per branch throughout. A ruling
     * is an answer, so this reads it rather than overriding it. */
    const ruledOut = new Set(
      (JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as { category?: string; id?: string; field?: string; value?: unknown }[])
        .filter((r) => r.category === 'backgrounds' && r.field === 'grantedFeatId' && r.value === null)
        .map((r) => r.id),
    );
    const bad: string[] = [];
    for (const [id, bg] of Object.entries(db.backgrounds)) {
      if (!bg.grantedFeatByChoice || ruledOut.has(id)) continue;
      const first = bg.trainedSkillChoice?.[0];
      const expected = first ? bg.grantedFeatByChoice[first] : undefined;
      if (!bg.grantedFeatId) bad.push(`${id}: no grantedFeatId`);
      else if (expected && bg.grantedFeatId !== expected) bad.push(`${id}: ${String(bg.grantedFeatId)} is not the ${first} branch (${String(expected)})`);
    }
    expect(bad, 'a background whose Level 1 granted-feat block would not render').toEqual([]);
  });

  /*
   * A KEY THE ARCHIVES RENAMED AWAY still loads. feat-7201 was "Irrepressible (Ganzi)" and is now
   * "Irrepressible (Nephilim)"; feat-9271's "Guding Retort" typo is corrected to "Guiding Retort".
   * Both records moved to a new key, so the old one has to stay resolvable — hidden from pickers,
   * never deleted.
   */
  it('keeps a key the Archives renamed away resolvable', () => {
    const db = content();
    for (const [oldId, newId] of [['irrepressible-ganzi', 'irrepressible-nephilim'], ['guding-retort', 'guiding-retort']]) {
      expect(db.feats[oldId], oldId).toBeTruthy();
      expect(db.feats[oldId]?.edition, oldId).toBe('superseded');
      expect(db.feats[newId], newId).toBeTruthy();
    }
    // …and the nephilim feat is the nephilim one, not the level-9 halfling feat of the same name.
    expect(db.feats['irrepressible-nephilim']?.level).toBe(1);
    expect(db.feats['irrepressible-nephilim']?.traits).toContain('nephilim');
  });

  /*
   * And the other half of "the reprint takes the slug": the records really are on their Impossible
   * Magic printing now, so a player reading the popup gets the current text. Asserted on the shipped
   * artefact rather than on a rebuild, because the artefact is what ships.
   */
  it('the repointed records carry their Impossible Magic document', () => {
    const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as {
      classFeatures: Record<string, { aonId?: string; source?: { book?: string } }>;
      hybridStudy: Record<string, { aonId?: string }>;
    };
    const IM = /^class-feature-1(2[5-8]\d|3[3-6]\d)$/;   // the Impossible Magic magus + summoner block
    for (const id of ['spellstrike', 'arcane-cascade', 'conflux-spells', 'hybrid-study',
      'double-spellstrike', 'eidolon', 'summoner-spellcasting', 'link-spells', 'evolution-feat',
      'shared-vigilance', 'twin-juggernauts', 'instant-manifestation',
      'arcane-spellcasting-magus', 'signature-spells-summoner']) {
      expect(core.classFeatures[id]?.aonId, `${id} should be on its Impossible Magic printing`).toMatch(IM);
      expect(core.classFeatures[id]?.source?.book, id).toBe('Pathfinder Impossible Magic');
    }
    for (const id of ['inexorable-iron', 'laughing-shadow', 'sparkling-targe', 'starlit-span', 'twisting-tree'])
      expect(core.hybridStudy[id]?.aonId, `${id} should be on its Impossible Magic printing`).toMatch(/^hybrid-study-1[0-4]$/);
    /* …and the BOOK follows the document. These six are kept orphans in `classFeatures`, so the
     * importer's overlayContent — the thing that recomputes `source` — never runs for them, and each
     * cited Secrets of Magic while linking an Impossible Magic page. `source.book` is the key
     * Setup -> Sources filters on, so the mismatch hid them from a player who owns the new book. */
    for (const id of ['inexorable-iron', 'laughing-shadow', 'sparkling-targe', 'starlit-span',
      'twisting-tree', 'spell-repertoire-summoner'])
      expect(core.classFeatures[id]?.source?.book, id).toBe('Pathfinder Impossible Magic');
  });

  /*
   * THE GUARD THE CLASS HOP NEEDED. These four records carry ANOTHER class's key while pointing at a
   * magus or summoner document, so following the hop would have handed a swashbuckler, an inventor, a
   * barbarian and a bard a feature sourced from a magus book.
   */
  it('does not drag another class onto the magus/summoner printing', () => {
    const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as {
      classFeatures: Record<string, { source?: { book?: string } }>;
    };
    for (const id of ['weapon-expertise-swashbuckler', 'medium-armor-expertise-inventor',
      'greater-weapon-specialization-barbarian', 'spell-repertoire-bard', 'spell-repertoire-oracle',
      'spell-repertoire-psychic', 'spell-repertoire-sorcerer']) {
      expect(core.classFeatures[id]?.source?.book, id).not.toBe('Pathfinder Impossible Magic');
    }
  });
});
