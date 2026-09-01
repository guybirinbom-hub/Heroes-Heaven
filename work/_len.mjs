const props = [
 ["starlit-eyes", "on a ranged Strike while in Arcane Cascade stance, against a concealed or hidden creature", "flat check DC is 3 instead of 5 (concealed) or 9 instead of 11 (hidden)"],
 ["starlit-eyes2", "when you cast Shooting Star and target a hidden creature", "no flat check to target the hidden creature"],
 ["cleft", "once per day, when you Activate Unexpected Strike after Striking an off-guard creature with a weapon", "1d6 precision damage"],
 ["cutting-rebuke", "when you spend a Mythic Point on the Diplomacy check for Bon Mot", "roll at mythic proficiency; on a success also deal mental damage equal to your level (doubled on a critical success)"],
 ["sacred-wilds", "to Make an Impression on a beast, fey, or kami", "+2 circumstance"],
 ["ankle1", "while prone, against ranged attacks", "you are always Taking Cover"],
 ["ankle2", "on your attack rolls while you are prone", "you ignore the status penalty for being prone"],
 ["kaiju1", "attacks made as part of your Overwhelming Combination, against a creature at least 2 sizes larger than you", "+4 circumstance (+6 if you have master proficiency with the weapon used)"],
 ["kaiju2", "against kaiju hazards", "+2 circumstance"],
 ["snare-expert", "when a snare you set requires a saving throw", "the save uses the higher of your class DC or the snare's DC"],
 ["thats-not-natural", "in a wilderness region, when an aberration, fey, mutant, undead or extraplanar creature rolls Stealth against you", "+1 circumstance to your Perception DC (not to your Perception checks)"],
];
for (const [id, when, bonus] of props) console.log(id, 'when='+when.length, 'bonus='+bonus.length);
