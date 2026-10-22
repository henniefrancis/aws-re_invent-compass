import { Component } from '@angular/core';
import { TERMS_BLOCKS, TERMS_TITLE, TERMS_UPDATED } from '../../../lib/content/more-legal';

/** The Terms_Page (Requirement 28.2). */
@Component({
  selector: 'app-terms-page',
  templateUrl: './terms-page.component.html',
})
export class TermsPage {
  protected readonly title = TERMS_TITLE;
  protected readonly blocks = TERMS_BLOCKS;
  protected readonly updated = TERMS_UPDATED;
}
