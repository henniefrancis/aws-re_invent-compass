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
  /** Put FLIGHT NAME above TERMINAL and GATE (the home page's event pass). */
  readonly flightNameFirst = input(false);
  protected readonly layout = computed(() =>
    layoutPass(this.pass(), { flightNameFirst: this.flightNameFirst() }),
  );
  /** The arrow between TERMINAL and GATE: a shaft and a head. */
  protected readonly arrowPath = computed(() => {
    const { x, y } = this.layout().arrow;
    return `M${String(x - 14)} ${String(y)} H${String(x + 13)} M${String(x + 5)} ${String(y - 7)} L${String(x + 13)} ${String(y)} L${String(x + 5)} ${String(y + 7)}`;
  });
}
