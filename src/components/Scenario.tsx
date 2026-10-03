import { useEffect, useMemo, useState } from 'react';
import { hintsFor } from '../game/scenario';
import { SCENARIOS } from '../scenarios';
import { healthy, useGame } from '../store';

const DIFFICULTY = { 1: 'Tutorial', 2: 'Normal', 3: 'Hard' } as const;

function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return (
    <span className="stars" aria-label={`${n} of ${of} stars`}>
      {'★'.repeat(n)}
      <span className="muted">{'★'.repeat(of - n)}</span>
    </span>
  );
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ScenarioMenu() {
  const { progress, startScenario } = useGame();
  const done = SCENARIOS.filter((s) => progress[s.id]).length;
  return (
    <section className="menu">
      <h2>Scenarios</h2>
      <p className="muted">
        Someone can’t hear something. Find out why and fix it, without breaking anything else. {done} of {SCENARIOS.length} solved.
      </p>
      <div className="cards">
        {SCENARIOS.map((s, i) => {
          const rec = progress[s.id];
          return (
            <button key={s.id} className={`card ${rec ? 'card-done' : ''}`} onClick={() => startScenario(s.id)}>
              <span className="card-num">{i + 1}</span>
              <strong>{s.title}</strong>
              <span className="muted">
                {DIFFICULTY[s.difficulty]}
                {s.timeLimit ? ` · ${formatTime(s.timeLimit)} limit` : ''}
              </span>
              <span className="card-quote">“{s.complaints[0].says}”</span>
              {rec ? <Stars n={rec.stars} /> : <span className="muted">Not solved yet</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function useClock(startedAt: number, stopped: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (stopped) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [stopped]);
  return (now - startedAt) / 1000;
}

/** Complaint, goals, timer and hints, shown above the stage while playing. */
export function ScenarioBar() {
  const { run, sim, showHint, giveUp, timeUp, reset, openMenu } = useGame();
  const seconds = useClock(run?.startedAt ?? Date.now(), !!run?.result);
  const hints = useMemo(() => (run ? hintsFor(run.scenario, sim, healthy().sim, healthy().guards) : []), [run, sim]);
  const limit = run?.scenario.timeLimit;
  useEffect(() => {
    if (run && !run.result && limit && seconds >= limit) timeUp();
  }, [run, limit, seconds, timeUp]);
  if (!run) return null;
  const s = run.scenario;
  const shown = hints.slice(0, run.hintsShown);
  const left = limit ? limit - seconds : undefined;
  // Things the player broke (not the scenario's own fault).
  const youBroke = run.evaluation.collateral.map((g) => g.label).filter((l) => !run.brokenAtStart.includes(l));

  return (
    <section className="scenario-bar">
      <div className="scenario-head">
        <h2>{s.title}</h2>
        <span className={`clock ${left !== undefined && left < 30 ? 'clock-urgent' : ''}`} title={limit ? 'Time left' : 'Time taken'}>
          {formatTime(left ?? seconds)}
        </span>
        <div className="scenario-actions">
          <button onClick={showHint} disabled={run.hintsShown >= hints.length || !!run.result} title="Each hint costs points">
            Hint ({run.hintsShown}/{hints.length})
          </button>
          <button onClick={reset} title="Start this scenario again">
            Restart
          </button>
          <button onClick={giveUp} disabled={!!run.result}>
            Give up
          </button>
          <button onClick={openMenu}>All scenarios</button>
        </div>
      </div>
      {s.intro && <p className="intro">{s.intro}</p>}
      <div className="complaints">
        {s.complaints.map((c, i) => (
          <p key={i} className="bubble">
            <strong>{c.who}:</strong> “{c.says}”
          </p>
        ))}
      </div>
      <ul className="goals">
        {s.win.map((c, i) => (
          <li key={i} className={run.evaluation.met[i] ? 'goal-met' : ''}>
            {run.evaluation.met[i] ? '✓' : '○'} {c.label}
          </li>
        ))}
        <li className={youBroke.length ? '' : 'goal-met'}>
          {youBroke.length ? '○' : '✓'} Nothing else broken
          {youBroke.length > 0 && <span className="muted"> (now missing: {youBroke.join(', ')})</span>}
        </li>
      </ul>
      {shown.length > 0 && (
        <ol className="hints">
          {shown.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Debrief() {
  const { run, openMenu, startScenario, showFix } = useGame();
  const [closed, setClosed] = useState<string | null>(null);
  if (!run?.result || closed === `${run.scenario.id}@${run.startedAt}`) return null;
  const { result, scenario: s } = run;
  const index = SCENARIOS.findIndex((x) => x.id === s.id);
  const next = SCENARIOS[index + 1];
  const won = result.outcome === 'won';
  const close = () => setClosed(`${s.id}@${run.startedAt}`);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Debrief">
      <div className="debrief">
        <h2>{won ? 'Fixed!' : result.outcome === 'time-up' ? 'Out of time' : 'Here’s what was wrong'}</h2>
        {won && result.score && (
          <p className="score">
            <Stars n={result.score.stars} /> {result.score.points} points · {formatTime(result.seconds)} · {run.hintsShown} hint
            {run.hintsShown === 1 ? '' : 's'}
          </p>
        )}
        {run.collateralEver.length > 0 && (
          <p className="alert alert-warn">Along the way you also broke: {run.collateralEver.join(', ')}.</p>
        )}
        <h3>What was wrong</h3>
        <p>{s.cause}</p>
        <h3>Where the signal died</h3>
        <p>{result.debrief.brokeAt}</p>
        {won && result.debrief.path.length > 0 && (
          <>
            <h3>The signal path, working</h3>
            <p className="path">{result.debrief.path.join(' → ')}</p>
          </>
        )}
        <h3>The lesson</h3>
        <p className="lesson">{s.lesson}</p>
        <div className="actions">
          {won && next && <button onClick={() => startScenario(next.id)}>Next: {next.title}</button>}
          {!won && (
            <button
              onClick={() => {
                showFix();
                close();
              }}
            >
              Show me the fix on stage
            </button>
          )}
          <button onClick={() => startScenario(s.id)}>Try again</button>
          <button onClick={openMenu}>All scenarios</button>
          <button onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}
