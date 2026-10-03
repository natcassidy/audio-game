import type { Scenario } from '../game/types';

// Every scenario JSON in this folder, in file-name order.
const files = import.meta.glob<{ default: Scenario }>('./*.json', { eager: true });

export const SCENARIOS: Scenario[] = Object.keys(files)
  .sort()
  .map((k) => files[k].default);

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
