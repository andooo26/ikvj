// Diagnostics for tracking down slow projection on Windows. Everything here is
// off unless the app is launched with --ikvj-diag; the other switches change how
// the projector runs, so one machine can compare variants side by side:
//
//   --ikvj-diag                  log one JSON line per second to userData/diag.jsonl
//   --ikvj-proj=noframes         open the projector but never send it a frame
//   --ikvj-proj=reuse            import the output texture once, not every frame
//   --ikvj-proj=30fps            send the projector at most 30 frames a second
//   --ikvj-proj-windowed         a 1280×720 window on the display, not fullscreen
//   --ikvj-no-vsync              Chromium: disable GPU vsync and the frame-rate limit

import { app, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type ProjectorMode = 'normal' | 'noframes' | 'reuse' | '30fps';

const MODES: readonly ProjectorMode[] = ['normal', 'noframes', 'reuse', '30fps'];

function switchValue(name: string): string | null {
  return app.commandLine.hasSwitch(name) ? app.commandLine.getSwitchValue(name) : null;
}

export const diag = {
  enabled: app.commandLine.hasSwitch('ikvj-diag'),
  projectorMode: ((m) => (MODES.includes(m as ProjectorMode) ? (m as ProjectorMode) : 'normal'))(
    switchValue('ikvj-proj'),
  ),
  projectorWindowed: app.commandLine.hasSwitch('ikvj-proj-windowed'),
  noVsync: app.commandLine.hasSwitch('ikvj-no-vsync'),
};

// Must run before 'ready' to reach the GPU process.
if (diag.noVsync) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}

/** Running min/avg/max of a duration, reset every report. */
export class Timing {
  private n = 0;
  private sum = 0;
  private max = 0;

  add(ms: number): void {
    this.n++;
    this.sum += ms;
    if (ms > this.max) this.max = ms;
  }

  take(): { n: number; avg: number; max: number } {
    const r = { n: this.n, avg: this.n ? +(this.sum / this.n).toFixed(2) : 0, max: +this.max.toFixed(2) };
    this.n = this.sum = this.max = 0;
    return r;
  }
}

/** Projector-side figures, filled in by projector.ts. */
export const projectorDiag = {
  /** importSharedTexture (synchronous, on the main thread). */
  importMs: new Timing(),
  /** sendSharedTexture until the page has drawn the frame. */
  sendMs: new Timing(),
  /** Frames skipped because the previous one was still in flight. */
  busy: 0,
  errors: 0,
  lastError: null as string | null,
};

/**
 * Start the once-a-second log. `extra` supplies the app's own stats (fps
 * figures); the rest is measured here: how late main-thread timers fire (a
 * blocked main thread stalls the mix, the players and the UI alike) and CPU
 * per Chromium process type (a pegged GPU process means the compositor is the
 * bottleneck).
 */
export function startDiagLog(extra: () => unknown): void {
  if (!diag.enabled) return;
  const file = path.join(app.getPath('userData'), 'diag.jsonl');
  const out = fs.createWriteStream(file, { flags: 'a' });

  const lag = new Timing();
  let expected = performance.now() + 10;
  setInterval(() => {
    const now = performance.now();
    lag.add(Math.max(0, now - expected));
    expected = now + 10;
  }, 10);

  const write = (o: unknown) => out.write(JSON.stringify(o) + '\n');
  write({
    t: new Date().toISOString(),
    kind: 'start',
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: `${process.platform} ${process.arch}`,
    switches: { ...diag },
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      hz: d.displayFrequency,
      primary: d.id === screen.getPrimaryDisplay().id,
    })),
    gpuFeatures: app.getGPUFeatureStatus(),
  });
  app
    .getGPUInfo('basic')
    .then((info) => write({ t: new Date().toISOString(), kind: 'gpu', info }))
    .catch(() => {});

  setInterval(() => {
    const cpu: Record<string, number> = {};
    for (const m of app.getAppMetrics()) {
      cpu[m.type] = +((cpu[m.type] ?? 0) + m.cpu.percentCPUUsage).toFixed(1);
    }
    const { busy, errors, lastError } = projectorDiag;
    projectorDiag.busy = projectorDiag.errors = 0;
    write({
      t: new Date().toISOString(),
      app: extra(),
      mainLagMs: lag.take(),
      cpu,
      projector: {
        importMs: projectorDiag.importMs.take(),
        sendMs: projectorDiag.sendMs.take(),
        busy,
        errors,
        lastError,
      },
    });
  }, 1000);
  console.log(`[ikvj] diagnostics -> ${file}`);
}
