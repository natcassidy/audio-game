import type { DeviceDef } from '../graph';
import { acousticGuitar, bassGuitar, diBox, drumKit, electricGuitar, instrumentAmp, keyboard, modeler, tunerPedal } from './instruments';
import { mic, wirelessReceiver, wirelessTransmitter } from './mics';
import { mixer } from './mixer';
import { performer, room } from './people';
import { mainSpeaker, powerStrip, wedge } from './speakers';
import { stagebox } from './stagebox';

export const DEVICES: Record<string, DeviceDef> = Object.fromEntries(
  [
    performer,
    room,
    mic,
    wirelessTransmitter,
    wirelessReceiver,
    bassGuitar,
    electricGuitar,
    acousticGuitar,
    keyboard,
    drumKit,
    diBox,
    tunerPedal,
    modeler,
    instrumentAmp,
    stagebox,
    mixer,
    wedge,
    mainSpeaker,
    powerStrip,
  ].map((d) => [d.type, d as DeviceDef]),
);
