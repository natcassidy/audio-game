import {
  carries,
  cloneRig,
  componentAt,
  createDefaultRig,
  explainTrace,
  probePoint,
  simulate,
  trace,
  type Level,
  type MixerProps,
  type Rig,
  type Simulation,
  type TraceResult,
} from '../engine';
import type { Change, Condition, Scenario } from './types';

/** Sets a value by dotted path, creating objects along the way. */
export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = structuredClone(value);
}

export function applyChanges(rig: Rig, changes: Change[]): Rig {
  for (const c of changes) setPath(rig, c.path, c.value);
  return rig;
}

/** The rig a scenario starts from: the healthy default rig with its faults applied. */
export function startRig(s: Scenario): Rig {
  return applyChanges(createDefaultRig(), s.setup);
}

// --- Win conditions -----------------------------------------------------------


/** Audible through its own route, not just as bleed. */
function hearsDirect(sim: Simulation, point: string, source: string, atLeast: Level = 'low'): boolean {
  return carries(sim, point, source, atLeast) && !componentAt(sim, point, source).flags.includes('bleed');
}

export function isMet(sim: Simulation, c: Condition): boolean {
  switch (c.kind) {
    case 'hears': {
      const db = componentAt(sim, c.point, c.source).db;
      return hearsDirect(sim, c.point, c.source, c.atLeast) && (c.minDb === undefined || db >= c.minDb) && (c.maxDb === undefined || db <= c.maxDb);
    }
    case 'silent':
      return !hearsDirect(sim, c.point, c.source);
    case 'clean':
      return hearsDirect(sim, c.point, c.source) && !componentAt(sim, c.point, c.source).flags.includes(c.flag);
    case 'level':
      return c.in.includes(probePoint(sim, c.point).level);
    case 'balanced': {
      const a = componentAt(sim, c.a, c.source).db;
      const b = componentAt(sim, c.b, c.source).db;
      return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= c.maxDiffDb;
    }
    case 'noFeedback':
      return sim.feedback.every((f) => f.status !== 'feedback');
    case 'mixerMode':
      return (sim.rig.nodes.mixer?.props as MixerProps | undefined)?.selectedMix === c.mode;
  }
}

// --- Collateral damage ----------------------------------------------------------

export interface Guard {
  point: string;
  source: string;
  label: string;
}

/**
 * What works in the healthy rig and must still work at the end: every source
 * in the mains and in each wedge. Breaking one of these is collateral damage
 * (e.g. muting the pastor's mic while chasing a different problem).
 */
export function guardsFor(healthy: Simulation): Guard[] {
  const points = ['mixer.main.l', 'mixer.main.r'];
  for (const n of Object.values(healthy.rig.nodes)) if (n.type === 'wedge') points.push(`${n.id}.sound`);
  const guards: Guard[] = [];
  for (const point of points) {
    const where = healthy.graph.points.get(point)?.label ?? point;
    for (const item of probePoint(healthy, point).content) {
      const kind = healthy.graph.sources.get(item.source)?.kind;
      if (kind === 'noise' || kind === 'feedback') continue;
      if (!hearsDirect(healthy, point, item.source)) continue;
      // Main L and R share one label, so one mistake counts once.
      const place = point.startsWith('mixer.main.') ? 'the mains' : where.replace(/ \(sound\)$/, '');
      guards.push({ point, source: item.source, label: `${item.label} in ${place}` });
    }
  }
  return guards;
}

export function brokenGuards(sim: Simulation, guards: Guard[]): Guard[] {
  const broken = guards.filter((g) => !hearsDirect(sim, g.point, g.source));
  return broken.filter((g, i) => broken.findIndex((x) => x.label === g.label) === i);
}

export interface Evaluation {
  met: boolean[];
  collateral: Guard[];
  won: boolean;
}

export function evaluate(sim: Simulation, s: Scenario, guards: Guard[]): Evaluation {
  const met = s.win.map((c) => isMet(sim, c));
  const collateral = brokenGuards(sim, guards);
  return { met, collateral, won: met.every(Boolean) && collateral.length === 0 };
}

// --- Hints ---------------------------------------------------------------------------

/** The source and point a condition is about, for trace(). */
function focusOf(sim: Simulation, c: Condition): { source: string; point: string } | null {
  switch (c.kind) {
    case 'hears':
    case 'silent':
    case 'clean':
      return { source: c.source, point: c.point };
    case 'balanced': {
      const a = componentAt(sim, c.a, c.source).db;
      const b = componentAt(sim, c.b, c.source).db;
      return { source: c.source, point: a < b ? c.a : c.b };
    }
    default:
      return null;
  }
}

/** Big devices with many internal stages: say which stage, not just the box. */
const INNER_STAGES = new Set(['mixer', 'stagebox']);

function placeName(sim: Simulation, nodeId: string | undefined, cableId?: string, hopLabel?: string): string {
  if (cableId) return `the ${sim.rig.cables[cableId]?.label ?? 'cable'}`;
  const node = sim.rig.nodes[nodeId ?? ''];
  if (!node) return 'the signal path';
  if (hopLabel && INNER_STAGES.has(node.type)) {
    const stage = hopLabel.replace(/ \((sum|pre-fader|post-fader)\)$/, '').replace(new RegExp(`^${node.name} `), '');
    return `the ${node.name.toLowerCase()}'s ${stage}`;
  }
  return node.name;
}

function focusTrace(sim: Simulation, healthy: Simulation, source: string, point: string): TraceResult {
  return trace(sim, source, point, { prefer: trace(healthy, source, point) });
}

/** "Where" and "why" hints for one unmet condition. */
function conditionHints(sim: Simulation, healthy: Simulation, c: Condition): [string, string] {
  if (c.kind === 'noFeedback') {
    const worst = sim.feedback.find((f) => f.status === 'feedback');
    const mic = sim.rig.nodes[worst?.mic ?? '']?.name ?? 'A mic';
    const speaker = sim.rig.nodes[worst?.speaker ?? '']?.name ?? 'a speaker';
    return [
      `${mic} is hearing ${speaker} and sending it straight back: a feedback loop.`,
      c.hint ?? `Turn down how much of that mic goes to ${speaker} (its send in that mix), or the speaker's volume.`,
    ];
  }
  const focus = focusOf(sim, c);
  if (!focus) return [`Check: ${c.label}.`, c.hint ?? c.label];
  const t = focusTrace(sim, healthy, focus.source, focus.point);

  if (c.kind === 'silent') {
    const origin = t.path[0];
    return [`${t.sourceLabel} starts at ${placeName(sim, origin?.nodeId)}.`, c.hint ?? `Stop ${t.sourceLabel} at its source.`];
  }
  if (t.noRoute) return [`Something isn't connected on the way to ${t.destination}.`, c.hint ?? `${t.noRoute}.`];
  if (t.break) {
    const at = t.path[t.break.hop]?.label;
    return [`The signal stops at ${placeName(sim, t.break.nodeId, t.break.cableId, at)}.`, `${t.break.reason}.`];
  }
  const wanted = c.kind === 'clean' ? c.flag : undefined;
  const issue = t.issues.find((i) => (wanted ? i.kind === wanted : true));
  if (issue) {
    const at = t.path[issue.hop];
    return [`Look at ${placeName(sim, at?.nodeId, undefined, at?.label)}.`, c.hint ?? `${issue.message}.`];
  }
  return [`Follow ${t.sourceLabel} to ${t.destination} with the inspector.`, c.hint ?? explainTrace(t)];
}

/**
 * Escalating hints for the current state: the scenario's general nudges,
 * then where the first unmet goal breaks, then exactly why.
 */
export function hintsFor(s: Scenario, sim: Simulation, healthy: Simulation, guards: Guard[]): string[] {
  const general = s.hints ?? [];
  const firstUnmet = s.win.find((c) => !isMet(sim, c));
  if (firstUnmet) return [...general, ...conditionHints(sim, healthy, firstUnmet)];
  const broken = brokenGuards(sim, guards)[0];
  if (broken) {
    const t = focusTrace(sim, healthy, broken.source, broken.point);
    return [
      ...general,
      `That fixed the complaint, but something else broke: ${broken.label} is missing.`,
      t.break ? `${t.break.reason}.` : explainTrace(t),
    ];
  }
  return general;
}

// --- Scoring and debrief --------------------------------------------------------

export interface RunStats {
  seconds: number;
  hintsUsed: number;
  /** Distinct things the player broke along the way (even if fixed later). */
  collateralEvents: number;
}

export interface Score {
  stars: 1 | 2 | 3;
  points: number;
}

export function scoreRun(r: RunStats): Score {
  const points = Math.max(100, Math.round(1000 - 150 * r.hintsUsed - 100 * r.collateralEvents - 2 * Math.max(0, r.seconds - 60)));
  const stars = r.hintsUsed === 0 && r.collateralEvents === 0 ? 3 : r.hintsUsed <= 1 ? 2 : 1;
  return { stars, points };
}

export interface Debrief {
  /** Where the signal was dying at the start, in plain language. */
  brokeAt: string;
  /** The signal path for the first goal, now that it works. */
  path: string[];
}

export function debriefFor(s: Scenario, current: Simulation): Debrief {
  const start = simulate(startRig(s));
  const healthy = simulate(createDefaultRig());
  // "Make X silent" goals have no useful signal path to show.
  const firstFocus = s.win
    .filter((c) => c.kind !== 'silent')
    .map((c) => focusOf(start, c))
    .find(Boolean);
  if (!firstFocus) return { brokeAt: s.cause, path: [] };
  const before = focusTrace(start, healthy, firstFocus.source, firstFocus.point);
  const after = focusTrace(current, healthy, firstFocus.source, firstFocus.point);
  // Keep the hops a person would point at: jacks, mixer channels and buses, and the destination.
  const path = after.path
    .filter((h, i) => i === after.path.length - 1 || h.via?.kind !== 'internal' || /pre-fader|sum\)$/.test(h.label))
    .map((h) => h.label.replace(/ \(sound\)$/, ''));
  return { brokeAt: explainTrace(before), path: [...new Set(path)] };
}

/** A copy of the scenario's starting rig with the known solution applied (tests, "show me"). */
export function solvedRig(s: Scenario): Rig {
  return applyChanges(cloneRig(startRig(s)), s.solution);
}
