import { app, BrowserWindow, ipcMain } from 'electron';
import { parseCommand, parsePointerInput } from '../shared/commands';
import { IPC, type DispatchResult } from '../shared/ipc';
import { GEN_SOURCE_IDS, YOUTUBE_SOURCE_IDS, initialState, type Stats, type YouTubeSourceId } from '../shared/state';
import { diag, startDiagLog } from './diag';
import { getLoginState, installGoogleHeaderFilter, logout, openGoogleLogin } from './auth/google';
import { Pipeline, type PipelineStats } from './pipeline';
import { Projector, listDisplays } from './projector';
import { loadRendererPage, preloadPath } from './renderer-page';
import { GenSource } from './sources/generative';
import { YouTubePlayer } from './sources/youtube';
import { StateFile } from './state-file';
import { Store } from './store';

const stateFile = new StateFile();
// Beat 0 at launch: an epoch of 0 would put the clock billions of beats in,
// where the sketch's sin-based hashing loses precision.
const restored = stateFile.load(initialState());
const store = new Store({ ...restored, clock: { ...restored.clock, beatEpoch: Date.now() } });
stateFile.watch(store);
let pipeline: Pipeline | null = null;
let projector: Projector | null = null;
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

/** Reload both players so they pick up the new cookies. */
function reloadPlayers(): void {
  for (const [source, player] of players) player.command({ type: 'player/reload', source });
}

ipcMain.handle(IPC.login, () => {
  openGoogleLogin(mainWindow, (state) => {
    send(IPC.loginState, state);
    if (state.loggedIn) reloadPlayers();
  });
});
ipcMain.handle(IPC.logout, async () => {
  const state = await logout();
  send(IPC.loginState, state);
  reloadPlayers();
  return state;
});
ipcMain.handle(IPC.getLogin, () => getLoginState());

app.whenReady().then(() => {
  installGoogleHeaderFilter();
  let lastStats: Stats | null = null;
  pipeline = new Pipeline(store, (p: PipelineStats) => {
    const stats: Stats = { ...p, displays: listDisplays(), projectorFps: projector?.framesPerSecond() ?? 0 };
    lastStats = stats;
    send(IPC.stats, stats);
  });
  if (diag.enabled) {
    startDiagLog(() => {
      const { settings, projector: proj } = store.get();
      return {
        settings,
        projector: proj,
        sourceFps: lastStats?.sourceFps,
        mixFps: lastStats?.mixFps,
        projectorFps: lastStats?.projectorFps,
        engine: lastStats?.engine,
        error: lastStats?.error,
      };
    });
  }
  pipeline.start();
  projector = new Projector(store, pipeline);
  projector.start();
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
  stateFile.dispose();
  projector?.dispose();
  projector = null;
  // Sources first: their textures must go back before the engine is gone.
  for (const player of players.values()) player.dispose();
  players.clear();
  for (const gen of gens) gen.dispose();
  gens.length = 0;
  pipeline?.dispose();
  pipeline = null;
});
