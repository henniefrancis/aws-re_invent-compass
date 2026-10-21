// Feature: showcase-site, task 26 (Requirement 4.5): the open and close rules of the main menu.
import { describe, expect, test } from 'vitest';
import {
  CLOSED_MENU,
  clickOutside,
  escape,
  navigated,
  panelId,
  toggleGroup,
  toggleMenu,
} from '../../src/lib/shell/menu';

describe('the main menu', () => {
  test('a group button opens its panel, a second press closes it, and only one is open', () => {
    const product = toggleGroup(CLOSED_MENU, 'product');
    expect(product).toEqual({ open: 'product', expanded: false });
    expect(toggleGroup(product, 'about')).toEqual({ open: 'about', expanded: false });
    expect(toggleGroup(product, 'product')).toEqual(CLOSED_MENU);
  });

  test('the Menu button shows the groups, and hiding them closes any panel', () => {
    const shown = toggleMenu(CLOSED_MENU);
    expect(shown).toEqual({ open: null, expanded: true });
    expect(toggleMenu(toggleGroup(shown, 'project'))).toEqual(CLOSED_MENU);
  });

  test('Escape closes the open panel and hands the focus back to its button', () => {
    const state = toggleGroup(toggleMenu(CLOSED_MENU), 'project');
    expect(escape(state)).toEqual({ state: { open: null, expanded: true }, focus: 'project' });
  });

  test('Escape with no panel open hides the narrow-screen menu and moves no focus', () => {
    expect(escape(toggleMenu(CLOSED_MENU))).toEqual({ state: CLOSED_MENU, focus: null });
    expect(escape(CLOSED_MENU)).toEqual({ state: CLOSED_MENU, focus: null });
  });

  test('a click outside closes the panel and keeps the narrow-screen menu', () => {
    const state = toggleGroup(toggleMenu(CLOSED_MENU), 'about');
    expect(clickOutside(state)).toEqual({ open: null, expanded: true });
  });

  test('navigation closes everything', () => {
    expect(navigated()).toEqual(CLOSED_MENU);
  });

  test('each panel id is named from its group', () => {
    expect(panelId('product')).toBe('nav-panel-product');
  });
});
