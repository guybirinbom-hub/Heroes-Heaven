/*
 * Author the SPELL-DAMAGE situational entries now that `spellDamage` exists as a target.
 *
 * Every `when`/`bonus` below was written against the record's own text in public/core.json, not from
 * the extraction notes — those were a map of where to look, not a source. Records whose damage bonus
 * is splash, persistent, an item's own damage, incoming damage, or an ally-only buff are deliberately
 * NOT here: `spellDamage` would misrepresent them.
 *
 * Two different operations, because a first pass that only ADDED entries silently duplicated the
 * mutagen drawbacks — several records already carried the bonus on `strikeDamage` with a `when` that
 * says "and spell damage", and what they were missing was the second TARGET, not a second entry.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/rules/situationalBonuses.ts';

/**
 * Records whose existing strike-damage entry already describes the whole damage clause — they just
 * need `spellDamage` alongside it, so the player sees ONE line on both surfaces instead of two.
 */
const EXTEND = [
  'serene-mutagen',
  'serene-mutagen-lesser',
  'serene-mutagen-moderate',
  'serene-mutagen-greater',
  'serene-mutagen-major',
  'adept-benefit-regalia', // "you and allies in your aura gain a +2 status bonus to damage rolls"
  'nemesis-name', // "+2 status bonus to damage rolls against the creature named on your tattoo"
];

/** id -> genuinely new bonus objects (a separate clause, or a record with no entry at all). */
const ADD = {
  'sorcerous-potency': [
    {
      targets: [{ kind: 'spellDamage' }],
      when: "when you Cast a Spell from a spell slot that deals damage or restores Hit Points (initial damage or healing only, once per creature)",
      bonus: "+status equal to the spell's rank",
    },
  ],
  'dangerous-sorcery': [
    {
      targets: [{ kind: 'spellDamage' }],
      when: "when you Cast a Spell from a spell slot that deals damage and has no duration",
      bonus: "+status equal to the spell's rank",
    },
  ],
  "channelers-stance": [
    {
      targets: [{ kind: 'spellDamage' }],
      when: "while in Channeler's Stance, when you cast or Sustain an apparition or vessel spell that deals energy damage",
      bonus: "+status equal to the spell's rank",
    },
  ],
  // The Strike half is already stored and scales with weapon dice; the spell half is its own clause.
  'spiral-sworn': [
    {
      targets: [{ kind: 'spellDamage' }],
      when: "for 3 rounds after Spiral Sworn, on spells cast from spell slots that deal damage and have no duration, against undead, creatures holding an imprisoned soul, or creatures you witnessed create or command undead",
      bonus: "+status equal to the spell's rank",
    },
  ],
  'psychic-duelist-dedication': [
    {
      targets: [{ kind: 'spellDamage' }],
      when: "in a psychic duel where you chose Mind Mace, on mental damage from spells you cast",
      bonus: "+status equal to the spell's rank",
    },
  ],
  'burn-it': [
    {
      targets: [{ kind: 'spellDamage' }],
      when: "on fire damage from your spells (your alchemical items get one-quarter their level and your persistent fire damage +1 status; neither has a sheet row)",
      bonus: "+status equal to half the spell's rank, minimum +1",
    },
  ],
  warpipes: [
    // This record has no passiveEffects block, unlike its sibling instruments, so the Performance
    // bonus was unrepresented entirely — it is conditional on playing, so it belongs here.
    { targets: [{ kind: 'skill', detail: 'performance' }], when: 'while playing music with the warpipes', bonus: '+1 item' },
    {
      targets: [{ kind: 'strikeDamage' }, { kind: 'spellDamage' }],
      when: 'for 1 minute after you Activate Inspirational Salute (you and allies who can hear)',
      bonus: '+1 status',
    },
    {
      targets: [{ kind: 'save', detail: 'all' }],
      when: 'against fear effects, for 1 minute after you Activate Inspirational Salute',
      bonus: '+1 status',
    },
  ],
  'pennant-of-victory': [
    {
      targets: [{ kind: 'strikeAttack' }, { kind: 'spell', detail: 'attack' }],
      when: "until the start of your next turn after Pennant of Victory (you and allies in your banner's aura)",
      bonus: '+4 status',
    },
    {
      targets: [{ kind: 'strikeDamage' }, { kind: 'spellDamage' }],
      when: "until the start of your next turn after Pennant of Victory (you and allies in your banner's aura)",
      bonus: '+4 status',
    },
    {
      targets: [{ kind: 'speed' }],
      when: "until the start of your next turn after Pennant of Victory; it also grants 40 temporary Hit Points, which the sheet can't apply for you",
      bonus: '+10 feet status',
    },
  ],
};

const q = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const renderTarget = (t) => `{ kind: '${t.kind}'${t.detail ? `, detail: '${t.detail}'` : ''} }`;
const renderBonus = (b) => `{ targets: [${b.targets.map(renderTarget).join(', ')}], when: ${q(b.when)}, bonus: ${q(b.bonus)} }`;

const lines = readFileSync(FILE, 'utf8').split('\n');
const lineFor = (id) => lines.findIndex((l) => l.startsWith(`  "${id}": [`));

let extended = 0;
for (const id of EXTEND) {
  const idx = lineFor(id);
  if (idx < 0) throw new Error(`EXTEND target ${id} is not in the registry`);
  const solo = "targets: [{ kind: 'strikeDamage' }]";
  const hits = lines[idx].split(solo).length - 1;
  // Exactly one, or we'd be guessing which damage clause the spell half belongs to.
  if (hits !== 1) throw new Error(`${id} has ${hits} bare strikeDamage entries — expected exactly 1`);
  lines[idx] = lines[idx].replace(solo, "targets: [{ kind: 'strikeDamage' }, { kind: 'spellDamage' }]");
  extended++;
}

let appended = 0;
let inserted = 0;
for (const [id, bonuses] of Object.entries(ADD)) {
  const rendered = bonuses.map(renderBonus).join(', ');
  const idx = lineFor(id);
  if (idx >= 0) {
    const close = lines[idx].lastIndexOf('],');
    if (close < 0) throw new Error(`unexpected shape for ${id}`);
    lines[idx] = `${lines[idx].slice(0, close)}, ${rendered}${lines[idx].slice(close)}`;
    appended++;
  } else {
    const at = lines.findIndex((l) => /^ {2}"[^"]+": \[/.test(l) && l.slice(3, l.indexOf('":')) > id);
    if (at < 0) throw new Error(`no insertion point for ${id}`);
    lines.splice(at, 0, `  "${id}": [${rendered}],`);
    inserted++;
  }
}

writeFileSync(FILE, lines.join('\n'));
console.log(`spellDamage lane: ${extended} targets widened, ${appended} entries appended, ${inserted} records added.`);
