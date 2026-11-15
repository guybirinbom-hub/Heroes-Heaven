# The three src/builder/shared.tsx skill readers (skill-order WP7 step 2, for WP11 step 0h)

src/builder/shared.tsx is never edited in the lane (plan Revision 3, final checker F1): main's copy holds another
chat's uncommitted blank line in `CampaignAttachCard`, and `worktree-lane.mjs apply` refuses the whole patch while
main has uncommitted changes in a file it touches. These three readers still read the FINISHED character's ranks for
a 1st-level question. WP11 step 0h applies the code below on main, after the merge, only if
`git -C "C:\trying ai 2\pf2e codex" status --porcelain -- src/builder/shared.tsx` prints nothing; otherwise they are
a "Still open" line in the final report and a chat-todo.md item (plan 7.3 item 12).

Line numbers are the lane's copy at WP7 (`05b6d66`; LF, 0 CRLF); main's copy may sit a line or two off. Find each by
the quoted text, not the number. Keep the file's LF endings (measure `\r\n` vs `\n` with node before and after).

The helpers the code calls come from WP7 in src/rules/build.ts: `skillRanksAtLevel(c, level, point, without?)`
(the per-level history, `skillRanksAt` in src/rules/ranks.ts, with the "exactly" holds active at that level laid over
it — blocks/active.ts `skillHoldsAt`; undefined for a character with no history) and `type SkillRanks`.

## Section 2 rows (plan.md, section 2, verbatim reader column)

| reader | today | change |
|---|---|---|
| skill-choice pools: `buildChoiceOptions` kind `'skills'` → `trainedSkillOptions(character, minRank)` | final ranks | (WP7 moved `buildChoiceOptions`.) "The background caller in src/builder/shared.tsx:4044 is not touched in the lane; it moves in WP11 step 0h (main, after the merge) only if main's copy is clean, else it is a 'Still open' line" |
| `newLoreRefusal` second branch (shared.tsx ~5305: `proficiencies.skills[key] !== 'untrained'` refuses a Lore trained at ANY level) and the homebrew-background replacement picker (shared.tsx ~4118-4140: heading `held` and greying from `limitChar`'s final ranks) | final ranks for a level-1 question | read `skillRanksAt(c, 1, 'creation')` (P0 only) |

All three are 1st-level creation questions (a background's "a skill you're trained in", the background's own
replacement skill, a NEW Lore bought at creation), so all three read the ranks at the end of the 1st-level creation
phase (`'creation'`, P0): what a later level trains (a skill increase, a feat taken at 2nd or later) is not there yet.

## Step A — one import and one helper

In the `} from '../rules/build';` import block near the top (it ends `trainedSkillOptions, chosenFromBooks,
removeChosenIds, withCustomAnswer,`), add `skillRanksAtLevel,`:

```ts
  trainedSkillOptions,
  chosenFromBooks,
  removeChosenIds,
  withCustomAnswer,
  skillRanksAtLevel,
} from '../rules/build';
```

Directly above `function newLoreRefusal(` add:

```ts
/** The skill ranks a 1st-level creation question reads (skill-order WP7, WP11 step 0h; plan section 2): the per-level
 *  history at the end of the 1st-level creation phase (P0), the "exactly" holds active at 1st laid over it — never
 *  the finished character's, so a skill or Lore a later level trains (an increase, a feat at 2nd or later) is not yet
 *  "already trained". A character with no history (a stored copy from before it) keeps its finished ranks. */
function creationSkillRanks(ch: Character): Record<string, ProficiencyRank> {
  return (skillRanksAtLevel(ch, 1, 'creation') ?? ch.proficiencies.skills) as Record<string, ProficiencyRank>;
}
```

(`Character` and `ProficiencyRank` are already in the file's `import type … from '../rules/types'` line.)

## Reader 1 — the background's "a skill you're trained in" choice (~4044, in `OriginPickers`)

Before:

```tsx
              background.choice.kind === 'skills'
                ? trainedSkillOptions(buildCharacter(build, content), background.choice.minRank ?? 'trained')
```

After (reads the creation ranks, and reuses `limitChar`, the character `OriginPickers` already memoises at ~3500,
so the card also stops building a second character on every render; `buildCharacter` stays the fallback when
`limitChar` failed to build, which is when the old line would have thrown):

```tsx
              background.choice.kind === 'skills'
                ? trainedSkillOptions(
                    { proficiencies: { skills: creationSkillRanks(limitChar ?? buildCharacter(build, content)) } },
                    background.choice.minRank ?? 'trained',
                  )
```

## Reader 2 — the homebrew-background replacement picker (~4118-4140, in `OriginPickers`)

Before:

```tsx
          .map((fb) => {
            const fbKey = `${build.backgroundId}:fallback:${fb.skill}`;
            const held = limitChar?.proficiencies.skills[fb.skill] ?? 'trained';
```

and, inside its `options={SKILLS.map((s) => {`:

```tsx
                    const cur = limitChar?.proficiencies.skills[s] ?? 'untrained';
```

After:

```tsx
          .map((fb) => {
            const fbKey = `${build.backgroundId}:fallback:${fb.skill}`;
            /* The rank WHEN THE BACKGROUND IS TAKEN, at creation (skill-order WP7 / WP11 0h): a later increase on the
               skill does not make the heading say "expert", and a skill only a later level trains is a live
               replacement, not greyed. */
            const atCreation = limitChar ? creationSkillRanks(limitChar) : undefined;
            const heldNow = atCreation?.[fb.skill];
            const held = heldNow && heldNow !== 'untrained' ? heldNow : 'trained';
```

```tsx
                    const cur = atCreation?.[s] ?? 'untrained';
```

(`held` keeps its 'trained' default: the card exists only because the skill was already trained, so an absent rank
still reads "Already trained", as before.)

## Reader 3 — `newLoreRefusal` (~5300-5306)

Before:

```ts
  const from = ch.grantedSkills?.[key];
  if (!from && (ch.proficiencies.skills[key] ?? 'untrained') === 'untrained') return null;
```

After:

```ts
  const from = ch.grantedSkills?.[key];
  // At creation (skill-order WP7 / WP11 0h): a Lore a later level trains (Additional Lore at 2nd, a 3rd-level
  // increase) is not "already trained" when this 1st-level Lore is bought — print trains it now, and the later
  // record then takes its own "already trained" clause.
  if (!from && (creationSkillRanks(ch)[key] ?? 'untrained') === 'untrained') return null;
```

Its callers are both creation cards: `SkillEditor` (~5364, the class's Trained skills card) and `LanguageEditor`
(~5445, a Lore taken in place of a language). `grantedSkills` is already level-1 locks only since WP3 (section 2,
"class skill picks greying" row), so the first branch needs no change.

## Tests WP11 step 0h adds (plan 834-837: "a P case for each")

In test/skill-rank-readers.test.tsx, each with a twin (a source from an EARLIER point is still counted):

1. Background "a skill you're trained in" (a background whose `choice.kind === 'skills'`; find one with
   `Object.values(db.backgrounds).filter((b) => b.choice?.kind === 'skills')`): a skill trained only by a 3rd-level
   increase is NOT offered at creation; twin: the same skill from the 1st-level class pick IS offered.
2. Homebrew-background replacement heading and greying (a custom background naming a skill the heritage trains,
   e.g. Ancient Ash's Stealth, with Stealth increases at 3 and 5): the heading says "Already trained in Stealth", not
   "expert"; a skill trained only by a 3rd-level increase is not greyed; twin: a skill from the 1st-level class pick
   is greyed.
3. `newLoreRefusal`: typing a Lore that Additional Lore at a later level trains (or a 3rd-level increase on a Lore)
   into the Trained skills card's "Learn a new lore" is accepted; twin: a Lore the background trains is refused
   ("Already trained in … Lore").

Each must fail on the old line (planted proof: the "Before" code above) and pass on the new one.
