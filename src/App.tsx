import { Inspector } from './components/Inspector';
import { MixerPanel } from './components/MixerPanel';
import { StageView } from './components/StageView';
import { useGame } from './store';

export function App() {
  const reset = useGame((s) => s.reset);
  const warnings = useGame((s) => s.sim.warnings);
  return (
    <div className="app">
      <header className="topbar">
        <h1>Church Sound Simulator</h1>
        <span className="muted">Sandbox — everything starts working. Change anything and see what happens.</span>
        <button onClick={reset} title="Put everything back to the working setup">
          Reset rig
        </button>
      </header>
      {warnings.length > 0 && <div className="banner">{warnings.join(' · ')}</div>}
      <main className="workspace">
        <div className="stage-wrap">
          <StageView />
          <Legend />
        </div>
        <Inspector />
      </main>
      <MixerPanel />
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span>
        <i className="sw sw-good" /> good
      </span>
      <span>
        <i className="sw sw-low" /> low
      </span>
      <span>
        <i className="sw sw-hot" /> hot / clipping
      </span>
      <span>
        <i className="sw sw-none" /> no signal
      </span>
      <span>
        <i className="sw sw-dash" /> unplugged
      </span>
    </div>
  );
}
