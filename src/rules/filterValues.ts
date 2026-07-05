/*
 * Parsers that turn the prose values on content (spell range/area/duration, item price/bulk)
 * into a single comparable magnitude, so a quantized range-slider can filter on them.
 *
 * Convention: an ABSENT or "instant"/"touch"/"self" value maps to 0 (the low end), and an
 * open-ended value ("unlimited", "permanent", "planetary") maps to Infinity (the top stop).
 * Anything we can't parse also maps to 0 so it isn't hidden unless the user raises the floor.
 */

const NUM = /(\d[\d,]*(?:\.\d+)?)/;

function num(s: string): number | null {
  const m = s.match(NUM);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Range / area string → feet. "touch"/"self"/absent → 0; "unlimited"/"planetary" → Infinity. */
export function parseFeet(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.toLowerCase();
  if (/touch|self|personal/.test(s)) return 0;
  if (/unlimited|planet|interplanar|line of sight|anywhere/.test(s)) return Infinity;
  if (/mile/.test(s)) return (num(s) ?? 1) * 5280;
  const n = num(s);
  return n == null ? 0 : n;
}

/** Duration string → seconds. instant/absent → 0; "unlimited"/"permanent"/"until" → Infinity.
 *  "sustained" is treated as a short, concentration-bounded duration (≈1 minute). */
export function parseDurationSeconds(raw: string | undefined): number {
  if (!raw) return 0;
  const s = raw.toLowerCase();
  if (/instant/.test(s)) return 0;
  if (/permanent|unlimited|until|forever/.test(s)) return Infinity;
  const n = num(s) ?? 1;
  if (/round/.test(s)) return n * 6;
  if (/minute|min\b/.test(s)) return n * 60;
  if (/hour|hr\b/.test(s)) return n * 3600;
  if (/day/.test(s)) return n * 86400;
  if (/week/.test(s)) return n * 604800;
  if (/month/.test(s)) return n * 2592000;
  if (/year/.test(s)) return n * 31536000;
  if (/sustained/.test(s)) return 60; // up to ~1 minute of Sustaining
  return 0;
}

/** A named stop on a quantized slider. */
export interface SliderStop {
  label: string;
  value: number;
}

/** Spell range stops (feet). Top stop = Infinity = "unlimited". */
export const RANGE_STOPS: SliderStop[] = [
  { label: 'Touch', value: 0 },
  { label: '5 ft', value: 5 },
  { label: '10 ft', value: 10 },
  { label: '15 ft', value: 15 },
  { label: '30 ft', value: 30 },
  { label: '60 ft', value: 60 },
  { label: '100 ft', value: 100 },
  { label: '120 ft', value: 120 },
  { label: '500 ft', value: 500 },
  { label: '1000 ft', value: 1000 },
  { label: '1 mi', value: 5280 },
  { label: '∞', value: Infinity },
];

/** Spell area stops (feet). Low stop = 0 = "no area / single target". */
export const AREA_STOPS: SliderStop[] = [
  { label: 'None', value: 0 },
  { label: '5 ft', value: 5 },
  { label: '10 ft', value: 10 },
  { label: '15 ft', value: 15 },
  { label: '20 ft', value: 20 },
  { label: '30 ft', value: 30 },
  { label: '60 ft', value: 60 },
  { label: '120 ft', value: 120 },
  { label: '120+', value: Infinity },
];

/** Spell duration stops (seconds). */
export const DURATION_STOPS: SliderStop[] = [
  { label: 'Inst', value: 0 },
  { label: '1 rd', value: 6 },
  { label: '1 min', value: 60 },
  { label: '10 min', value: 600 },
  { label: '1 hr', value: 3600 },
  { label: '8 hr', value: 28800 },
  { label: '1 day', value: 86400 },
  { label: '1 wk', value: 604800 },
  { label: '∞', value: Infinity },
];

/** Spell rank stops (0 = cantrip). */
export const RANK_STOPS: SliderStop[] = Array.from({ length: 11 }, (_, i) => ({
  label: i === 0 ? 'Cantrip' : `${i}`,
  value: i,
}));

/** Item level stops (0–30). */
export const ITEM_LEVEL_STOPS: SliderStop[] = Array.from({ length: 31 }, (_, i) => ({
  label: i % 5 === 0 ? `${i}` : '',
  value: i,
}));

/** Feat level stops (0–20). */
export const FEAT_LEVEL_STOPS: SliderStop[] = Array.from({ length: 21 }, (_, i) => ({
  label: i % 5 === 0 ? `${i}` : '',
  value: i,
}));

/** Item price stops (in copper). Top stop = Infinity. */
export const PRICE_STOPS: SliderStop[] = [
  { label: 'Free', value: 0 },
  { label: '1 sp', value: 10 },
  { label: '1 gp', value: 100 },
  { label: '10 gp', value: 1000 },
  { label: '100 gp', value: 10000 },
  { label: '1k gp', value: 100000 },
  { label: '10k gp', value: 1000000 },
  { label: '∞', value: Infinity },
];

/** Weapon damage-die stops (die faces: d4..d12). Low stop 1 lets "no die" (dice-less) items pass. */
export const DAMAGE_DIE_STOPS: SliderStop[] = [
  { label: '1', value: 1 },
  { label: 'd4', value: 4 },
  { label: 'd6', value: 6 },
  { label: 'd8', value: 8 },
  { label: 'd10', value: 10 },
  { label: 'd12', value: 12 },
];

/** Weapon range-increment stops (feet). 0 = melee (no increment). */
export const WEAPON_RANGE_STOPS: SliderStop[] = [
  { label: 'Melee', value: 0 },
  { label: '10 ft', value: 10 },
  { label: '20 ft', value: 20 },
  { label: '30 ft', value: 30 },
  { label: '60 ft', value: 60 },
  { label: '100 ft', value: 100 },
  { label: '120 ft', value: 120 },
  { label: '240 ft', value: 240 },
];

/** Item bulk stops. 0 = negligible ("—"), 0.1 = Light ("L"). */
export const BULK_STOPS: SliderStop[] = [
  { label: '—', value: 0 },
  { label: 'L', value: 0.1 },
  { label: '0.5', value: 0.5 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '5', value: 5 },
  { label: '10', value: 10 },
  { label: '25', value: 25 },
  { label: '50+', value: Infinity },
];
