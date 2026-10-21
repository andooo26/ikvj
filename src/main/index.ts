import { app, BrowserWindow, ipcMain } from 'electron';
import { parseCommand, parsePointerInput } from '../shared/commands';
import { IPC, type DispatchResult } from '../shared/ipc';
import { GEN_SOURCE_IDS, YOUTUBE_SOURCE_IDS, initialState, type Stats, type YouTubeSourceId } from '../shared/state';
import { Pipeline } from './pipeline';
import { loadRendererPage, preloadPath } from './renderer-page';
import { GenSource } from './sources/generative';
import { YouTubePlayer } from './sources/youtube';
import { Store } from './store';

// Beat 0 at launch: an epoch of 0 would put the clock billions of beats in,
// where the sketch's sin-based hashing loses precision.
const initial = initialState();
const store = new Store({ ...initial, clock: { ...initial.clock, beatEpoch: Date.now() } });
let pipeline: Pipeline | null = null;
const players = new Map<YouTubeSourceId, YouTubePlayer>();
const gens: GenSource[] = [];
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
      preload: preloadPath('index'),
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
  loadRendererPage(mainWindow.webContents, 'index');
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
  const previewFrame = () =>
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.mainFrame : null;
  for (const id of YOUTUBE_SOURCE_IDS) {
    const player = new YouTubePlayer(id, {
      store,
      pipeline,
      previewFrame,
      onStatus: (source, status) => send(IPC.player, source, status),
    });
    players.set(id, player);
    player.start();
  }
  for (const id of GEN_SOURCE_IDS) {
    const gen = new GenSource(id, { store, pipeline, previewFrame });
    gens.push(gen);
    gen.start();
  }
});

app.on('will-quit', () => {
  // Sources first: their textures must go back before the engine is gone.
  for (const player of players.values()) player.dispose();
  players.clear();
  for (const gen of gens) gen.dispose();
  gens.length = 0;
  pipeline?.dispose();
  pipeline = null;
});
