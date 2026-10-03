// Who uses what: each person's mic, wedge, instrument and boxes, so the
// player can jump from a musician to their gear and back.

import type { Rig } from '../engine';

/** Instruments and boxes that belong to a musician's spot (the engine doesn't track this). */
const STATIONS: Record<string, string[]> = {
  leader: ['acoustic', 'tuner', 'acoustic-di'],
  'keys-player': ['keys', 'keys-di-l', 'keys-di-r'],
  'bass-player': ['bass', 'bass-di', 'bass-amp', 'spare-amp'],
  drummer: ['drums', 'tom-mic', 'hihat-mic', 'room-l', 'room-r'],
};

/** Everything a person uses, in a sensible order: mics, wedge, then instruments. */
export function gearOf(rig: Rig, personId: string): string[] {
  const out: string[] = [];
  for (const n of Object.values(rig.nodes)) {
    const p = n.props as { owner?: string; aim?: string };
    if ((n.type === 'mic' || n.type === 'wireless-tx') && p.owner === personId) out.push(n.id);
  }
  for (const n of Object.values(rig.nodes)) {
    if (n.type === 'wedge' && (n.props as { aim?: string }).aim === personId) out.push(n.id);
  }
  for (const id of STATIONS[personId] ?? []) if (rig.nodes[id] && !out.includes(id)) out.push(id);
  return out;
}

/** The person a device belongs to, if any. */
export function userOf(rig: Rig, nodeId: string): string | undefined {
  const node = rig.nodes[nodeId];
  if (!node) return undefined;
  const p = node.props as { owner?: string; aim?: string };
  if ((node.type === 'mic' || node.type === 'wireless-tx') && p.owner) return p.owner;
  if (node.type === 'wedge' && p.aim) return p.aim;
  return Object.keys(STATIONS).find((person) => STATIONS[person].includes(nodeId));
}

/** Devices whose power cord goes into this strip (or wall socket id). */
export function pluggedInto(rig: Rig, stripId: string): string[] {
  return Object.values(rig.nodes)
    .filter((n) => (n.props as { power?: { plug: string | null } }).power?.plug === stripId)
    .map((n) => n.id);
}
