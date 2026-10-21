// The browser session both YouTube players share (and the Google login writes
// into), so signing in once covers both.

import { session, type Session } from 'electron';

const PLAYER_PARTITION = 'persist:youtube';

let configured = false;

export function playerSession(): Session {
  const ses = session.fromPartition(PLAYER_PARTITION);
  if (!configured) {
    configured = true;
    // A plain Chrome UA: some videos and features are gated on a known browser.
    ses.setUserAgent(ses.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ ikvj\/\S+/, ''));
  }
  return ses;
}
