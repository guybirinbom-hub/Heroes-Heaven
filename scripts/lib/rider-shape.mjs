/*
 * THE SHAPE OF A StrikeDamageRider IN JSON — the one place that says what a stored rider looks like.
 *
 * WHY THIS EXISTS. `StrikeDamageRider` (src/rules/types.ts) types `dice` as `{ n, die }`, and
 * derive.ts `strikeDamageRiders` prints `${r.dice.n}${r.dice.die}`. But riders reach the app as JSON —
 * overlay rows in scripts/data/effect-backfill.json, records in public/core.json, the two mode files —
 * and JSON is untyped, so TypeScript never saw `{ dice: 2, die: 'd6' }`. Four acid flasks shipped that
 * way (overlay rows #11781-#11784, scripts/backfill-residual-1-12.mjs): every Strike read
 * "1 acid plus undefinedundefined persistent acid plus undefinedundefined acid splash", and the test
 * that was meant to catch it pinned the same wrong shape and matched the broken string with /2d6/.
 *
 * This file is the contract the JSON is held to. `scripts/overlay-shape-check.mjs` (in `npm run verify`)
 * runs it over the whole overlay and every shipped record; test/overlay-shape-check.test.ts proves it
 * refuses the bad shapes; and a test compares RIDER_KEYS to the interface in types.ts, so adding a
 * field to the type without teaching this file fails loudly instead of letting the new field be
 * refused (or a typo of an old one be accepted).
 */

/** Every property StrikeDamageRider declares in src/rules/types.ts. test/overlay-shape-check.test.ts
 *  keeps this equal to the interface. */
export const RIDER_KEYS = [
  'type',
  'appliesTo',
  'flat',
  'dice',
  'byStrikeProficiency',
  'byWeaponSpecialization',
  'strikeName',
  'fromChoiceFlag',
  'persistent',
  'splash',
  'note',
];

/** A rider with none of these adds nothing to a Strike. */
const AMOUNT_KEYS = ['dice', 'flat', 'byStrikeProficiency', 'byWeaponSpecialization'];

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * What is wrong with one stored rider, as a list of plain-words faults ([] when it is fine).
 * The stray top-level `die` / `n` and the numeric `dice` get their own wording because they are the
 * exact shape that printed "undefinedundefined".
 */
export function riderFaults(r) {
  if (!isObj(r)) return [`the rider is ${JSON.stringify(r)}, not an object`];
  const faults = [];
  if (typeof r.type !== 'string' || !r.type) faults.push(`type is ${JSON.stringify(r.type)} (must be a damage-type name)`);
  if ('dice' in r) {
    if (!isObj(r.dice)) {
      faults.push(`dice is ${JSON.stringify(r.dice)} — it must be { n, die }; derive.ts prints "\${dice.n}\${dice.die}", which reads "undefinedundefined" for this`);
    } else {
      if (!isNum(r.dice.n)) faults.push(`dice.n is ${JSON.stringify(r.dice.n)} (must be a number)`);
      if (typeof r.dice.die !== 'string') faults.push(`dice.die is ${JSON.stringify(r.dice.die)} (must be a string, '' for splash)`);
    }
  }
  for (const stray of ['die', 'n']) {
    if (stray in r) faults.push(`stray top-level "${stray}" — it belongs inside dice: { n, die }`);
  }
  if ('flat' in r && !isNum(r.flat)) faults.push(`flat is ${JSON.stringify(r.flat)} (must be a number)`);
  if ('appliesTo' in r && !['all', 'unarmed', 'melee', 'ranged'].includes(r.appliesTo)) {
    faults.push(`appliesTo is ${JSON.stringify(r.appliesTo)} (all | unarmed | melee | ranged)`);
  }
  if ('byStrikeProficiency' in r) {
    const b = r.byStrikeProficiency;
    if (!isObj(b) || !Object.entries(b).every(([k, v]) => ['expert', 'master', 'legendary'].includes(k) && isNum(v))) {
      faults.push(`byStrikeProficiency is ${JSON.stringify(b)} (an object of expert | master | legendary → number)`);
    }
  }
  if ('byWeaponSpecialization' in r) {
    const b = r.byWeaponSpecialization;
    if (!isObj(b) || !Object.entries(b).every(([k, v]) => ['spec', 'greater'].includes(k) && isNum(v))) {
      faults.push(`byWeaponSpecialization is ${JSON.stringify(b)} (an object of spec | greater → number)`);
    }
  }
  for (const flag of ['persistent', 'splash']) {
    if (flag in r && typeof r[flag] !== 'boolean') faults.push(`${flag} is ${JSON.stringify(r[flag])} (must be true or false)`);
  }
  for (const k of ['strikeName', 'fromChoiceFlag', 'note']) {
    if (k in r && typeof r[k] !== 'string') faults.push(`${k} is ${JSON.stringify(r[k])} (must be a string)`);
  }
  for (const k of Object.keys(r)) {
    if (!RIDER_KEYS.includes(k) && k !== 'die' && k !== 'n') faults.push(`unknown key "${k}" — nothing reads it`);
  }
  if (!AMOUNT_KEYS.some((k) => k in r)) faults.push('it carries no amount (none of dice, flat, byStrikeProficiency, byWeaponSpecialization)');
  return faults;
}

/**
 * Walk `node` at any depth and push one message onto `out` for every bad rider found under a
 * `strikeDamage` key. A nested home counts: effectChoices[].options[].grant.strikeDamage is where a
 * chosen option's damage lives, and a shallow top-level look once called records empty whose
 * mechanics were inside it. Returns how many riders were examined.
 */
export function findBadRiders(node, where, out) {
  let seen = 0;
  const visit = (n, at) => {
    if (Array.isArray(n)) { n.forEach((x, i) => visit(x, `${at}[${i}]`)); return; }
    if (!isObj(n)) return;
    for (const [k, v] of Object.entries(n)) {
      if (k !== 'strikeDamage') { visit(v, `${at}.${k}`); continue; }
      if (v == null) continue;
      if (!Array.isArray(v)) { out.push(`${at}.strikeDamage is ${JSON.stringify(v)}, not an array of riders`); continue; }
      v.forEach((r, i) => {
        seen++;
        const faults = riderFaults(r);
        if (faults.length) out.push(`${at}.strikeDamage[${i}]: ${faults.join('; ')}`);
      });
    }
  };
  visit(node, where);
  return seen;
}
