import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { shouldMoveFocus } from '../../lib/shell/focus';

/**
 * After each navigation inside the site, moves keyboard focus to the page heading. The first
 * navigation is the page load and keeps the browser default.
 */
@Injectable({ providedIn: 'root' })
export class FocusOnNavigate {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private navigations = 0;

  constructor() {
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        const index = this.navigations;
        this.navigations += 1;
        if (shouldMoveFocus(index)) {
          afterNextRender(
            () => {
              this.document.querySelector('h1')?.focus();
            },
            { injector: this.injector },
          );
        }
      }
    });
  }
}
