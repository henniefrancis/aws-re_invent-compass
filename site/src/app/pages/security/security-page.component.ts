import { Component } from '@angular/core';
import { SECURITY_BLOCKS, SECURITY_TITLE } from '../../../lib/content/more-legal';
import { SITE_LINKS, privateReportingUrl, securityPolicyUrl } from '../../../lib/content/links';

/** The Security_Page (Requirement 28.4). */
@Component({
  selector: 'app-security-page',
  templateUrl: './security-page.component.html',
})
export class SecurityPage {
  protected readonly title = SECURITY_TITLE;
  protected readonly blocks = SECURITY_BLOCKS;
  protected readonly report = privateReportingUrl(SITE_LINKS);
  protected readonly policy = securityPolicyUrl(SITE_LINKS);
}
