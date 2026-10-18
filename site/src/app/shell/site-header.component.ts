import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NAV_ITEMS } from '../../lib/content/links';
import { PRODUCT_NAME } from '../../lib/content/story';

@Component({
  selector: 'app-site-header',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './site-header.component.html',
})
export class SiteHeaderComponent {
  protected readonly productName = PRODUCT_NAME;
  protected readonly items = NAV_ITEMS;
  protected readonly exactHome = { exact: true };
  protected readonly partial = { exact: false };
}
