/**
 * Removes the degree-of-success rules that `scripts/apply-degree-shifts.mjs` has just written into
 * the structured `degreeShifts` field, so each one is stated ONCE.
 *
 * Before this, ~107 of them lived as PROSE inside src/rules/situationalBonuses.ts — inside a `bonus`
 * string, inside a `when` string, or as a `RecordMarker.value`. That is exactly the drift the
 * structured field was built to end: `steadying-stone` starred Acrobatics and left the Balance action
 * bare while `sure-feet` marked the actions and left the skills bare, because nothing kept two
 * hand-written registries in step. Leaving both would have printed the same sentence on the sheet
 * twice, from two sources that can disagree.
 *
 * Three treatments, and the difference matters:
 *   DELETE — the entry said nothing but the degree shift. The structured field says all of it.
 *   EDIT   — the entry ALSO carried a number (+2 circumstance) or a second rule ("you aren't
 *            off-guard while you Balance"). That half is not a degree shift and has nowhere else to
 *            live, so the entry stays and only the degree clause is cut out.
 *   KEEP   — not touched here: a DOWNGRADE ("but a failure becomes a critical failure"), which no
 *            value of `DegreeShift.shift` can express, stays in the prose that can say it.
 *
 * The registries are rewritten by re-serialising the PARSED objects for the lines it changes, so a
 * field this script does not know about (`dcOnly`, extra targets) survives untouched.
 *
 * Run: node scripts/dedupe-degree-prose.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FILE = join(ROOT, 'src/rules/situationalBonuses.ts');
const DRY = process.argv.includes('--dry');

/* Entries to KEEP with the degree clause cut out. Key: `<id>#<index>`. */
const HALF_DAMAGE = (save) => ({ when: `on a failed ${save} save against a damaging effect`, bonus: 'you take half damage' });
const EDITS = {
  // A numeric bonus whose trigger sentence had the shift bolted onto it.
  'well-groomed#0': { when: 'against diseases' },
  'the-sickness#0': { when: 'against disease' },
  'grub-gloves#0': { when: 'on Reflex saves to Grab an Edge' },
  'grub-gloves-lesser#0': { when: 'on Reflex saves to Grab an Edge' },
  'grub-gloves-moderate#0': { when: 'on Reflex saves to Grab an Edge' },
  'grub-gloves-greater#0': { when: 'on Reflex saves to Grab an Edge' },
  'bravos-brew-greater#1': { when: 'on Will saves against fear (this replaces the +3, it does not stack)' },
  'juggernaut-mutagen-greater#0': { when: 'while the greater juggernaut mutagen is active (1 hour)' },
  'wajaghand-vanara#0': { when: 'against emotion effects' },
  'numb#0': { when: 'on saves against emotion and pain effects' },
  'gorilla-stance#0': { when: 'on Athletics checks to Climb while in Gorilla Stance' },
  // ⚠ KEPT deliberately: the "but a failure becomes a critical failure" half is a DOWNGRADE, and
  // `DegreeShift.shift` has no value that can say it. Cutting it would delete a real rule.
  'conceited-mindset#0': { when: 'against mental effects (but a failure becomes a critical failure)' },
  // A second, non-degree rule that shared the entry.
  'brine-may#0': { bonus: "you don't sink if you end your turn in water without having succeeded at a Swim that round" },
  'jungle-strider#0': { bonus: "you aren't off-guard while doing so" },
  'just-the-facts#0': { bonus: "the check isn't secret, and you know which information is inaccurate" },
  'travelers-fulu#0': { bonus: 'also counts as having a compass' },
  'elements-of-creation#0': { bonus: "creative spark's bonus is doubled" },
  // The "greater" save features pair their shift with half damage on a failure. The shift is now
  // structured; the half-damage clause is not a degree shift and stays.
  'assured-evasion#0': HALF_DAMAGE('Reflex'),
  'fortress-of-will#0': HALF_DAMAGE('Will'),
  'greater-dogged-will#0': HALF_DAMAGE('Will'),
  'greater-juggernaut#0': HALF_DAMAGE('Fortitude'),
  'greater-kinetic-durability#0': HALF_DAMAGE('Fortitude'),
  'greater-mysterious-resolve#0': HALF_DAMAGE('Will'),
  'greater-natural-reflexes#0': HALF_DAMAGE('Reflex'),
  'greater-performers-heart#0': HALF_DAMAGE('Will'),
  'greater-rogue-reflexes#0': HALF_DAMAGE('Reflex'),
  'greater-unassailable-soul#0': HALF_DAMAGE('Will'),
};

/* Markers to KEEP with the degree half cut out. `value` goes because the inline `( )` slot is now
 * filled by degreeShiftMarkers from the structured field. */
const MARKER_EDITS = {
  'experienced-professional#0': { value: null, note: "If you're an expert in Lore, a failed check to Earn Income with Lore earns twice as much income (unless it was originally a critical failure)." },
  'sturdy-bindings#0': { value: null, note: 'Sturdy Bindings: a creature you have grabbed turns a failed Escape into a critical failure, and a critical success into a success.' },
  'sure-feet#0': { value: null, note: "Sure Feet: you're not off-guard while you Balance." },
  'sure-feet#1': { value: null, note: "Sure Feet: you're not off-guard while you Climb." },
  'caveclimber-kobold#0': { value: null, note: 'You Climb with your clawed feet and tail, leaving your hands free.' },
  'cliffscale-lizardfolk#0': { value: null, note: 'While not wearing footwear you climb with the sticky pads on your feet, leaving your hands free.' },
  // Bravery's VALUE is the frightened reduction, not a shift — only its note's second sentence was.
  'bravery#0': { note: 'Bravery: anytime you gain the frightened condition, reduce its value by 1.' },
};

/* Every other offender is a DELETE. Listed rather than inferred so a future edit to the registry
 * cannot silently widen what this removes. */
const DELETES = [
  'steadying-stone#2', 'cloak-of-repute#1', 'cloak-of-repute-greater#1', 'cloak-of-repute-major#1',
  'staff-acrobat-dedication#1', 'intuitive-crafting#0', 'magical-shorthand#0', 'nocturnal-navigator#0',
  'runic-skullcap#0', 'dragonblood#0', 'abjure-the-false-kin#0', 'athletic-might#0',
  'cantorian-reinforcement#0', 'emerald-boughs-accustomation#0', 'empathy-incarnate#1', 'fire-savvy#1',
  'haughty-obstinacy#0', 'iron-lung#0', 'irrepressible#0', 'irrepressible-ganzi#0',
  'irrepressible-halfling#0', 'irrepressible-nephilim#0', 'unwavering-mien#0', 'hydra-mutagen#8',
  'born-of-item#1', 'lovers-gloves#2', 'disillusionment#0', 'disillusionment#1', 'path-to-perfection#0',
  'perfected-mind#0', 'perfected-mind#1',
  // The save-line class features: one entry each, and that entry is only the shift.
  'agile-mind#0', 'anvils-hardness#0', 'battle-hardened#0', 'battlefield-intuition#0', 'blast-dodger#0',
  'divine-will#0', 'dogged-will#0', 'earned-resilience#0', 'evasive-reflexes#0', 'explosion-dodger#0',
  'indomitable-will#0', 'juggernaut#0', 'kinetic-durability#0', 'kinetic-quickness#0',
  'lead-constitution#0', 'majestic-will#0', 'master-of-mind-and-spirit#0', 'mortality-reforged#0',
  'mysterious-resolve#0', 'natural-reflexes#0', 'performers-heart#0', 'prodigious-will#0',
  'reinforced-ego#0', 'resolute-faith#0', 'resolve#0', 'rogue-resilience#0', 'sacred-body#0',
  'savvy-reflexes#0', 'shared-resolve#0', 'tempered-reflexes#0', 'twin-juggernauts#0',
  'unassailable-soul#0', 'unyielding-resolve#0', 'walls-of-will#0', 'wardens-endurance#0',
  'wild-willpower#0', 'will-of-the-pupil#0',
];
const MARKER_DELETES = [
  'student-of-the-canon#0', 'student-of-the-canon#1', 'fishseeker-shoony#0', 'paddler-shoony#0',
  // ⚠ Its note is DAMAGED in the source ("…from 14th level the cir"), so once the degree half moves
  // to the structured field nothing usable is left to keep. Recorded here rather than silently lost.
  'the-publican#0',
];

/* ------------------------------------------------------------------------- source rewriting ---- */
const src = readFileSync(FILE, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const lines = src.split(/\r?\n/);

/** A registry line: `  "id": [ … ],` or `  'id': [ … ],` — one record per line throughout the file. */
const lineFor = (id) => {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] == null) continue;
    if (lines[i].startsWith(`  "${id}": [`) || lines[i].startsWith(`  '${id}': [`)) hits.push(i);
  }
  return hits;
};

/** Re-serialise one entry the way the file writes them: single-quoted keys off, double-quoted strings. */
const q = (s) => JSON.stringify(s);
const serTarget = (t) => `{ ${Object.entries(t).map(([k, v]) => `${k}: ${q(v)}`).join(', ')} }`;
const serBonus = (b) => {
  const parts = [`targets: [${(b.targets ?? []).map(serTarget).join(', ')}]`, `when: ${q(b.when)}`, `bonus: ${q(b.bonus)}`];
  for (const [k, v] of Object.entries(b)) if (!['targets', 'when', 'bonus'].includes(k)) parts.push(`${k}: ${JSON.stringify(v)}`);
  return `{ ${parts.join(', ')} }`;
};
const serMarker = (m) => `{ ${Object.entries(m).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')} }`;

/** Parse the array literal on a registry line. Safe: the file is data, and this runs at build time
 *  only — but Function() is still avoided in src/, so this lives in scripts/. */
function parseLine(line) {
  const open = line.indexOf('[');
  const close = line.lastIndexOf(']');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${line.slice(open, close + 1)}`)();
}

const log = [];
let changed = 0;
let dropped = 0;

function rewrite(ids, kind) {
  for (const [id, ops] of ids) {
    const hits = lineFor(id);
    if (hits.length !== 1) { log.push(`SKIPPED ${id}: ${hits.length} matching lines`); continue; }
    const ln = hits[0];
    const list = parseLine(lines[ln]);
    const next = [];
    list.forEach((entry, i) => {
      const op = ops[i];
      if (op === 'del') { dropped++; return; }
      if (op && typeof op === 'object') {
        const patched = { ...entry };
        for (const [k, v] of Object.entries(op)) { if (v === null) delete patched[k]; else patched[k] = v; }
        next.push(patched);
        changed++;
        return;
      }
      next.push(entry);
    });
    const prefix = lines[ln].slice(0, lines[ln].indexOf('['));
    if (!next.length) {
      // An empty array would be a registry key that matches everything and grants nothing.
      lines[ln] = null;
      log.push(`removed key ${id} (${kind}) — no entries left`);
    } else {
      lines[ln] = `${prefix}[${next.map(kind === 'marker' ? serMarker : serBonus).join(', ')}],`;
    }
  }
}

/** Group the flat `id#index` tables into { id → { index → op } }. */
function group(dels, edits) {
  const out = new Map();
  const put = (key, op) => {
    const [id, i] = key.split('#');
    if (!out.has(id)) out.set(id, {});
    out.get(id)[Number(i)] = op;
  };
  for (const k of dels) put(k, 'del');
  for (const [k, v] of Object.entries(edits)) put(k, v);
  return [...out.entries()];
}

rewrite(group(DELETES, EDITS), 'bonus');
rewrite(group(MARKER_DELETES, MARKER_EDITS), 'marker');

const out = lines.filter((l) => l !== null).join(eol);
console.log(`entries removed ${dropped} · entries rewritten ${changed}`);
for (const l of log) console.log('   ' + l);
if (DRY) { console.log('--dry: nothing written'); process.exit(0); }
writeFileSync(FILE, out);
console.log('written: src/rules/situationalBonuses.ts');
