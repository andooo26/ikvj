// Read-only mirror of the main-process state. Components read with the hooks
// and change things only through `dispatch`.

import { useEffect, useState } from 'react';
import type { Action } from '../../shared/actions';
import type { AppState, Stats } from '../../shared/state';

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let live = true;
    window.ikvj.getState().then((s) => live && setState(s));
    const off = window.ikvj.onState(setState);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

export function useStats(): Stats | null {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => window.ikvj.onStats(setStats), []);
  return stats;
}

export async function dispatch(action: Action): Promise<void> {
  const res = await window.ikvj.dispatch(action);
  // Validation failures are programming errors in the UI, not user errors.
  if (!res.ok) console.error(`[ikvj] ${action.type} rejected:`, res.error);
}
