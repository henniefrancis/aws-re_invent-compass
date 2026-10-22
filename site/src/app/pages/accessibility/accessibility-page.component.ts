import { Component } from '@angular/core';
import { ACCESSIBILITY_BLOCKS, ACCESSIBILITY_TITLE } from '../../../lib/content/more-legal';
import { SITE_LINKS, issuesUrl } from '../../../lib/content/links';

/** The Accessibility_Page (Requirement 28.3). */
@Component({
  selector: 'app-accessibility-page',
  templateUrl: './accessibility-page.component.html',
})
export class AccessibilityPage {
  protected readonly title = ACCESSIBILITY_TITLE;
  protected readonly blocks = ACCESSIBILITY_BLOCKS;
  protected readonly issues = issuesUrl(SITE_LINKS);
}
