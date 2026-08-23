// __APP_NAME__ Help Library — the two hand-kept helpKey maps, plain data so
// tests can import them without pulling React in.
//
// (EngagePort generates its POPOVER_ROUTES with a script; at scaffold scale a
// hand-kept map is fine. If the app grows many popovers, port
// EngagePort/scripts/generate-help-popover-routes.js.)

/** helpKey → the app route that popover lives on (for /help search result
 *  rows: a popover hit deep-links to its page). A key absent here is
 *  searchable but not clickable. */
export const POPOVER_ROUTES: Record<string, string> = {
  home: '/',
};

/** helpKey → Help Library article slug (for the popover footer's "view more"
 *  deep link into /help). Distinct purpose from POPOVER_ROUTES — see above. */
export const HELP_KEY_TO_SLUG: Record<string, string> = {
  home: 'getting-started',
};
