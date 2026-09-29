import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { movedProseVerdict } from '../scripts/lib/moved-prose.mjs';

/**
 * Print batch P02, the closer's own edit: four entries leave scripts/data/moved-prose-baseline.json.
 *
 * WHY. reprint-check CHECK 8 (npm run verify) lists records whose prose reads like the printing their
 * page replaced, and the list only shrinks: an entry whose prose now reads like its OWN printing fails
 * with "remove the entry". The P02 description rows (data-rows-1 sparkling-targe, data-rows-2
 * spirit-sheath / devastating-spellstrike / emergency-targe) put each record on its own page's text, so
 * after --stage apply CHECK 8 named exactly these four. This file pins both halves on the SHIPPED
 * artefact: each record's shipped prose is judged "own printing" by the same pure verdict CHECK 8 uses,
 * and none of the four is back in the baseline (an entry re-added would hide a later regression).
 */
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const mirrorText = (id: string): string => {
  const cat = id.replace(/(?:-\d+)+$/, '');
  return String(JSON.parse(readFileSync(`${MIRROR}/${cat}/${id}.json`, 'utf8')).text ?? '');
};
const descs = JSON.parse(readFileSync('public/core-descriptions.json', 'utf8')) as Record<string, Record<string, { d?: string } | string>>;
const shipped = (key: string): string => {
  const [bucket, id] = key.split('/');
  const e = descs[bucket]?.[id];
  return typeof e === 'string' ? e : (e?.d ?? '');
};
const baseline = JSON.parse(readFileSync('scripts/data/moved-prose-baseline.json', 'utf8')) as Record<string, string>;

/* key -> [its own page, the page that page replaced], as the removed baseline lines named them. */
const REMOVED: [string, string, string, string][] = [
  ['classFeatures/sparkling-targe', 'hybrid-study-12', 'hybrid-study-3', 'sparkling-targe#description'],
  ['feats/spirit-sheath', 'feat-9050', 'feat-2852', 'spirit-sheath#description'],
  ['feats/devastating-spellstrike', 'feat-9052', 'feat-2853', 'devastating-spellstrike'],
  ['feats/emergency-targe', 'feat-9054', 'feat-2855', 'emergency-targe#description'],
];

/*
 * The closer's second edit: fifteen scripts/data/refresh-loss-allow.json rows. refresh-loss-check (npm run
 * verify) compares the shipped artefact with git HEAD and fails on every shrunk description, relabelled
 * link or gained spell number — which is exactly what the P02 rows do on purpose. Each allow row must be
 * the record's OWN printing: the cited doc is the record's aonId, so a row can never explain a change on
 * a record from a different page.
 */
const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, { aonId?: string }>>;
const allow = JSON.parse(readFileSync('scripts/data/refresh-loss-allow.json', 'utf8')) as { key: string; field: string; aon: string; why: string }[];
describe('booming-blast / conjurers-countermeasure / force-fang / shielding-strike / resurgent-maelstrom / unfurling-brocade / maguss-analysis / spirit-sheath / exploding-bullet / recharging-flurry / running-recharge: refresh-loss allow rows', () => {
  it('every batch P02 allow row cites its record\'s own printing (the aonId) and a confirmed finding', () => {
    const read = JSON.parse(readFileSync('work/.bP02-read.json', 'utf8')) as { confirmed: { id: string }[] };
    const findings = new Set(read.confirmed.map((f) => f.id));
    const mine = allow.filter((r) => r.why.startsWith('batch P02 '));
    expect(mine.length).toBe(15);
    for (const r of mine) {
      const [bucket, id] = r.key.split('/');
      expect(core[bucket]?.[id]?.aonId, r.key).toBe(r.aon);
      const finding = r.why.slice('batch P02 '.length).split(':')[0];
      expect(findings.has(finding), `${r.key}: ${finding}`).toBe(true);
    }
  });
});

describe('sparkling-targe / spirit-sheath / devastating-spellstrike / emergency-targe: off the moved-prose baseline', () => {
  for (const [key, own, old] of REMOVED) {
    it(`${key}: shipped prose reads like its own printing (${own}), not ${old}, and the baseline no longer lists it`, () => {
      const prose = shipped(key);
      expect(prose.length).toBeGreaterThan(40);
      expect(movedProseVerdict(prose, mirrorText(own), [[old, mirrorText(old)]])).toBeNull();
      expect(Object.keys(baseline)).not.toContain(key);
    });
  }
});
