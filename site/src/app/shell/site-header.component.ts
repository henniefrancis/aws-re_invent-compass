import { Component, DestroyRef, ElementRef, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { SITE_LINKS, navGroups } from '../../lib/content/links';
import { PRODUCT_NAME } from '../../lib/content/story';
import {
  CLOSED_MENU,
  clickOutside,
  escape,
  navigated,
  panelId,
  toggleGroup,
  toggleMenu,
  type MenuState,
} from '../../lib/shell/menu';

/**
 * The site header (Requirement 4): the logo home, three disclosure groups and the "Try the demo"
 * button. The open and close rules live in src/lib/shell/menu.ts; this component only wires the
 * browser events to them.
 */
@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './site-header.component.html',
})
export class SiteHeaderComponent {
  protected readonly productName = PRODUCT_NAME;
  protected readonly groups = navGroups(SITE_LINKS);
  protected readonly menu = signal<MenuState>(CLOSED_MENU);
  protected readonly panelId = panelId;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const subscription = inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.menu.set(navigated());
      }
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  protected toggleGroup(group: string): void {
    this.menu.update((state) => toggleGroup(state, group));
  }

  protected toggleMenu(): void {
    this.menu.update(toggleMenu);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    const result = escape(this.menu());
    this.menu.set(result.state);
    if (result.focus !== null) {
      this.host.nativeElement
        .querySelector<HTMLButtonElement>(`[aria-controls="${panelId(result.focus)}"]`)
        ?.focus();
    }
  }

  @HostListener('document:click', ['$event.target'])
  protected onDocumentClick(target: EventTarget | null): void {
    if (!(target instanceof Node) || !this.host.nativeElement.contains(target)) {
      this.menu.update(clickOutside);
    }
  }
}
