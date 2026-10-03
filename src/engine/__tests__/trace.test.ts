import { describe, expect, it } from 'vitest';
import type { DiProps } from '../devices/instruments';
import type { TransmitterProps } from '../devices/mics';
import type { SpeakerProps } from '../devices/speakers';
import { CH } from '../rigs/default';
import { OFF_DB } from '../signal';
import { explainTrace, trace } from '../trace';
import { MAIN_L, SRC, mixer, props, simWith, stagebox } from './helpers';

const healthy = simWith();

describe('trace on a healthy rig', () => {
  const t = trace(healthy, SRC.bass, 'wedge-3');

  it('follows the real signal path from source to destination', () => {
    expect(t.reached).toBe(true);
    expect(t.break).toBeUndefined();
    expect(t.path.map((h) => h.point)).toEqual([
      'bass.pickup',
      'bass.out',
      'bass-di.in',
      'bass-di.xlr',
      'stagebox.in8',
      'stagebox.net.tx8',
      'mixer.net.rx8',
      'mixer.ch8.in',
      'mixer.ch8.pre',
      'mixer.mix3.sum',
      'mixer.mix3.out',
      'mixer.net.tx3',
      'stagebox.net.rx3',
      'stagebox.out3',
      'wedge-3.in',
      'wedge-3.sound',
    ]);
  });

  it('labels hops in plain language and says how each was reached', () => {
    expect(t.path[3].label).toBe('Bass DI XLR out');
    expect(t.path[4]).toMatchObject({ label: 'Stagebox In 8', via: { kind: 'cable', open: true, cableId: 'c-in8' } });
    expect(t.path[6].via?.kind).toBe('network');
    expect(t.path[9].label).toBe('Mix 3 (Keys) (sum)');
    expect(t.path.every((h) => h.level !== 'none')).toBe(true);
  });

  it('notes that bass sounds thin in a wedge', () => {
    expect(t.issues.map((i) => i.kind)).toEqual(['thin']);
    expect(explainTrace(t)).toBe(
      'Bass reaches Wedge 3 (Keys) (sound), but: Bass loses its low end at Wedge 3 (Keys) (sound) (sounds thin).',
    );
  });

  it('a clean route has no issues', () => {
    const v = trace(healthy, SRC.leader, MAIN_L);
    expect(v.reached).toBe(true);
    expect(v.issues).toEqual([]);
    expect(explainTrace(v)).toBe('Leader vocal reaches Main L.');
  });

  it('wireless routes cross the RF link to the paired receiver', () => {
    const v = trace(healthy, SRC.pastor, MAIN_L);
    expect(v.reached).toBe(true);
    expect(v.path.find((h) => h.via?.kind === 'rf')?.point).toBe('rx-wl1.rf');
  });

  it('acoustic routes reach musicians\' ears', () => {
    const v = trace(healthy, SRC.bass, 'bass-player');
    expect(v.reached).toBe(true);
    expect(v.destination).toBe('What Bass player hears');
    expect(v.path.at(-1)?.via?.kind).toBe('acoustic');
  });
});

describe('trace targets', () => {
  it('accepts a point id, a node (default point) or a node port', () => {
    expect(trace(healthy, SRC.bass, 'wedge-3.in').destination).toBe('Wedge 3 (Keys) Input');
    expect(trace(healthy, SRC.bass, { node: 'wedge-3' }).path.at(-1)?.point).toBe('wedge-3.sound');
    expect(trace(healthy, SRC.bass, { node: 'stagebox', port: 'in8' }).path.at(-1)?.point).toBe('stagebox.in8');
    expect(trace(healthy, SRC.bass, { node: 'mixer', port: 'net' }).reached).toBe(true);
  });

  it('reports unknown sources and destinations', () => {
    expect(trace(healthy, 'kazoo', MAIN_L).noRoute).toBe('There is no source called "kazoo"');
    expect(trace(healthy, SRC.bass, 'nowhere').noRoute).toBe('There is nothing called "nowhere" to trace to');
  });
});

describe('trace finds the first point where the signal dies', () => {
  it('scenario 1: one wedge silent (wedge power off)', () => {
    const sim = simWith((r) => {
      props<SpeakerProps>(r, 'wedge-3').power.switch = false;
    });
    const t = trace(sim, SRC.keys, 'wedge-3');
    expect(t.reached).toBe(false);
    expect(t.break).toMatchObject({ kind: 'blocked', reason: 'Wedge 3 (Keys) is switched off', nodeId: 'wedge-3' });
    expect(t.path[t.break!.hop].point).toBe('wedge-3.sound');
    // Everything before the break is fine.
    expect(t.path.slice(0, t.break!.hop).every((h) => h.level !== 'none')).toBe(true);
    expect(explainTrace(t)).toBe('Keys stops before Wedge 3 (Keys) (sound). Wedge 3 (Keys) is switched off.');
  });

  it('scenario 2: "no bass in my monitor" (send at zero)', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].sends[2] = OFF_DB;
    });
    const t = trace(sim, SRC.bass, 'wedge-3');
    expect(t.break?.reason).toBe("Ch 8 (Bass)'s send to Mix 3 (Keys) is turned all the way down");
    expect(t.path[t.break!.hop].point).toBe('mixer.mix3.sum');
  });

  it('scenario 3: bass dead everywhere (DI battery)', () => {
    const sim = simWith((r) => {
      props<DiProps>(r, 'bass-di').battery = 'dead';
    });
    for (const dest of ['wedge-3', 'wedge-5', 'main-l']) {
      expect(trace(sim, SRC.bass, dest).break?.nodeId).toBe('bass-di');
    }
  });

  it('scenario 4: everything from the stage is dead (network cable)', () => {
    const sim = simWith((r) => {
      r.cables['c-network'].faults = { unplugged: 'to' };
    });
    for (const src of [SRC.bass, SRC.leader, SRC.pastor, SRC.kit]) {
      expect(trace(sim, src, MAIN_L).break?.cableId).toBe('c-network');
    }
  });

  it('scenario 5: pastor\'s handheld is dead (battery)', () => {
    const sim = simWith((r) => {
      props<TransmitterProps>(r, 'tx-hh').battery = 'dead';
    });
    expect(trace(sim, SRC.host, 'main-l').break?.reason).toBe('Handheld mic battery is dead');
  });

  it('scenario 6: headset dead but receiver shows signal (body-pack muted)', () => {
    const sim = simWith((r) => {
      props<TransmitterProps>(r, 'tx-wl1').muted = true;
    });
    expect(trace(sim, SRC.pastor, 'main-l').break?.reason).toBe('WL1 body-pack is muted (mute switch on the body-pack)');
    expect(sim.readouts['rx-wl1'].rf).toBe(5);
  });

  it('scenario 8: faders don\'t change the room (stuck in Mix mode) shows in readouts, not trace', () => {
    const sim = simWith((r) => {
      mixer(r).selectedMix = 'mix3';
    });
    expect(trace(sim, SRC.leader, 'main-l').reached).toBe(true);
    expect(sim.readouts.mixer.banner).toMatch(/not Main/);
  });

  it('scenario 9: buzzing bass (ground loop) shows up as an issue', () => {
    const sim = simWith((r) => {
      r.nodes['bass-di'].faults = { groundLoop: true };
    });
    const t = trace(sim, SRC.bass, 'main-l');
    expect(t.reached).toBe(true);
    expect(t.issues.find((i) => i.kind === 'noise')?.message).toBe('Hum (Bass DI ground loop) is mixed in at Bass DI XLR out');
  });

  it('scenario 10: distorted vocal (gain too hot)', () => {
    const sim = simWith((r) => {
      stagebox(r).preamps[0].gain = 65;
    });
    const t = trace(sim, SRC.leader, 'main-l');
    expect(t.issues[0]).toMatchObject({ kind: 'distorted' });
    expect(t.path[t.issues[0].hop].point).toBe('stagebox.net.tx1');
  });

  it('scenario 11: thin bass everywhere (HPF too high)', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].hpf = 250;
    });
    const t = trace(sim, SRC.bass, 'main-l');
    expect(t.issues.find((i) => i.kind === 'thin')?.message).toBe('Bass loses its low end at Ch 8 (Bass) (pre-fader) (sounds thin)');
  });

  it('a level that fades out (not blocked) is reported as faded', () => {
    const sim = simWith((r) => {
      stagebox(r).preamps[CH.Bass - 1].gain = 0;
      mixer(r).channels[CH.Bass - 1].sends[2] = -20;
    });
    const t = trace(sim, SRC.bass, 'wedge-3');
    expect(t.break?.kind).toBe('faded');
    expect(t.break?.reason).toMatch(/fades out/);
  });
});

describe('when there is no direct route', () => {
  it('names the dead end, and admits the source is only heard as bleed', () => {
    const sim = simWith((r) => {
      r.cables['c-in8'].to = { node: 'stagebox', port: 'out8' };
    });
    const t = trace(sim, SRC.bass, MAIN_L);
    expect(t.reached).toBe(false);
    expect(t.noRoute).toBe('The "Bass DI XLR" from Bass DI XLR out goes nowhere useful: both ends are plugged into outputs');
    expect(t.viaBleed).toBe(true);
    expect(t.arrives.level).not.toBe('none');
    expect(t.arrives.flags).toContain('bleed');
    expect(explainTrace(t)).toMatch(/only heard faintly, as bleed/);
  });

  it('reports a jack with nothing plugged in', () => {
    const sim = simWith((r) => {
      delete r.cables['c-in8'];
    });
    expect(trace(sim, SRC.bass, MAIN_L).deadEnds).toContain('Nothing is plugged into Bass DI XLR out');
  });

  it('reports a cable whose far end is loose', () => {
    const sim = simWith((r) => {
      r.cables['c-wedge-3'].to = null;
    });
    const t = trace(sim, SRC.keys, 'wedge-3');
    expect(t.noRoute).toBe('The "Wedge 3 cable" in Stagebox Out 3 isn\'t connected to anything at its other end');
    expect(t.path).toEqual([]);
  });

  it('prefers a direct route with a fault over a working bleed route', () => {
    const sim = simWith((r) => {
      mixer(r).channels[CH.Bass - 1].mute = true;
    });
    const t = trace(sim, SRC.bass, MAIN_L);
    expect(t.viaBleed).toBe(false);
    expect(t.break?.reason).toBe('Ch 8 (Bass) is muted');
  });
});

describe('prefer option', () => {
  it('accepts a list of points as the preferred route', () => {
    const sim = simWith((r) => {
      mixer(r).networkPatch[2] = 'mix4';
      mixer(r).networkPatch[3] = 'mix3';
    });
    const good = trace(healthy, SRC.keysVox, 'wedge-3');
    const t = trace(sim, SRC.keysVox, 'wedge-3', { prefer: good.path.map((h) => h.point) });
    expect(t.break?.reason).toMatch(/patched to Mix 4 \(Bass\), not Mix 3 \(Keys\)/);
  });

  it('does not change the answer when the preferred route is the only sensible one', () => {
    const sim = simWith((r) => {
      props<SpeakerProps>(r, 'wedge-3').power.switch = false;
    });
    const good = trace(healthy, SRC.keys, 'wedge-3');
    expect(trace(sim, SRC.keys, 'wedge-3', { prefer: good }).break?.reason).toBe('Wedge 3 (Keys) is switched off');
  });
});
