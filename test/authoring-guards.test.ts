import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARDS FOR THE AUTHORING PIPELINE ITSELF.
 *
 * Six thousand feats are being audited and fixed a hundred at a time. Every fix writes a value
 * somewhere, and this project's history says there are exactly two ways a fix silently fails to exist:
 *
 *   1. THE FIELD HAS NO READER. Nothing in src/ mentions it, so whatever the data says no pixel moves.
 *      `BattleForm.size` and `.tempHp` were authored on 21 modes and read by nothing; the two feat
 *      paths wrote `grantedRepertoire` and neither rendered it. Both times the suite was green.
 *   2. THE VALUE IS IN THE WRONG FILE. Some scripts rebuild their records whole, so a field added
 *      anywhere else is deleted at their next run — no error, no diff, just gone.
 *
 * Neither is catchable by testing behaviour, because there is no behaviour to test. They are only
 * catchable structurally. These are cheap and they run on every commit.
 */
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every .ts/.tsx under src/, concatenated. The question is only ever "does this name appear at all". */
const srcText = (() => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(ROOT, 'src'));
  return out.join('\n');
})();

type Row = { category: string; id: string; field: string; path?: string; value: unknown; create?: boolean };
const overlay: Row[] = JSON.parse(read('scripts/data/effect-backfill.json'));

describe('every field authored into the overlay has a reader in src/', () => {
  it('or it cannot reach the sheet, whatever the data says', () => {
    /* Two kinds of row are not a field being SET, and both were false positives the first time this
     * ran (`__record` and `baseItem`):
     *   · `create: true` inserts a WHOLE record — `applyBackfill` branches on `create` and never looks
     *     at `field`, which is the label `__record`. Twelve trait records arrive this way.
     *   · `value: null` DELETES the field. Nothing reading it is the point of the row. */
    const setsAField = overlay.filter((r) => !r.create && r.field !== '__record' && r.value !== null);
    const fields = [...new Set(setsAField.map((r) => r.field))];
    const orphaned = fields.filter((f) => !srcText.includes(f));
    expect(
      orphaned.length
        ? `authored but never read anywhere in src/: ${orphaned.join(', ')}\n` +
          'Either give it a reader, or the value cannot reach a pixel and should not be authored.'
        : 'all authored fields are read',
    ).toBe('all authored fields are read');
  });
});

describe('the scripts that own a record outright', () => {
  /**
   * A script that REPLACES a record rather than merging into it owns every field on that record, so a
   * value authored anywhere else is deleted at its next run. Two do this:
   *   apply-battle-forms.mjs      rebuilds all 16 battle-form mode objects
   *   apply-situational-lane.mjs  generates src/rules/situationalBonuses.ts outright
   *
   * ⚠ These assertions are EXACT, not a sweep. A regex hunting the pattern across 92 scripts was tried
   * and thrown away: tuned to catch both known cases it flagged eleven innocent ones, and tuned to stay
   * quiet it missed both. A guard that silently misses is worse than no guard, because it reads as
   * coverage. So each known owner is pinned by its own line, and a NEW owner is caught by review and by
   * `npm run feat`, which reports the owner of whatever record you ask it about.
   */
  it('apply-battle-forms.mjs still REPLACES its mode objects', () => {
    const s = read('scripts/apply-battle-forms.mjs');
    const at = s.search(/core\.modes\[id\]\s*=/);
    expect(at, 'the whole-object assignment is gone — if this is now a merge, the hazard is gone too and the warnings about it should go with it').toBeGreaterThan(-1);
    expect(s.slice(at, at + 200)).not.toContain('...core.modes[id]');
  });

  it('and src/rules/situationalBonuses.ts is still GENERATED, so hand edits get overwritten', () => {
    const gen = read('scripts/apply-situational-lane.mjs');
    expect(gen).toContain('src/rules/situationalBonuses.ts');
    expect(gen).toMatch(/writeFileSync\(REGISTRY/);
  });

  /**
   * ⚠ src/rules/situationalBonuses.ts HAS NO SINGLE OWNER — a dozen-plus scripts write it.
   *
   * It is the registry for the whole situational-bonus lane, and the one the owner's Round 11 R2 ruling
   * has to edit across 69 records. Many scripts parse it, splice their entries in and write it back, so
   * whichever ran last decides what is in it. "Put the value in the script that owns the record" — the
   * rule that keeps every other lane durable — has no clean answer here, and the next person to author
   * a situational bonus has to guess which script to reach for.
   *
   * There is DELIBERATELY no exact count asserted here. Three different detections gave 3, 14 and 24,
   * because "writes this file" is genuinely hard to tell from "reads this file and writes something
   * else". Pinning a number I cannot measure reliably would be a test that fails for the wrong reason
   * and gets its expectation bumped until it means nothing. The qualitative fact is what matters and
   * it is recorded in CLAUDE.md; the assertion below is the part that IS reliable.
   */
  it('is generated by apply-situational-lane.mjs, and more than one script writes it', () => {
    const dir = join(ROOT, 'scripts');
    const mentions = readdirSync(dir)
      .filter((n) => n.endsWith('.mjs'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('situationalBonuses.ts'));
    // If this ever drops to one, the lane has a single owner and the warnings about it can go.
    expect(mentions.length).toBeGreaterThan(1);
    expect(mentions).toContain('apply-situational-lane.mjs');
  });

  /**
   * RECORD_MARKERS was a loaded gun of exactly the apply-reviewed.ts kind.
   *
   * `scripts/apply-rulings-dfgh.mjs` builds its `markers` map from work/dfgh/raw.json alone — six
   * records, confirmed by its own `--dry` output — and then ASSIGNED the whole `RECORD_MARKERS` object
   * literal from it. That literal holds well over a hundred entries: the ruling-D/F/G/H six, the twelve
   * oracle curses, the thirty-six from the feature audit, and every hand-authored row since. One re-run
   * would have deleted all the rest with no error and no diff to notice. Measured before the fix by
   * simulating its own assignTable in memory: 119 entries → 6, and SPELL_MARKERS 2 → 1.
   *
   * It merges now, with apply-sweep-b1.mjs's semantics (existing keys win). These two assertions are
   * the guard: the first fails if anyone reintroduces a wholesale assign, the second is the ratchet
   * that fails if the table is ever actually flattened, whichever script does it.
   */
  it('apply-rulings-dfgh.mjs MERGES the marker tables instead of replacing them', () => {
    const s = read('scripts/apply-rulings-dfgh.mjs');
    expect(s, 'a wholesale assign is back — it would delete every entry this script does not itself generate').not.toContain('assignTable(');
    for (const decl of ['RECORD_MARKERS', 'SITUATIONAL_SUPERSEDES', 'SPELL_MARKERS']) {
      const at = s.indexOf(`'export const ${decl}`);
      expect(at, decl).toBeGreaterThan(-1);
      // the call that precedes the declaration string in the source is the one that writes it
      expect(s.slice(Math.max(0, at - 120), at), decl).toContain('mergeTable(');
    }
  });

  it('RECORD_MARKERS still holds every row anyone authored into it', () => {
    const src = read('src/rules/situationalBonuses.ts');
    const decl = 'export const RECORD_MARKERS: Record<string, RecordMarker[]> =';
    const open = src.indexOf('{', src.indexOf(decl) + decl.length - 1);
    const body = src.slice(open + 1, src.indexOf('\n};', open));
    const keys = [...body.matchAll(/^\s*['"]?([a-z0-9-]+)['"]?\s*:/gm)].map((m) => m[1]);
    // A ratchet, not an exact count: rows are added constantly, and only a LOSS is a bug.
    expect(keys.length).toBeGreaterThanOrEqual(119);
    expect(keys).toContain('animal-companion-ranger');
    expect(new Set(keys).size, 'a duplicate key silently deletes the entry it lands on').toBe(keys.length);
  });
});

describe('the scripts under scripts/aon-verify/ cannot run by being imported', () => {
  /**
   * Every `apply-*.ts` there is a top-level script that rewrites files under src/rules/ WHOLE the
   * moment it loads. Importing one to look at it is therefore a write — and that is not hypothetical:
   * a read-only probe imported `apply-reviewed.ts` to inspect its serialiser, the script ran, and
   * src/rules/featGrantsAuto.ts and featFeatGrants.ts had to be diffed against HEAD and reverted.
   *
   * `_entry-guard.ts` throws unless the module IS the entry point. This asserts every writer calls it,
   * because a guard one script forgets is the script that will be imported next.
   *
   * ⚠ This directory is `.ts`, so the `.mjs` sweeps elsewhere in this file never looked at it. That
   * gap is why the hazard survived being documented.
   */
  it('every writer in that folder calls requireDirectRun', () => {
    const dir = join(ROOT, 'scripts/aon-verify');
    /* ⚠ The folder is GITIGNORED — local audit tooling, deliberately not shipped — so on a fresh clone
     * it does not exist and `readdirSync` would throw. Skipping is right: the hazard is only reachable
     * where the scripts are, and a test that fails for everyone who has not run the AoN verification is
     * one people learn to ignore. */
    if (!existsSync(dir)) return;
    const writers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== '_entry-guard.ts')
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('writeFileSync'));
    expect(writers.length, 'no writers found — did the folder move?').toBeGreaterThan(0);
    const unguarded = writers.filter((f) => !readFileSync(join(dir, f), 'utf8').includes('requireDirectRun(import.meta.url)'));
    expect(
      unguarded,
      'These write files but do not refuse to run when imported. Add:\n' +
        "  import { requireDirectRun } from './_entry-guard.ts';\n  requireDirectRun(import.meta.url);",
    ).toEqual([]);
  });
});

describe('descriptions damaged at import', () => {
  /**
   * A RATCHET, not a target. 866 descriptions carry a value the importer deleted while leaving the
   * sentence grammatical — "races away from you in a ." was "in a 60-foot line". That text is a live
   * player surface: MainTab's action popup renders `description` through RichText with no ast key.
   *
   * The number may only go DOWN. Repairs go in scripts/apply-import-damaged-text.mjs (which writes the
   * overlay row AND public/core-descriptions.json — the documented shortcut does not materialise this
   * field). If it goes UP, an import or an edit has damaged more text and this is where that surfaces
   * rather than in a player's hands.
   *
   * The shapes come from the scanner itself rather than a copy of them, so the CLI and this test
   * cannot drift — two registries for one rule is the failure this project keeps repeating.
   */
  const BASELINE = 866;

  it(`is at most ${BASELINE} records, and that number only ever goes down`, async () => {
    const { scan } = await import('../scripts/scan-damaged-descriptions.mjs');
    const desc = JSON.parse(read('public/core-descriptions.json'));
    const { damaged, scanned } = scan(desc);
    expect(scanned).toBeGreaterThan(19000);
    expect(
      damaged.size,
      damaged.size > BASELINE
        ? `Import damage went UP (${BASELINE} → ${damaged.size}). Run \`npm run scan:text --list\` and find what changed.`
        : `Damage is down to ${damaged.size} — lower BASELINE to ${damaged.size} so it cannot creep back.`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it('and the four already repaired stay repaired', async () => {
    const desc = JSON.parse(read('public/core-descriptions.json'));
    expect(desc.feats['aerial-boomerang'].d).toContain('60-foot line');
    expect(desc.feats['aerial-boomerang'].d).toContain('2d4 slashing damage with a basic Reflex save');
    expect(desc.feats['breath-of-the-dragon-dragonblood'].d).toContain('15-foot cone or a 30-foot line');
    expect(desc.feats['battle-medicine'].d).toContain('immune to your Battle Medicine');
    expect(desc.actions['treat-wounds'].d).toContain('temporarily immune to Treat Wounds');
  });

  it('and every repair is mirrored into the overlay, or it dies at the next regen', () => {
    const desc = JSON.parse(read('public/core-descriptions.json'));
    const drifted = overlay
      .filter((r) => r.field === 'description' && !r.create)
      .filter((r) => {
        const shipped = desc[r.category]?.[r.id]?.d;
        return shipped !== undefined && shipped !== r.value;
      })
      .map((r) => `${r.category}/${r.id}`);
    expect(drifted, 'the overlay and the shipped description disagree — one of them is stale').toEqual([]);
  });
});

describe('the redundancy clause', () => {
  /**
   * "If you would already be trained in <skill>, you instead become trained in a skill of your choice."
   * One boolean, `redundantFallback`, and without it the grant collides with training the character
   * already has and the player silently loses a skill the feat owed them.
   *
   * The audit found six by reading six feats; a scan found 84. This keeps it at zero, using the same
   * detector the scanner and the applier use rather than a third copy of the regex.
   */
  it('is authored on every grant that prints it — no exceptions, or a player loses a skill', async () => {
    const { audit } = await import('../scripts/scan-redundant-fallback.mjs');
    const { missing } = audit();
    expect(
      missing,
      'These print "trained in a skill of your choice" and carry no redundantFallback.\n' +
        'Fix with: npx jiti scripts/apply-redundant-fallback.mjs',
    ).toEqual([]);
  });
});

describe('the hand-authored grant maps', () => {
  /**
   * A DUPLICATE KEY in an object literal is not an error — the last one silently wins and everything
   * the earlier entry said is discarded. A script appending `'x': {…}` to a map that already contains
   * `'x'` therefore deletes the original's fields while looking like it added something, and every
   * individual line still parses, so a per-line check does not see it. TypeScript catches it (TS1117)
   * only if someone runs `tsc`; this catches it in the suite, next to the data it protects.
   *
   * It has happened: an applier appended a `weaponFamiliarity` entry for a record that already had a
   * `skills` + `rankUpgrade` entry, which would have removed the skill grant and the rank ladder.
   */
  const MAPS = ['src/rules/featGrantsLane.ts', 'src/rules/featGrantsAuto.ts', 'src/rules/featFeatGrants.ts', 'src/rules/featGrants.ts'];

  /* ⚠ PER MAP, not per file. `featFeatGrants.ts` exports THREE maps — FEAT_FEAT_GRANTS_LEVELED,
   * FEAT_GRANT_BOUND_CHOICE and FEAT_FEAT_GRANTS — and the same record legitimately appears in each,
   * because they answer different questions about it. A per-file scan reported five "duplicates" that
   * were all correct. Only a repeat inside ONE object literal is the silent-overwrite bug. */
  const mapsIn = (text: string) => {
    const out: { name: string; body: string }[] = [];
    for (const m of text.matchAll(/^export const (\w+)[^=]*= \{$/gm)) {
      const start = m.index! + m[0].length;
      const end = text.indexOf('\n};', start);
      out.push({ name: m[1], body: text.slice(start, end < 0 ? undefined : end) });
    }
    return out;
  };

  it('declare each record id exactly once within any one map', () => {
    const dupes: string[] = [];
    for (const p of MAPS) {
      for (const { name, body } of mapsIn(read(p))) {
        const seen = new Map<string, number>();
        for (const m of body.matchAll(/^  '([a-z0-9-]+)':/gm)) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
        for (const [id, n] of seen) if (n > 1) dupes.push(`${p} → ${name}: '${id}' declared ${n} times`);
      }
    }
    expect(
      dupes,
      'A later duplicate silently replaces the earlier one and everything it said is lost.\n' +
        'MERGE the new fields into the existing entry instead of appending a second.',
    ).toEqual([]);
  });
});

describe('the overlay is the only thing that survives a regen', () => {
  it('so its size is pinned — a pass that authors 40 fields and forgets it shows up as a drop', () => {
    expect(overlay.length).toBeGreaterThan(7000);
  });

  it('and every row names a real record', () => {
    const core = JSON.parse(read('public/core.json')) as Record<string, Record<string, unknown>>;
    const missing = overlay.filter((r) => !core[r.category]?.[r.id]).map((r) => `${r.category}/${r.id}`);
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('a rule about ONE Lore, authored as EVERY Lore', () => {
  /**
   * A target of bare `lore` (or `lore:*`) is read by `targetMatches` as EVERY `lore:*` row the
   * character owns. That is right for "a Lore skill you're trained in" and wrong for "an Alghollthu
   * Lore check", which reaches exactly one row — and both are spelled the same way, which is why the
   * shape keeps coming back.
   *
   * The batch-001 audit named ONE record. The scan found THREE, the other two in records nobody had
   * read (`golden-league-xun-dedication`, `wandering-chef-dedication`). This holds it at zero.
   */
  it('every wildcard Lore target is a rule that really does apply to any Lore', async () => {
    const { scan } = (await import('../scripts/scan-lore-wildcard.mjs')) as {
      scan: () => { findings: { source: string; id: string; named: string[] }[]; okWildcards: unknown[] };
    };
    const { findings, okWildcards } = scan();
    expect(
      findings.map((f) => `${f.source}/${f.id}: names ${f.named.join(' + ')}`),
      'These target EVERY Lore while their own text names one.\n' +
        'Narrow the target to `lore:<subject>` (matching is case-insensitive), or add a reasoned EXEMPT row.',
    ).toEqual([]);
    // The scan must still be LOOKING at something — a broken parse reports zero just as happily.
    expect(okWildcards.length).toBeGreaterThan(15);
  });

  it('the detector still fires on the shape it was built for', async () => {
    // Guarding the guard: measuring scripts in this project have produced confident wrong answers, so
    // the pattern is checked against strings known to be each kind before its count is believed.
    const { namedLore } = (await import('../scripts/scan-lore-wildcard.mjs')) as { namedLore: (s: string) => string[] };
    expect(namedLore('on an Alghollthu Lore or Azlanti Lore check to Recall Knowledge')).toHaveLength(2);
    expect(namedLore('when you use Underworld Lore to Earn Income')).toHaveLength(1);
    expect(namedLore('when you Recall Knowledge using a Lore subcategory you are trained in')).toHaveLength(0);
    expect(namedLore('when you use Lore to Earn Income')).toHaveLength(0);
    expect(namedLore('to Recall Knowledge using either of the two Lore skills this heritage made you trained in')).toHaveLength(0);
  });
});

describe('the manual skill-substitution rows reached the data', () => {
  /**
   * `scripts/backfill-skill-substitutions.mjs` PARSES every row from the record's own description, so
   * a record whose wording the regex cannot see gets its row from
   * `scripts/lib/manual-skill-substitutions.mjs` instead. A hand-written table is worth something only
   * if it matches what shipped — and the applier that lands it is a separate entry point, so "edited
   * the table, never ran the applier" is a real way for this to rot.
   *
   * Fix a failure with: node scripts/apply-manual-skill-substitutions.mjs
   */
  it('every table row is on the record AND in the overlay', async () => {
    const { MANUAL_SKILL_SUBSTITUTIONS } = (await import('../scripts/lib/manual-skill-substitutions.mjs')) as {
      MANUAL_SKILL_SUBSTITUTIONS: Record<string, { when?: string }[]>;
    };
    const core = JSON.parse(read('public/core.json')) as Record<string, Record<string, { skillSubstitutions?: unknown }>>;
    const drift: string[] = [];
    expect(Object.keys(MANUAL_SKILL_SUBSTITUTIONS).length).toBeGreaterThan(0);
    for (const [key, subs] of Object.entries(MANUAL_SKILL_SUBSTITUTIONS)) {
      const at = key.indexOf('/');
      const [coll, id] = [key.slice(0, at), key.slice(at + 1)];
      const want = JSON.stringify(subs);
      if (JSON.stringify(core[coll]?.[id]?.skillSubstitutions) !== want) drift.push(`${key}: core.json disagrees`);
      const row = overlay.find((r) => r.category === coll && r.id === id && r.field === 'skillSubstitutions');
      if (!row) drift.push(`${key}: no overlay row — it dies at the next \`npm run data\``);
      else if (JSON.stringify(row.value) !== want) drift.push(`${key}: the overlay disagrees`);
      // A row with no `when` MOVES the skill's number rather than starring it (deriveSkill vs
      // authoredSituational) — a different mechanic, and never what these rows mean.
      for (const s of subs) if (!s.when) drift.push(`${key}: a row with no \`when\``);
    }
    expect(drift, 'run: node scripts/apply-manual-skill-substitutions.mjs').toEqual([]);
  });
});
