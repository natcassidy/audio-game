// The compiled form of a rig: a flat directed graph of points joined by
// edges. Devices describe themselves by adding points and internal edges;
// the compiler adds cable, network, RF and acoustic edges between devices.

import type { Cable, CableEnd, Domain, Flag, NodeInstance, Rig, Signal, Vec2 } from './types';
import type { SourceInfo, SourceKind, Spectrum } from './sources';
import type { Level } from './types';

export type PointId = string;

export type PointRole = 'port' | 'lane' | 'internal' | 'emitter' | 'receiver';

export interface PointInfo {
  id: PointId;
  nodeId: string;
  label: string;
  /** 'auto' takes the domain of whatever feeds it (e.g. a stagebox input fed by a mic or a line source). */
  domain: Domain | 'auto';
  role: PointRole;
  /** Physical port this point belongs to, if any. */
  port?: string;
  /** Level here reflects mix balance (e.g. post-fader), so a low level isn't a fault. */
  balance?: boolean;
}

export type PortDir = 'in' | 'out' | 'io';
export type Connector = 'xlr' | 'quarter-inch' | 'network' | 'speakon';

export interface PortDef {
  id: string;
  label: string;
  dir: PortDir;
  connector: Connector;
  domain: Domain | 'auto';
  /** For network ports: how many channels each way. */
  lanes?: { tx: number; rx: number };
  /** Often left empty (DI thru, headphones), so not worth reporting as a dead end. */
  optional?: boolean;
}

export type EdgeKind = 'internal' | 'cable' | 'network' | 'rf' | 'acoustic';

export type Shape = (src: SourceInfo) => { gain?: number; flags?: Flag[] } | undefined;

export interface Edge {
  id: number;
  from: PointId;
  to: PointId;
  kind: EdgeKind;
  /** dB applied to everything passing. -∞ means blocked. */
  gain: number;
  /** Why the edge is blocked (set whenever gain is -∞). */
  block?: string;
  flags?: Flag[];
  /** Per-source gain/flags (EQ, filters, small speakers). */
  shape?: Shape;
  /** Path-finding cost used by trace() when the edge is open. */
  cost: number;
  /**
   * One of several alternatives where only one is chosen (input source,
   * output patch, radio frequency). A closed selector usually means "not
   * this route" rather than "a fault", so trace() avoids them.
   */
  selector?: boolean;
  nodeId?: string;
  cableId?: string;
}

/** [condition that must hold, reason shown when it doesn't]. */
export type Gate = readonly [ok: boolean, reason: string];

export interface EdgeOptions {
  gain?: number;
  gates?: readonly Gate[];
  flags?: Flag[];
  shape?: Shape;
  cost?: number;
  kind?: EdgeKind;
  selector?: boolean;
}

export interface Injection {
  point: PointId;
  source: string;
  db: number;
  flags?: Flag[];
}

export interface EmitterInfo {
  point: PointId;
  nodeId: string;
  position: Vec2;
  /** Node id this emitter points at (a performer, or the congregation). Omit for omnidirectional. */
  aim?: string;
  /** dB quieter for listeners who aren't the aim. */
  offAxis: number;
  /** Fed by the sound system (wedge/main). Their pickup by mics is feedback, not signal. */
  reinforcement: boolean;
}

export type ReceiverKind = 'mic' | 'ear' | 'room';

export interface ReceiverInfo {
  point: PointId;
  nodeId: string;
  position: Vec2;
  kind: ReceiverKind;
  /** Performer (or room) this receiver belongs to. Wedges aimed at the owner are on-axis. */
  owner?: string;
  /** Emitters this mic is deliberately placed on, with the placement distance. */
  targets: { point: PointId; distance: number }[];
  /** Mic rejection (dB) for everything that isn't a target. */
  offAxis: number;
}

export interface FeedbackCoupling {
  emitter: EmitterInfo;
  receiver: ReceiverInfo;
  gain: number;
}

export interface RfTransmitter {
  point: PointId;
  nodeId: string;
  label: string;
  freq: number;
  /** Powered with a live battery (radiating RF, whether muted or not). */
  active: boolean;
  batteryLow: boolean;
  pairedRx?: string;
}

export interface RfReceiver {
  point: PointId;
  nodeId: string;
  label: string;
  freq: number;
  power: Gate;
  dropouts: boolean;
}

export type Processor = (sig: Signal, domain: Domain) => Signal;

export interface CableLink {
  /** Edge ids this cable produced. */
  edges: number[];
  /** Why the cable passes nothing even when plugged in (two outputs, etc.). */
  issue?: string;
}

export interface CompiledGraph {
  points: Map<PointId, PointInfo>;
  edges: Edge[];
  /** Edges by destination point. */
  inbound: Map<PointId, Edge[]>;
  /** Edges by source point. */
  outbound: Map<PointId, Edge[]>;
  injections: Injection[];
  processors: Map<PointId, Processor[]>;
  sources: Map<string, SourceInfo>;
  ports: Map<string, PortDef[]>;
  /** Default trace destinations per node (e.g. a wedge's sound, a performer's ears). */
  primary: Map<string, PointId[]>;
  emitters: EmitterInfo[];
  receivers: ReceiverInfo[];
  feedbackCouplings: FeedbackCoupling[];
  rfTransmitters: RfTransmitter[];
  rfReceivers: RfReceiver[];
  cables: Map<string, CableLink>;
  warnings: string[];
}

export interface PowerState {
  on: boolean;
  reason?: string;
}

export interface PeerInfo {
  cable: Cable;
  /** The end of the cable that sits in the queried port. */
  end: 'from' | 'to';
  /** The cable's other end. */
  other: CableEnd | null;
  /** Both ends seated and the cable not broken. */
  intact: boolean;
}

export interface BuildCtx {
  rig: Rig;
  node(id: string): NodeInstance | undefined;
  power(nodeId: string): PowerState;
  /** Is 48V phantom power arriving at this port from what it's plugged into? */
  phantomAt(nodeId: string, portId: string): boolean;
  peer(nodeId: string, portId: string): PeerInfo | null;
  positionOf(nodeId: string): Vec2 | undefined;
}

export type Readout = string | number | boolean;
export type Readouts = Record<string, Readout>;

export interface ReadoutCtx extends BuildCtx {
  signal(point: PointId): Signal;
  level(point: PointId): Level;
  db(point: PointId): number;
  graph: CompiledGraph;
}

export interface NodeBuilderApi {
  readonly node: NodeInstance;
  /** Full point id for a local name. */
  id(local: string): PointId;
  port(def: PortDef): void;
  point(local: string, label: string, domain: Domain | 'auto', role?: PointRole, opts?: { balance?: boolean }): PointId;
  edge(from: string, to: string, opts?: EdgeOptions): void;
  source(part: string | null, label: string, kind: SourceKind, spectrum: Spectrum): string;
  inject(local: string, source: string, db: number, flags?: Flag[]): void;
  emitter(local: string, opts: Omit<EmitterInfo, 'point' | 'nodeId' | 'position'> & { position?: Vec2 }): void;
  receiver(local: string, opts: Omit<ReceiverInfo, 'point' | 'nodeId' | 'position'> & { position?: Vec2 }): void;
  process(local: string, fn: Processor): void;
  rfTransmitter(local: string, opts: Omit<RfTransmitter, 'point' | 'nodeId'>): void;
  rfReceiver(local: string, opts: Omit<RfReceiver, 'point' | 'nodeId'>): void;
  primary(local: string): void;
}

export interface DeviceDef<P = any> {
  type: string;
  build(node: NodeInstance<P>, b: NodeBuilderApi, ctx: BuildCtx): void;
  /** Does this device supply 48V phantom on the given input port? */
  phantomOn?(node: NodeInstance<P>, portId: string, ctx: BuildCtx): boolean;
  readouts?(node: NodeInstance<P>, ctx: ReadoutCtx): Readouts;
}

export function portPointId(nodeId: string, portId: string): PointId {
  return `${nodeId}.${portId}`;
}

export function lanePointId(nodeId: string, portId: string, dir: 'tx' | 'rx', lane: number): PointId {
  return `${nodeId}.${portId}.${dir}${lane}`;
}

/** Evaluates gates: returns the first failing reason, or undefined if all pass. */
export function firstFailure(gates: readonly Gate[] | undefined): string | undefined {
  if (!gates) return undefined;
  for (const [ok, reason] of gates) if (!ok) return reason;
  return undefined;
}
