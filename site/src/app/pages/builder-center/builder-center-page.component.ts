import { Component } from '@angular/core';
import { BUILDER_CENTER_LINKS, COMING_SOON } from '../../../lib/content/links';

/** The Builder Center page (task 54): the creator's posts on AWS Builder Center, one card each. */
@Component({
  selector: 'app-builder-center-page',
  templateUrl: './builder-center-page.component.html',
})
export class BuilderCenterPage {
  protected readonly links = BUILDER_CENTER_LINKS;
  protected readonly comingSoon = COMING_SOON;
}
