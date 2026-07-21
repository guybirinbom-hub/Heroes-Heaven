// AUTO-GENERATED from "Monster Parts - Remaster Conversion v2.html" by
// scripts/parse-monster-parts.mjs — do not edit by hand.
// Segments of the Monster Parts (Remaster Conversion) book, one per heading, so
// each shows up individually in global search. Merged into the rules map in
// dataStore.loadRules() and gated in search behind the Show Monster Parts setting.

export interface RuleSegment { name: string; text: string; source: string }

export const MONSTER_PARTS_SOURCE = "Monster Parts (Remaster Conversion)"

export const MONSTER_PARTS_RULES: RuleSegment[] = [
  { name: "Monster Parts (Remaster Conversion)", source: MONSTER_PARTS_SOURCE, text: `An unofficial, personal-use conversion of the Monster Parts subsystem (Battlezoo Bestiary, Roll for Combat) to the Pathfinder Second Edition Remaster. Rules prose is paraphrased; the mechanical tables and imbued properties are reproduced with Remaster updates applied. Battlezoo Bestiary is © Roll for Combat — buy it to support the creators.` },
  { name: "Monster Parts: The system in brief", source: MONSTER_PARTS_SOURCE, text: `PCs harvest monster parts from defeated foes and spend them to refine (improve an item's fundamentals) and imbue (add special properties) weapons, armor, shields, Perception items, and skill items. Parts are tracked by value (in gp) and by the creature they came from. An item uses either this system or normal runes/precious materials — never both at once.

• Refining turns parts into a mundane item (pay its Price in parts) and then raises its item level as you add value past the thresholds on Tables 3A/3B, granting the benefits on Tables 4A–4E. You can't refine above your own level.
• Imbuing unlocks once an item is refined high enough (see Tables 4A–4E). Add parts that match the imbued property's requirement; the property levels up at the Table 5A/5B thresholds. An imbued property can't exceed the item's level or your level, whichever is lower.
• It's recommended that players assign parts immediately and gain the benefit at their next daily preparations, rather than spending downtime — though a GM may instead route it through the Craft activity.

Identifying / investing / naming. Monster-part items are identified like any magic item (a GM may let Crafting identify them). Worn ones are invested normally (10-item limit). When tracking, note the refining level and each imbued property's level, e.g. +3 major striking fire might (16) cold technique (20) longsword (20).` },
  { name: "Monster Parts: The three variants (GM)", source: MONSTER_PARTS_SOURCE, text: `• Full: replaces nearly all wealth with monster parts.
• Light: replaces only currency; runes and other magic items still exist (but the party will build only a few part-items).
• Hybrid: replaces currency + about half of the permanent items; keeps the rest and all consumables.` },
  { name: "Monster Parts: Gathering ingredients", source: MONSTER_PARTS_SOURCE, text: `After a fight, spend 10 minutes to gather parts (automatic success; huge or numerous foes may take several 10-minute increments). Parts are bulky — roughly L for a Small creature, 1 for Medium, 2 for Large, 4 for Huge, 8 for Gargantuan — so it's usually wise to spend them quickly. Track parts by value + source creature (e.g. "12 gp of giant crab parts"); value can be split across items. A PC with a relevant Lore (or Survival, via the feat below) can spend downtime to Earn Income (task level = the monster's level) to scavenge more, up to double a corpse's value (a critical failure also ends the effort). Parts sell for half value if sold at all. A hazard with a physical manifestation can yield parts (a complex hazard counts as a creature of its level; a simple hazard gives ¼ that value).

What counts as a monster? Use whatever definition fits your table — usually PC ancestries and beings of pure goodness aren't harvested, though an ally might give shed scales or feathers that work just as well. Humanoid foes who aren't a parts source often carry refined items or loose parts the PCs can break down instead.` },
  { name: "Monster Parts: Monster Scavenger — Survival skill feat 1 (homebrew, Non-Paizo)", source: MONSTER_PARTS_SOURCE, text: `Prerequisite trained in Survival. You can use Survival to Earn Income scavenging monster parts. If you use an appropriate Lore instead, gain a +1 circumstance bonus to the check (+2 if you're a master in Survival).` },
  { name: "Monster Parts: Converting an ongoing game", source: MONSTER_PARTS_SOURCE, text: `• Light: usually nothing to do — only a couple of items are ever monster-part items. Convert an interested player's item or two using the tips below.
• Hybrid/Full: convert weapons, armor, shields, Perception items, and skill items first; leave (Hybrid) or replace to the nearest equivalent (Full) items steeped in the base magic-item system. Fundamental runes map cleanly to refining levels; many popular property runes have a might path that does something similar (e.g. fire might ≈ flaming). A skill-bonus armor rune becomes a separate skill item, freeing imbuing slots. Leave precious-material and specific items as-is in Hybrid; a specific item may be refined but should never be imbued, and its refining level shouldn't alter its specific effects.` },
  { name: "Monster Parts: Tables", source: MONSTER_PARTS_SOURCE, text: `The treasure, refinement, and imbuing tables are pure math and are unchanged by the Remaster; they're reproduced here for convenience. (These tables replace Table 10-9: Party Treasure by Level and the Treasure by Encounter table, now found in GM Core.)` },
  { name: "Monster Parts: Table 1A — Party Treasure by Level (Light)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Lvl</td><td>Total</td><td>Permanent (by item lvl)</td><td>Consumables (by item lvl)</td><td>Monster Parts</td><td>Per extra PC</td></tr><tr><td>1</td><td>175 gp</td><td>2nd:2, 1st:2</td><td>2nd:2, 1st:3</td><td>40 gp</td><td>10 gp</td></tr><tr><td>2</td><td>300 gp</td><td>3rd:2, 2nd:2</td><td>3rd:2, 2nd:2, 1st:2</td><td>70 gp</td><td>18 gp</td></tr><tr><td>3</td><td>500 gp</td><td>4th:2, 3rd:2</td><td>4th:2, 3rd:2, 2nd:2</td><td>120 gp</td><td>30 gp</td></tr><tr><td>4</td><td>860 gp</td><td>5th:2, 4th:2</td><td>5th:2, 4th:2, 3rd:2</td><td>200 gp</td><td>50 gp</td></tr><tr><td>5</td><td>1,350 gp</td><td>6th:2, 5th:2</td><td>6th:2, 5th:2, 4th:2</td><td>320 gp</td><td>80 gp</td></tr><tr><td>6</td><td>2,000 gp</td><td>7th:2, 6th:2</td><td>7th:2, 6th:2, 5th:2</td><td>500 gp</td><td>125 gp</td></tr><tr><td>7</td><td>2,900 gp</td><td>8th:2, 7th:2</td><td>8th:2, 7th:2, 6th:2</td><td>720 gp</td><td>180 gp</td></tr><tr><td>8</td><td>4,000 gp</td><td>9th:2, 8th:2</td><td>9th:2, 8th:2, 7th:2</td><td>1,000 gp</td><td>250 gp</td></tr><tr><td>9</td><td>5,700 gp</td><td>10th:2, 9th:2</td><td>10th:2, 9th:2, 8th:2</td><td>1,400 gp</td><td>350 gp</td></tr><tr><td>10</td><td>8,000 gp</td><td>11th:2, 10th:2</td><td>11th:2, 10th:2, 9th:2</td><td>2,000 gp</td><td>500 gp</td></tr><tr><td>11</td><td>11,500 gp</td><td>12th:2, 11th:2</td><td>12th:2, 11th:2, 10th:2</td><td>2,800 gp</td><td>700 gp</td></tr><tr><td>12</td><td>16,500 gp</td><td>13th:2, 12th:2</td><td>13th:2, 12th:2, 11th:2</td><td>4,000 gp</td><td>1,000 gp</td></tr><tr><td>13</td><td>25,000 gp</td><td>14th:2, 13th:2</td><td>14th:2, 13th:2, 12th:2</td><td>6,000 gp</td><td>1,500 gp</td></tr><tr><td>14</td><td>36,500 gp</td><td>15th:2, 14th:2</td><td>15th:2, 14th:2, 13th:2</td><td>9,000 gp</td><td>2,250 gp</td></tr><tr><td>15</td><td>54,500 gp</td><td>16th:2, 15th:2</td><td>16th:2, 15th:2, 14th:2</td><td>13,000 gp</td><td>3,250 gp</td></tr><tr><td>16</td><td>82,500 gp</td><td>17th:2, 16th:2</td><td>17th:2, 16th:2, 15th:2</td><td>20,000 gp</td><td>5,000 gp</td></tr><tr><td>17</td><td>128,000 gp</td><td>18th:2, 17th:2</td><td>18th:2, 17th:2, 16th:2</td><td>30,000 gp</td><td>7,500 gp</td></tr><tr><td>18</td><td>208,000 gp</td><td>19th:2, 18th:2</td><td>19th:2, 18th:2, 17th:2</td><td>48,000 gp</td><td>12,000 gp</td></tr><tr><td>19</td><td>355,000 gp</td><td>20th:2, 19th:2</td><td>20th:2, 19th:2, 18th:2</td><td>80,000 gp</td><td>20,000 gp</td></tr><tr><td>20</td><td>490,000 gp</td><td>20th:4</td><td>20th:4, 19th:2</td><td>140,000 gp</td><td>35,000 gp</td></tr></table>` },
  { name: "Monster Parts: Table 1B — Party Treasure by Level (Hybrid)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Lvl</td><td>Total</td><td>Permanent</td><td>Consumables</td><td>Monster Parts</td><td>Per extra PC</td></tr><tr><td>1</td><td>175 gp</td><td>2nd:1, 1st:1</td><td>2nd:2, 1st:3</td><td>95 gp</td><td>24 gp</td></tr><tr><td>2</td><td>300 gp</td><td>3rd:1, 2nd:1</td><td>3rd:2, 2nd:2, 1st:2</td><td>165 gp</td><td>40 gp</td></tr><tr><td>3</td><td>500 gp</td><td>4th:1, 3rd:1</td><td>4th:2, 3rd:2, 2nd:2</td><td>280 gp</td><td>70 gp</td></tr><tr><td>4</td><td>860 gp</td><td>5th:1, 4th:1</td><td>5th:2, 4th:2, 3rd:2</td><td>460 gp</td><td>115 gp</td></tr><tr><td>5</td><td>1,350 gp</td><td>6th:1, 5th:1</td><td>6th:2, 5th:2, 4th:2</td><td>730 gp</td><td>180 gp</td></tr><tr><td>6</td><td>2,000 gp</td><td>7th:1, 6th:1</td><td>7th:2, 6th:2, 5th:2</td><td>1,110 gp</td><td>275 gp</td></tr><tr><td>7</td><td>2,900 gp</td><td>8th:1, 7th:1</td><td>8th:2, 7th:2, 6th:2</td><td>1,580 gp</td><td>400 gp</td></tr><tr><td>8</td><td>4,000 gp</td><td>9th:1, 8th:1</td><td>9th:2, 8th:2, 7th:2</td><td>2,200 gp</td><td>550 gp</td></tr><tr><td>9</td><td>5,700 gp</td><td>10th:1, 9th:1</td><td>10th:2, 9th:2, 8th:2</td><td>3,100 gp</td><td>775 gp</td></tr><tr><td>10</td><td>8,000 gp</td><td>11th:1, 10th:1</td><td>11th:2, 10th:2, 9th:2</td><td>4,400 gp</td><td>1,100 gp</td></tr><tr><td>11</td><td>11,500 gp</td><td>12th:1, 11th:1</td><td>12th:2, 11th:2, 10th:2</td><td>6,200 gp</td><td>1,550 gp</td></tr><tr><td>12</td><td>16,500 gp</td><td>13th:1, 12th:1</td><td>13th:2, 12th:2, 11th:2</td><td>9,000 gp</td><td>2,250 gp</td></tr><tr><td>13</td><td>25,000 gp</td><td>14th:1, 13th:1</td><td>14th:2, 13th:2, 12th:2</td><td>13,500 gp</td><td>3,375 gp</td></tr><tr><td>14</td><td>36,500 gp</td><td>15th:1, 14th:1</td><td>15th:2, 14th:2, 13th:2</td><td>20,000 gp</td><td>5,000 gp</td></tr><tr><td>15</td><td>54,500 gp</td><td>16th:1, 15th:1</td><td>16th:2, 15th:2, 14th:2</td><td>29,500 gp</td><td>7,375 gp</td></tr><tr><td>16</td><td>82,500 gp</td><td>17th:1, 16th:1</td><td>17th:2, 16th:2, 15th:2</td><td>45,000 gp</td><td>10,250 gp</td></tr><tr><td>17</td><td>128,000 gp</td><td>18th:1, 17th:1</td><td>18th:2, 17th:2, 16th:2</td><td>69,000 gp</td><td>17,250 gp</td></tr><tr><td>18</td><td>208,000 gp</td><td>19th:1, 18th:1</td><td>19th:2, 18th:2, 17th:2</td><td>112,000 gp</td><td>28,000 gp</td></tr><tr><td>19</td><td>355,000 gp</td><td>20th:1, 19th:1</td><td>20th:2, 19th:2, 18th:2</td><td>190,000 gp</td><td>47,500 gp</td></tr><tr><td>20</td><td>490,000 gp</td><td>20th:2</td><td>20th:4, 19th:2</td><td>280,000 gp</td><td>70,000 gp</td></tr></table>` },
  { name: "Monster Parts: Table 1C — Party Treasure by Level (Full)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Lvl</td><td>Total</td><td>Monster Parts</td><td>Per extra PC</td></tr><tr><td>1</td><td>175 gp</td><td>175 gp</td><td>45 gp</td></tr><tr><td>2</td><td>300 gp</td><td>300 gp</td><td>75 gp</td></tr><tr><td>3</td><td>500 gp</td><td>500 gp</td><td>125 gp</td></tr><tr><td>4</td><td>860 gp</td><td>860 gp</td><td>215 gp</td></tr><tr><td>5</td><td>1,350 gp</td><td>1,350 gp</td><td>340 gp</td></tr><tr><td>6</td><td>2,000 gp</td><td>2,000 gp</td><td>500 gp</td></tr><tr><td>7</td><td>2,900 gp</td><td>2,900 gp</td><td>725 gp</td></tr><tr><td>8</td><td>4,000 gp</td><td>4,000 gp</td><td>1,000 gp</td></tr><tr><td>9</td><td>5,700 gp</td><td>5,700 gp</td><td>1,425 gp</td></tr><tr><td>10</td><td>8,000 gp</td><td>8,000 gp</td><td>2,000 gp</td></tr><tr><td>11</td><td>11,500 gp</td><td>11,500 gp</td><td>2,875 gp</td></tr><tr><td>12</td><td>16,500 gp</td><td>16,500 gp</td><td>4,125 gp</td></tr><tr><td>13</td><td>25,000 gp</td><td>25,000 gp</td><td>6,250 gp</td></tr><tr><td>14</td><td>36,500 gp</td><td>36,500 gp</td><td>9,125 gp</td></tr><tr><td>15</td><td>54,500 gp</td><td>54,500 gp</td><td>13,625 gp</td></tr><tr><td>16</td><td>82,500 gp</td><td>82,500 gp</td><td>20,625 gp</td></tr><tr><td>17</td><td>128,000 gp</td><td>128,000 gp</td><td>32,000 gp</td></tr><tr><td>18</td><td>208,000 gp</td><td>208,000 gp</td><td>52,000 gp</td></tr><tr><td>19</td><td>355,000 gp</td><td>355,000 gp</td><td>88,750 gp</td></tr><tr><td>20</td><td>490,000 gp</td><td>490,000 gp</td><td>122,500 gp</td></tr></table>` },
  { name: "Monster Parts: Table 2 — Monster Parts Gained per Monster (by creature level)", source: MONSTER_PARTS_SOURCE, text: `Use ~640 XP of part-granting monsters per level (or ~800 XP in Full to skip Extra Treasure). Tables 1A–1C are more accurate over a whole level; Table 2 is faster per encounter.

<table><tr><td>Creature Lvl</td><td>2A Light</td><td>2B Hybrid</td><td>2C Full</td></tr><tr><td>-1</td><td>1.5 gp</td><td>3.5 gp</td><td>6.5 gp</td></tr><tr><td>0</td><td>2.25 gp</td><td>5 gp</td><td>9 gp</td></tr><tr><td>1</td><td>3.5 gp</td><td>7 gp</td><td>13 gp</td></tr><tr><td>2</td><td>5 gp</td><td>12 gp</td><td>22 gp</td></tr><tr><td>3</td><td>7 gp</td><td>18 gp</td><td>30 gp</td></tr><tr><td>4</td><td>12 gp</td><td>27 gp</td><td>50 gp</td></tr><tr><td>5</td><td>18 gp</td><td>45 gp</td><td>80 gp</td></tr><tr><td>6</td><td>30 gp</td><td>65 gp</td><td>125 gp</td></tr><tr><td>7</td><td>45 gp</td><td>100 gp</td><td>180 gp</td></tr><tr><td>8</td><td>64 gp</td><td>140 gp</td><td>250 gp</td></tr><tr><td>9</td><td>90 gp</td><td>200 gp</td><td>360 gp</td></tr><tr><td>10</td><td>125 gp</td><td>275 gp</td><td>500 gp</td></tr><tr><td>11</td><td>175 gp</td><td>390 gp</td><td>720 gp</td></tr><tr><td>12</td><td>250 gp</td><td>560 gp</td><td>1,030 gp</td></tr><tr><td>13</td><td>375 gp</td><td>840 gp</td><td>1,560 gp</td></tr><tr><td>14</td><td>560 gp</td><td>1,250 gp</td><td>2,300 gp</td></tr><tr><td>15</td><td>810 gp</td><td>1,850 gp</td><td>3,400 gp</td></tr><tr><td>16</td><td>1,250 gp</td><td>2,800 gp</td><td>5,150 gp</td></tr><tr><td>17</td><td>1,875 gp</td><td>4,300 gp</td><td>8,000 gp</td></tr><tr><td>18</td><td>3,000 gp</td><td>7,000 gp</td><td>13,000 gp</td></tr><tr><td>19</td><td>5,000 gp</td><td>12,000 gp</td><td>22,500 gp</td></tr><tr><td>20</td><td>8,750 gp</td><td>17,500 gp</td><td>30,000 gp</td></tr><tr><td>21</td><td>10,000 gp</td><td>24,000 gp</td><td>45,000 gp</td></tr><tr><td>22</td><td>17,500 gp</td><td>35,000 gp</td><td>60,000 gp</td></tr><tr><td>23</td><td>20,000 gp</td><td>48,000 gp</td><td>90,000 gp</td></tr><tr><td>24</td><td>35,000 gp</td><td>70,000 gp</td><td>120,000 gp</td></tr><tr><td>25</td><td>40,000 gp</td><td>96,000 gp</td><td>180,000 gp</td></tr></table>` },
  { name: "Monster Parts: Table 3 — Refinement / Imbuing cost by item level", source: MONSTER_PARTS_SOURCE, text: `(Tables 3A & 5A use the Weapons/Armor column; Tables 3B & 5B use the Shields/Perception/Skill column.)

<table><tr><td>Item Lvl</td><td>Weapons & Armor</td><td>Shields / Perception / Skill</td></tr><tr><td>1</td><td>20 gp</td><td>10 gp</td></tr><tr><td>2</td><td>35 gp</td><td>20 gp</td></tr><tr><td>3</td><td>60 gp</td><td>35 gp</td></tr><tr><td>4</td><td>100 gp</td><td>60 gp</td></tr><tr><td>5</td><td>160 gp</td><td>100 gp</td></tr><tr><td>6</td><td>250 gp</td><td>160 gp</td></tr><tr><td>7</td><td>360 gp</td><td>240 gp</td></tr><tr><td>8</td><td>500 gp</td><td>340 gp</td></tr><tr><td>9</td><td>700 gp</td><td>470 gp</td></tr><tr><td>10</td><td>1,000 gp</td><td>670 gp</td></tr><tr><td>11</td><td>1,400 gp</td><td>950 gp</td></tr><tr><td>12</td><td>2,000 gp</td><td>1,350 gp</td></tr><tr><td>13</td><td>3,000 gp</td><td>2,000 gp</td></tr><tr><td>14</td><td>4,500 gp</td><td>3,000 gp</td></tr><tr><td>15</td><td>6,500 gp</td><td>4,300 gp</td></tr><tr><td>16</td><td>10,000 gp</td><td>6,500 gp</td></tr><tr><td>17</td><td>15,000 gp</td><td>10,000 gp</td></tr><tr><td>18</td><td>24,000 gp</td><td>16,000 gp</td></tr><tr><td>19</td><td>40,000 gp</td><td>25,000 gp</td></tr><tr><td>20</td><td>70,000 gp</td><td>45,000 gp</td></tr></table>` },
  { name: "Monster Parts: Table 4A — Refinement Benefits (Weapon)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Item Lvl</td><td>Benefit</td></tr><tr><td>2</td><td>item bonus to attack rolls +1, imbuing (1)</td></tr><tr><td>4</td><td>2 damage dice (striking)</td></tr><tr><td>10</td><td>item bonus to attack rolls +2, imbuing (2)</td></tr><tr><td>12</td><td>3 damage dice (greater striking)</td></tr><tr><td>16</td><td>item bonus to attack rolls +3, imbuing (3)</td></tr><tr><td>19</td><td>4 damage dice (major striking)</td></tr></table>

(Applies to weapons and to handwraps of mighty blows.)` },
  { name: "Monster Parts: Table 4B — Refinement Benefits (Armor)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Item Lvl</td><td>Benefit</td></tr><tr><td>5</td><td>item bonus to AC +1, imbuing (1)</td></tr><tr><td>8</td><td>item bonus to saves +1 (resilient)</td></tr><tr><td>11</td><td>item bonus to AC +2, imbuing (2)</td></tr><tr><td>14</td><td>item bonus to saves +2 (greater resilient)</td></tr><tr><td>18</td><td>item bonus to AC +3, imbuing (3)</td></tr><tr><td>20</td><td>item bonus to saves +3 (major resilient)</td></tr></table>

(Refined armor and explorer's clothing gain the invested trait.)` },
  { name: "Monster Parts: Table 4C — Refinement Benefits (Shield)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Item Lvl</td><td>Hardness / HP / BT</td><td>Other</td></tr><tr><td>3</td><td>5 / 30 / 15</td><td></td></tr><tr><td>4</td><td></td><td>imbuing</td></tr><tr><td>5</td><td>6 / 36 / 18</td><td></td></tr><tr><td>7</td><td>7 / 42 / 21</td><td></td></tr><tr><td>8</td><td>8 / 48 / 24</td><td></td></tr><tr><td>9</td><td>9 / 54 / 27</td><td></td></tr><tr><td>10</td><td>10 / 60 / 30</td><td></td></tr><tr><td>12</td><td>11 / 66 / 33</td><td></td></tr><tr><td>13</td><td>12 / 72 / 36</td><td></td></tr><tr><td>15</td><td>13 / 78 / 39</td><td></td></tr><tr><td>16</td><td>14 / 84 / 42</td><td></td></tr><tr><td>17</td><td>15 / 90 / 45</td><td></td></tr><tr><td>18</td><td>16 / 96 / 48</td><td></td></tr><tr><td>19</td><td>17 / 102 / 51</td><td></td></tr><tr><td>20</td><td>18 / 108 / 54</td><td></td></tr></table>

(Buckler: reduce Hardness by 2, HP by 12, BT by 6. Tower shields can't be refined this way. A refined shield uses steel-shield statistics by default and, being non-metal, bypasses a druid's metal restriction — GMs who dislike that may use buckler Hardness/HP/BT for druids.)` },
  { name: "Monster Parts: Table 4D — Refinement Benefits (Perception Item)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Item Lvl</td><td>Benefit</td></tr><tr><td>3</td><td>item bonus to Perception +1, imbuing</td></tr><tr><td>9</td><td>item bonus to Perception +2</td></tr><tr><td>17</td><td>item bonus to Perception +3</td></tr></table>

(Worn, invested.)` },
  { name: "Monster Parts: Table 4E — Refinement Benefits (Skill Item)", source: MONSTER_PARTS_SOURCE, text: `<table><tr><td>Item Lvl</td><td>Benefit</td></tr><tr><td>3</td><td>item bonus to skill +1, imbuing</td></tr><tr><td>9</td><td>item bonus to skill +2</td></tr><tr><td>17</td><td>item bonus to skill +3</td></tr></table>

(Worn, invested.)` },
  { name: "Monster Parts: Table 5 — Imbuing cost by item level", source: MONSTER_PARTS_SOURCE, text: `Identical to Table 3: use the Weapons/Armor column (5A) or the Shields/Perception/Skill column (5B).` },
  { name: "Monster Parts: Refining details by item type", source: MONSTER_PARTS_SOURCE, text: `• Weapons (or handwraps of mighty blows): parts from a monster with an unarmed attack matching the weapon's physical damage type (bludgeoning, piercing, or slashing). A versatile or modular weapon accepts parts matching any of its types.
• Armor / explorer's clothing: parts with suitable material — hair/fiber/silk for cloth & padded, skin for leather/hide, bone/horn/chitin for "metal" armors. Oozes and the like don't qualify. Refined armor has the invested trait.
• Shields: parts from a monster with Hardness or resistance to physical damage (or one physical type). Uses steel-shield stats by default.
• Perception items: parts from a monster with a special sense other than low-light vision. Worn, invested.
• Skill items: parts from a monster that has the matching skill in its stat block. Worn, invested.

Refining & imbuing vs. runes. An item is built and upgraded either with this system or with the normal rules for magic items (precious materials, fundamental runes, property runes) — never both at once.

Salvaging & transferring. Salvaging an item recovers parts worth up to 50% of its refinement + imbued value. You can transfer a refinement value or one imbued property to another item of the same type (with compatible part requirements) by spending parts equal to 10% of the difference in values, then swapping the values.

Example of refining. A 7th-level fighter has 275 gp of tyrannosaurus parts (Hybrid variant). A tyrannosaurus lacks a slashing attack, but a longsword has the versatile P trait, so its piercing teeth qualify. They spend 1 gp to build the tyrannosaurus-tooth longsword (0), then put 250 gp into refining it to item level 6 — gaining a +1 item bonus to attack, a second damage die, and one imbuing slot: a +1 striking longsword (6) — with 24 gp of parts left, which they add toward level 7.` },
  { name: "Monster Parts: Imbuing details", source: MONSTER_PARTS_SOURCE, text: `Imbuing mirrors refining: add parts that meet the property's requirement, tracking each property's value separately. Properties level up at the Table 5 thresholds; benefits are cumulative. An imbued property can't exceed the item's level or your level, whichever is lower.

Where a property grants a spell, the item gains a command and Interact activation with the same number of actions as the spell, casting that spell. The item's DC is based on its item level (Magic Item DCs table, GM Core); its spell attack modifier is DC − 10.

Weapon properties often have three paths — magic (thematic spells), might (direct damage), technique (special effects / damage over time). If a weapon can hold multiple imbued properties, you can apply the same property more than once as long as each use takes a different path; their effects stack. To use an activated ability of a held item, you must be wielding it.

Example of imbuing. Continuing the fighter above: after refining, they imbue their level-6 longsword with fire, choosing the might path, using 250 gp of magma-scorpion parts (the scorpions have the fire trait and deal fire damage). At the current cap of level 6 the weapon deals 1d6 additional fire damage — a +1 striking fire might (6) tyrannosaurus-tooth longsword (6).` },
  { name: "Monster Parts: Imbued Properties", source: MONSTER_PARTS_SOURCE, text: `Format: Type / Parts / Effect, then each Path with its level entries. All effects are cumulative. Spells are cast at the item's level where a rank is given; cantrips heighten to half the item's level rounded up.` },
  { name: "Monster Parts: Acid", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the acid trait or an attack/spell dealing acid damage · Effect you imbue the weapon with vitriolic acid.

Path Magic (choose arcane or primal when first imbued)

• 2nd cast Caustic Blast as a cantrip
• 4th cast acidic burst once/day
• 6th acidic burst heightens to 2nd; cast either Acid Grip or acidic burst once/day, not both
• 8th acidic burst heightens to 3rd; cast Acid Grip and acidic burst each once/day
• 10th Strikes deal 1 additional acid damage
• 12th Acid Grip heightens to 4th; cast acid storm once/day
• 14th additional acid damage → 1d4
• 16th Acid Grip heightens to 6th, acid storm to 7th
• 18th additional acid damage → 1d6
• 20th cast storm of vengeance once/day, choosing only the acid-rain effect (you may choose it twice in a row)

Path Might

• 4th 1 additional acid damage
• 6th → 1d4
• 8th → 1d6; on a crit the target's armor takes 3d6 acid (before Hardness), or its raised shield takes it instead
• 12th the acid damage ignores resistances
• 14th crit armor/shield damage → 6d6
• 18th → 1d8
• 20th before applying acid, the target gains weakness 1 to acid until the start of your next turn

Path Technique

• 4th 1 persistent acid damage
• 6th 1 additional acid damage
• 8th persistent → 1d6; crit armor/shield 3d6
• 12th the acid damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th each time a foe (or its armor/shield) takes this persistent acid at end of turn, its resistances and Hardness drop by 1 for 1 minute (cumulative)
• 18th persistent → 1d10
• 20th on a crit, the target is drained 1` },
  { name: "Monster Parts: Bane", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster is of the chosen bane type (or, at GM discretion, anathematic to it — e.g. celestial parts for a fiend-bane) · Effect choose a creature type: aberration, animal, astral, beast, celestial, construct, dragon, dream, elemental, ethereal, fey, fiend, giant, monitor, ooze, spirit, time, undead, or both fungus and plant.

Path Might

• 2nd 1 additional damage of the weapon's base type vs the bane type
• 4th → 1d4
• 6th → 1d6; crit enfeebles the bane creature 1 until the end of your next turn
• 10th vs the bane type, the base damage ignores the first 5 points of resistance
• 14th crit: the bane creature attempts a Fortitude save — crit success enfeebled 1, success enfeebled 2, failure enfeebled 3, crit failure destroyed (incapacitation)
• 16th additional damage → 1d8
• 20th → 1d10

Path Technique

• 2nd Strikes deal 1 persistent bleed vs the bane type
• 4th 1 additional base-type damage vs the bane type
• 6th persistent bleed → 1d6; crit enfeebles 1 until the end of your next turn
• 10th vs the bane type, base damage and this bleed ignore the first 5 points of resistance
• 12th persistent bleed → 1d8
• 14th crit: enfeebled 2; Fortitude save — failure enfeebled 3, crit failure destroyed (incapacitation)
• 16th persistent bleed → 1d10
• 20th the crit enfeebled condition lasts as long as the persistent bleed (or the end of your next turn, whichever is longer)` },
  { name: "Monster Parts: Chaotic", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the unholy trait or an attack/spell dealing spirit damage · Effect you imbue the weapon with roiling chaos to unmake order. It functions exactly like the Unholy property — the weapon gains the unholy trait, deals spirit damage, and uses Unholy's Magic, Might, and Technique paths and level entries — themed around raw chaos; every rider that triggers "vs. a holy creature" applies to your lawful, order-bound foes. (A holy creature that wields it is enfeebled and can't gain its benefits.)` },
  { name: "Monster Parts: Charisma", source: MONSTER_PARTS_SOURCE, text: `Type skill item (Charisma-based skill) · Parts the creature has Charisma as its highest or second-highest attribute modifier · Effect dazzling charisma.

• 8th cast heroism once/day (occult)
• 14th heroism heightens to 6th
• 17th on investing, increase your Charisma modifier by 1 or to +4 (whichever is higher); gains the apex trait
• 20th heroism heightens to 9th` },
  { name: "Monster Parts: Cold", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the cold trait or an attack/spell dealing cold damage · Effect chilling cold.

Path Magic (arcane or primal)

• 2nd cast Frostbite as a cantrip
• 4th cast chilling spray once/day
• 6th chilling spray heightens to 2nd
• 8th 1 additional cold damage
• 10th cast ice storm once/day
• 12th chilling spray heightens to 3rd; cast cone of cold once/day
• 14th additional cold → 1d4
• 16th chilling spray, cone of cold, ice storm heighten to 6th
• 18th → 1d6
• 20th cast 9th-rank polar ray once/day

Path Might

• 4th 1 additional cold damage
• 6th → 1d4
• 8th → 1d6; crit also slows 1 until the end of your next turn (Fortitude negates)
• 12th the cold damage ignores resistances
• 14th crit also imposes a −10-foot status penalty to Speeds for 1 round
• 18th → 1d8
• 20th before applying cold, the target gains weakness 1 to cold until the start of your next turn

Path Technique

• 4th 1 persistent cold damage
• 6th on a hit, the target takes a −5-foot status penalty to Speeds for 1 round
• 8th crit slows 1 (Fortitude negates); the Speed penalty increases to −10
• 12th the persistent cold ignores resistances
• 14th the Speed penalty lasts as long as the persistent cold
• 16th a foe adjacent to a surface who crit-fails the slow save freezes there (immobilized until it Escapes vs. the item DC)
• 18th persistent → 1d4
• 20th the Speed penalty increases to −15` },
  { name: "Monster Parts: Constitution", source: MONSTER_PARTS_SOURCE, text: `Type skill item · Parts the creature has Constitution as its highest or second-highest attribute modifier · Effect resilient constitution.

• 8th cast 3rd-rank heal (on you only) once/day (divine)
• 14th heal heightens to 6th
• 17th on investing, increase your Constitution modifier by 1 or to +4 (whichever is higher); gains the apex trait
• 18th heal heightens to 7th, or instead cast regenerate on yourself once/day
• 20th resting for 10 minutes recovers 100 Hit Points` },
  { name: "Monster Parts: Dexterity", source: MONSTER_PARTS_SOURCE, text: `Type skill item (Dexterity-based skill) · Parts the creature has Dexterity as its highest or second-highest attribute modifier · Effect deft dexterity.

• 8th once/day, a single-action Interact grants a +10-foot status bonus to all Speeds for 10 minutes
• 14th the bonus → +20 feet, and you gain water walk while active
• 17th on investing, increase your Dexterity modifier by 1 or to +4 (whichever is higher); gains the apex trait
• 20th the bonus → +30 feet, and you gain both air walk and water walk while active` },
  { name: "Monster Parts: Electricity", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the electricity trait or an attack/spell dealing electricity damage · Effect shocking electricity.

Path Magic (arcane or primal)

• 2nd cast electric arc as a cantrip
• 4th cast shocking grasp once/day
• 6th shocking grasp heightens to 2nd
• 8th cast lightning bolt once/day
• 10th 1 additional electricity damage
• 12th lightning bolt heightens to 4th; cast lightning storm once/day
• 14th → 1d4
• 16th cast chain lightning (no longer lightning bolt); shocking grasp and lightning storm heighten to 6th
• 18th → 1d6
• 20th chain lightning heightens to 9th; lightning storm and shocking grasp to 7th

Path Might

• 4th 1 additional electricity damage
• 6th → 1d4
• 8th → 1d6; crit arcs equal electricity to up to two creatures within 10 feet
• 12th the electricity damage ignores resistances
• 14th the arc reaches up to 20 feet
• 18th → 1d8
• 20th before applying electricity, the target gains weakness 1 to electricity until the start of your next turn

Path Technique

• 4th 1 persistent electricity damage
• 6th 1 additional electricity damage
• 8th persistent → 1d6; crit arcs equal damage + persistent to up to two creatures within 10 feet
• 12th the electricity damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th crit arc reaches up to four creatures within 20 feet
• 18th persistent → 1d10
• 20th foes with this persistent electricity are magnetized: metal-weapon Strikes gain a +1 circumstance bonus to hit them while it lasts` },
  { name: "Monster Parts: Energy Resistant", source: MONSTER_PARTS_SOURCE, text: `Type armor or shield · Parts the monster has resistance or immunity to the chosen energy type · Effect choose acid, cold, electricity, fire, force, void, vitality, or sonic. While worn/wielded, you and the item gain resistance to that type equal to this property's level; a shield may Shield Block against that type in addition to its normal trigger. You can imbue armor with this property multiple times (a different type each, each counting against the imbuing limit).` },
  { name: "Monster Parts: Fire", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the fire trait or an attack/spell dealing fire damage · Effect burning fire.

Path Magic (arcane or primal)

• 2nd cast Ignition as a cantrip
• 4th cast Breathe Fire once/day
• 6th Breathe Fire heightens to 2nd
• 8th cast Floating Flame and fireball each once/day (no longer Breathe Fire)
• 10th 1 additional fire damage
• 12th fireball and Floating Flame heighten to 4th; cast wall of fire once/day
• 14th → 1d4
• 16th fireball, Floating Flame, wall of fire heighten to 6th
• 18th → 1d6
• 20th cast Falling Stars once/day

Path Might

• 4th 1 additional fire damage
• 6th → 1d4
• 8th → 1d6; crit deals 1d10 persistent fire
• 12th the fire damage (incl. persistent) ignores resistances
• 14th crit persistent → 2d10
• 18th → 1d8
• 20th before applying fire, the target gains weakness 1 to fire until the start of your next turn

Path Technique

• 4th 1 persistent fire damage
• 6th 1 additional fire damage
• 8th persistent → 1d6; crit deals an extra 1d10 persistent fire (added after doubling)
• 12th the fire damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th foes taking this persistent fire are off-guard
• 18th persistent → 1d10
• 20th at the end of a burning foe's turn, all foes adjacent to it also catch fire, taking the same persistent fire` },
  { name: "Monster Parts: Force", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the force trait or an attack/spell dealing force damage · Effect pure force.

Path Magic (arcane, divine, or occult)

• 2nd cast shield as a cantrip
• 4th cast Force Barrage once/day
• 6th cast either Force Barrage or Spiritual Armament once/day, not both
• 8th Force Barrage heightens to 3rd; cast both Force Barrage and Spiritual Armament once/day
• 10th 1 additional force damage
• 12th Spiritual Armament heightens to 4th; cast spiritual guardian once/day
• 14th → 1d4
• 16th Force Barrage heightens to 5th, spiritual guardian to 6th; cast spirit blast once/day (no longer Spiritual Armament)
• 18th → 1d6
• 20th cast 9th-rank spirit song once/day

Path Might

• 4th 1 additional force damage
• 6th → 1d4
• 8th → 1d6
• 10th crit: Fortitude save or the target is pushed 5 feet away from you
• 12th the force damage ignores resistances
• 16th crit + failed save pushes 10 feet
• 18th → 1d8
• 20th before applying force, the target gains weakness 1 to force until the start of your next turn

Path Technique

• 4th 1 persistent force damage
• 6th 1 additional force damage
• 8th crit: Fortitude save or the target is pushed 5 feet away from you
• 10th persistent → 1d6
• 12th the force damage (incl. persistent) ignores resistances
• 14th crit + failed save pushes up to 10 feet
• 16th foes with this persistent force are off-guard
• 18th crit + failed save pushes up to 20 feet
• 20th at the end of a foe's turn, if it fails to remove the persistent force it must succeed at a Fortitude save or fall prone` },
  { name: "Monster Parts: Fortification", source: MONSTER_PARTS_SOURCE, text: `Type armor (medium or heavy) · Parts the monster has resistance or immunity to precision damage or critical hits · Effect thickens the armor (+1 Bulk, +2 to the Strength required to reduce its penalties). From 6th level, when you're critically hit, attempt a DC 20 flat check to make it a normal hit; the DC drops by 1 at 8th level and every 2 levels thereafter (minimum DC 13 at 20th).` },
  { name: "Monster Parts: Holy", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the holy trait or an attack/spell dealing spirit damage · Effect radiant, sanctified energy to defeat unholy foes. The weapon gains the holy trait. (An unholy creature that wields it is enfeebled and can't gain its benefits.)

Path Magic (always divine; castings gain the holy trait)

• 2nd cast divine lance as a cantrip (it deals spirit damage, holy)
• 4th cast protection once/day, choosing the unholy trait for the increased bonus
• 8th cast Holy Light once/day
• 10th cast divine wrath once/day (as a holy spell)
• 12th 1 additional spirit damage
• 14th → 1d4
• 16th cast divine decree (holy); divine wrath heightens to 5th
• 18th → 1d6
• 20th cast divine aura (holy); divine decree heightens to 8th, divine wrath to 7th

Path Might

• 6th 1 additional spirit damage
• 8th → 1d4
• 10th → 1d6
• 12th crit vs. an unholy creature: it takes a −2 status penalty to attacks against creatures other than you (until the end of your next turn)
• 14th the spirit damage ignores resistances
• 18th → 1d8
• 20th before applying spirit, an unholy target gains weakness 1 to spirit until the start of your next turn

Path Technique

• 6th 1 additional spirit damage
• 8th 1 persistent spirit damage
• 10th persistent → 1d6
• 12th crit vs. an unholy creature: it takes a −1 status penalty to attacks against creatures other than you
• 14th the spirit damage (incl. persistent) ignores resistances
• 16th crit vs. an unholy creature: if it attacks/damages another creature before the end of your next turn, it's off-guard to your imbued-weapon attacks until the end of your next turn
• 18th persistent → 1d10
• 20th each time an unholy creature attacks/damages another creature, it takes the 1d10 persistent spirit and immediately attempts its end-of-turn flat check` },
  { name: "Monster Parts: Intelligence", source: MONSTER_PARTS_SOURCE, text: `Type skill item (Intelligence-based skill) · Parts the creature has Intelligence as its highest or second-highest attribute modifier · Effect brilliant intelligence.

• 8th cast hypercognition once/day (occult)
• 14th hypercognition once/hour instead
• 17th on investing, increase your Intelligence modifier by 1 or to +4 (whichever is higher); gains the apex trait
• 20th hypercognition once/minute instead` },
  { name: "Monster Parts: Lawful", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the holy trait or an attack/spell dealing spirit damage · Effect you imbue the weapon with rigid law to crush disorder. It functions exactly like the Holy property — the weapon gains the holy trait, deals spirit damage, and uses Holy's Magic, Might, and Technique paths and level entries — themed around implacable order; every rider that triggers "vs. an unholy creature" applies to your chaotic foes. (An unholy creature that wields it is enfeebled and can't gain its benefits.)` },
  { name: "Monster Parts: Mental", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the astral or mental trait or an attack/spell dealing mental damage · Effect psychic power.

Path Magic (arcane or occult)

• 2nd cast daze as a cantrip
• 4th cast phantom pain once/day
• 6th phantom pain heightens to 2nd; cast either phantom pain or warrior's regret once/day, not both
• 8th both heighten to 3rd; cast both once/day
• 10th 1 additional mental damage
• 12th both heighten to 4th; cast Vision of Death once/day
• 14th → 1d4
• 16th phantom pain and Vision of Death heighten to 6th; cast phantasmal calamity once/day (no longer warrior's regret)
• 18th → 1d6
• 20th cast Phantasmagoria once/day

Path Might

• 4th 1 additional mental damage
• 6th → 1d4
• 8th → 1d6
• 10th crit: stupefied 1 for 1 round
• 12th the mental damage ignores resistances
• 16th crit: stupefied 2 for 1 round
• 18th → 1d8
• 20th before applying mental, the target gains weakness 1 to mental until the start of your next turn

Path Technique

• 4th 1 persistent mental damage
• 6th 1 additional mental damage
• 8th crit: stupefied 1 for 1 round
• 10th persistent → 1d6
• 12th the mental damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th crit: stupefied 2 for 1 round
• 18th persistent → 1d10
• 20th while the foe has this persistent mental, the crit stupefied lasts until the persistent damage ends or 1 round, whichever is longer` },
  { name: "Monster Parts: Poison", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the poison trait or an attack/spell dealing poison damage · Effect toxic venom.

Path Magic (arcane or primal)

• 2nd cast puff of poison as a cantrip
• 4th cast spider sting once/day
• 6th cast 2nd-rank noxious vapors or spider sting once/day, not both
• 8th noxious vapors heightens to 3rd; cast noxious vapors, imp sting, and spider sting each once/day
• 10th 1 additional poison damage
• 12th noxious vapors heightens to 4th; cast swarming wasp stings once/day
• 14th → 1d4
• 16th noxious vapors heightens to 6th; cast purple worm sting once/day
• 18th → 1d6
• 20th cast linnorm sting once/day

Path Might

• 4th 1 additional poison damage
• 6th → 1d4
• 8th → 1d6; crit deals 1d10 persistent poison
• 12th the poison damage ignores resistances
• 14th crit persistent → 2d10
• 18th → 1d8
• 20th before applying poison, the target gains weakness 1 to poison until the start of your next turn

Path Technique

• 4th 1 persistent poison damage
• 6th 1 additional poison damage
• 8th persistent → 1d6; crit deals an extra 1d10 persistent poison (added after doubling)
• 12th the poison damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th at the end of a creature's turn that still has this persistent poison, choose clumsy, enfeebled, or stupefied — it gains/increases that condition by 1 (max 3); removing the poison ends it
• 18th persistent → 1d10
• 20th on a crit, the target is drained 1` },
  { name: "Monster Parts: Sensory", source: MONSTER_PARTS_SOURCE, text: `Type Perception item · Parts the creature has the next sense to be granted — low-light vision (lvls 1–6), darkvision (6–12), scent (12–16), greater darkvision (16–18), truesight (18–20) · Effect extraordinary senses.

• 4th once/day, a two-action envision activation grants low-light vision for 1 hour
• 6th while invested, gain low-light vision
• 8th once/day, a two-action envision grants darkvision for 1 hour
• 12th while invested, gain darkvision
• 14th once/day, a two-action envision grants 30-foot imprecise scent for 1 hour
• 16th while invested, gain 30-foot imprecise scent
• 18th while invested, gain greater darkvision
• 20th while invested, constantly gain the effects of 6th-rank Truesight` },
  { name: "Monster Parts: Sonic", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the sonic trait or an attack/spell dealing sonic damage · Effect reverberating sound waves.

Path Might

• 4th 1 additional sonic damage
• 6th → 1d4
• 8th → 1d6; crit: Fortitude save or deafened 1 minute (1 hour on a crit failure)
• 12th the sonic damage ignores resistances
• 14th the deafness is permanent on a failure or crit failure
• 18th → 1d8
• 20th before applying sonic, the target gains weakness 1 to sonic until the start of your next turn

Path Technique

• 4th 1 persistent sonic damage
• 6th 1 additional sonic damage
• 8th persistent → 1d6; crit: Fortitude save or deafened 1 minute (1 hour on a crit failure)
• 12th the sonic damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th deafness is permanent and the target is also stunned 1 on a failure or crit failure
• 18th persistent → 1d10
• 20th the sonic + persistent sonic create a boom hitting all creatures adjacent to the target whose AC ≤ your attack roll; on a crit they attempt the Fortitude save vs. deafened + stunned` },
  { name: "Monster Parts: Spell", source: MONSTER_PARTS_SOURCE, text: `Type skill item · Parts the creature has the matching skill or can cast the chosen spell · Effect imbue the item with a spell. Use a suggested spell or work with the GM (avoid long-lasting buffs like Mystic Armor and self-only spells like Sure Strike). Pick a tradition that can cast it. At 4th level you can imbue a 1st-rank spell; every 2 levels thereafter the cap rises by one rank (a kept spell heightens to the new cap).

Suggested spells: Acrobatics Soft Landing · Arcana Force Barrage · Athletics jump · Crafting mending · Deception illusory disguise · Diplomacy charm · Intimidation fear · Lore share lore (matching Lore only) · Medicine heal · Nature summon plant or fungus · Occultism object reading · Performance enthrall · Religion bless · Society mindlink · Stealth invisibility · Survival Environmental Endurance · Thievery knock.` },
  { name: "Monster Parts: Strength", source: MONSTER_PARTS_SOURCE, text: `Type skill item (Athletics) · Parts the creature has Strength as its highest or second-highest attribute modifier · Effect ferocious strength.

• 8th cast earthbind once/day (primal)
• 14th earthbind once/hour instead
• 17th on investing, increase your Strength modifier by 1 or to +4 (whichever is higher); gains the apex trait
• 20th earthbind once/minute instead` },
  { name: "Monster Parts: Sturdy", source: MONSTER_PARTS_SOURCE, text: `Type shield · Parts the monster has Hardness or resistance to physical damage (or one physical type) · Effect while this property's level equals the shield's item level, increase the shield's Hardness by 3 (−1 per level the property is below the shield's level, minimum 0 at 3+ levels below). If Hardness rises by at least 1, also add +2 HP and +1 BT per point of added Hardness.` },
  { name: "Monster Parts: Unholy", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the unholy trait or an attack/spell dealing spirit damage · Effect profane, corrupt energy to defeat holy foes. The weapon gains the unholy trait. (A holy creature that wields it is enfeebled and can't gain its benefits.)

Path Magic (always divine; castings gain the unholy trait)

• 2nd cast divine lance as a cantrip (it deals spirit damage, unholy)
• 4th cast protection once/day, choosing the holy trait for the increased bonus
• 8th cast chilling darkness once/day
• 10th cast divine wrath once/day (as an unholy spell)
• 12th 1 additional spirit damage
• 14th → 1d4
• 16th cast divine decree (unholy); divine wrath heightens to 5th
• 18th → 1d6
• 20th cast divine aura (unholy); divine decree heightens to 8th, divine wrath to 7th

Path Might

• 6th 1 additional spirit damage
• 8th → 1d4
• 10th → 1d6
• 12th crit vs. a holy creature: deal 1d10 persistent bleed
• 14th the spirit damage ignores resistances
• 18th → 1d8
• 20th before applying spirit, a holy target gains weakness 1 to spirit until the start of your next turn

Path Technique

• 6th 1 additional spirit damage
• 8th 1 persistent spirit damage
• 10th persistent → 1d6
• 12th crit vs. a holy creature: it also takes 1d10 persistent bleed
• 14th the spirit damage (incl. persistent bleed and spirit) ignores resistances
• 16th crit vs. a holy creature: it becomes frightened 1
• 18th persistent → 1d10
• 20th while affected by this persistent spirit, a holy creature can't reduce its frightened value below 1 at the end of its turn` },
  { name: "Monster Parts: Vitality", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the holy trait or an attack/spell dealing vitality damage · Effect the cleansing power of vitality to damage undead. As normal, vitality damage only harms undead and other creatures with void healing (such as dhampirs).

Path Magic (choose divine or primal when first imbued)

• 2nd cast Vitality Lash as a cantrip
• 4th cast heal once/day
• 6th heal heightens to 2nd
• 8th cast 3rd-rank Infuse Vitality once/day
• 10th 1 additional vitality damage
• 12th heal heightens to 4th; cast breath of life once/day
• 14th → 1d4
• 16th cast regenerate once/day; Infuse Vitality and heal heighten to 5th
• 18th → 1d6
• 20th heal and regenerate heighten to 8th

Path Might

• 2nd 1 additional vitality damage
• 4th → 1d4
• 6th → 1d6; crit: the undead is enfeebled 1 until the end of your next turn
• 10th the vitality damage ignores resistances
• 14th crit: the undead attempts a Fortitude save — crit success enfeebled 1, success enfeebled 2, failure enfeebled 3, crit failure destroyed (incapacitation)
• 18th → 1d8
• 20th before applying vitality, the target gains weakness 1 to vitality until the start of your next turn

Path Technique

• 2nd 1 persistent vitality damage
• 4th 1 additional vitality damage
• 6th persistent → 1d6; crit enfeebles the undead 1 until the end of your next turn
• 10th the vitality damage (incl. persistent) ignores resistances
• 12th persistent → 1d8
• 14th crit: enfeebled 2; Fortitude save — failure enfeebled 3, crit failure destroyed (incapacitation)
• 18th persistent → 1d10
• 20th creatures with this persistent vitality struggle to heal from void energy: if a void effect would restore their Hit Points, they must first counteract this property (level 20, DC 43); even on a success the HP recovered is reduced by 1d10 (full amount on a critical success)` },
  { name: "Monster Parts: Void", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts the monster has the undead trait or void healing, or an attack/spell dealing void damage · Effect void energy, cosmological destruction.

Path Magic (divine or primal)

• 2nd cast Void Warp as a cantrip
• 4th cast harm once/day
• 6th harm heightens to 2nd; cast either harm or sudden blight once/day, not both
• 8th both heighten to 3rd; cast both once/day
• 10th 1 additional void damage
• 12th both heighten to 4th; cast enervation once/day
• 14th → 1d4
• 16th enervation and harm heighten to 6th; cast necrotize once/day (no longer sudden blight)
• 18th → 1d6
• 20th cast Wails of the Damned once/day

Path Might

• 4th 1 additional void damage
• 6th → 1d4
• 8th → 1d6
• 10th crit: enfeebled 1 for 1 round
• 12th the void damage ignores resistances
• 16th crit: enfeebled 2 for 1 round
• 18th → 1d8
• 20th before applying void, the target gains weakness 1 to void until the start of your next turn

Path Technique

• 4th 1 persistent void damage
• 6th 1 additional void damage
• 8th crit: enfeebled 1 for 1 round
• 10th persistent → 1d6
• 12th the void damage (incl. persistent) ignores resistances
• 14th persistent → 1d8
• 16th crit: enfeebled 2 for 1 round
• 18th persistent → 1d10
• 20th while the foe has this persistent void, the crit enfeebled lasts until the persistent damage ends or 1 round, whichever is longer` },
  { name: "Monster Parts: Wild", source: MONSTER_PARTS_SOURCE, text: `Type weapon · Parts none — use any parts · Effect a chaotic mix of energies, inconsistent and slightly weaker than a focused property.

Path Might

• 4th 1 additional damage; each time you deal it, roll 1d6 — 1 acid, 2 cold, 3 electricity, 4 fire, 5 void, 6 sonic
• 6th → 1d4
• 8th → 1d6
• 12th the damage ignores resistances
• 18th → 1d8
• 20th before applying the damage, the target gains weakness 1 to that damage type until the start of your next turn` },
  { name: "Monster Parts: Winged", source: MONSTER_PARTS_SOURCE, text: `Type armor · Parts the monster has a fly Speed · Effect wings protrude from the armor (choose arcane or primal when first imbued).

• 6th the armor casts Soft Landing on you automatically when you fall (can't retrigger for 1 hour)
• 8th the Soft Landing cooldown drops to 10 minutes
• 10th cast fly on you once/day
• 14th fly once/hour instead
• 16th you may cast 7th-rank fly instead of 4th-rank (then it can't be reused for 1 day instead of 1 hour)
• 18th you can fly constantly, with a Speed equal to your land Speed
• 20th cast 4th-rank fly on an ally once/hour` },
  { name: "Monster Parts: Wisdom", source: MONSTER_PARTS_SOURCE, text: `Type Perception item or skill item (Wisdom-based skill) · Parts the creature has Wisdom as its highest or second-highest attribute modifier · Effect sagacious wisdom.

• 8th cast augury once/day (divine)
• 14th augury takes only a single action to activate
• 17th on investing, increase your Wisdom modifier by 1 or to +4 (whichever is higher); gains the apex trait
• 20th you may cast foresight once/day instead of augury` },
  { name: "Monster Parts: Variant rules", source: MONSTER_PARTS_SOURCE, text: `Precious materials & refining. You can mimic a special material (e.g. dragonhide from dragon parts). A low-grade material item caps at item level 8, a standard-grade at 15; pay the price difference in appropriate parts to raise the grade.

Automatic Bonus Progression (GM Core). Replace refining with ABP for weapons and armor (you still imbue at the same levels on Tables 4A/4B). Consider an "automatic shield progression" of one refined shield per PC. Limit imbued skill/Perception items (or double their cost) so PCs don't gain six near-free spell items, and drop apex imbued properties (ABP already grants apex attribute bonuses).

Relics (GM Core). Keep refining, but replace imbuing with relic aspects and gifts.

Other items (Full variant). To allow items beyond the five categories (e.g. potions, talismans), decide what parts apply and let PCs refine the item by paying its Price in parts (never above their own level). Example: a lesser healing potion might require parts from a creature with fast healing or regeneration (like a troll), for 12 gp of parts.` },
]
