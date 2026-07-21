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
 * TESTING ONLY — reach the Campaigns page without signing in.
 *
 * This does NOT loosen the real gate: App.tsx keeps its `import.meta.env.DEV &&` guard, which is
 * false in any production build, so the friends-only login stays enforced on the deployed site.
 * All it does is remove the need to set the `hh-dev-skip` sessionStorage flag by hand on localhost.
 *
 * ⚠ Campaign *operations* still need the server: create/join/kick go through Supabase, which
 * refuses without auth ("Sign in to use campaigns."). So without login you can open the page and
 * work with campaigns already cached on this device — you can't create a new one.
 */
export const TEST_CAMPAIGNS_WITHOUT_LOGIN = true;
