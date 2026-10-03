import { describe, expect, it } from 'vitest';
import {
  OFF_DB,
  SILENT,
  addComponent,
  applyGain,
  classify,
  contentLabel,
  contentOf,
  dbSum,
  isOff,
  knobDb,
  levelDb,
  mixSignals,
  toGain,
} from '../signal';
import { bandEffect, hpfLowLoss, SPECTRA } from '../sources';
import type { Signal } from '../types';

describe('dB math', () => {
  it('power-sums equal signals to +3 dB', () => {
    expect(dbSum(0, 0)).toBeCloseTo(3.01, 2);
    expect(dbSum(-10, -10)).toBeCloseTo(-6.99, 2);
  });

  it('treats -∞ as silence', () => {
    expect(dbSum(-Infinity, -5)).toBe(-5);
    expect(dbSum(-5, -Infinity)).toBe(-5);
    expect(dbSum(-Infinity, -Infinity)).toBe(-Infinity);
  });

  it('a much quieter signal barely changes the sum', () => {
    expect(dbSum(0, -30)).toBeCloseTo(0.004, 2);
  });

  it('maps knobs: 0 is off, 7 is unity, 10 is +12 dB', () => {
    expect(knobDb(0)).toBe(-Infinity);
    expect(knobDb(7)).toBe(0);
    expect(knobDb(10)).toBe(12);
    expect(knobDb(5)).toBe(-8);
    expect(knobDb(12)).toBe(12);
  });

  it('stores "off" as a JSON-safe number', () => {
    expect(isOff(OFF_DB)).toBe(true);
    expect(isOff(-89)).toBe(false);
    expect(toGain(OFF_DB)).toBe(-Infinity);
    expect(toGain(-6)).toBe(-6);
    expect(JSON.parse(JSON.stringify({ f: OFF_DB })).f).toBe(OFF_DB);
  });
});

describe('level classification', () => {
  it('uses different ranges per domain', () => {
    expect(classify(-47, 'mic')).toBe('good');
    expect(classify(-47, 'line')).toBe('none');
    expect(classify(0, 'line')).toBe('good');
    expect(classify(0, 'mic')).toBe('clipping');
    expect(classify(-20, 'instrument')).toBe('good');
    expect(classify(88, 'acoustic')).toBe('good');
    expect(classify(107, 'close')).toBe('good');
    expect(classify(107, 'acoustic')).toBe('clipping');
  });

  it('covers every band of the line domain', () => {
    expect(classify(-Infinity, 'line')).toBe('none');
    expect(classify(-41, 'line')).toBe('none');
    expect(classify(-30, 'line')).toBe('low');
    expect(classify(-5, 'line')).toBe('good');
    expect(classify(10, 'line')).toBe('hot');
    expect(classify(20, 'line')).toBe('clipping');
  });
});

describe('signals', () => {
  const a: Signal = { bass: { db: -10, flags: [] } };
  const b: Signal = { bass: { db: -10, flags: [] }, keys: { db: -20, flags: [] } };

  it('mixes components per source', () => {
    const m = mixSignals(a, b);
    expect(m.bass.db).toBeCloseTo(-6.99, 2);
    expect(m.keys.db).toBe(-20);
    expect(levelDb(m)).toBeCloseTo(dbSum(-6.99, -20), 2);
  });

  it('mixing with silence is a no-op', () => {
    expect(mixSignals(SILENT, a)).toBe(a);
    expect(mixSignals(a, SILENT)).toBe(a);
  });

  it('applies gain and flags, and -∞ silences everything', () => {
    const g = applyGain(b, -6, ['thin']);
    expect(g.bass.db).toBe(-16);
    expect(g.keys.flags).toEqual(['thin']);
    expect(applyGain(b, -Infinity)).toBe(SILENT);
  });

  it('applies per-source gain', () => {
    const g = applyGain(b, 0, undefined, (k) => (k === 'bass' ? { gain: -12, flags: ['thin'] } : undefined));
    expect(g.bass).toEqual({ db: -22, flags: ['thin'] });
    expect(g.keys).toEqual({ db: -20, flags: [] });
  });

  it('a direct signal plus bleed of the same source is not "bleed"', () => {
    const direct = addComponent(SILENT, 'vox', -5);
    const bleed = addComponent(SILENT, 'vox', -12, ['bleed']);
    expect(mixSignals(direct, bleed).vox.flags).toEqual([]);
    expect(mixSignals(bleed, addComponent(SILENT, 'vox', -12, ['bleed'])).vox.flags).toEqual(['bleed']);
  });

  it('the much louder contribution decides the flags', () => {
    const clean = addComponent(SILENT, 'bass', 0);
    const thin = addComponent(SILENT, 'bass', -20, ['thin']);
    expect(mixSignals(clean, thin).bass.flags).toEqual([]);
    const close = addComponent(SILENT, 'bass', -3, ['thin']);
    expect(mixSignals(clean, close).bass.flags).toEqual(['thin']);
  });

  it('ignores hidden probes when measuring level and content', () => {
    const s = addComponent(addComponent(SILENT, '~fb:x', 50), 'bass', -10);
    expect(levelDb(s)).toBe(-10);
    expect(contentOf(s, 'line').map((c) => c.source)).toEqual(['bass']);
  });
});

describe('content', () => {
  it('lists audible sources loudest first and hides faint ones', () => {
    const s: Signal = {
      vox: { db: -5, flags: [] },
      bass: { db: -15, flags: ['thin'] },
      faint: { db: -30, flags: [] },
      inaudible: { db: -60, flags: [] },
    };
    const items = contentOf(s, 'line', (k) => k.toUpperCase());
    expect(items.map((i) => i.source)).toEqual(['vox', 'bass']);
    expect(contentLabel(items)).toBe('VOX + BASS (thin)');
  });

  it('says "nothing" for silence', () => {
    expect(contentLabel(contentOf(SILENT, 'line'))).toBe('nothing');
  });
});

describe('EQ and filters', () => {
  it('flat EQ leaves level unchanged', () => {
    expect(bandEffect(SPECTRA.voice, { low: 0, mid: 0, high: 0 }).gain).toBeCloseTo(0, 6);
  });

  it('cutting the low end thins out bass but not vocals', () => {
    const bass = bandEffect(SPECTRA.bass, { low: -hpfLowLoss(200), mid: 0, high: 0 });
    const vox = bandEffect(SPECTRA.voice, { low: -hpfLowLoss(200), mid: 0, high: 0 });
    expect(bass.flags).toEqual(['thin']);
    expect(bass.gain).toBeLessThan(-4);
    expect(vox.flags).toBeUndefined();
    expect(vox.gain).toBeGreaterThan(-0.5);
  });

  it('HPF loss grows with frequency', () => {
    expect(hpfLowLoss(0)).toBe(0);
    expect(hpfLowLoss(40)).toBe(0);
    expect(hpfLowLoss(80)).toBeLessThan(hpfLowLoss(100));
    expect(hpfLowLoss(100)).toBeLessThan(hpfLowLoss(200));
  });
});
