import { BLEED_COST, cableName } from './compile';
import { lanePointId, portPointId, type Edge, type EdgeKind, type PointId } from './graph';
import { componentAt, type ComponentReading } from './probe';
import { CONTENT_WINDOW_DB, SILENT, classify, isProbe, levelDb } from './signal';
import type { Simulation } from './simulate';
import type { Flag, Level, Signal } from './types';

/** Extra cost for crossing a blocked edge: trace prefers routes that need the fewest fixes. */
const CLOSED_COST = 1000;
/** Crossing a closed selector (wrong patch/source/frequency) costs more than a single fault. */
const CLOSED_SELECTOR_COST = 1500;

/** A point id, a node (its default listening/output point), or a specific port. */
export type TraceTarget = PointId | { node: string; port?: string };

export interface TraceHop {
  point: PointId;
  label: string;
  nodeId: string;
  /** Level of the traced source at this point. */
  level: Level;
  db: number;
  flags: Flag[];
  /** The edge that leads into this hop (absent for the first hop). */
  via?: { kind: EdgeKind; open: boolean; cableId?: string; block?: string };
}

export interface TraceBreak {
  /** Index of the first hop the signal fails to reach. */
  hop: number;
  kind: 'blocked' | 'faded';
  reason: string;
  nodeId?: string;
  cableId?: string;
}

export type TraceIssueKind = 'low' | 'buried' | 'hot' | 'clipping' | 'noise' | Flag;

export interface TraceIssue {
  hop: number;
  kind: TraceIssueKind;
  message: string;
}

export interface TraceResult {
  source: string;
  sourceLabel: string;
  destination: string;
  /** True when the route is intact and the source is audible at the destination. */
  reached: boolean;
  /** The source's level at the destination by any route (including bleed). */
  arrives: ComponentReading;
  /** Best route from source to destination: the one needing the fewest fixes. */
  path: TraceHop[];
  /** The first point where the signal dies, and why. */
  break?: TraceBreak;
  /** Problems along the working part of the route (weak, overloaded, thin, hum…). */
  issues: TraceIssue[];
  /** True when the best route only works because another mic picks the source up acoustically. */
  viaBleed: boolean;
  /** Places the signal reaches but can't continue from (unplugged jacks, loose cables). */
  deadEnds: string[];
  /** Set when there's no route at all. */
  noRoute?: string;
}

class MinHeap {
  private items: { key: PointId; cost: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(key: PointId, cost: number) {
    const a = this.items;
    a.push({ key, cost });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent].cost <= a[i].cost) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): { key: PointId; cost: number } {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function loudestDb(sig: Signal): number {
  let max = -Infinity;
  for (const [key, comp] of Object.entries(sig)) if (!isProbe(key)) max = Math.max(max, comp.db);
  return max;
}

function edgeKey(from: PointId, to: PointId): string {
  return `${from}>${to}`;
}

function edgeCost(e: Edge, preferred: Set<string> | undefined): number {
  if (preferred?.has(edgeKey(e.from, e.to))) return e.gain === -Infinity ? CLOSED_COST : 0.5;
  if (e.gain !== -Infinity) return e.cost;
  return (e.selector ? CLOSED_SELECTOR_COST : CLOSED_COST) + e.cost;
}

function resolveTarget(sim: Simulation, target: TraceTarget): { points: PointId[]; label: string } {
  const g = sim.graph;
  if (typeof target === 'string') {
    if (g.points.has(target)) return { points: [target], label: g.points.get(target)!.label };
    target = { node: target };
  }
  const node = sim.rig.nodes[target.node];
  const nodeName = node?.name ?? target.node;
  if (target.port) {
    const def = g.ports.get(target.node)?.find((p) => p.id === target.port);
    if (def?.lanes) {
      const points: PointId[] = [];
      for (const dir of ['tx', 'rx'] as const) {
        for (let i = 1; i <= def.lanes[dir]; i++) points.push(lanePointId(target.node, def.id, dir, i));
      }
      return { points, label: `${nodeName} ${def.label}` };
    }
    const id = portPointId(target.node, target.port);
    return { points: g.points.has(id) ? [id] : [], label: g.points.get(id)?.label ?? `${nodeName} ${target.port}` };
  }
  const primary = g.primary.get(target.node);
  if (primary?.length) return { points: primary, label: g.points.get(primary[0])?.label ?? nodeName };
  const points = [...g.points.values()].filter((p) => p.nodeId === target.node).map((p) => p.id);
  return { points, label: nodeName };
}

/**
 * Physical outputs the source reaches but can't leave, described in plain
 * language. Most relevant first: a cable that's in the jack but goes nowhere
 * beats an empty jack, and further along the signal path beats earlier.
 */
function findDeadEnds(sim: Simulation, origins: PointId[]): string[] {
  const g = sim.graph;
  const depth = new Map<PointId, number>(origins.map((o) => [o, 0]));
  const queue = [...origins];
  const ends: { message: string; depth: number; cabled: boolean }[] = [];
  const described = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    const out = (g.outbound.get(id) ?? []).filter((e) => e.cost < BLEED_COST);
    const info = g.points.get(id);
    if (info && (info.role === 'port' || info.role === 'lane') && info.port) {
      const def = g.ports.get(info.nodeId)?.find((p) => p.id === info.port);
      const leavesDevice = out.some((e) => e.kind !== 'internal');
      const isOutput = def?.dir === 'out' || (def?.dir === 'io' && id.includes('.tx'));
      const key = `${info.nodeId}.${info.port}`;
      if (def && isOutput && !leavesDevice && !described.has(key)) {
        described.add(key);
        const label = `${sim.rig.nodes[info.nodeId]?.name ?? info.nodeId} ${def.label}`;
        const peer = sim.ctx.peer(info.nodeId, info.port);
        if (!peer) {
          if (!def.optional) ends.push({ message: `Nothing is plugged into ${label}`, depth: d, cabled: false });
        } else {
          const name = cableName(sim.rig, g, peer.cable);
          const issue = g.cables.get(peer.cable.id)?.issue;
          if (!peer.other) {
            ends.push({ message: `The ${name} in ${label} isn't connected to anything at its other end`, depth: d, cabled: true });
          } else if (issue) {
            ends.push({ message: `The ${name} from ${label} goes nowhere useful: ${issue.toLowerCase()}`, depth: d, cabled: true });
          }
        }
      }
    }
    for (const e of out) {
      if (!depth.has(e.to)) {
        depth.set(e.to, d + 1);
        queue.push(e.to);
      }
    }
  }
  return ends
    .sort((a, b) => Number(b.cabled) - Number(a.cabled) || b.depth - a.depth)
    .map((e) => e.message);
}

const FLAG_MESSAGES: Partial<Record<Flag, (src: string, at: string) => string>> = {
  thin: (s, at) => `${s} loses its low end at ${at} (sounds thin)`,
  distorted: (s, at) => `${s} is distorted at ${at} (something is overloaded)`,
  intermittent: (s, at) => `${s} cuts in and out at ${at}`,
  interference: (s, at) => `${s} has interference at ${at} (two transmitters on one frequency)`,
  bleed: (s, at) => `${s} is only picked up as bleed by ${at}, not by its own mic or input`,
  feedback: (s, at) => `Feedback at ${at} (with ${s})`,
};

/** Dijkstra from all origins. Blocked edges are allowed but expensive, so the
 *  route that needs the fewest fixes wins. */
function shortestRoute(
  sim: Simulation,
  origins: PointId[],
  dest: Set<PointId>,
  allowBleed: boolean,
  preferred: Set<string> | undefined,
): { found: PointId; edges: Edge[] } | undefined {
  const g = sim.graph;
  const cost = new Map<PointId, number>();
  const prev = new Map<PointId, Edge>();
  const heap = new MinHeap();
  for (const o of origins) {
    cost.set(o, 0);
    heap.push(o, 0);
  }
  while (heap.size) {
    const { key, cost: c } = heap.pop();
    if (c > (cost.get(key) ?? Infinity)) continue;
    if (dest.has(key)) {
      const edges: Edge[] = [];
      for (let p = key; prev.has(p); p = prev.get(p)!.from) edges.unshift(prev.get(p)!);
      return { found: key, edges };
    }
    for (const e of g.outbound.get(key) ?? []) {
      if (!allowBleed && e.cost >= BLEED_COST) continue;
      const next = c + edgeCost(e, preferred);
      if (next < (cost.get(e.to) ?? Infinity)) {
        cost.set(e.to, next);
        prev.set(e.to, e);
        heap.push(e.to, next);
      }
    }
  }
  return undefined;
}

/**
 * Follows a source to a destination and reports the route, the first place
 * the signal dies (with the reason), and anything that degrades it on the way.
 */
export interface TraceOptions {
  /**
   * A route to favour when several need the same number of fixes, usually the
   * trace of the same source in a known-good rig. Scenarios pass this so hints
   * follow the route the system is meant to use.
   */
  prefer?: TraceResult | PointId[];
}

export function trace(sim: Simulation, source: string, target: TraceTarget, opts: TraceOptions = {}): TraceResult {
  const g = sim.graph;
  const sourceLabel = g.sources.get(source)?.label ?? source;
  const dest = resolveTarget(sim, target);
  const origins = [...new Set(g.injections.filter((i) => i.source === source).map((i) => i.point))];
  const base = {
    source,
    sourceLabel,
    destination: dest.label,
    issues: [] as TraceIssue[],
    viaBleed: false,
  };
  const arrivesAt = (p: PointId | undefined) =>
    p ? componentAt(sim, p, source) : { db: -Infinity, level: 'none' as Level, flags: [] };

  if (origins.length === 0) {
    return { ...base, reached: false, arrives: arrivesAt(dest.points[0]), path: [], deadEnds: [], noRoute: `There is no source called "${source}"` };
  }
  if (dest.points.length === 0) {
    return { ...base, reached: false, arrives: arrivesAt(undefined), path: [], deadEnds: [], noRoute: `There is nothing called "${dest.label}" to trace to` };
  }

  // Look for a direct route first; fall back to routes through bleed (another
  // mic hearing the source acoustically) only when there is no direct route.
  const destSet = new Set(dest.points);
  const preferPoints = Array.isArray(opts.prefer) ? opts.prefer : opts.prefer?.path.map((h) => h.point);
  const preferred = preferPoints ? new Set(preferPoints.slice(1).map((p, i) => edgeKey(preferPoints[i], p))) : undefined;
  let route = shortestRoute(sim, origins, destSet, false, preferred);
  let deadEnds: string[] = [];
  let noRoute: string | undefined;
  if (!route) {
    deadEnds = findDeadEnds(sim, origins);
    noRoute = deadEnds[0] ?? `Nothing connects ${sourceLabel} to ${dest.label}`;
    route = shortestRoute(sim, origins, destSet, true, preferred);
    if (!route) {
      return { ...base, reached: false, arrives: arrivesAt(dest.points[0]), path: [], deadEnds, noRoute };
    }
  }
  const { found, edges } = route;
  const points = [edges.length ? edges[0].from : found, ...edges.map((e) => e.to)];

  const path: TraceHop[] = points.map((point, i) => {
    const info = g.points.get(point);
    const comp = componentAt(sim, point, source);
    const hop: TraceHop = { point, label: info?.label ?? point, nodeId: info?.nodeId ?? '', level: comp.level, db: comp.db, flags: comp.flags };
    const e = edges[i - 1];
    if (e) {
      hop.via = { kind: e.kind, open: e.gain !== -Infinity };
      if (e.cableId) hop.via.cableId = e.cableId;
      if (e.block) hop.via.block = e.block;
    }
    return hop;
  });

  let brk: TraceBreak | undefined;
  const blockedAt = edges.findIndex((e) => e.gain === -Infinity);
  if (blockedAt >= 0) {
    const e = edges[blockedAt];
    brk = { hop: blockedAt + 1, kind: 'blocked', reason: e.block ?? 'Signal is blocked here' };
    if (e.nodeId) brk.nodeId = e.nodeId;
    if (e.cableId) brk.cableId = e.cableId;
  } else {
    const faded = path.findIndex((h) => h.level === 'none');
    if (faded >= 0) {
      brk = {
        hop: faded,
        kind: 'faded',
        reason: `${sourceLabel} fades out at ${path[faded].label}: the level is too low to hear (check gain, volume knobs and faders before this point)`,
        nodeId: path[faded].nodeId,
      };
    }
  }

  // Issues on the working part of the route.
  const issues: TraceIssue[] = [];
  const seenKinds = new Set<string>();
  const add = (hop: number, kind: TraceIssueKind, message: string) => {
    if (seenKinds.has(kind)) return;
    seenKinds.add(kind);
    issues.push({ hop, kind, message });
  };
  const end = brk ? brk.hop : path.length;
  for (let i = 0; i < end; i++) {
    const hop = path[i];
    const before = i > 0 ? path[i - 1] : undefined;
    for (const f of hop.flags) {
      if (before?.flags.includes(f)) continue;
      const msg = FLAG_MESSAGES[f];
      if (msg) add(i, f, msg(sourceLabel, f === 'bleed' ? (sim.rig.nodes[hop.nodeId]?.name ?? hop.label) : hop.label));
    }
    const sig = sim.signals.get(hop.point) ?? SILENT;
    const domain = sim.domains.get(hop.point) ?? 'line';
    const total = classify(levelDb(sig), domain);
    if (hop.level !== 'none') {
      // A source quieter than the rest of a mix is normal; only call it out
      // when the whole point is weak or the source is buried under the rest.
      const balance = g.points.get(hop.point)?.balance;
      if (total === 'low' && !balance) add(i, 'low', `${sourceLabel} is weak at ${hop.label} (level is low)`);
      else if (hop.db < loudestDb(sig) - CONTENT_WINDOW_DB) {
        add(i, 'buried', `${sourceLabel} is buried at ${hop.label}: it's much quieter than everything else there`);
      }
    }
    if (total === 'clipping') add(i, 'clipping', `${hop.label} is overloaded (clipping)`);
    else if (total === 'hot') add(i, 'hot', `${hop.label} is running hot`);
    for (const key of Object.keys(sig)) {
      const info = g.sources.get(key);
      if (!info || (info.kind !== 'noise' && info.kind !== 'feedback')) continue;
      const prevSig = before ? sim.signals.get(before.point) : undefined;
      if (prevSig?.[key] || classify(sig[key].db, domain) === 'none') continue;
      add(i, 'noise', `${info.label} is mixed in at ${hop.label}`);
    }
  }

  const viaBleed = edges.some((e) => e.cost >= BLEED_COST);
  const arrives = arrivesAt(found);
  return {
    ...base,
    reached: !noRoute && !brk && arrives.level !== 'none',
    arrives,
    path,
    ...(brk ? { break: brk } : {}),
    issues,
    viaBleed,
    deadEnds,
    ...(noRoute ? { noRoute } : {}),
  };
}

/** One-paragraph plain-language summary of a trace, for hints and debriefs. */
export function explainTrace(t: TraceResult): string {
  if (t.noRoute) {
    const faint = t.arrives.level !== 'none' ? ` It's only heard faintly, as bleed through other mics.` : '';
    return `${t.sourceLabel} can't reach ${t.destination}. ${t.noRoute}.${faint}`;
  }
  if (t.break) {
    const at = t.path[t.break.hop];
    return `${t.sourceLabel} stops before ${at?.label ?? t.destination}. ${t.break.reason}.`;
  }
  const route = `${t.sourceLabel} reaches ${t.destination}`;
  const notes = t.issues.map((i) => i.message);
  return notes.length ? `${route}, but: ${notes.join('; ')}.` : `${route}.`;
}
