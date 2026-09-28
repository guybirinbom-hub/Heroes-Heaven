import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { applyEditionFilter, checkPrerequisites } from '../src/rules/build';

/** A bucket's display trees, as the app lazy-loads them. Reference records have no plain prose: the
 *  tree IS their text, so "the record still ships" only means something together with this. */
const astOf = (bucket: string): Record<string, unknown> =>
  JSON.parse(gunzipSync(readFileSync(`public/ast/${bucket}.json.gz`)).toString('utf8'));
/** Every string a display tree would render, joined — enough to say "this page still has its prose".
 *  Text lives in `v` on the leaf nodes; everything else is structure. */
const treeText = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(treeText).join(' ');
  if (node && typeof node === 'object') {
    const n = node as { v?: unknown; c?: unknown };
    return `${typeof n.v === 'string' ? n.v : ''} ${treeText(n.c)}`;
  }
  return '';
};

/**
 * THE 2026-09-23 ARCHIVES REFRESH, AND WHAT IT TOOK AWAY.
 *
 * Every case below is a value the app SHIPPED and then stopped shipping, each with its own cause in
 * the import chain. They are grouped here rather than spread across the guards because the guards
 * could not see them: a description that vanishes, a Bulk that becomes 0 and a trait list that loses
 * its weapon mechanics all leave a perfectly well-formed record behind.
 *
 * ⚠ Nothing here is anyone's character.
 */
describe('archives refresh — values that went missing', () => {
  /*
   * PROSE SURVIVES A RECORD BEING CARRIED FORWARD.
   *
   * split-descriptions.mjs moves `description` out of core.json, so the shipped artefact the importer
   * reads back carries a record's identity and none of its text. The step that keeps a key alive when
   * the Archives rename or reprint its page copied that artefact, and twenty records came back with
   * no prose at all — including four a saved character can still be holding, because they are the
   * superseded aliases of keys the Archives renamed away.
   */
  it('keeps the prose of a record the importer carries forward', () => {
    const db = content();
    const carried = [
      ['items', 'universal-solvent'], ['items', 'universal-solvent-major'], ['items', 'world-forge'],
      ['items', 'mythic-resilent'], ['items', 'fulus-of-concealment'], ['items', 'shadow-essence'],
      ['items', 'extradimensional-stash-space'], ['feats', 'irrepressible-ganzi'],
      ['feats', 'guding-retort'], ['feats', 'azata-magic'], ['feats', 'invigorating-mercy'],
      ['feats', 'elucidating-mercy'], ['spells', 'efficient-apport'],
      ['trait', 'negative'], ['trait', 'positive'], ['trait', 'half-elf'], ['trait', 'gnoll'],
    ] as const;
    for (const [bucket, id] of carried) {
      const rec = (db as unknown as Record<string, Record<string, { description?: string }>>)[bucket]?.[id];
      expect(rec, `${bucket}/${id} should still ship`).toBeTruthy();
      expect((rec?.description ?? '').length, `${bucket}/${id} prose`).toBeGreaterThan(30);
    }
  });

  /*
   * THE CLICKABLE LINKS IN A POPUP survive AoN re-templating its cross-references. The 2026-09 index
   * rebuild turned `[concealed](/Conditions.aspx?ID=62)` into `{{conditions 62 "concealed"}}`, which
   * the descRefs scanner could not see, so the two familiar abilities whose prose is built from that
   * markdown lost every ref they had.
   */
  it('reads cross-references out of AoN\'s handlebars template too', () => {
    const db = content() as unknown as { familiarAbilities: Record<string, { descRefs?: { label: string }[] }> };
    const ink = db.familiarAbilities['ink-spray']?.descRefs ?? [];
    expect(ink.map((r) => r.label).sort()).toEqual(['Interact', 'blinded', 'concealed', 'invisible']);
    expect((db.familiarAbilities['gibe']?.descRefs ?? []).map((r) => r.label)).toEqual(['off-guard']);
  });

  /*
   * BULK COMES FROM `bulk_raw` AND NOTHING ELSE. `bulk_num` is 0 on every document that prints no
   * Bulk row, so reading it as a fallback could only ever write a zero over a real value — which is
   * what happened to Boots of Elvenkind, whose own Greater variant (a document that DOES carry
   * `bulk_raw: "L"`) kept its Light Bulk throughout.
   */
  it('does not zero a Bulk the Archives simply do not print', () => {
    const db = content();
    expect(db.items['boots-of-elvenkind']?.bulk).toBe(0.1);
    expect(db.items['boots-of-elvenkind-greater']?.bulk).toBe(0.1);
  });

  /*
   * A MAGIC WEAPON KEEPS ITS BASE ITEM'S MECHANICS even when the page names no base item.
   *
   * The Archives put the weapon traits on the base item and name it in `data.base_item`; where they
   * name none, the union had nothing to add and the record's own mechanics were overwritten by the
   * page's short trait line. A staff stopped being a two-handed d8 weapon and stopped being a monk
   * weapon — 179 items in all, mostly staves and firearms.
   */
  it('keeps a weapon\'s two-handed die and monk trait when the page names no base item', () => {
    const db = content();
    for (const id of ['staff-of-power', 'staff-of-the-magi', 'staff-of-the-dreamlands']) {
      expect(db.items[id]?.traits, id).toContain('two-hand-d8');
      expect(db.items[id]?.traits, id).toContain('monk');
    }
    // …and a firearm's, which is the same gap in a different book.
    expect(db.items['tentacle-cannon']?.traits).toContain('fatal-d12');
  });

  /*
   * THE GRADE LADDER ASCENDS. AoN's legacy page for the Judgment Thurible titles its Item 17 block
   * "(Major)" and its Item 20 block "(Greater)"; the remastered printing of the same family states
   * the opposite, and PF2e has no item whose Major is cheaper than its Greater.
   */
  it('keeps Greater below Major in the Judgment Thurible family', () => {
    const db = content();
    const g = db.items['judgment-thurible-greater'], m = db.items['judgment-thurible-major'];
    expect([g?.level, g?.price]).toEqual([17, { gp: 14000 }]);
    expect([m?.level, m?.price]).toEqual([20, { gp: 65000 }]);
  });

  /*
   * A COMMA LIST OF ALTERNATIVES IS AN OR. "Expert in Arcana, Nature, Occultism, or Religion" split on
   * " or " alone left the single unrecognized skill "arcana, nature, occultism,", so the clause was
   * not enforced at all — the feat went from over-gated to ungated, which is the failure that looks
   * like a fix.
   */
  it('enforces a comma list of skills as one OR', () => {
    const db = content();
    const feat = db.feats['writing-on-the-wall'];
    expect(feat?.prerequisites).toEqual(['expert in Arcana, Nature, Occultism, or Religion']);
    // A runesmith with nothing above trained in any of the four does not meet it…
    const untrained = build('runesmith', 4, {});
    expect(checkPrerequisites(feat!, untrained, db).met).toBe(false);
    // …and one who is expert in ONE of them does, without needing the other three.
    const expert = { ...untrained, proficiencies: { ...untrained.proficiencies, skills: { ...untrained.proficiencies.skills, religion: 'expert' as const } } };
    expect(checkPrerequisites(feat!, expert, db).met).toBe(true);
  });

  /*
   * TEXT THE ARCHIVES DROPPED FROM ONE PAGE AND KEPT ON ITS SIBLINGS is scrape damage, not a printing
   * change: Dragonhide's Craft Requirements line is still on Dragonhide Armor and Dragonhide Shield.
   */
  it('keeps the Dragonhide Craft Requirements line', () => {
    const db = content();
    for (const id of ['dragonhide', 'dragonhide-object-standard-grade', 'dragonhide-object-high-grade']) {
      expect(db.items[id]?.description, id).toContain('dragonhide worth at least 200 gp + 20 per Bulk');
    }
  });

  /*
   * THE FEATURE TEXT AND THE PICKER BESIDE IT AGREE. Hybrid Study's prose enumerated the eight
   * Secrets of Magic studies while the Builder offered ten; its own Impossible Magic page enumerates
   * none and points at the index, which in the app is the picker.
   */
  it('does not enumerate eight hybrid studies next to a picker offering ten', () => {
    const db = content();
    const text = db.classFeatures['hybrid-study']?.description ?? '';
    expect(text).not.toContain('Aloof Firmament');
    expect(text).toContain('studious spells');
    expect(Object.keys(db.hybridStudy ?? {})).toHaveLength(10);
  });

  /*
   * THE SUMMONER'S FIRST INSTRUCTION HAS ITS OBJECT. "Choose a type of ." is what the Foundry-era
   * transcription left behind; the record's own page prints the sentence whole.
   */
  it('prints what the summoner is choosing a type of', () => {
    const db = content();
    expect(db.classFeatures['eidolon']?.description).toContain('Choose a type of eidolon from the options you have access to.');
  });

  it('spells the runesmith rune\'s usage the way the rune does', () => {
    const db = content() as unknown as { runesmithRune: Record<string, { usage?: string }> };
    expect(db.runesmithRune['atryl-rune-of-fire']?.usage).toBe('drawn on a creature or object');
  });

  /*
   * A SIDEBAR IS NOT SUPERSEDED BY ITS PARENT PAGE.
   *
   * The export derives `superseded_by` from AoN's `remaster_id`, and on a sidebar that names the
   * REMASTERED PARENT, not a reprint of the sidebar: sidebar-1573 "Spellstrike Options" points at
   * class-74 (Magus), sidebar-1115 "Tianjing" at ancestry-68 (Nephilim). Fetched live, none of
   * class-74, class-77 or ancestry-68 contains the string "Spellstrike Options", "Summoning Spells"
   * or "Tianjing" — nothing reprinted that prose anywhere. The importer read the pointer as a
   * supersession and deleted all thirteen, ~700-1,200 characters of readable text each, against the
   * owner's standing rule that legacy-only content stays.
   *
   * A reference record ships no plain `description` by design (the display tree is its text), so
   * "the record is back" is only half the assertion; the tree has to have the prose in it.
   */
  it('keeps a sidebar whose remaster_id names its parent page', () => {
    const db = content() as unknown as { sidebar: Record<string, { name?: string }> };
    const trees = astOf('sidebar');
    const deleted = [
      'tianjing', 'divine-pressure', 'tiefling-settlements', 'abandoned-by-faith',
      'aphorite-settlements', 'relations-with-axis', 'special-armament-types', 'spellstrike-options',
      'summoning-spells', 'herald-examples', 'soulforged-champions', 'family-matters',
      'the-shaded-library',
    ];
    for (const id of deleted) {
      expect(db.sidebar[id], `sidebar/${id} should still ship`).toBeTruthy();
      expect(treeText(trees[id]).length, `sidebar/${id} prose`).toBeGreaterThan(300);
    }
    // …and the rule, not just the thirteen: 76 more had been dropped the same way before anyone
    // measured it, so the bucket is well past the 396 the last release shipped.
    expect(Object.keys(db.sidebar).length).toBeGreaterThan(450);
  });

  /*
   * A CLASS TABLE NEVER NAMES A RECORD THE BUILDER FILTERS OUT.
   *
   * `applyEditionFilter` drops `edition: 'superseded'` from the Builder's content ALWAYS — not when
   * "Hide legacy data" is on, always — and `levelGrants` then falls back to
   * `content.classFeatures[id]?.name ?? f.featureId`, so the row prints its raw id with no Details
   * button. Seventeen per-class rows shipped that way: a level-1 runesmith's page read
   * `shield-block-runesmith`, a necromancer's `reflex-expertise-necromancer`.
   *
   * The cause was the importer reading a DISAMBIGUATED key (`<document slug>-<class id>`, the shape
   * this database has always used for one class's copy of a shared feature) as evidence that the
   * Archives had renamed the page. Corpus-wide, because the branch that does it is shared by all 29.
   */
  it('leaves every class-table row a NAME after the Builder\'s own edition filter', () => {
    const db = content();
    const nameless = (hideLegacy: boolean) => {
      const shown = applyEditionFilter(db, { hideLegacy }, new Set<string>());
      const out: string[] = [];
      for (const [classId, cls] of Object.entries(db.classes)) {
        for (const row of cls.features ?? []) {
          if (!shown.classFeatures[row.featureId]?.name) out.push(`${classId} L${row.level} ${row.featureId}`);
        }
      }
      return out.sort();
    };
    // The default. `superseded` is hidden here whatever the toggle says, which is what the seventeen
    // per-class rows were tripping over.
    expect(nameless(false)).toEqual([]);
    /*
     * …and with "Hide legacy data" ON, five PRE-EXISTING rows have the same shape for the other
     * reason: the record they name is `legacy`/`legacy-era`, so the filter drops it and the row
     * prints its id. None is this lane's — each is one of the 154 class-table rows still sitting on
     * another printing's document, which `scripts/class-table-diff.mjs` counts on every run and which
     * is its own batch. Pinned by name so a SIXTH cannot join them unnoticed.
     *
     * Reprint lane 2026-09-25: FIVE -> THREE. The barbarian's level-15 and the inventor's level-11 rows
     * named records sitting on the MAGUS's Secrets of Magic pages (class-feature-438 / -436); overlay
     * aonId rows now pin them to their own classes' current printings (class-feature-862, Player Core 2;
     * class-feature-497, Guns & Gears Remastered), edition remaster, so hide-legacy keeps them. The three
     * left are the class-table lane's, allow-listed with that reason in scripts/class-table-diff.mjs.
     */
    expect(nameless(true)).toEqual([
      'alchemist L1 formula-book',
      'bard L1 occult-spellcasting',
      'champion L1 deific-weapon',
    ]);
  });

  /*
   * AoN PAGE FURNITURE IS NOT THE RECORD'S PROSE. A class-feature page opens with its own title, a
   * `Source <book> pg. N` line, a `Class <Class>` line and a `---` rule. The description POPUP renders
   * those as proper metadata rows from the display tree; the flat `description` is what the Feats &
   * Features list prints as its PREVIEW, and 32 records shipped previews reading "Weapon Expertise
   * Source Impossible Magic pg. 9 Class Magus You've dedicated yourself…".
   */
  it('ships a class feature\'s rules text without the page header above it', () => {
    const db = content();
    const withFurniture = Object.entries(db.classFeatures)
      .filter(([, r]) => /^[^\n]{1,80}\n\nSource [^\n]+\n\n/.test((r as { description?: string }).description ?? ''))
      .map(([id]) => id);
    expect(withFurniture).toEqual([]);
    expect(db.classFeatures['shield-block-runesmith']?.description ?? '')
      .toMatch(/^You gain the Shield Block general feat/);
  });

  /*
   * NO RECORD IS SHELVED UNDER A BOOK NOBODY PRINTED. AoN titles the book "Dark Archives
   * (Remastered)"; core.json files it as "Pathfinder Dark Archive (Remastered)" — one letter apart, so
   * each importer's own normalising fold missed and invented "Pathfinder Dark Archives (Remastered)".
   * The Sources card then drew that as a SECOND, near-identical book holding one record, beside the
   * real one holding 537, and a player who owns Dark Archive could not switch the strays on.
   */
  it('shelves every record under a book name the hand-kept table agrees with', () => {
    const db = content() as unknown as Record<string, Record<string, { source?: { book?: string } }>>;
    const aliases = JSON.parse(readFileSync('scripts/data/book-names.json', 'utf8')) as Record<string, string>;
    const strays: string[] = [];
    for (const [bucket, recs] of Object.entries(db)) {
      if (!recs || typeof recs !== 'object') continue;
      for (const [id, rec] of Object.entries(recs)) {
        const book = rec?.source?.book;
        // The three importers that MINT source.book read the table. A kept orphan carries whatever the
        // pre-Archives transcription gave it and is left alone by doctrine, so this asks only about
        // the one the refresh invented.
        if (book === 'Dark Archives (Remastered)' || book === 'Pathfinder Dark Archives (Remastered)') {
          strays.push(`${bucket}/${id} -> ${book}`);
        }
      }
    }
    expect(strays).toEqual([]);
    expect(aliases['Dark Archives (Remastered)']).toBe('Pathfinder Dark Archive (Remastered)');
  });

  /*
   * A PICKER ASKS FOR THE PICK. `EffectChoicesPicker` uses `ch.prompt` as BOTH the card label and the
   * button text, so a prompt written as a sentence prints the sentence twice; twenty-one of the
   * twenty-two class-feature prompts are the imperative form and Grim Fascination was the exception.
   */
  it('asks the necromancer to choose rather than restating the page', () => {
    const db = content();
    const ch = (db.classFeatures['grim-fascination'] as { effectChoices?: { prompt?: string; options?: unknown[] }[] })
      ?.effectChoices?.[0];
    expect(ch?.prompt).toMatch(/^Choose /);
    expect(ch?.options).toHaveLength(4);
  });

  /*
   * AND THE SUMMONER READS ONE PRINTING. The record used to carry class-feature-1346's rule (one
   * signature spell per rank) while the engine applied Secrets of Magic's "all of your spells are
   * signature", disclosed with a `note`. The disclosure is gone because the disagreement is: the
   * record is `signature-spells-summoner` and the engine routes it through the ordinary one-per-rank
   * rule, so there is nothing left to warn about. A `note` here again would mean the split came back.
   */
  it('the summoner has one signature-spells printing, with no disagreement to disclose', () => {
    const db = content();
    const rec = db.classFeatures['signature-spells-summoner'] as { note?: string; aonId?: string } | undefined;
    expect(rec?.aonId).toBe('class-feature-1346');
    expect(rec?.note ?? '', 'a note here means the record and the engine disagree again').toBe('');
    // The Secrets of Magic printing is a kept orphan on its OWN page — no class table names it, and it
    // no longer wears Impossible Magic's id or book.
    expect(db.classFeatures['unlimited-signature-spells']?.aonId).toBe('class-feature-455');
    expect(db.classFeatures['unlimited-signature-spells']?.source?.book).toBe('Pathfinder Secrets of Magic');
  });

  /*
   * EVERY CLASS-FEATURE PICKER ASKS A QUESTION. `EffectChoicesPicker` prints the prompt twice — as the
   * SubCard's label and inside the button ("`${prompt}…`") — so a prompt written as a label or as a
   * sentence reads as a stray fragment or as the same paragraph twice. Grim Fascination was the first
   * one found; the measurement then said six of twenty-two were not imperative, not one.
   */
  it('every class-feature choice prompt is a question, not a label', () => {
    const db = content();
    const bad: string[] = [];
    for (const [id, rec] of Object.entries(db.classFeatures)) {
      for (const ch of (rec as { effectChoices?: { id: string; prompt?: string }[] }).effectChoices ?? []) {
        if (!/^(Choose|Pick|Which|Select) /i.test(String(ch.prompt ?? ''))) bad.push(`${id}/${ch.id}: ${JSON.stringify(ch.prompt)}`);
      }
    }
    expect(bad, 'a picker prompt that is not imperative').toEqual([]);
  });

  /*
   * THE CLASS-DETAILS POPUP AND THE BUILDER'S LEVEL ROWS NAME THE SAME FEATURES. The magus's popup
   * carried the Secrets of Magic advancement table (Arcane Spellcasting (Magus), Lightning Reflexes,
   * "Alertness, Resolve", Juggernaut) beside level rows reading the Impossible Magic reprints — one
   * screen, two printings. scripts/class-table-diff.mjs holds this corpus-wide; this holds the four
   * Impossible Magic classes through the same content the app loads.
   */
  it('the Impossible Magic class pages print their own advancement table', () => {
    const db = content();
    const flat = (s: string) => s.toLowerCase().replace(/\(level \d+\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    for (const classId of ['magus', 'summoner', 'necromancer', 'runesmith']) {
      const prose = (db.classes[classId] as { description?: string }).description ?? '';
      const byLevel: Record<number, string> = {};
      for (const m of prose.matchAll(/^\|\s*(\d+)\s*\|([^|]*)\|/gm)) byLevel[Number(m[1])] = `${byLevel[Number(m[1])] ?? ''} ${m[2]}`;
      expect(Object.keys(byLevel).length, `${classId} has no advancement table in its description`).toBeGreaterThan(10);
      const missing = (db.classes[classId].features ?? []).filter((f) => {
        const name = db.classFeatures[f.featureId]?.name ?? f.featureId;
        const hay = flat(byLevel[f.level] ?? '');
        return !hay.includes(flat(name)) && !hay.includes(flat(name.replace(/\s*\([^)]*\)\s*$/, '')));
      }).map((f) => `L${f.level} ${f.featureId}`);
      expect(missing, `${classId}: the popup's table does not name these rows`).toEqual([]);
    }
    // …and the legacy magus table is gone from the prose entirely.
    const magus = (db.classes.magus as { description?: string }).description ?? '';
    expect(magus).not.toMatch(/Lightning Reflexes/);
    expect(magus).not.toMatch(/Arcane Spellcasting \(Magus\)/);
  });

  /*
   * THE SUMMONER IS OFFERED EVERY EIDOLON IMPOSSIBLE MAGIC PRINTS. The book adds Aberrant and Ooze and
   * a summoner could pick neither; Elemental (eidolon-12, Rage of Elements) and Swarm (eidolon-13,
   * Battlecry!) are not reprinted and stay, because legacy-only content stays. Every shipped id is
   * kept so a saved summoner still resolves.
   */
  it('offers the two eidolons Impossible Magic adds, and keeps the legacy-only ones', () => {
    const db = content();
    const opts = db.classes.summoner?.subclass?.options ?? [];
    const ids = new Set(opts.map((o) => o.id));
    for (const id of ['aberrant-eidolon', 'ooze-eidolon']) {
      expect(ids.has(id), `${id} is an Impossible Magic eidolon type`).toBe(true);
      // The sheet's feature list reads classFeatures[subclassId] (src/rules/derive.ts), so an option
      // with no record shows a player who picked it nothing at all.
      expect(db.classFeatures[id]?.source?.book, `${id} needs a record`).toBe('Pathfinder Impossible Magic');
      expect(db.classFeatures[id]?.description ?? '', `${id} needs its page's text`).not.toBe('');
    }
    for (const id of ['elemental-eidolon', 'swarm-eidolon', 'undead-eidolon']) expect(ids.has(id), id).toBe(true);
    expect(opts.length).toBe(15);
  });

  /*
   * A RECORD NEVER TAKES ANOTHER CLASS'S DOCUMENT. `classFeatures/ability-boosts` carries traits
   * ["summoner"] and was repointed to class-feature-10 — the ALCHEMIST's Core Rulebook page — because
   * twenty-one documents share the name and the matcher took the first. There is no Player Core
   * printing of this feature, so the newest-printing rule has nothing to prefer.
   */
  it('the summoner\'s Ability Boosts record is the summoner\'s page', () => {
    const rec = content().classFeatures['ability-boosts'];
    expect(rec?.traits).toContain('summoner');
    expect(rec?.aonId).toBe('class-feature-456');
    expect(rec?.source?.book).toBe('Pathfinder Secrets of Magic');
  });

  /*
   * THE BLANK STAT-BLOCK LABEL, mirrored from `scripts/dropped-inline-check.mjs` into the content the
   * app actually loads.
   *
   * AoN's own Impossible Magic eidolon pages print the Str, Dex and AC tokens blank (13 of 13; 0 of 13
   * on the older pages), so the two types new in that book carry a holed array and there is nothing
   * upstream to repair them from. Those four sites are named on the guard's allow list and are the
   * ONLY ones permitted: this asserts the set has not grown, from the loaded database rather than
   * from the files, so a hole reaching the player through the AST or the seed merge is caught too.
   *
   * The right closure is AoN correcting the pages or an owner ruling supplying the numbers — never a
   * typed-in guess, and never a bare count that a third record could slip in under.
   */
  it('no record outside the four known ones prints a stat label with no value', () => {
    const db = content();
    const BLANK_ATTR = /^[-*]\s*(?:Str|Dex|Con|Int|Wis|Cha)\s*$/m;
    const BLANK_AC = /^[-*]\s+AC \(\s*Dex cap\)\s*$|^[-*]\s*\s+AC \(/m;
    const holed = (t: unknown) => typeof t === 'string' && (BLANK_ATTR.test(t) || BLANK_AC.test(t));
    const hits: string[] = [];
    for (const [bucket, recs] of Object.entries(db as unknown as Record<string, Record<string, { description?: unknown }>>)) {
      if (!recs || typeof recs !== 'object') continue;
      for (const [id, r] of Object.entries(recs)) if (holed(r?.description)) hits.push(`${bucket}/${id}`);
    }
    for (const [clsId, cls] of Object.entries(db.classes)) {
      for (const o of cls?.subclass?.options ?? []) if (holed(o.description)) hits.push(`classes.${clsId} option ${o.id}`);
    }
    expect(hits.sort()).toEqual([
      'classFeatures/aberrant-eidolon',
      'classFeatures/ooze-eidolon',
      'classes.summoner option aberrant-eidolon',
      'classes.summoner option ooze-eidolon',
    ]);
  });
});
