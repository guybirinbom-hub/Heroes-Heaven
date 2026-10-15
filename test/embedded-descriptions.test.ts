import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
import {
  loadBaseline, missingRefs, optionListsInRow, recordReader, syncOptionDescriptions, syncOverlayValue,
} from '../scripts/lib/embedded-descriptions.mjs';

/**
 * scripts/lib/embedded-descriptions.mjs and its guard scripts/embedded-description-check.mjs (npm run verify).
 *
 * 2026-09-30, the regenerating lane: a class option's embedded description (the Builder's option list, and the
 * sheet's classChoices[].description) is its classFeatures record's — 46 of 250 had drifted (the School of Battle
 * Magic's "Chain Lightning," for "Chain Lightning, Disintegrate"). The lane's refuters found three holes, each
 * pinned here: the sync took the text without the record's links (the animist's Lamentation of Sinister Deals,
 * 11 of 15), the baseline "only shrinks" in name only (nothing stopped a line being added), and nothing but a
 * regeneration would notice a chain step that stopped calling the sync.
 */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });

const ROOT = path.join(__dirname, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

type Ref = { key: string; label: string };
type Opt = { id: string; name?: string; description?: string; descRefs?: Ref[] };

/** A two-class db: a wizard school list and an animist apparition group, records inline (pre-split). */
function db() {
  return {
    classes: {
      wizard: { subclass: { name: 'School', options: [
        { id: 'school-of-battle', description: 'Chain Lightning,', descRefs: [{ key: 'spells', label: 'Chain Lightning' }] },
        { id: 'school-of-kept', description: 'short ruled text' },
        { id: 'no-record-option', description: 'authored' },
      ] as Opt[] } },
      animist: { extraChoices: [{ id: 'apparition', options: [
        { id: 'lamentation', description: 'Paraphrase.', descRefs: [{ key: 'spells', label: 'Fly' }, { key: 'feats', label: 'Only Mine' }] },
      ] as Opt[] }] },
    },
    classFeatures: {
      'school-of-battle': { description: 'Chain Lightning, Disintegrate', descRefs: [{ key: 'spells', label: 'Chain Lightning' }, { key: 'spells', label: 'Disintegrate' }] },
      'school-of-kept': { description: 'the record\'s longer but overruled text', descRefs: [{ key: 'rules', label: 'overruled' }] },
      lamentation: { description: 'The printed prose.', descRefs: [{ key: 'spells', label: 'Fly' }, { key: 'rules', label: 'infernal contracts' }] },
    },
  } as any;
}

describe('syncOptionDescriptions — the record\'s text AND its links', () => {
  it('takes the record\'s text, adds its missing links after the option\'s own, and never removes a link', () => {
    const d = db();
    const out = syncOptionDescriptions(d, recordReader(d), new Set(['wizard/school-of-kept']));
    expect(out.synced.sort()).toEqual(['animist/lamentation', 'wizard/school-of-battle']);
    expect(out.linked.sort()).toEqual(['animist/lamentation', 'wizard/school-of-battle']);
    expect(out.kept).toEqual(['wizard/school-of-kept']);
    const battle = d.classes.wizard.subclass.options[0];
    expect(battle.description).toBe('Chain Lightning, Disintegrate');
    expect(battle.descRefs.map((r: Ref) => r.label)).toEqual(['Chain Lightning', 'Disintegrate']);
    const lament = d.classes.animist.extraChoices[0].options[0];
    expect(lament.description).toBe('The printed prose.');
    // the option's own "Only Mine" link stays; the record's "infernal contracts" is added; "Fly" is not doubled
    expect(lament.descRefs.map((r: Ref) => r.label)).toEqual(['Fly', 'Only Mine', 'infernal contracts']);
  });

  it('leaves a baselined option — text and links — exactly as the writers made it', () => {
    const d = db();
    syncOptionDescriptions(d, recordReader(d), new Set(['wizard/school-of-kept']));
    expect(d.classes.wizard.subclass.options[1]).toEqual({ id: 'school-of-kept', description: 'short ruled text' });
  });

  it('never touches an option with no classFeatures record', () => {
    const d = db();
    syncOptionDescriptions(d, recordReader(d), new Set());
    expect(d.classes.wizard.subclass.options[2]).toEqual({ id: 'no-record-option', description: 'authored' });
  });

  it('reads the split file first (d / r) and the inline record second', () => {
    const d = db();
    const read = recordReader(d, { classFeatures: { lamentation: { d: 'split text', r: [{ key: 'x', label: 'y' }] } } });
    expect(read('lamentation')).toEqual({ text: 'split text', refs: [{ key: 'x', label: 'y' }] });
    expect(read('school-of-battle')?.text).toBe('Chain Lightning, Disintegrate');
    expect(read('nope')).toBeNull();
  });

  it('missingRefs matches on key AND label', () => {
    expect(missingRefs({ descRefs: [{ key: 'spells', label: 'Fly' }] }, [{ key: 'actions', label: 'Fly' }, { key: 'spells', label: 'Fly' }]))
      .toEqual([{ key: 'actions', label: 'Fly' }]);
  });
});

describe('syncOverlayValue — what regen-durability-check compares a whole-list overlay row with', () => {
  it('finds the option lists in every row shape that writes one, and none in any other row', () => {
    const opts = [{ id: 'a' }];
    expect(optionListsInRow({ category: 'classes', field: 'options', path: ['subclass'] }, opts)).toEqual([opts]);
    expect(optionListsInRow({ category: 'classes', field: 'options', path: ['extraChoices', 'id=apparition'] }, opts)).toEqual([opts]);
    expect(optionListsInRow({ category: 'classes', field: 'subclass' }, { options: opts })).toEqual([opts]);
    expect(optionListsInRow({ category: 'classes', field: 'extraChoices' }, [{ id: 'g', options: opts }])).toEqual([opts]);
    expect(optionListsInRow({ category: 'classFeatures', field: 'options', path: ['subclass'] }, opts)).toEqual([]);
    expect(optionListsInRow({ category: 'classes', field: 'description' }, 'text')).toEqual([]);
  });

  // A stale row is what the chain would reproduce THROUGH the sync; the guard's overlay half (below) is what
  // stops such a row being written in the first place.
  it('passes a stale row through the same sync — what a regeneration reproduces from it — without touching the row', () => {
    const d = db();
    const row = { category: 'classes', id: 'wizard', field: 'options', path: ['subclass'], value: JSON.parse(JSON.stringify(d.classes.wizard.subclass.options)) };
    const before = JSON.stringify(row.value);
    const got = syncOverlayValue(row, recordReader(d), new Set(['wizard/school-of-kept']));
    expect(JSON.stringify(row.value)).toBe(before);
    expect(got[0].description).toBe('Chain Lightning, Disintegrate');
    expect(got[1].description).toBe('short ruled text');
    const other = { category: 'feats', id: 'x', field: 'description', value: 'v' };
    expect(syncOverlayValue(other, recordReader(d))).toBe('v');
  });
});

/** Run the guard over a throwaway core / descriptions / baseline. */
function guard(core: object, baseline: Record<string, string>, ceiling: number, overlay: object[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'embedded-desc-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'core.json'), JSON.stringify(core));
  writeFileSync(path.join(dir, 'core-descriptions.json'), '{}');
  writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify(baseline));
  writeFileSync(path.join(dir, 'overlay.json'), JSON.stringify(overlay));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/embedded-description-check.mjs')], {
    cwd: ROOT, encoding: 'utf8',
    env: {
      ...process.env, CORE: path.join(dir, 'core.json'), DESC: path.join(dir, 'core-descriptions.json'), BASELINE: path.join(dir, 'baseline.json'),
      BASELINE_CEILING: String(ceiling), OVERLAY: path.join(dir, 'overlay.json'),
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('scripts/embedded-description-check.mjs', () => {
  const synced = () => { const d = db(); syncOptionDescriptions(d, recordReader(d), new Set(['wizard/school-of-kept'])); return d; };
  const KEEP = { 'wizard/school-of-kept': 'a batch ruling pinned the shorter text' };

  it('passes a synced db whose baseline sits at its ceiling', () => {
    const r = guard(synced(), KEEP, 1);
    expect(r.out).toContain('embedded-description-check: OK');
    expect(r.code).toBe(0);
  });

  it('fails a drifted text, naming the class, the option and the record', () => {
    const d = synced();
    d.classes.wizard.subclass.options[0].description = 'Chain Lightning,';
    const r = guard(d, KEEP, 1);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/wizard subclass school-of-battle \(record classFeatures\/school-of-battle\)/);
  });

  it('fails an option that lacks one of its record\'s links (the Lamentation of Sinister Deals case)', () => {
    const d = synced();
    d.classes.animist.extraChoices[0].options[0].descRefs = [{ key: 'spells', label: 'Fly' }];
    const r = guard(d, KEEP, 1);
    expect(r.code).toBe(1);
    expect(r.out).toContain('lacks 1 of the record\'s 2 link(s): infernal contracts -> rules');
  });

  it('fails a baseline line whose option now agrees with its record (the baseline shrinks)', () => {
    const r = guard(synced(), { ...KEEP, 'wizard/school-of-battle': 'no longer true' }, 2);
    expect(r.code).toBe(1);
    expect(r.out).toContain('STALE BASELINE wizard/school-of-battle');
  });

  it('fails a baseline that grew past its ceiling — a line cannot be added to hide a drift', () => {
    const d = synced();
    d.classes.wizard.subclass.options[0].description = 'Chain Lightning,';
    const r = guard(d, { ...KEEP, 'wizard/school-of-battle': 'hide the drift' }, 1);
    expect(r.code).toBe(1);
    expect(r.out).toContain('BASELINE GREW');
  });

  it('fails a ceiling left above the live baseline — the ratchet guards only at the live count', () => {
    const r = guard(synced(), KEEP, 2);
    expect(r.code).toBe(1);
    expect(r.out).toContain('CEILING STALE');
  });

  /*
   * THE OVERLAY HALF (2026-09-30, the lane's second refuter): the durability checks compare a whole-list row
   * THROUGH the sync, so a row whose option text differed from its record's would be overwritten on every regen
   * with no check failing. The guard fails it instead — at a787fb0 it named 12 such row options (rows 6229, 13286,
   * 13289, 13330, 14163, 14164: the Battle Magic school among them).
   */
  const wizardRow = (options: Opt[]) => ({ category: 'classes', id: 'wizard', field: 'options', path: ['subclass'], value: options });

  it('fails an overlay row that restates an option with text that is not its record\'s — the sync would silently overwrite it', () => {
    const d = synced();
    const stale = JSON.parse(JSON.stringify(d.classes.wizard.subclass.options)) as Opt[];
    stale[0].description = 'Chain Lightning,';
    const r = guard(d, KEEP, 1, [{ category: 'feats', id: 'x', field: 'description', value: 'v' }, wizardRow(stale)]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('OVERLAY ROW #1 classes/wizard ["subclass"].options restates school-of-battle with text that is not classFeatures/school-of-battle\'s');
    expect(r.out).toContain('1 overlay row option(s) the sync would silently overwrite');
  });

  it('passes a row carrying its records\' text — a baselined option keeps its own, and a missing record link is the sync\'s to add', () => {
    const d = synced();
    const rowOpts = JSON.parse(JSON.stringify(d.classes.wizard.subclass.options)) as Opt[];
    rowOpts[0].descRefs = [{ key: 'spells', label: 'Chain Lightning' }]; // lacks the record's Disintegrate link
    expect(rowOpts[1].description).toBe('short ruled text'); // baselined: the row may carry the ruled text
    const r = guard(d, KEEP, 1, [wizardRow(rowOpts)]);
    expect(r.out).toContain('1 overlay row(s) write a class option list; 1 of their 1 record-backed, unbaselined option(s) restate the record\'s text');
    expect(r.code).toBe(0);
  });

  it('pins the ceiling at the measured baseline: exactly one declaration, equal to the baseline file\'s line count', () => {
    const src = readFileSync(path.join(ROOT, 'scripts/embedded-description-check.mjs'), 'utf8');
    const decls = [...src.matchAll(/const BASELINE_CEILING = (\d+);/g)];
    expect(decls).toHaveLength(1);
    // 2026-09-30: 10 thaumaturge implements (batch 28) + 3 magus hybrid studies (batch P02). 15 -> 13 the same day:
    // the two damaged RECORDS (light-mortar-innovation, necromancer/puppeteer) were repaired from innovation-4 and
    // fatal-method-1 by overlay description rows, so their lines left. Raising this is a decision, made with its reason.
    expect(Number(decls[0][1])).toBe(13);
    expect(loadBaseline(ROOT).size).toBe(13);
    expect([...loadBaseline(ROOT).keys()].filter((k) => !/^(thaumaturge|magus)\//.test(k)), 'only ruling-pinned options stay').toEqual([]);
  });
});

describe('every writer of a class option list runs the sync, and the durability check compares through it', () => {
  const src = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

  it.each(['scripts/import-core-v2.mjs', 'scripts/import-siege-and-gaps.mjs', 'scripts/import-new-classes.mjs'])(
    '%s calls syncOptionDescriptions with recordReader before its last core.json write',
    (f) => {
      const text = src(f);
      const call = text.lastIndexOf('syncOptionDescriptions(');
      expect(call).toBeGreaterThan(-1);
      expect(text.slice(call, call + 200)).toContain('recordReader(');
      // import-siege-and-gaps writes through a DRY branch after the sync; the others write core.json directly
      const write = Math.max(text.lastIndexOf('writeFileSync(OUT'), text.lastIndexOf('writeFileSync(CORE'), text.lastIndexOf('if (DRY)'));
      expect(write).toBeGreaterThan(call);
    },
  );

  it('scripts/regen-durability-check.mjs compares every overlay row through syncOverlayValue', () => {
    expect(src('scripts/regen-durability-check.mjs')).toMatch(/eq\(got, syncOverlayValue\(fix, optionRecord, embeddedKeep\)\)/);
  });
});
