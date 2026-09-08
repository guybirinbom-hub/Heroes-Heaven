import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { auditBatch, registryKeys } from '../scripts/test-flip-audit.mjs';

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

write(root, { ...TRACKED, 'aon/by-category/item/item-1234.json': '{"name":"Spined Shield"}' });
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

  it('lets a wholly new test file through uncited', () => {
    write(root, { 'test/gamma.test.ts': "import { expect, it } from 'vitest';\nit('new', () => { expect(1).toBe(1); });\n" });
    expect(changes(run())).toBe('');
  });

  /*
   * The same exemption once the new file has been COMMITTED inside the batch window — `git diff
   * --name-status` calls it 'A', and treating that as a modification made `git show startSha:<rel>`
   * fail, the whole file read as added lines, and every assertion in it demand a citation. Replaying
   * batch 29 after its own commit produced 108 phantom violations in test/batch29-data.test.ts alone.
   * Its .skip / .only / .todo scan still runs, so the exemption is not a hole.
   */
  it('exempts a new test file that has since been committed, but still bans .skip in it', () => {
    write(root, { 'test/gamma.test.ts': "import { expect, it } from 'vitest';\nit('new', () => { expect(1).toBe(1); });\n" });
    git('add', 'test/gamma.test.ts');
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'mid-batch: a new test file');
    try {
      expect(changes(run())).toBe('');
      write(root, { 'test/gamma.test.ts': "import { expect, it } from 'vitest';\nit.skip('new', () => { expect(1).toBe(1); });\n" });
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

    write(root, {
      'test/gamma.test.ts': `import { expect, it } from 'vitest';\n`
        + `// mutation-proof: a stunted flying-animal must still be reported by the comparer\n`
        + `it('reports a stunted flying-animal', () => { expect(1).toBe(1); });\n`,
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

describe('test-flip-audit — the registry parser', () => {
  // mutation-proof for the parser itself: prose, apostrophes and nested braces must not hide a key.
  it('reads top-level keys past comments, strings and nesting', () => {
    const keys = registryKeys(DIFF_MJS, 'VERIFIED_EQUIVALENT') as { key: string; line: number }[];
    expect(keys.map((k) => k.key)).toEqual(['spellshifter-dedication', 'climbing-animal']);
    expect(DIFF_MJS.split('\n')[keys[0].line - 1]).toContain('spellshifter-dedication');
    expect(registryKeys(DIFF_MJS, 'NO_SUCH_REGISTRY')).toBeNull();
  });
});
