/*
 * Remember where the user left the Campaigns page, so re-opening it returns to the same spot instead
 * of always dumping them back on the list. A GM who is running a campaign is IN that campaign —
 * bouncing to the list every time is friction.
 *
 * PERSISTED across launches (localStorage), not just the session: the user asked that if the app was
 * closed while on a campaign, it reopens on that campaign. Two pieces do that:
 *   - the last campaign id (which campaign detail was open), and
 *   - whether the campaigns page was the CURRENT top-level screen at close time.
 * Both must be true to reopen a campaign — the id alone survives navigating away (so returning to the
 * page within a session still reopens the campaign), so the screen marker is what distinguishes
 * "closed while looking at the campaign" from "visited it earlier, then moved on".
 *
 * Part of the removable seam (src/integration/) — deleting it restores "always open the list, always
 * boot to the roster".
 */

const CAMPAIGN_KEY = 'pf2e-codex.last-campaign';
const ON_PAGE_KEY = 'pf2e-codex.on-campaigns-page';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// Seed from storage so getRememberedCampaign works on a fresh launch (module scope alone would reset).
let lastCampaignId: string | null = read(CAMPAIGN_KEY);

/** The campaign detail currently open (id), or null when on the list / no campaign. */
export function rememberCampaign(id: string | null): void {
  lastCampaignId = id;
  write(CAMPAIGN_KEY, id);
}

export function getRememberedCampaign(): string | null {
  return lastCampaignId;
}

/** Record whether the campaigns page is the app's current top-level screen. */
export function setOnCampaignsPage(on: boolean): void {
  write(ON_PAGE_KEY, on ? '1' : null);
}

/** Was the campaigns page the last screen the app showed? (i.e. it was closed there.) */
export function wasOnCampaignsPage(): boolean {
  return read(ON_PAGE_KEY) === '1';
}
