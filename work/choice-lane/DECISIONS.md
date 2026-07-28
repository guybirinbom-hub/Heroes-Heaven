# Choice-lane decisions (owner, 2026-07-28)

The 147 `needsHumanDecision` escalations from Step 1 collapsed into a handful of real calls.
These are the answers. Anything not listed here is still open.

---

## 1. Daily-preparation picks → the Rest button, with a personalization setting

Many feats say *"during your daily preparations, choose X"* — Runic Mind Smithing (a weapon rune),
Starstone Aspirant (an untrained skill), Endless Memories, Cutting Without Blade (a temporary feat),
Celestial Armaments (a weapon), Natural Mutagen (a mutagen), Ancient Memories.

**Decision:** the REST button *is* daily preparations. Add a Personalization/Customization setting
with two modes:

- **Ask every time you rest** — resting prompts for each daily pick.
- **Reuse my last pick** — resting silently re-applies what you chose before. If you have this mode
  on but have **never picked yet**, the next rest prompts once; from then on it reuses that answer.

So the pick is always *made* at least once, and the sheet always reflects a real choice.

## 2. Kingdom feats → keep them, and record the pick

The 32 `kingdom`-trait feats (Civil Service, Kingdom Assurance…) belong to a kingdom, not a
character, and no kingdom sheet exists yet.

**Decision:** keep them selectable and DO prompt, storing the choice, even though nothing consumes it
yet. When a Kingdom sheet arrives the answers are already there.

## 3. Picks that only benefit allies / NPCs → DEFERRED, do not lose these

Patron Reborn (only allied witches benefit), Sanctified Relic and Assume Godhood (benefit an NPC
hierophant or your followers), Marshall Fiendish Forces (summons a creature), and the rest of that
shape.

**Decision: "we will take care of these later — remember them."** Not to be silently resolved, not to
be quietly dropped. They stay in `escalations.json`, and this file is the reminder that they are
*deferred*, not *answered*.

## 4. Legacy content referencing things the Remaster deleted → let the player choose, and SAY so

Warding Rune wants a "school of magic" (a taxonomy the Remaster removed; only 147 of 1,832 spells
still carry one). Similar cases exist wherever a legacy feat keys off a deleted concept.

**Decision:** still offer the choice, but tell the player plainly that it will not grant the benefit,
because the thing it refers to no longer exists in the data. **Legacy content that grants something
which DOES still exist keeps working normally** — this warning is only for the genuinely dangling
ones. Never silently show a pick that does nothing.
