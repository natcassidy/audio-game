import { DEVICES } from './devices';
import {
  firstFailure,
  lanePointId,
  portPointId,
  type BuildCtx,
  type CableLink,
  type CompiledGraph,
  type Edge,
  type EdgeOptions,
  type EmitterInfo,
  type NodeBuilderApi,
  type PeerInfo,
  type PointId,
  type PointInfo,
  type PointRole,
  type PortDef,
  type PowerState,
  type Processor,
  type ReceiverInfo,
  type RfReceiver,
  type RfTransmitter,
} from './graph';
import { SPECTRA, type SourceInfo } from './sources';
import type { Cable, CableEnd, Domain, Flag, NodeInstance, PowerProps, Rig, Vec2 } from './types';

/** Acoustic pickups from non-target emitters are this expensive for trace(), so direct paths win. */
export const BLEED_COST = 1500;
/** Cost of an RF link to a receiver the transmitter isn't paired with. */
const UNPAIRED_RF_COST = 400;
/** Closest distance used for acoustic coupling between things that aren't close-miked. */
const MIN_DISTANCE = 0.5;

class GraphBuilder {
  readonly g: CompiledGraph = {
    points: new Map(),
    edges: [],
    inbound: new Map(),
    outbound: new Map(),
    injections: [],
    processors: new Map(),
    sources: new Map(),
    ports: new Map(),
    primary: new Map(),
    emitters: [],
    receivers: [],
    feedbackCouplings: [],
    rfTransmitters: [],
    rfReceivers: [],
    cables: new Map(),
    warnings: [],
  };

  addPoint(info: PointInfo): PointId {
    if (this.g.points.has(info.id)) this.g.warnings.push(`Duplicate point ${info.id}`);
    this.g.points.set(info.id, info);
    return info.id;
  }

  addEdge(from: PointId, to: PointId, opts: EdgeOptions & { nodeId?: string; cableId?: string }): Edge {
    if (!this.g.points.has(from)) this.g.warnings.push(`Edge from unknown point ${from}`);
    if (!this.g.points.has(to)) this.g.warnings.push(`Edge to unknown point ${to}`);
    const block = firstFailure(opts.gates);
    const gain = opts.gain ?? 0;
    const edge: Edge = {
      id: this.g.edges.length,
      from,
      to,
      kind: opts.kind ?? 'internal',
      gain: block !== undefined || Number.isNaN(gain) ? -Infinity : gain,
      cost: opts.cost ?? 1,
    };
    if (block !== undefined) edge.block = block;
    else if (edge.gain === -Infinity) edge.block = 'Level is turned all the way down';
    if (opts.flags?.length) edge.flags = opts.flags;
    if (opts.shape) edge.shape = opts.shape;
    if (opts.selector) edge.selector = true;
    if (opts.nodeId) edge.nodeId = opts.nodeId;
    if (opts.cableId) edge.cableId = opts.cableId;
    this.g.edges.push(edge);
    push(this.g.inbound, to, edge);
    push(this.g.outbound, from, edge);
    return edge;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function createCtx(rig: Rig): BuildCtx {
  // Index which cable sits in each port (first one wins if two claim the same jack).
  const byPort = new Map<string, { cable: Cable; end: 'from' | 'to' }>();
  for (const cable of Object.values(rig.cables)) {
    for (const end of ['from', 'to'] as const) {
      const e = cable[end];
      if (!e) continue;
      const key = `${e.node}.${e.port}`;
      if (!byPort.has(key)) byPort.set(key, { cable, end });
    }
  }

  const powerCache = new Map<string, PowerState>();

  const ctx: BuildCtx = {
    rig,
    node: (id) => rig.nodes[id],
    positionOf: (id) => rig.nodes[id]?.position,

    power(nodeId) {
      const cached = powerCache.get(nodeId);
      if (cached) return cached;
      // Guard against power strips plugged into each other.
      powerCache.set(nodeId, { on: false, reason: 'Power loop' });
      const result = resolvePower(nodeId);
      powerCache.set(nodeId, result);
      return result;
    },

    peer(nodeId, portId): PeerInfo | null {
      const hit = byPort.get(`${nodeId}.${portId}`);
      if (!hit) return null;
      const { cable, end } = hit;
      const other = end === 'from' ? cable.to : cable.from;
      const intact = !!cable.from && !!cable.to && !cable.faults?.unplugged && !cable.faults?.broken;
      return { cable, end, other, intact };
    },

    phantomAt(nodeId, portId) {
      const p = ctx.peer(nodeId, portId);
      if (!p || !p.intact || !p.other) return false;
      const other = rig.nodes[p.other.node];
      if (!other) return false;
      const def = DEVICES[other.type];
      return def?.phantomOn?.(other, p.other.port, ctx) ?? false;
    },
  };

  function resolvePower(nodeId: string): PowerState {
    const node = rig.nodes[nodeId];
    if (!node) return { on: false, reason: `Unknown device ${nodeId}` };
    const power = (node.props as { power?: PowerProps }).power;
    if (!power) return { on: true };
    if (!power.switch) return { on: false, reason: `${node.name} is switched off` };
    if ((node.props as { tripped?: boolean }).tripped) {
      return { on: false, reason: `${node.name} has tripped its breaker (press reset)` };
    }
    if (power.plug === null) return { on: false, reason: `${node.name}'s power cord is unplugged` };
    if (power.plug === 'wall') return { on: true };
    const strip = rig.nodes[power.plug];
    if (!strip) return { on: false, reason: `${node.name}'s power cord is unplugged` };
    const stripPower = ctx.power(strip.id);
    if (!stripPower.on) {
      return { on: false, reason: `${node.name} is plugged into ${strip.name}, which has no power (${stripPower.reason})` };
    }
    return { on: true };
  }

  return ctx;
}

class NodeBuilder implements NodeBuilderApi {
  private baseGates: [boolean, string][] = [];

  constructor(
    readonly node: NodeInstance,
    private gb: GraphBuilder,
  ) {
    if (node.faults?.broken) this.baseGates.push([false, `${node.name} is faulty (internal failure)`]);
  }

  id(local: string): PointId {
    return `${this.node.id}.${local}`;
  }

  port(def: PortDef): void {
    push(this.gb.g.ports, this.node.id, def);
    const label = `${this.node.name} ${def.label}`;
    if (def.dir === 'io' && def.lanes) {
      for (let i = 1; i <= def.lanes.tx; i++) {
        this.addPoint(lanePointId(this.node.id, def.id, 'tx', i), `${label} out ${i}`, def.domain, 'lane', def.id);
      }
      for (let i = 1; i <= def.lanes.rx; i++) {
        this.addPoint(lanePointId(this.node.id, def.id, 'rx', i), `${label} in ${i}`, def.domain, 'lane', def.id);
      }
    } else {
      this.addPoint(portPointId(this.node.id, def.id), label, def.domain, 'port', def.id);
    }
  }

  private addPoint(id: PointId, label: string, domain: Domain | 'auto', role: PointRole, port?: string) {
    const info: PointInfo = { id, nodeId: this.node.id, label, domain, role };
    if (port) info.port = port;
    this.gb.addPoint(info);
  }

  point(local: string, label: string, domain: Domain | 'auto', role: PointRole = 'internal', opts: { balance?: boolean } = {}): PointId {
    const id = this.id(local);
    this.addPoint(id, label, domain, role);
    if (opts.balance) this.gb.g.points.get(id)!.balance = true;
    return id;
  }

  edge(from: string, to: string, opts: EdgeOptions = {}): void {
    const gates = this.baseGates.length ? [...this.baseGates, ...(opts.gates ?? [])] : opts.gates;
    this.gb.addEdge(this.id(from), this.id(to), { ...opts, gates, nodeId: this.node.id });
  }

  source(part: string | null, label: string, kind: SourceInfo['kind'], spectrum: SourceInfo['spectrum']): string {
    const id = part ? `${this.node.id}:${part}` : this.node.id;
    this.gb.g.sources.set(id, { id, label, kind, spectrum });
    return id;
  }

  inject(local: string, source: string, db: number, flags?: Flag[]): void {
    if (db === -Infinity) return;
    this.gb.g.injections.push({ point: this.id(local), source, db, ...(flags ? { flags } : {}) });
  }

  private position(given?: Vec2): Vec2 {
    return given ?? this.node.position ?? { x: 0, y: 0 };
  }

  emitter(local: string, opts: Omit<EmitterInfo, 'point' | 'nodeId' | 'position'> & { position?: Vec2 }): void {
    const { position, ...rest } = opts;
    this.gb.g.emitters.push({ ...rest, point: this.id(local), nodeId: this.node.id, position: this.position(position) });
  }

  receiver(local: string, opts: Omit<ReceiverInfo, 'point' | 'nodeId' | 'position'> & { position?: Vec2 }): void {
    const { position, ...rest } = opts;
    this.gb.g.receivers.push({ ...rest, point: this.id(local), nodeId: this.node.id, position: this.position(position) });
  }

  process(local: string, fn: Processor): void {
    push(this.gb.g.processors, this.id(local), fn);
  }

  rfTransmitter(local: string, opts: Omit<RfTransmitter, 'point' | 'nodeId'>): void {
    this.gb.g.rfTransmitters.push({ ...opts, point: this.id(local), nodeId: this.node.id });
  }

  rfReceiver(local: string, opts: Omit<RfReceiver, 'point' | 'nodeId'>): void {
    this.gb.g.rfReceivers.push({ ...opts, point: this.id(local), nodeId: this.node.id });
  }

  primary(local: string): void {
    push(this.gb.g.primary, this.node.id, this.id(local));
  }
}

function findPort(g: CompiledGraph, end: CableEnd): PortDef | undefined {
  return g.ports.get(end.node)?.find((p) => p.id === end.port);
}

function portLabel(rig: Rig, g: CompiledGraph, end: CableEnd): string {
  const node = rig.nodes[end.node];
  const port = findPort(g, end);
  return `${node?.name ?? end.node} ${port?.label ?? end.port}`;
}

export function cableName(rig: Rig, g: CompiledGraph, cable: Cable): string {
  if (cable.label) return `"${cable.label}"`;
  const ends = [cable.from, cable.to].filter((e): e is CableEnd => !!e).map((e) => portLabel(rig, g, e));
  return ends.length ? `cable at ${ends.join(' / ')}` : `cable ${cable.id}`;
}

function linkCable(rig: Rig, gb: GraphBuilder, cable: Cable) {
  const g = gb.g;
  const link: CableLink = { edges: [] };
  g.cables.set(cable.id, link);
  if (!cable.from || !cable.to) {
    link.issue = 'One end of the cable is not connected to anything';
    return;
  }
  const a = findPort(g, cable.from);
  const b = findPort(g, cable.to);
  if (!a || !b) {
    link.issue = 'Plugged into a port that does not exist';
    g.warnings.push(`Cable ${cable.id} references a missing port`);
    return;
  }

  const name = cableName(rig, g, cable);
  const unplugged = cable.faults?.unplugged;
  const unpluggedAt =
    unplugged === 'both'
      ? 'both ends'
      : unplugged
        ? `the ${portLabel(rig, g, cable[unplugged]!)} end`
        : '';
  const gates = [
    [!unplugged, `The ${name} is unplugged at ${unpluggedAt}`],
    [!cable.faults?.broken, `The ${name} is broken (no connection inside)`],
  ] as const;
  const opts = {
    gates,
    cableId: cable.id,
    ...(cable.faults?.intermittent ? { gain: -3, flags: ['intermittent' as const] } : {}),
  };

  if (a.dir === 'io' || b.dir === 'io') {
    if (a.dir !== 'io' || b.dir !== 'io' || !a.lanes || !b.lanes) {
      link.issue = 'A network cable only works between two network ports';
      return;
    }
    const lanes = (from: CableEnd, fp: PortDef, to: CableEnd, tp: PortDef) => {
      const n = Math.min(fp.lanes!.tx, tp.lanes!.rx);
      for (let i = 1; i <= n; i++) {
        const e = gb.addEdge(lanePointId(from.node, fp.id, 'tx', i), lanePointId(to.node, tp.id, 'rx', i), {
          ...opts,
          kind: 'network',
        });
        link.edges.push(e.id);
      }
    };
    lanes(cable.from, a, cable.to, b);
    lanes(cable.to, b, cable.from, a);
    return;
  }

  let src: CableEnd;
  let dst: CableEnd;
  if (a.dir === 'out' && b.dir === 'in') [src, dst] = [cable.from, cable.to];
  else if (a.dir === 'in' && b.dir === 'out') [src, dst] = [cable.to, cable.from];
  else {
    link.issue = a.dir === 'out' ? 'Both ends are plugged into outputs' : 'Both ends are plugged into inputs';
    return;
  }
  const e = gb.addEdge(portPointId(src.node, src.port), portPointId(dst.node, dst.port), { ...opts, kind: 'cable' });
  link.edges.push(e.id);
}

function linkRf(gb: GraphBuilder) {
  const g = gb.g;
  for (const rx of g.rfReceivers) {
    const onFreq = g.rfTransmitters.filter((t) => t.active && t.freq === rx.freq);
    for (const tx of g.rfTransmitters) {
      const flags: ('interference' | 'intermittent')[] = [];
      if (onFreq.length > 1) flags.push('interference');
      if (rx.dropouts || tx.batteryLow) flags.push('intermittent');
      gb.addEdge(tx.point, rx.point, {
        kind: 'rf',
        // Receiver power is gated inside the receiver itself.
        gates: [
          [
            tx.freq === rx.freq,
            `${tx.label} is set to ${tx.freq.toFixed(3)} MHz but ${rx.label} is tuned to ${rx.freq.toFixed(3)} MHz`,
          ],
        ],
        gain: flags.includes('interference') ? -6 : flags.includes('intermittent') ? -3 : 0,
        flags,
        cost: !tx.pairedRx || tx.pairedRx === rx.nodeId ? 1 : UNPAIRED_RF_COST,
        selector: true,
        nodeId: rx.nodeId,
      });
    }
  }
}

/** Acoustic gain (dB) from an emitter's "SPL at 1 m" to a receiver, and whether it's bleed. */
export function acousticCoupling(e: EmitterInfo, r: ReceiverInfo): { gain: number; bleed: boolean } {
  const target = r.targets.find((t) => t.point === e.point);
  if (target) return { gain: -20 * Math.log10(Math.max(target.distance, 0.01)), bleed: false };
  let gain = -20 * Math.log10(Math.max(distance(e.position, r.position), MIN_DISTANCE));
  if (e.aim && e.aim !== r.owner) gain -= e.offAxis;
  if (r.kind === 'mic') gain -= r.offAxis;
  return { gain, bleed: r.kind === 'mic' };
}

function linkAcoustic(gb: GraphBuilder) {
  const g = gb.g;
  for (const e of g.emitters) {
    for (const r of g.receivers) {
      const { gain, bleed } = acousticCoupling(e, r);
      if (e.reinforcement && r.kind === 'mic') {
        // Wedges/mains into mics would make the graph cyclic. These are
        // analysed separately as feedback loops instead of propagated.
        g.feedbackCouplings.push({ emitter: e, receiver: r, gain });
        continue;
      }
      gb.addEdge(e.point, r.point, {
        kind: 'acoustic',
        gain,
        cost: bleed ? BLEED_COST : 1,
        ...(bleed ? { flags: ['bleed' as const] } : {}),
      });
    }
  }
}

export const PROBE_SOURCE: SourceInfo = { id: '~probe', label: 'probe', kind: 'probe', spectrum: SPECTRA.flat };

/** Turns a rig into a graph. Pure: the same rig always gives the same graph. */
export function compile(rig: Rig): { graph: CompiledGraph; ctx: BuildCtx } {
  const gb = new GraphBuilder();
  const ctx = createCtx(rig);
  for (const node of Object.values(rig.nodes)) {
    const def = DEVICES[node.type];
    if (!def) {
      gb.g.warnings.push(`Unknown device type "${node.type}" for ${node.id}`);
      continue;
    }
    def.build(node, new NodeBuilder(node, gb), ctx);
  }
  for (const cable of Object.values(rig.cables)) linkCable(rig, gb, cable);
  linkRf(gb);
  linkAcoustic(gb);
  return { graph: gb.g, ctx };
}
