import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
// @ts-expect-error — plain-ESM script, no type declarations (scripts/ is JS, test/ is TS).
import { appendQuestions } from '../scripts/add-owner-question.mjs';

/**
 * THE DESK NUMBERS ARE PERMANENT.
 *
 * The owner answers the rulings desk by NUMBER — "104, keep ours". Until the backfill, the number
 * lived only in work/rulings-numbering.json while the list he reads is rendered from
 * work/owner-questions.json, so the two agreed only for as long as nothing moved: the moment an entry
 * left `open` for `ruled`, every position after it shifted by one and a ruling could land on the
 * wrong record. docs/wg-batch-pipeline.md section B closes that by stamping a persistent `n` on every
 * entry "with a test pinning the n→id map" — this file.
 *
 * PINNED is generated from the backfilled file, not typed: it is the map as it stood the day the
 * numbers became permanent. A failure here means a number MOVED, which is never a legitimate edit —
 * an entry that changes array keeps its `n`, and a new question gets a new one.
 */
const QUESTIONS = 'work/owner-questions.json';
const NUMBERS = 'work/rulings-numbering.json';
const ARRAYS = ['open', 'deferred', 'ruled', 'authorisedExceptions'] as const;

type Entry = { n?: number; id?: string; ruling?: string };
const doc = JSON.parse(readFileSync(QUESTIONS, 'utf8')) as Record<string, Entry[]>;
const numbers = (JSON.parse(readFileSync(NUMBERS, 'utf8')) as { numbers: Record<string, number> }).numbers;
const all = ARRAYS.flatMap((a) => (doc[a] ?? []).map((e) => ({ ...e, arr: a })));

/** The n→id map on the day of the backfill (2026-09-06). Never edit an existing line. */
const PINNED: Record<string, number> = {
  'devil-allies': 3,
  'animist-apparition-spellcasting': 4,
  'fear-no-law-fear-no-one': 5,
  'locate-lawbreakers': 7,
  'steady-balance': 9,
  'armor-in-earth': 10,
  'benefactors-resistance': 11,
  'molten-wit': 12,
  'firework-technician-dedication': 13,
  'hellknight-dedication': 14,
  'reverse-engineer': 15,
  'intuitive-crafting': 16,
  'merchants-scale': 17,
  'nagaji-spell-familiarity': 18,
  'reinforced-chassis': 19,
  'sequestered-spell': 20,
  'clawdancer-dedication': 21,
  'shadowcaster-dedication': 22,
  'soul-warden-dedication': 23,
  'favored-terrain': 24,
  'hallowed-necromancer-dedication': 25,
  'hardwood-armor-armor': 26,
  'psychic-dedication': 27,
  'unifying-emblem-shundar-quah': 28,
  'unifying-emblem-sklar-quah': 29,
  'unifying-emblem-tamiir-quah': 30,
  'elemental-existence': 32,
  'thats-not-natural': 34,
  'versatile-mutation': 35,
  'aon-sacred-ki': 36,
  'ardent-armiger': 37,
  'devils-eye': 38,
  'gunslinger-weapon-mastery': 39,
  'hardened-chassis': 40,
  'weapon-expertise': 41,
  brutality: 42,
  'kitsune-spell-mysteries': 43,
  'nagaji-spell-mysteries': 44,
  'shoony-lore': 45,
  'advanced-red-mantis-magic': 46,
  'aeon-stone-agate-ellipsoid': 47,
  'aeon-stone-dusty-rose-prism': 48,
  'aeon-stone-western-star': 49,
  'arcana-of-iron': 50,
  'astrolabe-of-falling-stars': 51,
  'instinct-ability': 53,
  'breath-of-the-dragon': 55,
  'basic-summoner-spellcasting': 56,
  'time-mage-dedication': 57,
  'pistol-wand': 65,
  'tumbling-theft': 66,
  'mask-of-the-mantis-major': 68,
  'zealot-staff': 69,
  'wild-lights': 70,
  'toppling-tentacles': 71,
  'screech-shooter-greater': 72,
  'armigers-protection': 73,
  'keys-to-destiny': 74,
  'concordance-scout': 75,
  poppet: 76,
  goloma: 77,
  android: 78,
  'aon-wishes-for-riches': 79,
  'traveling-gourmand': 80,
  'seer-of-the-dead': 81,
  'streetfood-vendor': 82,
  haunted: 83,
  'tree-friend': 84,
  'reborn-soul': 85,
  'sense-of-belonging': 86,
  'sponsored-by-a-village': 87,
  'sky-rider': 88,
  'hammered-by-fate': 89,
  'lesser-scion': 90,
  'bachuan-revolutionary': 91,
  'sponsored-by-teacher-ot': 92,
  'lost-loved-one': 93,
  unsponsored: 94,
  wanderlust: 95,
  'sponsored-by-family': 96,
  'northridge-scholar': 97,
  'dreams-of-vengeance': 98,
  'beast-blessed': 99,
  'sponsored-by-a-stranger': 100,
  'total-power': 101,
  'flexible-spellcaster-collection-shape': 102,
  'divine-font': 103,
  magus: 104,
  animist: 105,
  'bone-magic': 107,
  'acute-vision': 108,
  'guardians-armor': 109,
  'spellmaster-dedication': 110,
  'empathic-calm': 111,
  'colugos-traversal': 112,
  'oatia-skysage-dedication': 113,
  undine: 114,
  'mightyfall-kobold': 115,
  'born-of-animal': 116,
  'grave-orc': 117,
  'deny-lady-nanbyos-charity': 118,
  'waning-moon-sarangay': 119,
  summoner: 120,
  'studious-spells': 121,
  'avernal-cape': 52,
  'kalmaugs-journal': 54,
  'relic-gift-family-skysunder-sparkwarden-uniter-adamantine': 58,
  skysunder: 59,
  sparkwarden: 60,
  'uniter-of-clans': 61,
  'adamantine-echo': 62,
  'spectacles-of-understanding': 63,
  'spectacles-of-understanding-greater': 64,
  monarch: 67,
  wizard: 106,
  'sign-bound': 122,
  'raised-by-belief': 123,
  'barbarian-resiliency': 31,
  'monk-resiliency': 33,
  'backup-runic-enhancement': 1,
  'circle-of-spirits': 2,
  'summiting-dragonblood': 6,
  'monastic-archer-stance': 8,
};
/** The three authorisedExceptions carry no id; their numbers are pinned by position. */
const PINNED_EXCEPTIONS = [124, 125, 126];

describe('the rulings desk numbers are permanent', () => {
  it('every entry of all four arrays carries an integer n', () => {
    const missing = all.filter((e) => !Number.isInteger(e.n)).map((e) => `${e.arr}:${e.id ?? e.ruling}`);
    expect(missing).toEqual([]);
  });

  it('no two entries share a number', () => {
    const byN = new Map<number, string>();
    const clashes: string[] = [];
    for (const e of all) {
      const prev = byN.get(e.n!);
      if (prev) clashes.push(`n=${e.n} on both ${prev} and ${e.id ?? e.ruling}`);
      byN.set(e.n!, e.id ?? String(e.ruling));
    }
    expect(clashes).toEqual([]);
  });

  it('keeps the n it had on the day of the backfill, whatever array it now sits in', () => {
    const moved: string[] = [];
    for (const [id, n] of Object.entries(PINNED)) {
      const e = all.find((x) => x.id === id);
      if (!e) moved.push(`${id} (#${n}) has vanished from the file — an entry may change array, never disappear`);
      else if (e.n !== n) moved.push(`${id}: #${n} became #${e.n}`);
    }
    expect(moved).toEqual([]);
    expect((doc.authorisedExceptions ?? []).map((e) => e.n)).toEqual(PINNED_EXCEPTIONS);
  });

  it('rulings-numbering.json agrees with the entries, id for id', () => {
    const disagree = all.filter((e) => e.id && numbers[e.id] !== undefined && numbers[e.id] !== e.n).map((e) => `${e.id}: file ${e.n}, numbering ${numbers[e.id!]}`);
    expect(disagree).toEqual([]);
  });
});

/**
 * The writer's guards. Each case runs scripts/add-owner-question.mjs WITHOUT --write, so it reports
 * and exits; nothing on disk moves. The refusals are the point: from now on an agent calls this, and
 * an agent will happily invent a WG operation or re-file a question the owner has already been shown.
 */
const run = (args: string[]) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['scripts/add-owner-question.mjs', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
/* A record their dump really carries (Basic Kata: a select, and a conditional adjValue on
 * MAX_HEALTH_BONUS) and a document the AoN mirror really holds, so only the field under test fails. */
const ok = [
  '--id', 'basic-kata', '--batch', '30',
  '--printed', 'Printed (feat-1): "You gain a monk feat."',
  '--theirs', 'A select of ABILITY_BLOCK plus a conditional adjValue on MAX_HEALTH_BONUS.',
  '--ours', 'A picker with no hit point bonus.',
  '--question', 'Do we mirror the +3 hit points?',
];
const swap = (flag: string, value: string) => ok.map((a, i) => (ok[i - 1] === flag ? value : a));

describe('add-owner-question.mjs allocates and refuses', () => {
  it('allocates max(n) + 1 over ALL FOUR arrays, not over open alone', () => {
    const maxAll = Math.max(...all.map((e) => e.n!));
    /* The discriminator used to be `maxAll > maxOpen` on the LIVE desk, which only held while the
     * highest number sat outside `open`. Batch 031 filed glyph-expert / divine-breadth / primal-breadth
     * (n 130-132) into `open` and the live file stopped discriminating anything. It is made on a
     * fixture instead, where the highest number is deliberately in `ruled`, so the property is asserted
     * rather than borrowed from whatever the desk happens to look like today. */
    const fixture: Record<string, Entry[]> = { open: [{ id: 'a', n: 5 }], ruled: [{ id: 'b', n: 9 }], deferred: [], authorisedExceptions: [] };
    const { added } = appendQuestions(fixture, [{ id: 'c', batch: 31, printed: 'p', theirs: 't', ours: 'o', question: 'q' }]);
    // batch 031 premise: feat-2242 "traps that feature magical writing"
    expect(added[0].n).toBe(10);
    const r = run(ok);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`#${maxAll + 1}  basic-kata`);
  });

  it('refuses an id already on the desk and points at the follow-up form', () => {
    const r = run(swap('--id', 'magus'));
    expect(r.code).toBe(2);
    expect(r.out).toContain('magus: already on the desk in `open` (n=104)');
    expect(r.out).toContain('--follow-up-of magus');
  });

  it('refuses a followUpOf that names no entry', () => {
    const r = run([...ok, '--follow-up-of', 'not-a-real-entry']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('followUpOf "not-a-real-entry" is not an entry in this file');
  });

  it('refuses printed text that names no AoN document', () => {
    const none = run(swap('--printed', 'You gain a monk feat.'));
    expect(none.code).toBe(2);
    expect(none.out).toContain('printed names no AoN doc id');

    const fake = run(swap('--printed', 'Printed (feat-999999): you gain a monk feat.'));
    expect(fake.code).toBe(2);
    expect(fake.out).toContain('"feat-999999"');
  });

  it('refuses a theirs that quotes no operation their dump carries', () => {
    const r = run(swap('--theirs', 'They give a few extra hit points somehow.'));
    expect(r.code).toBe(2);
    expect(r.out).toContain('theirs quotes none of the ops');
    expect(r.out).toContain('MAX_HEALTH_BONUS'); // it prints what they DO carry
  });
});
