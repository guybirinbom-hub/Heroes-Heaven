/*
 * A REPRINT TWIN THAT DOES LESS THAN THE PRINTING IT REPLACES — read by scripts/trust-ledger.mjs (which
 * marks it) and scripts/trust-ledger-check.mjs (which fails when one is left unmarked).
 *
 * desk #158 keeps both printings of a reprinted item: the old one `edition: 'legacy'`, carrying
 * "Remastered as" the reprint. Where the two print the same level they are the same item, and the
 * legacy record is usually the one that carries its rules — the reprint came in as its page's text.
 * 56 such reprints are what "Hide legacy data" offers in the legacy half's place (findHiddenTwins,
 * src/data/index.ts): Greater Singing Shortbow landed as an Equipment card with no Strike, the Greater
 * Healer's Gel with no spell and no uses, and none of them said so (2026-09-25).
 *
 * Returns one row per such twin: `{ key: 'items/<twin>', from: ['items/<legacy>', …], lost: [field, …],
 * samePrice, lostSamePrice }`, where `lost` is every rule field a same-level legacy record carries and the
 * twin does not (`lostSamePrice`: the same, from the legacy records that also print its price).
 * A different level is a rebuilt item (Tideplate, Charlatan's Gloves) and is not compared. A different
 * price at the same level (`samePrice: false`) may be one too: Arboreal Boots (160 gp against Boots of
 * Elvenkind's 145) prints no activation at all, so the legacy record's fields say what the twin LACKS only
 * where the numbers agree. What a twin that applies nothing says is true either way ("shown, not applied").
 *
 * A field NEITHER printing prints is not a gap (package I, I7b, 2026-10-17): the four Endless Grimoire /
 * Codex twins lacked only `usage`, which their legacy halves carry from Foundry while neither AoN page
 * prints a Usage line. scripts/data/twin-gap-allow.json names each such field with its print evidence,
 * and `lost` leaves it out; nothing else is excused, so the twin-gap guards (scripts/reprint-check.mjs
 * CHECK 10, test/hidden-reprint-twins.test.ts) fail on every other gap.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* A plain path, not a URL object: under vitest's jsdom environment `URL` is jsdom's, which node:fs does not
 * take as a file URL — the allow file then read as absent and excused nothing. */
const ALLOW_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'twin-gap-allow.json');

const copper = (p) => (p?.pp ?? 0) * 1000 + (p?.gp ?? 0) * 100 + (p?.sp ?? 0) * 10 + (p?.cp ?? 0);

/** scripts/data/twin-gap-allow.json as `Map<'items/<twin>', Set<field>>` (empty when the file is absent). */
export function loadTwinGapAllow(file = ALLOW_FILE) {
  const out = new Map();
  if (!existsSync(file)) return out;
  for (const [key, fields] of Object.entries(JSON.parse(readFileSync(file, 'utf8')))) {
    if (key === '_' || !fields || typeof fields !== 'object') continue;
    // An entry with no reason excuses nothing: the reason is the evidence.
    out.set(key, new Set(Object.entries(fields).filter(([, why]) => typeof why === 'string' && why.trim()).map(([f]) => f)));
  }
  return out;
}

/** Fields that describe or list an item and apply no rule — the ledger's CREATED_CONTENT plus the three
 *  every new-only item is given from its page's facets. */
export const LISTING_FIELDS = new Set([
  'id', 'name', 'traits', 'rarity', 'source', 'description', 'descRefs', 'edition', 'level', 'category',
  'prerequisites', 'actionCost', 'otherTags', 'ancestryId', 'versatile', 'abilityBoosts', 'legacyNames',
  'aonId', 'aonParentId', 'aonSection', 'aonOrigin', 'remasteredAs', 'price', 'bulk', 'itemType',
]);

/** A uses tracker: the importer adds one from a printed Frequency line, and it changes nothing on the sheet. */
export const TRACKER_FIELDS = new Set(['counters', 'frequency']);

export const hasValue = (v) => v != null && v !== ''
  && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

/** The rule fields a record carries (non-empty, outside LISTING_FIELDS). */
export const ruleFields = (rec) => Object.keys(rec ?? {}).filter((k) => !LISTING_FIELDS.has(k) && hasValue(rec[k]));

export function reprintTwinGaps(core, { allow = loadTwinGapAllow() } = {}) {
  const items = core?.items ?? {};
  const byTwin = new Map();
  for (const [id, L] of Object.entries(items)) {
    const ra = L?.remasteredAs;
    if (ra?.bucket !== 'items' || !ra.id || ra.id === id) continue;
    const T = items[ra.id];
    if (!T?.name || (L.level ?? null) !== (T.level ?? null)) continue;
    const excused = allow.get(`items/${ra.id}`);
    const lost = ruleFields(L).filter((k) => !hasValue(T[k]) && !excused?.has(k));
    if (!lost.length) continue;
    const row = byTwin.get(ra.id) ?? { key: `items/${ra.id}`, from: [], lost: [], samePrice: false, lostSamePrice: [] };
    row.from.push(`items/${id}`);
    row.lost = [...new Set([...row.lost, ...lost])].sort();
    if (copper(L.price) === copper(T.price)) {
      row.samePrice = true;
      row.lostSamePrice = [...new Set([...row.lostSamePrice, ...lost])].sort();
    }
    byTwin.set(ra.id, row);
  }
  return [...byTwin.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** What the lost fields do, in the player's words (the `partly` wording src/sheet/TrustMarker.tsx shows). */
const WORDS = [
  [/^(heldSpells|innateSpells|spell|spells|focusSpells)$/, 'its spells'],
  [/^(uses|consumableType)$/, 'its uses'],
  [/^(activationCost|frequency|counters)$/, 'its activation'],
  [/^(group|damage|range|reload|builtInRunes|attackItemBonus|runes)$/, 'its Strike'],
  [/^(usage|hands)$/, 'how it is worn or held'],
  [/^(passiveEffects|dynamicSkillBonus|situational|resistances|degreeShifts)$/, 'its bonuses'],
  [/^(effectChoices|choice)$/, 'its choices'],
];
export function lostWords(fields) {
  const order = [...WORDS.map(([, w]) => w), 'the rest of its rules'];
  const said = new Set(fields.map((f) => WORDS.find(([re]) => re.test(f))?.[1] ?? 'the rest of its rules'));
  return [...said].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
}
