// The knobs, switches and buttons the player can touch on each device, with
// plain-language tooltips. Hidden faults (broken gear, ground loops) are not
// controls: the player finds them by probing and fixes them by swapping or
// pressing the right button.

import type { NodeInstance, Rig } from '../engine';
import { getIn } from './paths';

export interface Option {
  value: string;
  label: string;
}

export type Control =
  | { kind: 'toggle'; label: string; path: string; hint: string; onLabel?: string; offLabel?: string }
  | { kind: 'knob'; label: string; path: string; hint: string }
  | { kind: 'select'; label: string; path: string; hint: string; options: Option[]; numeric?: boolean }
  | { kind: 'plug'; label: string; hint: string }
  | { kind: 'action'; label: string; hint: string; apply: (node: NodeInstance) => void; visible?: (node: NodeInstance) => boolean };

const power: Control = { kind: 'toggle', label: 'Power', path: 'power.switch', hint: 'The power switch on the device.' };
const plug: Control = {
  kind: 'plug',
  label: 'Power cord',
  hint: 'Where the power cord is plugged in. A power strip only works if it has power itself.',
};
const volume: Control = { kind: 'knob', label: 'Volume', path: 'volume', hint: 'Volume knob, 0–10. 7 is normal; 0 is silent.' };

function replaceBattery(path: string, what = 'battery', visible?: (n: NodeInstance) => boolean): Control {
  return {
    kind: 'action',
    label: `Replace ${what}`,
    hint: 'Put in a fresh battery.',
    apply: (n) => {
      (n.props as Record<string, unknown>)[path] = 'good';
    },
    visible: (n) => getIn(n.props, path) !== 'good' && (!visible || visible(n)),
  };
}

export const FREQUENCIES = [518.2, 524.6, 530.1, 536.4];
const frequency: Control = {
  kind: 'select',
  label: 'Frequency',
  path: 'frequency',
  numeric: true,
  hint: 'Transmitter and receiver must be on the same frequency. Two transmitters on one frequency interfere.',
  options: FREQUENCIES.map((f) => ({ value: String(f), label: `${f.toFixed(3)} MHz` })),
};

const CONTROLS: Record<string, Control[]> = {
  mic: [{ kind: 'toggle', label: 'On/off switch', path: 'switchOn', hint: "Some mics have a switch on the handle. Off means silent." }],
  'wireless-tx': [
    { kind: 'toggle', label: 'Power', path: 'switchOn', hint: 'Transmitter power switch.' },
    { kind: 'toggle', label: 'Mute', path: 'muted', hint: 'Mute switch on the pack or mic. The receiver still shows RF signal while muted!' },
    frequency,
    replaceBattery('battery'),
  ],
  'wireless-rx': [
    power,
    plug,
    frequency,
    {
      kind: 'select',
      label: 'Output level',
      path: 'outputLevel',
      hint: 'Mic or line level on the XLR output. Line is about 30 dB hotter.',
      options: [
        { value: 'mic', label: 'Mic' },
        { value: 'line', label: 'Line' },
      ],
    },
  ],
  'bass-guitar': [volume],
  'electric-guitar': [volume],
  'acoustic-guitar': [volume, replaceBattery('pickupBattery', 'pickup battery')],
  keyboard: [power, plug, { ...volume, label: 'Master volume' }],
  di: [
    { kind: 'toggle', label: 'Ground lift', path: 'groundLift', hint: 'Breaks the ground connection between stage and mixer. Fixes hum from ground loops.' },
    { kind: 'toggle', label: '-20 dB pad', path: 'pad', hint: 'Cuts the level for very hot sources.' },
    replaceBattery('battery', 'battery', (n) => (n.props as { active: boolean }).active),
  ],
  tuner: [
    { kind: 'toggle', label: 'Engaged (tuning)', path: 'engaged', hint: 'While engaged, the tuner mutes the signal so you can tune silently.' },
    replaceBattery('battery'),
  ],
  modeler: [power, plug, { ...volume, label: 'Output level' }],
  amp: [power, plug, volume],
  stagebox: [
    power,
    plug,
    { kind: 'toggle', label: 'Mute All', path: 'muteAll', hint: 'Mutes every stagebox output (the wedges). Inputs keep working.' },
  ],
  mixer: [power, plug],
  wedge: [power, plug, volume],
  'main-speaker': [power, plug, volume],
  'power-strip': [
    { ...power, hint: 'The strip’s own switch. Everything plugged into it loses power when it’s off.' },
    plug,
    {
      kind: 'action',
      label: 'Press reset',
      hint: 'Resets the breaker after it trips.',
      apply: (n) => {
        (n.props as { tripped: boolean }).tripped = false;
      },
    },
  ],
};

export function controlsFor(node: NodeInstance): Control[] {
  return (CONTROLS[node.type] ?? []).filter((c) => c.kind !== 'action' || !c.visible || c.visible(node));
}

/** Choices for a power cord: the wall, any power strip (not itself), or unplugged. */
export function plugOptions(rig: Rig, nodeId: string): Option[] {
  return [
    { value: 'wall', label: 'Wall outlet' },
    ...Object.values(rig.nodes)
      .filter((n) => n.type === 'power-strip' && n.id !== nodeId)
      .map((n) => ({ value: n.id, label: n.name })),
    { value: '', label: 'Unplugged' },
  ];
}

/** One-line description shown under a device's name. */
export const DEVICE_BLURBS: Record<string, string> = {
  performer: 'A musician or speaker. Click to see everything they hear.',
  room: 'Where the congregation sits. Hears the main speakers plus whatever is loud on stage.',
  mic: 'Turns sound into a mic-level signal. Condenser mics need 48V phantom power.',
  'wireless-tx': 'Wireless transmitter. Needs a good battery, must be unmuted, and on the receiver’s frequency.',
  'wireless-rx': 'Wireless receiver. RF bars show the transmitter is on; the audio meter shows sound is getting through.',
  'bass-guitar': 'Electric bass. 1/4" output, usually into a DI.',
  'electric-guitar': 'Electric guitar. 1/4" output to an amp or modeler.',
  'acoustic-guitar': 'Acoustic with a battery-powered pickup.',
  keyboard: 'Stereo outputs (L and R), each into a DI.',
  'drum-kit': 'Loud on its own. Mics pick up the pieces they’re aimed at, and everything else a bit.',
  di: 'Direct box: turns a 1/4" instrument signal into a mic-level XLR signal. Thru jack goes to an amp. Active DIs need a battery or 48V.',
  tuner: 'Tuner pedal. Mutes the signal while engaged.',
  modeler: 'Amp modeler with a direct XLR out.',
  amp: 'Instrument amp. Heard on stage only, not through the mixer — and bleeds into nearby mics when loud.',
  stagebox: 'PreSonus NSB 16.8: 16 inputs and 8 outputs on stage, connected to the mixer by one network cable.',
  mixer: 'PreSonus StudioLive 32SC. Use the mixer panel below.',
  wedge: 'Powered floor monitor, fed by a stagebox output. Small speaker, so bass sounds thin.',
  'main-speaker': 'Main PA speaker, fed by the Main mix.',
  'power-strip': 'Shared power strip. If it trips, everything on it goes dark at once.',
};
