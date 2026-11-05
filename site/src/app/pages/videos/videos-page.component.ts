import { Component } from '@angular/core';
import { COMING_SOON, VIDEO_LINKS } from '../../../lib/content/links';

/** The Videos page (task 54): the project videos on YouTube, one card each. */
@Component({
  selector: 'app-videos-page',
  templateUrl: './videos-page.component.html',
})
export class VideosPage {
  protected readonly links = VIDEO_LINKS;
  protected readonly comingSoon = COMING_SOON;
}
