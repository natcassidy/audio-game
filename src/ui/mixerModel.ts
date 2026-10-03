// How the mixer's controls map onto the rig, so components stay simple.

import { OFF_DB, isOff, type MixSelect, type MixerProps, type Rig } from '../engine';

/** Faders and sends show a slider from OFF (-61) to +10 dB. */
export const SLIDER_MIN = -61;
export const SLIDER_MAX = 10;

export function sliderToDb(v: number): number {
  return v <= SLIDER_MIN ? OFF_DB : v;
}

export function dbToSlider(db: number): number {
  return isOff(db) ? SLIDER_MIN : Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, db));
}

export function formatDb(db: number): string {
  if (isOff(db)) return '−∞';
  const r = Math.round(db * 10) / 10;
  return `${r > 0 ? '+' : ''}${r}`;
}

export function mixerOf(rig: Rig, mixerId = 'mixer'): MixerProps {
  return rig.nodes[mixerId].props as MixerProps;
}

/** The even channel of a linked pair is controlled from the odd one. */
export function controllingChannel(p: MixerProps, n: number): number {
  return n % 2 === 0 && p.channels[n - 2]?.link ? n - 1 : n;
}

/** Index into sends/fxSends for the current mix, or null in Main mode. */
function sendTarget(mode: MixSelect): { kind: 'mix' | 'fx'; index: number } | null {
  if (mode === 'main') return null;
  if (mode.startsWith('fx')) return { kind: 'fx', index: 'ABCD'.indexOf(mode.slice(2)) };
  return { kind: 'mix', index: Number(mode.slice(3)) - 1 };
}

/** What a channel's fader controls right now: its fader in Main mode, its send in Mix mode. */
export function faderValue(p: MixerProps, n: number, mode: MixSelect = p.selectedMix): number {
  const ch = p.channels[controllingChannel(p, n) - 1];
  const t = sendTarget(mode);
  if (!t) return ch.fader;
  return (t.kind === 'mix' ? ch.sends : ch.fxSends)[t.index] ?? OFF_DB;
}

export function setFaderValue(p: MixerProps, n: number, db: number, mode: MixSelect = p.selectedMix): void {
  const ch = p.channels[controllingChannel(p, n) - 1];
  const t = sendTarget(mode);
  if (!t) ch.fader = db;
  else (t.kind === 'mix' ? ch.sends : ch.fxSends)[t.index] = db;
}

/** Master level for the selected mix (Main, Mix N or FX X). */
export function masterOf(p: MixerProps, mode: MixSelect = p.selectedMix): { master: number; mute: boolean } {
  const t = sendTarget(mode);
  if (!t) return p.main;
  return t.kind === 'mix' ? p.mixes[t.index] : p.fx[t.index];
}

/** The stagebox on the other end of the mixer's network cable, if any. */
export function linkedStagebox(rig: Rig, mixerId = 'mixer'): string | undefined {
  for (const c of Object.values(rig.cables)) {
    if (c.kind !== 'network') continue;
    const ends = [c.from, c.to];
    const mine = ends.findIndex((e) => e?.node === mixerId && e.port === 'net');
    const other = mine >= 0 ? ends[1 - mine] : null;
    if (other && rig.nodes[other.node]?.type === 'stagebox') return other.node;
  }
  return undefined;
}

/**
 * Where the Fat Channel's gain and 48V for channel n live. With source
 * Network the mixer remote-controls the stagebox preamp; with Analog it's
 * the mixer's own preamp; USB/SD have no preamp.
 */
export function preampPath(rig: Rig, n: number, mixerId = 'mixer'): { nodeId: string; path: string } | null {
  const p = mixerOf(rig, mixerId);
  const src = p.channels[n - 1].source;
  if (src === 'analog') return { nodeId: mixerId, path: `localPreamps.${n - 1}` };
  if (src === 'network') {
    const sb = linkedStagebox(rig, mixerId);
    return sb ? { nodeId: sb, path: `preamps.${n - 1}` } : null;
  }
  return null;
}
