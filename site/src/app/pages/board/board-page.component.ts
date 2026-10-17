import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';

@Component({
  selector: 'app-board-page',
  templateUrl: './board-page.component.html',
})
export class BoardPage {
  constructor() {
    // The hand-off page is never indexed. The tag is part of the prerendered head.
    inject(Meta).updateTag({ name: 'robots', content: 'noindex' });
  }
}
