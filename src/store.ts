import { create } from 'zustand';
import { cloneRig, createDefaultRig, simulate, type Rig, type Simulation } from './engine';
import { loadProgress, recordResult, saveProgress, type Progress } from './game/progress';
import {
  applyChanges,
  brokenGuards,
  debriefFor,
  evaluate,
  guardsFor,
  scoreRun,
  startRig,
  type Debrief,
  type Evaluation,
  type Guard,
  type Score,
} from './game/scenario';
import type { Scenario } from './game/types';
import { scenarioById } from './scenarios';

/** A device, optionally with one of its cables picked out (to inspect or follow). */
export interface Selection {
  id: string;
  cable?: string;
}
export type Screen = 'sandbox' | 'menu' | 'play';

export interface RunResult {
  outcome: 'won' | 'gave-up' | 'time-up';
  seconds: number;
  score?: Score;
  debrief: Debrief;
}

export interface Run {
  scenario: Scenario;
  startedAt: number;
  hintsShown: number;
  /** Guards already broken by the scenario's own faults (not the player's fault). */
  brokenAtStart: string[];
  /** Things the player broke along the way (labels), even if fixed later. */
  collateralEver: string[];
  evaluation: Evaluation;
  result?: RunResult;
}

// The healthy rig never changes, so simulate it once.
let healthyCache: { sim: Simulation; guards: Guard[] } | undefined;
export function healthy() {
  if (!healthyCache) {
    const sim = simulate(createDefaultRig());
    healthyCache = { sim, guards: guardsFor(sim) };
  }
  return healthyCache;
}

interface GameState {
  screen: Screen;
  rig: Rig;
  sim: Simulation;
  selection: Selection | null;
  run: Run | null;
  progress: Progress;
  select(selection: Selection | null): void;
  /** Change the rig. `change` mutates a copy; the simulation re-runs and a scenario is re-checked. */
  update(change: (rig: Rig) => void): void;
  reset(): void;
  openSandbox(): void;
  openMenu(): void;
  startScenario(id: string): void;
  showHint(): void;
  giveUp(): void;
  timeUp(): void;
  /** After giving up: apply the known fix so the player can see it working. */
  showFix(): void;
}

function load(rig: Rig) {
  return { rig, sim: simulate(rig) };
}

function elapsed(run: Run): number {
  return Math.round((Date.now() - run.startedAt) / 1000);
}

/** Re-check a run against the new simulation. */
function advance(run: Run, sim: Simulation, progress: Progress): { run: Run; progress: Progress } {
  const evaluation = evaluate(sim, run.scenario, healthy().guards);
  // A finished run keeps its result, but its checklist still follows the stage.
  if (run.result) return { run: { ...run, evaluation }, progress };
  const newlyBroken = evaluation.collateral.map((g) => g.label).filter((l) => !run.brokenAtStart.includes(l));
  const collateralEver = [...new Set([...run.collateralEver, ...newlyBroken])];
  const next: Run = { ...run, evaluation, collateralEver };
  if (!evaluation.won) return { run: next, progress };
  const seconds = elapsed(run);
  const score = scoreRun({ seconds, hintsUsed: run.hintsShown, collateralEvents: collateralEver.length });
  next.result = { outcome: 'won', seconds, score, debrief: debriefFor(run.scenario, sim) };
  const saved = recordResult(progress, run.scenario.id, { stars: score.stars, points: score.points, bestSeconds: seconds });
  saveProgress(saved);
  return { run: next, progress: saved };
}

function stop(run: Run, outcome: 'gave-up' | 'time-up', sim: Simulation): Run {
  if (run.result) return run;
  return { ...run, result: { outcome, seconds: elapsed(run), debrief: debriefFor(run.scenario, sim) } };
}

export const useGame = create<GameState>((set, get) => ({
  screen: 'sandbox',
  ...load(createDefaultRig()),
  selection: null,
  run: null,
  progress: loadProgress(),
  select: (selection) => set({ selection }),
  update: (change) => {
    const rig = cloneRig(get().rig);
    change(rig);
    const next = load(rig);
    const { run, progress } = get();
    if (run) set({ ...next, ...advance(run, next.sim, progress) });
    else set(next);
  },
  reset: () => {
    const { run } = get();
    if (run) get().startScenario(run.scenario.id);
    else set({ ...load(createDefaultRig()), selection: null });
  },
  openSandbox: () => set({ screen: 'sandbox', run: null, selection: null, ...load(createDefaultRig()) }),
  openMenu: () => set({ screen: 'menu', run: null, selection: null }),
  startScenario: (id) => {
    const scenario = scenarioById(id);
    if (!scenario) return;
    const loaded = load(startRig(scenario));
    const evaluation = evaluate(loaded.sim, scenario, healthy().guards);
    const brokenAtStart = brokenGuards(loaded.sim, healthy().guards).map((g) => g.label);
    set({
      screen: 'play',
      selection: null,
      ...loaded,
      run: { scenario, startedAt: Date.now(), hintsShown: 0, brokenAtStart, collateralEver: [], evaluation },
    });
  },
  showHint: () => {
    const { run } = get();
    if (run && !run.result) set({ run: { ...run, hintsShown: run.hintsShown + 1 } });
  },
  giveUp: () => {
    const { run, sim } = get();
    if (run) set({ run: stop(run, 'gave-up', sim) });
  },
  timeUp: () => {
    const { run, sim } = get();
    if (run) set({ run: stop(run, 'time-up', sim) });
  },
  showFix: () => {
    const { run } = get();
    if (run) get().update((rig) => applyChanges(rig, run.scenario.solution));
  },
}));
