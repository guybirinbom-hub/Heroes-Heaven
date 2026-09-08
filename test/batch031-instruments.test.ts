/*
 * BATCH 031 — THE INSTRUMENT LANE (WG-COMPARISON family), AND ITS ANTI-LAUNDERING CHECK.
 *
 * Two batch-031 findings were "the instrument misread the record", not "we lack the mechanic":
 *
 *   monk-moves#hp  wg-values flattened a conditional gated on ANOTHER FEAT into an unconditional Hit
 *                  Point op, so 59 archetype-feat rows across seven archetypes reported `MISSING hp|`
 *                  for a sentence we hold once, on the Resiliency feat that prints it.
 *   creed-magic    the experience harness hosted a CLASS-ARCHETYPE feat on a fighter, where the
 *                  `cleric-casting` entry its spellSlotBonus names does not exist, so the two creed
 *                  slots had nowhere to land and the record read as "no sheet effect".
 *
 * A teach is legitimate only while the comparer still reports the record whose carrier is GONE, so the
 * wg-values tests below run the real comparer twice: once against the shipped content (quiet) and once
 * against a STUNTED copy (the gap comes back, on the record that actually owns the sentence). The
 * creed-magic tests do the same to the ENGINE, on the right host and on the harness's wrong one.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { content, firstSubclass } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* Parsed once — public/core.json is 8 MB and the stunts would otherwise pay for it each time. */
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, any>>;

/** Run a comparer against a copy of the content with ONE carrier removed. Same hook batch 030 used. */
function stunted<T>(bucket: string, id: string, mutate: (rec: any) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b031-stunt-${bucket}-${id}.json`;
  const patched = { ...CORE, [bucket]: { ...CORE[bucket], [id]: structuredClone(CORE[bucket][id]) } };
  mutate(patched[bucket][id]);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(patched));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

const values = (ids: string, extra: string[] = []) => runScript('wg-values.mjs', ['--ids', ids, '--raw', '--verbose', ...extra]);

describe('batch 031 instruments — wg-values drops the resiliency-gated Hit Points parked on monk-moves', () => {
  // batch 031: monk-moves#hp
  it('monk-moves is quiet, and monk-resiliency still asserts the +3 the sentence really belongs to', () => {
    /*
     * AoN feat-6214 (Monk Moves) prints only *"You gain a +10-foot status bonus to your Speed when
     * you're not wearing armor"* — no Hit Points. AoN feat-6212 (Monk Resiliency) prints *"3 additional
     * Hit Points for each monk archetype class feat you have"*, and WG, having no per-archetype-feat
     * verb, stamps a `+3 MAX_HEALTH_BONUS` on every qualifying feat row behind `conditional IF
     * FEAT_NAMES INCLUDES "monk resiliency"`. `theirValueOps` drops that shape, so Monk Moves compares
     * its one real value (the Speed) and agrees, while Monk Resiliency — whose own row states the +3
     * UNGATED — is still compared against our `maxHpBonus`.
     *
     * mutation-proof — stunts the taught carrier `maxHpBonus` on feats/monk-resiliency. The teach moves
     * the assertion to the record that owns it; it must not silence it. Removing the field reopens
     * `MISSING hp|` on monk-resiliency, which is where the gap would really be.
     */
    expect(values('monk-moves,monk-resiliency')).toMatch(/compared 2 records with at least one comparable value; 2 agree on every one/);
    const out = stunted('feats', 'monk-resiliency', (r) => { delete r.maxHpBonus; }, (core) => values('monk-resiliency', core));
    expect(out).toMatch(/MISSING\s+hp\|\s+theirs=3\s+ours=\(nothing\)/);
  }, 180_000);

  // batch 031: monk-moves#hp
  it('the drop is gate-scoped, not a blanket — barbarian-resiliency reopens beside monk-moves', () => {
    /*
     * Proved on a SECOND archetype so the result cannot come from anything specific to the monk. 59 ops
     * in the dump carry the resiliency gate, spread over seven archetypes, and NONE of them sits on a
     * Resiliency feat — every Resiliency row states its own +3 with no FEAT_NAMES gate at all. So the
     * filter cannot swallow the sentence: take `maxHpBonus` off feats/barbarian-resiliency and the
     * record goes straight back to `MISSING hp|`.
     *
     * mutation-proof — stunts the taught carrier `maxHpBonus` on feats/barbarian-resiliency.
     */
    expect(values('barbarian-resiliency,exemplar-resiliency,champion-resiliency'))
      .toMatch(/compared 3 records with at least one comparable value; 3 agree on every one/);
    const out = stunted('feats', 'barbarian-resiliency', (r) => { delete r.maxHpBonus; }, (core) => values('barbarian-resiliency', core));
    expect(out).toMatch(/MISSING\s+hp\|\s+theirs=3\s+ours=\(nothing\)/);
  }, 180_000);
});

describe('batch 031 instruments — creed-magic is hosted on the wrong class by the experience harness', () => {
  const db = content();
  /* The harness's own two hosts, built here directly so the stunt can swap the content database.
   * `8:class:0` is the slot work/wg-batch-031-experience.json records it played the feat in. */
  const hostWith = (classId: string, over: ContentDatabase = db): Character =>
    buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 20,
        classId,
        ancestryId: 'human',
        backgroundId: Object.keys(db.backgrounds)[0],
        keyAbility: null,
        subclassId: firstSubclass(classId),
        featPicks: { '8:class:0': 'creed-magic' },
      } as never,
      over,
    );
  const creedSlots = (ch: Character) => ch.spellcasting.find((e) => e.id === 'cleric-casting')?.restrictedSlots ?? [];

  // batch 031: creed-magic
  it('creed-magic delivers two creed slots on a CLERIC and nothing on the fighter the harness used', () => {
    /*
     * AoN feat-7510: *"You gain two special 2nd-rank creed spell slots…"* Ours is
     * `feats/creed-magic.spellSlotBonus.entryId = 'cleric-casting'`, and slotEntryFor (build.ts:6893)
     * resolves an entryId-scoped bonus with `spellcasting.find(e => e.id === bonus.entryId)` followed
     * by `if (!entry) continue`. `featHost` picks the host class from the feat's TRAITS, and this one's
     * traits are only ['archetype'] — so the harness played a class-archetype feat on a fighter, where
     * that entry does not exist and the grant is silently dropped. feats/battle-harbinger-dedication
     * carries `classArchetype.classId: 'cleric'`, so the owner is always a cleric.
     */
    /* Rank 4 because the harness builds at LEVEL 20, past the printed *"At 14th level, the extra slots
     * increase to 4th rank"* step; the 2/3/4 ladder itself is pinned per level in
     * test/restricted-slots.test.ts. Two slots at every level is the invariant. */
    expect(creedSlots(hostWith('cleric')).map((s) => s.rank)).toEqual([4, 4]);
    expect(hostWith('fighter').spellcasting.find((e) => e.id === 'cleric-casting')).toBeUndefined();
  });

  // batch 031: creed-magic
  it('the instrument-limit park is not a free pass — a creed-magic without its carrier grants nothing on the cleric either', () => {
    /*
     * Parking a record in work/experience-instrument-limits.json hides it from gate 9, so the entry is
     * honest only while the mechanic is really delivered on the right host. Strip the carrier and the
     * cleric loses the slots, which is what proves the pass above is the FIELD's doing and not the
     * cleric chassis's.
     *
     * mutation-proof — stunts the taught carrier `spellSlotBonus` on feats/creed-magic.
     */
    const stuntDb = { ...db, feats: { ...db.feats, 'creed-magic': { ...db.feats['creed-magic'] } } } as ContentDatabase;
    delete (stuntDb.feats['creed-magic'] as { spellSlotBonus?: unknown }).spellSlotBonus;
    expect(creedSlots(hostWith('cleric', stuntDb))).toEqual([]);
  });
});
