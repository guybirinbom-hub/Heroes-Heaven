/*
 * BATCH 030 — THE INSTRUMENT LANE, AND THE ANTI-LAUNDERING CHECK IT OWES.
 *
 * Four batch-030 findings were "the comparer misread the carrier", not "we lack the mechanic". Each one
 * was answered by teaching a comparer to read a carrier it already had, and a teach is only legitimate
 * while the comparer still reports the record whose carrier is GONE — otherwise it has stopped
 * comparing and started asserting.
 *
 * So every test here runs the real comparer twice: once against the shipped content (the record must be
 * quiet) and once against a STUNTED copy with the taught carrier deleted (the record must report the
 * exact gap again). The stunted copy reaches the comparer through `--core`, the same hook wg-values
 * already had as `--advancement`.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ROOT = join(__dirname, '..');
const runScript = (script: string, args: string[]) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts', script), ...args], { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/* Parsed once — public/core.json is 8 MB and four tests would otherwise pay for it four times. */
const CORE = JSON.parse(readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8')) as Record<string, Record<string, any>>;

/**
 * Run a comparer against a copy of the content with ONE carrier removed or damaged.
 * The mutation is applied to a structuredClone of the touched bucket only, so the 8 MB parse above is
 * not repeated and the shipped file is never written to.
 */
function stunted<T>(bucket: string, id: string, mutate: (rec: any) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b030-stunt-${bucket}-${id}.json`;
  const patched = { ...CORE, [bucket]: { ...CORE[bucket], [id]: structuredClone(CORE[bucket][id]) } };
  mutate(patched[bucket][id]);
  writeFileSync(join(CLI_ROOT, rel), JSON.stringify(patched));
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/**
 * wg-diff's THEY-ONLY bucket, read from `--out` rather than `--list`: the printed list is capped at 400
 * rows and under `--raw` the bucket is 422, so a record can be absent from the print and present in the
 * work list. A test that reads the print would call that "quiet".
 */
function wgDiff(extra: string[] = []) {
  const rel = `work/.b030-diff-probe-${process.pid}-${Math.random().toString(36).slice(2)}.json`;
  try {
    runScript('wg-diff.mjs', ['--raw', '--out', rel, ...extra]);
    const out = JSON.parse(readFileSync(join(CLI_ROOT, rel), 'utf8'));
    return {
      theyOnly: new Map<string, string[]>(out.theyOnly.map((r: any) => [r.id, r.missing])),
      /** Whichever bucket a record landed in — the kind vectors are what the teaches move. */
      record: (id: string) => ['theyOnly', 'weOnly', 'agree'].map((b) => out[b].find((r: any) => r.id === id)).find(Boolean),
    };
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}
const theyOnly = (extra: string[] = []): Map<string, string[]> => wgDiff(extra).theyOnly;

describe('batch 030 instruments — wg-diff reads untrainedProficiency (eclectic-skill)', () => {
  // batch 030: eclectic-skill#instrument
  it('eclectic-skill: their UNTRAINED_IMPROVISATION is a skill fact, not an unmapped marker', () => {
    /*
     * *"Your proficiency bonus to untrained skill checks is equal to your level."* Ours is
     * `feats/eclectic-skill.untrainedProficiency = {levelMinus: 0}`, read by untrainedSkillBonus in
     * derive.ts as `c.level - levelMinus`. Their side says the same thing as one op, and its variable
     * used to fall through to the named `unmapped` fallback — so the record reported `missing=[unmapped]`
     * against a carrier that matches their number exactly. `unmapped` must be gone from their kind
     * vector, and the record must be out of THEY-ONLY under `--raw`, with no settle in play.
     */
    const rec = wgDiff().record('eclectic-skill');
    expect(rec.theirKinds).toEqual(['skill']);
    expect(theyOnly().has('eclectic-skill')).toBe(false);
  }, 180_000);

  // batch 030: eclectic-skill#instrument
  it('eclectic-skill: the untrainedProficiency carrier is load-bearing — proved on its Untrained Improvisation twin', () => {
    /*
     * The our-side half of the same teach, stunted on the twin rather than on Eclectic Skill itself:
     * another batch-030 family has since given feats/eclectic-skill a FEAT_SITUATIONAL entry in the
     * SKILL lane, so that record now reaches 'skill' by two roads and stunting one proves nothing.
     * feats/untrained-improvisation reaches it only through `untrainedProficiency` ({levelMinus: 2},
     * the level-2 floor), so it is where the field can be shown to be load-bearing.
     *
     * mutation-proof — stunts the taught carrier `untrainedProficiency` on feats/untrained-improvisation.
     * This is also what proves the 'untrained-improvisation' settle deleted from VERIFIED_EQUIVALENT is
     * genuinely replaced by a carrier: without the field the record reports again, exactly as it should.
     */
    expect(theyOnly().has('untrained-improvisation')).toBe(false);
    const out = stunted('feats', 'untrained-improvisation', (r) => { delete r.untrainedProficiency; }, (core) => theyOnly(core));
    expect(out.get('untrained-improvisation')).toContain('skill');
  }, 180_000);
});

describe('batch 030 instruments — wg-diff reads armorSpec as a defence (unshaken-in-iron)', () => {
  // batch 030: unshaken-in-iron#instrument
  it('unshaken-in-iron is quiet with its carrier, and reports missing=[conditional,defense] on a stunted copy', () => {
    /*
     * *"You gain the armor specialization effect of light armor. If you are trained in medium or heavy
     * armor, you gain the respective armor specialization effect for those armors as well."* Ours is
     * `armorSpec {categories:['light'], ifTrained:['medium','heavy']}`, read by armorSpecAccess and
     * applied in derive.ts as a typed RESISTANCE — never on AC. Their ARMOR_SPECIALIZATION_* variables
     * were being swallowed by the unanchored /ARMOR/ -> 'ac' test, which is why the digest said `ac`,
     * and the two trained-gated conditionals around them then read as unanswered too.
     *
     * mutation-proof — stunts the taught carrier `armorSpec` on feats/unshaken-in-iron. The conditional
     * comes back with it: `gatesOnlyWhatWeHave` can only clear a wrapper whose branches name a kind the
     * record actually holds.
     */
    expect(theyOnly().has('unshaken-in-iron')).toBe(false);
    const out = stunted('feats', 'unshaken-in-iron', (r) => { delete r.armorSpec; }, (core) => theyOnly(core));
    expect(out.get('unshaken-in-iron')).toEqual(['conditional', 'defense']);
  }, 180_000);

  // batch 030: unshaken-in-iron#instrument
  it('the ARMOR_SPECIALIZATION teach is carrier-gated, not a blanket — armor-expertise reopens beside unshaken-in-iron', () => {
    /*
     * The anti-laundering half, proved on a SECOND record so the result cannot come from anything
     * specific to Unshaken in Iron. Thirteen rows in the dump write ARMOR_SPECIALIZATION_*; the kind
     * mapping alone credits none of them — only an `armorSpec` field on our side does. Take it off
     * classFeatures/armor-expertise and the class feature goes straight back to THEY-ONLY on 'defense',
     * with its own AC track still agreeing.
     *
     * mutation-proof — stunts the taught carrier `armorSpec` on classFeatures/armor-expertise.
     */
    expect(theyOnly().has('armor-expertise')).toBe(false);
    const out = stunted('classFeatures', 'armor-expertise', (r) => { delete r.armorSpec; }, (core) => theyOnly(core));
    expect(out.get('armor-expertise')).toContain('defense');
  }, 180_000);
});

describe('batch 030 instruments — the comparers read the runes bucket (resilient)', () => {
  // batch 030: resilient
  it('resilient agrees on all three saves, and reports MISSING again on a stunted copy', () => {
    /*
     * AoN equipment-2786: *"This grants the wearer a +1 item bonus to saving throws."* The number lives
     * on `runes['resilient']` ({kind:'resilient', value:1}) — planRune etches it, resilientSaveBonus
     * reads it off the worn armour and deriveSave pools it as the item bonus. `items['resilient']`
     * carries no passiveEffects by design, which is the whole reason the digest said ours=(nothing).
     *
     * mutation-proof — stunts the taught carrier `runes/resilient`.
     */
    expect(runScript('wg-values.mjs', ['--ids', 'resilient', '--raw', '--verbose']))
      .toMatch(/^ok\s+resilient\s+\(3 values, 0 sets agree\)/m);
    const out = stunted('runes', 'resilient', (r) => { delete r.kind; }, (core) =>
      runScript('wg-values.mjs', ['--ids', 'resilient', '--raw', '--verbose', ...core]));
    expect(out).toMatch(/MISSING\s+save\|fortitude\s+theirs=1\s+ours=\(nothing\)/);
  }, 180_000);

  // batch 030: resilient
  it('resilient is COMPARED, not credited: a RuneDef holding the wrong magnitude reports DIFFERENT', () => {
    /*
     * A fallback that merely silenced the key would hide every mis-valued rune in the bucket. The teach
     * asserts the RuneDef's number, so damaging it must reopen the row. Its graded siblings are the
     * shipped proof of the same property: Resilient (Greater) asserts 2 and (Major) 3 against WG's 2
     * and 3, and they agree only because the values match.
     *
     * mutation-proof — stunts the taught carrier `runes/resilient` by value rather than by deletion.
     */
    const out = stunted('runes', 'resilient', (r) => { r.value = 5; }, (core) =>
      runScript('wg-values.mjs', ['--ids', 'resilient', '--raw', '--verbose', ...core]));
    expect(out).toMatch(/DIFFERENT\s+save\|fortitude\s+theirs=1\s+ours=5/);
  }, 180_000);

  // batch 030: resilient
  it('the runes fallback is a kind map, not a blanket — armor-potency and soaring still report beside resilient', () => {
    /*
     * All 159 runes have an items-row twin, so "it has a rune twin, believe it" would silence the whole
     * bucket in one line. Only `kind: 'resilient'` is listed, and the other rune lanes are still open
     * work: armor-potency-2/3 (ac), weapon-potency-2/3 (attack) and soaring (fly speed) must keep
     * reporting until someone reads their readers end to end.
     */
    const out = runScript('wg-values.mjs', ['--ids', 'armor-potency-2,soaring,weapon-potency-2', '--raw', '--verbose']);
    expect(out).toMatch(/MISSING\s+ac\|\s+theirs=2/);
    expect(out).toMatch(/MISSING\s+speed\|fly\s+theirs=10/);
    expect(out).toMatch(/MISSING\s+attack\|\s+theirs=2/);
  }, 180_000);
});

describe('batch 030 instruments — an item passiveEffects.saves scalar covers all three saves (bands-of-force)', () => {
  // batch 030: bands-of-force
  it('bands-of-force agrees on all three saves, and reports MISSING again on a stunted copy', () => {
    /*
     * *"The force grants you a +1 item bonus to AC and saving throws…"* Ours is
     * `items['bands-of-force'].passiveEffects = {ac:1, saves:1}`, and passiveItemBonus(c, db, 'saves')
     * is Math.max'd into deriveSave's item bonus exactly as pe.ac is pooled into deriveAc. On an ITEM
     * `pe.saves` is one NUMBER, not the per-save map the classFeatures shape uses, so the old
     * Object.entries reader yielded nothing and only `ac|=1,1` reached the diff.
     *
     * mutation-proof — stunts the taught carrier `passiveEffects.saves` on items/bands-of-force. The
     * `ac` half must survive the stunt, which is what proves the expansion is scoped to the save scalar.
     */
    expect(runScript('wg-values.mjs', ['--ids', 'bands-of-force', '--raw', '--verbose']))
      .toMatch(/^ok\s+bands-of-force\s+\(3 values, 0 sets agree\)/m);
    const out = stunted('items', 'bands-of-force', (r) => { delete r.passiveEffects.saves; }, (core) =>
      runScript('wg-values.mjs', ['--ids', 'bands-of-force', '--raw', '--verbose', ...core]));
    expect(out).toMatch(/MISSING\s+save\|fortitude\s+theirs=1\s+ours=\(nothing\)/);
    expect(out).toMatch(/ours\(all\): ac\|=1/);
  }, 180_000);

  // batch 030: bands-of-force
  it('bands-of-force graded siblings prove the scalar is compared: greater asserts 2 and major 3', () => {
    /*
     * The expansion asserts the magnitude, so the three graded rows agree only because their numbers
     * match WG's per-save operations (1 / 2 / 3). A reader that merely marked the key present would
     * have agreed on all three no matter what they held.
     */
    const out = runScript('wg-values.mjs', ['--ids', 'bands-of-force-greater,bands-of-force-major', '--raw', '--verbose']);
    expect(out).toMatch(/compared 2 records with at least one comparable value; 2 agree on every one/);
    expect(CORE.items['bands-of-force-greater'].passiveEffects.saves).toBe(2);
    expect(CORE.items['bands-of-force-major'].passiveEffects.saves).toBe(3);
  }, 180_000);
});
