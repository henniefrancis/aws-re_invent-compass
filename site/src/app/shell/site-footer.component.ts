import { Component } from '@angular/core';
import { NOTICE, NOTICE_HEADING } from '../../lib/content/notice';

/** The footer (Requirement 4.2): the Notice under its heading, centred, with no links. */
@Component({
  selector: 'app-site-footer',
  templateUrl: './site-footer.component.html',
})
export class SiteFooterComponent {
  protected readonly heading = NOTICE_HEADING;
  protected readonly notice = NOTICE.text;
}
