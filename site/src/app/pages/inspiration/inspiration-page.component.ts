import { Component } from '@angular/core';
import { INSPIRATION_BLOCKS, INSPIRATION_TITLE } from '../../../lib/content/inspiration';

/** The Inspiration_Page (Requirement 19). */
@Component({
  selector: 'app-inspiration-page',
  templateUrl: './inspiration-page.component.html',
})
export class InspirationPage {
  protected readonly title = INSPIRATION_TITLE;
  protected readonly blocks = INSPIRATION_BLOCKS;
}
