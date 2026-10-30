import { Location } from '@angular/common';
import {
  Component,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
  type ElementRef,
  type OnDestroy,
} from '@angular/core';
import { Meta } from '@angular/platform-browser';
import {
  INITIAL_BOARD_STATE,
  MESSAGES,
  toBoardViewModel,
  type BoardState,
} from '../../../lib/board/board-state';
import { FRAGMENT_HOLDER } from '../../fragment-holder';
import { createBoardController, type BoardController } from '../../../lib/board/board-controller';
import { walletForDevice, type DeviceWallet } from '../../../lib/board/device';
import { locate } from '../../../lib/board/locate';
import { watchVisibility } from '../../../lib/board/visibility';
import {
  IDLE_WALK,
  LOCATING_WALK,
  WALK_TEXT,
  walkFromHere,
  type WalkView,
} from '../../../lib/board/walk-view';

/**
 * The hand-off page. It holds no flow logic: the Board_Controller does the work and this
 * component wires it to the browser globals, binds the view model, moves focus to the state
 * heading and fills the polite live region after each state change.
 */
@Component({
  selector: 'app-board-page',
  templateUrl: './board-page.component.html',
})
export class BoardPage implements OnDestroy {
  private readonly location = inject(Location);
  private readonly fragment = inject(FRAGMENT_HOLDER);
  private readonly injector = inject(Injector);
  private controller: BoardController | null = null;

  private readonly state = signal<BoardState>(INITIAL_BOARD_STATE);
  private readonly nowMs = signal(0);
  private readonly heading = viewChild<ElementRef<HTMLElement>>('stateHeading');

  /** False in the prerendered page, so a visitor without JavaScript keeps the notice. */
  protected readonly scriptRuns = signal(false);
  /** The wallet of this phone, read once in the browser. "both" in the prerendered page. */
  private readonly deviceWallet = signal<DeviceWallet>('both');
  protected readonly vm = computed(() =>
    toBoardViewModel(this.state(), this.nowMs(), this.deviceWallet()),
  );
  protected readonly announcement = signal('');
  protected readonly retryLabel = MESSAGES.retryLabel;
  protected readonly walkText = WALK_TEXT;
  /** What "Walk from here" shows under the next session. It lives in memory only. */
  protected readonly walk = signal<WalkView>(IDLE_WALK);

  constructor() {
    // The hand-off page is never indexed. The tag is part of the prerendered head.
    inject(Meta).updateTag({ name: 'robots', content: 'noindex' });
    afterNextRender(() => {
      this.scriptRuns.set(true);
      const hints = (navigator as { userAgentData?: { platform?: string; mobile?: boolean } })
        .userAgentData;
      this.deviceWallet.set(
        walletForDevice({
          userAgent: navigator.userAgent,
          platform: hints?.platform,
          mobile: hints?.mobile,
        }),
      );
      this.nowMs.set(Date.now());
      this.controller = createBoardController({
        // Taken from the address (raw, not router normalised) before the router started.
        readHash: () => this.fragment.take(),
        replaceState: (path) => {
          this.location.replaceState(path);
        },
        fetch: globalThis.fetch.bind(globalThis),
        setTimer: (callback, ms) => setTimeout(callback, ms),
        clearTimer: (handle) => {
          clearTimeout(handle as ReturnType<typeof setTimeout>);
        },
        now: () => Date.now(),
        onChange: (state) => {
          this.show(state);
        },
        // A sleeping phone can pass expiresAt without a timer firing: look again on waking.
        onRefresh: () => {
          this.nowMs.set(Date.now());
        },
        subscribeVisible: (listener) => watchVisibility(document, window, listener),
      });
      void this.controller.start();
    });
  }

  protected retry(): void {
    void this.controller?.retry();
  }

  /** Asks for the location only now, on the attendee's tap, and works out the walk on the phone. */
  protected startWalk(): void {
    const session = this.vm().nextSession;
    if (session === null || this.walk().kind === 'locating') {
      return;
    }
    this.walk.set(LOCATING_WALK);
    this.announcement.set(WALK_TEXT.locating);
    void walkFromHere(
      session,
      () => locate(navigator.geolocation),
      this.deviceWallet(),
      () => Date.now(),
    ).then((view) => {
      this.walk.set(view);
      this.announcement.set(
        view.kind === 'message'
          ? view.text
          : view.kind === 'estimate'
            ? `${view.summary} ${view.leaveBy} ${view.note}`
            : '',
      );
    });
  }

  ngOnDestroy(): void {
    this.controller?.dispose();
  }

  private show(state: BoardState): void {
    this.nowMs.set(Date.now());
    this.walk.set(IDLE_WALK);
    this.state.set(state);
    this.announcement.set(toBoardViewModel(state, this.nowMs()).announcement);
    afterNextRender(
      () => {
        this.heading()?.nativeElement.focus();
      },
      { injector: this.injector },
    );
  }
}
