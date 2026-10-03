import type { DeviceDef } from '../graph';
import { knobDb } from '../signal';
import { bandEffect } from '../sources';
import type { NodeInstance, PowerProps, Vec2 } from '../types';
import { clipProcessor, defaultPower, knobGate, limitProcessor, powerGate, protectGate } from './common';

export interface SpeakerProps {
  power: PowerProps;
  /** Rear volume knob 0–10. */
  volume: number;
  /** Node id the speaker points at (a performer for wedges, the room for mains). */
  aim?: string;
}

interface SpeakerSpec {
  type: string;
  /** dB SPL at 1 m for a 0 dBu input at unity volume. */
  sensitivity: number;
  /** Low-band cut (small boxes can't reproduce bass). */
  lowCut: number;
  /** How much quieter it is for listeners it isn't pointed at. */
  offAxis: number;
  maxSpl: number;
}

function poweredSpeaker(spec: SpeakerSpec): DeviceDef<SpeakerProps> {
  return {
    type: spec.type,
    build(node, b, ctx) {
      const p = node.props;
      b.port({ id: 'in', label: 'Input', dir: 'in', connector: 'xlr', domain: 'line' });
      b.process('in', clipProcessor);
      b.point('sound', `${node.name} (sound)`, 'close', 'emitter');
      const bands = { low: -spec.lowCut, mid: 0, high: 0 };
      b.edge('in', 'sound', {
        gain: spec.sensitivity + knobDb(p.volume),
        gates: [powerGate(ctx, node), protectGate(node), knobGate(node, p.volume)],
        ...(spec.lowCut ? { shape: (src) => bandEffect(src.spectrum, bands) } : {}),
      });
      b.process('sound', limitProcessor(spec.maxSpl));
      b.emitter('sound', { ...(p.aim ? { aim: p.aim } : {}), offAxis: spec.offAxis, reinforcement: true });
      b.primary('sound');
    },
    readouts(node, ctx) {
      const on = ctx.power(node.id).on && !node.faults?.broken;
      const level = ctx.level(`${node.id}.in`);
      return {
        power: on,
        signal: on && level !== 'none',
        limit: on && level === 'clipping',
        protect: on && !!node.faults?.protectMode,
      };
    },
  };
}

/** Wharfedale Pro powered wedge. Limited low end, so bass sounds thin. */
export const wedge = poweredSpeaker({ type: 'wedge', sensitivity: 100, lowCut: 12, offAxis: 10, maxSpl: 124 });

/** Main PA speaker, full range. */
export const mainSpeaker = poweredSpeaker({ type: 'main-speaker', sensitivity: 110, lowCut: 0, offAxis: 15, maxSpl: 130 });

export function makeSpeaker(
  type: 'wedge' | 'main-speaker',
  id: string,
  name: string,
  position: Vec2,
  aim: string | undefined,
  plug: string | null = 'wall',
): NodeInstance<SpeakerProps> {
  return { id, type, name, position, props: { power: defaultPower(plug), volume: 7, ...(aim ? { aim } : {}) } };
}

// --- Power strip --------------------------------------------------------------

export interface PowerStripProps {
  power: PowerProps;
  /** Breaker has tripped (press reset to fix). */
  tripped: boolean;
}

export const powerStrip: DeviceDef<PowerStripProps> = {
  type: 'power-strip',
  build() {
    // No audio. Other devices refer to it in their `power.plug`.
  },
  readouts(node, ctx) {
    return { light: ctx.power(node.id).on };
  },
};

export function makePowerStrip(id: string, name: string, position?: Vec2): NodeInstance<PowerStripProps> {
  return { id, type: 'power-strip', name, ...(position ? { position } : {}), props: { power: defaultPower(), tripped: false } };
}
