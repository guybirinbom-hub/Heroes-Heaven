import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

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
 * a number no answers file speaks for still has to be accounted for, as `unruled`.
 *
 * EVERY DESK-ANSWERS FILE, NOT ONLY 2026-09-10's (package K, 2026-10-15). The file used to read one
 * answers file, so a ruling given after that pass could never get an `approvals` row: its number was
 * forced into `unruled`, and the trust gate kept dark the very rule he had just asked for (Adapted
 * Cantrip's −1 cantrip, his "Follow print" of 2026-10-15). Now every work/desk-answers-*.json counts, and
 * the guard is the SAME guard over all of them: a number any of them answers has exactly one real
 * disposition (approvals, noMechanic or engine — never `unruled`), and each such row names the file that
 * holds his words (`answers`; a row without it means work/desk-answers-2026-09-10.json). A ruling he gives
 * in chat with no desk number gets one first: add-owner-question.mjs files it, rule-owner-questions.mjs
 * rules it from a new answers file, and then it is filed here like any other.
 */

type Approval = { n: number; record: string; fields: string[]; why: string; pending?: boolean; modelledOn?: string; answers?: string };
type NoMechanic = { n: number; record: string; why: string; answers?: string };
type Engine = { n: number; why: string; laneId: string; answers?: string };
type Unruled = { n: number; id: string | null; status: string };

const approvals = JSON.parse(readFileSync('scripts/data/trust-approvals.json', 'utf8')) as {
  approvals: Approval[]; noMechanic: NoMechanic[]; engine: Engine[]; unruled: Unruled[];
};
const desk = JSON.parse(readFileSync('work/owner-questions.json', 'utf8')) as Record<string, { n: number; id?: string }[]>;
const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;

/** The first desk pass — what a disposition row with no `answers` key cites. */
const FIRST_ANSWERS = 'work/desk-answers-2026-09-10.json';
const ANSWERS_FILES = readdirSync('work').filter((f) => /^desk-answers-.+\.json$/.test(f)).map((f) => `work/${f}`).sort();
/** n -> every answers file that names it. */
const answeredIn = new Map<number, string[]>();
for (const f of ANSWERS_FILES) {
  const doc = JSON.parse(readFileSync(f, 'utf8')) as { answers?: { ns?: number[] }[] };
  for (const n of (doc.answers ?? []).flatMap((a) => a.ns ?? [])) answeredIn.set(n, [...(answeredIn.get(n) ?? []), f]);
}
const answeredNumbers = new Set(answeredIn.keys());
const citedFile = (e: { answers?: string }) => e.answers ?? FIRST_ANSWERS;

const deskNumbers = ['open', 'deferred', 'ruled', 'authorisedExceptions']
  .flatMap((k) => desk[k] ?? [])
  .map((e) => e.n);

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
  /*
   * Then the 2026-09-22 Spellshot lane filed TWO more, engine-shape questions with no WG comparison
   * (the lane's audit found no encoding to compare against): #162
   * engine-second-archetype-pool-spellshot-beast-gunner (does Spellshot + Beast Gunner get a real
   * second archetype spellcasting pool) and #163 engine-no-route-riders-energy-fulminating-dispelling
   * (three spellshot riders with no engine carrier — how should each be exposed). Both are `open`, so
   * both are `unruled` below. Roster 161 -> 163.
   */
  /*
   * Then batch 039 filed ONE: #164 familiar#archetype-reach (feat-5024 prints "Archetypes Elementalist
   * (Level 4), Shadowcaster (Level 4), Soul Warden (Level 4)" and the app has no class-feat-via-
   * archetype lane). `open`, so `unruled` below. Roster 163 -> 164.
   */
  /*
   * Then the 2026-09-25 reprint lane filed TWO rulings the owner gave in chat, straight into `ruled`:
   * #165 reprint-cross-kind-sub-pages (a bonus line or a sidebar pairs with the one same-titled line on its
   * page's reprint — his "what do you suggest?", the recommended yes) and #166 book-names-different-book-folds
   * (book aliases: "Middle way" — a "(Remastered)" printing folds into its own book, different books never
   * fold together). The answers file does not speak for either, so both are `unruled` below. Roster 164 -> 166.
   * The same night, a THIRD: #167 reprint-grade-to-grade (a legacy grade linked only to its renamed family
   * pairs with the new family's grade of the same suffix — his "yes"). Filed the same way. Roster 166 -> 167.
   */
  /*
   * Then print batch P02 filed ONE: #168 enhanced-familiar#fixed-budget-grants (feat-4717 "four familiar
   * or master abilities each day, instead of two" beside five grants that print their own fixed number —
   * which wins when a character owns both). `open`, so `unruled` below. Roster 167 -> 168.
   */
  /*
   * Then the 2026-09-29 Sources lane filed ONE ruling the owner gave in chat, straight into `ruled`: #169
   * shop-respects-sources ("i want the shop to respect sources" — the sheet's Add items shop offers only the
   * character's enabled books, keeping what the character holds). The answers file does not speak for it,
   * so `unruled` below. Roster 168 -> 169.
   */
  /*
   * Then the 2026-09-30 Sources lane filed ONE more ruling the owner gave in chat, straight into `ruled`: #170
   * sources-apply-to-everything ("yes the player sources should aplly to everything he has accses to" — siege
   * weapons, vehicles, the runic repertoire, the class sub-picks (schools, bloodlines, patrons, eidolons … by
   * each option's own record, and any later printing of it), the Mythic Calling picker, the Formula Book and daily
   * preparations, the property runes (the Living rune card, the item editor's rune slot), Advanced and Quick
   * Alchemy, a scroll's or wand's stored spell, the Magical Understudy eidolon cantrips, the item editor's
   * copy-from and bound-spell lists, the Spells tab's Prepare / Add and Learn a spell pickers (rituals included,
   * and Master Summoner's trait-searched summoning slots) and the Builder's Formula book and Snare formulas cards follow the character's enabled books, keeping what the
   * character holds — a rune etched on held gear included — and Magical Understudy's own-book cantrips offered
   * with that book off; out of scope on purpose: the Overrides card, languages, conditions and the Main tab's
   * Camping list; not yet: the Homebrew page's item editor lists and heritage editor's ancestry dropdown, which
   * belong to no character). The answers file does not speak for it, so `unruled` below. Roster 169 -> 170.
   */
  /*
   * Then 2026-10-15 filed two OPEN questions: #171 expanded-necromancy#archetype-ninth-rank (the dedication
   * book-grants lane, commit be93069 — its disposition is that lane's to file) and #172
   * cantrip-expansion#dual-class-pool (the Dual Class cantrip-bonus fix: which class's pool one Cantrip
   * Expansion feeds for a prepared + spontaneous pair). Both unanswered, so `unruled`. Roster 170 -> 172.
   * And #173 adaptive-adept#repertoire-place (the Adapted Cantrip chain lane: whether a repertoire's
   * Adaptive Adept spell is extra or takes one of its places), open, so `unruled`. Roster 172 -> 173.
   * (He answered all three the same evening, with #153 #162-#164 #168, in work/desk-answers-2026-10-15.json;
   * since package K those numbers, and the eight of work/desk-answers-2026-09-12.json, carry a real
   * disposition citing their file instead of `unruled` — see the header.)
   */
  /*
   * Then package K (2026-10-15) filed TWO rulings he gave in the home chat, each ruled at once from
   * work/desk-answers-2026-10-15-package-k.json so it could carry an approval: #174
   * adapted-cantrip#repertoire-cantrip-count ("Follow print": a sorcerer or bard with Adapted Cantrip knows
   * one cantrip fewer) and #175 basic-cleric-spellcasting#deity-spells ("start K", after reading feat-5067:
   * the deity's spells can be prepared in the cleric archetype's slots). Both are `approvals`. Roster 173 -> 175.
   */
  // batch 037: screech-shooter-major#grade-numbers
  // batch 037 premise: feat-8166 "Your Speed increases by 5 feet for each mode of movement available to you."
  // batch 039: familiar#archetype-reach
  // batch P02: enhanced-familiar#ability-budget
  it('the desk roster is every number in work/owner-questions.json — 175: 157 batch-filed questions (enhanced-familiar#fixed-budget-grants, print batch P02, the newest), the two 2026-09-11 authorised exceptions, the four filed by the 2026-09-12 reprint lane, the two filed by the 2026-09-22 Spellshot lane, the three ruled in chat on 2026-09-25, the one ruled in chat on 2026-09-29, the one ruled in chat on 2026-09-30, the three filed open on 2026-10-15 and the two package K filed and ruled the same day — with no gaps or repeats', () => {
    expect(new Set(deskNumbers).size).toBe(deskNumbers.length);
    // reprint lane 2026-09-25: #165 reprint-cross-kind-sub-pages, #166 book-names-different-book-folds, #167 reprint-grade-to-grade
    // batch P02: enhanced-familiar#ability-budget — #168 enhanced-familiar#fixed-budget-grants (open, so `unruled`)
    // Sources lane 2026-09-29: #169 shop-respects-sources (ruled in chat, so `unruled`)
    // Sources lane 2026-09-30: desk #170 sources-apply-to-everything (ruled in chat, so `unruled`)
    // 2026-10-15: desk #171 expanded-necromancy#archetype-ninth-rank and #172 cantrip-expansion#dual-class-pool (open, so `unruled`)
    // 2026-10-15: desk #173 adaptive-adept#repertoire-place (open, so `unruled`)
    // package K 2026-10-15: desk #174 adapted-cantrip#repertoire-cantrip-count and #175 basic-cleric-spellcasting#deity-spells (ruled, `approvals`)
    expect(deskNumbers.length).toBe(175);
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

  it('`unruled` is exactly the set no work/desk-answers-*.json file speaks for', () => {
    // Not vacuous: the first pass's file must still be there, or every number would read as unanswered.
    expect(ANSWERS_FILES, 'the 2026-09-10 answers file is one of the files read').toContain(FIRST_ANSWERS);
    const skipped = deskNumbers.filter((n) => !answeredNumbers.has(n)).sort((a, b) => a - b);
    expect(approvals.unruled.map((e) => e.n).sort((a, b) => a - b)).toEqual(skipped);
    // …and the other three lists hold only ANSWERED numbers: an unanswered ruling cannot approve anything.
    for (const k of ['approvals', 'noMechanic', 'engine'] as const) {
      const unanswered = (approvals[k] as { n: number }[]).map((e) => e.n).filter((n) => !answeredNumbers.has(n));
      expect(unanswered, `${k} claims a disposition for a number the owner has not answered`).toEqual([]);
    }
  });

  /*
   * Package K (2026-10-15): a disposition says WHERE his ruling is written. A row with no `answers` key
   * cites the first desk pass; a ruling from any later pass names its own file, and that file must
   * really answer that number — so a row cannot borrow a number from a file that never mentions it,
   * and every row of one number cites the same file.
   */
  it('every disposition cites the answers file that holds its ruling', () => {
    const wrong: string[] = [];
    const fileOf = new Map<number, string>();
    for (const k of ['approvals', 'noMechanic', 'engine'] as const) {
      for (const e of approvals[k] as { n: number; answers?: string }[]) {
        const f = citedFile(e);
        if (!ANSWERS_FILES.includes(f)) wrong.push(`${k} #${e.n}: cites ${f}, which is not a work/desk-answers-*.json file`);
        else if (!(answeredIn.get(e.n) ?? []).includes(f)) wrong.push(`${k} #${e.n}: cites ${f}, which does not answer #${e.n} (answered in: ${(answeredIn.get(e.n) ?? []).join(', ') || 'none'})`);
        if (fileOf.has(e.n) && fileOf.get(e.n) !== f) wrong.push(`#${e.n}: its rows cite two files (${fileOf.get(e.n)} and ${f})`);
        fileOf.set(e.n, f);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('no desk number is answered in two answers files — one ruling, one source', () => {
    const twice = [...answeredIn].filter(([, fs]) => fs.length > 1).map(([n, fs]) => `#${n}: ${fs.join(', ')}`);
    expect(twice).toEqual([]);
  });

  it('every number an answers file answers is on the desk roster', () => {
    const roster = new Set(deskNumbers);
    expect([...answeredIn.keys()].filter((n) => !roster.has(n)), 'answered numbers the desk does not have').toEqual([]);
  });

  /*
   * THE HOLE THE ROUTE MUST NOT LEAVE (independent check of package K). rule-owner-questions.mjs takes any
   * --answers path, so a ruling made from a file this test does not read (work/rulings-2026-11-02.json, a temp
   * path) moved to `ruled` with its `unruled` line flipped to "ruled" — and every guard stayed green while the
   * ruling shipped dark. So the RULED numbers that no answers file speaks for are pinned: the six ruled before
   * the 2026-09-10 desk file existed and the five the Sources and reprint lanes ruled in chat (#165-#167,
   * #169, #170), none of which turns a record mechanic on. A new one goes red here until its words are in a
   * work/desk-answers-*.json file and it has a real disposition.
   */
  it('`unruled` holds only the eleven known rulings with no answers file', () => {
    const RULED_WITHOUT_ANSWERS_FILE = [1, 2, 6, 8, 31, 33, 165, 166, 167, 169, 170];
    expect(approvals.unruled.filter((e) => e.status === 'ruled').map((e) => e.n).sort((a, b) => a - b)).toEqual(RULED_WITHOUT_ANSWERS_FILE);
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

  /*
   * The rulings given AFTER the 2026-09-10 pass that add a mechanic WG does not encode — the reason the
   * route above exists. #163: three prose stars on the Strike (Energy Shot, Fulminating Shot, Dispelling
   * Bullet), registry stars on records WG encodes nothing on. #174: Adapted Cantrip's −1 cantrip on a
   * repertoire caster (his "Follow print"). #175: Basic Cleric Spellcasting's deity spells in the
   * archetype's slots (his "start K", after reading feat-5067). Each must carry its field, or the ruling
   * ships dark.
   */
  it('the later add-a-mechanic rulings are approved on the field they turn on', () => {
    const has = (n: number, record: string, field: string) =>
      approvals.approvals.some((e) => e.n === n && e.record === record && e.fields.includes(field) && !!e.answers);
    expect(has(174, 'feats/adapted-cantrip', 'spellSlotBonus'), '#174 Adapted Cantrip spellSlotBonus').toBe(true);
    expect(has(175, 'feats/basic-cleric-spellcasting', 'spellListAdditions'), '#175 Basic Cleric Spellcasting spellListAdditions').toBe(true);
    for (const r of ['classFeatures/energy-shot', 'feats/fulminating-shot', 'classFeatures/dispelling-bullet']) {
      expect(has(163, r, 'situational'), `#163 ${r} situational`).toBe(true);
    }
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
