// Google sign-in for the players (YouTube Premium = no ads).
//
// Google refuses sign-in from embedded browsers ("This browser or app may not
// be secure"). The giveaway is Chromium's Client Hints (Sec-CH-UA*), which
// name Electron regardless of the UA string. So sign-in runs in its own window
// on the players' session, presenting a Firefox UA (Firefox never sends Client
// Hints) with every sec-ch-ua* header stripped. The cookies it gets land in
// the shared session, so both players are signed in.

import { BrowserWindow } from 'electron';
import type { LoginState } from '../../shared/ipc';
import { playerSession } from '../youtube/session';

// The same route as YouTube's own "Sign in" button: continuing through
// /signin?action_handle_signin=true is what makes YouTube set its own cookies.
const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=/');
const DONE_PREFIX = 'https://www.youtube.com/';

// Keep reasonably current: Google turns away browsers it considers outdated.
const FIREFOX_UA =
  process.platform === 'win32'
    ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0'
    : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0';

const GOOGLE_URLS = ['https://accounts.google.com/*', 'https://*.google.com/*'];

let loginWindow: BrowserWindow | null = null;

/**
 * Strip Client Hints from Google requests on the players' session. A session
 * keeps one listener per webRequest event (a later one replaces it), so call
 * this exactly once, at startup.
 */
export function installGoogleHeaderFilter(): void {
  playerSession().webRequest.onBeforeSendHeaders({ urls: GOOGLE_URLS }, (details, cb) => {
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase().startsWith('sec-ch-ua')) delete headers[name];
    }
    cb({ requestHeaders: headers });
  });
}

/**
 * Open the sign-in window (or focus it). `onDone` gets the new state once it
 * closes, whether sign-in finished or the user gave up.
 */
export function openGoogleLogin(parent: BrowserWindow | null, onDone: (state: LoginState) => void): void {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 480,
    height: 720,
    parent: parent ?? undefined,
    title: 'Google ログイン',
    webPreferences: { session: playerSession(), sandbox: true, contextIsolation: true },
  });
  loginWindow = win;
  win.webContents.setUserAgent(FIREFOX_UA);
  // did-navigate fires once the whole redirect chain has committed, so the
  // cookies set along the way are stored by then.
  win.webContents.on('did-navigate', (_e, url) => {
    if (url.startsWith(DONE_PREFIX)) win.close();
  });
  win.on('closed', () => {
    loginWindow = null;
    getLoginState().then(onDone, () => onDone({ loggedIn: false }));
  });
  void win.loadURL(LOGIN_URL).catch(() => {});
}

/**
 * Signed in = one of the SAPISID cookies YouTube authenticates requests with.
 * (LOGIN_INFO is not required: a sign-in that skips YouTube's /signin step
 * still has the SAPISIDs.)
 */
export async function getLoginState(): Promise<LoginState> {
  const cookies = await playerSession().cookies.get({ domain: '.youtube.com' });
  const names = new Set(cookies.map((c) => c.name));
  return { loggedIn: names.has('SAPISID') || names.has('__Secure-3PAPISID') };
}

/** Drop YouTube and Google storage, cookies included, for the whole domains. */
export async function logout(): Promise<LoginState> {
  await playerSession().clearData({
    origins: ['https://www.youtube.com', 'https://accounts.google.com'],
  });
  return getLoginState();
}
