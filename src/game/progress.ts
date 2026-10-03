// Saved progress in localStorage. Every access is guarded: storage can be
// unavailable (private windows, blocked site data) and the game must still work.

export interface ScenarioRecord {
  stars: 1 | 2 | 3;
  points: number;
  bestSeconds: number;
}

export type Progress = Record<string, ScenarioRecord>;

const KEY = 'church-sound-sim.progress.v1';

export function loadProgress(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Progress {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? (JSON.parse(raw) as Progress) : {};
  } catch {
    return {};
  }
}

/** Keeps the best stars, points and time per scenario. */
export function recordResult(progress: Progress, id: string, result: ScenarioRecord): Progress {
  const prev = progress[id];
  const next: ScenarioRecord = prev
    ? {
        stars: Math.max(prev.stars, result.stars) as 1 | 2 | 3,
        points: Math.max(prev.points, result.points),
        bestSeconds: Math.min(prev.bestSeconds, result.bestSeconds),
      }
    : result;
  return { ...progress, [id]: next };
}

export function saveProgress(progress: Progress, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(progress));
  } catch {
    // Not saved; the game carries on.
  }
}
