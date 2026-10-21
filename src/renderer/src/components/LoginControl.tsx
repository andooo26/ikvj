import { useEffect, useState } from 'react';
import type { LoginState } from '../../../shared/ipc';

/** Google sign-in shared by both YouTube players (for YouTube Premium). */
export function LoginControl() {
  const [login, setLogin] = useState<LoginState | null>(null);

  useEffect(() => {
    let live = true;
    window.ikvj.getLogin().then((s) => live && setLogin(s));
    const off = window.ikvj.onLogin(setLogin);
    return () => {
      live = false;
      off();
    };
  }, []);

  const loggedIn = login?.loggedIn ?? false;
  return (
    <div className="group">
      <span className="status">
        <span className={loggedIn ? 'dot on' : 'dot'} />
        <span className={loggedIn ? '' : 'muted'}>{loggedIn ? 'ログイン中' : '未ログイン'}</span>
      </span>
      <button
        onClick={() => (loggedIn ? window.ikvj.logout() : window.ikvj.login())}
        disabled={login === null}
        title={
          loggedIn
            ? 'YouTube / Google のログイン情報を消して、両プレイヤーを読み込み直す'
            : 'Google アカウントでログイン（YouTube Premium なら広告なし）'
        }
      >
        {loggedIn ? 'ログアウト' : 'Google ログイン'}
      </button>
    </div>
  );
}
