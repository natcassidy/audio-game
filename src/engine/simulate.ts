import { compile, PROBE_SOURCE } from './compile';
import { DEVICES } from './devices';
import type { BuildCtx, CompiledGraph, Edge, Injection, PointId, ReadoutCtx, Readouts } from './graph';
import { SILENT, addComponent, applyGain, classify, levelDb, mixSignals } from './signal';
import { SPECTRA, type SourceInfo } from './sources';
import type { Domain, Rig, Signal } from './types';

export type FeedbackStatus = 'stable' | 'ringing' | 'feedback';

export interface FeedbackLoop {
  /** Mic (or wireless transmitter) node in the loop. */
  mic: string;
  /** Wedge or main speaker node in the loop. */
  speaker: string;
  /** Round-trip gain: at or above 0 dB the loop runs away. */
  loopGainDb: number;
  status: FeedbackStatus;
}

/** Loop gain at or above this rings audibly. */
export const RINGING_DB = -3;
/** Level of a runaway feedback squeal at the speaker (dB SPL at 1 m). */
const SQUEAL_DB = 112;

export interface Simulation {
  rig: Rig;
  graph: CompiledGraph;
  ctx: BuildCtx;
  signals: Map<PointId, Signal>;
  /** Signal leaving each edge (after its gain), for cable probing. */
  edgeSignals: Map<number, Signal>;
  domains: Map<PointId, Domain>;
  /** Feedback analysis for every mic/speaker pair that can hear each other. */
  feedback: FeedbackLoop[];
  readouts: Record<string, Readouts>;
  warnings: string[];
}

export function sourceInfo(graph: CompiledGraph, key: string): SourceInfo {
  return graph.sources.get(key) ?? { ...PROBE_SOURCE, id: key };
}

function applyEdge(graph: CompiledGraph, edge: Edge, sig: Signal): Signal {
  if (edge.gain === -Infinity || sig === SILENT) return SILENT;
  const shape = edge.shape;
  return applyGain(sig, edge.gain, edge.flags, shape ? (key) => shape(sourceInfo(graph, key)) : undefined);
}

/** Topological order over open edges; points caught in loops come last. */
function evaluationOrder(graph: CompiledGraph): { order: PointId[]; looped: PointId[] } {
  const indegree = new Map<PointId, number>();
  for (const id of graph.points.keys()) indegree.set(id, 0);
  for (const e of graph.edges) {
    if (e.gain === -Infinity) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
  }
  const queue: PointId[] = [];
  for (const [id, d] of indegree) if (d === 0) queue.push(id);
  const order: PointId[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of graph.outbound.get(id) ?? []) {
      if (e.gain === -Infinity) continue;
      const d = indegree.get(e.to)! - 1;
      indegree.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  const done = new Set(order);
  const looped = [...graph.points.keys()].filter((id) => !done.has(id));
  return { order, looped };
}

function resolveDomain(graph: CompiledGraph, domains: Map<PointId, Domain>, id: PointId): Domain {
  const declared = graph.points.get(id)?.domain ?? 'line';
  if (declared !== 'auto') return declared;
  const inbound = graph.inbound.get(id) ?? [];
  const feeder = inbound.find((e) => e.gain !== -Infinity) ?? inbound[0];
  return (feeder && domains.get(feeder.from)) ?? 'line';
}

function propagate(graph: CompiledGraph, injections: Injection[]) {
  const signals = new Map<PointId, Signal>();
  const edgeSignals = new Map<number, Signal>();
  const domains = new Map<PointId, Domain>();
  const injected = new Map<PointId, Injection[]>();
  for (const inj of injections) {
    const list = injected.get(inj.point);
    if (list) list.push(inj);
    else injected.set(inj.point, [inj]);
  }

  const evaluate = (id: PointId) => {
    const domain = resolveDomain(graph, domains, id);
    domains.set(id, domain);
    let sig: Signal = SILENT;
    for (const e of graph.inbound.get(id) ?? []) {
      const out = applyEdge(graph, e, signals.get(e.from) ?? SILENT);
      if (e.cableId) edgeSignals.set(e.id, out);
      sig = mixSignals(sig, out);
    }
    for (const inj of injected.get(id) ?? []) sig = addComponent(sig, inj.source, inj.db, inj.flags);
    for (const fn of graph.processors.get(id) ?? []) sig = fn(sig, domain);
    signals.set(id, sig);
  };

  const { order, looped } = evaluationOrder(graph);
  for (const id of order) evaluate(id);
  // Patching mistakes can make electrical loops (an output cabled back into
  // an input). Settle them with a couple of passes rather than recursing.
  for (let pass = 0; pass < 2; pass++) for (const id of looped) evaluate(id);
  return { signals, edgeSignals, domains, looped };
}

function probeKey(receiverPoint: PointId): string {
  return `~fb:${receiverPoint}`;
}

function analyseFeedback(graph: CompiledGraph, signals: Map<PointId, Signal>): FeedbackLoop[] {
  const loops: FeedbackLoop[] = [];
  for (const { emitter, receiver, gain } of graph.feedbackCouplings) {
    const probe = signals.get(emitter.point)?.[probeKey(receiver.point)];
    if (!probe) continue;
    const loopGainDb = probe.db + gain;
    const status: FeedbackStatus = loopGainDb >= 0 ? 'feedback' : loopGainDb >= RINGING_DB ? 'ringing' : 'stable';
    loops.push({ mic: receiver.nodeId, speaker: emitter.nodeId, loopGainDb, status });
  }
  return loops.sort((a, b) => b.loopGainDb - a.loopGainDb);
}

/**
 * Runs the whole rig: compiles it, propagates every source through the
 * graph, checks every mic/speaker pair for feedback, and collects device
 * readouts (LEDs, meters).
 */
export function simulate(rig: Rig): Simulation {
  const { graph, ctx } = compile(rig);

  // Hidden probes measure the gain from each mic capsule to every speaker,
  // which is what feedback analysis needs.
  const injections: Injection[] = [...graph.injections];
  for (const r of graph.receivers) {
    if (r.kind === 'mic') injections.push({ point: r.point, source: probeKey(r.point), db: 0 });
  }

  let result = propagate(graph, injections);
  const feedback = analyseFeedback(graph, result.signals);

  // Speakers that are feeding back squeal: add that as a source and re-run so
  // everyone downstream (ears, the room) hears it.
  const squealing = [...new Set(feedback.filter((f) => f.status === 'feedback').map((f) => f.speaker))];
  if (squealing.length) {
    for (const nodeId of squealing) {
      const emitter = graph.emitters.find((e) => e.nodeId === nodeId)!;
      const id = `${nodeId}:feedback`;
      graph.sources.set(id, {
        id,
        label: `Feedback squeal (${rig.nodes[nodeId]?.name ?? nodeId})`,
        kind: 'feedback',
        spectrum: SPECTRA.feedback,
      });
      injections.push({ point: emitter.point, source: id, db: SQUEAL_DB, flags: ['feedback'] });
    }
    result = propagate(graph, injections);
  }

  const warnings = [...graph.warnings];
  if (result.looped.length) {
    const nodes = [...new Set(result.looped.map((p) => graph.points.get(p)?.nodeId))].join(', ');
    warnings.push(`Signal loop detected (an output is cabled back into an input) involving: ${nodes}`);
  }

  const sim: Simulation = {
    rig,
    graph,
    ctx,
    signals: result.signals,
    edgeSignals: result.edgeSignals,
    domains: result.domains,
    feedback,
    readouts: {},
    warnings,
  };

  const rctx: ReadoutCtx = {
    ...ctx,
    graph,
    signal: (p) => sim.signals.get(p) ?? SILENT,
    db: (p) => levelDb(sim.signals.get(p) ?? SILENT),
    level: (p) => classify(levelDb(sim.signals.get(p) ?? SILENT), sim.domains.get(p) ?? 'line'),
  };
  for (const node of Object.values(rig.nodes)) {
    const def = DEVICES[node.type];
    if (def?.readouts) sim.readouts[node.id] = def.readouts(node, rctx);
  }
  return sim;
}
