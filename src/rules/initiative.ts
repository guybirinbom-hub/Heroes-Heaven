/*
 * Initiative.
 *
 * "When you roll for initiative, you typically roll a Perception check … Sometimes, the GM might call
 * for a different type of check. For example, if you were Avoiding Notice during exploration, you
 * would roll a Stealth check." Several class features and feats say so outright — a rogue's Surprise
 * Attack, a bard's Fascinating Performance, Deception to Create a Diversion.
 *
 * The app had no initiative statistic at all: it was rolled with Perception, and every one of the ~45
 * initiative bonuses in situationalBonuses.ts is filed under `{kind: 'perception'}` because there was
 * nowhere else to put them. Incredible Initiative even prints "whatever statistic you roll for
 * initiative" and was pinned to Perception regardless.
 *
 * So initiative is now its own stat that READS another one. Nothing is re-tagged: the perception-filed
 * bonuses still apply when initiative is rolled with Perception (the default and the common case),
 * and a character who rolls it with a skill gets that skill's own line instead.
 */
import { deriveArmorCheckPenalty, derivePerception, deriveSkill, formatMod, type StatLine } from './derive';
import { modeModifiersFor, poolTypedMods, type TypedMod } from './modes';
import { characterSituationalIds, explainStat, type SituationalNote, type StatRef } from './explain';
import { featSituationalFor } from './situationalBonuses';
import type { Character, ContentDatabase, ModeModifier, ProficiencyKey } from './types';

/** What initiative is rolled with. `null`/absent = Perception, which is the default in the rules. */
export type InitiativeStat = ProficiencyKey | null | undefined;

export interface InitiativeLine extends StatLine {
  /** 'perception', or the skill it is rolled with. */
  stat: 'perception' | ProficiencyKey;
  /** Display name — "Perception", "Stealth". */
  label: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The initiative line. `override` lets a caller ask "what would it be with Stealth?" without mutating
 * the character — the Builder's picker preview uses it.
 */
export function deriveInitiative(c: Character, db?: ContentDatabase, override?: InitiativeStat): InitiativeLine {
  const stat = override !== undefined ? override : c.initiativeSkill;
  /*
   * Everything aimed at INITIATIVE that applies to EVERY initiative roll, on top of whatever the
   * underlying statistic already collected: an unconditional mode targeting initiative, and the
   * always-on registry entries (Incredible Initiative's +2, ponderous armour's penalty). ONE list —
   * `initiativeTerms` — because the popup has to say what each of them was worth, and it can only do
   * that against the same terms the number was built from.
   *
   * Owner, 2026-09-16: *a number for what always applies, a star for what applies only sometimes.*
   * A bonus the player takes on every single roll of this row was being printed as homework
   * ("add it yourself") beside a number that could simply have included it.
   *
   * POOLED, not summed: PF2e keeps the best bonus and the worst penalty of each type, so two
   * unconditional +2 status sources are +2 and not +4 — the same `poolTypedMods` every other
   * cross-source total in the app goes through. The underlying Perception/skill bonuses are already
   * inside the line this builds on, so a Perception mode still moves initiative the way it always
   * did; this only adds the initiative-only lane.
   */
  const extra = poolTypedMods(initiativeTerms(c, db, stat).map((t) => t.mod));
  if (!stat) {
    const p = derivePerception(c, db);
    return { ...p, modifier: p.modifier + extra, stat: 'perception', label: 'Perception' };
  }
  const s = deriveSkill(c, stat, db);
  return {
    ...s,
    modifier: s.modifier + extra,
    stat,
    label: stat.startsWith('lore:') ? `${cap(stat.slice(5))} Lore` : cap(stat),
  };
}

/**
 * Skills that can legitimately be rolled for initiative.
 *
 * Deliberately NOT every skill: the rules let the GM call for one that fits what you were doing, and
 * the ones with a printed initiative use are Stealth (Avoid Notice), Deception (Create a Diversion),
 * Diplomacy, Intimidation (Demoralize), Performance (Fascinating Performance), Society, Occultism,
 * Arcana, Religion, Nature and Medicine (recognising a threat). Offering all twenty-odd, including
 * every Lore, would turn a rules-supported choice into a free pick of your best number.
 */
export const INITIATIVE_SKILLS: ProficiencyKey[] = [
  'stealth',
  'deception',
  'diplomacy',
  'intimidation',
  'performance',
  'society',
  'arcana',
  'occultism',
  'religion',
  'nature',
  'medicine',
  'survival',
  'acrobatics',
  'athletics',
];

/** One thing that changes this initiative. */
export interface InitiativeInfluence {
  note: SituationalNote;
  /**
   * Is it ALREADY in `deriveInitiative`'s number?
   *
   * The whole classification, in one boolean, and the popup prints exactly these two labels. It used
   * to be two booleans — "conditional" and "in the number" — which could disagree, and a line that is
   * neither ("applies every time, still not counted") was the confusing third thing the owner's rule
   * removed: if it always applies, count it.
   *
   * Owner, 2026-09-16: *a number for what always applies, a star for what applies only sometimes.* So
   * `!inNumber` IS the `*` beside the Initiative value, and the rail asks for it that way —
   * `initInfluences.some((i) => !i.inNumber)`, on the list it already holds. There was an
   * `initiativeHasSituational` export saying exactly that, with no caller outside its own tests, so
   * one rule had two spellings that could drift: the thing this file's comments argue against. An
   * `initiativeInfluences` (`…Detail(…).map((i) => i.note)`) went the same way for the same reason —
   * nothing in src/ called it, and a second export that answers "what changes initiative" WITHOUT
   * saying which half is counted is precisely the reading this file stopped offering. The tests map
   * the detail themselves; they are asking the component's question, so they spell it that way.
   *
   * In the number, and so NOT starred:
   *  - rolling initiative with another statistic — it is how this character always rolls, and the
   *    number shown IS that statistic's;
   *  - a mode modifier with no `appliesWhen`;
   *  - an always-on registry entry whose printed bonus is one plain modifier (`initiativeTerms`).
   *
   * "In the number" is about the line being ACCOUNTED FOR, not about the number having moved by the
   * figure it prints: a term the pool discarded because a same-type sibling was already there is in
   * the number too — there is nothing for the player to add — and its own line says what it was worth
   * (`takenByTerm`). The star would be a lie there; it means "apply this yourself".
   *
   * Anything else earns the star, including the rare always-on entry whose bonus is prose a number
   * cannot hold ("you may roll Spirit Lore for initiative"). That is the cautious answer: a star says
   * "apply this yourself", which is true of every line that is not counted, while silence would claim
   * the value already covers it.
   */
  inNumber: boolean;
}

/**
 * The `when` clauses that say nothing beyond "you are rolling initiative".
 *
 * The situational registry files a bonus under the stat it can apply to, and its `when` is written
 * for THAT stat's row: on the Perception row, "on Perception checks rolled for initiative" really is
 * a sometimes-clause, because most Perception checks are not initiative. On the INITIATIVE row the
 * same sentence is the row itself — it applies every single time this number is rolled. Tagging it
 * conditional put a star on it whose tooltip reads "only in certain situations", which is false for
 * Incredible Initiative, Divine Dragonblood, ponderous armour and the rest of this list.
 *
 * So: a clause listed here is ALWAYS-ON on this row, which since 2026-09-16 means it goes INTO the
 * number (`initiativeTerms`); everything else keeps the star. Matched exactly
 * (whitespace-collapsed, case-folded) rather than by pattern, because the difference between "on your
 * initiative roll" and "on your initiative roll (once per day)" is one parenthetical, and a pattern
 * loose enough to read the first would have to be trusted not to swallow the second. Unrecognised
 * wording therefore stays conditional — the star is the cautious answer, and it is what shipped.
 *
 * ⚠ A clause that says "(free action)" is NOT in here and must not be added: Swaggering Initiative,
 * Emphatic Emissary, Duelist's Edge and Ten Paces all print a **Trigger** and are free actions the
 * player has to spend to get the bonus. Folding those into the number promises a +2 to someone who
 * never used the action. The registry marks them in the clause; the guard in
 * bug-owner-2026-09-16-sheet.test.tsx re-derives that from the printed text so a re-worded entry
 * cannot walk back in.
 *
 * The stat-named clauses (the last five) only ever reach this row when the character rolls initiative
 * with that same statistic — `initiativeInfluenceDetail` takes them off the stat initiative READS —
 * so "using Perception" is already true whenever the entry is listed here.
 */
const ALWAYS_ON_WHEN = new Set([
  'on initiative',
  'on initiative roll',
  'on initiative rolls',
  'on your initiative roll',
  'on your initiative rolls',
  'rolling initiative',
  'when you roll initiative',
  'on initiative rolls (whatever statistic you roll for initiative)',
  'on initiative rolls (whatever statistic you roll for initiative — usually perception)',
  'on initiative rolls, when you roll perception for initiative',
  'on perception checks rolled for initiative',
  'on perception checks for initiative',
  'on perception checks made as initiative rolls',
  'when you roll initiative using perception',
]);

/** Clauses compare as text: case and repeated spaces are noise. */
const normalizeWhen = (when: string) => when.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A registry bonus the NUMBER is allowed to take: ONE signed modifier, optionally typed, and nothing
 * else in front of the wording.
 *
 * "+2 circumstance" qualifies, and so does ponderous's "-1, or the armour's check penalty if that is
 * worse" — its printed penalty is the -1 and the rest is a worse case handled below. "+2 status (+3
 * at 12th, +4 at 20th)" does NOT: its real value depends on the character's level, and the number is
 * the one place the app may not guess. Such an entry keeps the star and stays the player's to apply.
 *
 * ⚠ Deliberately stricter than `parseBonus` in situationalBonuses.ts, which reads the same strings to
 * decide which star lines supersede which. Being wrong about which of two lines to PRINT costs a
 * duplicated line; being wrong here changes a number the player rolls against.
 */
const PLAIN_BONUS = /^([+-]\d+)(?:\s+(circumstance|status|item|untyped))?(?:,|$)/i;

/** The armour trait whose printed penalty is not a fixed number — see below. */
const PONDEROUS = 'trait:ponderous';

/**
 * Would the initiative NUMBER swallow this registry entry? Exactly the two tests `initiativeTerms`
 * makes below, exported so a guard can ask the question of the whole registry at once instead of
 * building a character per record — half the entries that matter are class features and items, which
 * `plain({ feats: [...] })` cannot hold.
 */
export const initiativeFoldsClause = (when: string, bonus: string): boolean =>
  ALWAYS_ON_WHEN.has(normalizeWhen(when)) && PLAIN_BONUS.test(bonus.trim());

/**
 * One always-on term the initiative NUMBER is built from, with enough identity for the popup to find
 * the display line that belongs to it.
 */
interface InitiativeTerm {
  /** What the pool is given. */
  mod: TypedMod;
  /** The modifier the line's own TEXT prints — the same as `mod.value` for everything but ponderous. */
  printed: number;
  /** A registry entry: the record id and the clause it came from. */
  sourceId?: string;
  when?: string;
  /** A mode modifier: the object itself, so the display loop matches by identity, not by position. */
  src?: ModeModifier;
}

/**
 * Every always-on term: the unconditional initiative modes, then the always-on registry entries.
 *
 * ONE list, read by both halves — `deriveInitiative` pools it into the number, and
 * `initiativeInfluenceDetail` asks `takenByTerm` what each entry was actually worth. Two lists would
 * be two answers to "is this in the number", which is the whole bug this file keeps fixing.
 *
 * ⚠ Read off the registry rather than through `explainStat`, because `explainStat`'s initiative case
 * calls `deriveInitiative` — asking it from inside the number would not return.
 *
 * ⚠ The clause travels with the modifier: one record can hold an always-on entry and a
 * sometimes-entry, so the id alone cannot tell the counted note from the uncounted one.
 *
 * Known gap: `authoredSituational`'s lanes (a record's own data-side `situational` field, an answered
 * choice) are not read here — they are private to explain.ts. An always-on entry authored that way
 * keeps the star, which is what every entry did before today.
 */
function initiativeTerms(c: Character, db: ContentDatabase | undefined, stat: InitiativeStat): InitiativeTerm[] {
  const out: InitiativeTerm[] = [];
  for (const { mod } of modeModifiersFor(c.activeModes, { kind: 'initiative' })) {
    // A conditional modifier is the player's to apply — the same test `modeTypedMods` makes, made
    // here because this list has replaced it as what the number is built from.
    if (mod.appliesWhen) continue;
    out.push({ mod: { type: mod.type, value: mod.value }, printed: mod.value, src: mod });
  }
  const ids = characterSituationalIds(c, db);
  // The initiative-only entries, PLUS the ones filed against the statistic initiative reads whose
  // clause names initiative — Battlefield Surveyor is a Perception entry and has to be.
  const refs = [{ kind: 'initiative' }, stat ? { kind: 'skill', skill: stat } : { kind: 'perception' }];
  const seen = new Set<string>();
  for (const ref of refs) {
    for (const e of featSituationalFor(ids, ref)) {
      if (!ALWAYS_ON_WHEN.has(normalizeWhen(e.when))) continue;
      const m = PLAIN_BONUS.exec(e.bonus.trim());
      if (!m) continue;
      // An entry targeting BOTH initiative and the statistic it is rolled with is returned by both
      // refs; it is one bonus and may only be counted once. Keyed by clause and not by record,
      // because one record can hold two different always-on entries.
      const key = `${e.id}|${normalizeWhen(e.when)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const printed = Number(m[1]);
      out.push({
        sourceId: e.id,
        when: e.when,
        printed,
        mod: {
          type: (m[2]?.toLowerCase() as TypedMod['type']) ?? 'untyped',
          // Ponderous is *"a -1 penalty to initiative. If you don't meet the armor's required
          // Strength modifier, the penalty becomes the armor's check penalty when that is worse."*
          // The app already computes that penalty — and returns 0 when the wearer meets the
          // threshold — so the worse of the two is exact rather than prose the player has to apply.
          value: e.id === PONDEROUS && db ? Math.min(-1, deriveArmorCheckPenalty(c, db).value) : printed,
        },
      });
    }
  }
  return out;
}

/**
 * What each term ACTUALLY added to the pooled total, aligned with `terms`.
 *
 * bug 2026-09-16 (refutation): "(in the number)" is a claim about the value on the row, and same-type
 * bonuses do not stack. Incredible Initiative and Saved by Clockwork are both "+2 circumstance", and
 * their `when` strings differ by one parenthetical — so `poolSituationalLines` keeps BOTH display
 * lines while `poolTypedMods` takes the +2 once. Labelling each line on its own read "+2 … (in the
 * number)" twice beside a number that had moved 2: the popup explaining +4 of a +2. Two unconditional
 * same-type modes are the same story, and that one is a fixture in this lane's own tests.
 *
 * Measured rather than re-decided: the terms go into `poolTypedMods` strongest first, and each one's
 * share is how much the running total MOVED when it went in. Strongest first is what makes the
 * credited one the one PF2e keeps; the rule itself is never restated here, which is the point — there
 * is exactly one implementation of "best bonus, worst penalty, untyped sums" in the app and this asks
 * it rather than agreeing with it. `takenByTerm(terms)` sums to `poolTypedMods(terms.map(t => t.mod))`
 * by construction.
 */
function takenByTerm(terms: InitiativeTerm[]): number[] {
  const taken = new Array<number>(terms.length).fill(0);
  const order = terms.map((_, i) => i).sort((a, b) => Math.abs(terms[b].mod.value) - Math.abs(terms[a].mod.value));
  const pool: TypedMod[] = [];
  let running = 0;
  for (const i of order) {
    pool.push(terms[i].mod);
    const next = poolTypedMods(pool);
    taken[i] = next - running;
    running = next;
  }
  return taken;
}

/**
 * Everything that changes THIS character's initiative — excluding the plain statistic it is rolled
 * with — each line saying whether the number already has it.
 *
 * Owner, 2026-09-15: *"in pf2e initiative isn't always perception"*. An Initiative row that always
 * repeated the Perception number said nothing, so the rail shows one only when this list is
 * non-empty: a bonus or penalty aimed at initiative, a clause on the underlying statistic that names
 * initiative, an active mode aimed at it, or the character rolling it with something else.
 *
 * The WORDING is read through `explainStat` rather than off the registry. Two reasons, both about not
 * drifting: the `extra` lanes (an item's authored clauses, an answered choice) are assembled there
 * and would be silently missing from a second reader, and the phrasing is then the same one every
 * other star list in the app prints. The initiative breakdown DELEGATES to the statistic it reads —
 * see `explainStat`'s `initiative` case — so subtracting that statistic's own list is what leaves the
 * initiative-only terms. Which of those lines is COUNTED, and for how much, comes from
 * `initiativeTerms` / `takenByTerm` — the very terms the number was pooled from.
 */
export function initiativeInfluenceDetail(c: Character, db: ContentDatabase): InitiativeInfluence[] {
  const init = deriveInitiative(c, db);
  const innerRef: StatRef = init.stat === 'perception' ? { kind: 'perception' } : { kind: 'skill', skill: init.stat };
  const inner = explainStat(c, db, innerRef).situational ?? [];
  const all = explainStat(c, db, { kind: 'initiative' }).situational ?? [];
  // The terms the number was built from, and what each was worth once they had been pooled together.
  const terms = initiativeTerms(c, db, c.initiativeSkill);
  const taken = takenByTerm(terms);
  /*
   * A counted line has to print the figure the number ACTUALLY took, whenever that is not the figure
   * the line itself prints. There are two ways they part, and both shipped wrong:
   *  • ponderous, whose printed bonus is prose ("-1, or the armour's check penalty if that is worse")
   *    — in fortress plate at Str 10 the number moved 3 and the popup said -1;
   *  • a same-type sibling, where the number moved once and both lines claimed it.
   * Same clause for both, because it is the same sentence: here is what this one was worth to YOU.
   */
  const reconciled = (i: number, text: string): string => {
    const t = terms[i];
    if (taken[i] === t.printed) return text;
    const kind = t.printed >= 0 ? 'bonus' : 'penalty';
    return taken[i] === 0
      ? `${text} — ${formatMod(0)} for this character: the same ${t.mod.type} ${kind} is already counted`
      : `${text} — ${formatMod(taken[i])} for this character`;
  };
  // Which term a display line belongs to — matched by the record AND its clause, because a record
  // with two entries has only one of them counted.
  const termOf = (note: SituationalNote): number =>
    note.sourceId ? terms.findIndex((t) => t.sourceId === note.sourceId && note.text.trimEnd().endsWith(t.when!.trim())) : -1;
  const out: InitiativeInfluence[] = [
    // What the initiative breakdown added on top of the statistic it reads — the `{kind:'initiative'}`
    // entries (Incredible Initiative, Swaggering Initiative, a juggernaut mutagen's -2).
    ...all.filter((s) => !inner.some((i) => i.text === s.text)),
    // …plus the entries filed against that statistic that SAY initiative. Battlefield Surveyor's
    // "+2 circumstance when you roll initiative using Perception" is a PERCEPTION entry and has to
    // be: it stops applying the moment the character rolls initiative with something else.
    ...inner.filter((s) => /initiative/i.test(s.text)),
  ].map((note) => {
    const i = termOf(note);
    return { note: i < 0 ? note : { ...note, text: reconciled(i, note.text) }, inNumber: i >= 0 };
  });
  // An active mode aimed at initiative is named nowhere else: it moves the number (above), and the
  // breakdown's delegation only ever sees the underlying statistic's modes.
  for (const { mode, mod } of modeModifiersFor(c.activeModes, { kind: 'initiative' })) {
    const text = `${formatMod(mod.value)} ${mod.type} from ${mode}${mod.appliesWhen ? ` — ${mod.appliesWhen}` : ''}`;
    // Matched by identity against the term list, so "is it counted" is answered by the list the
    // number was pooled from rather than by re-testing `appliesWhen` here — and a mode that IS in
    // that list but was superseded by a same-type sibling says so, instead of claiming the +2 twice.
    const i = terms.findIndex((t) => t.src === mod);
    out.push({ note: { text: i < 0 ? text : reconciled(i, text) }, inNumber: i >= 0 });
  }
  // Rolling it with something else IS the influence — it is the whole reason a character Avoiding
  // Notice has an initiative worth reading separately from their Perception. The number shown IS
  // that statistic's, so this line explains the number rather than adding to it.
  if (c.initiativeSkill) out.unshift({ note: { text: `Rolled with ${init.label} instead of Perception` }, inNumber: true });
  return out;
}
