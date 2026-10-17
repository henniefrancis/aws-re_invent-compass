import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { createDemoRuntime, type DemoDeps } from '../../../lib/demo/demo-deps';
import {
  EMPTY_DEMO,
  reduceDemo,
  type DemoAction,
  type DemoState,
} from '../../../lib/demo/demo-state';
import {
  DEMO_TEXT,
  buildSwapView,
  buildVerdictView,
  guidedHint,
} from '../../../lib/demo/demo-view';
import { FILE_NAME, demoCalendarText } from '../../../lib/demo/ics';
import { buildSamplePass } from '../../../lib/demo/sample-pass';
import { REAL_ENGINE } from '../../../lib/demo/rules-port';
import { DEMO_VENUE_DATA } from '../../../lib/demo/venue-data';
import { buildCatalogView, buildWeekView, timezoneStatement } from '../../../lib/demo/week-view';
import { SamplePassComponent } from './sample-pass.component';

/**
 * The click-through demo. One signal holds the demo state and every change goes through the
 * pure reducer. The component decides nothing: Site_Logic builds every view.
 */
@Component({
  selector: 'app-demo-page',
  imports: [SamplePassComponent],
  templateUrl: './demo-page.component.html',
})
export class DemoPage {
  private readonly deps: DemoDeps | null = createDemoRuntime(REAL_ENGINE, DEMO_VENUE_DATA);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly panels = viewChild<ElementRef<HTMLElement>>('panels');

  protected readonly text = DEMO_TEXT;
  protected readonly available = this.deps !== null;
  protected readonly timezone = timezoneStatement();
  protected readonly hint = this.deps === null ? '' : guidedHint(this.deps);
  protected readonly state = signal<DemoState>(EMPTY_DEMO);

  protected readonly catalog = computed(() =>
    this.deps === null ? [] : buildCatalogView(this.state(), this.deps),
  );
  protected readonly week = computed(() =>
    this.deps === null ? [] : buildWeekView(this.state(), this.deps),
  );
  protected readonly verdict = computed(() =>
    this.deps === null ? null : buildVerdictView(this.state(), this.deps),
  );
  protected readonly swap = computed(() =>
    this.deps === null ? null : buildSwapView(this.state(), this.deps),
  );
  protected readonly pass = computed(() => {
    const selected = this.state().selectedPassSessionId;
    return this.deps === null || selected === null
      ? null
      : buildSamplePass(selected, this.state(), this.deps);
  });
  protected readonly weekIsEmpty = computed(() => this.state().commitments.length === 0);

  protected act(action: DemoAction): void {
    if (this.deps !== null) {
      const deps = this.deps;
      this.state.update((current) => reduceDemo(current, action, deps));
      // A verdict or a swap panel can be above the list the user tapped in. Bring it into
      // view without moving focus; the live region announces the result.
      afterNextRender(
        () => {
          this.panels()?.nativeElement.scrollIntoView({ block: 'nearest' });
        },
        { injector: this.injector },
      );
    }
  }

  protected download(): void {
    if (this.deps !== null) {
      const blob = new Blob([demoCalendarText(this.state(), this.deps)], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      link.href = url;
      link.download = FILE_NAME;
      link.click();
      URL.revokeObjectURL(url);
    }
  }
}
