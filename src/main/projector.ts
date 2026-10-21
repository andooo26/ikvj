// Fullscreen output on a chosen display. The window shows one engine target
// (a source or the mix) handed over as a shared texture after every mix frame,
// so the projector gets exactly what Syphon/Spout get, without a CPU copy.

import { BrowserWindow, screen, sharedTexture } from 'electron';
import type { AppState, DisplayInfo } from '../shared/state';
import type { Pipeline } from './pipeline';
import { loadRendererPage, preloadPath } from './renderer-page';
import type { Store } from './store';

/** The preview id the projector page's canvas is registered under. */
const CANVAS_ID = 'projector';

export function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Display ${i + 1}`,
    width: d.size.width,
    height: d.size.height,
    primary: d.id === primaryId,
  }));
}

export class Projector {
  private win: BrowserWindow | null = null;
  private winDisplay: number | null = null;
  private inFlight = false;
  private frames = 0;
  private fps = 0;
  private readonly disposers: (() => void)[] = [];

  constructor(
    private readonly store: Store,
    private readonly pipeline: Pipeline,
  ) {}

  start(): void {
    this.disposers.push(
      this.store.subscribe((next, prev) => {
        if (next.projector !== prev.projector) this.reconcile(next);
      }),
      this.pipeline.onFrame(() => this.sendFrame()),
    );
    const onRemoved = (_e: unknown, d: Electron.Display) => {
      if (d.id === this.store.get().projector.displayId) this.setOpen(false);
    };
    screen.on('display-removed', onRemoved);
    this.disposers.push(() => screen.off('display-removed', onRemoved));
    const fpsTimer = setInterval(() => {
      this.fps = this.win ? this.frames : 0;
      this.frames = 0;
    }, 1000);
    this.disposers.push(() => clearInterval(fpsTimer));
    this.reconcile(this.store.get());
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
    this.close();
  }

  /** Frames drawn in the last second. */
  framesPerSecond(): number {
    return this.fps;
  }

  private setOpen(open: boolean): void {
    this.store.dispatch({ type: 'projector/setOpen', open });
  }

  private reconcile(state: AppState): void {
    const { open, displayId } = state.projector;
    if (open && displayId === null) {
      // Never chosen: prefer a display that isn't the main screen.
      const fallback = listDisplays().find((d) => !d.primary) ?? listDisplays()[0];
      if (fallback) this.store.dispatch({ type: 'projector/set', displayId: fallback.id });
      else this.setOpen(false);
      return; // the dispatch above brings us back here with a display
    }
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    if (!open || !display) {
      this.close();
      if (open) this.setOpen(false); // the chosen display is gone
      return;
    }
    // Moving a fullscreen window between displays is unreliable on both
    // platforms, so a new display means a new window.
    if (this.win && this.winDisplay === display.id) return;
    this.close();
    this.openOn(display);
  }

  private openOn(display: Electron.Display): void {
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      show: false,
      backgroundColor: '#000000',
      title: 'ikvj projector',
      webPreferences: {
        preload: preloadPath('index'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        // It may sit behind other windows on a shared display; keep drawing.
        backgroundThrottling: false,
      },
    });
    this.win = win;
    this.winDisplay = display.id;
    this.inFlight = false;

    win.once('ready-to-show', () => {
      win.show();
      // macOS "simple" fullscreen covers the menu bar without a new Space, so
      // there is no slide animation and the window stays on the projector.
      if (process.platform === 'darwin') win.setSimpleFullScreen(true);
      else win.setFullScreen(true);
      // Focused so Esc reaches it; Esc in the main UI deliberately does nothing,
      // so a stray key during a show can't kill the projection.
      win.focus();
    });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        this.setOpen(false);
      }
    });
    win.on('closed', () => {
      if (this.win !== win) return;
      this.win = null;
      this.winDisplay = null;
      this.setOpen(false); // closed from outside (e.g. Alt+F4)
    });
    loadRendererPage(win.webContents, 'projector');
  }

  private close(): void {
    const win = this.win;
    this.win = null;
    this.winDisplay = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private sendFrame(): void {
    const win = this.win;
    if (!win || win.isDestroyed() || this.inFlight || win.webContents.isLoading()) return;
    const tex = this.pipeline.outputTexture(this.store.get().projector.target);
    if (!tex) return;
    let imported: Electron.SharedTextureImported;
    try {
      imported = sharedTexture.importSharedTexture({
        textureInfo: {
          pixelFormat: 'bgra',
          codedSize: { width: tex.width, height: tex.height },
          visibleRect: { x: 0, y: 0, width: tex.width, height: tex.height },
          handle: process.platform === 'darwin' ? { ioSurface: tex.handle } : { ntHandle: tex.handle },
        },
      });
    } catch {
      return;
    }
    this.inFlight = true;
    sharedTexture
      .sendSharedTexture({ frame: win.webContents.mainFrame, importedSharedTexture: imported }, CANVAS_ID)
      .then(() => this.frames++)
      .catch(() => {})
      .finally(() => {
        imported.release();
        this.inFlight = false;
      });
  }
}
