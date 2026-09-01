import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * A STANCE THAT PRINTS AN UNARMED ATTACK MUST GRANT IT.
 *
 * Twisting Petal Stance came out of the Wanderer's Guide parity pass with no gale blossom strike.
 * Measuring before authoring showed it was not one record: of 100 stance-trait records, 24 print an
 * attack with dice and NONE of them shipped one — a monk in Tiger Stance had no tiger claw, and the
 * only Strikes the stance permits were unavailable. Their side grants each as an Unarmed-trait weapon
 * item; ours are `grantedStrikes`, the field the other 186 shipped strikes already use.
 *
 * This is the guard, not a spot check: it re-derives the list from the printed text every run, so a
 * newly imported stance that prints a strike fails here instead of shipping bare.
 */

/* The printed shape: "…can make crane wing attacks. These deal 1d6 bludgeoning damage; are in the
 * brawling group; and have the agile, finesse, nonlethal, and unarmed traits." The dice live in the
 * sentence AFTER the attack is named — a predicate that cannot cross a full stop finds 2 of 24. */
const NAME_RE = /(?:you can make|the only Strikes you can make are|you gain a|you gain an|can make)\s+([a-z][a-z' -]{2,40}?)\s+(?:ranged )?(?:unarmed )?(?:attacks?|strikes?|Strikes?)\b/i;
const DICE_RE = /\b(?:deal|dealing|that deals?)\s+(\d+d\d+)(?:\s+([a-z]+))?\s+damage/i;

/* Two stances are `actions` records granted by Clawdancer Dedication, and `grantedStrikes` is NOT read
 * from the `actions` bucket (build.ts's collector reads feats, heritages, ancestries, classFeatures,
 * the picked subclass, invested items and modes). Both live on the dedication that hands them over. */
const REHOMED: Record<string, string> = {
  'claw-stance': 'clawdancer-dedication',
  'talon-stance': 'clawdancer-dedication',
};

type Row = { bucket: string; id: string; name: string; strikeName: string; dice: string };

function stancesPrintingAStrike(): Row[] {
  const out: Row[] = [];
  for (const bucket of ['feats', 'classFeatures', 'heritages', 'actions'] as const) {
    for (const [id, rec] of Object.entries((db as unknown as Record<string, Record<string, Record<string, unknown>>>)[bucket] ?? {})) {
      if (!((rec.traits as string[]) ?? []).includes('stance')) continue;
      const text = String(rec.description ?? '').replace(/\s+/g, ' ');
      const nm = NAME_RE.exec(text);
      const dice = DICE_RE.exec(text);
      if (!nm || !dice) continue;
      out.push({ bucket, id, name: String(rec.name), strikeName: nm[1].trim(), dice: dice[1] });
    }
  }
  return out;
}

const strikesOn = (bucket: string, id: string) => {
  const home = REHOMED[id] ? { bucket: 'feats', id: REHOMED[id] } : { bucket, id };
  const rec = (db as unknown as Record<string, Record<string, { grantedStrikes?: { name: string; die: string }[] }>>)[home.bucket]?.[home.id];
  return rec?.grantedStrikes ?? [];
};

describe('stance strikes', () => {
  it('finds the 24 stances that print one (the predicate itself, so a silent zero cannot pass)', () => {
    const rows = stancesPrintingAStrike();
    expect(rows.length).toBeGreaterThanOrEqual(24);
  });

  it('every stance that prints an unarmed attack grants it', () => {
    const bare = stancesPrintingAStrike().filter((r) => !strikesOn(r.bucket, r.id).length);
    expect(bare.map((r) => `${r.bucket}/${r.id} (${r.strikeName} ${r.dice})`)).toEqual([]);
  });

  it('grants it with the printed die', () => {
    const wrong: string[] = [];
    for (const r of stancesPrintingAStrike()) {
      const [count, die] = r.dice.split('d');
      const match = strikesOn(r.bucket, r.id).find(
        (s) => s.die === `d${die}` && (Number(count) === 1 || (s as { dice?: number }).dice === Number(count)),
      );
      if (!match) wrong.push(`${r.id}: printed ${r.dice}, shipped ${JSON.stringify(strikesOn(r.bucket, r.id).map((s) => s.die))}`);
    }
    expect(wrong).toEqual([]);
  });

  it('every granted stance strike carries the unarmed trait and a weapon group', () => {
    const bad: string[] = [];
    for (const r of stancesPrintingAStrike()) {
      for (const s of strikesOn(r.bucket, r.id) as { name: string; traits?: string[]; group?: string; damageType?: string }[]) {
        if (!(s.traits ?? []).includes('unarmed')) bad.push(`${r.id}/${s.name}: no unarmed trait`);
        if (!s.group) bad.push(`${r.id}/${s.name}: no weapon group`);
        if (!s.damageType) bad.push(`${r.id}/${s.name}: no damage type`);
      }
    }
    expect(bad).toEqual([]);
  });

  /*
   * Reachability: a field nothing reads is authored data that changes no sheet, and this project has
   * shipped write-only fields before. `grantedStrikes` is collected into `Character.naturalAttacks`
   * (build.ts ~4868) — NOT `Character.strikes`, which is the weapon list.
   */
  const naturalNames = (ch: ReturnType<typeof build>) =>
    (ch.naturalAttacks ?? []).map((n) => String(n.name).toLowerCase());

  /*
   * ⚠ THE CARRIER CHANGED, THE REQUIREMENT DID NOT. This used to assert `gale blossom` in
   * `naturalAttacks`, which is where a stance feat's `grantedStrikes` landed — UNCONDITIONALLY. That
   * was the bug: the Strike appeared on a monk who had never entered the stance, and twice on one who
   * had, because the stance system renders it separately from the stance definition. Stance-trait
   * feats are now skipped by `collectGrantedNaturals`, so the Strike arrives through the stance, which
   * is what *"the only Strikes you can make are crane wing attacks"* means. Reachability is still
   * asserted here — through the path a player actually gets it by.
   */
  it('reaches a built character only once the stance is entered — Twisting Petal Stance', () => {
    const ch = build('monk', 4, { featPicks: { '2:class': 'twisting-petal-stance' } as BuildState['featPicks'] });
    expect(ch.feats.map((f) => f.featId)).toContain('twisting-petal-stance');
    expect(naturalNames(ch), 'not while standing normally').not.toContain('gale blossom');

    const entered = deriveStrikes({ ...ch, activeStance: 'twisting-petal-stance' }, db).map((s) => s.name.toLowerCase());
    expect(entered, 'and exactly once in the stance').toContain('gale blossom');
    expect(entered.filter((n) => n === 'gale blossom').length).toBe(1);
  });

  /* And through the re-homed carrier: both stances arrive from the one dedication that grants them. */
  it('reaches a built character through the re-homed carrier — Clawdancer Dedication', () => {
    const ch = build('fighter', 4, { featPicks: { '2:class': 'clawdancer-dedication' } as BuildState['featPicks'] });
    expect(ch.feats.map((f) => f.featId)).toContain('clawdancer-dedication');
    expect(naturalNames(ch)).toContain('frenzied claw');
    expect(naturalNames(ch)).toContain('spinning talon');
  });
});
