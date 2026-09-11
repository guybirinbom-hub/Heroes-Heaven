/*
 * BATCH 037 — INSTRUMENT CHUNK 5 (WG-COMPARISON lane): TWELVE OWNER-RULED "NOTHING CHANGES" FINDINGS.
 *
 * All twelve read the same way — print says one thing, Wanderer's Guide's row says another, ours
 * already says what print says — and the owner ruled all twelve on 2026-09-10 under the standing
 * 2026-08-22 rule (book wins), asking in his own words that each one be *"WRITTEN DOWN as a known
 * deliberate difference from WG (settle) so the comparer stops re-raising it"*.
 *
 * Measured against the batch-037 baseline flags, only FOUR of the twelve are flagged by any
 * instrument at all; the other eight (haunted, hammered-by-fate, lesser-scion, bachuan-revolutionary,
 * divine-font, undine, grave-orc, waning-moon-sarangay) are already quiet on every comparer and on the
 * experience gate, so settling them would add a registry entry that matches nothing. The four that are
 * flagged get one settle each, and this file is the guard on all four:
 *
 *   tree-friend#arboreal              wg-diff  VERIFIED_EQUIVALENT['tree-friend'] = ['language']
 *   traveling-gourmand#survival       wg-values SETTLED_VALUES['traveling-gourmand'] = ['skill|survival']
 *   deny-lady-nanbyos-charity#bulk-…  wg-values SETTLED_VALUES['deny-lady-…'] = ['bulk|']
 *   seer-of-the-dead#one-boost        work/experience-instrument-limits.json (ALREADY-OK park)
 *
 * A settle is legitimate only while (a) the comparer still reports the record with the settle
 * bypassed — otherwise it is silencing nothing and hiding the NEXT difference of that kind — and
 * (b) the carrier it defers to really delivers the printed rule. Both halves are checked below:
 * `--raw` (the registries' own bypass) for the first, a STUNTED content copy for the second.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
/* Every comparer case runs a real node child — fine alone, several times slower under the full suite,
 * where the 5 s default turned it into a timeout. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content } from './_content';
import { boostSlots, buildCharacter, emptyBuild } from '../src/rules/build';
import { deriveBulk } from '../src/rules/derive';
import type { Character, ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* Parsed once — public/core.json is 8 MB and each stunt would otherwise pay for it again. */
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, any>>;

/** Run a comparer against a copy of the shipped content with ONE carrier removed. Hook from batch 030/031. */
function stunted<T>(bucket: string, id: string, mutate: (rec: any) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b037-i5-stunt-${bucket}-${id}.json`;
  const patched = { ...CORE, [bucket]: { ...CORE[bucket], [id]: structuredClone(CORE[bucket][id]) } };
  mutate(patched[bucket][id]);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(patched));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/** wg-diff's THEY-ONLY bucket, read from `--out`: the printed list is capped and would call a
 *  still-reported record "quiet". */
function theyOnly(extra: string[] = []): Map<string, string[]> {
  const rel = `work/.b037-i5-diff-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    runScript('wg-diff.mjs', ['--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return new Map<string, string[]>(out.theyOnly.map((r: { id: string; missing: string[] }) => [r.id, r.missing]));
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--verbose', ...extra]);

/** An in-memory content copy with one record mutated — the build-side twin of `stunted`. */
function patchedContent(bucket: string, id: string, mutate: (rec: any) => void): ContentDatabase {
  const db = content() as unknown as Record<string, Record<string, any>>;
  const rec = structuredClone(db[bucket][id]);
  mutate(rec);
  return { ...db, [bucket]: { ...db[bucket], [id]: rec } } as unknown as ContentDatabase;
}

/** A level-1 fighter wearing the given ancestry/heritage/background, built against `db`. */
function person(db: ContentDatabase, over: Record<string, unknown>): Character {
  return buildCharacter({ ...emptyBuild(), name: 't', level: 1, classId: 'fighter', keyAbility: 'str', ...over } as never, db);
}

/* ------------------------------------------------------------------ tree-friend#arboreal */

describe('batch 037 instruments-5 — tree-friend settles a printed PERMISSION their row encodes as a grant', () => {
  // batch 037: tree-friend#arboreal
  it('tree-friend is quiet with the settle, reports missing=[language] with settles bypassed, and still reports its feat grant when that carrier is stunted', () => {
    /*
     * AoN background-504 (Tree Friend): *"You gain the No Cause for Alarm skill feat, and you can
     * choose Arboreal as one of your known languages."* The second clause is a permission — our
     * bonus-language picker (src/builder/shared.tsx:4300) already offers every one of the 120
     * `content.languages` entries with no rarity filter, Arboreal among them, so there is nothing on
     * the record to carry and a `grantsLanguages` row would hand the language over FREE, which print
     * does not say. Their `giveLanguage` op reads as the `language` kind, so the pairing demands a
     * grant the book never prints. Owner-ruled 2026-09-10, desk #84.
     *
     * mutation-proof — stunts the settle key 'tree-friend' in wg-diff's VERIFIED_EQUIVALENT two ways.
     * First via `--raw`, the registry's own bypass: the record goes straight back to THEY-ONLY, so the
     * settle is load-bearing rather than redundant. Second by deleting `grantedFeatId` from a content
     * copy of backgrounds/tree-friend: WITH the settle still in place the record is reported again, as
     * `missing=[grantsRecord]`, which proves the entry is scoped to the `language` kind and cannot
     * stand in for the No Cause for Alarm grant it sits beside.
     */
    expect(theyOnly().has('tree-friend')).toBe(false);
    expect(theyOnly(['--raw']).get('tree-friend')).toEqual(['language']);
    const stuntedMissing = stunted('backgrounds', 'tree-friend', (r) => { delete r.grantedFeatId; }, (core) => theyOnly(core));
    expect(stuntedMissing.get('tree-friend')).toEqual(['grantsRecord']);
  });

  // batch 037: tree-friend#arboreal
  it('the Arboreal a tree-friend can choose is really reachable — the language picker carries no filter', () => {
    /*
     * The printed permission is delivered by the picker, not by the record, so this is where the claim
     * in the settle comment is checked. `languages/arboreal` (uncommon, language-26) exists in the
     * content bucket the picker maps over, and the record itself carries no language field at all —
     * which is what makes the missing `language` kind correct rather than a gap.
     */
    const db = content();
    expect(db.languages.arboreal?.name).toBe('Arboreal');
    const bg = db.backgrounds['tree-friend'] as Record<string, unknown>;
    expect(bg.grantsLanguages).toBeUndefined();
    expect(bg.languageChoices).toBeUndefined();
    expect(bg.grantedFeatId).toBe('no-cause-for-alarm');
  });
});

/* ------------------------------------------------------------ traveling-gourmand#survival */

describe('batch 037 instruments-5 — traveling-gourmand settles a WG operation that UNTRAINS a printed skill', () => {
  // batch 037: traveling-gourmand#survival
  it('traveling-gourmand is quiet with the settle, reports the DIFFERENT row with settles bypassed, and still reports through wg-diff when both skill carriers are stunted', () => {
    /*
     * AoN background-482: *"You're trained in the Survival skill, and the Cooking Lore skill. You gain
     * the Forager skill feat."* Their row writes Survival UNTRAINED. Owner-ruled 2026-09-10, desk #80.
     *
     * mutation-proof — stunts the settle key 'traveling-gourmand' in wg-values' SETTLED_VALUES.
     * `skill|survival` is the ONLY key either side asserts on this record, so the settle quiets it for
     * wg-values entirely; `--raw` proves the settle is what does the quieting, and the second half
     * proves the cover: with `trainedSkill` AND `trainedLore` deleted from a content copy the
     * background stops asserting the `skill` kind at all and wg-diff — a different registry, so the
     * settle does not reach it — puts the record back in THEY-ONLY as `missing=[skill]`.
     */
    expect(values('traveling-gourmand')).toMatch(/ok\s+traveling-gourmand/);
    expect(values('traveling-gourmand', ['--raw'])).toMatch(/DIFFERENT\s+skill\|survival\s+theirs=untrained\s+ours=trained/);
    const stuntedMissing = stunted('backgrounds', 'traveling-gourmand', (r) => {
      delete r.trainedSkill; delete r.trainedLore;
    }, (core) => theyOnly(core));
    expect(stuntedMissing.get('traveling-gourmand')).toEqual(['skill']);
  });

  // batch 037: traveling-gourmand#survival
  it('a traveling-gourmand character really is trained in Survival and Cooking Lore and really gets Forager', () => {
    /*
     * The engine half of the same claim, on a BUILT character rather than on a comparer — this is the
     * assertion the wg-values settle defers to, so it is pinned where the settle cannot reach it.
     *
     * mutation-proof — the taught carriers are `trainedSkill`, `trainedLore` and `grantedFeatId` on
     * backgrounds/traveling-gourmand; an in-memory content copy with all three deleted loses every one
     * of these assertions, so they read the record and not something else.
     */
    const db = content();
    const anyAncestry = Object.keys(db.ancestries)[0];
    const ch = person(db, { ancestryId: anyAncestry, backgroundId: 'traveling-gourmand' });
    expect(ch.proficiencies.skills.survival).toBe('trained');
    expect(ch.proficiencies.skills['lore:cooking']).toBe('trained');
    expect(ch.feats.some((f) => f.featId === 'forager')).toBe(true);

    const bare = patchedContent('backgrounds', 'traveling-gourmand', (r) => {
      delete r.trainedSkill; delete r.trainedLore; delete r.grantedFeatId;
    });
    const stuntedCh = person(bare, { ancestryId: anyAncestry, backgroundId: 'traveling-gourmand' });
    expect(stuntedCh.proficiencies.skills.survival).not.toBe('trained');
    expect(stuntedCh.proficiencies.skills['lore:cooking']).toBeUndefined();
    expect(stuntedCh.feats.some((f) => f.featId === 'forager')).toBe(false);
  });
});

/* -------------------------------------------- deny-lady-nanbyos-charity#bulk-thresholds */

describe('batch 037 instruments-5 — deny-lady-nanbyos-charity settles two printed Bulk numbers their one scalar cannot hold', () => {
  // batch 037: deny-lady-nanbyos-charity#bulk-thresholds
  it('deny-lady-nanbyos-charity is quiet with the settle and reports the DIFFERENT bulk row with settles bypassed', () => {
    /*
     * AoN heritage-407: *"Your vow grants you the strength to carry 1 more Bulk than normal before
     * becoming encumbered and up to a maximum of 2 more Bulk"* — two thresholds, two numbers. Their
     * whole encoding is `adjValue BULK_LIMIT_BONUS 2`, one scalar, which in their engine moves the
     * encumbered threshold by 2 as well. Owner-ruled 2026-09-10, desk #118.
     *
     * mutation-proof — stunts the settle key 'deny-lady-nanbyos-charity' in wg-values' SETTLED_VALUES
     * via `--raw`. With the settle bypassed the row is back, so the settle is what silences it; and the
     * record's OTHER assertion (`skill|athletics=1`, the printed +1 circumstance to Force Open or
     * Escape) is untouched by a key-scoped settle and still compared on every run, which the shipped
     * run shows by agreeing on it rather than skipping the record.
     */
    expect(values('deny-lady-nanbyos-charity')).toMatch(/ok\s+deny-lady-nanbyos-charity/);
    const raw = values('deny-lady-nanbyos-charity', ['--raw']);
    expect(raw).toMatch(/DIFFERENT\s+bulk\|\s+theirs=2/);
    expect(raw).toMatch(/skill\|athletics=1/);
  });

  // batch 037: deny-lady-nanbyos-charity#bulk-thresholds
  it('a deny-lady-nanbyos-charity yaksha really carries +1 Bulk before encumbered and +2 at the maximum', () => {
    /*
     * The carrier the settle defers to: `bulkLimitBonus: 1` moves BOTH thresholds (src/rules/derive.ts
     * :5533) and `bulkMaxBonus: 1` moves the maximum only (:5534), so the pair prints exactly the two
     * printed numbers — which is the rule their single scalar cannot state at any value.
     *
     * mutation-proof — an in-memory content copy of heritages/deny-lady-nanbyos-charity with
     * `bulkLimitBonus` and `bulkMaxBonus` deleted loses both steps, so the deltas below read those two
     * fields and nothing else.
     */
    const db = content();
    const plain = person(db, { ancestryId: 'yaksha', heritageId: 'respite-of-cloudless-paths' });
    const vowed = person(db, { ancestryId: 'yaksha', heritageId: 'deny-lady-nanbyos-charity' });
    const base = deriveBulk(plain, db);
    const withVow = deriveBulk(vowed, db);
    expect(withVow.encumberedAt - base.encumberedAt).toBe(1);
    expect(withVow.max - base.max).toBe(2);

    const bare = patchedContent('heritages', 'deny-lady-nanbyos-charity', (r) => {
      delete r.bulkLimitBonus; delete r.bulkMaxBonus;
    });
    const stuntedBulk = deriveBulk(person(bare, { ancestryId: 'yaksha', heritageId: 'deny-lady-nanbyos-charity' }), bare);
    expect(stuntedBulk.encumberedAt).toBe(base.encumberedAt);
    expect(stuntedBulk.max).toBe(base.max);
  });
});

/* --------------------------------------------------------------- seer-of-the-dead#one-boost */

describe('batch 037 instruments-5 — seer-of-the-dead asks the ONE boost print asks, so WG s second select is parked', () => {
  // batch 037: seer-of-the-dead#one-boost
  it('seer-of-the-dead offers exactly one restricted con/wis boost control and no free one', () => {
    /*
     * AoN background-243: *"You gain one ability boost. It must be to Constitution or Wisdom."* — one
     * boost, restricted, and no free boost anywhere in the entry. `boostSlots` (src/rules/build.ts:672)
     * is what src/builder/shared.tsx:3000 maps over to render the controls, so this IS the question the
     * player is asked. WG asks "Select an Attribute" TWICE, the second being a free boost the
     * background never prints, which is why matchSelects leaves one select unpaired and the experience
     * harness reads MISSING-CONTROL on a record that matches print. Owner-ruled 2026-09-10, desk #81;
     * parked as ALREADY-OK / wg-unprinted-extra-select in work/experience-instrument-limits.json.
     *
     * The control counts are read against a background that DOES print a free boost — traveling-
     * gourmand, two slots — so the assertion is discriminating rather than constant.
     *
     * mutation-proof — the carrier is `abilityBoosts` on backgrounds/seer-of-the-dead; an in-memory
     * copy with it emptied renders no control at all, so the count below reads that field. The park is
     * indifferent to the stunt (the verdict would be MISSING-CONTROL either way, because the surplus
     * select is on THEIR side), which is exactly why the boost is pinned here instead of parked blind.
     */
    const db = content();
    const slots = boostSlots(db.backgrounds['seer-of-the-dead'].abilityBoosts);
    expect(slots).toHaveLength(1);
    expect(slots[0]).toEqual({ kind: 'choice', options: ['con', 'wis'] });
    expect(boostSlots(db.backgrounds['traveling-gourmand'].abilityBoosts).map((s) => s.kind)).toEqual(['choice', 'free']);

    const bare = patchedContent('backgrounds', 'seer-of-the-dead', (r) => { r.abilityBoosts = []; });
    expect(boostSlots(bare.backgrounds['seer-of-the-dead'].abilityBoosts)).toHaveLength(0);
  });

  // batch 037: seer-of-the-dead#one-boost
  it('the seer-of-the-dead park is recorded, scoped and cited in the experience instrument limits', () => {
    /*
     * A park is only honest while it is visible: the gate prints every entry on every run. This pins
     * that the entry exists for exactly this verdict and lane and carries its finding citation, so a
     * later hand widening it (or a stale entry surviving a fix) fails here rather than silently.
     */
    const limits = JSON.parse(readFileSync(join(CLI_ROOT, 'work/experience-instrument-limits.json'), 'utf8'));
    const entry = limits.records['seer-of-the-dead'];
    expect(entry).toBeTruthy();
    expect(entry.verdict).toBe('MISSING-CONTROL');
    expect(entry.lane).toBe('wg-unprinted-extra-select');
    expect(entry.class).toBe('ALREADY-OK');
    expect(entry._cite).toBe('// batch 037: seer-of-the-dead#one-boost');
  });
});

/* ------------------------------------ the eight that needed no instrument change at all ---------- */

describe('batch 037 instruments-5 — the eight owner-ruled records no comparer flags stay unsettled', () => {
  /*
   * haunted, hammered-by-fate, lesser-scion, bachuan-revolutionary, divine-font, undine, grave-orc and
   * waning-moon-sarangay are each a WG-vs-print difference the owner ruled on 2026-09-10 (desk #83,
   * #89, #90, #91, #103, #114, #117, #119) — and each is ALREADY quiet on every comparer, so a settle
   * for any of them would match nothing and would only pre-silence the next real difference of that
   * kind on that record. This is the guard on that decision: the day one of them starts reporting,
   * this test fails and the record gets read again rather than settled by reflex.
   */
  // batch 037: divine-font#rank-9
  it('divine-font, undine, grave-orc, haunted, hammered-by-fate, lesser-scion, bachuan-revolutionary and waning-moon-sarangay report nothing on wg-values or wg-diff', () => {
    const quiet = [
      'haunted', 'hammered-by-fate', 'lesser-scion', 'bachuan-revolutionary',
      'divine-font', 'undine', 'grave-orc', 'waning-moon-sarangay',
    ];
    const out = values(quiet.join(','));
    expect(out).toMatch(/0 records with at least one value to adjudicate\./);
    const missing = theyOnly();
    for (const id of quiet) expect([id, missing.get(id) ?? null]).toEqual([id, null]);
  });
});
