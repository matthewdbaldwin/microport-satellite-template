// Helpers that derive stable, locale-independent identifiers from translation
// keys. Used to populate `data-testid` (TestCafe/Playwright), landmark `id`s
// (a11y + anchor links), and `title` attributes on links and selectors.
//
// Conventions:
//   • ID = `${namespace}.${key}` → kebab-case. Deterministic, unique by key.
//   • `data-testid` on every medium-scope element (headings, buttons, form
//     fields, table columns, cards, modals, tab buttons, badges, list items).
//   • `id` only on elements that are unique per page (H1, main sections,
//     modals) so we don't collide with the HTML `id` uniqueness rule.
//   • `title` attribute only on links (`<a>`, `<Link>`) and selectors
//     (`<select>`) — per project UX contract.

function kebab(s: string): string {
  return s
    .replace(/\./g, '-')
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/** Compute the stable ID string for a translation key. Internal helper. */
function idFor(namespace: string, key: string): string {
  return kebab(`${namespace}.${key}`);
}

/** Props for a landmark element (unique on the page): id + data-testid. */
export function landmark(namespace: string, key: string): { id: string; 'data-testid': string } {
  const id = idFor(namespace, key);
  return { id, 'data-testid': id };
}

/** Props for a non-unique medium-scope element: data-testid only. */
export function testId(namespace: string, key: string): { 'data-testid': string } {
  return { 'data-testid': idFor(namespace, key) };
}

/** Props for a link or selector (<a>, <Link>, <select>): data-testid + title. */
export function linkAttrs(
  namespace: string,
  key: string,
  title: string,
): { 'data-testid': string; title: string } {
  return { 'data-testid': idFor(namespace, key), title };
}
