import { describe, expect, it } from 'vitest';
import { acousticCoupling, compile } from '../compile';
import { effectiveChannel, panGains, type MixerProps } from '../devices/mixer';
import type { EmitterInfo, ReceiverInfo } from '../graph';
import { makeDi } from '../devices/instruments';
import { makeMic } from '../devices/mics';
import { makePowerStrip, makeSpeaker } from '../devices/speakers';
import { makeStagebox } from '../devices/stagebox';
import { probeCable, probePoint, probePort } from '../probe';
import { cable, cableAt, cloneRig, node, rigOf } from '../rigs/helpers';
import { simulate } from '../simulate';
import { freshRig, mixer } from './helpers';

describe('cables', () => {
  it('creates an output → input edge regardless of which end is "from"', () => {
    const rig = freshRig();
    const { graph } = compile(rig);
    const [id] = graph.cables.get('c-in8')!.edges;
    expect(graph.edges[id]).toMatchObject({ from: 'bass-di.xlr', to: 'stagebox.in8', kind: 'cable', cableId: 'c-in8' });
  });

  it('a network cable carries every lane in both directions', () => {
    const { graph } = compile(freshRig());
    const edges = graph.cables.get('c-network')!.edges.map((id) => graph.edges[id]);
    expect(edges).toHaveLength(16 + 8);
    expect(edges.filter((e) => e.from.startsWith('stagebox.net.tx')).length).toBe(16);
    expect(edges.filter((e) => e.from.startsWith('mixer.net.tx')).length).toBe(8);
    expect(edges.every((e) => e.kind === 'network')).toBe(true);
  });

  it('a network cable in an audio jack does nothing', () => {
    const rig = freshRig();
    rig.cables['c-network'].to = { node: 'mixer', port: 'in1' };
    const { graph } = compile(rig);
    expect(graph.cables.get('c-network')?.issue).toMatch(/network ports/);
  });

  it('warns about missing ports', () => {
    const rig = freshRig();
    rig.cables['c-in8'].to = { node: 'stagebox', port: 'in99' };
    const { graph } = compile(rig);
    expect(graph.warnings[0]).toMatch(/missing port/);
  });

  it('cableAt finds a cable by either end', () => {
    const rig = freshRig();
    expect(cableAt(rig, 'stagebox', 'in8')?.id).toBe('c-in8');
    expect(cableAt(rig, 'bass-di', 'xlr')?.id).toBe('c-in8');
    expect(cableAt(rig, 'keys-di-r', 'xlr')).toBeUndefined();
  });
});

describe('devices', () => {
  it('registers every port so the UI can draw them', () => {
    const { graph } = compile(freshRig());
    expect(graph.ports.get('stagebox')!.map((p) => p.id)).toContain('in16');
    expect(graph.ports.get('stagebox')!.filter((p) => p.dir === 'out')).toHaveLength(8);
    expect(graph.ports.get('bass-di')!.map((p) => p.id)).toEqual(['in', 'thru', 'xlr']);
    expect(graph.ports.get('mixer')!.find((p) => p.id === 'net')?.lanes).toEqual({ tx: 8, rx: 16 });
  });

  it('warns on unknown device types instead of crashing', () => {
    const rig = freshRig();
    rig.nodes.ufo = node('ufo', 'ufo', 'UFO', {});
    expect(compile(rig).graph.warnings).toContain('Unknown device type "ufo" for ufo');
  });

  it('a minimal rig works: mic → stagebox → wedge has no mixer route', () => {
    const rig = rigOf(
      [
        node('performer', 'singer', 'Singer', { role: 'x', sings: true, voiceDb: 75 }, { x: 0, y: 0 }),
        makeMic('mic', 'Mic', { targets: [{ point: 'singer.voice', distance: 0.05 }] }),
        makeStagebox('sb', 'Box', { x: 0, y: 5 }),
        makeDi('di', 'DI'),
      ],
      [cable('c1', 'xlr', 'mic.out', 'sb.in1')],
    );
    rig.nodes.sb.props.preamps[0].gain = 45;
    const sim = simulate(rig);
    expect(probePoint(sim, 'sb.in1').level).toBe('good');
    // A stagebox with no mixer: stagebox preamp out has signal, outputs are silent.
    expect(probePoint(sim, 'sb.net.tx1').summary).toBe('Singer vocal');
    expect(probePoint(sim, 'sb.out1').level).toBe('none');
    expect(sim.readouts.sb.network).toBe(false);
  });
});

describe('power', () => {
  it('resolves power through strips and reports why', () => {
    const rig = rigOf(
      [
        makePowerStrip('a', 'Strip A'),
        makePowerStrip('b', 'Strip B'),
        makeSpeaker('wedge', 'w', 'Wedge', { x: 0, y: 0 }, undefined, 'b'),
      ],
      [],
    );
    rig.nodes.b.props.power.plug = 'a';
    const { ctx } = compile(rig);
    expect(ctx.power('w')).toEqual({ on: true });
    rig.nodes.a.props.tripped = true;
    expect(compile(rig).ctx.power('w').reason).toBe(
      "Wedge is plugged into Strip B, which has no power (Strip B is plugged into Strip A, which has no power (Strip A has tripped its breaker (press reset)))",
    );
  });

  it('does not loop forever on strips plugged into each other', () => {
    const rig = rigOf([makePowerStrip('a', 'A'), makePowerStrip('b', 'B')], []);
    rig.nodes.a.props.power.plug = 'b';
    rig.nodes.b.props.power.plug = 'a';
    expect(compile(rig).ctx.power('a').on).toBe(false);
  });
});

describe('phantom power', () => {
  it('only arrives over an intact cable from an input with 48V on', () => {
    const rig = freshRig();
    expect(compile(rig).ctx.phantomAt('room-l', 'out')).toBe(true);
    expect(compile(rig).ctx.phantomAt('vox1', 'out')).toBe(false);
    rig.cables['c-in11'].faults = { broken: true };
    expect(compile(rig).ctx.phantomAt('room-l', 'out')).toBe(false);
  });

  it('the mixer\'s own inputs supply phantom too', () => {
    const rig = freshRig();
    mixer(rig).localPreamps[10].phantom = true;
    rig.cables['c-in11'].to = { node: 'mixer', port: 'in11' };
    expect(compile(rig).ctx.phantomAt('room-l', 'out')).toBe(true);
  });
});

describe('mixer helpers', () => {
  it('constant-power pan law', () => {
    expect(panGains(0).l).toBeCloseTo(-3.01, 2);
    expect(panGains(0).r).toBeCloseTo(-3.01, 2);
    expect(panGains(-1)).toEqual({ l: 0, r: -Infinity });
    expect(panGains(1).l).toBe(-Infinity);
    expect(panGains(1).r).toBeCloseTo(0, 6);
  });

  it('linked channels share fader, mute and sends and pan hard L/R', () => {
    const p = mixer(freshRig()) as MixerProps;
    p.channels[10].fader = -3;
    p.channels[10].mute = true;
    p.channels[11].fader = -40;
    expect(effectiveChannel(p, 12)).toMatchObject({ fader: -3, mute: true, pan: 1, linkedTo: 11 });
    expect(effectiveChannel(p, 11)).toMatchObject({ pan: -1, linkedTo: 12 });
    p.channels[10].link = false;
    expect(effectiveChannel(p, 12)).toMatchObject({ fader: -40, mute: false, pan: 0 });
  });
});

describe('acoustics', () => {
  const e: EmitterInfo = { point: 'w.sound', nodeId: 'w', position: { x: 0, y: 0 }, aim: 'singer', offAxis: 10, reinforcement: true };
  const ear: ReceiverInfo = { point: 's.ears', nodeId: 's', position: { x: 0, y: 2 }, kind: 'ear', owner: 'singer', targets: [], offAxis: 0 };

  it('falls off with distance (inverse square)', () => {
    expect(acousticCoupling(e, ear).gain).toBeCloseTo(-6.02, 2);
    expect(acousticCoupling(e, { ...ear, position: { x: 0, y: 4 } }).gain).toBeCloseTo(-12.04, 2);
  });

  it('speakers are quieter for people they are not aimed at', () => {
    expect(acousticCoupling(e, { ...ear, owner: 'someone-else' }).gain).toBeCloseTo(-16.02, 2);
  });

  it('mics reject things they are not aimed at, and flag them as bleed', () => {
    const mic: ReceiverInfo = { ...ear, kind: 'mic', offAxis: 15, targets: [{ point: 'x.voice', distance: 0.05 }] };
    expect(acousticCoupling(e, mic)).toEqual({ gain: expect.closeTo(-21.02, 2), bleed: true });
    expect(acousticCoupling({ ...e, point: 'x.voice' }, mic)).toEqual({ gain: expect.closeTo(26.02, 2), bleed: false });
  });

  it('wedge → mic pickup is analysed as feedback, not propagated', () => {
    const { graph } = compile(freshRig());
    expect(graph.edges.some((x) => x.from === 'wedge-1.sound' && x.to === 'vox1.capsule')).toBe(false);
    expect(graph.feedbackCouplings.some((c) => c.emitter.nodeId === 'wedge-1' && c.receiver.nodeId === 'vox1')).toBe(true);
    expect(graph.edges.some((x) => x.from === 'wedge-1.sound' && x.to === 'leader.ears')).toBe(true);
  });
});

describe('probe tool', () => {
  const sim = simulate(freshRig());

  it('probes a cable: level and content', () => {
    expect(probeCable(sim, 'c-in8')).toMatchObject({ label: 'Bass DI XLR', domain: 'mic', level: 'good', summary: 'Bass' });
    expect(probeCable(sim, 'c-wedge-3').summary).toMatch(/^Keys \+ Keys player vocal/);
  });

  it('probes a network port: everything on the link', () => {
    const r = probePort(sim, 'stagebox', 'net');
    expect(r.content.length).toBeGreaterThan(10);
  });

  it('a multi-channel cable reports its loudest channel, not the sum of all of them', () => {
    const r = probeCable(sim, 'c-network');
    expect(r.level).toBe('good');
    expect(r.content.length).toBeGreaterThan(10);
    expect(probePort(sim, 'mixer', 'net').level).toBe('good');
  });

  it('probes an ordinary port', () => {
    expect(probePort(sim, 'bass-di', 'thru')).toMatchObject({ label: 'Bass DI Thru (1/4", to amp)', level: 'good', summary: 'Bass' });
  });

  it('an unplugged cable probes as silent', () => {
    const rig = cloneRig(sim.rig);
    rig.cables['c-in8'].faults = { unplugged: 'both' };
    expect(probeCable(simulate(rig), 'c-in8').level).toBe('none');
  });

  it('stagebox inputs take on the level scale of what feeds them', () => {
    expect(sim.domains.get('stagebox.in8')).toBe('mic');
    const rig = cloneRig(sim.rig);
    rig.nodes['rx-wl1'].props.outputLevel = 'line';
    rig.nodes.stagebox.props.preamps[13].gain = 15;
    const s2 = simulate(rig);
    expect(s2.domains.get('stagebox.in14')).toBe('line');
    expect(probePoint(s2, 'stagebox.in14').level).toBe('low');
    expect(probePoint(s2, 'mixer.ch14.pre').level).toBe('good');
  });
});
