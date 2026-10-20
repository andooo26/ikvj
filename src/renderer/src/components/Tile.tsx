import { OUTPUT_NAMES, type AppState, type SourceId, type Stats } from '../../../shared/state';
import { dispatch } from '../store';
import { OutputStatus } from './OutputStatus';

const KIND_LABEL = { youtube: 'YouTube', gen: '汎用' } as const;

/** One source: header (identity + its own output) and the source body. */
export function Tile({ id, state, stats }: { id: SourceId; state: AppState; stats: Stats | null }) {
  const source = state.sources[id];
  const on = state.outputs[id];
  return (
    <section className="tile" data-kind={source.kind}>
      <header className="tile-head">
        <span className="tile-id">{id}</span>
        <span className="tile-kind">{KIND_LABEL[source.kind]}</span>
        <div className="spacer" />
        <OutputStatus
          name={OUTPUT_NAMES[id]}
          on={on}
          fps={stats?.sourceFps[id] ?? 0}
          clients={stats?.clients[id]}
        />
        <button
          className={on ? 'toggle on' : 'toggle'}
          aria-pressed={on}
          onClick={() => dispatch({ type: 'output/set', source: id, on: !on })}
          title={`${OUTPUT_NAMES[id]} として個別に出力`}
        >
          出力
        </button>
      </header>
      <div className="tile-body">
        <div className="placeholder">No source</div>
      </div>
    </section>
  );
}
