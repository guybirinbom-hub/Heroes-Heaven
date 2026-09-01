import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';

/*
 * THE REPEATABLE-PICK SWEEP — 21 records moved from a per-RECORD answer to a per-TAKING one.
 *
 * An `effectChoices` answer is stored once per (record, choiceId). On a feat the player may take more
 * than once, every taking read the SAME answer, so takes 2..N granted whatever take 1 granted — the
 * player paid a feat and got a duplicate. The record's own `choice` is keyed by SLOT.
 *
 * The Special clause of all 21 was read before migrating (scripts/repeatable-pick-plan.mjs prints
 * them) and every one says "a different X each time", which is what earns `distinctAcrossTakes`. That
 * is NOT assumable: Greater Animal Senses explicitly permits repeating an answer to upgrade the sense,
 * and marking it distinct would forbid half of what it prints. Bulk-migrating on an assumed rule is
 * exactly what failed the first time this was attempted.
 */
const db = content();

describe('repeatable picks are answered once per taking', () => {
  it('every migrated record holds its pick on the per-taking lane, with its grants', () => {
    /* The shape, across all of them — a record that kept `effectChoices` would still be asking the
     * question in the place that cannot hold two answers. */
    const migrated = [
      'animal-senses', 'natural-senses', 'advanced-seeker-of-truths', 'greater-sun-blessing',
      'hallowed-initiate', 'advanced-hallowed-spell', 'deathly-secrets', 'greater-deathly-secrets',
      'advanced-domain', 'initiate-warden', 'advanced-warden', 'masterful-warden', 'peerless-warden',
      'primal-guardian', 'nights-glow', 'nights-shine', 'chronomancers-secrets', 'libertys-promise',
      'libertys-devotion', 'holy-bloom', 'holy-flower',
    ];
    for (const id of migrated) {
      const rec = db.feats[id];
      expect(rec, id).toBeTruthy();
      expect(rec.effectChoices, `${id}: the per-record picker must be gone`).toBeUndefined();
      expect(rec.choice?.options?.length, `${id}: the per-taking picker carries the options`).toBeGreaterThan(0);
      expect(rec.choice?.options?.every((o) => o.grant), `${id}: every option carries its own grant`).toBe(true);
      expect(rec.choice?.distinctAcrossTakes, `${id}: its Special says a different one each time`).toBe(true);
    }
  });

  it('Hallowed Initiate: two takings learn both focus spells, not one twice', () => {
    /* *"**Special** You can select this feat a second time, choosing the other initial focus spell."* */
    const rec = db.feats['hallowed-initiate'];
    const [a, b] = rec.choice!.options!.map((o) => o.value);
    const c = build('cleric', 12, {
      featPicks: { '2:class': 'hallowed-initiate', '4:class': 'hallowed-initiate' },
      featChoices: { '2:class': a, '4:class': b },
    } as Partial<BuildState>);
    const focus = new Set(
      c.spellcasting?.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()) ?? [],
    );
    const spellsOf = (v: string) => rec.choice!.options!.find((o) => o.value === v)?.grant?.focusSpells ?? [];
    for (const sid of [...spellsOf(a), ...spellsOf(b)]) {
      expect(focus.has(sid), `${sid} should be known — one taking must not overwrite the other`).toBe(true);
    }
  });
});
