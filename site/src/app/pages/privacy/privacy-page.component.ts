import { Component } from '@angular/core';
import { PRIVACY_INTRO, PRIVACY_SECTIONS } from '../../../lib/content/privacy';
import { SITE_LINKS, privateReportingUrl } from '../../../lib/content/links';

@Component({
  selector: 'app-privacy-page',
  templateUrl: './privacy-page.component.html',
})
export class PrivacyPage {
  protected readonly intro = PRIVACY_INTRO.text;
  protected readonly sections = PRIVACY_SECTIONS;
  protected readonly reporting = privateReportingUrl(SITE_LINKS);
}
