// Where things are drawn on the stage view. The engine's positions are
// acoustic (a singer, their mic and their guitar share a spot), so the
// default rig gets a hand-made layout and anything else falls back to
// its engine position.

import type { Rig, Vec2 } from '../engine';

export interface Placement extends Vec2 {
  short: string;
}

/** Stage metres: x across, y from the front edge (0) to the back. Negative y is the house. */
const DEFAULT_LAYOUT: Record<string, Placement> = {
  leader: { x: 6, y: 1.75, short: 'Leader' },
  vox1: { x: 6, y: 1.05, short: 'Vox 1' },
  acoustic: { x: 6.9, y: 1.85, short: 'Acoustic' },
  tuner: { x: 6.9, y: 1.2, short: 'Tuner' },
  'acoustic-di': { x: 7.7, y: 1.5, short: 'Acoustic DI' },
  singer2: { x: 4, y: 1.75, short: 'Singer 2' },
  vox2: { x: 4, y: 1.05, short: 'Vox 2' },
  singer3: { x: 8.4, y: 1.75, short: 'Singer 3' },
  vox3: { x: 8.4, y: 1.05, short: 'Vox 3' },
  singer4: { x: 2.4, y: 2.2, short: 'Singer 4' },
  vox4: { x: 2.4, y: 1.5, short: 'Vox 4' },
  'keys-player': { x: 10.6, y: 3.6, short: 'Keys player' },
  keys: { x: 10.6, y: 3.0, short: 'Keys' },
  vox5: { x: 9.9, y: 3.0, short: 'Vox 5' },
  'keys-di-l': { x: 11.4, y: 3.9, short: 'Keys DI L' },
  'keys-di-r': { x: 11.4, y: 4.5, short: 'Keys DI R' },
  'bass-player': { x: 3.2, y: 4.1, short: 'Bassist' },
  bass: { x: 3.9, y: 4.1, short: 'Bass' },
  vox6: { x: 3.2, y: 3.5, short: 'Vox 6' },
  'bass-di': { x: 3.9, y: 4.8, short: 'Bass DI' },
  'bass-amp': { x: 2.4, y: 5.3, short: 'Bass amp' },
  'spare-amp': { x: 1.3, y: 5.9, short: 'Spare amp' },
  drummer: { x: 6.3, y: 4.3, short: 'Drummer' },
  drums: { x: 6.3, y: 5.15, short: 'Drums' },
  'tom-mic': { x: 7.0, y: 4.85, short: 'Tom' },
  'hihat-mic': { x: 5.6, y: 4.85, short: 'Hi-hat' },
  'room-l': { x: 5.1, y: 5.8, short: 'Room L' },
  'room-r': { x: 7.5, y: 5.8, short: 'Room R' },
  pastor: { x: 4.9, y: 0.65, short: 'Pastor' },
  'tx-wl1': { x: 4.9, y: 0.1, short: 'WL1 pack' },
  associate: { x: 7.1, y: 0.65, short: 'Associate' },
  'tx-wl2': { x: 7.1, y: 0.1, short: 'WL2 pack' },
  host: { x: 9.6, y: 0.85, short: 'Host' },
  'tx-hh': { x: 9.6, y: 0.3, short: 'Handheld' },
  stagebox: { x: 9.2, y: 6.3, short: 'Stagebox' },
  'rx-wl1': { x: 10.6, y: 6.3, short: 'WL1 rx' },
  'rx-wl2': { x: 11.3, y: 6.3, short: 'WL2 rx' },
  'rx-hh': { x: 12.0, y: 6.3, short: 'HH rx' },
  'main-l': { x: 0.5, y: -0.5, short: 'Main L' },
  'main-r': { x: 12.5, y: -0.5, short: 'Main R' },
  'wedge-1': { x: 6, y: 0.5, short: 'Wedge 1' },
  'wedge-2': { x: 3.2, y: 0.9, short: 'Wedge 2' },
  'wedge-3': { x: 9.9, y: 2.3, short: 'Wedge 3' },
  'wedge-4': { x: 2.4, y: 3.2, short: 'Wedge 4' },
  'wedge-5': { x: 7.4, y: 3.9, short: 'Wedge 5' },
  'wedge-6': { x: 8.4, y: 0.5, short: 'Wedge 6' },
  'strip-left': { x: 1.2, y: 2.6, short: 'Power strip L' },
  'strip-right': { x: 11.8, y: 2.0, short: 'Power strip R' },
  congregation: { x: 4, y: -1.7, short: 'Congregation' },
  mixer: { x: 8.5, y: -1.7, short: 'Mixer (FOH)' },
};

export const STAGE = { width: 13, depth: 6.9, house: 2.8 };

export function placementOf(rig: Rig, nodeId: string): Placement {
  const known = DEFAULT_LAYOUT[nodeId];
  const node = rig.nodes[nodeId];
  if (known) return known;
  const pos = node?.position ?? { x: 0.5, y: STAGE.depth - 0.5 };
  // Clamp far-away things (FOH, the congregation) into the house strip.
  return { x: pos.x, y: Math.max(pos.y, -STAGE.house + 0.5), short: (node?.name ?? nodeId).slice(0, 10) };
}
