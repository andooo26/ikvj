import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { parseCommand, parsePointerInput } from '../shared/commands';
import { IPC, type DispatchResult } from '../shared/ipc';
import { YOUTUBE_SOURCE_IDS, type Stats, type YouTubeSourceId } from '../shared/state';
import { Pipeline } from './pipeline';
import { YouTubePlayer } from './sources/youtube';
import { Store } from './store';

const store = new Store();
let pipeline: Pipeline | null = null;
const players = new Map<YouTubeSourceId, YouTubePlayer>();
let mainWindow: BrowserWindow | null = null;

function send(channel: string, ...payload: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...payload);
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0e0e10',
    title: 'ikvj',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    // The offscreen players are windows too, so 'window-all-closed' never
    // fires; without the UI there is no way to control the outputs, so quit.
    app.quit();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
}

ipcMain.handle(IPC.dispatch, (_e, action: unknown) => store.dispatchUnknown(action));
ipcMain.handle(IPC.getState, () => store.get());
ipcMain.handle(IPC.command, (_e, input: unknown): DispatchResult => {
  const parsed = parseCommand(input);
  if (!parsed.ok) return parsed;
  players.get(parsed.command.source)?.command(parsed.command);
  return { ok: true };
});
ipcMain.on(IPC.input, (_e, input: unknown) => {
  const ev = parsePointerInput(input);
  if (ev) players.get(ev.source)?.input(ev);
});
store.subscribe((next) => send(IPC.state, next));

app.whenReady().then(() => {
  pipeline = new Pipeline(store, (stats: Stats) => send(IPC.stats, stats));
  pipeline.start();
  createMainWindow();
  for (const id of YOUTUBE_SOURCE_IDS) {
    const player = new YouTubePlayer(id, {
      store,
      pipeline,
      previewFrame: () =>
        mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.mainFrame : null,
      onStatus: (source, status) => send(IPC.player, source, status),
    });
    players.set(id, player);
    player.start();
  }
});

app.on('will-quit', () => {
  // Players first: their textures must go back before the engine is gone.
  for (const player of players.values()) player.dispose();
  players.clear();
  pipeline?.dispose();
  pipeline = null;
});
