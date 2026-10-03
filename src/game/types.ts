// Scenario file format. Scenarios are JSON (src/scenarios/*.json) so they're
// easy to write and review without touching code.

import type { Flag, Level } from '../engine';

/** Set a value in the rig by dotted path, e.g. "nodes.wedge-3.props.power.switch". */
export interface Change {
  path: string;
  value: unknown;
}

interface ConditionBase {
  /** What the player is trying to achieve, shown as a checklist line. */
  label: string;
  /** The exact fix, given as the last hint if trace() can't explain it. */
  hint?: string;
}

/** A source reaches a point (directly, not just as bleed). */
export interface HearsCondition extends ConditionBase {
  kind: 'hears';
  point: string;
  source: string;
  /** Minimum level of the source at the point (default: audible at all). */
  atLeast?: Level;
  /** Minimum dB of the source at the point. */
  minDb?: number;
}

/** A source must NOT reach a point (hum in the mains, the wrong mix in a wedge). */
export interface SilentCondition extends ConditionBase {
  kind: 'silent';
  point: string;
  source: string;
}

/** A source reaches a point without a flag (distorted, thin, …). */
export interface CleanCondition extends ConditionBase {
  kind: 'clean';
  point: string;
  source: string;
  flag: Flag;
}

/** The total level at a point is one of these. */
export interface LevelCondition extends ConditionBase {
  kind: 'level';
  point: string;
  in: Level[];
}

/** A source is about equally loud at two points (e.g. Main L and Main R). */
export interface BalancedCondition extends ConditionBase {
  kind: 'balanced';
  a: string;
  b: string;
  source: string;
  maxDiffDb: number;
}

export interface NoFeedbackCondition extends ConditionBase {
  kind: 'noFeedback';
}

/** The mixer's faders control Main again. */
export interface MixerModeCondition extends ConditionBase {
  kind: 'mixerMode';
  mode: string;
}

export type Condition =
  | HearsCondition
  | SilentCondition
  | CleanCondition
  | LevelCondition
  | BalancedCondition
  | NoFeedbackCondition
  | MixerModeCondition;

export interface Complaint {
  who: string;
  says: string;
}

export interface Scenario {
  id: string;
  title: string;
  /** 1 = tutorial, 2 = normal, 3 = hard. */
  difficulty: 1 | 2 | 3;
  /** Shown before the first complaint on easy scenarios: what to try. */
  intro?: string;
  complaints: Complaint[];
  /** Faults applied to the healthy default rig. */
  setup: Change[];
  win: Condition[];
  /** General nudges, given before trace-based hints. */
  hints?: string[];
  /** Seconds. Optional countdown. */
  timeLimit?: number;
  /** A known fix (used by tests, and to show the answer if the player gives up). */
  solution: Change[];
  /** What was actually wrong, for the debrief. */
  cause: string;
  /** The real-world lesson, for the debrief. */
  lesson: string;
}
