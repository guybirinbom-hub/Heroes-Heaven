import { PARTY_SHARED_FEATS } from '../sheet/partySummary';

/**
 * Capabilities the PARTY has, cached on this device.
 *
 * Battleforger prepares another character's weapon or armour, so once one member of the party has
 * the feat the control belongs on everyone's items — that is how the feat is used at a table.
 *
 * The party lives on the server and loads asynchronously, but the item editor is a synchronous
 * render deep inside the sheet. So the flag is written whenever the party is fetched and read from
 * the cache thereafter. Consequences worth being honest about:
 *   - a brand-new device shows the control only after the party has been opened once;
 *   - the cache is per campaign, so leaving a party stops enabling it;
 *   - your OWN feat is always checked directly and never depends on this.
 */
const KEY = 'pf2e-codex.partyCapabilities';

type Cache = Record<string, string[]>; // campaignId -> shared feat ids present in that party

function read(): Cache {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

/** Record which shared feats this campaign's party currently has. Called after a party fetch. */
export function rememberPartyCapabilities(campaignId: string, summaries: { sharedFeats?: string[] }[]): void {
  if (!campaignId) return;
  const present = new Set<string>();
  for (const s of summaries) for (const f of s.sharedFeats ?? []) if (PARTY_SHARED_FEATS.includes(f)) present.add(f);
  try {
    const cache = read();
    cache[campaignId] = [...present];
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — the control simply falls back to "only if you have the feat yourself" */
  }
}

/** Does ANY campaign this device knows about have a party member with this feat? */
export function partyHasFeat(featId: string): boolean {
  const cache = read();
  return Object.values(cache).some((fs) => fs.includes(featId));
}
