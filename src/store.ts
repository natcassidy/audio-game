import { create } from 'zustand';
import { cloneRig, createDefaultRig, simulate, type Rig, type Simulation } from './engine';

export type Selection = { kind: 'node'; id: string } | { kind: 'cable'; id: string };

interface GameState {
  rig: Rig;
  sim: Simulation;
  selection: Selection | null;
  select(selection: Selection | null): void;
  /** Change the rig. `change` mutates a copy; the simulation re-runs. */
  update(change: (rig: Rig) => void): void;
  reset(): void;
}

function load(rig: Rig) {
  return { rig, sim: simulate(rig) };
}

export const useGame = create<GameState>((set, get) => ({
  ...load(createDefaultRig()),
  selection: null,
  select: (selection) => set({ selection }),
  update: (change) => {
    const rig = cloneRig(get().rig);
    change(rig);
    set(load(rig));
  },
  reset: () => set({ ...load(createDefaultRig()), selection: null }),
}));
