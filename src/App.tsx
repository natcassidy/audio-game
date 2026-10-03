import { Inspector } from './components/Inspector';
import { MixerPanel } from './components/MixerPanel';
import { Debrief, ScenarioBar, ScenarioMenu } from './components/Scenario';
import { StageView } from './components/StageView';
import { useGame } from './store';

export function App() {
  const { screen, reset, openSandbox, openMenu } = useGame();
  const warnings = useGame((s) => s.sim.warnings);
  return (
    <div className="app">
      <header className="topbar">
        <h1>Church Sound Simulator</h1>
        <nav className="tabs">
          <button className={screen === 'sandbox' ? 'active' : ''} onClick={openSandbox} title="Everything working. Change anything.">
            Sandbox
          </button>
          <button className={screen !== 'sandbox' ? 'active' : ''} onClick={openMenu} title="Troubleshooting challenges">
            Scenarios
          </button>
        </nav>
        {screen === 'sandbox' && (
          <button className="push-right" onClick={reset} title="Put everything back to the working setup">
            Reset rig
          </button>
        )}
      </header>
      {screen === 'menu' ? (
        <ScenarioMenu />
      ) : (
        <>
          {warnings.length > 0 && <div className="banner">{warnings.join(' · ')}</div>}
          <ScenarioBar />
          <main className="workspace">
            <StageView />
            <Inspector />
          </main>
          <MixerPanel />
          <Debrief />
        </>
      )}
    </div>
  );
}
