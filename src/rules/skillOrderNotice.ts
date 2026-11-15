/*
 * THE BUILDER NOTICE FOR THE NEW SKILL ORDER (skill-order plan work/skill-rank-level-by-level/plan.md, section 3.3,
 * D13, D19; WP9; the owner's ruling 3 of 2026-10-21, docs/gold-set-answers.md "The order skill ranks are worked out
 * in": "Show a Builder notice that names what changed on that character; say nothing when nothing changed").
 *
 * `skillOrderChanges(build, content)` builds the character ONCE and compares what today's level-by-level order
 * gives (the character itself) with what the old order gave (the side channel `skillOrderLegacyOf`, D19, the same
 * "exactly" clamp on both sides). One plain sentence per difference, in the order of plan 3.3:
 *   1. a rank changed ("Stealth: Trained → Expert (Kholo Lore at 1st, skill increase at 3rd).");
 *   2. a replacement skill no longer owed (and the kept earlier pick, if one is stored);
 *   3. a replacement skill newly owed (the record named from content: a feat, a class option such as an epithet,
 *      a background — never a raw id);
 *   4. a rank-gated feat gained, lost or arriving at another level;
 *   5. a stored increase that now counts / no longer raises its skill;
 *   6. a feat whose skill prerequisite is met only at a later level (D5);
 *   7. new empty skill increase slots from a second class (D15).
 * The words a player reads: skills through `skillKeyLabel`, ranks as words, levels as ordinals, and never the
 * internal names of the machinery (test/skill-rank-notice.test.tsx, G7, holds the forbidden list). An empty list
 * means nothing changed: the Builder then draws no element at all.
 *
 * Pure and read-only: it never writes the build (the stamp is blocks/save.ts). A build that cannot be built has no
 * notice (the Builder must still open).
 */
import {
  buildCharacter,
  classSkillIncreaseLevels,
  featSubtreeIds,
  skillFallbackPick,
  skillKeyLabel,
  skillOrderLegacyOf,
  skillPrereqLines,
  skillRanksAtLevel,
  SKILL_INCREASE_LEVELS,
  type BuildState,
} from './build';
import { removedSkillIncreasePlaces, skillPlaceId } from './blocks/active';
import { FEAT_RANK_FEAT_GRANTS } from './featFeatGrants';
import { skillRankBeforeSource } from './ranks';
import { PROFICIENCY_RANKS, type Character, type ContentDatabase, type ProficiencyKey, type ProficiencyRank, type SkillStep } from './types';

/** The heading above the lines (plan 3.3). */
export const SKILL_ORDER_NOTICE_HEADING = 'Skill ranks are now worked out level by level, as the rules do. On this character that changed:';
/** How many lines show before "…and N more" (plan 3.3). */
export const SKILL_ORDER_NOTICE_SHOWN = 6;

/** One line of the notice: which of plan 3.3's seven kinds, its sentence, and the level pages it also shows on. */
export interface SkillOrderChange {
  kind: 'rank' | 'replacementGone' | 'replacementOwed' | 'rankGated' | 'increase' | 'prerequisite' | 'newIncreases';
  text: string;
  levels: number[];
}

const KIND_ORDER: SkillOrderChange['kind'][] = ['rank', 'replacementGone', 'replacementOwed', 'rankGated', 'increase', 'prerequisite', 'newIncreases'];

const ordinal = (n: number): string => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
};
/** "2nd", "2nd and 4th", "2nd, 4th and 6th". */
const ordinals = (ns: readonly number[]): string => {
  const w = ns.map(ordinal);
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
};
const capWord = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** A rank as a capitalised word ("Expert"). */
const rankWord = (r: ProficiencyRank): string => capWord(r);
/** A rank inside a sentence about training: "trained" / "untrained" stay lower case, the rest are capitalised
 *  ("already trained", "already Expert"). */
const rankInProse = (r: ProficiencyRank): string => (r === 'trained' || r === 'untrained' ? r : capWord(r));
const rankIdx = (r: ProficiencyRank | undefined): number => PROFICIENCY_RANKS.indexOf(r ?? 'untrained');
const humanize = (id: string): string => id.split('-').filter(Boolean).map(capWord).join(' ');
const rankOf = (skills: Partial<Record<ProficiencyKey, ProficiencyRank>>, k: ProficiencyKey): ProficiencyRank => skills[k] ?? 'untrained';

/** A class option's name (Root Epithet's "The Brave", a subclass option), looked up on the build's classes first,
 *  then on every class. */
function optionName(id: string, build: BuildState, db: ContentDatabase): string | undefined {
  const cls2Id = build.variantRules?.dualClass ? build.classId2 : undefined; // the second class only under Dual Class
  const classes = [build.classId, cls2Id].map((c) => (c ? db.classes[c] : undefined)).filter((c): c is NonNullable<typeof c> => !!c);
  const search = [...classes, ...Object.values(db.classes)];
  for (const c of search) {
    for (const g of c.extraChoices ?? []) {
      const o = g.options.find((x) => x.id === id);
      if (o) return o.name;
    }
    const s = c.subclass?.options.find((x) => x.id === id);
    if (s) return s.name;
  }
  return undefined;
}

/** A record's name by its history kind (`feat`, `option`, …), from content; never a raw id. */
function recordName(kind: string, id: string, build: BuildState, db: ContentDatabase): string {
  switch (kind) {
    case 'feat':
      return db.feats[id]?.name ?? humanize(id);
    case 'option':
      return optionName(id, build, db) ?? db.classFeatures[id]?.name ?? humanize(id);
    case 'feature':
      return db.classFeatures[id]?.name ?? optionName(id, build, db) ?? humanize(id);
    case 'background':
      return db.backgrounds[id]?.name ?? build.customBackground?.name ?? humanize(id);
    case 'heritage':
      return db.heritages[id]?.name ?? humanize(id);
    case 'ancestry':
      return db.ancestries[id]?.name ?? humanize(id);
    case 'deity':
      return db.deities[id]?.name ?? humanize(id);
    case 'class':
    case 'class2':
      return db.classes[id]?.name ?? humanize(id);
    default:
      return db.feats[id]?.name ?? db.classFeatures[id]?.name ?? optionName(id, build, db) ?? db.backgrounds[id]?.name ?? humanize(id);
  }
}

/** One history step's record as the bracket of a rank line names it ("Kholo Lore", "skill increase"). */
function stepName(s: SkillStep, build: BuildState, db: ContentDatabase): string {
  const i = s.source.indexOf(':');
  const kind = i < 0 ? s.source : s.source.slice(0, i);
  const id = i < 0 ? '' : s.source.slice(i + 1);
  switch (kind) {
    case 'increase':
      return 'skill increase';
    case 'bonus':
      return 'extra skill increase';
    case 'bgIncrease':
      return 'background skill increase';
    case 'tweakIncrease':
      return 'extra skill increase (tweak)';
    case 'floor':
    case 'set':
      return 'a tweak';
    case 'classPick':
      return 'your trained skill pick';
    case 'langLore':
      return 'a Lore in place of a language';
    case 'class':
    case 'class2':
      return `your ${recordName(kind, id, build, db)} class`;
    case 'background':
      return `the ${recordName(kind, id, build, db)} background`;
    case 'deity':
      return `your deity ${recordName(kind, id, build, db)}`;
    case 'pick':
      return `the replacement skill for ${recordName('', id, build, db)}`;
    default:
      return recordName(kind, id, build, db);
  }
}

/** The history kinds a replacement's record can sit under (`history.at` keys), most likely first. */
const RECORD_KINDS = ['feat', 'option', 'feature', 'background', 'heritage', 'ancestry', 'deity', 'class', 'class2'];
/** Kinds whose question the Level 0 page asks. */
const ORIGIN_KINDS = new Set(['background', 'heritage', 'ancestry', 'deity', 'class', 'class2']);

/** Where a replacement's record sits: its kind, its level (a feat row's own level where it has one), its name. */
function recordOf(c: Character, build: BuildState, db: ContentDatabase, id: string): { kind: string; level: number; name: string; source: string } {
  const h = c.skillHistory;
  const row = c.feats.find((f) => f.featId === id);
  for (const kind of RECORD_KINDS) {
    const at = h?.at[`${kind}:${id}`];
    if (at === undefined) continue;
    const level = kind === 'feat' && row ? row.level : (h!.steps[at]?.level ?? 1);
    return { kind, level, name: recordName(kind, id, build, db), source: `${kind}:${id}` };
  }
  if (row) return { kind: 'feat', level: row.level, name: recordName('feat', id, build, db), source: `feat:${id}` };
  return { kind: '', level: 1, name: recordName('', id, build, db), source: `feat:${id}` };
}

type Fallback = NonNullable<Character['skillFallbacks']>[number];
const fbKey = (f: Fallback) => `${f.featId}:${f.slot ?? f.skill}`;

/** The answer the build stores for a replacement, as the player reads it ("Arcana", "Sailing Lore"), or undefined. */
function storedAnswer(build: BuildState, f: Fallback): string | undefined {
  if (f.lore) {
    const subject = build.featLoreChoices?.[`${f.featId}:fallback:${f.slot ?? f.skill}`];
    return subject ? `${subject.trim()} Lore` : undefined;
  }
  const v = skillFallbackPick(build, f.featId, f.slot ?? f.skill);
  return v ? skillKeyLabel(v) : undefined;
}
/** The skill key a stored answer trains (for a skill answer only). */
const storedAnswerKey = (build: BuildState, f: Fallback): ProficiencyKey | undefined => (f.lore ? undefined : skillFallbackPick(build, f.featId, f.slot ?? f.skill));

const LANE_WORD: Record<string, string> = { main: 'skill increase', bonus: 'extra skill increase', background: 'background skill increase' };
const LANE_OF_SOURCE: Record<string, string> = { increase: 'main', bonus: 'bonus', bgIncrease: 'background' };

/**
 * What the new skill order changed on this saved build (plan 3.3, lines 1-7), one plain sentence each, in the plan's
 * order; empty when nothing changed (or the build cannot be built). Never writes anything.
 */
export function skillOrderChanges(build: BuildState, content: ContentDatabase): SkillOrderChange[] {
  let c: Character;
  try {
    c = buildCharacter(build, content);
  } catch {
    return [];
  }
  const legacy = skillOrderLegacyOf(c);
  const h = c.skillHistory;
  if (!legacy || !h) return [];
  const out: SkillOrderChange[] = [];
  const now = c.proficiencies.skills as Partial<Record<ProficiencyKey, ProficiencyRank>>;
  const before = legacy.skills as Partial<Record<ProficiencyKey, ProficiencyRank>>;

  /* Lines 2 and 3 first: line 1 leaves out the rank of a stored answer only where line 2 or 3 FULLY explains that
   * skill's change (WP9F; the WP9 checker's finding 1). Line 2 explains it when the old result was exactly one step
   * above the new one and that step was the old replacement's own training (K1s: Arcana Trained → Untrained); line 3
   * is the mirror (the new result one step above the old, that step the replacement's). Any other move on the same
   * skill (an increase whose effect changed, another feat) still gets its line 1. */
  const nowFb = c.skillFallbacks ?? [];
  const beforeFb = legacy.skillFallbacks ?? [];
  const nowKeys = new Set(nowFb.map(fbKey));
  const beforeKeys = new Set(beforeFb.map(fbKey));
  const explained = new Set<ProficiencyKey>();
  /** `higher` holds the replacement's own rank and `lower` is exactly one step under it: that step is the change. */
  const oneStepOf = (f: Fallback, higher: Partial<Record<ProficiencyKey, ProficiencyRank>>, lower: Partial<Record<ProficiencyKey, ProficiencyRank>>, k: ProficiencyKey): boolean => {
    const given = f.rank ?? 'trained';
    return rankOf(higher, k) === given && rankIdx(rankOf(lower, k)) === rankIdx(given) - 1;
  };
  const fbLines: SkillOrderChange[] = [];
  for (const f of beforeFb) {
    if (nowKeys.has(fbKey(f))) continue;
    const r = recordOf(c, build, content, f.featId);
    const need = f.rank ?? 'trained';
    const had = skillRankBeforeSource(c, r.source, f.skill);
    const why =
      had !== undefined && rankIdx(had) < rankIdx(need)
        ? `${skillKeyLabel(f.skill)} was not ${rankInProse(need)} yet when you took it.`
        : `it no longer lands on a skill you already had.`;
    const answer = storedAnswer(build, f);
    const ak = storedAnswerKey(build, f);
    if (ak && oneStepOf(f, before, now, ak)) explained.add(ak);
    fbLines.push({
      kind: 'replacementGone',
      text: `${r.name} (${ordinal(r.level)}) no longer gives a replacement skill: ${why}${answer ? ` Your earlier pick, ${answer}, is kept but no longer counts.` : ''}`,
      levels: [r.level],
    });
  }
  for (const f of nowFb) {
    if (beforeKeys.has(fbKey(f))) continue;
    const r = recordOf(c, build, content, f.featId);
    const had = skillRankBeforeSource(c, r.source, f.skill);
    const held = had && had !== 'untrained' ? had : (f.rank ?? 'trained');
    const answer = storedAnswer(build, f);
    const ak = storedAnswerKey(build, f);
    if (ak && oneStepOf(f, now, before, ak)) explained.add(ak);
    const page = ORIGIN_KINDS.has(r.kind) && r.level <= 1 ? 'the Level 0 page' : `the ${ordinal(r.level)}-level page`;
    fbLines.push({
      kind: 'replacementOwed',
      text: `${r.name} (${ordinal(r.level)}) now lets you pick a replacement skill: ${skillKeyLabel(f.skill)} was already ${rankInProse(held)}. ${
        answer ? `Your earlier pick, ${answer}, counts again.` : `Pick it on ${page}.`
      }`,
      levels: [r.level],
    });
  }

  /* Line 1: every key whose rank differs, unless line 2 or 3 fully explains it (above). */
  const keys = [...new Set([...Object.keys(before), ...Object.keys(now)])].sort() as ProficiencyKey[];
  for (const k of keys) {
    const a = rankOf(before, k);
    const b = rankOf(now, k);
    if (a === b || explained.has(k)) continue;
    const steps = h.steps.filter((s) => s.key === k);
    const raised = steps.filter((s) => rankIdx(s.to) > rankIdx(s.from));
    const named = raised.map((s) => `${stepName(s, build, content)} at ${ordinal(s.level)}`);
    const first = rankIdx(b) > rankIdx(a) ? steps.find((s) => rankIdx(s.to) > rankIdx(a)) : (steps.find((s) => s.note) ?? steps[0]);
    out.push({
      kind: 'rank',
      text: `${skillKeyLabel(k)}: ${rankWord(a)} → ${rankWord(b)}${named.length ? ` (${named.join(', ')})` : ''}.`,
      levels: [first?.level ?? 1],
    });
  }
  out.push(...fbLines);

  /* Line 4: rank-gated feats (Stonemason's Eye → Specialty Crafting, Raging Intimidation → Scare to Death). */
  const gatedNow = c.feats.filter((f) => f.grantedBy && (FEAT_RANK_FEAT_GRANTS[f.grantedBy] ?? []).some((e) => e.feat === f.featId));
  const nowPairs = new Set(gatedNow.map((f) => `${f.grantedBy}>${f.featId}`));
  for (const pair of legacy.rankGated) {
    if (nowPairs.has(pair)) continue;
    const [carrier, feat] = pair.split('>');
    const entry = (FEAT_RANK_FEAT_GRANTS[carrier] ?? []).find((e) => e.feat === feat);
    const lvl = c.feats.find((f) => f.featId === carrier)?.level ?? 1;
    const why = entry ? `: ${skillKeyLabel(entry.skill)} was ${rankIdx(skillRankBeforeSource(c, `feat:${carrier}`, entry.skill) ?? 'untrained') === 0 ? 'untrained' : `not ${rankInProse(entry.rank)} yet`} when you took it at ${ordinal(lvl)}` : '';
    out.push({ kind: 'rankGated', text: `${recordName('feat', carrier, build, content)} no longer gives ${recordName('feat', feat, build, content)}${why}.`, levels: [lvl] });
  }
  const beforePairs = new Set(legacy.rankGated);
  for (const f of gatedNow) {
    const carrierLevel = c.feats.find((x) => x.featId === f.grantedBy)?.level;
    const pair = `${f.grantedBy}>${f.featId}`;
    if (beforePairs.has(pair) && (carrierLevel === undefined || carrierLevel === f.level)) continue;
    out.push({
      kind: 'rankGated',
      text: beforePairs.has(pair)
        ? `${recordName('feat', f.grantedBy!, build, content)} now gives ${recordName('feat', f.featId, build, content)} at ${ordinal(f.level)}, not at ${ordinal(carrierLevel!)}.`
        : `${recordName('feat', f.grantedBy!, build, content)} now gives ${recordName('feat', f.featId, build, content)} at ${ordinal(f.level)}.`,
      levels: [f.level],
    });
  }

  /* Line 5: each stored increase, raised then vs raised now. A step the old "=" slot swallows was overwritten by
   * that "=" before as well, so it is never "no longer raises it". */
  /* An extra place a tweak adds (lane `tweak`, Tweaks phase 2 WP11) is never here: it was made on this version, under
   * the new order, so it has no "before" to compare (its source has no LANE_OF_SOURCE entry either). */
  const raisedBefore = new Map<string, string>();
  for (const r of legacy.increasesRaised ?? []) {
    const [lane, lvl, ...rest] = r.split(':');
    if (lane === 'tweak') continue;
    raisedBefore.set(`${lane}:${lvl}`, rest.join(':'));
  }
  const incSteps = new Map<string, SkillStep>();
  for (const s of h.steps) {
    if (s.phase !== 'increase') continue;
    const i = s.source.indexOf(':');
    const lane = LANE_OF_SOURCE[s.source.slice(0, i)];
    if (lane) incSteps.set(`${lane}:${s.level}`, s);
  }
  const laneKeys = [...new Set([...raisedBefore.keys(), ...incSteps.keys()])].sort((x, y) => Number(x.split(':')[1]) - Number(y.split(':')[1]) || x.localeCompare(y));
  for (const lk of laneKeys) {
    const [lane, lvlS] = lk.split(':');
    const lvl = Number(lvlS);
    const s = incSteps.get(lk);
    const nowRaised = !!s && rankIdx(s.to) > rankIdx(s.from);
    const wasRaised = raisedBefore.has(lk);
    if (nowRaised === wasRaised) continue;
    if (nowRaised) {
      out.push({ kind: 'increase', text: `Your ${ordinal(lvl)}-level ${LANE_WORD[lane]} (${skillKeyLabel(s!.key)}) now counts.`, levels: [lvl] });
      continue;
    }
    if (s?.note === 'swallow') continue;
    const key = (s?.key ?? raisedBefore.get(lk)) as ProficiencyKey;
    const why =
      s?.note === 'drop'
        ? 'that skill cannot take it.'
        : s
          ? `it is already ${rankInProse(s.from)} by then, the most a ${ordinal(lvl)}-level increase gives.`
          : 'it no longer applies.';
    out.push({ kind: 'increase', text: `Your ${ordinal(lvl)}-level ${LANE_WORD[lane]} on ${skillKeyLabel(key)} no longer raises it: ${why}`, levels: [lvl] });
  }

  /* Line 6: a slot feat whose skill prerequisite is met at the character's finished ranks (the old reading) but not
   * at the end of its own level (D5). */
  const waived = new Set((c.backgroundId ? content.backgrounds[c.backgroundId]?.prerequisiteWaivers ?? [] : []).map((w) => w.featId));
  for (const row of c.feats) {
    if (row.grantedBy || !row.slotKey || waived.has(row.featId)) continue;
    const feat = content.feats[row.featId];
    if (!feat) continue;
    const lines = skillPrereqLines(feat, content);
    if (!lines.length) continue;
    const without = featSubtreeIds(c, row.featId, row.slotKey);
    const at = skillRanksAtLevel(c, row.level, 'end', without);
    if (!at) continue;
    for (const ln of lines) {
      const meets = (r: Partial<Record<ProficiencyKey, ProficiencyRank>> | undefined) => !!r && ln.keys.some((k) => rankIdx(r[k]) >= rankIdx(ln.need));
      if (meets(at) || !meets(before)) continue;
      // The level the prerequisite is first met WITHOUT the feat itself (a feat never meets its own prerequisite:
      // Medic Dedication's own expert Medicine at 2nd does not count for its "trained in Medicine").
      let reach: number | undefined;
      for (let lvl = row.level + 1; lvl <= c.level && reach === undefined; lvl++) if (meets(skillRanksAtLevel(c, lvl, 'end', without))) reach = lvl;
      const when = reach !== undefined ? `which you reach at ${ordinal(reach)}` : 'which this character does not have yet';
      out.push({
        kind: 'prerequisite',
        text: `${recordName('feat', row.featId, build, content)} (${ordinal(row.level)}) needs ${rankWord(ln.need)} in ${ln.keys.map(skillKeyLabel).join(' or ')}, ${when}.`,
        levels: [row.level],
      });
    }
  }

  /* Line 7: Dual Class — increase slots only the second class grants, at or below the character's level, with no
   * answer stored (a stored one is line 5). */
  const cls = build.classId ? content.classes[build.classId] : undefined;
  const cls2 = build.variantRules?.dualClass && build.classId2 ? content.classes[build.classId2] : undefined;
  if (cls && cls2) {
    const union = classSkillIncreaseLevels(cls, cls2);
    const ownMain = new Set(cls.skillIncreaseLevels ?? SKILL_INCREASE_LEVELS);
    const ownBonus = new Set(cls.bonusSkillIncreaseLevels ?? []);
    // Tweaks phase 2 WP14: a slot a live "Remove a place" removes is no new increase to pick.
    const removed = removedSkillIncreasePlaces(build);
    const main = union.main.filter((l) => l <= c.level && !ownMain.has(l) && !build.skillIncreases?.[l] && !removed.has(skillPlaceId('main', l)));
    const bonus = union.bonus.filter((l) => l <= c.level && !ownBonus.has(l) && !build.bonusSkillIncreases?.[l] && !removed.has(skillPlaceId('bonus', l)));
    const say = (ls: number[], what: string) =>
      out.push({
        kind: 'newIncreases',
        text: `You now get ${what} at ${ordinals(ls)} level from your second class. Pick ${ls.length === 1 ? 'it on that level page' : 'them on those level pages'}.`,
        levels: ls,
      });
    if (main.length) say(main, 'a skill increase');
    if (bonus.length) say(bonus, 'an extra skill increase');
  }

  return out
    .map((x, i) => ({ x, i }))
    .sort((p, q) => KIND_ORDER.indexOf(p.x.kind) - KIND_ORDER.indexOf(q.x.kind) || p.i - q.i)
    .map((p) => p.x);
}
