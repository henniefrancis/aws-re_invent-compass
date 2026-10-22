import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ABOUT_BIO, ABOUT_BUILT_BY, ABOUT_PHOTO, ABOUT_TITLE } from '../../../lib/content/about';
import { CREATOR_LINKS } from '../../../lib/content/links';

/** The About_Page (Requirement 24): who built re:Invent Compass. */
@Component({
  selector: 'app-about-page',
  imports: [RouterLink],
  templateUrl: './about-page.component.html',
})
export class AboutPage {
  protected readonly title = ABOUT_TITLE;
  protected readonly builtBy = ABOUT_BUILT_BY.text;
  protected readonly bio = ABOUT_BIO;
  protected readonly photo = ABOUT_PHOTO;
  protected readonly links = CREATOR_LINKS;
}
