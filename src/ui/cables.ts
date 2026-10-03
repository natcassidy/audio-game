// What the player can do to a cable: reseat it, swap it for a new one, or
// move one end to another jack on the same device.

import type { Cable, CompiledGraph, PortDef, Rig } from '../engine';

export function reseat(cable: Cable): void {
  if (cable.faults) delete cable.faults.unplugged;
}

/** A fresh cable in the same place: clears every cable fault. */
export function replaceCable(cable: Cable): void {
  delete cable.faults;
}

export function unplug(cable: Cable, end: 'from' | 'to'): void {
  cable.faults = { ...cable.faults, unplugged: cable.faults?.unplugged && cable.faults.unplugged !== end ? 'both' : end };
}

export function moveEnd(cable: Cable, end: 'from' | 'to', port: string): void {
  const e = cable[end];
  if (e) cable[end] = { node: e.node, port };
}

/** Ports on a device a cable end could move to: same connector, nothing else plugged in. */
export function freePorts(rig: Rig, graph: CompiledGraph, cable: Cable, end: 'from' | 'to'): PortDef[] {
  const e = cable[end];
  if (!e) return [];
  const ports = graph.ports.get(e.node) ?? [];
  const current = ports.find((p) => p.id === e.port);
  const taken = new Set<string>();
  for (const c of Object.values(rig.cables)) {
    for (const x of [c.from, c.to]) if (x?.node === e.node && c.id !== cable.id) taken.add(x.port);
  }
  return ports.filter((p) => p.id === e.port || (!taken.has(p.id) && (!current || p.connector === current.connector)));
}

export function isUnplugged(cable: Cable): boolean {
  return !!cable.faults?.unplugged || !cable.from || !cable.to;
}

export function portLabel(graph: CompiledGraph, rig: Rig, end: { node: string; port: string } | null): string {
  if (!end) return 'nothing';
  const port = graph.ports.get(end.node)?.find((p) => p.id === end.port);
  return `${rig.nodes[end.node]?.name ?? end.node} — ${port?.label ?? end.port}`;
}
