import type { Component, Domain, Flag, Level, Signal } from './types';

/**
 * Faders, sends and knobs store "off" as this JSON-safe value. Anything at or
 * below OFF_THRESHOLD is treated as fully off (-∞ dB).
 */
export const OFF_DB = -100;
export const OFF_THRESHOLD = -90;

export const SILENT: Signal = Object.freeze({});

export function isOff(db: number): boolean {
  return !(db > OFF_THRESHOLD);
}

/** Converts a stored fader/send value to a gain, mapping "off" to -∞. */
export function toGain(db: number): number {
  return isOff(db) ? -Infinity : db;
}

/** Power-sums two levels in dB (two equal signals → +3 dB). */
export function dbSum(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi + 10 * Math.log10(1 + 10 ** ((lo - hi) / 10));
}

/**
 * Physical knob (0–10) to dB. 7 is unity, 10 is +12 dB, 0 is off.
 * Used for wedge, amp and instrument volume knobs.
 */
export function knobDb(knob: number): number {
  if (!(knob > 0)) return -Infinity;
  return (Math.min(knob, 10) - 7) * 4;
}

export function isProbe(key: string): boolean {
  return key.startsWith('~');
}

function mergeFlags(a: readonly Flag[], b: readonly Flag[] | undefined): Flag[] {
  if (!b || b.length === 0) return a as Flag[];
  const out = new Set<Flag>(a);
  for (const f of b) out.add(f);
  return [...out].sort();
}

/** If one contribution is this much louder, its flags win outright. */
const DOMINANT_DB = 10;

/**
 * Flags for the sum of two contributions of the same source. A much louder
 * contribution decides; otherwise flags combine, except "bleed", which only
 * survives if both contributions are bleed (direct + bleed is not bleed).
 */
function sumFlags(a: Component, b: Component): Flag[] {
  if (a.db >= b.db + DOMINANT_DB) return a.flags;
  if (b.db >= a.db + DOMINANT_DB) return b.flags;
  const merged = mergeFlags(a.flags, b.flags);
  if (a.flags.includes('bleed') && b.flags.includes('bleed')) return merged;
  return merged.filter((f) => f !== 'bleed');
}

/** Below this a component is dropped entirely to keep signals small. */
const FLOOR_DB = -200;

export function mixSignals(a: Signal, b: Signal): Signal {
  if (a === SILENT) return b;
  if (b === SILENT) return a;
  const out: Record<string, Component> = { ...a };
  for (const [key, comp] of Object.entries(b)) {
    const prev = out[key];
    out[key] = prev ? { db: dbSum(prev.db, comp.db), flags: sumFlags(prev, comp) } : comp;
  }
  return out;
}

export function addComponent(sig: Signal, key: string, db: number, flags: Flag[] = []): Signal {
  if (db < FLOOR_DB) return sig;
  return mixSignals(sig, { [key]: { db, flags: [...flags].sort() } });
}

/**
 * Applies a gain (and optional flags) to every component. `perKey` lets the
 * caller vary gain by source, e.g. a high-pass filter hurting bass more than vocals.
 */
export function applyGain(
  sig: Signal,
  gain: number,
  flags?: readonly Flag[],
  perKey?: (key: string) => { gain?: number; flags?: readonly Flag[] } | undefined,
): Signal {
  if (gain === -Infinity) return SILENT;
  const out: Record<string, Component> = {};
  let any = false;
  for (const [key, comp] of Object.entries(sig)) {
    const extra = perKey?.(key);
    const db = comp.db + gain + (extra?.gain ?? 0);
    if (!(db >= FLOOR_DB)) continue;
    let f = mergeFlags(comp.flags, flags);
    if (extra?.flags) f = mergeFlags(f, extra.flags);
    out[key] = { db, flags: f };
    any = true;
  }
  return any ? out : SILENT;
}

export function addFlags(sig: Signal, flags: readonly Flag[]): Signal {
  return applyGain(sig, 0, flags);
}

/** Total audible level in dB (probes excluded). -∞ when silent. */
export function levelDb(sig: Signal): number {
  let total = -Infinity;
  for (const [key, comp] of Object.entries(sig)) {
    if (!isProbe(key)) total = dbSum(total, comp.db);
  }
  return total;
}

/**
 * Level boundaries per domain: [none below, low below, good up to, hot up to].
 * Above the last value is clipping.
 *  - mic: dBu on a mic cable (a close vocal is about -47)
 *  - instrument: dBu from a guitar/bass/keys output
 *  - line: dBu after a preamp, inside the mixer, and on line outputs (0 = nominal)
 *  - acoustic: dB SPL at a listener or mic
 *  - close: dB SPL up close — 1 m from a voice, drum, amp or speaker, or at a close mic's capsule
 */
export const DOMAIN_RANGES: Record<Domain, readonly [number, number, number, number]> = {
  mic: [-90, -65, -20, -5],
  instrument: [-60, -35, -5, 5],
  line: [-40, -12, 6, 14],
  acoustic: [45, 70, 95, 105],
  close: [55, 65, 112, 120],
};

export function classify(db: number, domain: Domain): Level {
  const [none, low, good, hot] = DOMAIN_RANGES[domain];
  if (!(db >= none)) return 'none';
  if (db < low) return 'low';
  if (db <= good) return 'good';
  if (db <= hot) return 'hot';
  return 'clipping';
}

/** True if the level is above the 'clipping' threshold for its domain. */
export function isClipping(db: number, domain: Domain): boolean {
  return db > DOMAIN_RANGES[domain][3];
}

export interface ContentItem {
  source: string;
  label: string;
  db: number;
  level: Level;
  flags: Flag[];
}

/** Components quieter than the loudest by more than this aren't listed as content. */
export const CONTENT_WINDOW_DB = 20;

/**
 * Lists the audible sources a signal carries, loudest first. A component is
 * listed if it's audible in its domain and within CONTENT_WINDOW_DB of the
 * loudest component (so faint bleed doesn't clutter the readout).
 */
export function contentOf(
  sig: Signal,
  domain: Domain,
  labelOf: (source: string) => string = (s) => s,
): ContentItem[] {
  const items: ContentItem[] = [];
  let loudest = -Infinity;
  for (const [key, comp] of Object.entries(sig)) {
    if (isProbe(key)) continue;
    if (classify(comp.db, domain) === 'none') continue;
    loudest = Math.max(loudest, comp.db);
    items.push({ source: key, label: labelOf(key), db: comp.db, level: classify(comp.db, domain), flags: comp.flags });
  }
  return items
    .filter((i) => i.db >= loudest - CONTENT_WINDOW_DB)
    .sort((a, b) => b.db - a.db || a.label.localeCompare(b.label));
}

/** "Bass + Leader vocal (thin)" style summary. */
export function contentLabel(items: ContentItem[]): string {
  if (items.length === 0) return 'nothing';
  return items
    .map((i) => {
      const notes = i.flags.filter((f) => f !== 'fx');
      return notes.length ? `${i.label} (${notes.join(', ')})` : i.label;
    })
    .join(' + ');
}
