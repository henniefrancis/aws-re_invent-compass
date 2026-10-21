import { Component } from '@angular/core';
import {
  COPYRIGHT_BLOCKS,
  COPYRIGHT_LINE,
  COPYRIGHT_TITLE,
  licenceLinks,
} from '../../../lib/content/legal';
import { SITE_LINKS } from '../../../lib/content/links';

/** The Copyright_Page (Requirement 21.3). */
@Component({
  selector: 'app-copyright-page',
  templateUrl: './copyright-page.component.html',
})
export class CopyrightPage {
  protected readonly title = COPYRIGHT_TITLE;
  protected readonly line = COPYRIGHT_LINE.text;
  protected readonly blocks = COPYRIGHT_BLOCKS;
  protected readonly files = licenceLinks(SITE_LINKS);
}
