// Phase 0 spike: can the whole pipeline stay on the GPU?
//
//   offscreen BrowserWindow (useSharedTexture) --paint--> engine.setSource(slot)
//   engine.compose(layers) --> Syphon/Spout senders ikvj-A..D + ikvj-MIX
//   engine.sharedHandle(MIX) --> sharedTexture import --> control window preview
//
// Worst case on purpose: 2 YouTube + 2 generative sources, all five senders on.
// Throwaway code; the real app starts in Phase 1.
//
//   npm run phase0 -- [--size=1920x1080] [--fps=60] [--yt=URL] [--yt2=URL]
//                     [--sources=ABCD] [--audio] [--opacity=1,0,0,0]
//                     [--seconds=N] [--snapshot=out.png]
'use strict';

const { app, BrowserWindow, ipcMain, sharedTexture } = require('electron');
const path = require('node:path');
const { Engine, MIX, listServers, probeReceive } = require('../../native/build/Release/ikvj_native.node');

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v ?? true];
    }),
);
const [W, H] = String(args.size ?? '1920x1080').split('x').map(Number);
const FPS = Number(args.fps ?? 60);
const ENABLED = String(args.sources ?? 'ABCD');
const SECONDS = args.seconds ? Number(args.seconds) : 0; // auto-quit for scripted runs

const SOURCES = [
  { slot: 0, name: 'A', kind: 'youtube', url: args.yt ?? 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  { slot: 1, name: 'B', kind: 'youtube', url: args.yt2 ?? 'https://www.youtube.com/watch?v=LXb3EKWsInQ' },
  { slot: 2, name: 'C', kind: 'gen', hue: 200 },
  { slot: 3, name: 'D', kind: 'gen', hue: 330 },
].filter((s) => ENABLED.includes(s.name));

// Just enough of tubetosyphon's PLAYER_ONLY_CSS to make the frame video-only.
const PLAYER_ONLY_CSS = `
  #masthead-container, #secondary, #below, #comments, ytd-watch-metadata,
  .ytp-chrome-bottom, .ytp-chrome-top, .ytp-gradient-bottom, .ytp-gradient-top,
  .ytp-pause-overlay, .ytp-ce-element { display: none !important; }
  html, body { overflow: hidden !important; background: #000 !important; }
  #movie_player, .html5-video-player, video.html5-main-video {
    position: fixed !important; inset: 0 !important; left: 0 !important; top: 0 !important;
    width: 100vw !important; height: 100vh !important; object-fit: contain !important;
    transform: none !important; z-index: 2147483647 !important;
  }`;

let engine;
let control;
const senders = new Map(); // target -> sender id
const stats = { paints: {}, setSourceMs: {}, errors: {}, composeMs: 0, composes: 0 };
const opacity = Object.fromEntries(
  String(args.opacity ?? '1,0,0,0') // A visible by default
    .split(',')
    .map((v, slot) => [slot, Number(v)]),
);
let order = [0, 1, 2, 3]; // bottom -> top (A at the bottom, D on top)
let preview = { ok: 0, fail: 0, lastError: null };

function resetStats() {
  for (const s of SOURCES) {
    stats.paints[s.name] = 0;
    stats.setSourceMs[s.name] = 0;
  }
  stats.composeMs = 0;
  stats.composes = 0;
  preview.ok = 0;
  preview.fail = 0;
}

function createSource(src) {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: {
      offscreen: { useSharedTexture: true },
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  const wc = win.webContents;
  wc.setFrameRate(FPS);
  wc.setAudioMuted(!args.audio);
  wc.on('paint', (event) => {
    const tex = event.texture;
    if (!tex) return;
    try {
      const info = tex.textureInfo;
      const handle = info.handle.ioSurface ?? info.handle.ntHandle;
      const t0 = performance.now();
      engine.setSource(src.slot, handle, info.pixelFormat);
      stats.setSourceMs[src.name] += performance.now() - t0;
      stats.paints[src.name]++;
    } catch (err) {
      stats.errors[src.name] = String(err.message ?? err);
    } finally {
      tex.release();
    }
  });
  if (src.kind === 'youtube') {
    wc.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
    );
    wc.on('dom-ready', () => wc.insertCSS(PLAYER_ONLY_CSS).catch(() => {}));
    win.loadURL(src.url);
  } else {
    win.loadFile(path.join(__dirname, 'gen.html'), {
      query: { name: src.name, hue: String(src.hue) },
    });
  }
  return win;
}

function mixTick() {
  const t0 = performance.now();
  const layers = order
    .filter((slot) => SOURCES.some((s) => s.slot === slot))
    .map((slot) => ({ slot, opacity: opacity[slot] }));
  engine.compose(layers);
  for (const [target, id] of senders) engine.publish(id, target);
  stats.composeMs += performance.now() - t0;
  stats.composes++;
}

// Zero-copy preview of the mix in the control window.
async function sendPreview() {
  if (!control || control.isDestroyed()) return;
  let imported;
  try {
    const handle = engine.sharedHandle(MIX);
    imported = sharedTexture.importSharedTexture({
      textureInfo: {
        pixelFormat: 'bgra',
        codedSize: { width: W, height: H },
        visibleRect: { x: 0, y: 0, width: W, height: H },
        handle: process.platform === 'darwin' ? { ioSurface: handle } : { ntHandle: handle },
      },
    });
    await sharedTexture.sendSharedTexture({
      frame: control.webContents.mainFrame,
      importedSharedTexture: imported,
    });
    preview.ok++;
  } catch (err) {
    preview.fail++;
    preview.lastError = String(err.message ?? err);
  } finally {
    imported?.release();
  }
}

function report() {
  const cpu = app.getAppMetrics().reduce(
    (acc, m) => {
      acc[m.type] = (acc[m.type] ?? 0) + m.cpu.percentCPUUsage;
      acc.total += m.cpu.percentCPUUsage;
      return acc;
    },
    { total: 0 },
  );
  const line = {
    fps: Object.fromEntries(SOURCES.map((s) => [s.name, stats.paints[s.name]])),
    setSourceMs: Object.fromEntries(
      SOURCES.map((s) => [
        s.name,
        +(stats.setSourceMs[s.name] / Math.max(1, stats.paints[s.name])).toFixed(2),
      ]),
    ),
    mixFps: stats.composes,
    composePublishMs: +(stats.composeMs / Math.max(1, stats.composes)).toFixed(2),
    preview: { ok: preview.ok, fail: preview.fail, lastError: preview.lastError },
    cpu: Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, +v.toFixed(1)])),
    errors: stats.errors,
    // gen.html paints a red TOP-LEFT marker; a receiver must see it top-left.
    orientation: SOURCES.some((s) => s.name === 'C')
      ? {
          slotTopLeft: engine.readPixel(2, 10, 10),
          syphonTopLeft: probeReceive('ikvj-C', 10, 10),
          syphonBottomLeft: probeReceive('ikvj-C', 10, H - 10),
        }
      : null,
    servers: listServers(),
    clients:
      process.platform === 'darwin'
        ? Object.fromEntries([...senders].map(([t, id]) => [t, engine.hasClients(id)]))
        : 'n/a (Spout)',
  };
  console.log('[phase0]', JSON.stringify(line));
  control?.webContents.send('stats', line);
  resetStats();
}

app.whenReady().then(() => {
  engine = new Engine(W, H);
  console.log(`[phase0] engine ${engine.backend} on "${engine.adapter}", ${W}x${H}@${FPS}`);

  for (const s of SOURCES) senders.set(s.slot, engine.createSender(`ikvj-${s.name}`));
  senders.set(MIX, engine.createSender('ikvj-MIX'));
  resetStats();

  control = new BrowserWindow({
    width: 760,
    height: 720,
    title: 'ikvj phase0',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  control.loadFile(path.join(__dirname, 'control.html'), {
    query: { sources: SOURCES.map((s) => s.name).join('') },
  });
  control.on('closed', () => app.quit());

  for (const s of SOURCES) createSource(s);

  setInterval(mixTick, 1000 / FPS);
  setInterval(sendPreview, 1000 / 30);
  setInterval(report, 1000);
  if (SECONDS) {
    setTimeout(async () => {
      if (args.snapshot) {
        const img = await control.webContents.capturePage();
        require('node:fs').writeFileSync(args.snapshot, img.toPNG());
      }
      app.quit();
    }, SECONDS * 1000);
  }
});

ipcMain.on('opacity', (_e, slot, value) => {
  opacity[slot] = value;
});
ipcMain.on('order', (_e, next) => {
  order = next;
});

app.on('will-quit', () => {
  for (const id of senders.values()) engine?.destroySender(id);
  engine?.dispose();
});
