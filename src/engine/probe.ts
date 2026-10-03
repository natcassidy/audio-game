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
    const lanes: { sig: Signal; domain: Domain }[] = [];
    for (const dir of ['tx', 'rx'] as const) {
      for (let i = 1; i <= def.lanes[dir]; i++) lanes.push({ sig: signalAt(sim, lanePointId(nodeId, portId, dir, i)), domain: 'line' });
    }
    return readingOfLanes(sim, name, lanes);
  }
  return probePoint(sim, portPointId(nodeId, portId));
}

function readingOfLanes(sim: Simulation, label: string, lanes: { sig: Signal; domain: Domain }[]): ProbeReading {
  // A multi-channel link (the network cable) reports its loudest channel,
  // not the sum of all of them, and lists everything it carries.
  let sig: Signal = SILENT;
  let best: { sig: Signal; domain: Domain } | undefined;
  for (const lane of lanes) {
    sig = mixSignals(sig, lane.sig);
    if (!best || levelDb(lane.sig) > levelDb(best.sig)) best = lane;
  }
  const domain = best?.domain ?? 'line';
  const r = reading(sim, label, sig, domain);
  if (lanes.length <= 1) return r;
  const db = best ? levelDb(best.sig) : -Infinity;
  return { ...r, db, level: classify(db, domain) };
}

/** What's travelling down a cable (nothing if it's unplugged, broken or miswired). */
export function probeCable(sim: Simulation, cableId: string): ProbeReading {
  const link = sim.graph.cables.get(cableId);
  const cable = sim.rig.cables[cableId];
  const lanes = (link?.edges ?? []).map((id) => ({
    sig: sim.edgeSignals.get(id) ?? SILENT,
    domain: sim.domains.get(sim.graph.edges[id].from) ?? ('line' as Domain),
  }));
  return readingOfLanes(sim, cable?.label ?? cableId, lanes);
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
