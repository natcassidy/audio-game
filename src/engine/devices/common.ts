import type { BuildCtx, Gate, Processor } from '../graph';
import { addFlags, isClipping, levelDb } from '../signal';
import type { NodeInstance, PowerProps } from '../types';

export function powerGate(ctx: BuildCtx, node: NodeInstance): Gate {
  const p = ctx.power(node.id);
  return [p.on, p.reason ?? `${node.name} has no power`];
}

export function protectGate(node: NodeInstance): Gate {
  return [!node.faults?.protectMode, `${node.name} is in protect mode (overheated or overloaded) and has shut its output off`];
}

export function knobGate(node: NodeInstance, knob: number, what = 'volume knob'): Gate {
  return [knob > 0, `${node.name}'s ${what} is turned all the way down`];
}

/** Marks everything passing a point as distorted when the point is over its clipping level. */
export const clipProcessor: Processor = (sig, domain) =>
  isClipping(levelDb(sig), domain) ? addFlags(sig, ['distorted']) : sig;

/** Caps output at a maximum level, marking it distorted when it would exceed it. */
export function limitProcessor(maxDb: number): Processor {
  return (sig) => {
    const level = levelDb(sig);
    if (!(level > maxDb)) return sig;
    const cut = maxDb - level;
    const out: Record<string, { db: number; flags: typeof sig[string]['flags'] }> = {};
    for (const [k, c] of Object.entries(sig)) {
      out[k] = { db: c.db + cut, flags: c.flags.includes('distorted') ? c.flags : [...c.flags, 'distorted' as const].sort() };
    }
    return out;
  };
}

/** 'in10' → 'In 10', 'outL' → 'Out L'. */
export function prettyPort(port: string): string {
  const m = /^(in|out)(\w+)$/.exec(port);
  if (m) return `${m[1] === 'in' ? 'In' : 'Out'} ${m[2]}`;
  return port;
}

/** Describes what a port is plugged into, e.g. "Stagebox In 10". */
export function describePeer(ctx: BuildCtx, nodeId: string, portId: string): string | undefined {
  const peer = ctx.peer(nodeId, portId);
  if (!peer?.other) return undefined;
  const other = ctx.node(peer.other.node);
  return `${other?.name ?? peer.other.node} ${prettyPort(peer.other.port)}`;
}

export function defaultPower(plug: string | null = 'wall'): PowerProps {
  return { switch: true, plug };
}
