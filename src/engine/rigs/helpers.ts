import type { Cable, CableKind, NodeInstance, Rig, Vec2 } from '../types';

export function node<P>(type: string, id: string, name: string, props: P, position?: Vec2): NodeInstance<P> {
  return { id, type, name, props, ...(position ? { position } : {}) };
}

/** "node.port" → CableEnd. */
function end(ref: string) {
  const dot = ref.indexOf('.');
  return { node: ref.slice(0, dot), port: ref.slice(dot + 1) };
}

export function cable(id: string, kind: CableKind, from: string | null, to: string | null, label?: string): Cable {
  return { id, kind, from: from ? end(from) : null, to: to ? end(to) : null, ...(label ? { label } : {}) };
}

export function rigOf(nodes: NodeInstance[], cables: Cable[]): Rig {
  const rig: Rig = { nodes: {}, cables: {} };
  for (const n of nodes) {
    if (rig.nodes[n.id]) throw new Error(`Duplicate node id ${n.id}`);
    rig.nodes[n.id] = n;
  }
  for (const c of cables) {
    if (rig.cables[c.id]) throw new Error(`Duplicate cable id ${c.id}`);
    rig.cables[c.id] = c;
  }
  return rig;
}

/** Deep copy, so tests and scenarios can mutate freely. */
export function cloneRig(rig: Rig): Rig {
  return structuredClone(rig);
}

/** Finds the cable plugged into a port (either end). */
export function cableAt(rig: Rig, nodeId: string, port: string): Cable | undefined {
  return Object.values(rig.cables).find(
    (c) => (c.from?.node === nodeId && c.from.port === port) || (c.to?.node === nodeId && c.to.port === port),
  );
}
