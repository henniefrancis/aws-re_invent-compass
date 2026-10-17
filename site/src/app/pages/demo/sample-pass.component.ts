import { Component, computed, input } from '@angular/core';
import { layoutPass } from '../../../lib/demo/pass-layout';
import type { SamplePass } from '../../../lib/demo/sample-pass';

/** The sample boarding pass, drawn as inline SVG. It has no barcode and no QR code. */
@Component({
  selector: 'app-sample-pass',
  templateUrl: './sample-pass.component.html',
})
export class SamplePassComponent {
  readonly pass = input.required<SamplePass>();
  protected readonly layout = computed(() => layoutPass(this.pass()));
}
