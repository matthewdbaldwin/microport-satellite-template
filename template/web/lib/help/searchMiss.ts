// web/lib/help/searchMiss.ts — records zero-literal-result help searches so
// admins can find gaps in the library.
//
// SCAFFOLD: a deliberate NO-OP. The template api has no HelpSearchMiss table
// or POST /help route yet — when the app grows one, replace the body with a
// fire-and-forget post (see EngagePort's web/lib/help/searchMiss.ts for the
// reference: the write is analytics-only and must NEVER disrupt the search UI,
// so any error is caught and swallowed).
export function recordHelpSearchMiss(_args: {
  query: string;
  wasFuzzyRescued: boolean;
  locale?: string;
}): void {
  // no-op until the api has a search-miss sink
}
