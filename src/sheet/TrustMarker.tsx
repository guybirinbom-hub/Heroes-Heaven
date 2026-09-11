/*
 * WHY THIS EXISTS
 *
 * The trust gate turns OFF the mechanical half of every record whose rules we have not yet checked
 * against a source we trust. Such a record still exists, is still pickable, still prints its full
 * text — it simply stops touching the sheet. Without a line saying so, that is indistinguishable
 * from a bug: the player takes a feat, reads that it gives a +1, and no +1 appears anywhere.
 *
 * So this is the one line that tells them. It renders wherever a record's own text is shown
 * (the feats list, a feat popup, an item popup, a builder pick, a description popup), always in the
 * same place — under the name, above the text — and it says what the gate is doing in plain words.
 * The `title` spells out WHICH parts are dark, still in plain words: field names are our bookkeeping,
 * not the player's problem.
 *
 * It reads the side map `trustOff(bucket, id)` that applyTrustGate fills at content load, so it costs
 * one map lookup and knows nothing about kinds, ledgers or lanes.
 */
import { trustGateOn, trustOff } from '../data/trustGate';

/**
 * Stripped field paths -> what a player would call them. First match wins, so the order is the
 * priority order: a `grantedStrikes` is an attack before it is a "grant", a `grantsRituals` is a
 * spell before it is a "grant".
 */
const WORDS: [RegExp, string][] = [
  [/situational/, 'its situational bonuses'],
  [/spell|cantrip|ritual|focus/, 'the spells it grants'],
  [/skill|lore/, 'skill training and bonuses'],
  [/resist|immun|weakness/, 'resistances and immunities'],
  [/speed/, 'movement speeds'],
  [/sense|vision/, 'senses'],
  [/strike|unarmed|crit|precision|reach|map|damage/, 'attacks and damage'],
  [/armor|armour|\bac\b/, 'armour and AC'],
  [/save|perception|classdc|apex|statistic|statbonus/, 'checks and DCs'],
  [/language/, 'languages'],
  [/grant|mark|mode|whileactive|enhancement|derived/, 'the things it hands you'],
  [/hp|bulk|size|trait/, 'other adjustments'],
];

/** The stripped paths, said in words, deduplicated and in the order WORDS lists them. */
export function trustWords(paths: string[]): string {
  const said = new Set<string>();
  for (const p of paths) {
    // Only the LEAF matters: `effectChoices[].options[].grant.resistances` is a resistance, and the
    // container it hangs off is builder plumbing the player never sees.
    const leaf = p.split('.').pop()!.toLowerCase();
    said.add(WORDS.find(([re]) => re.test(leaf))?.[1] ?? 'some of its effects');
  }
  const order = WORDS.map(([, w]) => w).concat('some of its effects');
  return [...said].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(', ');
}

/**
 * "Not yet verified" — one muted line, or nothing at all.
 *
 * `bucket`/`id` are optional so a caller that does not know which record it is showing (a builder
 * row rendered from a name) can pass what it has and get silence rather than a guess: a marker on a
 * record that IS verified is worse than no marker.
 */
export function TrustMarker({ bucket, id }: { bucket?: string; id?: string }) {
  if (!bucket || !id || !trustGateOn()) return null;
  const off = trustOff(bucket, id);
  if (!off || off.length === 0) return null;
  return (
    <div className="sd-choice-note" role="note" title={`Not applied yet: ${trustWords(off)}.`}>
      Not yet verified — shown, not applied
    </div>
  );
}
