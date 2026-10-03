import type { Flag } from './types';

/** Rough share of a source's energy in each band. Weights sum to 1. */
export interface Spectrum {
  low: number;
  mid: number;
  high: number;
}

export type SourceKind = 'voice' | 'instrument' | 'drum' | 'noise' | 'feedback' | 'playback' | 'probe';

export interface SourceInfo {
  id: string;
  label: string;
  kind: SourceKind;
  spectrum: Spectrum;
}

export const SPECTRA = {
  voice: { low: 0.1, mid: 0.6, high: 0.3 },
  bass: { low: 0.7, mid: 0.25, high: 0.05 },
  keys: { low: 0.3, mid: 0.5, high: 0.2 },
  acousticGuitar: { low: 0.2, mid: 0.5, high: 0.3 },
  electricGuitar: { low: 0.2, mid: 0.6, high: 0.2 },
  tom: { low: 0.5, mid: 0.4, high: 0.1 },
  kit: { low: 0.45, mid: 0.3, high: 0.25 },
  hihat: { low: 0, mid: 0.2, high: 0.8 },
  hum: { low: 1, mid: 0, high: 0 },
  feedback: { low: 0, mid: 0.7, high: 0.3 },
  flat: { low: 0, mid: 1, high: 0 },
} satisfies Record<string, Spectrum>;

/** Sources with at least this much low end get flagged "thin" when they lose it. */
const LOW_END_WEIGHT = 0.4;
/** How much low-band loss counts as "thin". */
const THIN_LOSS_DB = 6;

export interface BandGains {
  low: number;
  mid: number;
  high: number;
}

/**
 * Overall gain change for a source when each band is boosted/cut by the given
 * amounts, plus a "thin" flag if a low-heavy source loses its low end.
 */
export function bandEffect(spectrum: Spectrum, bands: BandGains): { gain: number; flags?: Flag[] } {
  const power =
    spectrum.low * 10 ** (bands.low / 10) +
    spectrum.mid * 10 ** (bands.mid / 10) +
    spectrum.high * 10 ** (bands.high / 10);
  const gain = power > 0 ? 10 * Math.log10(power) : -Infinity;
  const thin = spectrum.low >= LOW_END_WEIGHT && bands.low <= -THIN_LOSS_DB;
  return thin ? { gain, flags: ['thin'] } : { gain };
}

/** Low-band loss in dB from a high-pass filter at the given frequency (0 = off). */
export function hpfLowLoss(freq: number): number {
  if (!(freq > 40)) return 0;
  if (freq <= 60) return 1;
  if (freq <= 80) return 3;
  if (freq <= 100) return 6;
  if (freq <= 150) return 12;
  if (freq <= 250) return 20;
  return 30;
}
