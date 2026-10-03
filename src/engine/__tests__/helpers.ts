import { createDefaultRig } from '../rigs/default';
import type { MixerProps } from '../devices/mixer';
import type { StageboxProps } from '../devices/stagebox';
import { carries, componentAt } from '../probe';
import { simulate, type Simulation } from '../simulate';
import type { Rig } from '../types';

export function freshRig(): Rig {
  return createDefaultRig();
}

export function mixer(rig: Rig): MixerProps {
  return rig.nodes.mixer.props as MixerProps;
}

export function stagebox(rig: Rig): StageboxProps {
  return rig.nodes.stagebox.props as StageboxProps;
}

export function props<T>(rig: Rig, id: string): T {
  const node = rig.nodes[id];
  if (!node) throw new Error(`No node ${id}`);
  return node.props as T;
}

/** Simulate the default rig after applying a change. */
export function simWith(change: (rig: Rig) => void = () => {}): Simulation {
  const rig = freshRig();
  change(rig);
  return simulate(rig);
}

export function hears(sim: Simulation, point: string, source: string): boolean {
  return carries(sim, point, source);
}

/** Heard through its own route, not just as bleed through other mics. */
export function hearsDirect(sim: Simulation, point: string, source: string): boolean {
  return carries(sim, point, source) && !componentAt(sim, point, source).flags.includes('bleed');
}

export function levelOf(sim: Simulation, point: string, source: string) {
  return componentAt(sim, point, source).level;
}

/** Source ids in the default rig. */
export const SRC = {
  leader: 'leader:voice',
  singer2: 'singer2:voice',
  keysVox: 'keys-player:voice',
  bassVox: 'bass-player:voice',
  pastor: 'pastor:voice',
  associate: 'associate:voice',
  host: 'host:voice',
  bass: 'bass',
  keys: 'keys',
  acoustic: 'acoustic',
  tom: 'drums:tom',
  hihat: 'drums:hihat',
  kit: 'drums:kit',
} as const;

export const MAIN_L = 'mixer.main.l';
export const MAIN_R = 'mixer.main.r';
export const wedge = (n: number) => `wedge-${n}.sound`;
export const ch = (n: number) => `mixer.ch${n}.pre`;
