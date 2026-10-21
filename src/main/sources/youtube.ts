// One YouTube (or any URL) source: an offscreen page (see offscreen.ts) that
// the user clicks through from its preview; input is forwarded to the page.

import { session, type WebContents } from 'electron';
import type { Command, PointerInput } from '../../shared/commands';
import type { AppState, PlayerStatus, YouTubeSourceId } from '../../shared/state';
import { pageKind, type PageKind } from '../../shared/youtube';
import type { Store } from '../store';
import playerOnlyCss from '../youtube/player-only.css?raw';
import { inject, installGuest, readVideo, seekTo, setQuality, skipBy, togglePlay } from '../youtube/guest';
import { OffscreenView, VIEW_H, VIEW_W, type ViewDeps } from './offscreen';

const STATUS_MS = 250;
export const PLAYER_PARTITION = 'persist:youtube';

/** Electron cursor types -> CSS cursors (anything else falls back to default). */
const CURSORS: Record<string, string> = {
  hand: 'pointer',
  ibeam: 'text',
  wait: 'wait',
  progress: 'progress',
  crosshair: 'crosshair',
  move: 'move',
  grab: 'grab',
  grabbing: 'grabbing',
  'not-allowed': 'not-allowed',
};

export interface PlayerDeps extends ViewDeps {
  store: Store;
  onStatus: (id: YouTubeSourceId, status: PlayerStatus) => void;
}

export class YouTubePlayer {
  private readonly view: OffscreenView;
  private page: PageKind = 'other';
  private cursor = 'default';
  private statusTimer: NodeJS.Timeout | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly id: YouTubeSourceId,
    private readonly deps: PlayerDeps,
  ) {
    this.unsubscribe = deps.store.subscribe((next, prev) => this.onChange(next, prev));
    const ses = session.fromPartition(PLAYER_PARTITION);
    // A plain Chrome UA: some videos and features are gated on a known browser.
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ ikvj\/\S+/, ''));
    this.view = new OffscreenView(id, deps, {
      session: ses,
      autoplayPolicy: 'no-user-gesture-required',
    });
  }

  start(): void {
    this.createWindow(this.deps.store.get());
    this.statusTimer = setInterval(() => void this.reportStatus(), STATUS_MS);
  }

  dispose(): void {
    this.unsubscribe();
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.view.destroy();
  }

  command(cmd: Command): void {
    const wc = this.contents();
    if (!wc) return;
    switch (cmd.type) {
      case 'player/togglePlay':
        return this.run(inject(togglePlay));
      case 'player/seek':
        return this.run(inject(seekTo, cmd.time));
      case 'player/skip':
        return this.run(inject(skipBy, cmd.delta));
      case 'player/back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        return;
      case 'player/reload':
        return wc.reload();
    }
  }

  input(ev: PointerInput): void {
    const wc = this.contents();
    if (!wc) return;
    const x = Math.round(ev.x * VIEW_W);
    const y = Math.round(ev.y * VIEW_H);
    const modifiers = ev.modifiers;
    switch (ev.kind) {
      case 'down':
      case 'up':
        wc.sendInputEvent({
          type: ev.kind === 'down' ? 'mouseDown' : 'mouseUp',
          x,
          y,
          button: ev.button,
          clickCount: Math.max(1, ev.clickCount),
          modifiers,
        });
        return;
      case 'move':
        wc.sendInputEvent({ type: 'mouseMove', x, y, modifiers });
        return;
      case 'wheel':
        // DOM deltas are "content moves down" positive; Chromium's are inverted.
        wc.sendInputEvent({
          type: 'mouseWheel',
          x,
          y,
          deltaX: -ev.deltaX,
          deltaY: -ev.deltaY,
          canScroll: true,
          modifiers,
        });
        return;
      case 'leave':
        wc.sendInputEvent({ type: 'mouseLeave', x, y, modifiers });
        return;
    }
  }

  private onChange(next: AppState, prev: AppState): void {
    if (next.settings !== prev.settings) {
      // The page is rendered at the output's pixel size; rebuild it.
      this.createWindow(next);
      return;
    }
    const src = next.sources[this.id];
    const was = prev.sources[this.id];
    if (src === was) return;
    const wc = this.contents();
    if (!wc) return;
    if (src.url !== was.url && src.url !== wc.getURL()) void wc.loadURL(src.url).catch(() => {});
    if (src.quality !== was.quality) this.run(inject(setQuality, src.quality));
    if (src.muted !== was.muted) wc.setAudioMuted(src.muted);
  }

  private createWindow(state: AppState): void {
    const wc = this.view.create(state);
    wc.setAudioMuted(state.sources[this.id].muted);
    wc.on('cursor-changed', (_e, type) => {
      this.cursor = CURSORS[type] ?? 'default';
    });
    // YouTube is a SPA: watch <-> browse happens through in-page navigation.
    wc.on('did-navigate', (_e, url) => this.onNavigated(url));
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => isMainFrame && this.onNavigated(url));
    wc.on('dom-ready', () => {
      this.run(inject(setQuality, this.deps.store.get().sources[this.id].quality));
      this.run(inject(installGuest, playerOnlyCss));
    });
    // Links that want a new window open in this one instead.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void wc.loadURL(url).catch(() => {});
      return { action: 'deny' };
    });

    const url = state.sources[this.id].url;
    this.setPage(url ? pageKind(url) : 'browse');
    if (url) void wc.loadURL(url).catch(() => {});
  }

  private contents(): WebContents | null {
    return this.view.contents();
  }

  private setPage(page: PageKind): void {
    this.page = page;
    // Browsing YouTube itself must never reach the projector.
    this.view.setOutput(page !== 'browse');
  }

  private run(code: string): void {
    this.contents()
      ?.executeJavaScript(code)
      .catch(() => {});
  }

  private onNavigated(url: string): void {
    this.setPage(pageKind(url));
    if (/^https?:/.test(url)) {
      this.deps.store.dispatch({ type: 'youtube/navigated', source: this.id, url });
    }
  }

  private async reportStatus(): Promise<void> {
    const wc = this.contents();
    if (!wc) return;
    let video: PlayerStatus['video'] = null;
    if (this.page !== 'browse') {
      video = (await wc.executeJavaScript(inject(readVideo)).catch(() => null)) as PlayerStatus['video'];
    }
    this.deps.onStatus(this.id, {
      url: wc.getURL(),
      title: wc.getTitle(),
      page: this.page,
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      cursor: this.cursor,
      video,
    });
  }
}
