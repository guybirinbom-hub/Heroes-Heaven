/**
 * The switches for the initiative-tracker integration.
 *
 * This whole integration was asked for on the explicit condition that it can be taken back out;
 * see ./README.md for full removal. Flip these to false and Heroes Heaven behaves exactly as it did
 * before the tracker existed.
 *
 * NOT published: none of this ships in a release until the user says so.
 */

/** Opening a campaign shows the full-screen initiative tracker instead of the old detail panel. */
export const TRACKER_IN_CAMPAIGN = true;

/**
 * TESTING ONLY — reach the Campaigns page without signing in, on localhost.
 *
 * ⚠ THE DEV GATE LIVES HERE, ON THE CONSTANT ITSELF. It used to be `true` unconditionally, with the
 * comment claiming App.tsx's own `import.meta.env.DEV &&` guard made that safe. It did — for the
 * LOGIN bypass. But the flag has four other consumers that had no such guard, and one of them
 * (CampaignTracker's `localMembers={TEST_CAMPAIGNS_WITHOUT_LOGIN ? localMembers : undefined}`)
 * shipped in the v0.1.19 release: PartyMembers skips its Supabase fetch whenever `localMembers` is
 * supplied, so the campaign party was read from THIS DEVICE'S localStorage roster instead of the
 * server. Campaign memberships are cloud-synced but rosters are per-device, and a browser profile
 * and the Tauri WebView profile are separate stores — so the campaign appeared on the desktop app
 * while its players did not. Gating the constant makes every consumer inert in a production build
 * (it constant-folds to false), so no call site can forget the guard again.
 *
 * ⚠ Campaign *operations* still need the server: create/join/kick go through Supabase, which
 * refuses without auth ("Sign in to use campaigns."). So without login you can open the page and
 * work with campaigns already cached on this device — you can't create a new one.
 */
export const TEST_CAMPAIGNS_WITHOUT_LOGIN = import.meta.env.DEV;
