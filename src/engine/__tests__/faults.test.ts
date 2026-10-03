import { describe, expect, it } from 'vitest';
import type { AcousticGuitarProps, AmpProps, DiProps, KeyboardProps, TunerProps } from '../devices/instruments';
import type { MicProps, ReceiverProps, TransmitterProps } from '../devices/mics';
import type { SpeakerProps, PowerStripProps } from '../devices/speakers';
import { OFF_DB } from '../signal';
import { probeCable, probePoint } from '../probe';
import { CH } from '../rigs/default';
import { trace } from '../trace';
import { MAIN_L, MAIN_R, SRC, ch, hears, hearsDirect, levelOf, mixer, props, simWith, stagebox, wedge } from './helpers';

describe('cables', () => {
  it('unplugged cable kills that signal and says which end', () => {
    const sim = simWith((r) => {
      r.cables['c-in8'].faults = { unplugged: 'to' };
    });
    expect(hears(sim, ch(CH.Bass), SRC.bass)).toBe(false);
    expect(probeCable(sim, 'c-in8').level).toBe('none');
    const t = trace(sim, SRC.bass, MAIN_L);
    expect(t.break?.reason).toMatch(/Bass DI XLR.*unplugged at the Stagebox In 8 end/);
    expect(t.break?.cableId).toBe('c-in8');
  });

  it('broken cable kills the signal', () => {
    const sim = simWith((r) => {
      r.cables['c-in1'].faults = { broken: true };
    });
    expect(hears(sim, MAIN_L, SRC.leader)).toBe(false);
    expect(trace(sim, SRC.leader, MAIN_L).break?.reason).toMatch(/broken/);
  });

  it('intermittent cable passes signal but flags it', () => {
    const sim = simWith((r) => {
      r.cables['c-in1'].faults = { intermittent: true };
    });
    expect(hears(sim, MAIN_L, SRC.leader)).toBe(true);
    expect(sim.signals.get(ch(1))![SRC.leader].flags).toContain('intermittent');
    expect(trace(sim, SRC.leader, MAIN_L).issues.map((i) => i.kind)).toContain('intermittent');
  });

  it('a cable plugged in "backwards" still works (direction comes from the ports)', () => {
    const sim = simWith((r) => {
      const c = r.cables['c-in8'];
      [c.from, c.to] = [c.to, c.from];
    });
    expect(hears(sim, MAIN_L, SRC.bass)).toBe(true);
  });

  it('wrong input: the source shows up on a different channel', () => {
    const sim = simWith((r) => {
      r.cables['c-in8'].to = { node: 'stagebox', port: 'in9' };
      r.cables['c-in9'].to = { node: 'stagebox', port: 'in8' };
    });
    expect(probePoint(sim, ch(9)).content[0].source).toBe(SRC.bass);
    expect(probePoint(sim, ch(8)).content[0].source).toBe(SRC.tom);
    const t = trace(sim, SRC.bass, MAIN_L);
    expect(t.reached).toBe(true);
    expect(t.path.map((h) => h.label)).toContain('Ch 9 (Tom) input');
  });

  it('two outputs cabled together pass nothing', () => {
    const sim = simWith((r) => {
      r.cables['c-in8'].to = { node: 'stagebox', port: 'out8' };
    });
    expect(sim.graph.cables.get('c-in8')?.issue).toBe('Both ends are plugged into outputs');
    expect(hears(sim, ch(CH.Bass), SRC.bass)).toBe(false);
  });

  it('cable with a loose end passes nothing', () => {
    const sim = simWith((r) => {
      r.cables['c-wedge-3'].to = null;
    });
    expect(probePoint(sim, wedge(3)).level).toBe('none');
  });
});

describe('power', () => {
  it('a tripped power strip kills everything plugged into it', () => {
    const sim = simWith((r) => {
      props<PowerStripProps>(r, 'strip-left').tripped = true;
    });
    expect(probePoint(sim, wedge(2)).level).toBe('none');
    expect(probePoint(sim, wedge(4)).level).toBe('none');
    expect(probePoint(sim, wedge(3)).level).toBe('good');
    expect(sim.readouts['strip-left'].light).toBe(false);
    const t = trace(sim, SRC.singer2, 'wedge-2');
    expect(t.break?.reason).toMatch(/plugged into Power strip \(left\).*tripped/);
  });

  it('a power strip plugged into a switched-off strip has no power', () => {
    const sim = simWith((r) => {
      props<PowerStripProps>(r, 'strip-left').power.plug = 'strip-right';
      props<PowerStripProps>(r, 'strip-right').power.switch = false;
    });
    expect(probePoint(sim, wedge(2)).level).toBe('none');
    expect(trace(sim, SRC.singer2, 'wedge-2').break?.reason).toMatch(/Power strip \(right\) is switched off/);
  });

  it('an unplugged power cord is reported as such', () => {
    const sim = simWith((r) => {
      props<SpeakerProps>(r, 'wedge-1').power.plug = null;
    });
    expect(trace(sim, SRC.leader, 'wedge-1').break?.reason).toBe("Wedge 1 (Leader)'s power cord is unplugged");
  });
});

describe('sources', () => {
  it('wireless: dead battery → no RF, no audio', () => {
    const sim = simWith((r) => {
      props<TransmitterProps>(r, 'tx-hh').battery = 'dead';
    });
    expect(hears(sim, MAIN_L, SRC.host)).toBe(false);
    expect(sim.readouts['rx-hh']).toMatchObject({ rf: 0, audio: 'none' });
    expect(trace(sim, SRC.host, MAIN_L).break?.reason).toBe('Handheld mic battery is dead');
  });

  it('wireless: muted body-pack → receiver shows RF but no audio', () => {
    const sim = simWith((r) => {
      props<TransmitterProps>(r, 'tx-wl1').muted = true;
    });
    expect(hears(sim, MAIN_L, SRC.pastor)).toBe(false);
    expect(sim.readouts['rx-wl1']).toMatchObject({ rf: 5, audio: 'none' });
    expect(sim.readouts['tx-wl1']).toMatchObject({ mute: true });
    expect(trace(sim, SRC.pastor, MAIN_L).break?.reason).toMatch(/WL1 body-pack is muted/);
  });

  it('wireless: receiver switched off', () => {
    const sim = simWith((r) => {
      props<ReceiverProps>(r, 'rx-wl2').power.switch = false;
    });
    expect(hears(sim, MAIN_L, SRC.associate)).toBe(false);
    expect(trace(sim, SRC.associate, MAIN_L).break?.reason).toBe('WL2 receiver is switched off');
  });

  it('wireless: wrong frequency', () => {
    const sim = simWith((r) => {
      props<ReceiverProps>(r, 'rx-wl1').frequency = 520;
    });
    expect(hears(sim, MAIN_L, SRC.pastor)).toBe(false);
    expect(sim.readouts['rx-wl1'].rf).toBe(0);
    expect(trace(sim, SRC.pastor, MAIN_L).break?.reason).toMatch(/518\.200 MHz but WL1 receiver is tuned to 520\.000 MHz/);
  });

  it('wireless: RF dropouts make it cut in and out', () => {
    const sim = simWith((r) => {
      r.nodes['rx-wl1'].faults = { rfDropouts: true };
    });
    expect(sim.readouts['rx-wl1'].rf).toBe(2);
    expect(sim.signals.get(MAIN_L)![SRC.pastor].flags).toContain('intermittent');
  });

  it('wireless: two transmitters on one frequency interfere', () => {
    const sim = simWith((r) => {
      props<TransmitterProps>(r, 'tx-wl2').frequency = 518.2;
    });
    expect(sim.readouts['rx-wl1'].interference).toBe(true);
    expect(sim.signals.get(ch(14))![SRC.pastor].flags).toContain('interference');
    // The associate's voice now comes out of the WL1 channel, and WL2 is silent.
    expect(hears(sim, ch(14), SRC.associate)).toBe(true);
    expect(probePoint(sim, ch(15)).level).toBe('none');
  });

  it('acoustic guitar: dead pickup battery or volume at zero', () => {
    const dead = simWith((r) => {
      props<AcousticGuitarProps>(r, 'acoustic').pickupBattery = 'dead';
    });
    expect(hears(dead, ch(CH.Guitar), SRC.acoustic)).toBe(false);
    expect(trace(dead, SRC.acoustic, MAIN_L).break?.reason).toBe("Acoustic guitar's pickup battery is dead");

    const quiet = simWith((r) => {
      props<AcousticGuitarProps>(r, 'acoustic').volume = 0;
    });
    expect(trace(quiet, SRC.acoustic, MAIN_L).break?.reason).toBe("Acoustic guitar's volume knob is turned all the way down");
  });

  it('tuner pedal engaged mutes the guitar', () => {
    const sim = simWith((r) => {
      props<TunerProps>(r, 'tuner').engaged = true;
    });
    expect(hears(sim, MAIN_L, SRC.acoustic)).toBe(false);
    expect(trace(sim, SRC.acoustic, MAIN_L).break?.reason).toMatch(/Tuner pedal is engaged/);
    expect(sim.readouts.tuner.tuning).toBe(true);
  });

  it('keys switched off', () => {
    const sim = simWith((r) => {
      props<KeyboardProps>(r, 'keys').power.switch = false;
    });
    expect(hears(sim, MAIN_L, SRC.keys)).toBe(false);
  });

  it('mic on/off switch', () => {
    const sim = simWith((r) => {
      props<MicProps>(r, 'vox2').switchOn = false;
    });
    expect(trace(sim, SRC.singer2, MAIN_L).break?.reason).toBe("Vox 2 mic's on/off switch is off");
  });

  it('a broken device passes nothing', () => {
    const sim = simWith((r) => {
      r.nodes.vox2.faults = { broken: true };
    });
    expect(hears(sim, MAIN_L, SRC.singer2)).toBe(false);
    expect(trace(sim, SRC.singer2, MAIN_L).break?.reason).toBe('Vox 2 mic is faulty (internal failure)');
  });
});

describe('DI boxes', () => {
  it('active DI with a dead battery and no phantom: bass dies, amp still works', () => {
    const sim = simWith((r) => {
      props<DiProps>(r, 'bass-di').battery = 'dead';
    });
    // A little bass still bleeds into the vocal mics from the amp, but its own channel is dead.
    expect(hearsDirect(sim, MAIN_L, SRC.bass)).toBe(false);
    expect(hears(sim, ch(CH.Bass), SRC.bass)).toBe(false);
    expect(hearsDirect(sim, wedge(3), SRC.bass)).toBe(false);
    // The thru jack is passive, so the bass amp still plays.
    expect(levelOf(sim, 'bass-amp.speaker', SRC.bass)).toBe('good');
    const t = trace(sim, SRC.bass, MAIN_L);
    expect(t.break?.reason).toMatch(/Bass DI is an active DI: its battery is dead/);
    expect(t.break?.reason).toMatch(/turn on 48V for Stagebox In 8/);
    expect(sim.readouts['bass-di'].powered).toBe(false);
  });

  it('48V phantom powers an active DI without a battery', () => {
    const sim = simWith((r) => {
      props<DiProps>(r, 'bass-di').battery = 'dead';
      stagebox(r).preamps[CH.Bass - 1].phantom = true;
    });
    expect(hears(sim, MAIN_L, SRC.bass)).toBe(true);
    expect(sim.readouts['bass-di'].powered).toBe(true);
  });

  it('phantom does not get through an unplugged cable', () => {
    const sim = simWith((r) => {
      props<DiProps>(r, 'bass-di').battery = 'dead';
      stagebox(r).preamps[CH.Bass - 1].phantom = true;
      r.cables['c-in8'].faults = { unplugged: 'to' };
    });
    expect(sim.readouts['bass-di'].powered).toBe(false);
  });

  it('ground loop hums until Ground Lift is pressed', () => {
    const hum = 'bass-di:hum';
    const sim = simWith((r) => {
      r.nodes['bass-di'].faults = { groundLoop: true };
    });
    expect(hears(sim, ch(CH.Bass), hum)).toBe(true);
    expect(hears(sim, MAIN_L, hum)).toBe(true);
    expect(probePoint(sim, ch(CH.Bass)).summary).toMatch(/Hum \(Bass DI ground loop\)/);
    expect(trace(sim, SRC.bass, MAIN_L).issues.map((i) => i.kind)).toContain('noise');

    const fixed = simWith((r) => {
      r.nodes['bass-di'].faults = { groundLoop: true };
      props<DiProps>(r, 'bass-di').groundLift = true;
    });
    expect(hears(fixed, MAIN_L, hum)).toBe(false);
    expect(hears(fixed, MAIN_L, SRC.bass)).toBe(true);
  });
});

describe('stagebox', () => {
  it('network cable unplugged: every stagebox channel dies at once', () => {
    const sim = simWith((r) => {
      r.cables['c-network'].faults = { unplugged: 'from' };
    });
    for (let n = 1; n <= 16; n++) expect(probePoint(sim, ch(n)).level, `Ch ${n}`).toBe('none');
    for (let n = 1; n <= 6; n++) expect(probePoint(sim, wedge(n)).level).toBe('none');
    expect(sim.readouts.stagebox.network).toBe(false);
    expect(sim.readouts.mixer.network).toBe(false);
    expect(trace(sim, SRC.bass, MAIN_L).break?.reason).toMatch(/Network cable \(stagebox ↔ mixer\).*unplugged/);
  });

  it('Mute All silences every output but not the inputs', () => {
    const sim = simWith((r) => {
      stagebox(r).muteAll = true;
    });
    for (let n = 1; n <= 6; n++) expect(probePoint(sim, wedge(n)).level).toBe('none');
    expect(probePoint(sim, MAIN_L).level).toBe('good');
    expect(trace(sim, SRC.keys, 'wedge-3').break?.reason).toMatch(/Mute All/);
  });

  it('stagebox off kills everything, including phantom', () => {
    const sim = simWith((r) => {
      stagebox(r).power.switch = false;
    });
    expect(probePoint(sim, MAIN_L).summary).toBe('nothing');
    expect(sim.readouts['bass-di'].powered).toBe(true); // battery-powered
    expect(sim.ctx.phantomAt('room-l', 'out')).toBe(false);
  });
});

describe('mixer channel', () => {
  it('wrong input source', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].source = 'usb';
    });
    expect(hearsDirect(sim, MAIN_L, SRC.bass)).toBe(false);
    expect(trace(sim, SRC.bass, MAIN_L).break?.reason).toBe(
      'Ch 8 (Bass) input source is set to USB, not Network (the stagebox)',
    );
  });

  it('analog source with a cable in the mixer\'s own input works', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].source = 'analog';
      mixer(r).localPreamps[CH.Bass - 1].gain = 38;
      r.cables['c-in8'].to = { node: 'mixer', port: 'in8' };
    });
    expect(probePoint(sim, ch(CH.Bass)).level).toBe('good');
  });

  it('gain too low: weak signal', () => {
    const sim = simWith((r) => {
      stagebox(r).preamps[0].gain = 15;
    });
    expect(probePoint(sim, ch(1)).level).toBe('low');
    expect(trace(sim, SRC.leader, MAIN_L).issues.map((i) => i.kind)).toContain('low');
  });

  it('gain too hot: clipping and distortion downstream', () => {
    const sim = simWith((r) => {
      stagebox(r).preamps[0].gain = 65;
    });
    expect(probePoint(sim, 'stagebox.net.tx1').level).toBe('clipping');
    expect(sim.signals.get(MAIN_L)![SRC.leader].flags).toContain('distorted');
    expect(sim.signals.get(wedge(1))![SRC.leader].flags).toContain('distorted');
    const kinds = trace(sim, SRC.leader, MAIN_L).issues.map((i) => i.kind);
    expect(kinds).toContain('distorted');
    expect(kinds).toContain('clipping');
  });

  it('channel muted: gone from Main and from monitor sends', () => {
    const sim = simWith((r) => {
      mixer(r).channels[0].mute = true;
    });
    expect(hears(sim, MAIN_L, SRC.leader)).toBe(false);
    expect(hears(sim, wedge(1), SRC.leader)).toBe(false);
    expect(trace(sim, SRC.leader, 'wedge-1').break?.reason).toMatch(/Ch 1 \(Vox 1\) is muted/);
  });

  it('phantom off on a condenser mic', () => {
    const sim = simWith((r) => {
      stagebox(r).preamps[CH['Hi-hat'] - 1].phantom = false;
    });
    expect(hears(sim, ch(CH['Hi-hat']), SRC.hihat)).toBe(false);
    // The room mics still pick up the hi-hat, so trace to the hi-hat channel itself.
    expect(trace(sim, SRC.hihat, ch(CH['Hi-hat'])).break?.reason).toMatch(
      /Hi-hat mic is a condenser mic and needs 48V phantom power.*turn on 48V for Stagebox In 10/,
    );
  });

  it('dynamic mics work with or without phantom', () => {
    const sim = simWith((r) => {
      stagebox(r).preamps[0].phantom = true;
    });
    expect(probePoint(sim, ch(1)).level).toBe('good');
  });

  it('HPF too high makes bass thin', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].hpf = 200;
    });
    expect(sim.signals.get(MAIN_L)![SRC.bass].flags).toContain('thin');
    expect(trace(sim, SRC.bass, MAIN_L).issues.map((i) => i.kind)).toContain('thin');
  });

  it('fader down removes it from Main but not from pre-fader monitor mixes', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].fader = OFF_DB;
    });
    expect(hearsDirect(sim, MAIN_L, SRC.bass)).toBe(false);
    expect(hears(sim, wedge(3), SRC.bass)).toBe(true);
    expect(trace(sim, SRC.bass, MAIN_L).break?.reason).toBe('Ch 8 (Bass) fader is all the way down');
  });

  it('not assigned to Main', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Keys - 1].toMain = false;
    });
    expect(hears(sim, MAIN_L, SRC.keys)).toBe(false);
    expect(hears(sim, wedge(3), SRC.keys)).toBe(true);
  });

  it('stereo link: linked room pair is panned hard left/right and moves together', () => {
    const linked = simWith((r) => {
      mixer(r).channels[CH['Room R'] - 1].fader = OFF_DB; // ignored: follows Room L
    });
    expect(probePoint(linked, ch(CH['Room R'])).level).toBe('good');
    expect(hears(linked, 'mixer.ch12.post', SRC.kit)).toBe(true);
    const l = linked.signals.get('mixer.ch11.post')!;
    expect(l[SRC.kit].db).toBeCloseTo(linked.signals.get('mixer.ch12.post')![SRC.kit].db, 6);
  });

  it('stereo pair unlinked: drums end up on one side only', () => {
    const sim = simWith((r) => {
      const m = mixer(r);
      m.channels[CH['Room L'] - 1].link = false;
      m.channels[CH['Room L'] - 1].pan = -1;
      m.channels[CH['Room R'] - 1].pan = 1;
      m.channels[CH['Room R'] - 1].fader = OFF_DB;
    });
    const left = sim.signals.get(MAIN_L)![SRC.kit].db;
    const right = sim.signals.get(MAIN_R)![SRC.kit].db;
    expect(left - right).toBeGreaterThan(10);
    expect(trace(sim, SRC.kit, MAIN_R).break?.reason).toMatch(/Ch 11 \(Room L\) is panned hard left|Ch 12 \(Room R\) fader/);
  });
});

describe('mixes', () => {
  it('send at zero: source missing from that wedge only', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].sends[2] = OFF_DB;
    });
    expect(hearsDirect(sim, wedge(3), SRC.bass)).toBe(false);
    expect(hears(sim, wedge(5), SRC.bass)).toBe(true);
    const t = trace(sim, SRC.bass, 'wedge-3');
    expect(t.break?.reason).toBe("Ch 8 (Bass)'s send to Mix 3 (Keys) is turned all the way down");
    expect(t.break?.nodeId).toBe('mixer');
  });

  it('mix master down or muted', () => {
    const down = simWith((r) => {
      mixer(r).mixes[2].master = OFF_DB;
    });
    expect(probePoint(down, wedge(3)).level).toBe('none');
    expect(trace(down, SRC.keys, 'wedge-3').break?.reason).toBe('Mix 3 (Keys) master fader is all the way down');

    const muted = simWith((r) => {
      mixer(r).mixes[2].mute = true;
    });
    expect(trace(muted, SRC.keys, 'wedge-3').break?.reason).toBe('Mix 3 (Keys) master is muted');
  });

  it('post-fader send with the channel fader down', () => {
    const sim = simWith((r) => {
      const m = mixer(r);
      m.mixes[2].preFader = false;
      m.channels[CH.Bass - 1].fader = OFF_DB;
    });
    expect(hearsDirect(sim, wedge(3), SRC.bass)).toBe(false);
    expect(trace(sim, SRC.bass, 'wedge-3').break?.reason).toMatch(/fader is down, and Mix 3 \(Keys\) is post-fader/);
  });

  it('post-fader sends follow the fader', () => {
    const pre = simWith();
    const post = simWith((r) => {
      const m = mixer(r);
      m.mixes[2].preFader = false;
      m.channels[CH.Keys - 1].fader = -20;
    });
    const before = pre.signals.get('mixer.mix3.out')![SRC.keys].db;
    const after = post.signals.get('mixer.mix3.out')![SRC.keys].db;
    expect(after).toBeCloseTo(before - 20, 6);
  });

  it('output patch swapped: wedges get each other\'s mixes', () => {
    const sim = simWith((r) => {
      mixer(r).networkPatch[2] = 'mix4';
      mixer(r).networkPatch[3] = 'mix3';
    });
    expect(probePoint(sim, wedge(3)).content[0].source).toBe(SRC.bassVox);
    expect(probePoint(sim, wedge(4)).content[0].source).toBe(SRC.keys);
    // On its own, trace follows the current patch (Out 3 now carries Mix 4)...
    expect(trace(sim, SRC.keysVox, 'wedge-3').break?.reason).toBe("Ch 5 (Vox 5)'s send to Mix 4 (Bass) is turned all the way down");
    // ...but given the known-good route, it points at the swapped patch.
    const good = trace(simWith(), SRC.keysVox, 'wedge-3');
    expect(trace(sim, SRC.keysVox, 'wedge-3', { prefer: good }).break?.reason).toBe(
      'Network output 3 (stagebox Out 3) is patched to Mix 4 (Bass), not Mix 3 (Keys)',
    );
  });

  it('nothing patched to an output', () => {
    const sim = simWith((r) => {
      mixer(r).networkPatch[0] = null;
    });
    expect(probePoint(sim, wedge(1)).level).toBe('none');
    expect(trace(sim, SRC.leader, 'wedge-1').break?.reason).toMatch(/Nothing is patched to network output 1/);
  });

  it('stuck in Mix mode shows a banner', () => {
    const sim = simWith((r) => {
      mixer(r).selectedMix = 'mix3';
    });
    expect(sim.readouts.mixer.banner).toBe('Editing MIX 3 (KEYS), not Main');
  });

  it('main muted or master down', () => {
    const sim = simWith((r) => {
      mixer(r).main.mute = true;
    });
    expect(probePoint(sim, 'main-l.sound').level).toBe('none');
    expect(probePoint(sim, wedge(1)).level).toBe('good');
    expect(trace(sim, SRC.leader, 'main-l').break?.reason).toBe('The Main mix is muted');
  });

  it('FX return adds the effect to Main', () => {
    const sim = simWith((r) => {
      const m = mixer(r);
      m.channels[0].fxSends[0] = -10;
      m.fx[0].returnLevel = 0;
    });
    expect(sim.signals.get('mixer.fxA.out')![SRC.leader]).toBeDefined();
    expect(sim.signals.get(MAIN_L)![SRC.leader].db).toBeGreaterThan(simWith().signals.get(MAIN_L)![SRC.leader].db);
  });

  it('solo sends a channel to the headphones', () => {
    const quiet = simWith();
    expect(probePoint(quiet, 'mixer.phones').level).toBe('none');
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].solo = true;
    });
    expect(probePoint(sim, 'mixer.phones').content.map((c) => c.source)).toEqual([SRC.bass]);
    expect(sim.readouts.mixer.phones).toBe('good');
  });

  it('solo a mix to hear what a wedge is getting', () => {
    const sim = simWith((r) => {
      mixer(r).mixes[2].solo = true;
    });
    expect(probePoint(sim, 'mixer.phones').content[0].source).toBe(SRC.keys);
  });

  it('mixer off: nothing from the board', () => {
    const sim = simWith((r) => {
      mixer(r).power.switch = false;
    });
    expect(probePoint(sim, 'congregation.listen').content.some((c) => c.source === SRC.pastor)).toBe(false);
    expect(trace(sim, SRC.bass, MAIN_L).break?.reason).toBe('Mixer is switched off');
  });
});

describe('outputs', () => {
  it('wedge switched off or volume at zero', () => {
    const off = simWith((r) => {
      props<SpeakerProps>(r, 'wedge-3').power.switch = false;
    });
    expect(probePoint(off, wedge(3)).level).toBe('none');
    expect(probePoint(off, wedge(1)).level).toBe('good');
    expect(off.readouts['wedge-3'].power).toBe(false);

    const quiet = simWith((r) => {
      props<SpeakerProps>(r, 'wedge-3').volume = 0;
    });
    expect(trace(quiet, SRC.keys, 'wedge-3').break?.reason).toBe("Wedge 3 (Keys)'s volume knob is turned all the way down");
  });

  it('protect mode silences a speaker', () => {
    const sim = simWith((r) => {
      r.nodes['main-l'].faults = { protectMode: true };
    });
    expect(probePoint(sim, 'main-l.sound').level).toBe('none');
    expect(sim.readouts['main-l'].protect).toBe(true);
    expect(trace(sim, SRC.leader, 'main-l').break?.reason).toMatch(/protect mode/);
  });

  it('a wedge driven too hard clips', () => {
    const sim = simWith((r) => {
      mixer(r).mixes[0].master = 10;
      mixer(r).channels[0].sends[0] = 10;
      props<SpeakerProps>(r, 'wedge-1').volume = 1;
    });
    expect(sim.readouts['wedge-1'].limit).toBe(true);
  });
});

describe('acoustics', () => {
  it('a loud bass amp bleeds into nearby vocal mics and muddies the room', () => {
    const normal = simWith();
    const loud = simWith((r) => {
      const amp = props<AmpProps>(r, 'bass-amp');
      r.nodes['bass-amp'].props = { ...amp, model: 'Peavey Basic 112', sensitivity: 98, maxSpl: 110, volume: 10 };
    });
    expect(probePoint(normal, ch(6)).content.map((c) => c.source)).toEqual([SRC.bassVox]);
    const vox6 = probePoint(loud, ch(6)).content;
    expect(vox6.find((c) => c.source === SRC.bass)?.flags).toContain('bleed');
    expect(loud.signals.get('congregation.listen')![SRC.bass].db).toBeGreaterThan(
      normal.signals.get('congregation.listen')![SRC.bass].db + 3,
    );
  });

  it('a small amp turned all the way up distorts', () => {
    const sim = simWith((r) => {
      props<AmpProps>(r, 'bass-amp').volume = 10;
    });
    expect(sim.signals.get('bass-amp.speaker')![SRC.bass].flags).toContain('distorted');
    expect(sim.readouts['bass-amp'].clip).toBe(true);
  });

  it('pushing the wedge makes the mic ring, then feed back', () => {
    const ringing = simWith((r) => {
      mixer(r).channels[0].sends[0] = 10;
      props<SpeakerProps>(r, 'wedge-1').volume = 8.5;
    });
    const loop = ringing.feedback.find((f) => f.mic === 'vox1' && f.speaker === 'wedge-1')!;
    expect(loop.status).toBe('ringing');

    const howling = simWith((r) => {
      mixer(r).channels[0].sends[0] = 10;
      props<SpeakerProps>(r, 'wedge-1').volume = 10;
    });
    const f = howling.feedback.find((x) => x.mic === 'vox1' && x.speaker === 'wedge-1')!;
    expect(f.status).toBe('feedback');
    expect(f.loopGainDb).toBeGreaterThanOrEqual(0);
    expect(hears(howling, 'leader.ears', 'wedge-1:feedback')).toBe(true);
    expect(probePoint(howling, 'leader.ears').summary).toMatch(/Feedback squeal \(Wedge 1 \(Leader\)\)/);
  });

  it('a mic facing its wedge feeds back much sooner', () => {
    const base = simWith().feedback.find((f) => f.mic === 'vox1' && f.speaker === 'wedge-1')!;
    const facing = simWith((r) => {
      r.nodes.vox1.faults = { facingWedge: true };
    }).feedback.find((f) => f.mic === 'vox1' && f.speaker === 'wedge-1')!;
    expect(facing.loopGainDb).toBeCloseTo(base.loopGainDb + 15, 6);
  });

  it('muting the channel stops feedback', () => {
    const sim = simWith((r) => {
      mixer(r).channels[0].sends[0] = 10;
      props<SpeakerProps>(r, 'wedge-1').volume = 10;
      mixer(r).channels[0].mute = true;
    });
    expect(sim.feedback.find((f) => f.mic === 'vox1' && f.speaker === 'wedge-1')).toBeUndefined();
  });

  it('musicians hear their own wedge, nearby amps and the drums', () => {
    const sim = simWith();
    const keys = probePoint(sim, 'keys-player.ears').content.map((c) => c.source);
    expect(keys).toContain(SRC.keys);
    expect(keys).toContain(SRC.kit);
    expect(hears(sim, 'bass-player.ears', SRC.bass)).toBe(true);
    // The keys player's wedge is aimed at them, so it's louder for them than for the drummer.
    const toKeys = sim.signals.get('keys-player.ears')![SRC.keysVox].db;
    const toDrummer = sim.signals.get('drummer.ears')?.[SRC.keysVox]?.db ?? -Infinity;
    expect(toKeys).toBeGreaterThan(toDrummer);
  });

  it('with their wedge off, the keys player still hears the bass amp across the stage', () => {
    const sim = simWith((r) => {
      props<SpeakerProps>(r, 'wedge-3').power.switch = false;
    });
    expect(hears(sim, 'keys-player.ears', SRC.bass)).toBe(true);
    expect(hears(sim, 'keys-player.ears', SRC.keysVox)).toBe(true); // their own voice, unamplified
  });
});
