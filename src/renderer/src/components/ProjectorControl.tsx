import { OUTPUT_IDS, type AppState, type OutputId, type Stats } from '../../../shared/state';
import { dispatch } from '../store';

/**
 * Pick an output and a display, then open it fullscreen there. Esc in the
 * projector window closes it too.
 */
export function ProjectorControl({ state, stats }: { state: AppState; stats: Stats | null }) {
  const { target, displayId, open } = state.projector;
  const displays = stats?.displays ?? [];
  // Until one is chosen, suggest a display that isn't the main screen: a
  // projector is rarely where the UI lives.
  const chosen = displays.find((d) => d.id === displayId) ?? displays.find((d) => !d.primary) ?? displays[0];

  const toggle = async () => {
    if (open) return dispatch({ type: 'projector/setOpen', open: false });
    if (!chosen) return;
    if (chosen.id !== displayId) await dispatch({ type: 'projector/set', displayId: chosen.id });
    await dispatch({ type: 'projector/setOpen', open: true });
  };

  return (
    <div className="group">
      <span className="label">Projector</span>
      <select
        value={target}
        onChange={(e) => dispatch({ type: 'projector/set', target: e.target.value as OutputId })}
        aria-label="プロジェクターに出すもの"
      >
        {OUTPUT_IDS.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <select
        value={chosen?.id ?? ''}
        onChange={(e) => dispatch({ type: 'projector/set', displayId: Number(e.target.value) })}
        disabled={displays.length === 0}
        aria-label="ディスプレイ"
      >
        {displays.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label} · {d.width}×{d.height}
            {d.primary ? '（メイン）' : ''}
          </option>
        ))}
      </select>
      <button
        className={open ? 'toggle on' : 'toggle'}
        aria-pressed={open}
        onClick={toggle}
        disabled={!open && !chosen}
        title="選んだディスプレイに全画面で出力（投影中は Esc でも閉じる）"
      >
        {open ? '投影中' : '投影'}
      </button>
      {open && <span className="num muted">{stats?.projectorFps ?? 0}fps</span>}
    </div>
  );
}
