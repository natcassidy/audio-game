import type { BuildCtx, DeviceDef, Gate, NodeBuilderApi } from '../graph';
import type { Battery, NodeInstance, PowerProps, Vec2 } from '../types';
import { defaultPower, describePeer, powerGate } from './common';

export type MicType = 'dynamic' | 'condenser';
export type Pattern = 'cardioid' | 'omni';

export interface MicTarget {
  /** Emitter point id, e.g. "leader.voice" or "drums.tom". */
  point: string;
  /** Placement distance in metres. */
  distance: number;
}

export interface MicProps {
  micType: MicType;
  pattern: Pattern;
  targets: MicTarget[];
  /** Performer this mic belongs to (their wedge is aimed at it). */
  owner?: string;
  /** Some mics have an on/off switch. */
  switchOn: boolean;
}

/** Output in dBu for 94 dB SPL (1 Pa). */
const SENSITIVITY: Record<MicType, number> = { dynamic: -54, condenser: -40 };
const OFF_AXIS: Record<Pattern, number> = { cardioid: 15, omni: 0 };

function capsulePosition(node: NodeInstance<{ targets?: MicTarget[]; owner?: string }>, ctx: BuildCtx): Vec2 | undefined {
  if (node.position) return node.position;
  const first = node.props.targets?.[0];
  const fromTarget = first ? ctx.positionOf(first.point.split('.')[0]) : undefined;
  return fromTarget ?? (node.props.owner ? ctx.positionOf(node.props.owner) : undefined);
}

/** Adds an acoustic capsule (receiver) named "capsule". Returns the capsule-to-electrical gain. */
export function addCapsule(
  node: NodeInstance<{ targets: MicTarget[]; owner?: string }>,
  b: NodeBuilderApi,
  ctx: BuildCtx,
  micType: MicType,
  pattern: Pattern,
): number {
  b.point('capsule', `${node.name} capsule`, 'close', 'receiver');
  const position = capsulePosition(node, ctx);
  b.receiver('capsule', {
    kind: 'mic',
    ...(node.props.owner ? { owner: node.props.owner } : {}),
    targets: node.props.targets,
    offAxis: node.faults?.facingWedge ? 0 : OFF_AXIS[pattern],
    ...(position ? { position } : {}),
  });
  return SENSITIVITY[micType] - 94;
}

export function phantomGate(node: NodeInstance, ctx: BuildCtx, port: string, what: string): Gate {
  const where = describePeer(ctx, node.id, port);
  return [
    ctx.phantomAt(node.id, port),
    `${node.name} is ${what} and needs 48V phantom power, but none is reaching it` +
      (where ? ` (turn on 48V for ${where})` : ''),
  ];
}

/** Wired microphone (dynamic vocal mic, condenser drum/room/choir mic). */
export const mic: DeviceDef<MicProps> = {
  type: 'mic',
  build(node, b, ctx) {
    const p = node.props;
    const sens = addCapsule(node, b, ctx, p.micType, p.pattern);
    b.port({ id: 'out', label: 'XLR out', dir: 'out', connector: 'xlr', domain: 'mic' });
    const gates: Gate[] = [[p.switchOn, `${node.name}'s on/off switch is off`]];
    if (p.micType === 'condenser') gates.push(phantomGate(node, ctx, 'out', 'a condenser mic'));
    b.edge('capsule', 'out', { gain: sens, gates });
  },
};

export function makeMic(
  id: string,
  name: string,
  opts: { targets: MicTarget[]; micType?: MicType; pattern?: Pattern; owner?: string; position?: Vec2 },
): NodeInstance<MicProps> {
  return {
    id,
    type: 'mic',
    name,
    ...(opts.position ? { position: opts.position } : {}),
    props: {
      micType: opts.micType ?? 'dynamic',
      pattern: opts.pattern ?? 'cardioid',
      targets: opts.targets,
      ...(opts.owner ? { owner: opts.owner } : {}),
      switchOn: true,
    },
  };
}

// --- Wireless ---------------------------------------------------------------

export type TransmitterKind = 'handheld' | 'bodypack';

export interface TransmitterProps {
  kind: TransmitterKind;
  /** Voice the built-in capsule (handheld) or headset (body-pack) picks up. */
  targets: MicTarget[];
  owner?: string;
  switchOn: boolean;
  battery: Battery;
  muted: boolean;
  /** MHz. */
  frequency: number;
  /** Receiver node this transmitter is meant to go to (helps trace pick the right one). */
  pairedRx?: string;
}

/** Wireless transmitter: a handheld mic or a body-pack with headset mic. */
export const wirelessTransmitter: DeviceDef<TransmitterProps> = {
  type: 'wireless-tx',
  build(node, b, ctx) {
    const p = node.props;
    const sens = addCapsule(node, b, ctx, 'dynamic', 'cardioid');
    b.point('rf', `${node.name} radio signal`, 'mic');
    b.edge('capsule', 'rf', {
      gain: sens,
      gates: [
        [p.switchOn, `${node.name} transmitter is switched off`],
        [p.battery !== 'dead', `${node.name} battery is dead`],
        [!p.muted, `${node.name} is muted (mute switch on the ${p.kind === 'handheld' ? 'mic' : 'body-pack'})`],
      ],
    });
    b.rfTransmitter('rf', {
      label: node.name,
      freq: p.frequency,
      active: p.switchOn && p.battery !== 'dead' && !node.faults?.broken,
      batteryLow: p.battery === 'low',
      ...(p.pairedRx ? { pairedRx: p.pairedRx } : {}),
    });
  },
  readouts(node) {
    const p = node.props;
    const on = p.switchOn && p.battery !== 'dead';
    return {
      power: on,
      battery: p.battery === 'good' ? 3 : p.battery === 'low' ? 1 : 0,
      mute: on && p.muted,
      frequency: p.frequency.toFixed(3),
    };
  },
};

export interface ReceiverProps {
  power: PowerProps;
  frequency: number;
  /** Rear-panel output level switch. */
  outputLevel: 'mic' | 'line';
}

const LINE_BOOST_DB = 30;

/** Wireless receiver: RF in, XLR audio out. */
export const wirelessReceiver: DeviceDef<ReceiverProps> = {
  type: 'wireless-rx',
  build(node, b, ctx) {
    const p = node.props;
    const power = powerGate(ctx, node);
    b.point('rf', `${node.name} antenna`, 'mic');
    b.port({ id: 'out', label: 'XLR out', dir: 'out', connector: 'xlr', domain: p.outputLevel });
    b.edge('rf', 'out', { gain: p.outputLevel === 'line' ? LINE_BOOST_DB : 0, gates: [power] });
    b.rfReceiver('rf', {
      label: node.name,
      freq: p.frequency,
      power: node.faults?.broken ? [false, `${node.name} is faulty (internal failure)`] : power,
      dropouts: !!node.faults?.rfDropouts,
    });
  },
  readouts(node, ctx) {
    const p = node.props;
    const on = ctx.power(node.id).on && !node.faults?.broken;
    const txs = ctx.graph.rfTransmitters.filter((t) => t.active && t.freq === p.frequency);
    const rf = !on || txs.length === 0 ? 0 : node.faults?.rfDropouts || txs.some((t) => t.batteryLow) ? 2 : 5;
    const tx = txs[0] ? ctx.node(txs[0].nodeId) : undefined;
    const battery = (tx?.props as TransmitterProps | undefined)?.battery;
    return {
      power: on,
      frequency: p.frequency.toFixed(3),
      rf,
      audio: on ? ctx.level(`${node.id}.out`) : 'none',
      txBattery: on && battery ? (battery === 'good' ? 3 : battery === 'low' ? 1 : 0) : 0,
      interference: on && txs.length > 1,
    };
  },
};

export function makeTransmitter(
  id: string,
  name: string,
  opts: { kind: TransmitterKind; owner: string; frequency: number; pairedRx?: string },
): NodeInstance<TransmitterProps> {
  return {
    id,
    type: 'wireless-tx',
    name,
    props: {
      kind: opts.kind,
      targets: [{ point: `${opts.owner}.voice`, distance: opts.kind === 'handheld' ? 0.05 : 0.04 }],
      owner: opts.owner,
      switchOn: true,
      battery: 'good',
      muted: false,
      frequency: opts.frequency,
      ...(opts.pairedRx ? { pairedRx: opts.pairedRx } : {}),
    },
  };
}

export function makeReceiver(id: string, name: string, frequency: number, position?: Vec2): NodeInstance<ReceiverProps> {
  return {
    id,
    type: 'wireless-rx',
    name,
    ...(position ? { position } : {}),
    props: { power: defaultPower(), frequency, outputLevel: 'mic' },
  };
}
