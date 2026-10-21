import { Component } from '@angular/core';
import { SITE_LINKS, documentationLinks } from '../../../lib/content/links';

/** The Documentation_Page (Requirement 20): links into the repository. */
@Component({
  selector: 'app-documentation-page',
  templateUrl: './documentation-page.component.html',
})
export class DocumentationPage {
  protected readonly links = documentationLinks(SITE_LINKS);
}
