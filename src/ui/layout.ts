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
  // Leader, front centre, with acoustic guitar.
  leader: { x: 6, y: 1.75, short: 'Leader' },
  vox1: { x: 6, y: 1.12, short: 'Vox 1' },
  acoustic: { x: 6.3, y: 1.6, short: 'Acoustic' },
  tuner: { x: 6.75, y: 1.15, short: 'Tuner' },
  'acoustic-di': { x: 7.15, y: 1.6, short: 'Acoustic DI' },
  'wedge-1': { x: 6, y: 0.45, short: 'Wedge 1' },
  // Singers along the front.
  singer2: { x: 3.9, y: 1.75, short: 'Singer 2' },
  vox2: { x: 3.9, y: 1.12, short: 'Vox 2' },
  'wedge-2': { x: 3.6, y: 0.45, short: 'Wedge 2' },
  singer3: { x: 8.5, y: 1.75, short: 'Singer 3' },
  vox3: { x: 8.5, y: 1.12, short: 'Vox 3' },
  'wedge-6': { x: 8.6, y: 0.45, short: 'Wedge 6' },
  singer4: { x: 2.1, y: 2.0, short: 'Singer 4' },
  vox4: { x: 2.1, y: 1.4, short: 'Vox 4' },
  // Keys, stage right.
  'keys-player': { x: 10.6, y: 3.75, short: 'Keys player' },
  keys: { x: 10.6, y: 3.15, short: 'Keys' },
  vox5: { x: 10.0, y: 3.45, short: 'Vox 5' },
  'keys-di-l': { x: 11.6, y: 3.5, short: 'Keys DI L' },
  'keys-di-r': { x: 11.6, y: 3.95, short: 'Keys DI R' },
  'wedge-3': { x: 10.6, y: 2.25, short: 'Wedge 3' },
  // Bass, stage left.
  'bass-player': { x: 3.1, y: 4.1, short: 'Bassist' },
  bass: { x: 3.45, y: 3.85, short: 'Bass' },
  vox6: { x: 3.1, y: 3.45, short: 'Vox 6' },
  'bass-di': { x: 4.1, y: 4.5, short: 'Bass DI' },
  'bass-amp': { x: 2.2, y: 5.0, short: 'Bass amp' },
  'spare-amp': { x: 1.1, y: 5.6, short: 'Spare amp' },
  'wedge-4': { x: 3.1, y: 2.75, short: 'Wedge 4' },
  // Drums, upstage centre: the kit faces the congregation, the drummer sits behind it.
  drums: { x: 6.3, y: 4.6, short: 'Drums' },
  drummer: { x: 6.3, y: 5.45, short: 'Drummer' },
  'tom-mic': { x: 6.85, y: 4.2, short: 'Tom' },
  'hihat-mic': { x: 5.55, y: 4.3, short: 'Hi-hat' },
  'room-l': { x: 5.0, y: 3.75, short: 'Room L' },
  'room-r': { x: 7.6, y: 3.75, short: 'Room R' },
  'wedge-5': { x: 7.35, y: 5.6, short: 'Wedge 5' },
  // Speakers down front.
  pastor: { x: 4.8, y: 0.75, short: 'Pastor' },
  'tx-wl1': { x: 5.15, y: 0.6, short: 'WL1 pack' },
  associate: { x: 7.2, y: 0.75, short: 'Associate' },
  'tx-wl2': { x: 7.55, y: 0.6, short: 'WL2 pack' },
  host: { x: 9.9, y: 1.0, short: 'Host' },
  'tx-hh': { x: 10.25, y: 0.75, short: 'Handheld' },
  // Back line: stagebox and the wireless rack.
  stagebox: { x: 9.3, y: 6.35, short: 'Stagebox' },
  'rx-wl1': { x: 10.75, y: 6.35, short: 'WL1 rx' },
  'rx-wl2': { x: 11.45, y: 6.35, short: 'WL2 rx' },
  'rx-hh': { x: 12.15, y: 6.35, short: 'HH rx' },
  'strip-left': { x: 1.0, y: 2.9, short: 'Power strip L' },
  'strip-right': { x: 12.0, y: 2.4, short: 'Power strip R' },
  // The house.
  'main-l': { x: 0.6, y: -0.45, short: 'Main L' },
  'main-r': { x: 12.4, y: -0.45, short: 'Main R' },
  congregation: { x: 4.2, y: -1.55, short: 'Congregation' },
  mixer: { x: 9.6, y: -1.6, short: 'Mixer (FOH)' },
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

/** A short name for tape labels and the stage map. */
export function shortName(rig: Rig, nodeId: string): string {
  return DEFAULT_LAYOUT[nodeId]?.short ?? (rig.nodes[nodeId]?.name ?? nodeId);
}
