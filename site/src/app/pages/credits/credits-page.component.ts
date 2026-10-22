import { Component } from '@angular/core';
import { CREDITS, CREDITS_INTRO, CREDITS_TITLE } from '../../../lib/content/more-legal';

/** The Credits_Page (Requirement 28.5). */
@Component({
  selector: 'app-credits-page',
  templateUrl: './credits-page.component.html',
})
export class CreditsPage {
  protected readonly title = CREDITS_TITLE;
  protected readonly intro = CREDITS_INTRO;
  protected readonly credits = CREDITS;
}
