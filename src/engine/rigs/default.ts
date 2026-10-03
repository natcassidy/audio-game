// The default rig: our church's setup.
//
// TODO (from the build plan): confirm against a real stage inventory —
// which stagebox input each source uses and which stagebox output feeds each
// wedge. For now stagebox In N feeds mixer channel N, and stagebox Out N
// carries Mix N to wedge N.

import { defaultPower } from '../devices/common';
import type { AcousticGuitarProps, DrumKitProps, GuitarProps, KeyboardProps, TunerProps } from '../devices/instruments';
import { makeAmp, makeDi } from '../devices/instruments';
import { makeMic, makeReceiver, makeTransmitter } from '../devices/mics';
import { makeMixer, type MixerProps } from '../devices/mixer';
import { makePerformer, makeRoom } from '../devices/people';
import { makePowerStrip, makeSpeaker } from '../devices/speakers';
import { makeStagebox } from '../devices/stagebox';
import type { Rig } from '../types';
import { cable, node, rigOf } from './helpers';

export const CHANNEL_NAMES = [
  'Vox 1',
  'Vox 2',
  'Vox 3',
  'Vox 4',
  'Vox 5',
  'Vox 6',
  'Keys',
  'Bass',
  'Tom',
  'Hi-hat',
  'Room L',
  'Room R',
  'Guitar',
  'WL1',
  'WL2',
  'Handheld',
];

/** Channel number (1-based) for each name, e.g. CH.Bass === 8. */
export const CH = Object.fromEntries(CHANNEL_NAMES.map((n, i) => [n, i + 1])) as Record<string, number>;

/** Preamp gain that brings each source to a healthy level. */
const GAINS = [45, 45, 45, 45, 45, 45, 28, 38, 30, 25, 35, 35, 43, 45, 45, 45];
const PHANTOM = new Set([CH['Hi-hat'], CH['Room L'], CH['Room R']]);
const HPF: Record<number, number> = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 13: 80, 14: 100, 15: 100, 16: 100 };

/** Monitor mixes: name, and send level (dB) per channel name. */
const MIXES: { name: string; sends: Record<string, number> }[] = [
  { name: 'Leader', sends: { 'Vox 1': -8, Guitar: -12, Keys: -18, 'Vox 2': -18, 'Vox 3': -18 } },
  { name: 'Singers', sends: { 'Vox 2': -8, 'Vox 4': -11, 'Vox 1': -14, Keys: -18, Guitar: -18 } },
  { name: 'Keys', sends: { Keys: -8, 'Vox 5': -11, Bass: -14, 'Vox 1': -14, Guitar: -18 } },
  { name: 'Bass', sends: { 'Vox 6': -11, Bass: -18, 'Hi-hat': -18, Keys: -14, 'Vox 1': -14 } },
  { name: 'Drums', sends: { Bass: -8, Keys: -14, 'Vox 1': -14, Guitar: -18 } },
  { name: 'Singer 3', sends: { 'Vox 3': -8, 'Vox 1': -14, Keys: -18 } },
];

function configureMixer(p: MixerProps) {
  p.channels.forEach((ch, i) => {
    const n = i + 1;
    ch.fader = -10;
    ch.hpf = HPF[n] ?? 0;
  });
  p.channels[CH['Room L'] - 1].link = true;
  MIXES.forEach((mix, k) => {
    p.mixes[k].name = mix.name;
    for (const [chName, db] of Object.entries(mix.sends)) p.channels[CH[chName] - 1].sends[k] = db;
  });
}

export function createDefaultRig(): Rig {
  const mixer = makeMixer('mixer', 'Mixer', CHANNEL_NAMES);
  configureMixer(mixer.props);

  const stagebox = makeStagebox('stagebox', 'Stagebox', { x: 6, y: 6 });
  stagebox.props.preamps = GAINS.map((gain, i) => ({ gain, phantom: PHANTOM.has(i + 1) }));

  const singers = [
    makePerformer('leader', 'Leader', { x: 6, y: 1.5 }, { role: 'Worship leader (acoustic guitar)', voiceLabel: 'Leader vocal' }),
    makePerformer('singer2', 'Singer 2', { x: 4, y: 1.6 }, { role: 'Vocalist' }),
    makePerformer('singer3', 'Singer 3', { x: 8, y: 1.6 }, { role: 'Vocalist' }),
    makePerformer('singer4', 'Singer 4', { x: 2.5, y: 2.2 }, { role: 'Vocalist' }),
    makePerformer('keys-player', 'Keys player', { x: 10, y: 3 }, { role: 'Keys and vocals' }),
    makePerformer('bass-player', 'Bass player', { x: 3, y: 4 }, { role: 'Bass and vocals' }),
  ];
  const people = [
    ...singers,
    makePerformer('drummer', 'Drummer', { x: 6, y: 4.6 }, { role: 'Drums', sings: false }),
    makePerformer('pastor', 'Pastor', { x: 5, y: 0.8 }, { role: 'Pastor (WL1 headset)', voiceLabel: 'Pastor' }),
    makePerformer('associate', 'Associate pastor', { x: 7, y: 0.8 }, { role: 'WL2 headset', voiceLabel: 'Associate pastor' }),
    makePerformer('host', 'Host', { x: 9, y: 0.8 }, { role: 'Announcements (handheld)', voiceLabel: 'Host' }),
    makeRoom('congregation', 'Congregation', { x: 6, y: -8 }),
  ];

  const vocalMics = singers.map((s, i) =>
    makeMic(`vox${i + 1}`, `Vox ${i + 1} mic`, { targets: [{ point: `${s.id}.voice`, distance: 0.05 }], owner: s.id }),
  );

  const drums = node<DrumKitProps>('drum-kit', 'drums', 'Drum kit', { tom: 95, hihat: 90, kit: 100 }, { x: 6, y: 5.3 });
  const kitTargets = (d: number) => ['tom', 'hihat', 'kit'].map((part) => ({ point: `drums.${part}`, distance: d }));
  const drumMics = [
    makeMic('tom-mic', 'Tom mic', { targets: [{ point: 'drums.tom', distance: 0.1 }] }),
    makeMic('hihat-mic', 'Hi-hat mic', { targets: [{ point: 'drums.hihat', distance: 0.15 }], micType: 'condenser' }),
    makeMic('room-l', 'Room mic L', { targets: kitTargets(1.5), micType: 'condenser', position: { x: 4.8, y: 5.6 } }),
    makeMic('room-r', 'Room mic R', { targets: kitTargets(1.5), micType: 'condenser', position: { x: 7.2, y: 5.6 } }),
  ];

  const instruments = [
    node<GuitarProps>('bass-guitar', 'bass', 'Bass', { volume: 7 }, { x: 3, y: 4 }),
    makeDi('bass-di', 'Bass DI', { active: true, battery: 'good' }),
    makeAmp('bass-amp', 'Bass amp (Fender Rumble 15)', 'Fender Rumble 15', { x: 2.2, y: 5.2 }),
    makeAmp('spare-amp', 'Spare bass amp (Peavey Basic 112)', 'Peavey Basic 112', { x: 1.2, y: 5.4 }, { power: { switch: false, plug: 'wall' } }),
    node<KeyboardProps>('keyboard', 'keys', 'Keys', { power: defaultPower(), volume: 7 }, { x: 10, y: 3 }),
    makeDi('keys-di-l', 'Keys DI L'),
    makeDi('keys-di-r', 'Keys DI R'),
    node<AcousticGuitarProps>('acoustic-guitar', 'acoustic', 'Acoustic guitar', { volume: 7, pickupBattery: 'good' }, { x: 6, y: 1.4 }),
    node<TunerProps>('tuner', 'tuner', 'Tuner pedal', { engaged: false, battery: 'good' }),
    makeDi('acoustic-di', 'Acoustic DI'),
    drums,
  ];

  const wireless = [
    makeTransmitter('tx-wl1', 'WL1 body-pack', { kind: 'bodypack', owner: 'pastor', frequency: 518.2, pairedRx: 'rx-wl1' }),
    makeTransmitter('tx-wl2', 'WL2 body-pack', { kind: 'bodypack', owner: 'associate', frequency: 524.6, pairedRx: 'rx-wl2' }),
    makeTransmitter('tx-hh', 'Handheld mic', { kind: 'handheld', owner: 'host', frequency: 530.1, pairedRx: 'rx-hh' }),
    makeReceiver('rx-wl1', 'WL1 receiver', 518.2, { x: 5, y: 6.2 }),
    makeReceiver('rx-wl2', 'WL2 receiver', 524.6, { x: 5.4, y: 6.2 }),
    makeReceiver('rx-hh', 'Handheld receiver', 530.1, { x: 5.8, y: 6.2 }),
  ];

  const speakers = [
    makeSpeaker('main-speaker', 'main-l', 'Main L', { x: 1, y: -0.5 }, 'congregation'),
    makeSpeaker('main-speaker', 'main-r', 'Main R', { x: 11, y: -0.5 }, 'congregation'),
    makeSpeaker('wedge', 'wedge-1', 'Wedge 1 (Leader)', { x: 6, y: 0.4 }, 'leader'),
    makeSpeaker('wedge', 'wedge-2', 'Wedge 2 (Singers)', { x: 3.4, y: 0.5 }, 'singer2', 'strip-left'),
    makeSpeaker('wedge', 'wedge-3', 'Wedge 3 (Keys)', { x: 10, y: 1.8 }, 'keys-player', 'strip-right'),
    makeSpeaker('wedge', 'wedge-4', 'Wedge 4 (Bass)', { x: 3, y: 2.9 }, 'bass-player', 'strip-left'),
    makeSpeaker('wedge', 'wedge-5', 'Wedge 5 (Drums)', { x: 7, y: 3.8 }, 'drummer'),
    makeSpeaker('wedge', 'wedge-6', 'Wedge 6 (Singer 3)', { x: 8, y: 0.5 }, 'singer3', 'strip-right'),
    makePowerStrip('strip-left', 'Power strip (left)', { x: 2, y: 3 }),
    makePowerStrip('strip-right', 'Power strip (right)', { x: 10, y: 2.4 }),
  ];

  const xlr = (n: number, from: string, label: string) => cable(`c-in${n}`, 'xlr', from, `stagebox.in${n}`, label);
  const cables = [
    ...vocalMics.map((m, i) => xlr(i + 1, `${m.id}.out`, `Vox ${i + 1} XLR`)),
    cable('c-keys-l', 'quarter-inch', 'keys.outL', 'keys-di-l.in', 'Keys L cable'),
    cable('c-keys-r', 'quarter-inch', 'keys.outR', 'keys-di-r.in', 'Keys R cable'),
    xlr(7, 'keys-di-l.xlr', 'Keys DI XLR'),
    cable('c-bass', 'quarter-inch', 'bass.out', 'bass-di.in', 'Bass cable'),
    cable('c-bass-amp', 'quarter-inch', 'bass-di.thru', 'bass-amp.in', 'Bass amp cable'),
    xlr(8, 'bass-di.xlr', 'Bass DI XLR'),
    xlr(9, 'tom-mic.out', 'Tom XLR'),
    xlr(10, 'hihat-mic.out', 'Hi-hat XLR'),
    xlr(11, 'room-l.out', 'Room L XLR'),
    xlr(12, 'room-r.out', 'Room R XLR'),
    cable('c-acoustic', 'quarter-inch', 'acoustic.out', 'tuner.in', 'Acoustic guitar cable'),
    cable('c-tuner', 'quarter-inch', 'tuner.out', 'acoustic-di.in', 'Tuner patch cable'),
    xlr(13, 'acoustic-di.xlr', 'Acoustic DI XLR'),
    xlr(14, 'rx-wl1.out', 'WL1 receiver XLR'),
    xlr(15, 'rx-wl2.out', 'WL2 receiver XLR'),
    xlr(16, 'rx-hh.out', 'Handheld receiver XLR'),
    cable('c-network', 'network', 'stagebox.net', 'mixer.net', 'Network cable (stagebox ↔ mixer)'),
    cable('c-main-l', 'xlr', 'mixer.mainL', 'main-l.in', 'Main L feed'),
    cable('c-main-r', 'xlr', 'mixer.mainR', 'main-r.in', 'Main R feed'),
    ...[1, 2, 3, 4, 5, 6].map((n) => cable(`c-wedge-${n}`, 'xlr', `stagebox.out${n}`, `wedge-${n}.in`, `Wedge ${n} cable`)),
  ];

  return rigOf([mixer, stagebox, ...people, ...vocalMics, ...drumMics, ...instruments, ...wireless, ...speakers], cables);
}
