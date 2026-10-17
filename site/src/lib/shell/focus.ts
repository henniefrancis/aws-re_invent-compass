// Focus after navigation (showcase-site, Component 2).
//
// After each navigation inside the site, keyboard focus moves to the page heading. The very
// first navigation is the page load, which keeps the browser default.

/** True for every navigation except the first (index 0). */
export function shouldMoveFocus(navigationIndex: number): boolean {
  return navigationIndex > 0;
}
