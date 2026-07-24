/*
 * Action availability gates tied to a class RESOURCE STATE. Some actions can only be used while a
 * signature resource is active — a barbarian's rage-trait actions require raging, a swashbuckler's
 * finishers require panache, a ranger's prey actions require a hunted target, a psychic's psyche-trait
 * actions require an unleashed psyche. When the resource toggle is OFF, the sheet still lists the action
 * (so the player can read it) but marks it "needs <resource>".
 *
 * Detection is conservative and resource-anchored — mostly PF2e's own canonical traits:
 *  • RAGE          — the `rage` trait ("usable only while raging").
 *  • PANACHE       — the `finisher` trait (finishers spend panache), plus the base actions whose text
 *    states the requirement ("only if you have panache"). BRAVADO actions GAIN panache → never gated.
 *  • HUNT PREY     — no dedicated trait: a `ranger` action whose text references "your prey".
 *  • UNLEASH PSYCHE— the `psyche` trait ("usable only while your psyche is unleashed").
 *
 * The gate only surfaces for a character who actually HAS the matching resource (base class or an
 * archetype dedication that grants it), so it never confuses a character who can't use it.
 */
export type ResourceGate = 'rage' | 'panache' | 'hunt-prey' | 'unleash-psyche';

/** Strip HTML to plain text for the prose requirement scan. */
function plain(html: string | undefined): string {
  return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/** Which resource state (if any) an action requires to be usable. */
export function actionGate(rec: { traits?: string[]; description?: string } | undefined): ResourceGate | null {
  if (!rec) return null;
  const t = new Set(rec.traits ?? []);
  const d = plain(rec.description);
  if (t.has('rage')) return 'rage';
  if (t.has('psyche')) return 'unleash-psyche'; // canonical "only while your psyche is unleashed"
  // A bravado action GRANTS panache — never gate it, even if its text mentions panache.
  if (!t.has('bravado')) {
    if (t.has('finisher')) return 'panache';
    if (/have panache|only if you have panache|spend your panache|requires? panache|lose your panache/i.test(d)) return 'panache';
  }
  // Ranger prey actions have no trait of their own; anchor on the ranger trait + a prey reference.
  if (t.has('ranger') && /your (hunted )?prey|against your prey/i.test(d)) return 'hunt-prey';
  // Rage prose fallback for the rare rage action that isn't trait-tagged. (Passive "while raging"
  // benefits never reach the action list, so this only affects real actions.)
  if (/while raging|you['’]?re raging|you are raging/i.test(d)) return 'rage';
  return null;
}

const GATE_LABEL: Record<ResourceGate, string> = {
  rage: 'Rage',
  panache: 'Panache',
  'hunt-prey': 'Hunt Prey',
  'unleash-psyche': 'Unleashed',
};

/** Short display label for a gate, used in the "Needs <label>" badge. */
export function gateLabel(g: ResourceGate): string {
  return GATE_LABEL[g];
}
