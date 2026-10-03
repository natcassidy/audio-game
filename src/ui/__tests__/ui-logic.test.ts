import { describe, expect, it } from 'vitest';
import { OFF_DB, compile, createDefaultRig, probePoint, simulate, type MixerProps } from '../../engine';
import { freePorts, moveEnd, replaceCable, reseat, unplug } from '../cables';
import { controlsFor, plugOptions } from '../controls';
import { placementOf } from '../layout';
import {
  SLIDER_MIN,
  dbToSlider,
  faderValue,
  formatDb,
  linkedStagebox,
  masterOf,
  mixerOf,
  preampPath,
  setFaderValue,
  sliderToDb,
} from '../mixerModel';
import { getIn, setIn } from '../paths';

describe('paths', () => {
  it('reads and writes nested values, including array indexes', () => {
    const o = { power: { switch: true }, preamps: [{ gain: 1 }, { gain: 2 }] };
    expect(getIn(o, 'power.switch')).toBe(true);
    expect(getIn(o, 'preamps.1.gain')).toBe(2);
    expect(getIn(o, 'nope.deeper')).toBeUndefined();
    setIn(o, 'preamps.1.gain', 40);
    expect(o.preamps[1].gain).toBe(40);
    expect(() => setIn(o, 'nope.deeper', 1)).toThrow();
  });
});

describe('mixer model', () => {
  it('maps the fader slider: the bottom is off', () => {
    expect(sliderToDb(SLIDER_MIN)).toBe(OFF_DB);
    expect(sliderToDb(-10)).toBe(-10);
    expect(dbToSlider(OFF_DB)).toBe(SLIDER_MIN);
    expect(formatDb(OFF_DB)).toBe('−∞');
    expect(formatDb(3)).toBe('+3');
  });

  it('in Main mode faders are channel faders; in Mix mode they are sends', () => {
    const p = mixerOf(createDefaultRig());
    expect(faderValue(p, 8)).toBe(-10);
    p.selectedMix = 'mix3';
    expect(faderValue(p, 8)).toBe(-14);
    setFaderValue(p, 8, OFF_DB);
    expect(p.channels[7].sends[2]).toBe(OFF_DB);
    expect(p.channels[7].fader).toBe(-10);
    expect(masterOf(p)).toBe(p.mixes[2]);
    p.selectedMix = 'main';
    expect(masterOf(p)).toBe(p.main);
  });

  it('the even channel of a linked pair is controlled from the odd one', () => {
    const p = mixerOf(createDefaultRig());
    setFaderValue(p, 12, -3);
    expect(p.channels[10].fader).toBe(-3);
    expect(faderValue(p, 12)).toBe(-3);
  });

  it('Fat Channel gain lives on the stagebox for Network, the mixer for Analog, nowhere for USB', () => {
    const rig = createDefaultRig();
    expect(linkedStagebox(rig)).toBe('stagebox');
    expect(preampPath(rig, 8)).toEqual({ nodeId: 'stagebox', path: 'preamps.7' });
    (rig.nodes.mixer.props as MixerProps).channels[7].source = 'analog';
    expect(preampPath(rig, 8)).toEqual({ nodeId: 'mixer', path: 'localPreamps.7' });
    (rig.nodes.mixer.props as MixerProps).channels[7].source = 'usb';
    expect(preampPath(rig, 8)).toBeNull();
  });

  it('turning up the Fat Channel gain (via its path) changes the channel level', () => {
    const rig = createDefaultRig();
    const pre = preampPath(rig, 1)!;
    setIn(rig.nodes[pre.nodeId].props, `${pre.path}.gain`, 70);
    expect(probePoint(simulate(rig), 'mixer.ch1.pre').level).toBe('clipping');
  });
});

describe('cable actions', () => {
  it('reseat, unplug and replace', () => {
    const rig = createDefaultRig();
    const c = rig.cables['c-in8'];
    unplug(c, 'to');
    expect(c.faults?.unplugged).toBe('to');
    unplug(c, 'from');
    expect(c.faults?.unplugged).toBe('both');
    reseat(c);
    expect(c.faults?.unplugged).toBeUndefined();
    c.faults = { broken: true };
    replaceCable(c);
    expect(c.faults).toBeUndefined();
  });

  it('can move an end to a free jack with the same connector', () => {
    const rig = createDefaultRig();
    const { graph } = compile(rig);
    const c = rig.cables['c-wedge-3'];
    const options = freePorts(rig, graph, c, 'from').map((p) => p.id);
    expect(options).toContain('out3');
    expect(options).toContain('out7');
    expect(options).not.toContain('out4'); // taken by wedge 4
    expect(options).not.toContain('net'); // wrong connector
    moveEnd(c, 'from', 'out7');
    expect(c.from).toEqual({ node: 'stagebox', port: 'out7' });
    expect(probePoint(simulate(rig), 'wedge-3.sound').content[0]?.source).toBeUndefined(); // Mix 7 is empty
  });
});

describe('controls', () => {
  const rig = createDefaultRig();

  it('every device a player can touch has controls', () => {
    for (const id of ['wedge-3', 'stagebox', 'tx-hh', 'rx-wl1', 'bass-di', 'tuner', 'keys', 'bass-amp', 'strip-left', 'vox1']) {
      expect(controlsFor(rig.nodes[id]).length, id).toBeGreaterThan(0);
    }
  });

  it('battery buttons only show when the battery needs replacing', () => {
    const tx = structuredClone(rig.nodes['tx-hh']);
    expect(controlsFor(tx).some((c) => c.label === 'Replace battery')).toBe(false);
    tx.props.battery = 'dead';
    const replace = controlsFor(tx).find((c) => c.label === 'Replace battery');
    expect(replace?.kind).toBe('action');
    if (replace?.kind === 'action') replace.apply(tx);
    expect(tx.props.battery).toBe('good');
    // Passive DIs have no battery to replace.
    const di = structuredClone(rig.nodes['keys-di-l']);
    expect(controlsFor(di).some((c) => c.label === 'Replace battery')).toBe(false);
  });

  it('power cord options list the wall, the other strips, and unplugged', () => {
    expect(plugOptions(rig, 'strip-left').map((o) => o.value)).toEqual(['wall', 'strip-right', '']);
  });
});

describe('layout', () => {
  it('places every device in the default rig on screen', () => {
    const rig = createDefaultRig();
    for (const id of Object.keys(rig.nodes)) {
      const p = placementOf(rig, id);
      expect(p.x, id).toBeGreaterThanOrEqual(0);
      expect(p.x, id).toBeLessThanOrEqual(13);
      expect(p.short.length, id).toBeGreaterThan(0);
    }
  });
});
