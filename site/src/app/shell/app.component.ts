import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FocusOnNavigate } from './focus-on-navigate';
import { SiteFooterComponent } from './site-footer.component';
import { SiteHeaderComponent } from './site-header.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SiteHeaderComponent, SiteFooterComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  // Created once so that it can listen for navigations. It holds no state the template reads.
  private readonly focusOnNavigate = inject(FocusOnNavigate);
}
