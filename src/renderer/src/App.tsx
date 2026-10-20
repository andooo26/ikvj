import { SOURCE_IDS } from '../../shared/state';
import { Mixer } from './components/Mixer';
import { Tile } from './components/Tile';
import { TopBar } from './components/TopBar';
import { useAppState, usePlayers, useStats } from './store';

export function App() {
  const state = useAppState();
  const stats = useStats();
  const players = usePlayers();
  if (!state) return null;

  return (
    <div className="app">
      <TopBar state={state} stats={stats} />
      <main className="grid">
        {SOURCE_IDS.map((id) => (
          <Tile key={id} id={id} state={state} stats={stats} players={players} />
        ))}
      </main>
      <Mixer state={state} stats={stats} />
    </div>
  );
}
