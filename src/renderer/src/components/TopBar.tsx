import { useRef, useState } from 'react';
import {
  FRAME_RATES,
  MAX_BPM,
  MIN_BPM,
  RESOLUTIONS,
  type AppState,
  type FrameRate,
  type Resolution,
  type Stats,
} from '../../../shared/state';
import { dispatch } from '../store';

/** Taps further apart than this start a new measurement. */
const TAP_RESET_MS = 2000;
const TAP_WINDOW = 5;

function BpmControl({ bpm }: { bpm: number }) {
  const taps = useRef<number[]>([]);
  // Local draft so typing "1" on the way to "128" isn't rejected mid-edit.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (Number.isFinite(v)) {
      dispatch({ type: 'clock/setBpm', bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, v)) });
    }
    setDraft(null);
  };

  const tap = () => {
    const now = Date.now();
    const t = taps.current;
    const last = t.at(-1);
    if (last !== undefined && now - last > TAP_RESET_MS) t.length = 0;
    t.push(now);
    if (t.length > TAP_WINDOW) t.shift();
    const first = t[0];
    if (first !== undefined && t.length >= 2) {
      const bpm = 60000 / ((now - first) / (t.length - 1));
      dispatch({
        type: 'clock/setBpm',
        bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm * 10) / 10)),
      });
    }
    // The tap itself is a beat, so the grid lines up with it.
    dispatch({ type: 'clock/sync', at: now });
  };

  return (
    <div className="group">
      <span className="label">BPM</span>
      <input
        className="bpm num"
        type="number"
        min={MIN_BPM}
        max={MAX_BPM}
        step={0.1}
        value={draft ?? bpm}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <button onClick={tap} title="拍に合わせて数回タップ">
        Tap
      </button>
      <button onClick={() => dispatch({ type: 'clock/sync', at: Date.now() })} title="今を1拍目にそろえる">
        Sync
      </button>
    </div>
  );
}

export function TopBar({ state, stats }: { state: AppState; stats: Stats | null }) {
  const { settings } = state;
  return (
    <header className="topbar">
      <span className="wordmark">ikvj</span>
      <BpmControl bpm={state.clock.bpm} />
      <div className="spacer" />
      <div className="group">
        <span className="label">出力</span>
        <select
          value={settings.resolution}
          onChange={(e) => dispatch({ type: 'settings/set', resolution: e.target.value as Resolution })}
        >
          {Object.entries(RESOLUTIONS).map(([key, r]) => (
            <option key={key} value={key}>
              {key} ({r.width}×{r.height})
            </option>
          ))}
        </select>
        <select
          value={settings.fps}
          onChange={(e) => dispatch({ type: 'settings/set', fps: Number(e.target.value) as FrameRate })}
        >
          {FRAME_RATES.map((f) => (
            <option key={f} value={f}>
              {f}fps
            </option>
          ))}
        </select>
      </div>
      <span className="muted" title="GPU エンジン">
        {stats?.engine ?? '…'}
      </span>
    </header>
  );
}
