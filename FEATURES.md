# Wanderer's Guide — Complete Feature Inventory

A full list of everything the app does — every screen, action, toggle, and calculation. Organized by section. No explanations of *how* it works, just *what* it does.

---

## 1. Application Shell & Navigation

### Window chrome (frameless Electron)
- Brand / logo ("Wanderer's Codex")
- Breadcrumb of current location
- Minimize button
- Maximize / restore button
- Close button

### Global navigation
- Hamburger nav menu: Characters, Settings, Homebrew, (Admin if admin), Edit in Builder
- Spotlight global search (Cmd+K / Ctrl+K)
- UI zoom (Ctrl + mouse wheel), range 0.5×–2.0×, persisted

### Routes
- `/characters` — roster
- `/sheet/:id` — character sheet
- `/builder/:id` — character builder
- `/homebrew` — homebrew editor
- `/account` — settings
- `/stat-block/:type/:id` — standalone content viewer
- `/encounters`, `/campaigns`

### Authentication
- Single-user auto-login (local Electron auth shim)
- Session/JWT persistence
- No login UI

---

## 2. Character Roster (`/characters`)

- Hero header with character count + active status
- Search characters (by name, ancestry, class, background, details); `/` to focus, Esc to clear
- Filter tabs: All / Active / Archived
- New character button (disabled at slot cap)
- Import character button (.json / .guidechar / Pathbuilder)
- Per-character card: name, ancestry, class, background, level, HP (current/max), hero-point pips, last-modified date, archived/active badge
- Per-character actions: open sheet, copy, archive/unarchive, delete (confirm), export JSON, export PDF
- Character slot cap (default 3, higher with Patreon) gating create/import

---

## 3. Character Sheet — Global UI

### Window bar
- Brand, breadcrumb, minimize/maximize/close

### Top bar
- Portrait (clickable to change)
- Character name
- Ancestry link, Class link (open drawers)
- ☾ Rest button (daily reset)
- Tab selector: Main / Spells / Inventory / Feats & Features / Companions / Notes / Details
- Level chip
- XP display + add XP
- Hamburger menu: Characters, Homebrew, Settings, Edit in Builder

### Left rail
- **Vitals block:** HP current / max / temporary with bar; Resistances & Weaknesses; Class DC; AC; Shield; Spell DC; Spell Attack cells
- **Speed & Senses**
- **Hero Points** (3 pips, add/spend)
- **Saves & Perception** (Fortitude, Reflex, Will, Perception — 4 rows, click to roll/view)
- **Conditions** (add button, condition pills, ± value, × remove)
- **Languages** (pills)

### Main column
- **Abilities & Skills block** with key-ability legend
- **Pinned / favorites** section
- **Activities** with mode switch: Encounter / Exploration / Downtime
  - Sections: Strikes, Feats, Items, Basic actions, Skill actions, Speciality
  - Drag-to-reorder, search, action-cost filter

### Sheet-wide actions
- Rest for the night
- Conditions & Modes modal
- Dice Roller drawer
- Campaign drawer
- Per-character accent color + light/dark theme

---

## 4. Character Sheet — Tab: Main (Abilities, Skills, Activities)

- Six ability scores + modifiers (partial-boost underline + correct score, e.g. 19)
- Key ability highlighted
- 14 skills + Lores + Perception, each with modifier and proficiency rank
- Pinned/favorite actions
- Activities list filtered by Encounter / Exploration / Downtime
- Strikes (melee/ranged with attack trio + damage)
- Basic / Skill / Speciality action sections
- Search + action-cost filter
- Drag reorder

---

## 5. Character Sheet — Tab: Spells

### Spellcasting source types (each with its own display + actions)
- Prepared (per-LIST)
- Prepared (per-TRADITION)
- Spontaneous (Repertoire)
- Focus
- Innate
- Ritual
- Staff
- Wand
- Spellheart

### Per-source features
- Spell slots by rank (current/max)
- Cast / un-cast (expend slot), refill on rest
- Prepare spell into slot (prepared casters) via Manage Spells modal
- Repertoire management (spontaneous)
- Signature spells (cast from higher slots)
- Cantrips (auto-heighten to highest rank)
- Heightening (cast at higher rank)
- Focus pool: focus points current / max, refocus
- Innate spell use trackers (casts current/max per day)
- Spell attack roll (per source, with MAP)
- Spell DC (per source)
- Click spell to open drawer
- Manage Spells modal (add/remove/prepare)

---

## 6. Character Sheet — Tab: Inventory

### Layout
- Search items
- Bulk badge: `Bulk: X.X / Y`
- Currency strip: PP / GP / SP / CP (click to manage)
- Monster Parts badge `MP: X gp` (Battlezoo variant only)
- Add Item button
- Columns: Name, Qty, Bulk, Price
- Empty-state prompt

### Item rows
- Item icon + name (dimmed if exhausted)
- Scroll/wand display name ("Magic Wand of [Spell]", with rank)
- Inline weapon stats (3 attack bonuses + damage string)
- Qty / Bulk / Price columns
- Quick actions: Equip/Unequip, Invest/Divest, Implant/Extract (each disabled at limit / in container)
- Containers as expandable accordion rows with "View Item"

### Item drawer (full details)
- Title + meta type (dimmed if exhausted)
- Traits, rarity, size, broken/shoddy/archaic/formula badges
- **Runes section:** potency (+1…+4), striking/greater/major/mythic, resilient tiers, property runes (each clickable)
- **Material** badge (type + grade)
- **Upgrade slots** (Starfinder grade + slot badges)
- **Attack & Damage** (weapons): attack trio, damage string, open weapon stat drawer
- **Range & Reload** (ranged)
- **Armor/Shield stats:** AC bonus, dex cap, strength req, check penalty, speed penalty (with help)
- **Capacity & Ammo** (Starfinder)
- **Category & Group** with crit-/armor-specialization hover description
- **Price, Usage, Hands, Bulk, Craft Requirements**
- **Description** (rich text; scroll/wand prepends spell + heighten)
- **Charges / Uses tracker:** N/Max token row (click to toggle), refill button
- **Battlezoo Monster Parts panel:** On/Off, category picker, skill picker, refinement value (gp), refined-level summary + bonuses, item DC, over-investment warning, imbued-property slots (add/remove)
- Item action row: Move Item (to container / unstored), Edit, Delete

### Add Items modal
- Title "✦ Add Items", + Custom Item button
- Search by name (or filter search)
- Filters panel (⚙ Filters N): level range, rarity, availability, size, item groups, traits, description/usage/hands/bulk/craft-requirements text; Reset & Apply
- Table: Lvl, Item, Price, Action
- Per-row actions: Buy (deduct coins), Give (free), Formula
- Pagination (18/page), "Showing X–Y of Z"
- Helper: "Buy deducts price from wallet · Give adds for free"

### Buy Item modal
- Item cost, resulting balance, confirm/cancel, disabled if insufficient funds

### Create / Edit Item modal
- Name, Level, Rarity, Availability, Size
- Price (PP/GP/SP/CP)
- Hands, Bulk, Usage, Traits, Description
- Weapon fields: category, group, damage dice/die, damage type, extra damage, range, reload
- Armor fields: category, group, AC bonus, dex cap, check penalty, speed penalty, strength req
- Runes: potency, striking/resilient, property runes
- Battlezoo Monster Parts toggle (category, skill, refinement value, imbued properties)
- Material & Starfinder grade/upgrade slots
- Container: capacity, ignored bulk, default contents
- Charges (current/max), HP/hardness/broken threshold (read-only)
- Craft requirements, base item, image URL, quantity
- Flags: shoddy, unselectable
- Operations editor (custom bonuses/conditionals)
- Cancel / Save

### Currency management
- Manage Coins drawer: PP/GP/SP/CP inputs, total wealth display
- Coin conversion (1pp=10gp=100sp=1000cp), coin bulk (1000 coins = 1 bulk)
- Purchase / give logic with denomination rebalancing

### Monster Parts system (Battlezoo)
- Pool badge + popover (value gp, sources/notes)
- Per-item refinement (weapon/armor/shield/perception/skill bonuses by level)
- Imbued properties with slot scaling and item DC

---

## 7. Character Sheet — Tab: Feats & Features

- Dual layout (Feats + Features side-by-side > 700px; tabbed otherwise)
- SegmentedControl: Feats / Features
- **Feats sections:** Class Feats, Ancestry Feats, General & Skill Feats, Other Feats
- **Features sections:** Class Features, Heritage, Ancestry Features
- Full-text search (name, description, rarity, group, traits) — overrides toggle
- Click any feat/feature/heritage to open its drawer
- "No feats or features found" empty state

---

## 8. Character Sheet — Tab: Companions

- Companion pill switcher (portrait + name + level tag)
- Add Companion (creature picker flow), delete (confirm)
- Companion portrait (change), name, type + level tag (Animal Companion / Familiar / Eidolon / …)
- Companion stat block: trait ribbon, perception + senses, trained skills, 6-attribute strip, AC, saves (Fort/Ref/Will), HP current/max + temp, speeds, conditions & modes pills
- Companion strikes (melee/ranged: name, to-hit, traits, damage dice/type/bonus, extra)
- Companion abilities (action glyph, frequency, use pips, description)
- Companion spellcasting (spells by rank, focus spells + focus points, innate with trackers)
- Companion custom modes (toggle, effects)
- Companion edit mode (eidolon attributes, familiar abilities/maturity, animal-companion advancement, attack damage type)
- Companion inventory (full player-style panel)

---

## 9. Character Sheet — Tab: Notes

- Multi-page notes
- Add / delete / rename pages
- Per-page icon (picker) and color
- Page privacy: shared-with-party vs private
- Search pages
- Page counter ("X pages", "Page N of M")
- Rich-text editor toolbar: action symbols; insert/remove content links; bold/italic/underline; blockquote, horizontal rule, bullet/ordered list; H2/H3/H4; highlight color (14), text color (14)
- Responsive toolbar; debounced autosave; placeholder text

---

## 10. Character Sheet — Tab: Details

- **General:** appearance, personality, alignment, beliefs, age, height, weight, gender, pronouns, faction, ethnicity, nationality, birthplace
- **Organized Play:** Organized Play ID (link to Paizo), faction autocomplete, reputation value, adventures accordion (add/edit, per-adventure level/+XP/+GP/+Rep/event code/event name/date; calculated level, total XP, total GP, total Rep)
- **Languages** pills (open drawer)
- **Traits** pills (open drawer)
- **Size** (open drawer)
- **Proficiencies accordion:** Attacks (Simple/Martial/Advanced/Unarmed); Defenses (Light/Medium/Heavy/Unarmored); Spellcasting (Spell Attack, Spell DC); per-weapon and weapon-group; per-armor and armor-group; Class DC

---

## 11. Character Sheet — Class-Specific Features

> One block per class. Lists what the app tracks as that class's distinctive mechanics — key attribute, subclass choice, spellcasting type/tradition, and signature resource. Spellcasters are wired into the casting tables; non-spellcasters skip the spell UI.

### Alchemist
- Key attribute: Intelligence
- Subclass: Research Field
- Spellcasting: none
- Signature: Infused Reagents; bomb proficiency (weapon group: bomb)

### Barbarian
- Key attribute: Strength
- Subclass: Instinct
- Spellcasting: none
- Signature: Rage (instinct damage bonus, resistances, raging strikes)

### Bard
- Key attribute: Charisma
- Subclass: Muse
- Spellcasting: Spontaneous Repertoire — Occult
- L1 picks: 5 cantrips + 2 rank-1; full caster
- Signature: Signature spells; Focus points (compositions)

### Champion
- Key attribute: Strength or Dexterity
- Subclass: Cause / Doctrine
- Spellcasting: none (focus spells via doctrine)
- Signature: Deific weapon; Reaction (Retributive/Punish)

### Cleric
- Key attribute: Wisdom
- Subclass: Doctrine / Order
- Spellcasting: Prepared from Tradition — Divine
- Signature: Domain spells; Focus points; Class DC

### Druid
- Key attribute: Wisdom
- Subclass: Order
- Spellcasting: Prepared from Tradition — Primal
- Signature: Order spell; Focus points; Class DC

### Fighter
- Key attribute: Strength or Dexterity
- Subclass: none (defined by feats)
- Spellcasting: none
- Signature: Weapon specialization + critical specialization; weapon-group proficiencies; melee/ranged attack bonuses

### Gunslinger
- Key attribute: Dexterity or Wisdom
- Subclass: Way
- Spellcasting: none
- Signature: Firearm proficiency; deeds; reload mechanics

### Inventor
- Key attribute: Intelligence
- Subclass: Methodology
- Spellcasting: none
- Signature: Infusions; tool affinity

### Magus
- Key attribute: varies (Dex/Str)
- Subclass: Arcane Thesis / Hybrid Study
- Spellcasting: Prepared Spellbook (half-caster) — Arcane
- L1 picks: 8 cantrips + 4 rank-1
- Signature: Arcane pool; Spellstrike; Studious spells

### Monk
- Key attribute: Dexterity or Wisdom
- Subclass: Monastic tradition / Way
- Spellcasting: none (focus spells via tradition)
- Signature: Focus points (ki); unarmed-attack proficiency; speed increase

### Oracle
- Key attribute: Charisma
- Subclass: Mystery
- Spellcasting: Spontaneous Repertoire — Divine
- L1 picks: 5 cantrips + 3 rank-1; full caster (rank 10 capstone)
- Signature: Revelation spells; Curse progression; Focus points

### Psychic
- Key attribute: Charisma
- Subclass: Conscious Mind
- Spellcasting: Spontaneous Repertoire (half-caster) — Occult
- Signature: Psyche; Psi cantrips; Psi amps

### Ranger
- Key attribute: Strength / Dexterity / Wisdom
- Subclass: Hunter's Edge
- Spellcasting: none
- Signature: Hunted target; favored weapon; weapon specialization

### Rogue
- Key attribute: Dexterity (or by racket)
- Subclass: Racket
- Spellcasting: none
- Signature: Sneak attack; racket abilities; Evasion

### Sorcerer
- Key attribute: Charisma
- Subclass: Bloodline
- Spellcasting: Spontaneous Repertoire — tradition by bloodline
- L1 picks: 4 cantrips + 2 rank-1; full caster
- Signature: Bloodline spells; Bloodline Paragon; Focus points

### Summoner
- Key attribute: Charisma
- Subclass: Eidolon type
- Spellcasting: Spontaneous Repertoire (half-caster, fixed cap) — tradition by eidolon
- Signature: Eidolon link; Focus points

### Swashbuckler
- Key attribute: Dexterity
- Subclass: Style
- Spellcasting: none
- Signature: Panache; finesse-weapon proficiency; Exploit/Riposte

### Witch
- Key attribute: Intelligence
- Subclass: Patron
- Spellcasting: Prepared Spellbook (familiar grimoire) — tradition by patron
- L1 picks: 5 cantrips + 5 rank-1
- Signature: Patron lessons; Patron hex; Hexes; Focus points

### Wizard
- Key attribute: Intelligence
- Subclass: School (Arcane Thesis)
- Spellcasting: Prepared Spellbook — Arcane
- L1 picks: 10 cantrips + 5 rank-1 + 2 curriculum
- Signature: Curriculum spells; Thesis; Focus points

> Animist is also wired into the casting tables (spontaneous/prepared hybrid by apparition).

---

## 12. Character Sheet — All Calculations

### Abilities
- Ability scores + modifiers
- Partial boosts (correct +1 to score above 18)

### Defenses
- AC + full breakdown (proficiency, item bonus, dex cap, penalties)
- DEX cap applied
- Armor check penalty (ACP)
- Speed penalty from armor
- Unarmored defense
- Fortitude / Reflex / Will saves

### Proficiencies
- Weapon proficiencies (categories: simple/martial/advanced/unarmed)
- 18 weapon groups
- Armor proficiencies (light/medium/heavy/unarmored)
- Armor groups
- Per-item proficiency resolution

### Skills & Perception
- 14 skills + Lores
- Perception

### Spellcasting
- Spell attack per source (with MAP)
- Spell DC per source
- Spell slots per rank
- Focus points max / current
- Prepared / repertoire / cantrip counts

### Class DC

### Offense
- Attack bonus across 3 MAP tiers with full breakdown
- Weapon damage (with specialization + runes)
- Damage dice / type
- Critical specialization
- Range increment
- Reload

### Health & resources
- HP max, temporary HP, dying, wounded, hardness
- Stamina / Resolve (variant)
- Hero Points
- Focus points

### Movement & perception
- Initiative
- Speeds: land / fly / climb / burrow / swim (+ penalties)
- Senses: precise / imprecise / vague

### Mitigations
- Resistances / Weaknesses / Immunities

### Carrying
- Bulk / encumbrance
- Invested limit
- Implant limit

### Currency & items
- Currency totals (PP/GP/SP/CP)
- Item price / qty / HP / uses / grades / runes

### Conditions
- Condition adjustments applied to stats

---

## 13. Character Builder (`/builder/:id`)

### Navigation
- Home / Build / Sheet steps
- Level strip 0–20 (level-0 chip; per-level complete/incomplete state; "!" markers on pending dropdowns; instant pending counts)

### Home
- Character name + reroll
- Portrait
- Level ±
- **Content Sources** (8 book groups)
- **Homebrew** tab
- **Variant Rules** (9)
- **Options** (6)
- Accent color picker + 9 swatches
- Authorised Clients (revoke)

### Build
- **Level 0 / Initial Stats:** Ancestry, Heritage, Background, Class, (Dual Class), Attributes (boosts), Vitals; class-less start hint
- **Origin:** Ancestry / Background / Class / Class2 selection
- **Attributes:** boost/flaw assignment
- **Levels 1–20:** per-level choice cards (feats, features, skill increases, spell picks)
- **Proficiency upgrade gating:** only legal increases offered (e.g. trained→expert when allowed; locks expert→master if not permitted; "Maxed" / "Lv 7+" / "Lv 15+" locked rows)
- **Right rail:** skills, saves, weapon & armor proficiencies
- DeepBackgroundForm
- Per-dropdown pending "!" markers
- All confirmation modals

---

## 14. Spellcasting (deep)

- 8 source types (Prepared-LIST / Prepared-TRADITION / Spontaneous-Repertoire / Focus / Innate / Ritual / Staff / Wand / Spellheart)
- Signature spells
- Focus pool
- Heightening
- Manage Spells modal
- Spell attack / DC per source
- Per-class spell mechanics (see §11)

---

## 15. Companions & Stat Blocks

### Companions (see §8 for sheet tab)
- Animal companions, familiars, eidolons, other types
- Full stat block, strikes, abilities, spellcasting, inventory, modes
- Companion calculations: AC, saves, perception, speeds, skills, attribute mods, max HP, senses

### Stat blocks / creatures
- Stat block section display (name, level, traits, recall knowledge for creatures)
- Core stats: perception+senses, languages, skills, attributes, items, AC + armor/shield, saves, HP + temp + resist/weak/immune
- Speeds (land + extras)
- Free/reaction abilities; strikes (melee/ranged); innate/prepared/spontaneous/focus spells; rituals
- Features/abilities (action cost, traits, frequency, cost, trigger, requirements, effect, special)
- Conditions; description
- Hide options: name, traits, image, health, description
- "Open stat block"

---

## 16. Dice Roller

- 3D dice overlay (with RNG fallback)
- Configure: dice count (1–10), type (d4–d20), bonus, label; Add to tray
- Dice tray badges (remove, select, theme)
- Roll Dice button + animation
- Roll history (grouped, color-coded max/min, timestamps, clear, auto-scroll)
- Dice themes (carousel, per-die theme, patron-restricted themes)
- Presets (create/save tray, list, add-to-tray, delete; default presets collapsible)
- State persistence (history, presets, default theme)

---

## 17. Search

### Spotlight (Cmd/Ctrl+K)
- Debounced global search
- Result types: ability blocks (feats/actions/features/senses/heritages), ancestries, archetypes, backgrounds, classes, creatures, items, languages, spells, traits, versatile heritages, class archetypes, content sources, characters
- Per-result: icon, name, first-sentence description, level/rank badge
- Click → drawer (read-only) or navigate
- Page links: Home, Characters, Homebrew, Encounters, Campaigns, Account/Settings

### Advanced Search modal
- Two tabs: Filters / Results
- Content-type selector
- Filters: name, description, rarity, availability, traits, level range, rank range, ability-block type, size, cost, trigger, requirements, actions, frequency, cast cost, traditions, defense, range, area, targets, duration, special, bulk, group, hands, craft requirements, spell type, usage, access, prerequisites, meets-prerequisites, content sources
- Results: count, over-max indicator, list with name/type/level/rarity, click to select
- Filter pills, stale-result tracking, auto-search

---

## 18. Export / Import / Share

- Export to JSON (version 4, `<name>.json`)
- Export to PDF (v2, legacy v1)
- Import from: JSON, Pathbuilder, FTC/Foundry, legacy `.guidechar`
- Creature import
- Character-import UI (upload, select, overwrite confirm)
- Portrait upload / picker (categories, toggle on/off)

---

## 19. Homebrew & Content

### Bundles / content sources
- Create / edit / delete bundle (with subscription)
- Search bundles
- Import from custom pack (Pathbuilder)
- Bundle cards (name, description, contact, meta counts)
- Bundle metadata: name, description, contact, URL, group, status (published, requires-key), required sources, artwork, content counts

### Homebrew creation modals (create + edit each)
- Ability Block (Feat / Action / Class Feature / Sense / Physical Feature / Heritage / Mode)
- Ancestry
- Heritage / Versatile Heritage
- Background
- Class
- Class Archetype
- Archetype
- Item
- Spell
- Creature
- Trait
- Language

### Operations editor
- Add / remove / copy / paste operations
- Operation types: Selection, Conditional, Adjust Value, Add Bonus, Give Feat/Action/Class Feature/Sense/Physical Feature/Heritage/Mode/Language/Spell/Spell Slots, Define Casting Source, Give Item, Give Trait, Create Value, Override Value, Bind Value, Inject Select Option, Inject Option, Inject Text, Send Notification

### Content updates
- Enable/disable sources
- Content-update voting (upvote/downvote, feedback comments, creator info)
- Content counts per source

---

## 20. Settings, Conditions & Modes

### Settings (`/account`)
- Dark Mode toggle
- Theme Color picker (9 swatches) + Save (app-wide + default for new characters)
- View Operations toggle (developer)
- Global custom Modes (create/edit/delete)
- Uninstall (wipes characters, bundles, DB, binary; confirm; irreversible)
- Auto-update (checks after boot + periodically; "Restart & Update" prompt)

### Conditions
- Browse all PF2e conditions, search, severity tinting, already-active badge
- Add condition, set value (1–4), remove
- Special: removing Dying auto-adds/increments Wounded
- Full condition list incl. Blinded, Clumsy, Confused, Controlled, Dazzled, Deafened, Doomed, Drained, Dying, Encumbered, Enfeebled, Fatigued, Fleeing, Frightened, Grabbed, Immobilized, Off-guard, Paralyzed, Persistent Damage, Petrified, Prone, Restrained, Sickened, Slowed, Stunned, Stupefied, Unconscious, Wounded, plus Starfinder (Glitching, Suppressed) and Broken

### Modes
- Built-in modes (engine-granted): browse, search, toggle, view
- Custom modes: global (localStorage) or per-character; create/edit/delete; toggle
- Mode Editor: name, description, effects (target variable, value, bonus type: untyped/circumstance/status/item/alchemical), scope, save/cancel

---

## 21. Campaign

- Campaign drawer with tabs: Description / Party / Notes
- **Description:** name, player count, description
- **Party:** member status setting (Off / Status / Detailed); per-character status card (name, health color, condition count); detailed stat-block preview
- **Notes:** shared campaign pages + shared character pages (read-only)
- Join campaign; background image; party list; live polling
- Recommended settings (show party member status)

---

## 22. App-Level

- Light / dark theme (persisted)
- Global accent color + per-character accent
- UI zoom (Ctrl+wheel, persisted)
- In-app auto-update (download + Restart & Update)
- Full uninstall (removes app data, DB, updater cache, binary)
