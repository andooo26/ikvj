// One YouTube (or any URL) source: an offscreen page whose paints go to the
// engine as shared textures, plus a zero-copy preview of the same paints for
// the UI, which the user clicks through (input is forwarded to the page).

import {
  BrowserWindow,
  session,
  sharedTexture,
  type OffscreenSharedTexture,
  type WebContents,
  type WebFrameMain,
} from 'electron';
import type { Command, PointerInput } from '../../shared/commands';
import { RESOLUTIONS, type AppState, type PlayerStatus, type YouTubeSourceId } from '../../shared/state';
import { pageKind, type PageKind } from '../../shared/youtube';
import type { Pipeline } from '../pipeline';
import type { Store } from '../store';
import playerOnlyCss from '../youtube/player-only.css?raw';
import { inject, installGuest, readVideo, seekTo, setQuality, skipBy, togglePlay } from '../youtube/guest';

/** Page layout size in CSS px; deviceScaleFactor scales it to the output. */
const VIEW_W = 960;
const VIEW_H = 540;
const PREVIEW_FPS = 30;
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

/**
 * A paint texture shared by the engine and the preview. It goes back to
 * Electron only when both are done with it.
 */
class Lease {
  private refs = 1;
  constructor(private readonly texture: OffscreenSharedTexture) {}
  get info() {
    return this.texture.textureInfo;
  }
  retain(): void {
    this.refs++;
  }
  release = (): void => {
    if (--this.refs === 0) this.texture.release();
  };
}

export interface PlayerDeps {
  store: Store;
  pipeline: Pipeline;
  /** Where previews are sent: the main window's top frame, if it is up. */
  previewFrame: () => WebFrameMain | null;
  onStatus: (id: YouTubeSourceId, status: PlayerStatus) => void;
}

export class YouTubePlayer {
  private win: BrowserWindow | null = null;
  private page: PageKind = 'other';
  private cursor = 'default';
  private previewInFlight = false;
  private lastPreview = 0;
  private statusTimer: NodeJS.Timeout | null = null;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly id: YouTubeSourceId,
    private readonly deps: PlayerDeps,
  ) {
    this.unsubscribe = deps.store.subscribe((next, prev) => this.onChange(next, prev));
  }

  start(): void {
    this.createWindow(this.deps.store.get());
    this.statusTimer = setInterval(() => void this.reportStatus(), STATUS_MS);
  }

  dispose(): void {
    this.unsubscribe();
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.destroyWindow();
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
      this.destroyWindow();
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
    const { height } = RESOLUTIONS[state.settings.resolution];
    const ses = session.fromPartition(PLAYER_PARTITION);
    // A plain Chrome UA: some videos and features are gated on a known browser.
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ ikvj\/\S+/, ''));

    const win = new BrowserWindow({
      width: VIEW_W,
      height: VIEW_H,
      show: false,
      webPreferences: {
        session: ses,
        offscreen: { useSharedTexture: true, deviceScaleFactor: height / VIEW_H },
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        sandbox: true,
        contextIsolation: true,
      },
    });
    this.win = win;
    const wc = win.webContents;
    wc.setFrameRate(state.settings.fps);
    wc.setAudioMuted(state.sources[this.id].muted);

    wc.on('paint', (event) => {
      if (event.texture) this.onPaint(event.texture);
    });
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
    this.page = url ? pageKind(url) : 'browse';
    this.deps.pipeline.clearSource(this.id);
    if (url) void wc.loadURL(url).catch(() => {});
  }

  private destroyWindow(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private contents(): WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  private run(code: string): void {
    this.contents()
      ?.executeJavaScript(code)
      .catch(() => {});
  }

  private onNavigated(url: string): void {
    const page = pageKind(url);
    // Leaving a watch page: the last video frame must not linger in the output.
    if (page === 'browse' && this.page !== 'browse') this.deps.pipeline.clearSource(this.id);
    this.page = page;
    if (/^https?:/.test(url)) {
      this.deps.store.dispatch({ type: 'youtube/navigated', source: this.id, url });
    }
  }

  private onPaint(texture: OffscreenSharedTexture): void {
    const lease = new Lease(texture);
    if (this.page !== 'browse') {
      lease.retain();
      this.deps.pipeline.submitFrame(this.id, lease.info, lease.release);
    }
    this.sendPreview(lease);
    lease.release();
  }

  /** Zero-copy preview of the raw page (also while browsing, to click on). */
  private sendPreview(lease: Lease): void {
    const frame = this.deps.previewFrame();
    const now = performance.now();
    if (!frame || this.previewInFlight || now - this.lastPreview < 1000 / PREVIEW_FPS) return;
    let imported: Electron.SharedTextureImported;
    lease.retain();
    try {
      // The paint texture must outlive every reference to the import.
      imported = sharedTexture.importSharedTexture({
        textureInfo: lease.info,
        allReferencesReleased: lease.release,
      });
    } catch {
      lease.release();
      return;
    }
    this.previewInFlight = true;
    this.lastPreview = now;
    sharedTexture
      .sendSharedTexture({ frame, importedSharedTexture: imported }, this.id)
      .catch(() => {})
      .finally(() => {
        imported.release();
        this.previewInFlight = false;
      });
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
