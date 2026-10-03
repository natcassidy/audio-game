import { lanePointId, portPointId, type PointId } from './graph';
import { SILENT, classify, contentLabel, contentOf, levelDb, mixSignals, type ContentItem } from './signal';
import type { Simulation } from './simulate';
import type { Domain, Flag, Level, Signal } from './types';

export interface ProbeReading {
  label: string;
  domain: Domain;
  db: number;
  level: Level;
  content: ContentItem[];
  /** e.g. "Bass + Leader vocal" */
  summary: string;
}

function reading(sim: Simulation, label: string, sig: Signal, domain: Domain): ProbeReading {
  const labelOf = (s: string) => sim.graph.sources.get(s)?.label ?? s;
  const content = contentOf(sig, domain, labelOf);
  const db = levelDb(sig);
  return { label, domain, db, level: classify(db, domain), content, summary: contentLabel(content) };
}

export function signalAt(sim: Simulation, point: PointId): Signal {
  return sim.signals.get(point) ?? SILENT;
}

export function probePoint(sim: Simulation, point: PointId): ProbeReading {
  const info = sim.graph.points.get(point);
  return reading(sim, info?.label ?? point, signalAt(sim, point), sim.domains.get(point) ?? 'line');
}

/** Probe a physical port. Network ports report everything on all their lanes. */
export function probePort(sim: Simulation, nodeId: string, portId: string): ProbeReading {
  const def = sim.graph.ports.get(nodeId)?.find((p) => p.id === portId);
  const name = `${sim.rig.nodes[nodeId]?.name ?? nodeId} ${def?.label ?? portId}`;
  if (def?.lanes) {
    let sig: Signal = SILENT;
    for (const dir of ['tx', 'rx'] as const) {
      for (let i = 1; i <= def.lanes[dir]; i++) sig = mixSignals(sig, signalAt(sim, lanePointId(nodeId, portId, dir, i)));
    }
    return reading(sim, name, sig, 'line');
  }
  return probePoint(sim, portPointId(nodeId, portId));
}

/** What's travelling down a cable (nothing if it's unplugged, broken or miswired). */
export function probeCable(sim: Simulation, cableId: string): ProbeReading {
  const link = sim.graph.cables.get(cableId);
  const cable = sim.rig.cables[cableId];
  const label = cable?.label ?? cableId;
  let sig: Signal = SILENT;
  let domain: Domain = 'line';
  for (const id of link?.edges ?? []) {
    sig = mixSignals(sig, sim.edgeSignals.get(id) ?? SILENT);
    const edge = sim.graph.edges[id];
    domain = sim.domains.get(edge.from) ?? domain;
  }
  return reading(sim, label, sig, domain);
}

export interface ComponentReading {
  db: number;
  level: Level;
  flags: Flag[];
}

/** Level of one source at a point, classified in that point's domain. */
export function componentAt(sim: Simulation, point: PointId, source: string): ComponentReading {
  const comp = signalAt(sim, point)[source];
  const domain = sim.domains.get(point) ?? 'line';
  if (!comp) return { db: -Infinity, level: 'none', flags: [] };
  return { db: comp.db, level: classify(comp.db, domain), flags: comp.flags };
}

/** Does `source` reach `point` at (at least) the given level? */
export function carries(sim: Simulation, point: PointId, source: string, atLeast: Level = 'low'): boolean {
  const order: Level[] = ['none', 'low', 'good', 'hot', 'clipping'];
  return order.indexOf(componentAt(sim, point, source).level) >= order.indexOf(atLeast);
}
