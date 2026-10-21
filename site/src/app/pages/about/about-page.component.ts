import { Component } from '@angular/core';
import { ABOUT_BUILT_BY, ABOUT_COMING_SOON, ABOUT_TITLE } from '../../../lib/content/about';

/** The About_Page (Requirement 18): who built re:Invent Compass. */
@Component({
  selector: 'app-about-page',
  templateUrl: './about-page.component.html',
})
export class AboutPage {
  protected readonly title = ABOUT_TITLE;
  protected readonly builtBy = ABOUT_BUILT_BY.text;
  protected readonly comingSoon = ABOUT_COMING_SOON.text;
}
