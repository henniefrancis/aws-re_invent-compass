import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SITE_LINKS, footerItems } from '../../lib/content/links';
import { NOTICE } from '../../lib/content/notice';

@Component({
  selector: 'app-site-footer',
  imports: [RouterLink],
  templateUrl: './site-footer.component.html',
})
export class SiteFooterComponent {
  protected readonly notice = NOTICE.text;
  protected readonly items = footerItems(SITE_LINKS);
}
