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
 * It asks `trustHeldBack(bucket, id)` — the trust gate's one question "is any rule of this record held
 * back right now, in any lane?" — so it costs a few set lookups and knows nothing about kinds, ledgers
 * or lanes itself.
 */
import { trustHeldBack, trustPartly, trustUnencoded } from '../data/trustGate';

/**
 * Stripped field paths -> what a player would call them. First match wins, so the order is the
 * priority order: a `grantedStrikes` is an attack before it is a "grant", a `grantsRituals` is a
 * spell before it is a "grant".
 */
const WORDS: [RegExp, string][] = [
  [/situational/, 'its situational bonuses'],
  // A held-back mode's form (MODE_PAYLOAD): the AC, temporary HP, Strikes and size of the shape.
  [/^battleform$/, 'the battle form'],
  // A held-back mode's `modifiers` list (emptied whole): its numbers on checks, AC, saves and so on.
  [/^modifiers$/, 'its bonuses and penalties'],
  // Whole leaf only: `untrainedProficiency` is a skill field, not weapon training.
  [/^weaponproficiency$/, 'weapon training'],
  // Whole leaf only: "resistances" contains "stance".
  [/^stances?$/, 'its stance'],
  [/spell|cantrip|ritual|focus/, 'the spells it grants'],
  [/skill|lore/, 'skill training and bonuses'],
  [/resist|immun|weakness/, 'resistances and immunities'],
  [/speed/, 'movement speeds'],
  [/sense|vision/, 'senses'],
  [/strike|unarmed|crit|precision|reach|map|damage/, 'attacks and damage'],
  // `acBonus` and `dexCap` are a stance's own AC fields (STANCE_PAYLOAD).
  [/armor|armour|\bac\b|^acbonus$|^dexcap$/, 'armour and AC'],
  [/save|perception|classdc|apex|statistic|statbonus/, 'checks and DCs'],
  [/language/, 'languages'],
  [/grant|mark|mode|whileactive|enhancement|derived/, 'the things it hands you'],
  [/hp|bulk|size|trait/, 'other adjustments'],
];

/** The stripped paths, said in words, deduplicated and in the order WORDS lists them. */
export function trustWords(paths: string[]): string {
  const said = new Set<string>();
  /* `grants:<name>` — an action or feat this record hands over whose own rules are held back. Said by
   * its name, after everything else: "Claw Stance and Talon Stance, which it grants". */
  const granted: string[] = [];
  for (const p of paths) {
    if (p.startsWith('grants:')) {
      if (!granted.includes(p.slice(7))) granted.push(p.slice(7));
      continue;
    }
    // Only the LEAF matters: `effectChoices[].options[].grant.resistances` is a resistance, and the
    // container it hangs off is builder plumbing the player never sees.
    const leaf = p.split('.').pop()!.toLowerCase();
    said.add(WORDS.find(([re]) => re.test(leaf))?.[1] ?? 'some of its effects');
  }
  const order = WORDS.map(([, w]) => w).concat('some of its effects');
  const words = [...said].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (granted.length) {
    const names = granted.length === 1 ? granted[0] : `${granted.slice(0, -1).join(', ')} and ${granted[granted.length - 1]}`;
    words.push(`${names}, which it grants`);
  }
  return words.join(', ');
}

/** A tooltip with the "not yet verified" words added when the trust gate holds this record back — for
 *  the controls too small for the line itself (a stance chip, a mode pill). */
export function trustTitle(bucket: string, id: string, title: string): string {
  return trustHeldBack(bucket, id)?.length ? `${title} — Not yet verified — shown, not applied` : title;
}

/**
 * "Not yet verified" — one muted line, or nothing at all.
 *
 * `bucket`/`id` are optional so a caller that does not know which record it is showing (a builder
 * row rendered from a name) can pass what it has and get silence rather than a guess: a marker on a
 * record that IS verified is worse than no marker.
 */
export function TrustMarker({ bucket, id }: { bucket?: string; id?: string }) {
  if (!bucket || !id) return null;
  /* A record created from its page with NONE of its rules encoded yet (the importer's new player
   * records): the same line, whatever the switch says — turning the gate off applies nothing that was
   * never written, so the player needs telling either way. */
  if (trustUnencoded(bucket, id)) {
    return (
      <div className="sd-choice-note" role="note" title="Not applied yet: none of its rules are encoded yet — the text is all there is for now.">
        Not yet verified — shown, not applied
      </div>
    );
  }
  /* Created with SOME of its rules encoded: the rest of its print still does nothing, so the line
   * names what — a Lore, a language, a reaction — on the screen, not only in the tooltip. */
  const partly = trustPartly(bucket, id);
  if (partly) {
    return (
      <div className="sd-choice-note" role="note" title={`Not applied yet: ${partly}.`}>
        Not yet verified — shown, partly applied. Not applied: {partly}.
      </div>
    );
  }
  /* Every lane, not only the records map: a record whose only dark rule is a situational star, a grant
   * registry entry, an engine lane or the stance it carries is held back just the same (trustHeldBack). */
  const off = trustHeldBack(bucket, id);
  if (!off || off.length === 0) return null;
  return (
    <div className="sd-choice-note" role="note" title={`Not applied yet: ${trustWords(off)}.`}>
      Not yet verified — shown, not applied
    </div>
  );
}
