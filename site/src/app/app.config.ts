import type { ApplicationConfig } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideClientHydration, withNoIncrementalHydration } from '@angular/platform-browser';
import { TitleStrategy, provideRouter, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { SiteTitleStrategy } from './shell/site-title-strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useExisting: SiteTitleStrategy },
    // No incremental hydration, so no event replay and no inline dispatch script.
    provideClientHydration(withNoIncrementalHydration()),
  ],
};
