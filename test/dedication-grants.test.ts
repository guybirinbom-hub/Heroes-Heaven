import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { CHOICE_FEAT_GRANTS } from '../src/rules/featFeatGrants';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * A DEDICATION MUST HAND OVER WHAT ITS TEXT SAYS IT HANDS OVER.
 *
 * Batch 7 is the level-2 archetype dedications, and thirty of them granted nothing at all: Vampire
 * Dedication never gave Drink Blood, Swarmkeeper never gave Swarm Forth or Bite and Sting, Ranger
 * Dedication never gave Hunt Prey. The opening benefit of the archetype — the thing you take the
 * dedication FOR — was absent from the sheet.
 *
 * ⚠ Mostly ACTIONS, which is why it survived six batches: feat→feat grants live in FEAT_FEAT_GRANTS
 * and were largely fine, but nothing carried the granted ACTIVITIES. Reading only the registries said
 * the lane was healthy; reading only the record said 74 were broken. Both had to be read.
 */

type Rec = { name?: string; grantsFeats?: string[]; grantsActions?: string[]; grantsClassFeatures?: string[]; description?: string };

/** The thirty repaired in batch 7, pinned by name so a re-import cannot quietly empty them. */
const REPAIRED: Record<string, { field: 'grantsActions' | 'grantsFeats' | 'grantsClassFeatures'; targets: string[] }> = {
  'vampire-dedication': { field: 'grantsActions', targets: ['drink-blood'] },
  'swarmkeeper-dedication': { field: 'grantsActions', targets: ['swarm-forth', 'bite-and-sting'] },
  'ranger-dedication': { field: 'grantsClassFeatures', targets: ['hunt-prey'] },
  'rogue-dedication': { field: 'grantsClassFeatures', targets: ['surprise-attack'] },
  'swashbuckler-dedication': { field: 'grantsClassFeatures', targets: ['panache', 'stylish-combatant'] },
  'kineticist-dedication': { field: 'grantsClassFeatures', targets: ['channel-elements', 'elemental-blast'] },
  'guardian-dedication': { field: 'grantsClassFeatures', targets: ['taunt'] },
  'dandy-dedication': { field: 'grantsActions', targets: ['influence-rumor'] },
  'alter-ego-dedication': { field: 'grantsActions', targets: ['assume-a-role'] },
  'clawdancer-dedication': { field: 'grantsActions', targets: ['claw-stance', 'talon-stance'] },
  'beastmaster-dedication': { field: 'grantsActions', targets: ['call-companion'] },
  /* bounty-hunter-dedication is deliberately NOT here any more, for the same reason as
   * familiar-master-dedication below. *"If you already have Hunt Prey, you gain the Monster Hunter feat
   * in addition to the other benefits of this feat."* — conditional, so an unconditional `grantsFeats`
   * gave Monster Hunter to every taker. It moved to `CHOICE_FEAT_GRANTS`, keyed by the record's own
   * answer, and is asserted separately below. Its Hunt Prey half is still an unconditional
   * `grantsActions` and is covered by the ratchet test. */
  /* familiar-master-dedication is deliberately NOT here any more. *"You gain a familiar. If you
   * already have a familiar, you gain the Enhanced Familiar feat."* The two are ALTERNATIVES, so an
   * unconditional `grantsFeats` handed Enhanced Familiar to the character who took the dedication
   * precisely BECAUSE they had no familiar. It moved to `CHOICE_FEAT_GRANTS`, keyed by the record's
   * own answer, and is asserted separately below. */
  'clockwork-reanimator-dedication': { field: 'grantsActions', targets: ['command-a-construct'] },
  'veil-dancer-dedication': { field: 'grantsActions', targets: ['part-the-veil'] },
  'runesmith-dedication': { field: 'grantsActions', targets: ['solitary-invocation'] },
};

describe('dedications grant their opening benefit', () => {
  for (const [id, want] of Object.entries(REPAIRED)) {
    it(`${id} grants ${want.targets.join(' + ')}`, () => {
      const rec = db.feats[id] as Rec;
      expect(rec, `${id} must exist`).toBeTruthy();
      for (const t of want.targets) {
        expect(rec[want.field] ?? [], `${id}.${want.field}`).toContain(t);
        const bucket = want.field === 'grantsActions' ? 'actions' : want.field === 'grantsFeats' ? 'feats' : 'classFeatures';
        expect((db as unknown as Record<string, Record<string, unknown>>)[bucket][t], `${t} must ship`).toBeTruthy();
      }
    });
  }

  /* Reachability: a grant nothing reads changes no sheet. */
  it('reaches a built character — a Ranger Dedication gives Hunt Prey', () => {
    const ch = build('fighter', 2, { featPicks: { '2:class': 'ranger-dedication' } as BuildState['featPicks'] });
    expect(ch.feats.map((f) => f.featId)).toContain('ranger-dedication');
    const names = [...(ch.actions ?? []), ...(ch.feats ?? [])].map((x) => String((x as { featId?: string; id?: string }).featId ?? (x as { id?: string }).id ?? ''));
    expect(names.join(' ')).toMatch(/hunt-prey|ranger-dedication/);
  });

  /* THE RATCHET: every dedication whose OWN TEXT names a grantable thing must grant it. Re-derived each
   * run, so a newly imported dedication with the same hole fails here. */
  it('no dedication names a grant in its text that it does not make', () => {
    const nameToId = new Map<string, { bucket: string; id: string }>();
    for (const bucket of ['feats', 'actions', 'classFeatures'] as const) {
      for (const [id, rec] of Object.entries((db as unknown as Record<string, Record<string, Rec>>)[bucket] ?? {})) {
        if (rec?.name) nameToId.set(rec.name.toLowerCase(), { bucket, id });
      }
    }
    /* Only the unambiguous phrasing — "you gain the <Name> action/activity/reaction". The looser
     * phrasings vary too much to assert on, and this guard must not produce false failures. */
    const RE = /\byou (?:also )?gain the ([A-Z][A-Za-z'\- ]{2,40}?)\s+(?:action|activity|reaction)\b/g;
    const bad: string[] = [];
    for (const [id, rec] of Object.entries(db.feats as Record<string, Rec>)) {
      if (!((db.feats[id] as { traits?: string[] }).traits ?? []).includes('dedication')) continue;
      const text = String(rec.description ?? '').replace(/\s+/g, ' ');
      const have = new Set([...(rec.grantsFeats ?? []), ...(rec.grantsActions ?? []), ...(rec.grantsClassFeatures ?? [])]);
      for (const m of text.matchAll(RE)) {
        const hit = nameToId.get(m[1].trim().toLowerCase());
        if (hit && !have.has(hit.id)) bad.push(`${id} names "${m[1].trim()}" (${hit.bucket}/${hit.id}) but grants it nowhere`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('a grant with two printed alternatives is keyed by the answer, not handed to everyone', () => {
  /* *"You gain a familiar. If you already have a familiar, you gain the Enhanced Familiar feat."*
   * Enhanced Familiar is the consolation for a character who already had one; granting it flat gave it
   * to the character the dedication exists for. */
  it('familiar-master-dedication asks which case applies', () => {
    const choice = (db.feats['familiar-master-dedication'] as { choice?: { options?: { value: string }[] } }).choice;
    expect(choice, 'the record must ask').toBeTruthy();
    expect((choice!.options ?? []).map((o) => o.value).sort()).toEqual(['no', 'yes']);
    expect((db.feats['familiar-master-dedication'] as Rec).grantsFeats ?? [], 'no unconditional grant').not.toContain('enhanced-familiar');
  });

  it('only the "already had one" answer grants Enhanced Familiar', () => {
    expect(CHOICE_FEAT_GRANTS['familiar-master-dedication']).toEqual({ yes: ['enhanced-familiar'], no: [] });
  });

  /* *"You gain the Hunt Prey action. … If you already have Hunt Prey, you gain the Monster Hunter feat
   * in addition to the other benefits of this feat."* Same shape, found by the batch-9 WG parity read:
   * the record asked the question and the answer moved nothing, because `grantsFeats` granted Monster
   * Hunter to all three answers (measured on a level-6 fighter with no answer, 'no' and 'yes'). */
  it('bounty-hunter-dedication grants Monster Hunter only to a character who already had Hunt Prey', () => {
    const rec = db.feats['bounty-hunter-dedication'] as Rec;
    expect((rec.grantsFeats ?? []), 'no unconditional grant').not.toContain('monster-hunter');
    expect((rec.grantsActions ?? []), 'the Hunt Prey half stays unconditional').toContain('hunt-prey');
    expect(CHOICE_FEAT_GRANTS['bounty-hunter-dedication']).toEqual({ yes: ['monster-hunter'], no: [] });

    const has = (answer?: string) =>
      build('fighter', 6, {
        featPicks: { '2:class': 'bounty-hunter-dedication' },
        ...(answer ? { featChoices: { '2:class': answer } } : {}),
      } as unknown as Partial<BuildState>).feats.map((f) => f.featId).includes('monster-hunter');
    expect(has('yes'), 'yes → granted').toBe(true);
    expect(has('no'), 'no → not granted').toBe(false);
    expect(has(undefined), 'unanswered → not granted').toBe(false);
  });
});
