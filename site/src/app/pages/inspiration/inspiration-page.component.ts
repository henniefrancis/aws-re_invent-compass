import { Component } from '@angular/core';
import {
  INSPIRATION_KEY_LINE,
  INSPIRATION_SECTIONS,
  INSPIRATION_TITLE,
} from '../../../lib/content/inspiration';

/** The Inspiration_Page (Requirement 25): the owner's story. */
@Component({
  selector: 'app-inspiration-page',
  templateUrl: './inspiration-page.component.html',
})
export class InspirationPage {
  protected readonly title = INSPIRATION_TITLE;
  protected readonly keyLine = INSPIRATION_KEY_LINE.text;
  protected readonly paragraphs = INSPIRATION_SECTIONS.flatMap((s) => s.blocks);
}
