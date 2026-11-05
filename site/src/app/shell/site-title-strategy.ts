import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { pageTitle, pageUrl } from '../../lib/shell/title';

/**
 * Sets the document title to "<page name> | re:Invent Compass", and the og:title, og:url and
 * canonical link of the page to match, so every prerendered page names its own address.
 */
@Injectable({ providedIn: 'root' })
export class SiteTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = pageTitle(this.buildTitle(snapshot));
    const url = pageUrl(snapshot.url);
    this.title.setTitle(title);
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:url', content: url });
    // The server DOM can answer a missing element with undefined, so search the link tags.
    let canonical = Array.from(this.document.head.getElementsByTagName('link')).find(
      (link) => link.getAttribute('rel') === 'canonical',
    );
    if (canonical === undefined) {
      canonical = this.document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      this.document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', url);
  }
}
