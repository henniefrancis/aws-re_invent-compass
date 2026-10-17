import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/shell/app.component';

// Bootstrap failures are not logged: the site never writes to the console.
bootstrapApplication(AppComponent, appConfig).catch(() => undefined);
