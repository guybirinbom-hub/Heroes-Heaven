import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * WHY THIS FILE EXISTS.
 *
 * scripts/data/trust-approvals.json is the only hand-maintained input to the trust gate, and the one
 * place a mistake is SILENT: a desk ruling that is missing from it ships dark (the gate strips the
 * field the owner just told us to build), and a typo'd field path approves nothing while looking like
 * it approved something. The plan asks for exactly that guard — "every desk number in
 * work/desk-answers-2026-09-10.json has exactly one disposition in trust-approvals.json, every
 * approvals entry names a real record and real paths" (docs/trust-gate.md:269-273) — and refuses to
 * let the approvals THEMSELVES be generated, because an approval is a judgement about which fields a
 * ruling turns on (docs/trust-gate.md:361-363). So the file is written by hand and the completeness
 * CHECK is the automated half. This is that half, as a test so it runs in the ordinary suite; the
 * verify-time script (scripts/trust-ledger-check.mjs) repeats it against the generated ledger.
 *
 * The roster is work/owner-questions.json — open + deferred + ruled + authorisedExceptions — because
 * a number the answers file skips still has to be accounted for, as `unruled`.
 */

type Approval = { n: number; record: string; fields: string[]; why: string; pending?: boolean; modelledOn?: string };
type NoMechanic = { n: number; record: string; why: string };
type Engine = { n: number; why: string; laneId: string };
type Unruled = { n: number; id: string | null; status: string };

const approvals = JSON.parse(readFileSync('scripts/data/trust-approvals.json', 'utf8')) as {
  approvals: Approval[]; noMechanic: NoMechanic[]; engine: Engine[]; unruled: Unruled[];
};
const desk = JSON.parse(readFileSync('work/owner-questions.json', 'utf8')) as Record<string, { n: number; id?: string }[]>;
const answers = JSON.parse(readFileSync('work/desk-answers-2026-09-10.json', 'utf8')) as { answers: { ns: number[] }[] };
const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;

const deskNumbers = ['open', 'deferred', 'ruled', 'authorisedExceptions']
  .flatMap((k) => desk[k] ?? [])
  .map((e) => e.n);
const answeredNumbers = new Set(answers.answers.flatMap((a) => a.ns));

const LISTS = ['approvals', 'noMechanic', 'engine', 'unruled'] as const;
/** n -> the lists it appears in. A number may own SEVERAL rows in ONE list (one ruling, several records). */
const dispositionsOf = (n: number) => LISTS.filter((k) => (approvals[k] as { n: number }[]).some((e) => e.n === n));

/**
 * The plausible-path vocabulary. trust-fields.json (the strippable universe, docs/trust-gate.md:56)
 * is the real authority, but it did not exist when the approvals file was written, so the fallback is
 * the OUR_KINDS field lists the universe is seeded FROM (scripts/wg-diff.mjs:396-582). Pulled out
 * textually rather than by import: importing wg-diff.mjs runs the whole comparer, which needs the
 * 50 MB WG dump that a clean clone does not have.
 */
const ourKindsFieldNames = (): Set<string> => {
  const src = readFileSync('scripts/wg-diff.mjs', 'utf8');
  const start = src.indexOf('const OUR_KINDS = {');
  expect(start, 'OUR_KINDS block still lives in scripts/wg-diff.mjs').toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf('\n};', start));
  return new Set([...block.matchAll(/'([A-Za-z][A-Za-z0-9_.]*)'/g)].map((m) => m[1]));
};
const VOCABULARY = ourKindsFieldNames();

/** The nested containers ourKindsOf walks (scripts/wg-diff.mjs:1216-1330), as path prefixes. */
const CONTAINERS = [
  'choice.options[].grant.passive.',
  'effectChoices[].options[].grant.passive.',
  'choice.options[].grant.',
  'effectChoices[].options[].grant.',
  'whileActive[].',
  'enhancement.grant.',
];
const leafOf = (path: string) => {
  for (const c of CONTAINERS) if (path.startsWith(c)) return path.slice(c.length);
  return path;
};

describe('trust-approvals.json — completeness', () => {
  /*
   * The roster GROWS whenever a batch files an owner question, and batch 037 filed FIVE: #151
   * screech-shooter-major-rune-grade (whether the major grade keeps the greater's runes, which print
   * never states for it) and #152 empty-description-marker-line (the marked-as-ours line owner ruling
   * #17 asked for on merchants-scale, which the apply pre-check refuses as authored prose) in the
   * build round, then three more in the closer's gate-red round: #153 timewracked-dedication-speed
   * -clause (feat-8166's "for each mode of movement available to you" reads two ways and the shipped
   * flat +5 is neither), #154 speed-plural-while-a-state-is-on (the panache half of feat-6238 has no
   * carrier and the modes Speed lane cannot express it) and #155 flexible-spellcaster-book-casters (a
   * flexible wizard/witch/magus takes the spellbook branch and gets no collection at all). All five
   * are `open`, so all five are `unruled` below.
   */
  /*
   * Then the 2026-09-11 desk pass minted TWO more, and not as questions: #156 (the seven Shoanti
   * Unifying Emblems may be built past what WG encodes, a one-family permission) and #157 (the trust
   * gate switches core class features and item-held spells back on) are `authorisedExceptions` — a
   * permission the owner gave, carrying no id, so the allocator was called without the numbers file.
   * The answers file work/desk-answers-2026-09-10.json was closed on 2026-09-10 and names neither, so
   * both are `unruled` here: `unruled` means "the answers file does not speak for this number", NOT
   * "the owner has not ruled". Roster 155 -> 157.
   */
  /*
   * Then the newest-printing repoint of 2026-09-12 filed FOUR, none of them from a WG batch: #158
   * reprint-twins-merge (182 records whose reprint already ships as its own record, so following the
   * reprint would collapse two records onto one page — a merge decision, not a repair), #159
   * reprint-lost-traits (eight records whose reprint page does not print a trait the legacy printing
   * carried, spellshape among them), #160 reprint-damaged-pages (two reprint pages whose own text is
   * damaged upstream) and #161 spell-parry-badge (a reprint that reproduces its predecessor's text
   * unchanged but carries no action badge on either printing). All four are `open`, so all four are
   * `unruled` below — which, as above, means the answers file does not speak for them. Roster 157 -> 161.
   */
  // batch 037: screech-shooter-major#grade-numbers
  // batch 037 premise: feat-8166 "Your Speed increases by 5 feet for each mode of movement available to you."
  it('the desk roster is every number in work/owner-questions.json — 161: 155 batch-filed questions, the two 2026-09-11 authorised exceptions and the four filed by the 2026-09-12 reprint lane — with no gaps or repeats', () => {
    expect(new Set(deskNumbers).size).toBe(deskNumbers.length);
    expect(deskNumbers.length).toBe(161);
  });

  it('every desk number has exactly one disposition', () => {
    const missing = deskNumbers.filter((n) => dispositionsOf(n).length === 0);
    const doubled = deskNumbers.filter((n) => dispositionsOf(n).length > 1);
    expect(missing, 'desk numbers with no disposition').toEqual([]);
    expect(doubled, 'desk numbers filed in two lists').toEqual([]);
  });

  it('no list carries a number the desk does not have', () => {
    const roster = new Set(deskNumbers);
    for (const k of LISTS) {
      const strays = (approvals[k] as { n: number }[]).map((e) => e.n).filter((n) => !roster.has(n));
      expect(strays, `${k} names numbers that are not on the desk`).toEqual([]);
    }
  });

  it('`unruled` is exactly the set work/desk-answers-2026-09-10.json skips', () => {
    const skipped = deskNumbers.filter((n) => !answeredNumbers.has(n)).sort((a, b) => a - b);
    expect(approvals.unruled.map((e) => e.n).sort((a, b) => a - b)).toEqual(skipped);
    // …and the other three lists hold only ANSWERED numbers: an unanswered ruling cannot approve anything.
    for (const k of ['approvals', 'noMechanic', 'engine'] as const) {
      const unanswered = (approvals[k] as { n: number }[]).map((e) => e.n).filter((n) => !answeredNumbers.has(n));
      expect(unanswered, `${k} claims a disposition for a number the owner has not answered`).toEqual([]);
    }
  });

  /*
   * `open` was missing from this map, so a question filed BY a batch and not yet answered could be in
   * no list at all: the completeness test above requires every unanswered number to be `unruled`, and
   * this one required `unruled` to come from deferred/ruled/authorisedExceptions. Batch 037's two new
   * questions (#151 screech-shooter-major, #152 merchants-scale) are the first to sit in that gap.
   */
  // batch 037: merchants-scale#no-rules
  it('an unruled entry carries the id and status work/owner-questions.json holds — including an open one, like merchants-scale #152', () => {
    const byN = new Map<number, { list: string; id?: string }>();
    for (const list of ['open', 'deferred', 'ruled', 'authorisedExceptions']) for (const e of desk[list] ?? []) byN.set(e.n, { list, id: e.id });
    const statusOf: Record<string, string> = { open: 'open', ruled: 'ruled', deferred: 'deferred', authorisedExceptions: 'authorisedException' };
    for (const e of approvals.unruled) {
      const src = byN.get(e.n);
      expect(src, `unruled #${e.n} must come from owner-questions.json`).toBeDefined();
      expect(e.status, `unruled #${e.n} status`).toBe(statusOf[src!.list]);
      expect(e.id, `unruled #${e.n} id`).toBe(src!.id ?? null);
    }
  });
});

describe('trust-approvals.json — approvals point at something real', () => {
  it('every approvals record exists in public/core.json unless it is pending', () => {
    for (const e of approvals.approvals) {
      const [bucket, id] = e.record.split('/');
      const rec = core[bucket]?.[id];
      if (e.pending) {
        expect(rec, `#${e.n} ${e.record} is marked pending, so it must NOT exist yet`).toBeUndefined();
        expect(e.modelledOn, `a pending record needs modelledOn so its field paths can be checked`).toBeTruthy();
      } else {
        expect(rec, `#${e.n} approves ${e.record}, which is not in core.json`).toBeDefined();
      }
    }
  });

  it('every noMechanic record exists in public/core.json', () => {
    for (const e of approvals.noMechanic) {
      const [bucket, id] = e.record.split('/');
      expect(core[bucket]?.[id], `#${e.n} names ${e.record}, which is not in core.json`).toBeDefined();
    }
  });

  it('every approvals field path is plausible', () => {
    for (const e of approvals.approvals) {
      const [bucket, id] = e.record.split('/');
      const target = e.pending ? core[e.modelledOn!.split('/')[0]]?.[e.modelledOn!.split('/')[1]] : core[bucket]?.[id];
      expect(e.fields.length, `#${e.n} ${e.record} approves no field at all`).toBeGreaterThan(0);
      for (const path of e.fields) {
        const leaf = leafOf(path);
        const head = path.split(/[.[]/)[0];
        const plausible = VOCABULARY.has(leaf) || VOCABULARY.has(path) || Object.prototype.hasOwnProperty.call(target ?? {}, head);
        expect(plausible, `#${e.n} ${e.record}: "${path}" is neither an OUR_KINDS path nor a field the record carries`).toBe(true);
      }
    }
  });

  it('every entry says WHY, in a sentence, and an engine entry names its lane', () => {
    for (const e of [...approvals.approvals, ...approvals.noMechanic, ...approvals.engine]) {
      expect(e.why.length, `#${e.n} needs a real reason`).toBeGreaterThan(40);
      expect(e.why.endsWith('…'), `#${e.n} why must not trail off (docs/trust-gate.md:72)`).toBe(false);
    }
    for (const e of approvals.engine) expect(e.laneId, `engine #${e.n} needs a laneId`).toBeTruthy();
    expect(new Set(approvals.engine.map((e) => e.laneId)).size).toBe(approvals.engine.length);
  });
});

describe('trust-approvals.json — the plan’s add-a-mechanic list is covered', () => {
  /*
   * docs/trust-gate.md:73-80 lists the rulings that ADD a mechanic WG lacks: "Every ruling that ADDS a
   * mechanic WG lacks needs an `approvals` entry or it ships dark". Mapped to desk numbers. #145
   * (Web's damageless attack) is the one the plan names in both lists; it is filed under `engine`
   * because the ruling's own words are "allow no-damage attacks" (docs/trust-gate.md:71) and the
   * record half needs no approval — classFeatures/animal-instinct already has `weapon` in WG's kinds.
   */
  const MUST_BE_APPROVED = [7, 10, 12, 13, 16, 17, 18, 26, 28, 29, 30, 40, 43, 44, 51, 55, 56, 57, 68, 69, 70, 71, 73, 85, 97, 102, 104, 113, 120, 121, 128, 129, 140, 141, 143, 149];

  it('each one has an approvals entry', () => {
    const have = new Set(approvals.approvals.map((e) => e.n));
    expect(MUST_BE_APPROVED.filter((n) => !have.has(n)), 'add-a-mechanic rulings with no approval').toEqual([]);
  });

  it('#145 is the documented exception and lives in `engine`', () => {
    const e = approvals.engine.find((x) => x.n === 145);
    expect(e, '#145 must be filed, and filed as engine').toBeDefined();
    expect(e!.why).toContain('animal-instinct');
  });

  it('all seven quah emblems are approved, not only the three the desk numbered', () => {
    const emblems = approvals.approvals.filter((e) => e.record.startsWith('items/unifying-emblem-'));
    expect(new Set(emblems.map((e) => e.record)).size).toBe(7);
    for (const e of emblems) expect(e.fields).toContain('innateSpells');
  });

  it('all six kitsune/nagaji spell feats are approved, not only the three the desk numbered', () => {
    const six = approvals.approvals.filter((e) => /^feats\/(kitsune|nagaji)-spell-/.test(e.record));
    expect(new Set(six.map((e) => e.record)).size).toBe(6);
    for (const e of six) expect(e.fields, `${e.record} must keep its daily control`).toContain('dailyChoice');
  });

  it('the magus/summoner 2026 move names the class AND the class feature on both sides', () => {
    const records = new Set(approvals.approvals.filter((e) => [56, 104, 120, 121].includes(e.n)).map((e) => e.record));
    for (const r of ['classes/magus', 'classes/summoner', 'classFeatures/arcane-spellcasting-magus', 'classFeatures/summoner-spellcasting', 'classFeatures/studious-spells']) {
      expect(records, `the 2026 move must approve ${r}`).toContain(r);
    }
  });
});

describe('trust-approvals.json — against trust-fields.json', () => {
  /*
   * scripts/data/trust-fields.json is the strippable universe, and the gate is a DENYLIST: a path that
   * is NOT in it is never blanked (docs/trust-gate.md:48-53). So an approved path has to be one of four
   * things, and anything else is a typo:
   *   1. in `paths`             — the approval BITES: without it the gate would blank this path.
   *   2. in `_excluded`         — §1 protects it anyway (prose, a cost, a limit, chassis, builder
   *                               structure, a _noCounterpart field). The approval is documentation.
   *   3. a nested container path whose leaf OUR_KINDS names — the desk fix CREATES it, so it occurs on
   *                               no record today and the universe (seeded from what records carry)
   *                               cannot yet know it. This is the forward-looking half of the file.
   *   4. a field the record already carries — an item/weapon chassis line with no OUR_KINDS name.
   */
  const haveFields = existsSync('scripts/data/trust-fields.json');
  const fields = haveFields
    ? (JSON.parse(readFileSync('scripts/data/trust-fields.json', 'utf8')) as {
        paths: { path: string }[]; _excluded: Record<string, Record<string, unknown> & { paths?: string[] }>;
      })
    : null;
  const universe = new Set(fields?.paths.map((p) => p.path) ?? []);
  const excluded = new Set<string>();
  for (const group of Object.values(fields?._excluded ?? {})) {
    if (Array.isArray(group.paths)) for (const p of group.paths) excluded.add(p);
    for (const [k, v] of Object.entries(group)) if (k !== '_' && k !== 'paths' && typeof v === 'string') excluded.add(k);
  }

  it.runIf(haveFields)('every approved path is strippable, excluded by §1, created by the fix, or on the record', () => {
    const unexplained: string[] = [];
    for (const e of approvals.approvals) {
      const [b, i] = (e.pending ? e.modelledOn! : e.record).split('/');
      const rec = core[b]?.[i] ?? {};
      for (const p of e.fields) {
        const head = p.split(/[.[]/)[0];
        const nestedAndKnown = p !== leafOf(p) && VOCABULARY.has(leafOf(p));
        if (universe.has(p) || excluded.has(p) || nestedAndKnown || Object.prototype.hasOwnProperty.call(rec, head)) continue;
        unexplained.push(`#${e.n} ${e.record}: ${p}`);
      }
    }
    expect(unexplained, `approved paths that are in neither trust-fields.json, its _excluded list, the OUR_KINDS vocabulary, nor the record:\n${unexplained.join('\n')}`).toEqual([]);
  });

  it.runIf(haveFields)('at least one approved path per entry actually bites, or the entry says why not', () => {
    // An entry every one of whose paths is §1-protected approves nothing the gate would have taken.
    // That is legitimate (it records a deliberate inertness — #17 Merchant's Scale is the case), but it
    // must be rare enough to stay reviewable rather than becoming the file's normal shape.
    const inert = approvals.approvals.filter((e) => e.fields.every((p) => !universe.has(p) && p === leafOf(p)));
    expect(inert.length, `entries with no strippable path at all: ${inert.map((e) => `#${e.n} ${e.record}`).join(', ')}`).toBeLessThanOrEqual(6);
  });
});
