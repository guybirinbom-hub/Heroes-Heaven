import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { deriveDefenses, deriveStrikes, stateGrantSummary } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { statHasSituational } from '../src/rules/explain';
import { content, build } from './_content';
import type { Character, FeatChoice } from '../src/rules/types';

const db = content();

/** Feats go straight onto the built character: what is under test is what DERIVE does with a record,
 *  not whether the builder would offer the slot. Two entries of one id is a legal repeat (maxTakable). */
const withFeats = (base: Character, ...ids: string[]): Character => ({
  ...base,
  feats: [...base.feats, ...ids.map((featId, i) => ({ featId, level: 1 + i * 4, category: 'ancestry' }) as FeatChoice)],
});
const anc = (ancestryId: string) => build('fighter', 9, { ancestryId });
/** What the sheet PRINTS (VitalsRail.tsx:731 / DetailsTab.tsx:74 / computePcStats.ts:70). */
const shown = (c: Character) => deriveDefenses(c, db).senses.filter((s) => !s.superseded).map((s) => s.name);
/** What the character HAS. The suppression is display-only, so this list never shrinks. */
const held = (c: Character) => deriveDefenses(c, db).senses.map((s) => s.name);

describe('Q13 — only the strongest rung of the vision ladder is printed', () => {
  it('darkvision supersedes the ancestry low-light it replaces (Alabaster Eyes on a vishkanya)', () => {
    const c = withFeats(anc('vishkanya'), 'alabaster-eyes');
    expect(shown(c)).toEqual(['darkvision']);
    expect(held(c)).toContain('low-light-vision');
  });
  it('greater darkvision supersedes darkvision', () => {
    const c = withFeats(anc('dwarf'), 'shadowdancer-dedication');
    // Hyphenated. The ladder above normalises spaces away before ranking, so BOTH spellings always
    // superseded correctly — but `addSense` keys its Map by the raw NAME, so a character holding
    // "greater darkvision" from one record and "greater-darkvision" from another printed two rows for
    // one sense. Three records were spelt with a space against eight with a hyphen; all now hyphenate.
    expect(shown(c)).toEqual(['greater-darkvision']);
    expect(held(c)).toContain('darkvision');
  });
  it('"normal" prints alone, but never beside a real vision', () => {
    expect(shown(anc('human'))).toEqual(['normal']);
    expect(shown(withFeats(anc('human'), 'alabaster-eyes'))).toEqual(['darkvision']);
  });
  it('non-vision senses are never superseded', () => {
    expect(shown(build('fighter', 9, { ancestryId: 'catfolk', heritageId: 'hunting-catfolk' }))).toEqual(['low-light-vision', 'scent']);
  });
  it('a raging barbarian with Acute Vision reads darkvision only; not raging, low-light only', () => {
    const barb = build('barbarian', 9, { ancestryId: 'elf', overrides: { addedFeats: [{ featId: 'acute-vision', level: 1, category: 'class' }] } });
    expect(shown(barb)).toEqual(['low-light-vision']);
    expect(shown({ ...barb, classResources: { ...barb.classResources, rage: 1 } })).toEqual(['darkvision']);
  });
});

describe('Aquatic Eyes conditions its upgrade on the ANCESTRY, not on itself', () => {
  it('a normal-vision ancestry gets low-light on the first taking — never darkvision', () => {
    expect(shown(withFeats(anc('human'), 'aquatic-eyes'))).toEqual(['low-light-vision']);
  });
  it('a low-light ancestry gets darkvision', () => {
    expect(shown(withFeats(anc('elf'), 'aquatic-eyes'))).toEqual(['darkvision']);
  });
  it('the printed SECOND taking is what gets a normal-vision ancestry to darkvision', () => {
    expect(shown(withFeats(anc('human'), 'aquatic-eyes', 'aquatic-eyes'))).toEqual(['darkvision']);
  });
  it('no flat `senses` grant remains on the record — that row is what made it upgrade itself', () => {
    expect(db.feats['aquatic-eyes'].senses).toBeUndefined();
    expect(db.feats['aquatic-eyes'].conditionalSenses).toHaveLength(1);
  });
});

describe('Ash-piercing Gaze is a flat-check auto-success, not a sense', () => {
  it('grants no sense', () => {
    expect(db.feats['ash-piercing-gaze'].senses).toBeUndefined();
    expect(shown(withFeats(anc('human'), 'ash-piercing-gaze'))).toEqual(['normal']);
  });
  it('stars the Strike attack row, exactly like its twin Firesight', () => {
    const c = withFeats(anc('human'), 'ash-piercing-gaze');
    const s = deriveStrikes(c, db)[0];
    expect(statHasSituational(c, { kind: 'strikeAttack', instanceId: s.instanceId }, db)).toBe(true);
    expect(FEAT_SITUATIONAL['ash-piercing-gaze'][0].when).toBe('targeting a creature concealed only by smoke or mist');
  });
});

describe('Principle C — a state card says what entering the state grants', () => {
  const barb = (level: number) =>
    build('barbarian', level, { ancestryId: 'elf', subclassId: 'fury-instinct', overrides: { addedFeats: [{ featId: 'acute-vision', level: 1, category: 'class' }] } });
  it('names the record and its grant while the state is OFF', () => {
    const g = stateGrantSummary(barb(9), db, 'rage');
    expect(g.find((x) => x.from === 'Acute Vision')?.senses.map((s) => s.name)).toEqual(['darkvision']);
    expect(g.find((x) => x.from === 'Fury Instinct')?.other).toEqual(['resistance to physical']);
  });
  it('honours the minLevel gate — Raging Resistance is a 9th-level feature', () => {
    expect(stateGrantSummary(barb(1), db, 'rage').map((x) => x.from)).toEqual(['Acute Vision']);
  });
  it('a state nothing modifies summarises to nothing, so the card renders no extra block', () => {
    expect(stateGrantSummary(build('swashbuckler', 5, { ancestryId: 'human' }), db, 'panache')).toEqual([]);
  });
});

/*
 * THE TWO FINDINGS WERE INSTANCES OF A SHAPE, AND THE SHAPE IS A SCAN.
 *
 * scripts/scan-sense-lane.mjs measures both over the whole corpus. The audit named `aquatic-eyes` and
 * `ash-piercing-gaze`; the scan found FIVE more of the first and TWO more of the second, in records
 * nobody had read. What follows holds each shape at zero using the scanner's own detector — never a
 * second copy of it — plus the player-visible outcome for each record it moved.
 */
describe('SHAPE 1 — a conditionalSenses row its own record satisfies', () => {
  const senseOf = (c: Character, name: string) => deriveDefenses(c, db).senses.find((s) => s.name === name);
  const first = (c: Character) => deriveDefenses(c, db).senses.filter((s) => !s.superseded).map((s) => s.name);

  it('is nowhere in the corpus', async () => {
    const { audit } = (await import('../scripts/scan-sense-lane.mjs')) as { audit: () => { selfSatisfying: { bucket: string; id: string }[] } };
    expect(
      audit().selfSatisfying.map((r) => `${r.bucket}/${r.id}`),
      'A flat `senses` row makes the record\'s own `ifPresent` true for everyone, so every character\n' +
        'takes the `upgraded` branch. Fix with: node scripts/apply-sense-lane-fixes.mjs',
    ).toEqual([]);
  });

  /* All five printed "you gain low-light vision, OR darkvision if you already have low-light vision"
   * and all five handed a normal-vision human darkvision at 1st level. Measured before the fix. */
  it.each(['superior-sight', 'embers-eyes', 'draconic-sight', 'hungry-eyes', 'twilight-dweller'])(
    '%s gives a normal-vision human low-light vision, not darkvision',
    (id) => {
      expect(first(withFeats(anc('human'), id))).toEqual(['low-light-vision']);
      expect(first(withFeats(anc('elf'), id))).toEqual(['darkvision']);
    },
  );

  /* The acuity the flat row carried had to move onto the conditional's `base`, or deleting the row
   * would have quietly dropped "(precise)" off the sheet for these three. */
  it.each(['draconic-sight', 'hungry-eyes', 'twilight-dweller'])('%s keeps its printed precise acuity', (id) => {
    expect(senseOf(withFeats(anc('human'), id), 'low-light-vision')?.acuity).toBe('precise');
  });

  it('You Don\'t Smell Right gives 30 ft of scent to someone with none, and +30 to someone who has it', () => {
    const human = withFeats(anc('human'), 'you-dont-smell-right');
    expect(senseOf(human, 'scent')?.range).toBe(30);
    const cat = build('fighter', 9, { ancestryId: 'catfolk', heritageId: 'hunting-catfolk' });
    expect(senseOf(cat, 'scent')?.range).toBe(30);
    expect(senseOf(withFeats(cat, 'you-dont-smell-right'), 'scent')?.range).toBe(60);
  });
});

describe('SHAPE 2 — a printed clause modelled as a sense', () => {
  it('is nowhere in any player-facing record, and the item backlog only shrinks', async () => {
    const mod = (await import('../scripts/scan-sense-lane.mjs')) as {
      audit: () => { prose: { player: { bucket: string; id: string; name: string }[]; ratchet: unknown[] } };
      ITEM_PROSE_RATCHET: number;
    };
    const { prose } = mod.audit();
    expect(
      prose.player.map((r) => `${r.bucket}/${r.id} "${r.name}"`),
      'SenseEntry.name is a sense SELECTOR (darkvision, scent, tremorsense). A clause here prints a\n' +
        'sentence on the sheet\'s Senses row and claims a capability the record does not grant.',
    ).toEqual([]);
    // A ratchet, not a zero: each of the ten is a genuine judgement call about an item capability
    // with no better surface. It may go down and never up.
    expect(prose.ratchet.length).toBeLessThanOrEqual(mod.ITEM_PROSE_RATCHET);
  });

  it.each([
    ['smoke-sight', 'targeting a creature concealed only by smoke'],
    ['brilliant-vision', 'targeting a creature concealed only by clouds, dust, fog, mist, smoke, or similarly loose matter'],
  ])('%s grants no sense and stars the Strike row instead', (id, when) => {
    const c = withFeats(anc('human'), id);
    expect(db.feats[id].senses).toBeUndefined();
    expect(deriveDefenses(c, db).senses.filter((s) => !s.superseded).map((s) => s.name)).toEqual(['normal']);
    const s = deriveStrikes(c, db)[0];
    expect(statHasSituational(c, { kind: 'strikeAttack', instanceId: s.instanceId }, db)).toBe(true);
    expect(FEAT_SITUATIONAL[id][0].when).toBe(when);
  });
});

describe('the situational registry declares each id once per map', () => {
  /*
   * A duplicate key in an object literal is not an error — the later one silently wins and everything
   * the earlier said is discarded. test/authoring-guards.test.ts already guards the four grant maps,
   * but its key regex is single-quoted (`'id':`) and this file is double-quoted, so pointing it here
   * would have matched nothing and passed either way. PER MAP, not per file: the same id legitimately
   * appears in FEAT_SITUATIONAL and CHOICE_SITUATIONAL (heroic-scion-dedication does), and a
   * whole-file scan reports that as a collision when it is not one.
   */
  it('across all seven maps in situationalBonuses.ts', () => {
    const text = readFileSync(new URL('../src/rules/situationalBonuses.ts', import.meta.url), 'utf8');
    const dupes: string[] = [];
    for (const m of text.matchAll(/^export const (\w+)[^=]*= \{$/gm)) {
      const start = m.index! + m[0].length;
      const end = text.indexOf('\n};', start);
      const body = text.slice(start, end < 0 ? undefined : end);
      const seen = new Map<string, number>();
      for (const k of body.matchAll(/^ {2}["']?([A-Za-z0-9_-]+)["']?:\s/gm)) seen.set(k[1], (seen.get(k[1]) ?? 0) + 1);
      for (const [id, n] of seen) if (n > 1) dupes.push(`${m[1]}: "${id}" declared ${n} times`);
    }
    expect(dupes, 'MERGE into the existing entry; never append a second one for the same id.').toEqual([]);
  });
});

describe('the overlay records the removals, so a regen keeps them', () => {
  const rows = JSON.parse(readFileSync(new URL('../scripts/data/effect-backfill.json', import.meta.url), 'utf8')) as { category: string; id: string; field: string; value: unknown }[];
  const row = (id: string, field: string) => rows.filter((r) => r.category === 'feats' && r.id === id && r.field === field);
  it('every record the sweep touched carries a `value: null` senses row (= remove the field)', () => {
    const swept = [
      'aquatic-eyes',
      'ash-piercing-gaze',
      'superior-sight',
      'embers-eyes',
      'draconic-sight',
      'hungry-eyes',
      'twilight-dweller',
      'you-dont-smell-right',
      'smoke-sight',
      'brilliant-vision',
    ];
    expect(Object.fromEntries(swept.map((id) => [id, row(id, 'senses').map((r) => r.value)]))).toEqual(
      Object.fromEntries(swept.map((id) => [id, [null]])),
    );
  });
  it('aquatic-eyes/senses and ash-piercing-gaze/senses are `value: null` (= remove the field)', () => {
    expect(row('aquatic-eyes', 'senses').map((r) => r.value)).toEqual([null]);
    expect(row('ash-piercing-gaze', 'senses').map((r) => r.value)).toEqual([null]);
    expect(row('aquatic-eyes', 'conditionalSenses')).toHaveLength(1);
  });
  /*
   * The tripwire the risks section CLAIMED the block above was. It was not: that block says nothing
   * about `superseded`, and test/authoring-guards.test.ts's orphan-field check would PASS an authored
   * `superseded` row, because after this change the name appears in derive.ts, which is the only thing
   * that check tests. `superseded` is a display verdict computed per character; a content record
   * carrying it would be honoured as if derived, and would suppress a sense on every character.
   */
  it('`superseded` is DERIVED ONLY — nothing may author it into content', () => {
    expect(rows.filter((r) => r.field === 'superseded')).toEqual([]);
    const seen: string[] = [];
    const walk = (o: unknown, at: string) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) return o.forEach((x) => walk(x, at));
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === 'senses' && Array.isArray(v)) {
          for (const s of v) if (s && typeof s === 'object' && 'superseded' in s) seen.push(at);
        } else walk(v, at);
      }
    };
    const core = JSON.parse(readFileSync(new URL('../public/core.json', import.meta.url), 'utf8')) as Record<string, Record<string, unknown>>;
    for (const [bucket, recs] of Object.entries(core)) if (recs && typeof recs === 'object') for (const [id, r] of Object.entries(recs)) walk(r, `${bucket}/${id}`);
    expect(seen).toEqual([]);
  });
});

/**
 * "IF YOU ALREADY HAD LOW-LIGHT VISION, YOU INSTEAD GAIN DARKVISION" — through a battle form.
 *
 * Ursine Avenger Form is the one stance corpus-wide carrying a `senseIfFeat` rider, and Senses of the
 * Bear is its feat: in the form you gain low-light vision, or darkvision if you already had low-light.
 *
 * The interesting part is WHERE the low-light comes from. Eight records grant it through
 * `conditionalSenses` ("you gain low-light, or darkvision if you already have it") rather than as a
 * flat sense row, and the rider's own `hasLowLight` predicate cannot see those — it reads the raw
 * source rows, and the conditional pass runs after it. A verifier measured that and reported it as a
 * regression that had cost 7 records their darkvision.
 *
 * IT HAD NOT. The conditional pass runs later and upgrades the rider's own low-light, so the player
 * ends up with darkvision either way; only the rider's attribution row differs. These four cases pin
 * the outcome the player actually reads, including BOTH controls — the one that must NOT produce
 * darkvision is what makes the other three mean anything.
 */
describe('Ursine Avenger Form and the low-light upgrade', () => {
  const con = content();
  const sensesOf = (ch: Parameters<typeof deriveDefenses>[0]) =>
    (deriveDefenses({ ...ch, activeStance: 'ursine-avenger-form' }, con).senses ?? []).map((s) => s.name);

  it('upgrades to darkvision when low-light came from a conditionalSenses feat', () => {
    const undine = build('ranger', 8, {
      ancestryId: 'human', heritageId: 'undine',
      featPicks: { '1:ancestry:0': 'aquatic-eyes', '2:class:0': 'senses-of-the-bear' },
    });
    expect(sensesOf(undine)).toContain('darkvision');

    const superior = build('ranger', 8, {
      ancestryId: 'human',
      featPicks: { '1:ancestry:0': 'superior-sight', '2:class:0': 'senses-of-the-bear' },
    });
    expect(sensesOf(superior)).toContain('darkvision');
  });

  it('and when low-light came from the ANCESTRY', () => {
    expect(sensesOf(build('ranger', 8, { ancestryId: 'elf', featPicks: { '2:class:0': 'senses-of-the-bear' } }))).toContain('darkvision');
  });

  /* The control. Without this the three above pass for a build that hands out darkvision to everyone. */
  it('but NOT for a character with no low-light at all — the feat says "if you already had"', () => {
    const plain = sensesOf(build('ranger', 8, { ancestryId: 'human', featPicks: { '2:class:0': 'senses-of-the-bear' } }));
    expect(plain).toContain('low-light-vision');
    expect(plain).not.toContain('darkvision');
  });
});
