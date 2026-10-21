import type { PlayerStatuses } from '../../../shared/ipc';
import { OUTPUT_NAMES, type AppState, type SourceId, type Stats } from '../../../shared/state';
import { dispatch } from '../store';
import { GenSource } from './GenSource';
import { OutputStatus } from './OutputStatus';
import { YouTubeSource } from './YouTubeSource';

const KIND_LABEL = { youtube: 'YouTube', gen: '汎用' } as const;

/** One source: header (identity + its own output) and the source body. */
export function Tile({
  id,
  state,
  stats,
  players,
}: {
  id: SourceId;
  state: AppState;
  stats: Stats | null;
  players: PlayerStatuses;
}) {
  const source = state.sources[id];
  const on = state.outputs[id];
  const title = id === 'A' || id === 'B' ? players[id]?.title : undefined;
  return (
    <section className="tile" data-kind={source.kind}>
      <header className="tile-head">
        <span className="tile-id">{id}</span>
        <span className="tile-kind">{KIND_LABEL[source.kind]}</span>
        {title && <span className="tile-title muted">{title}</span>}
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
      {(id === 'A' || id === 'B') && source.kind === 'youtube' && (
        <YouTubeSource id={id} source={source} status={players[id]} />
      )}
      {(id === 'C' || id === 'D') && source.kind === 'gen' && <GenSource id={id} source={source} />}
    </section>
  );
}
