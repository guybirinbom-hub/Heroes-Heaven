import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every case builds a throwaway git repo and runs the audit as a real node child — git plus a cold
 * node boot per case, several times slower under the full suite. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { BOOKKEEPING, auditBatch, clauseInDoc, docText, normalizeText, registryKeys } from '../scripts/test-flip-audit.mjs';

/**
 * scripts/test-flip-audit.mjs — the guard from docs/wg-batch-pipeline.md section B: a batch may only
 * loosen an instrument (a test, a settle registry, a ratchet, an experience limit) with a citation
 * back to a CONFIRMED finding or a printed AoN clause.
 *
 * Every case runs against a THROWAWAY fixture repo in the temp dir — never this repo's history, and
 * never this repo's test/ tree, so the audit's own diff can be driven to any shape.
 */

type Files = Record<string, string>;

const B = '030';

function write(root: string, files: Files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
}

const CLEAN_TEST = `import { describe, expect, it } from 'vitest';

describe('spined-shield', () => {
  it('grants the shield spikes', () => {
    expect(1 + 1).toBe(2);
    expect('a').toBe('a');
  });

  it('counts five spines', () => {
    expect(5).toBe(5);
  });
});
`;

const BETA_TEST = `import { describe, expect, it } from 'vitest';

describe('ring-of-wizardry-type-i', () => {
  it('opens the arcane gate', () => {
    expect(3).toBe(3);
  });
});
`;

const RATCHETS = `const HOLE_BASELINE = 162;
const SAVE_DC_BASELINE = 0;
function foot() {
  const FOOT_BASELINE = 96;
  return FOOT_BASELINE;
}
const ARTEFACT_BASELINE = 17;
export { HOLE_BASELINE, SAVE_DC_BASELINE, foot, ARTEFACT_BASELINE };
`;

const DIFF_MJS = `/* comparer */
const VERIFIED_EQUIVALENT = {
  /* a settle with prose and an apostrophe: don't trip the parser { } */
  'spellshifter-dedication': ['grantsRecord'],
  'climbing-animal': ['grantsRecord', 'choice'],
};
export { VERIFIED_EQUIVALENT };
`;

const VALUES_MJS = `const NOT_A_SCALAR = {
  PRIMARY_SHEET_TABS: 'a companion tab, not a value',
};
const SETTLED_VALUES = {
  'creative-prodigy': ['SKILL_DECEPTION'],
};
export { NOT_A_SCALAR, SETTLED_VALUES };
`;

const IDENTITY_MJS = `const SETTLED_IDENTITIES = {
  'spellshifter-dedication': ['grants'],
};
export { SETTLED_IDENTITIES };
`;

const LIMITS = JSON.stringify({
  _: 'instrument limits',
  records: { 'acute-scent': { batch: 9, verdict: 'NO-SHEET-EFFECT' } },
}, null, 2);

const READ = JSON.stringify({
  confirmed: [
    { id: 'spined-shield#granted-spikes', verdict: 'CONFIRMED' },
    { id: 'ring-of-wizardry-type-i#arcane-gate', verdict: 'CONFIRMED' },
    { id: 'climbing-animal#jaws', verdict: 'CONFIRMED' },
    { id: 'spellshifter-dedication#now-resolves', verdict: 'CONFIRMED' },
  ],
  refuted: [{ id: 'hairpin-of-blooming-flowers#burst-text' }],
  askOwner: [{ id: 'resolute-mind-wrap#resistance-upgrade', verdict: 'UNVERIFIED' }],
}, null, 2);

/**
 * ONE throwaway repo for the whole file (git init costs seconds on Windows); every test starts from
 * `reset()`, which puts back the exact baseline working tree without touching the commit.
 */
const root = mkdtempSync(path.join(tmpdir(), 'flip-fixture-'));
const aon = path.join(root, 'aon', 'by-category');
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const TRACKED: Files = {
  'test/alpha.test.ts': CLEAN_TEST,
  'scripts/dropped-inline-check.mjs': RATCHETS,
  'scripts/wg-diff.mjs': DIFF_MJS,
  'scripts/wg-values.mjs': VALUES_MJS,
  'scripts/wg-identity.mjs': IDENTITY_MJS,
};

/*
 * The throwaway AoN mirror. Each doc is shaped like the real export (`markdown` with AoN's tags, links,
 * bold and `\n`; a flattened `text`; a `summary`; the mirror's bookkeeping — `url`, `legacy_id`,
 * `release_date`, the filing categories), because the premise check reads the clause out of the
 * printed fields and must NOT read the bookkeeping — since 2026-10-07 a premise must quote words that
 * ARE in its doc, not just name a doc that exists. item-1234 carries the spines clause the older
 * premise cases cite, and a two-word filing label (`item_category`) that is in no printed field.
 */
const ITEM_1234 = JSON.stringify({
  category: 'item', id: 'item-1234', name: 'Spined Shield', url: '/Equipment.aspx?ID=1234', release_date: '2023-11-15',
  item_category: 'Adventuring Gear', primary_source_category: 'Rulebooks',
  markdown: '<title level="1" right="Item 3">[Spined Shield](/Equipment.aspx?ID=1234)</title>\n\n**Source** [Player Core](/Sources.aspx?ID=216) pg. 1\n\n---\n\nThe spines are +1 striking shield spikes.',
  text: 'Spined Shield Source Player Core pg. 1 --- The spines are +1 striking shield spikes.',
});
/**
 * The real page's shape and words: the crit-spec sentence with its condition LINKED — and ONLY linked.
 * The real doc also carries the sentence unlinked under `summary`; with that field here, the link
 * sub-case below passed whether or not the normaliser's `[label](url)` fold existed (the first refuter's
 * nit 3). Without it, the fold is the only way through: delete the fold and the sub-case goes red.
 */
const WEAPON_GROUP_15 = JSON.stringify({
  category: 'weapon-group', id: 'weapon-group-15', name: 'Sword', type: 'Weapon Critical Specialization',
  url: '/WeaponGroups.aspx?ID=15', release_date: '2023-11-15',
  markdown: '<title\n    level="1"\n    right="Weapon Critical Specialization "\n    pfs=""\n>\n[Sword](/WeaponGroups.aspx?ID=15)\n</title>\n\n**Source** [Player Core](/Sources.aspx?ID=216) pg. 283\n\nThe target is made off-balance by your attack, becoming [off-guard](/Conditions.aspx?ID=58) until the start of your next turn.',
});
/** A feat page with every surface form the normaliser folds: bold label + line break, a curly quote, an
 *  entity, the newer handlebars cross-reference, a sentence wrapped across a line. Synthetic text. Its
 *  bookkeeping fields are the real doc's: the url, the legacy twin's id, the release date, the filing
 *  category, the PFS flag — none of them printed. The `summary` is NOT in its markdown (as a spell's
 *  one-line summary is not), so a clause found only there pins that summaries stay readable. */
const FEAT_4458 = JSON.stringify({
  category: 'feat', id: 'feat-4458', name: 'Halfling Luck', level: 1, url: '/Feats.aspx?ID=4458',
  legacy_id: ['feat-54'], release_date: '2023-11-15', pfs: 'Standard', rarity: 'common',
  primary_source_category: 'Rulebooks', source_category: ['Rulebooks'], trait_group: ['Mechanics', 'Ancestry'],
  exclude_from_search: false, rarity_id: 1,
  markdown: '<title level="1" right="Feat 1" pfs="Standard">\n[Halfling Luck](/Feats.aspx?ID=4458) <actions string="Free Action" />\n</title>\n\n<traits>\n<trait label="Fortune" url="/Traits.aspx?ID=76" />\n</traits>\n\n<column gap="tiny">\n\n**Frequency**\nonce per day\n\n**Trigger**\nYou fail a skill check or saving throw\n\n</column>\n\n---\n\nYou can reroll the triggering check,\nbut you must use the new result, even if it’s worse. Your tools &amp; weapons stay dry. Until then you are {{conditions 58 "off-guard"}}.',
  trigger: 'You fail a skill check or saving throw',
  summary: 'Your happy-go-lucky nature makes it seem like misfortune avoids you.',
});

write(root, {
  ...TRACKED,
  'aon/by-category/item/item-1234.json': ITEM_1234,
  'aon/by-category/weapon-group/weapon-group-15.json': WEAPON_GROUP_15,
  'aon/by-category/feat/feat-4458.json': FEAT_4458,
});
git('init', '-q');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'user.name', 'fixture');
git('add', 'test', 'scripts');
git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'baseline');
const startSha = git('rev-parse', 'HEAD').trim();

const TESTBASE = JSON.stringify({
  startSha,
  untrackedTests: ['test/beta.test.ts'],
  ratchets: {
    'scripts/dropped-inline-check.mjs': {
      HOLE_BASELINE: 162, SAVE_DC_BASELINE: 0, FOOT_BASELINE: 96, ARTEFACT_BASELINE: 17,
    },
  },
  registries: {
    'scripts/wg-diff.mjs': { VERIFIED_EQUIVALENT: ['spellshifter-dedication', 'climbing-animal'] },
    'scripts/wg-values.mjs': { SETTLED_VALUES: ['creative-prodigy'], NOT_A_SCALAR: ['PRIMARY_SHEET_TABS'] },
    'scripts/wg-identity.mjs': { SETTLED_IDENTITIES: ['spellshifter-dedication'] },
  },
  limits: ['acute-scent'],
}, null, 2);

/** The baseline working tree: tracked files at HEAD, plus what the driver's baseline stage writes. */
function reset() {
  write(root, {
    ...TRACKED,
    'test/beta.test.ts': BETA_TEST,                                  // untracked at baseline
    [`work/.b${B}-testbase/test/beta.test.ts`]: BETA_TEST,           // its snapshot
    [`work/.b${B}-testbase.json`]: TESTBASE,
    [`work/.b${B}-read.json`]: READ,
    'work/experience-instrument-limits.json': LIMITS,
  });
  for (const stray of ['test/gamma.test.ts', 'test/test-flip-audit.test.ts']) {
    const abs = path.join(root, stray);
    if (existsSync(abs)) rmSync(abs);
  }
}
beforeEach(reset);

function run() {
  return auditBatch({ root, batch: B, aonRoot: aon }) as {
    violations: { file: string; line: number; change: string; expected: string }[];
    counts: { violations: number; testFiles: number; addedRegistryKeys: number };
  };
}

const changes = (r: ReturnType<typeof run>) => r.violations.map((v) => `${v.file}:${v.line} ${v.change}`).join('\n');

describe('test-flip-audit — an untouched batch', () => {
  it('reports nothing when no instrument moved', () => {
    expect(changes(run())).toBe('');
  });

  it('exempts its own test file, whose fixtures are strings shaped like flips', () => {
    // The one deliberate hole in the scan — pinned here so it stays one file wide.
    write(root, { 'test/test-flip-audit.test.ts': "it.skip('a fixture string', () => {});\n" });
    expect(changes(run())).toBe('');
  });

});

/*
 * RATCHET LANE (2026-09-29): a WHOLLY NEW test file is audited exactly like an added hunk of an existing
 * one. It used to be scanned only for .skip / .only / .todo, so a batch could put any number of uncited
 * assertions in a fresh file — the one place the citation rule never looked. The audit now diffs a new
 * file against the empty string and runs the ordinary scan on it, in both places a new file turns up:
 * untracked in the working tree, and committed inside the batch window (`git diff --name-status` 'A').
 */
const NEW_UNCITED = `import { describe, expect, it } from 'vitest';

describe('spined-shield', () => {
  it('grants the shield spikes', () => {
    expect(1).toBe(1);
  });
});
`;
const NEW_CITED = `import { describe, expect, it } from 'vitest';

describe('spined-shield', () => {
  // batch ${B}: spined-shield#granted-spikes
  it('grants the shield spikes', () => {
    // batch ${B}: spined-shield#granted-spikes
    expect(1).toBe(1);
  });
});
`;

describe('test-flip-audit — a wholly new test file needs the same citations as an added hunk', () => {
  it('refuses an uncited it() and expect() in a new untracked test file, naming the file and the lines', () => {
    write(root, { 'test/gamma.test.ts': NEW_UNCITED });
    const r = run();
    expect(r.violations.map((v) => `${v.file}:${v.line}`)).toEqual(['test/gamma.test.ts:4', 'test/gamma.test.ts:5']);
    expect(r.violations[0].change).toContain('it()/test() changed/added');
    expect(r.violations[1].change).toContain('expect() changed/added');
    expect(r.violations[1].expected).toContain('no citation in the 6 lines above');
    expect(r.violations[1].expected).toContain(`// batch ${B}: <CONFIRMED finding id>`);
  });

  it('accepts a new test file whose every it() and expect() cites the batch\'s CONFIRMED finding', () => {
    write(root, { 'test/gamma.test.ts': NEW_CITED });
    expect(changes(run())).toBe('');
  });

  it('still refuses a citation in a new file that names a finding that is not CONFIRMED', () => {
    write(root, { 'test/gamma.test.ts': NEW_CITED.replace(/spined-shield#granted-spikes/g, 'hairpin-of-blooming-flowers#burst-text') });
    const r = run();
    expect(r.violations).toHaveLength(2);
    expect(r.violations.every((v) => v.file === 'test/gamma.test.ts' && v.expected.includes('but is not CONFIRMED'))).toBe(true);
  });

  it('still fails a .skip in a new test file outright, citation or not', () => {
    write(root, { 'test/gamma.test.ts': NEW_CITED.replace("  it('grants", "  it.skip('grants") });
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].file).toBe('test/gamma.test.ts');
    expect(r.violations[0].line).toBe(5);
    expect(r.violations[0].change).toContain('disabled test');
    expect(r.violations[0].expected).toContain('no batch may add .skip');
  });

  /*
   * The same rule once the new file has been COMMITTED inside the batch window — `git diff
   * --name-status` calls it 'A'. It must not be read through `git show startSha:<rel>` (the file has no
   * blob there); it goes through the same new-file scan as the untracked case.
   */
  it('holds a new test file that has since been committed to the same rule: uncited refused, cited clean, .skip banned', () => {
    write(root, { 'test/gamma.test.ts': NEW_UNCITED });
    git('add', 'test/gamma.test.ts');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'mid-batch: a new test file');
    try {
      expect(run().violations.map((v) => `${v.file}:${v.line}`)).toEqual(['test/gamma.test.ts:4', 'test/gamma.test.ts:5']);
      write(root, { 'test/gamma.test.ts': NEW_CITED });
      expect(changes(run())).toBe('');
      write(root, { 'test/gamma.test.ts': NEW_CITED.replace("  it('grants", "  it.skip('grants") });
      const r = run();
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0].change).toContain('disabled test');
    } finally {
      git('reset', '-q', '--hard', startSha);                        // the fixture repo, never this one
      rmSync(path.join(root, 'test/gamma.test.ts'), { force: true });
    }
  });
});

describe('test-flip-audit — test/ flips', () => {
  it('refuses an uncited expect() change and names the line', () => {
    write(root, { 'test/alpha.test.ts': CLEAN_TEST.replace("expect('a').toBe('a');", "expect('a').toBe('b');") });
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].file).toBe('test/alpha.test.ts');
    expect(r.violations[0].line).toBe(6);
    expect(r.violations[0].change).toContain('expect()');
    expect(r.violations[0].expected).toContain(`// batch ${B}: <CONFIRMED finding id>`);
  });

  it('accepts the change once it cites a CONFIRMED finding whose record id is in the title', () => {
    write(root, {
      'test/alpha.test.ts': CLEAN_TEST.replace(
        "    expect('a').toBe('a');",
        `    // batch ${B}: spined-shield#granted-spikes\n    expect('a').toBe('b');`,
      ),
    });
    expect(changes(run())).toBe('');
  });

  it('refuses a citation whose finding is not CONFIRMED, and one from another batch', () => {
    write(root, {
      'test/alpha.test.ts': CLEAN_TEST
        .replace("    expect('a').toBe('a');", `    // batch ${B}: hairpin-of-blooming-flowers#burst-text\n    expect('a').toBe('b');`)
        .replace('    expect(5).toBe(5);', '    // batch 029: spined-shield#granted-spikes\n    expect(5).toBe(6);'),
    });
    const r = run();
    expect(r.violations).toHaveLength(2);
    expect(r.violations[0].expected).toContain('but is not CONFIRMED');    // a REFUTED finding cites nothing
    expect(r.violations[1].expected).toContain('names batch 029');
  });

  it('refuses a citation whose record id is absent from the enclosing titles', () => {
    write(root, {
      'test/alpha.test.ts': CLEAN_TEST.replace(
        "    expect('a').toBe('a');",
        `    // batch ${B}: ring-of-wizardry-type-i#arcane-gate\n    expect('a').toBe('b');`,
      ),
    });
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].expected).toContain('appears in no enclosing describe/it title');
  });

  it('accepts the premise form only when the AoN mirror really holds the doc', () => {
    // item-1234's fixture doc carries this clause (see ITEM_1234): the case is about the DOC existing.
    const cite = (doc: string) => CLEAN_TEST.replace(
      "    expect('a').toBe('a');",
      `    // batch ${B} premise: ${doc} "The spines are +1 striking shield spikes."\n    expect('a').toBe('b');`,
    );
    write(root, { 'test/alpha.test.ts': cite('item-1234') });
    expect(changes(run())).toBe('');
    write(root, { 'test/alpha.test.ts': cite('item-9999') });
    expect(run().violations[0].expected).toContain('has no mirror file');
  });

  it('fails a new .skip / .only / .todo outright, citation or not', () => {
    write(root, {
      'test/alpha.test.ts': CLEAN_TEST.replace(
        "  it('counts five spines'",
        `  // batch ${B}: spined-shield#granted-spikes\n  it.skip('counts five spines'`,
      ),
    });
    const r = run();
    expect(r.violations.some((v) => v.change.includes('disabled test'))).toBe(true);
    expect(r.violations.find((v) => v.change.includes('disabled test'))!.expected).toContain('no batch may add .skip');
  });

  it('fails a deleted test file and a deleted describe block', () => {
    rmSync(path.join(root, 'test/alpha.test.ts'));
    write(root, { 'test/beta.test.ts': BETA_TEST.replace("describe('ring-of-wizardry-type-i', () => {\n", '') });
    const r = run();
    expect(r.violations.some((v) => v.file === 'test/alpha.test.ts' && v.change.includes('deleted'))).toBe(true);
    expect(r.violations.some((v) => v.file === 'test/beta.test.ts' && v.change.includes('describe block removed'))).toBe(true);
  });

  it('fails a numeric literal flipped inside an otherwise unchanged it()', () => {
    write(root, { 'test/alpha.test.ts': CLEAN_TEST.replace('expect(5).toBe(5);', 'expect(5).toBe(6);') });
    const r = run();
    expect(r.violations.some((v) => v.change.includes('numeric literal changed inside an otherwise unchanged it()'))).toBe(true);
  });

  it('lets the same numeric flip through as an ordinary cited change once the it() says why', () => {
    write(root, {
      'test/alpha.test.ts': CLEAN_TEST.replace(
        '    expect(5).toBe(5);',
        `    // batch ${B}: spined-shield#granted-spikes — the shield fires one spine\n    expect(5).toBe(6);`,
      ),
    });
    expect(changes(run())).toBe('');
  });

  it('diffs an untracked-at-baseline test against its snapshot, and refuses when the snapshot is missing', () => {
    write(root, { 'test/beta.test.ts': BETA_TEST.replace('expect(3).toBe(3);', 'expect(3).toBe(4);') });
    expect(run().violations[0].file).toBe('test/beta.test.ts');
    rmSync(path.join(root, `work/.b${B}-testbase/test/beta.test.ts`));
    expect(run().violations[0].expected).toContain('must snapshot it');
  });
});

describe('test-flip-audit — ratchets, registries and experience limits', () => {
  it('refuses a raised ratchet and accepts a cited one', () => {
    write(root, { 'scripts/dropped-inline-check.mjs': RATCHETS.replace('HOLE_BASELINE = 162', 'HOLE_BASELINE = 200') });
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].change).toBe('ratchet HOLE_BASELINE raised 162 -> 200');
    write(root, {
      'scripts/dropped-inline-check.mjs': RATCHETS.replace(
        'const HOLE_BASELINE = 162;',
        `// batch ${B}: spined-shield#granted-spikes\nconst HOLE_BASELINE = 200;`,
      ),
    });
    expect(changes(run())).toBe('');
  });

  it('catches a lowered ratchet too (it is still a moved instrument)', () => {
    write(root, { 'scripts/dropped-inline-check.mjs': RATCHETS.replace('FOOT_BASELINE = 96', 'FOOT_BASELINE = 90') });
    expect(run().violations[0].change).toBe('ratchet FOOT_BASELINE lowered 96 -> 90');
  });

  it('refuses a new settle key, then still refuses it until a mutation-proof test exists', () => {
    const teach = (cite: string) => DIFF_MJS.replace(
      "  'climbing-animal':",
      `${cite}  'flying-animal': ['grantsRecord'],\n  'climbing-animal':`,
    );

    write(root, { 'scripts/wg-diff.mjs': teach('') });
    const uncited = run();
    expect(uncited.violations.map((v) => v.change)).toContain('VERIFIED_EQUIVALENT gained the key "flying-animal"');
    expect(uncited.violations[0].expected).toContain('A new settle silences a real comparison');

    write(root, { 'scripts/wg-diff.mjs': teach(`  // batch ${B}: climbing-animal#jaws\n`) });
    const cited = run();
    expect(cited.violations).toHaveLength(1);
    expect(cited.violations[0].change).toContain('with no mutation-proof test');

    // A new test file is cited like any added hunk (ratchet lane 2026-09-29), so the proof carries the
    // batch citation, and its it( title names the finding's record.
    write(root, {
      'test/gamma.test.ts': `import { expect, it } from 'vitest';\n`
        + `// mutation-proof: a stunted flying-animal must still be reported by the comparer\n`
        + `// batch ${B}: climbing-animal#jaws\n`
        + `it('climbing-animal settle: reports a stunted flying-animal', () => { expect(1).toBe(1); });\n`,
    });
    expect(changes(run())).toBe('');
  });

  it('refuses a removed settle key unless a citation in the file names it', () => {
    const gone = IDENTITY_MJS.replace("  'spellshifter-dedication': ['grants'],\n", '');
    write(root, { 'scripts/wg-identity.mjs': gone });
    expect(run().violations[0].change).toBe('SETTLED_IDENTITIES lost the key "spellshifter-dedication"');
    write(root, { 'scripts/wg-identity.mjs': `// batch ${B}: spellshifter-dedication#now-resolves — their grant resolves, the settle goes\n${gone}` });
    expect(changes(run())).toBe('');
  });

  it('refuses a newly parked experience-limit record without a citation inside its block', () => {
    const park = (extra: string) => JSON.stringify({
      _: 'instrument limits',
      records: {
        'acute-scent': { batch: 9, verdict: 'NO-SHEET-EFFECT' },
        'spined-shield': { batch: 30, verdict: 'NO-SHEET-EFFECT', ...(extra ? { _cite: extra } : {}) },
      },
    }, null, 2);

    write(root, { 'work/experience-instrument-limits.json': park('') });
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].change).toBe('experience limit parked a new record "spined-shield"');
    expect(r.violations[0].expected).toContain('Parking a record hides it from gate 9');

    write(root, { 'work/experience-instrument-limits.json': park(`// batch ${B}: spined-shield#granted-spikes`) });
    expect(changes(run())).toBe('');
  });

  it('refuses when the testbase itself is missing — the audit never passes by default', () => {
    rmSync(path.join(root, `work/.b${B}-testbase.json`));
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].change).toBe('missing');
  });
});

/*
 * RULING (2026-09-06): batch tokens are ALPHANUMERIC — `029` and `P01` are both batches. The audit used
 * to compare them with `Number(batch)`, and `Number('P01')` is NaN: NaN matches nothing, so every
 * citation written by the print-read lane read as "names batch NaN" and the lane could not touch a test.
 * Both directions are pinned here — its own token passes, another batch's token still fails.
 */
describe('test-flip-audit — an alphanumeric batch token (the print-read lane)', () => {
  const PB = 'P01';
  beforeEach(() => {
    write(root, {
      [`work/.b${PB}-testbase.json`]: TESTBASE,
      [`work/.b${PB}-read.json`]: READ,
      [`work/.b${PB}-testbase/test/beta.test.ts`]: BETA_TEST,
    });
  });
  const runP = () => auditBatch({ root, batch: PB, aonRoot: aon }) as ReturnType<typeof run>;
  const cited = (token: string) => CLEAN_TEST.replace(
    "    expect('a').toBe('a');",
    `    // batch ${token}: spined-shield#granted-spikes\n    expect('a').toBe('b');`,
  );

  it('accepts a citation naming its own alphanumeric batch', () => {
    write(root, { 'test/alpha.test.ts': cited(PB) });
    expect(changes(runP())).toBe('');
  });

  it('refuses a citation from a DIFFERENT alphanumeric batch', () => {
    write(root, { 'test/alpha.test.ts': cited('P02') });
    const r = runP();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].expected).toContain('names batch P02');
    expect(r.violations[0].expected).toContain(`// batch ${PB}:`);
  });
});

/*
 * An it( / test( / describe( opener is the FIRST token of a statement, never text inside a quote.
 * The old matcher was `/(^|[^\w.])(it|test)\s*[(.]/` — anywhere on the line — so a perfectly ordinary
 * assignment inside a test body, `const out = 'work/.wg-diff-b027-test.json';`, read as an it()
 * header on the strength of the "-test." in a FILENAME. Both halves of that broke:
 *   • enclosingTitles() returned the string literal as the enclosing title, so the
 *     record-id-in-title half of the citation rule could not be satisfied at all near such a line
 *     (batch 031's closer had to fall back to the premise form);
 *   • and a fake "title" nearer than the real one that happens to name a record SATISFIES the check
 *     for a flip whose real it( never names it — the gate opening for an uncited flip.
 */
describe('test-flip-audit — an opener is a statement, not a substring of a string literal', () => {
  /**
   * Drive test/beta.test.ts and its BASELINE SNAPSHOT together, so each case is exactly the one-line
   * flip it describes and the surrounding shape is the fixture's own.
   */
  const beta = (base: string, changed: string) => {
    write(root, { [`work/.b${B}-testbase/test/beta.test.ts`]: base, 'test/beta.test.ts': changed });
  };
  /* The record id lives in the it( TITLE only — never in the describe, or the nearest-describe half
   * of enclosingTitles would satisfy the check whichever line it mistook for the it(. */
  const IT_TITLED = (body: string) => `import { describe, expect, it } from 'vitest';

describe('outer', () => {
  it('ring-of-wizardry-type-i opens the arcane gate', () => {
${body}  });
});
`;

  it('does not take a filename string literal for the enclosing it() title', () => {
    // `const out = 'work/.wg-diff-b027-test.json';` — an ordinary assignment whose FILENAME contains
    // "-test.", which the old matcher read as an it( header. It is the nearest candidate above the
    // flip, and it does not name the record, so the citation passes only if it was skipped.
    const lit = "    const out = 'work/.wg-diff-b027-test.json';\n";
    beta(
      IT_TITLED(`${lit}    expect(out).toBe('a');\n`),
      IT_TITLED(`${lit}    // batch ${B}: ring-of-wizardry-type-i#arcane-gate\n    expect(out).toBe('b');\n`),
    );
    expect(changes(run())).toBe('');
  });

  it('still recognises test(, describe.each( and it.skip( as openers', () => {
    // A `test(` opener under `describe.each(` — the citation names a record that appears ONLY in that
    // test( title, so it passes only while both are still read as openers.
    const each = (line: string) => `import { describe, expect, test } from 'vitest';

describe.each([1])('outer', () => {
  test('ring-of-wizardry-type-i opens the arcane gate', () => {
${line}  });
});
`;
    beta(each('    expect(3).toBe(3);\n'), each(`    // batch ${B}: ring-of-wizardry-type-i#arcane-gate\n    expect(3).toBe(4);\n`));
    expect(changes(run())).toBe('');
    // …and `it.skip(` is still the hard fail it always was.
    write(root, { 'test/gamma.test.ts': "import { expect, it } from 'vitest';\nit.skip('x', () => { expect(1).toBe(1); });\n" });
    expect(run().violations.some((v) => v.change.includes('disabled test'))).toBe(true);
  });

  it('reports a flip whose only nearby "title" is a string literal containing "test("', () => {
    // The hole, in the direction that matters: the fake carries BOTH the record id and a `test(`
    // substring, and sits nearer the flip than the real it(, which never names the record. The old
    // matcher took it for the enclosing title and let the uncited flip through.
    const fake = "    const fake = 'ring-of-wizardry-type-i test(';\n";
    const body = (extra: string) => `import { describe, expect, it } from 'vitest';

describe('outer', () => {
  it('opens the gate', () => {
${extra}  });
});
`;
    beta(body('    expect(1).toBe(1);\n'), body(`${fake}    // batch ${B}: ring-of-wizardry-type-i#arcane-gate\n    expect(1).toBe(2);\n`));
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].expected).toContain('appears in no enclosing describe/it title');
  });
});

/*
 * ORCHESTRATOR RULING (2026-09-08): "a batch is judged ONLY against what changed since its own start."
 * A TRACKED test file that a separate effort had already modified when the batch was cut has a blob at
 * startSha, but that blob is not what the batch inherited — diffing against it reported that effort's
 * edits as this batch's uncited flips, which is what stalled every batch over test/umbrella-items.test.ts.
 * The driver's baseline stage now lists such files as `dirtyTests` and byte-copies them, and the audit
 * diffs them against the copy. Both directions are pinned: the pre-batch edit is not a violation, an edit
 * made ON TOP of it still is.
 */
describe('test-flip-audit — a test file another effort had already modified', () => {
  /** The uncited edit that was in the working tree BEFORE this batch was cut. */
  const PRE_BATCH = CLEAN_TEST.replace("expect('a').toBe('a');", "expect('a').toBe('c');");
  const withDirty = (dirtyTests: string[]) => JSON.stringify({ ...JSON.parse(TESTBASE), dirtyTests }, null, 2);

  it('does not report the pre-batch edit — and does report it when the file is not listed as dirty', () => {
    write(root, {
      'test/alpha.test.ts': PRE_BATCH,
      [`work/.b${B}-testbase/test/alpha.test.ts`]: PRE_BATCH,
      [`work/.b${B}-testbase.json`]: withDirty(['test/alpha.test.ts']),
    });
    expect(changes(run())).toBe('');

    // the control: without dirtyTests the same tree diffs against startSha and the edit IS a violation
    write(root, { [`work/.b${B}-testbase.json`]: withDirty([]) });
    expect(changes(run())).toContain('test/alpha.test.ts');
  });

  it('still reports an uncited edit made on TOP of the pre-batch one', () => {
    write(root, {
      'test/alpha.test.ts': PRE_BATCH.replace('expect(5).toBe(5);', 'expect(5).toBe(7);'),
      [`work/.b${B}-testbase/test/alpha.test.ts`]: PRE_BATCH,
      [`work/.b${B}-testbase.json`]: withDirty(['test/alpha.test.ts']),
    });
    const r = run();
    expect(r.violations.length).toBeGreaterThan(0);
    expect(r.violations.every((v) => v.file === 'test/alpha.test.ts')).toBe(true);
  });

  it('refuses when the dirty file has no byte copy to diff against', () => {
    write(root, {
      'test/alpha.test.ts': PRE_BATCH,
      [`work/.b${B}-testbase.json`]: withDirty(['test/alpha.test.ts']),
    });
    rmSync(path.join(root, `work/.b${B}-testbase/test/alpha.test.ts`), { force: true });
    expect(run().violations[0].expected).toContain('must snapshot it');
  });
});

describe('test-flip-audit — the registry parser', () => {
  // mutation-proof for the parser itself: prose, apostrophes and nested braces must not hide a key.
  it('reads top-level keys past comments, strings and nesting', () => {
    const keys = registryKeys(DIFF_MJS, 'VERIFIED_EQUIVALENT') as { key: string; line: number }[];
    expect(keys.map((k) => k.key)).toEqual(['spellshifter-dedication', 'climbing-animal']);
    expect(DIFF_MJS.split('\n')[keys[0].line - 1]).toContain('spellshifter-dedication');
    expect(registryKeys(DIFF_MJS, 'NO_SUCH_REGISTRY')).toBeNull();
  });
});

/*
 * THE PREMISE FORM CITES WORDS, NOT A PAGE (card step 10's refuter, 2026-10-07). checkPremise used to
 * pass a `// batch NNN premise: <doc-id> "<clause>"` citation as soon as the mirror file for the doc id
 * existed. A test cited weapon-group-15 with our own src/rules/critSpec.ts wording — "The target is
 * off-guard until the start of your next turn" — while the page prints "The target is made off-balance
 * by your attack, becoming off-guard until the start of your next turn", and the audit passed. The
 * clause must now be IN the cited doc, both sides normalised the same way (links → label, bold off,
 * entities decoded, curly quotes and dashes folded, whitespace collapsed, case ignored), so the page's
 * own words pass however AoN marks them up, and a paraphrase fails naming the doc and the clause.
 * Two further rules from that check's own refuter: a clause under 2 words or 8 characters is too short
 * to be evidence, and the doc's bookkeeping fields (url, ids, date, filing) are never searched.
 */
describe('test-flip-audit — a premise must quote words that are in its doc', () => {
  const PRINTED = 'The target is made off-balance by your attack, becoming off-guard until the start of your next turn';
  const OURS = 'The target is off-guard until the start of your next turn';
  const cite = (doc: string, clause: string) => CLEAN_TEST.replace(
    "    expect('a').toBe('a');",
    `    // batch ${B} premise: ${doc} "${clause}"\n    expect('a').toBe('b');`,
  );
  const onlyWhy = () => {
    const r = run();
    expect(r.violations).toHaveLength(1);
    return r.violations[0].expected;
  };

  it('passes a clause that is in the doc', () => {
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', PRINTED) });
    expect(changes(run())).toBe('');
  });

  it('fails the weapon-group-15 case: our critSpec wording is not on the page, and the why names the doc and the clause', () => {
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', OURS) });
    const why = onlyWhy();
    expect(why).toContain(`premise doc weapon-group-15 does not contain the clause "${OURS}"`);
    expect(why).toContain(`// batch ${B} premise: <aon-doc-id> "<clause>"`);
  });

  it('still passes a clause that differs from the page only by a link, bold, a curly quote, an entity, a handlebars reference or a line break', () => {
    // the page links the condition: `becoming [off-guard](/Conditions.aspx?ID=58) until` — and the
    // fixture holds the sentence NOWHERE unlinked, so this passes only through the `[label](url)` fold
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', 'becoming off-guard until the start of your next turn') });
    expect(changes(run())).toBe('');
    // the page bolds the label and breaks the line: `**Frequency**\nonce per day`
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'Frequency once per day') });
    expect(changes(run())).toBe('');
    // the page prints a curly apostrophe (it’s); the citation types a straight one — and the reverse
    write(root, { 'test/alpha.test.ts': cite('feat-4458', "even if it's worse") });
    expect(changes(run())).toBe('');
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'Trigger You fail a skill check or saving throw'.replace('You', 'You')) });
    expect(changes(run())).toBe('');
    // the page escapes the ampersand (&amp;)
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'Your tools & weapons stay dry') });
    expect(changes(run())).toBe('');
    // the newer cross-reference template: `{{conditions 58 "off-guard"}}`
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'Until then you are off-guard.') });
    expect(changes(run())).toBe('');
    // a sentence the page wraps across a line: `check,\nbut you must`
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'reroll the triggering check, but you must use the new result') });
    expect(changes(run())).toBe('');
    // case is not a difference either
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'FREQUENCY ONCE PER DAY') });
    expect(changes(run())).toBe('');
  });

  it('fails an empty clause — a premise with no clause cites nothing', () => {
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', '') });
    expect(onlyWhy()).toContain('premise cites weapon-group-15 with an empty clause');
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', '   ') });
    expect(onlyWhy()).toContain('with an empty clause');
  });

  /*
   * THE MINIMUM (the first refuter's nit 1, 2026-10-07): "a" and "the" passed for weapon-group-15 — a
   * one-word clause is a substring of nearly any page and proves nothing. A clause is evidence only
   * from 2 words AND 8 characters, both counted on the normalised clause (the space between words
   * counts: "by your" is 7). Both halves of the rule are pinned on their own.
   */
  it('fails a clause too short to be evidence — under 2 words or under 8 characters — naming the doc and the clause', () => {
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', 'a') });
    const why = onlyWhy();
    expect(why).toContain('premise cites weapon-group-15 with the clause "a" — too short to be evidence');
    expect(why).toContain('at least 2 words and 8 characters');
    // one word, nine characters: the word count alone fails it
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', 'off-guard') });
    expect(onlyWhy()).toContain('with the clause "off-guard" — too short to be evidence');
    // two words, seven characters: the character count alone fails it
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', 'by your') });
    expect(onlyWhy()).toContain('with the clause "by your" — too short to be evidence');
    // two words, eleven characters, on the page: passes
    write(root, { 'test/alpha.test.ts': cite('weapon-group-15', 'your attack') });
    expect(changes(run())).toBe('');
    // …and a clause the page prints only as a tag ATTRIBUTE (`<actions string="Free Action" />`) passes too
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'Free Action') });
    expect(changes(run())).toBe('');
  });

  /*
   * ONLY WHAT THE PAGE PRINTS (the first refuter's nit 2, 2026-10-07): the check read every string
   * field of the doc, so the url, the legacy twin's id and the release date all "cited" feat-4458. The
   * mirror's bookkeeping keys are skipped now (BOOKKEEPING in the script, justified there from a
   * census of the mirror). The filing label is the mutation-proof half: "Adventuring Gear" is two
   * words and sixteen characters, so only the skipped field can fail it.
   */
  it('reads only what the page prints: the url, the legacy id, the release date and a filing label are not evidence', () => {
    write(root, { 'test/alpha.test.ts': cite('feat-4458', '/Feats.aspx?ID=4458') });
    expect(onlyWhy()).toContain('premise doc feat-4458 does not contain the clause "/Feats.aspx?ID=4458"');
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'feat-54') });
    expect(onlyWhy()).toContain('premise doc feat-4458 does not contain the clause "feat-54"');
    write(root, { 'test/alpha.test.ts': cite('feat-4458', '2023-11-15') });
    expect(onlyWhy()).toContain('premise doc feat-4458 does not contain the clause "2023-11-15"');
    write(root, { 'test/alpha.test.ts': cite('item-1234', 'Adventuring Gear') });
    expect(onlyWhy()).toContain('premise doc item-1234 does not contain the clause "Adventuring Gear"');
    // the summary is this doc's own words even where the markdown does not carry it — still evidence
    write(root, { 'test/alpha.test.ts': cite('feat-4458', 'misfortune avoids you') });
    expect(changes(run())).toBe('');
  });

  // mutation-proof for the field split: the searched text of a doc, straight from the reader.
  it('the searched text holds the printed fields and none of the bookkeeping', () => {
    const text = docText(path.join(aon, 'feat', 'feat-4458.json'), new Map()) as string;
    expect(text).toContain('you fail a skill check or saving throw');                 // the page body
    expect(text).toContain('free action');                                            // an attribute
    expect(text).toContain('misfortune avoids you');                                  // the summary
    for (const bookkeeping of ['/feats.aspx?id=4458', 'feat-54', '2023-11-15', 'rulebooks', 'standard', 'mechanics']) {
      expect(text).not.toContain(bookkeeping);
    }
    // the list names the bookkeeping, never a printed form — no `*_category` / `*_raw` glob
    for (const k of ['url', 'id', 'legacy_id', 'remaster_id', 'release_date', 'pfs', 'item_category', 'heighten_group']) {
      expect(BOOKKEEPING.has(k)).toBe(true);
    }
    for (const k of ['markdown', 'text', 'summary', 'search_markdown', 'trigger', 'weapon_category', 'primary_source_raw', 'price_raw', 'type']) {
      expect(BOOKKEEPING.has(k)).toBe(false);
    }
  });

  it('still fails an unknown doc with the old message, before any clause is looked for', () => {
    write(root, { 'test/alpha.test.ts': cite('item-9999', PRINTED) });
    expect(onlyWhy()).toContain('premise doc item-9999 has no mirror file');
  });

  it('holds the experience-limits `_cite` premise to the same rule', () => {
    const park = (clause: string) => JSON.stringify({
      _: 'instrument limits',
      records: {
        'acute-scent': { batch: 9, verdict: 'NO-SHEET-EFFECT' },
        'spined-shield': { batch: 30, verdict: 'NO-SHEET-EFFECT', _cite: `// batch ${B} premise: item-1234 "${clause}"` },
      },
    }, null, 2);
    write(root, { 'work/experience-instrument-limits.json': park('The spines are +1 striking shield spikes.') });
    expect(changes(run())).toBe('');
    write(root, { 'work/experience-instrument-limits.json': park('The spines deal extra fire damage.') });
    const r = run();
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].change).toBe('experience limit parked a new record "spined-shield"');
    expect(r.violations[0].expected).toContain('premise doc item-1234 does not contain the clause "The spines deal extra fire damage."');
  });

  // mutation-proof for the normaliser: each fold is pinned on its own, so a dropped rule shows as
  // the exact form it stopped folding rather than as a vague corpus failure.
  it('normalises both sides the same way: links, tags, emphasis, entities, quotes, dashes, whitespace, case', () => {
    expect(normalizeText('**Frequency**\nonce per [day](/X.aspx?ID=1)')).toBe('frequency once per day');
    expect(normalizeText('<title level="2">Gate Junction</title>\n<br />text')).toBe('gate junction text');
    // the level badge, the trait pill and the action glyph are PRINTED — their attribute is the text
    expect(normalizeText('<title level="1" right="Ritual 3" pfs="">[Name](/Rituals.aspx?ID=275)</title>')).toBe('ritual 3 name');
    expect(normalizeText('<trait label="Fortune" url="/Traits.aspx?ID=76" /><actions string="Two Actions" />')).toBe('fortune two actions');
    expect(normalizeText('tools &amp; weapons &nbsp; it&#39;s &#x2019;')).toBe("tools & weapons it's '");
    expect(normalizeText('it’s “quoted” — and – dashed … done')).toBe('it\'s "quoted" - and - dashed ... done');
    expect(normalizeText('you are {{conditions 58 "off-guard"}} now')).toBe('you are off-guard now');
    expect(normalizeText('  Two\r\n  lines\tand   runs ')).toBe('two lines and runs');
    expect(normalizeText('')).toBe('');
    expect(normalizeText(null)).toBe('');
    // the check itself, through the exported helper the corpus sweep uses, with the per-run cache
    const cache = new Map<string, unknown>();
    expect(clauseInDoc({ aonRoot: aon, docId: 'weapon-group-15', clause: PRINTED, cache })).toEqual({ ok: true });
    expect(clauseInDoc({ aonRoot: aon, docId: 'weapon-group-15', clause: OURS, cache }).ok).toBe(false);
    expect(cache.size).toBe(1);                                      // one parse per doc per run
    expect(clauseInDoc({ aonRoot: aon, docId: 'nonsense', clause: PRINTED, cache }).why).toContain('unparseable id');
  });
});
