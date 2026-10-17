import { isPlatformBrowser } from '@angular/common';
import type { ApplicationConfig } from '@angular/core';
import {
  PLATFORM_ID,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideClientHydration, withNoIncrementalHydration } from '@angular/platform-browser';
import { TitleStrategy, provideRouter, withInMemoryScrolling } from '@angular/router';
import { takeBoardFragment } from '../lib/board/early-fragment';
import { FRAGMENT_HOLDER } from './fragment-holder';
import { routes } from './app.routes';
import { SiteTitleStrategy } from './shell/site-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // Runs before the router's first navigation: take the fragment off the address now.
    provideAppInitializer(() => {
      const holder = inject(FRAGMENT_HOLDER);
      if (isPlatformBrowser(inject(PLATFORM_ID))) {
        holder.set(
          takeBoardFragment({
            pathname: location.pathname,
            href: location.href,
            replaceState: (url) => {
              history.replaceState(null, '', url);
            },
          }),
        );
      }
    }),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useExisting: SiteTitleStrategy },
    // No incremental hydration, so no event replay and no inline dispatch script.
    provideClientHydration(withNoIncrementalHydration()),
  ],
};
