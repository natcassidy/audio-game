import type { DeviceDef, Gate } from '../graph';
import { knobDb } from '../signal';
import { SPECTRA, type Spectrum } from '../sources';
import type { Battery, NodeInstance, PowerProps, Vec2 } from '../types';
import { defaultPower, describePeer, knobGate, limitProcessor, powerGate, protectGate } from './common';

// --- Passive electric instruments --------------------------------------------

export interface GuitarProps {
  /** Volume knob 0–10. */
  volume: number;
}

/** Instrument output level at full volume (dBu). */
const PICKUP_DB = -20;

function passiveInstrument(type: string, spectrum: Spectrum): DeviceDef<GuitarProps> {
  return {
    type,
    build(node, b) {
      b.point('pickup', `${node.name} pickup`, 'instrument');
      const src = b.source(null, node.name, 'instrument', spectrum);
      b.inject('pickup', src, PICKUP_DB);
      b.port({ id: 'out', label: 'Output jack', dir: 'out', connector: 'quarter-inch', domain: 'instrument' });
      b.edge('pickup', 'out', { gain: knobDb(node.props.volume), gates: [knobGate(node, node.props.volume)] });
    },
  };
}

export const bassGuitar = passiveInstrument('bass-guitar', SPECTRA.bass);
export const electricGuitar = passiveInstrument('electric-guitar', SPECTRA.electricGuitar);

// --- Acoustic guitar with an active pickup ----------------------------------

export interface AcousticGuitarProps extends GuitarProps {
  pickupBattery: Battery;
}

export const acousticGuitar: DeviceDef<AcousticGuitarProps> = {
  type: 'acoustic-guitar',
  build(node, b) {
    const p = node.props;
    const src = b.source(null, node.name, 'instrument', SPECTRA.acousticGuitar);
    // The unamplified guitar is quiet but real: nearby mics and ears hear it.
    b.point('body', `${node.name} (unplugged sound)`, 'close', 'emitter');
    b.inject('body', src, 70);
    b.emitter('body', { offAxis: 0, reinforcement: false });
    b.point('pickup', `${node.name} pickup preamp`, 'instrument');
    b.inject('pickup', src, -25);
    b.port({ id: 'out', label: 'Output jack', dir: 'out', connector: 'quarter-inch', domain: 'instrument' });
    b.edge('pickup', 'out', {
      gain: knobDb(p.volume),
      gates: [[p.pickupBattery !== 'dead', `${node.name}'s pickup battery is dead`], knobGate(node, p.volume)],
    });
  },
  readouts(node) {
    return { battery: node.props.pickupBattery };
  },
};

// --- Keyboard ---------------------------------------------------------------

export interface KeyboardProps {
  power: PowerProps;
  volume: number;
}

export const keyboard: DeviceDef<KeyboardProps> = {
  type: 'keyboard',
  build(node, b, ctx) {
    const p = node.props;
    b.point('engine', `${node.name} sound engine`, 'instrument');
    const src = b.source(null, node.name, 'instrument', SPECTRA.keys);
    b.inject('engine', src, -10);
    for (const side of ['L', 'R'] as const) {
      b.port({ id: `out${side}`, label: `Output ${side}`, dir: 'out', connector: 'quarter-inch', domain: 'instrument' });
      b.edge('engine', `out${side}`, {
        gain: knobDb(p.volume),
        gates: [powerGate(ctx, node), knobGate(node, p.volume, 'master volume')],
      });
    }
  },
  readouts(node, ctx) {
    return { power: ctx.power(node.id).on };
  },
};

// --- Drums ------------------------------------------------------------------

export interface DrumKitProps {
  /** dB SPL at 1 m for each part. */
  tom: number;
  hihat: number;
  kit: number;
}

export const drumKit: DeviceDef<DrumKitProps> = {
  type: 'drum-kit',
  build(node, b) {
    const parts = [
      ['tom', 'Tom', SPECTRA.tom],
      ['hihat', 'Hi-hat', SPECTRA.hihat],
      ['kit', 'Drums (kick/snare)', SPECTRA.kit],
    ] as const;
    for (const [part, label, spectrum] of parts) {
      b.point(part, `${node.name}: ${label}`, 'close', 'emitter');
      const src = b.source(part, label, 'drum', spectrum);
      b.inject(part, src, node.props[part]);
      b.emitter(part, { offAxis: 0, reinforcement: false });
    }
  },
};

// --- DI box -----------------------------------------------------------------

export interface DiProps {
  /** Active DIs need a battery or 48V phantom. */
  active: boolean;
  battery: Battery | 'none';
  groundLift: boolean;
  /** -20 dB pad for hot sources. */
  pad: boolean;
}

/** DI boxes turn a 1/4" instrument signal into a mic-level XLR signal. */
const DI_DB = -20;

export const diBox: DeviceDef<DiProps> = {
  type: 'di',
  build(node, b, ctx) {
    const p = node.props;
    b.port({ id: 'in', label: 'Input (1/4")', dir: 'in', connector: 'quarter-inch', domain: 'instrument' });
    b.port({ id: 'thru', label: 'Thru (1/4", to amp)', dir: 'out', connector: 'quarter-inch', domain: 'instrument', optional: true });
    b.port({ id: 'xlr', label: 'XLR out', dir: 'out', connector: 'xlr', domain: 'mic' });
    // Thru is a straight wire, so it works even when an active DI has no power.
    b.edge('in', 'thru');
    const gates: Gate[] = [];
    if (p.active && p.battery !== 'good' && p.battery !== 'low') {
      const where = describePeer(ctx, node.id, 'xlr');
      gates.push([
        ctx.phantomAt(node.id, 'xlr'),
        `${node.name} is an active DI: its battery is ${p.battery === 'dead' ? 'dead' : 'missing'} and no 48V phantom power is reaching it` +
          (where ? ` (turn on 48V for ${where}, or replace the battery)` : ''),
      ]);
    }
    b.edge('in', 'xlr', { gain: DI_DB + (p.pad ? -20 : 0), gates });
    if (node.faults?.groundLoop && !p.groundLift) {
      const hum = b.source('hum', `Hum (${node.name} ground loop)`, 'noise', SPECTRA.hum);
      b.inject('xlr', hum, -55);
    }
  },
  readouts(node, ctx) {
    const p = node.props;
    const powered = !p.active || p.battery === 'good' || p.battery === 'low' || ctx.phantomAt(node.id, 'xlr');
    return { powered, groundLift: p.groundLift };
  },
};

// --- Pedals and modelers ----------------------------------------------------

export interface TunerProps {
  engaged: boolean;
  battery: Battery;
}

export const tunerPedal: DeviceDef<TunerProps> = {
  type: 'tuner',
  build(node, b) {
    const p = node.props;
    b.port({ id: 'in', label: 'Input', dir: 'in', connector: 'quarter-inch', domain: 'instrument' });
    b.port({ id: 'out', label: 'Output', dir: 'out', connector: 'quarter-inch', domain: 'instrument' });
    b.edge('in', 'out', {
      gates: [
        [p.battery !== 'dead', `${node.name}'s battery is dead, so it passes no signal`],
        [!p.engaged, `${node.name} is engaged — it mutes the signal while tuning`],
      ],
    });
  },
  readouts(node) {
    return { display: node.props.battery !== 'dead', tuning: node.props.engaged && node.props.battery !== 'dead' };
  },
};

export interface ModelerProps {
  power: PowerProps;
  volume: number;
}

/** Amp modeler / multi-effects with a direct XLR out (e.g. Helix, HX Stomp). */
export const modeler: DeviceDef<ModelerProps> = {
  type: 'modeler',
  build(node, b, ctx) {
    const p = node.props;
    b.port({ id: 'in', label: 'Guitar in', dir: 'in', connector: 'quarter-inch', domain: 'instrument' });
    b.port({ id: 'xlr', label: 'XLR out', dir: 'out', connector: 'xlr', domain: 'line' });
    b.edge('in', 'xlr', { gain: 20 + knobDb(p.volume), gates: [powerGate(ctx, node), knobGate(node, p.volume, 'output level')] });
  },
  readouts(node, ctx) {
    return { power: ctx.power(node.id).on };
  },
};

// --- Instrument amps --------------------------------------------------------

export interface AmpProps {
  power: PowerProps;
  volume: number;
  model: string;
  /** dB SPL at 1 m for a nominal instrument signal at unity volume. */
  sensitivity: number;
  /** Loudest the amp can go (dB SPL at 1 m). */
  maxSpl: number;
}

/** Bass/guitar amp. Independent of the mixer; heard on stage and bleeds into mics. */
export const instrumentAmp: DeviceDef<AmpProps> = {
  type: 'amp',
  build(node, b, ctx) {
    const p = node.props;
    b.port({ id: 'in', label: 'Input', dir: 'in', connector: 'quarter-inch', domain: 'instrument' });
    b.point('speaker', `${node.name} speaker`, 'close', 'emitter');
    b.edge('in', 'speaker', {
      gain: p.sensitivity + 20 + knobDb(p.volume),
      gates: [powerGate(ctx, node), protectGate(node), knobGate(node, p.volume)],
    });
    b.process('speaker', limitProcessor(p.maxSpl));
    b.emitter('speaker', { offAxis: 0, reinforcement: false });
    b.primary('speaker');
  },
  readouts(node, ctx) {
    const on = ctx.power(node.id).on;
    return { power: on, protect: on && !!node.faults?.protectMode, clip: on && ctx.db(`${node.id}.speaker`) >= node.props.maxSpl - 0.01 };
  },
};

export const AMP_MODELS = {
  'Fender Rumble 15': { sensitivity: 95, maxSpl: 100 },
  'Peavey Basic 112': { sensitivity: 98, maxSpl: 110 },
} as const;

export function makeAmp(
  id: string,
  name: string,
  model: keyof typeof AMP_MODELS,
  position: Vec2,
  opts: Partial<AmpProps> = {},
): NodeInstance<AmpProps> {
  return {
    id,
    type: 'amp',
    name,
    position,
    props: { power: defaultPower(), volume: 7, model, ...AMP_MODELS[model], ...opts },
  };
}

export function makeDi(id: string, name: string, opts: Partial<DiProps> = {}): NodeInstance<DiProps> {
  return { id, type: 'di', name, props: { active: false, battery: 'none', groundLift: false, pad: false, ...opts } };
}
