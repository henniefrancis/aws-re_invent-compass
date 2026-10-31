// The open and close rules of the main navigation (showcase-site task 26, Requirement 4.5).
//
// Each group is a disclosure: at most one panel is open. The header component only turns
// browser events into these calls, so the rules are tested here without a browser.

/** Which group's panel is open, or null when none is, and whether the narrow-screen menu is shown. */
export interface MenuState {
  readonly open: string | null;
  readonly expanded: boolean;
}

export const CLOSED_MENU: MenuState = { open: null, expanded: false };

/** A press on a group's button opens its panel, or closes it when it was already open. */
export function toggleGroup(state: MenuState, group: string): MenuState {
  return { ...state, open: state.open === group ? null : group };
}

/** The narrow-screen "Menu" button shows or hides the groups; hiding them closes any panel. */
export function toggleMenu(state: MenuState): MenuState {
  return state.expanded ? CLOSED_MENU : { ...state, expanded: true };
}

/**
 * Escape closes the open panel and names the group whose button gets the focus back. With no
 * panel open it hides the narrow-screen menu instead, and no focus moves.
 */
export function escape(state: MenuState): {
  readonly state: MenuState;
  readonly focus: string | null;
} {
  if (state.open !== null) {
    return { state: { ...state, open: null }, focus: state.open };
  }
  return { state: CLOSED_MENU, focus: null };
}

/** A click outside the header closes the open panel and keeps the narrow-screen menu as it is. */
export function clickOutside(state: MenuState): MenuState {
  return { ...state, open: null };
}

/** Any navigation closes everything. */
export function navigated(): MenuState {
  return CLOSED_MENU;
}

/** The id of a group's panel, which its button names in aria-controls. */
export function panelId(group: string): string {
  return `nav-panel-${group}`;
}
