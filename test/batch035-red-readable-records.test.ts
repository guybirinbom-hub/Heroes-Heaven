/*
 * Batch 035, GATE-RED group "readable-records".
 *
 * `node scripts/readable-record-check.mjs` opened the batch red on 27 records that ship with nothing
 * a player can read — twenty-one more than the six the guard's header holds at, all arrived from the
 * Impossible Magic / Battlecry! scrapes. Two dispositions and no third: printed prose off the
 * record's own AoN page, or a RULE-BASED exemption for a record whose text genuinely lives elsewhere.
 *
 * This file pins both halves.
 *
 *   PROSE   Each row in work/.b035-created-desc-readable-records.json is asserted against a copy of
 *           the record with the description PATCHED IN MEMORY, plus the same copy STRIPPED — never
 *           against the shipped artefact, so nothing here flips when the driver applies the rows.
 *
 *   EXEMPT  Each new exempt() rule is proved in both directions: a record of the exempted SHAPE
 *           passes, and a record without that shape still fails. An exemption that swallows the
 *           guard is worse than the red it hides.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exempt, readable } from '../scripts/readable-record-check.mjs';
import { content } from './_content';

type Row = { category: string; id: string; field: string; value: string; why: string };
type Spec = { findings: { id: string; backfillRows: Row[]; note: string }[] };

const spec = JSON.parse(readFileSync('work/.b035-created-desc-readable-records.json', 'utf8')) as Spec;
const rows = spec.findings.flatMap((f) => f.backfillRows);
const db = content() as unknown as Record<string, Record<string, Record<string, unknown>> | undefined>;

/** No descriptions file at all, so a `readable()` verdict here can only come from the argument. */
const NO_DESCS = {};

/*
 * VERIFIER GUARD (batch 035, gate-red readable-records).
 *
 * Every flip in this group is cited in the premise form, and three of the four premise doc ids the
 * builder wrote were UNRESOLVABLE: `equipment-3055-4734-bonus-1716` and friends exist in the mirror
 * under `item-bonus/`, but scripts/test-flip-audit.mjs:296-301 derives the folder by stripping the
 * trailing `-<digits>` from the id, which for those yields `equipment-3055-4734-bonus`. The audit
 * never caught it because a WHOLLY NEW test file is exempt from the citation scan (:424-431) — so
 * the citations would only have failed the first time a later batch edited a line under one of them.
 *
 * This re-derives the audit's own resolution over both files this group touched, so a doc id that
 * the audit cannot check is a red HERE, in the batch that wrote it.
 */
const CITED_FILES = ['test/batch035-red-readable-records.test.ts', 'scripts/readable-record-check.mjs'];
const AON_ROOT = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const PREMISES = CITED_FILES.flatMap((f) => {
  const src = readFileSync(f, 'utf8');
  return [...src.matchAll(/batch\s+035\s+premise\s*:\s*([a-z0-9-]+-\d+)\s+"([\s\S]*?)"/g)].map((m) => ({
    file: f,
    docId: m[1],
    // a premise may wrap across a block comment's ` * ` gutter; the audit reads one line, the mirror check needs the sentence
    clause: m[2].replace(/\s*\n\s*\*?\s*/g, ' ').trim(),
  }));
});

describe('batch 035 — readable-record-check: every premise citation is one the flip audit can check', () => {
  // batch 035 premise: source-370 "**Product Line** Adventures"
  it('resolves each cited AoN doc id the way test-flip-audit.mjs does, and finds the clause verbatim', () => {
    expect(PREMISES.length).toBeGreaterThan(10);
    const broken: string[] = [];
    for (const p of PREMISES) {
      const folder = p.docId.replace(/-\d+$/, ''); // test-flip-audit.mjs:298 — /^(.*)-(\d+)$/
      const file = `${AON_ROOT}/${folder}/${p.docId}.json`;
      if (!existsSync(file)) {
        broken.push(`${p.file}: ${p.docId} -> no mirror file at ${folder}/`);
        continue;
      }
      const hay = readFileSync(file, 'utf8');
      // the mirror stores JSON, so a straight apostrophe in the citation may be a curly one on the page
      if (!hay.includes(p.clause) && !hay.includes(p.clause.replace(/'/g, '’'))) {
        broken.push(`${p.file}: ${p.docId} -> clause not verbatim: ${p.clause.slice(0, 60)}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('batch 035 — readable-record-check: the prose rows', () => {
  // batch 035 premise: arcane-school-31 "You have sway in powerful social circles and pride yourself on being able to predict and manipulate opponents."
  it('names 24 records — the guard\'s 20 reds plus 4 hidden by a foreign-bucket ast — one row each', () => {
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => r.field === 'description')).toBe(true);
    expect(new Set(rows.map((r) => `${r.category}/${r.id}`)).size).toBe(24);
    expect(rows.every((r) => /\bAoN [a-z-]+-\d+\b/.test(r.why))).toBe(true);
  });

  /*
   * batch 035 premise: follower-2 "This trainee healer can master the art of bringing people back from the brink of death."
   *
   * The guard resolves an ast by BARE id, so `follower/medic` reads as covered by the Medic
   * ARCHETYPE's display tree, `follower/scout` by the Scout exploration activity's, `grimFascination/
   * bone` by an item's and `grimFascination/spirit` by the barbarian Spirit instinct's. All four are
   * as textless as the siblings the guard did report; they get the same disposition.
   */
  it('covers the four records the bucket-blind ast lookup hides', () => {
    for (const k of ['follower/medic', 'follower/scout', 'grimFascination/bone', 'grimFascination/spirit']) {
      expect(rows.map((r) => `${r.category}/${r.id}`)).toContain(k);
    }
  });

  // batch 035 premise: fatal-method-1 "You prefer to study life and death from afar."
  it('every row names a record core.json actually has — a prose row for a missing record reaches nothing', () => {
    for (const r of rows) expect(db[r.category]?.[r.id], `${r.category}/${r.id}`).toBeTruthy();
  });

  /* The records whose stripped copy still reads, through an ast tree — the instrument's real verdict,
   * stated so the stripped half of each row's test is not skipped. Two families, measured against the
   * TRACKED .gz trees (the guard reads those since 2026-09-12; the raw .json beside them is gitignored):
   *   - the four whose bare id also keys someone else's tree — see the premise above;
   *   - the eight in the follower, grimFascination and fatalMethod buckets, whose own trees were
   *     tracked in 7da5f92 and became reachable when public/ast-index.json gained their rows on
   *     2026-09-12;
   *   - the twelve arcaneSchool / hybridStudy / sidebar rows, which had no tracked tree when this
   *     batch measured them and gained one in the 2026-09-12 regen. Each now ships the archive page
   *     its own record points at, and the page's provenance stamp names it (the id in brackets, from
   *     public/ast/<bucket>.json.gz, asserted by scripts/ast-provenance-check.mjs). The prose row is
   *     still what this batch authored, and the second half of each test below still proves it. */
  const READS_BY_TREE = new Set([
    'follower/medic', 'follower/scout', 'grimFascination/bone', 'grimFascination/spirit',
    'fatalMethod/puppeteer', 'fatalMethod/reaper',
    'follower/berserker', 'follower/sharpshooter', 'follower/shieldbearer', 'follower/adept',
    'grimFascination/blood', 'grimFascination/flesh',
    'arcaneSchool/school-of-breathtaking-influence',  // arcane-school-31
    'arcaneSchool/school-of-keen-inquiry',            // arcane-school-32
    'arcaneSchool/school-of-nexian-spaces',           // arcane-school-33
    'arcaneSchool/school-of-quantic-control',         // arcane-school-34
    'hybridStudy/twofold-tine',                       // hybrid-study-15
    'hybridStudy/volatile-spark',                     // hybrid-study-16
    'sidebar/arcane-cascade-damage',                  // sidebar-3750
    'sidebar/runic-phrases',                          // sidebar-3753
    'sidebar/motion-sense',                           // sidebar-3756
    'sidebar/jotunborn-adventurers',                  // sidebar-3758
    'sidebar/jotunborn-enclaves',                     // sidebar-3759
    'sidebar/on-jotuns',                              // sidebar-3760
  ]);

  for (const r of rows) {
    // batch 035 premise: sidebar-3750 "This means feats like the listed ones use the base damage value, not the boosted one!"
    it(`${r.category}/${r.id} reads once the description is patched in`, () => {
      // mutation-proof — stunts the very field the row supplies (`description`) on a copy of the
      // record, so the "reads" half is proved by the row's own text and nothing else.
      const stripped = { ...(db[r.category]?.[r.id] ?? {}), description: '', note: '' };
      expect(readable(r.category, r.id, stripped, NO_DESCS)).toBe(READS_BY_TREE.has(`${r.category}/${r.id}`));

      const patched = { ...stripped, description: r.value };
      expect(readable(r.category, r.id, patched, NO_DESCS)).toBe(true);
      expect(r.value.trim().length).toBeGreaterThan(80);
    });
  }
});

describe('batch 035 — readable-record-check: prose transcribed from the printed page', () => {
  const value = (id: string) => rows.find((r) => r.id === id)?.value ?? '';

  // batch 035 premise: arcane-school-32 "- Initial: [Fact Check](/Spells.aspx?ID=2922)"
  it('school-of-keen-inquiry carries the curriculum ladder and both school spells', () => {
    expect(value('school-of-keen-inquiry')).toContain('- 9th: Foresight');
    expect(value('school-of-keen-inquiry')).toContain('- Initial: Fact Check');
    expect(value('school-of-keen-inquiry')).toContain('- Advanced: Unsettling Perspective');
  });

  // batch 035 premise: fatal-method-2 "You become trained in martial weapons and medium armor. At 11th level, you become an expert in martial weapons, and at 13th you become an expert in medium armor."
  it("reaper states reaper's edge verbatim, including both later ranks", () => {
    expect(value('reaper')).toContain(
      'You become trained in martial weapons and medium armor. At 11th level, you become an expert in martial weapons, and at 13th you become an expert in medium armor.',
    );
  });

  // batch 035 premise: follower-6 "This novice spellcaster eagerly explores the world’s secrets while learning to hurl destructive magic."
  it('adept carries the stat line and all three advancement tiers', () => {
    const v = value('adept');
    expect(v).toContain('**Hit Points** 4');
    /* The tier headings are the printed sentence, not a coined label: apply-parity-fixes.mjs backs a
     * created description against its own mirror document as one contiguous run, and "**Experienced
     * follower**" is wording follower-6 never prints. */
    // batch 035 premise: follower-6 "When the adept becomes an experienced follower:"
    expect(v).toContain('When the adept becomes an experienced follower:');
    expect(v).toContain('When the adept becomes a veteran follower:');
    expect(v).toContain('When the adept becomes an exceptional follower:');
  });

  // batch 035 premise: grim-fascination-1 "Whenever a thrall is destroyed, you regain 1 Hit Point. At 5th level and every 4 levels thereafter, the amount of Hit Points you regain when a thrall is destroyed increases by 1."
  it('blood states the thrall enhancement with its scaling', () => {
    expect(value('blood')).toContain(
      'Whenever a thrall is destroyed, you regain 1 Hit Point. At 5th level and every 4 levels thereafter, the amount of Hit Points you regain when a thrall is destroyed increases by 1.',
    );
  });

  // batch 035 premise: hybrid-study-15 "The extra damage increases to 4 if you have weapon specialization or 6 if you have greater weapon specialization."
  it('twofold-tine states the Arcane Cascade damage it raises, at all three tiers', () => {
    expect(value('twofold-tine')).toContain(
      'any extra damage the chosen weapon gains from Arcane Cascade is increased to 2. The extra damage increases to 4 if you have weapon specialization or 6 if you have greater weapon specialization.',
    );
  });
});

describe('batch 035 — readable-record-check: itemBonus is a synthetic carrier (new exempt rule)', () => {
  /*
   * batch 035 premise: equipment-3055 "Over millennia, these mysterious, intricately cut gemstones have been hoarded by mystics and fanatics hoping to discover their secrets."
   *
   * VERIFIER (batch 035, gate-red readable-records): the doc id was `equipment-3055-4734-bonus-1716`,
   * the item-bonus page itself. It exists in the mirror — but under `item-bonus/`, while
   * scripts/test-flip-audit.mjs:298-300 derives the category by stripping the trailing `-\d+`, which
   * for that id yields `equipment-3055-4734-bonus` and finds no file. The citation was uncheckable
   * (it passed only because a wholly new test file is exempt from the citation scan, :424) and would
   * have failed the audit the first time a later batch edited a line under it. Repointed at the
   * PARENT ITEM page, which carries the identical clause verbatim and derives cleanly — and which is
   * the stronger premise anyway, since "the text lives on the parent item" is exactly what the
   * exemption rests on.
   */
  it('every itemBonus id is also an items id — the measurement the rule rests on', () => {
    const bonuses = Object.keys(db.itemBonus ?? {});
    expect(bonuses.length).toBeGreaterThan(700);
    expect(bonuses.filter((id) => !db.items?.[id])).toEqual([]);
  });

  // batch 035 premise: equipment-5218 "A lookout's spyglass can be used as a typical spyglass to see eight times farther than normal, but it also has the following activation."
  it('exempts a bonus whose parent item reads, and NOT one whose parent is bare or missing', () => {
    // mutation-proof — stunts the exempt() key 'itemBonus' by emptying the parent item it depends on.
    const withParent = { items: { 'lookouts-spyglass': { description: 'This brass and wood spyglass…' } } };
    expect(exempt('itemBonus', {}, 'lookouts-spyglass', withParent, NO_DESCS)).toContain('parent item');

    // The bare and missing legs use an id no ast tree knows: since public/ast-index.json gained the
    // refresh's rows (2026-09-12) a bare `lookouts-spyglass` reads through the items tree, which is the
    // rule working — the legs below are about a parent with NO text on any surface.
    const bareParent = { items: { 'zz-spyglass-with-no-tree': { name: 'Spyglass With No Tree' } } };
    expect(exempt('itemBonus', {}, 'zz-spyglass-with-no-tree', bareParent, NO_DESCS)).toBeNull();
    expect(exempt('itemBonus', {}, 'zz-spyglass-with-no-tree', { items: {} }, NO_DESCS)).toBeNull();
  });

  // batch 035 premise: equipment-5220 "Etching a weapon property rune onto the _Azlanti Diamond_ is free—it never costs money to etch a rune onto this artifact."
  it('does not exempt a record in another bucket that happens to share a readable item slug', () => {
    const withParent = { items: { 'lookouts-spyglass': { description: 'This brass and wood spyglass…' } } };
    expect(exempt('feats', {}, 'lookouts-spyglass', withParent, NO_DESCS)).toBeNull();
  });
});

describe('batch 035 — readable-record-check: source is a book, not a rules record (new exempt rule)', () => {
  // batch 035 premise: source-370 "**Product Line** Adventures"
  it('exempts the source bucket and nothing else with the same empty shape', () => {
    // mutation-proof — stunts the exempt() key 'source' by moving the identical bare record into a
    // rules bucket, where it must still count as a hole.
    const book = { id: 'the-dead-gods-hand', name: "The Dead God's Hand" };
    expect(exempt('source', book, 'the-dead-gods-hand', {}, NO_DESCS)).toContain('book entry');
    expect(exempt('feats', book, 'the-dead-gods-hand', {}, NO_DESCS)).toBeNull();
    expect(exempt('sidebar', book, 'the-dead-gods-hand', {}, NO_DESCS)).toBeNull();
  });

  // batch 035 premise: source-371 "**Source Group** Revenge of the Runelords"
  it('leaves the two pre-existing exemptions exactly as they were', () => {
    expect(exempt('modes', {}, 'item-anything', {}, NO_DESCS)).toContain('synthetic mode');
    expect(exempt('items', { itemType: 'treasure' }, 'amber-lump', {}, NO_DESCS)).toContain('treasure');
    expect(exempt('items', { itemType: 'weapon' }, 'amber-lump', {}, NO_DESCS)).toBeNull();
  });
});
