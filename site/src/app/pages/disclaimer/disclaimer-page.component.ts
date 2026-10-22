import { Component } from '@angular/core';
import { DISCLAIMER_BLOCKS, DISCLAIMER_TITLE } from '../../../lib/content/legal';
import { NOTICE } from '../../../lib/content/notice';

/** The Disclaimer_Page (Requirement 27.2). */
@Component({
  selector: 'app-disclaimer-page',
  templateUrl: './disclaimer-page.component.html',
})
export class DisclaimerPage {
  protected readonly title = DISCLAIMER_TITLE;
  protected readonly notice = NOTICE.text;
  protected readonly blocks = DISCLAIMER_BLOCKS;
}
