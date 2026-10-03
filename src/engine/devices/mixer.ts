import type { DeviceDef, EdgeOptions, Gate } from '../graph';
import { lanePointId } from '../graph';
import { OFF_DB, isOff, toGain } from '../signal';
import { bandEffect, hpfLowLoss } from '../sources';
import type { NodeInstance, PowerProps } from '../types';
import { clipProcessor, defaultPower, powerGate } from './common';
import type { PreampState } from './stagebox';

export type InputSource = 'analog' | 'network' | 'usb' | 'sd';

export const INPUT_SOURCE_NAMES: Record<InputSource, string> = {
  analog: 'Analog',
  network: 'Network',
  usb: 'USB',
  sd: 'SD Card',
};

export interface ChannelState {
  name: string;
  source: InputSource;
  polarity: boolean;
  /** High-pass filter frequency in Hz (0 = off). */
  hpf: number;
  eq: { low: number; mid: number; high: number };
  mute: boolean;
  solo: boolean;
  /** dB; OFF_DB = all the way down. */
  fader: number;
  /** -1 (left) … +1 (right). */
  pan: number;
  /** Channel is assigned to the Main mix. */
  toMain: boolean;
  /** On an odd channel: link it with the next channel as a stereo pair. */
  link: boolean;
  /** Send levels to Mix 1–16 (dB). */
  sends: number[];
  /** Send levels to FX A–D (dB). */
  fxSends: number[];
}

export interface MixState {
  name: string;
  master: number;
  mute: boolean;
  solo: boolean;
  /** Monitor mixes are normally pre-fader so the room mix doesn't move the wedges. */
  preFader: boolean;
}

export interface FxState {
  name: string;
  master: number;
  mute: boolean;
  /** How much of the effect returns to Main (dB). */
  returnLevel: number;
}

export type OutputSource = 'main.l' | 'main.r' | `mix${number}`;
export type MixSelect = 'main' | `mix${number}` | `fx${'A' | 'B' | 'C' | 'D'}`;

export interface MixerProps {
  power: PowerProps;
  channels: ChannelState[];
  /** Preamps for the mixer's own analog inputs. */
  localPreamps: PreampState[];
  main: { master: number; mute: boolean; solo: boolean };
  mixes: MixState[];
  fx: FxState[];
  /** Which mix feeds each network output (= stagebox output). */
  networkPatch: (OutputSource | null)[];
  /** UI mode: when not 'main', the faders control sends to this mix. */
  selectedMix: MixSelect;
  selectedChannel: number;
  soloMode: 'pfl' | 'afl';
}

export const FX_NAMES = ['A', 'B', 'C', 'D'] as const;
export const MIX_COUNT = 16;

export function channelLabel(p: MixerProps, n: number): string {
  return `Ch ${n} (${p.channels[n - 1]?.name ?? '?'})`;
}

export function mixLabel(p: MixerProps, k: number): string {
  const name = p.mixes[k - 1]?.name;
  return name && name !== `Mix ${k}` ? `Mix ${k} (${name})` : `Mix ${k}`;
}

export function outputSourceLabel(p: MixerProps, s: OutputSource): string {
  if (s === 'main.l') return 'Main L';
  if (s === 'main.r') return 'Main R';
  return mixLabel(p, Number(s.slice(3)));
}

export function mixSelectLabel(p: MixerProps, s: MixSelect): string {
  if (s === 'main') return 'Main Mix';
  if (s.startsWith('fx')) return `FX ${s.slice(2)}`;
  return mixLabel(p, Number(s.slice(3))).toUpperCase();
}

export const OUTPUT_SOURCES: OutputSource[] = [
  'main.l',
  'main.r',
  ...Array.from({ length: MIX_COUNT }, (_, i) => `mix${i + 1}` as OutputSource),
];

function outputPoint(s: OutputSource): string {
  return s === 'main.l' || s === 'main.r' ? s : `${s}.out`;
}

/**
 * The settings that actually apply to a channel, taking stereo links into
 * account: the even channel of a linked pair follows the odd one, and the
 * pair is panned hard left/right.
 */
export function effectiveChannel(p: MixerProps, n: number): ChannelState & { linkedTo?: number } {
  const i = n - 1;
  const ch = p.channels[i];
  if (i % 2 === 1 && p.channels[i - 1]?.link) {
    const lead = p.channels[i - 1];
    return {
      ...ch,
      fader: lead.fader,
      mute: lead.mute,
      sends: lead.sends,
      fxSends: lead.fxSends,
      toMain: lead.toMain,
      pan: 1,
      linkedTo: n - 1,
    };
  }
  if (i % 2 === 0 && ch.link && p.channels[i + 1]) return { ...ch, pan: -1, linkedTo: n + 1 };
  return ch;
}

/** Constant-power pan law: centre is -3 dB each side. */
export function panGains(pan: number): { l: number; r: number } {
  const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  const db = (x: number) => (x < 1e-9 ? -Infinity : 20 * Math.log10(x));
  return { l: db(Math.cos(angle)), r: db(Math.sin(angle)) };
}

/** Simplified PreSonus StudioLive 32SC. */
export const mixer: DeviceDef<MixerProps> = {
  type: 'mixer',
  build(node, b, ctx) {
    const p = node.props;
    const power = powerGate(ctx, node);
    const edge = (from: string, to: string, opts: EdgeOptions = {}) =>
      b.edge(from, to, { ...opts, gates: [power, ...(opts.gates ?? [])] });
    const channels = p.channels.length;

    b.port({ id: 'net', label: 'Network', dir: 'io', connector: 'network', domain: 'line', lanes: { tx: p.networkPatch.length, rx: channels } });
    b.port({ id: 'mainL', label: 'Main L out', dir: 'out', connector: 'xlr', domain: 'line' });
    b.port({ id: 'mainR', label: 'Main R out', dir: 'out', connector: 'xlr', domain: 'line' });
    b.port({ id: 'phones', label: 'Headphones', dir: 'out', connector: 'quarter-inch', domain: 'line', optional: true });

    // Buses.
    b.point('main.l.sum', 'Main L (sum)', 'line');
    b.point('main.r.sum', 'Main R (sum)', 'line');
    b.process('main.l.sum', clipProcessor);
    b.process('main.r.sum', clipProcessor);
    b.point('main.l', 'Main L', 'line');
    b.point('main.r', 'Main R', 'line');
    b.point('solo', 'Solo bus', 'line');
    for (let k = 1; k <= p.mixes.length; k++) {
      b.point(`mix${k}.sum`, `${mixLabel(p, k)} (sum)`, 'line');
      b.process(`mix${k}.sum`, clipProcessor);
      b.point(`mix${k}.out`, `${mixLabel(p, k)} out`, 'line');
    }
    p.fx.forEach((fx, x) => {
      const id = `fx${FX_NAMES[x]}`;
      b.point(`${id}.sum`, `${fx.name} (sum)`, 'line');
      b.point(`${id}.out`, `${fx.name} return`, 'line');
    });

    // Channel strips.
    for (let n = 1; n <= channels; n++) {
      const raw = p.channels[n - 1];
      const ch = effectiveChannel(p, n);
      const L = channelLabel(p, n);
      const pre = p.localPreamps[n - 1] ?? { gain: 0, phantom: false };

      b.port({ id: `in${n}`, label: `Analog In ${n}`, dir: 'in', connector: 'xlr', domain: 'auto' });
      b.point(`usb${n}`, `USB return ${n}`, 'line');
      b.point(`sd${n}`, `SD card track ${n}`, 'line');
      b.point(`ch${n}.in`, `${L} input`, 'line');
      b.process(`ch${n}.in`, clipProcessor);

      const sourceGate = (want: InputSource, where: string): Gate => [
        raw.source === want,
        `${L} input source is set to ${INPUT_SOURCE_NAMES[raw.source]}, not ${INPUT_SOURCE_NAMES[want]} (${where})`,
      ];
      const select = { selector: true };
      edge(`in${n}`, `ch${n}.in`, { ...select, gain: pre.gain, gates: [sourceGate('analog', `the mixer's own input ${n}`)] });
      edge(`net.rx${n}`, `ch${n}.in`, { ...select, gates: [sourceGate('network', 'the stagebox')] });
      edge(`usb${n}`, `ch${n}.in`, { ...select, gates: [sourceGate('usb', 'the computer')] });
      edge(`sd${n}`, `ch${n}.in`, { ...select, gates: [sourceGate('sd', 'the SD card')] });

      // Fat Channel processing: HPF + simple 3-band EQ.
      b.point(`ch${n}.pre`, `${L} (pre-fader)`, 'line');
      const bands = { low: raw.eq.low - hpfLowLoss(raw.hpf), mid: raw.eq.mid, high: raw.eq.high };
      const flat = bands.low === 0 && bands.mid === 0 && bands.high === 0;
      edge(`ch${n}.in`, `ch${n}.pre`, flat ? {} : { shape: (src) => bandEffect(src.spectrum, bands) });

      const muteGate: Gate = [!ch.mute, `${L} is muted`];
      const faderGate: Gate = [!isOff(ch.fader), `${L} fader is all the way down`];
      b.point(`ch${n}.post`, `${L} (post-fader)`, 'line', 'internal', { balance: true });
      edge(`ch${n}.pre`, `ch${n}.post`, { gain: toGain(ch.fader), gates: [muteGate, faderGate] });

      const pan = panGains(ch.pan);
      const side = ch.linkedTo ? ' (it is one side of a linked stereo pair)' : '';
      const mainGate: Gate = [ch.toMain, `${L} is not assigned to the Main mix`];
      edge(`ch${n}.post`, 'main.l.sum', { gain: pan.l, gates: [mainGate, [pan.l > -Infinity, `${L} is panned hard right${side}`]] });
      edge(`ch${n}.post`, 'main.r.sum', { gain: pan.r, gates: [mainGate, [pan.r > -Infinity, `${L} is panned hard left${side}`]] });

      for (let k = 1; k <= p.mixes.length; k++) {
        const mix = p.mixes[k - 1];
        const M = mixLabel(p, k);
        const send = ch.sends[k - 1] ?? OFF_DB;
        const gates: Gate[] = [[!ch.mute, `${L} is muted (mute also silences its monitor sends)`]];
        if (!mix.preFader) gates.push([!isOff(ch.fader), `${L} fader is down, and ${M} is post-fader so its send follows the fader`]);
        gates.push([!isOff(send), `${L}'s send to ${M} is turned all the way down`]);
        edge(`ch${n}.pre`, `mix${k}.sum`, { gain: toGain(send) + (mix.preFader ? 0 : toGain(ch.fader)), gates });
      }

      p.fx.forEach((fx, x) => {
        const send = ch.fxSends[x] ?? OFF_DB;
        edge(`ch${n}.post`, `fx${FX_NAMES[x]}.sum`, {
          gain: toGain(send),
          gates: [[!isOff(send), `${L}'s send to ${fx.name} is turned all the way down`]],
        });
      });

      edge(p.soloMode === 'pfl' ? `ch${n}.pre` : `ch${n}.post`, 'solo', { gates: [[raw.solo, `${L} is not soloed`]] });
    }

    // Mix masters.
    for (let k = 1; k <= p.mixes.length; k++) {
      const mix = p.mixes[k - 1];
      const M = mixLabel(p, k);
      edge(`mix${k}.sum`, `mix${k}.out`, {
        gain: toGain(mix.master),
        gates: [
          [!mix.mute, `${M} master is muted`],
          [!isOff(mix.master), `${M} master fader is all the way down`],
        ],
      });
      edge(`mix${k}.out`, 'solo', { gates: [[mix.solo, `${M} is not soloed`]] });
    }

    // Effects: send → master → return into Main.
    p.fx.forEach((fx, x) => {
      const id = `fx${FX_NAMES[x]}`;
      edge(`${id}.sum`, `${id}.out`, {
        gain: toGain(fx.master),
        gates: [
          [!fx.mute, `${fx.name} master is muted`],
          [!isOff(fx.master), `${fx.name} master fader is all the way down`],
        ],
      });
      for (const s of ['l', 'r'] as const) {
        edge(`${id}.out`, `main.${s}.sum`, {
          gain: toGain(fx.returnLevel) - 3,
          flags: ['fx'],
          gates: [[!isOff(fx.returnLevel), `${fx.name} return to Main is turned all the way down`]],
        });
      }
    });

    // Main master and outputs.
    for (const s of ['l', 'r'] as const) {
      edge(`main.${s}.sum`, `main.${s}`, {
        gain: toGain(p.main.master),
        gates: [
          [!p.main.mute, 'The Main mix is muted'],
          [!isOff(p.main.master), 'The Main master fader is all the way down'],
        ],
      });
      edge(`main.${s}`, s === 'l' ? 'mainL' : 'mainR');
      edge(`main.${s}`, 'solo', { gates: [[p.main.solo, 'Main is not soloed']] });
    }

    // Output patch: which mix goes to each network output (stagebox Out j).
    p.networkPatch.forEach((patched, j0) => {
      const j = j0 + 1;
      for (const s of OUTPUT_SOURCES) {
        const reason =
          patched === null
            ? `Nothing is patched to network output ${j} (stagebox Out ${j}) on the mixer`
            : `Network output ${j} (stagebox Out ${j}) is patched to ${outputSourceLabel(p, patched)}, not ${outputSourceLabel(p, s)}`;
        edge(outputPoint(s), `net.tx${j}`, { selector: true, gates: [[patched === s, reason]] });
      }
    });

    edge('solo', 'phones');
  },

  phantomOn(node, port, ctx) {
    const m = /^in(\d+)$/.exec(port);
    if (!m) return false;
    return ctx.power(node.id).on && !node.faults?.broken && !!node.props.localPreamps[Number(m[1]) - 1]?.phantom;
  },

  readouts(node, ctx) {
    const p = node.props;
    const on = ctx.power(node.id).on;
    const peer = ctx.peer(node.id, 'net');
    const out: Record<string, string | boolean> = {
      power: on,
      network: on && !!peer?.intact && !!peer.other && ctx.power(peer.other.node).on,
      mode: p.selectedMix,
      banner: p.selectedMix === 'main' ? '' : `Editing ${mixSelectLabel(p, p.selectedMix)}, not Main`,
      mainL: ctx.level(`${node.id}.main.l`),
      mainR: ctx.level(`${node.id}.main.r`),
      phones: ctx.level(`${node.id}.phones`),
    };
    for (let n = 1; n <= p.channels.length; n++) out[`ch${n}`] = ctx.level(`${node.id}.ch${n}.pre`);
    for (let k = 1; k <= p.mixes.length; k++) out[`mix${k}`] = ctx.level(`${node.id}.mix${k}.out`);
    for (let j = 1; j <= p.networkPatch.length; j++) out[`netOut${j}`] = ctx.level(lanePointId(node.id, 'net', 'tx', j));
    return out;
  },
};

export function defaultChannel(name: string): ChannelState {
  return {
    name,
    source: 'network',
    polarity: false,
    hpf: 0,
    eq: { low: 0, mid: 0, high: 0 },
    mute: false,
    solo: false,
    fader: 0,
    pan: 0,
    toMain: true,
    link: false,
    sends: Array.from({ length: MIX_COUNT }, () => OFF_DB),
    fxSends: FX_NAMES.map(() => OFF_DB),
  };
}

export function makeMixer(id: string, name: string, channelNames: string[]): NodeInstance<MixerProps> {
  return {
    id,
    type: 'mixer',
    name,
    props: {
      power: defaultPower(),
      channels: channelNames.map(defaultChannel),
      localPreamps: channelNames.map(() => ({ gain: 0, phantom: false })),
      main: { master: 0, mute: false, solo: false },
      mixes: Array.from({ length: MIX_COUNT }, (_, i) => ({
        name: `Mix ${i + 1}`,
        master: 0,
        mute: false,
        solo: false,
        preFader: true,
      })),
      fx: FX_NAMES.map((x) => ({ name: `FX ${x}`, master: 0, mute: false, returnLevel: OFF_DB })),
      networkPatch: Array.from({ length: 8 }, (_, j) => `mix${j + 1}` as OutputSource),
      selectedMix: 'main',
      selectedChannel: 1,
      soloMode: 'pfl',
    },
  };
}
