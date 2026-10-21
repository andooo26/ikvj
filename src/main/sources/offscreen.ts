// The part every source shares: a hidden offscreen page rendered at the
// output's pixel size, whose paints go to the engine as shared textures and,
// at a lower rate, to the UI as a zero-copy preview of the same frames.

import {
  BrowserWindow,
  sharedTexture,
  type OffscreenSharedTexture,
  type WebContents,
  type WebFrameMain,
  type WebPreferences,
} from 'electron';
import { RESOLUTIONS, type AppState, type SourceId } from '../../shared/state';
import type { Pipeline } from '../pipeline';

/**
 * Page layout size in CSS px. deviceScaleFactor scales it up to the output
 * (x2 at 1080p), so pages stay legible when shrunk into a tile while the
 * texture still has every output pixel.
 */
export const VIEW_W = 960;
export const VIEW_H = 540;
const PREVIEW_FPS = 30;

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

export interface ViewDeps {
  pipeline: Pipeline;
  /** Where previews are sent: the main window's top frame, if it is up. */
  previewFrame: () => WebFrameMain | null;
}

export class OffscreenView {
  private win: BrowserWindow | null = null;
  private outputOn = true;
  private previewInFlight = false;
  private lastPreview = 0;

  constructor(
    private readonly id: SourceId,
    private readonly deps: ViewDeps,
    private readonly prefs: WebPreferences = {},
  ) {}

  /** (Re)create the page for the current output settings. */
  create(state: AppState): WebContents {
    this.destroy();
    const { height } = RESOLUTIONS[state.settings.resolution];
    const win = new BrowserWindow({
      width: VIEW_W,
      height: VIEW_H,
      show: false,
      webPreferences: {
        ...this.prefs,
        offscreen: { useSharedTexture: true, deviceScaleFactor: height / VIEW_H },
        // Hidden pages get throttled to a crawl otherwise.
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.win = win;
    const wc = win.webContents;
    wc.setFrameRate(state.settings.fps);
    wc.on('paint', (event) => {
      if (event.texture) this.onPaint(event.texture);
    });
    this.deps.pipeline.clearSource(this.id);
    return wc;
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  contents(): WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  /**
   * Whether paints reach the engine. Off = the slot shows black but the
   * preview keeps going (e.g. while browsing YouTube to pick a video).
   */
  setOutput(on: boolean): void {
    if (on === this.outputOn) return;
    this.outputOn = on;
    // The last frame must not linger in the output.
    if (!on) this.deps.pipeline.clearSource(this.id);
  }

  private onPaint(texture: OffscreenSharedTexture): void {
    const lease = new Lease(texture);
    if (this.outputOn) {
      lease.retain();
      this.deps.pipeline.submitFrame(this.id, lease.info, lease.release);
    }
    this.sendPreview(lease);
    lease.release();
  }

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
}
