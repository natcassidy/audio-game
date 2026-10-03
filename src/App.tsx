import { Inspector } from './components/Inspector';
import { MixerPanel } from './components/MixerPanel';
import { Debrief, ScenarioBar, ScenarioMenu } from './components/Scenario';
import { Glyph, StageView, type Shape } from './components/StageView';
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
            <div className="stage-wrap">
              <StageView />
              <Legend />
            </div>
            <Inspector />
          </main>
          <MixerPanel />
          <Debrief />
        </>
      )}
    </div>
  );
}

const SHAPE_KEY: [Shape, string][] = [
  ['person', 'person'],
  ['mic', 'mic or body-pack'],
  ['speaker', 'speaker'],
  ['instrument', 'instrument'],
  ['box', 'DI, receiver, power'],
  ['amp', 'amp'],
  ['rack', 'stagebox / mixer'],
];

function Legend() {
  return (
    <div className="legend">
      <div className="legend-row">
        {SHAPE_KEY.map(([shape, label]) => (
          <span key={shape} className={`device shape-${shape}`}>
            <svg viewBox="-32 -14 64 28" className="legend-glyph" aria-hidden="true">
              <g className="glyph">
                <Glyph shape={shape} />
              </g>
            </svg>
            {label}
          </span>
        ))}
      </div>
      <div className="legend-row">
        <span className="legend-title">Cables and speaker outlines:</span>
        <span>
          <i className="sw sw-good" /> good signal
        </span>
        <span>
          <i className="sw sw-low" /> quiet
        </span>
        <span>
          <i className="sw sw-hot" /> too loud
        </span>
        <span>
          <i className="sw sw-none" /> nothing
        </span>
        <span>
          <i className="sw sw-dash" /> unplugged
        </span>
      </div>
    </div>
  );
}
