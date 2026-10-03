import type { DeviceDef } from '../graph';
import { lanePointId } from '../graph';
import type { NodeInstance, PowerProps, Vec2 } from '../types';
import { clipProcessor, defaultPower, powerGate } from './common';

export interface PreampState {
  /** Preamp gain in dB (0–60). */
  gain: number;
  phantom: boolean;
}

export interface StageboxProps {
  power: PowerProps;
  /** Mutes every output (the NSB's Mute All button). */
  muteAll: boolean;
  /** Remote-controlled preamps, one per input. Set from the mixer's Fat Channel. */
  preamps: PreampState[];
  inputs: number;
  outputs: number;
}

/** PreSonus NSB 16.8: 16 mic/line inputs, 8 outputs, AVB network link to the mixer. */
export const stagebox: DeviceDef<StageboxProps> = {
  type: 'stagebox',
  build(node, b, ctx) {
    const p = node.props;
    const power = powerGate(ctx, node);
    b.port({ id: 'net', label: 'Network', dir: 'io', connector: 'network', domain: 'line', lanes: { tx: p.inputs, rx: p.outputs } });
    for (let i = 1; i <= p.inputs; i++) {
      b.port({ id: `in${i}`, label: `In ${i}`, dir: 'in', connector: 'xlr', domain: 'auto' });
      const pre = p.preamps[i - 1] ?? { gain: 0, phantom: false };
      // Preamp: input → network stream to the mixer.
      b.edge(`in${i}`, `net.tx${i}`, { gain: pre.gain, gates: [power] });
      b.process(`net.tx${i}`, clipProcessor);
    }
    for (let j = 1; j <= p.outputs; j++) {
      b.port({ id: `out${j}`, label: `Out ${j}`, dir: 'out', connector: 'xlr', domain: 'line' });
      b.edge(`net.rx${j}`, `out${j}`, {
        gates: [power, [!p.muteAll, `${node.name}'s Mute All button is engaged — every output is muted`]],
      });
    }
  },
  phantomOn(node, port, ctx) {
    const m = /^in(\d+)$/.exec(port);
    if (!m) return false;
    return ctx.power(node.id).on && !node.faults?.broken && !!node.props.preamps[Number(m[1]) - 1]?.phantom;
  },
  readouts(node, ctx) {
    const on = ctx.power(node.id).on;
    const peer = ctx.peer(node.id, 'net');
    const linked =
      on && !!peer?.intact && !!peer.other && ctx.power(peer.other.node).on && ctx.node(peer.other.node)?.type === 'mixer';
    const out: Record<string, string | boolean> = { power: on, network: linked, muteAll: on && node.props.muteAll };
    for (let i = 1; i <= node.props.inputs; i++) out[`in${i}`] = ctx.level(lanePointId(node.id, 'net', 'tx', i));
    return out;
  },
};

export function makeStagebox(id: string, name: string, position: Vec2): NodeInstance<StageboxProps> {
  return {
    id,
    type: 'stagebox',
    name,
    position,
    props: {
      power: defaultPower(),
      muteAll: false,
      preamps: Array.from({ length: 16 }, () => ({ gain: 0, phantom: false })),
      inputs: 16,
      outputs: 8,
    },
  };
}
