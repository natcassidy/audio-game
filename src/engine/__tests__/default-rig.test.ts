import { describe, expect, it } from 'vitest';
import { CHANNEL_NAMES, createDefaultRig } from '../rigs/default';
import { probePoint } from '../probe';
import { simulate } from '../simulate';
import { MAIN_L, MAIN_R, SRC, ch, hears, levelOf, wedge } from './helpers';

// The default rig is the "Sandbox" starting point: everything working.
const sim = simulate(createDefaultRig());

describe('default rig (everything working)', () => {
  it('compiles without warnings', () => {
    expect(sim.warnings).toEqual([]);
  });

  it('every channel has a healthy level with the right source', () => {
    const expected: Record<number, string> = {
      1: SRC.leader,
      2: SRC.singer2,
      5: SRC.keysVox,
      6: SRC.bassVox,
      7: SRC.keys,
      8: SRC.bass,
      9: SRC.tom,
      10: SRC.hihat,
      11: SRC.kit,
      12: SRC.kit,
      13: SRC.acoustic,
      14: SRC.pastor,
      15: SRC.associate,
      16: SRC.host,
    };
    for (let n = 1; n <= 16; n++) {
      expect(probePoint(sim, ch(n)).level, `Ch ${n} ${CHANNEL_NAMES[n - 1]}`).toBe('good');
    }
    for (const [n, src] of Object.entries(expected)) {
      expect(probePoint(sim, ch(Number(n))).content[0].source, `Ch ${n}`).toBe(src);
    }
  });

  it('main L/R carry the whole band at a good level', () => {
    for (const main of [MAIN_L, MAIN_R]) {
      const r = probePoint(sim, main);
      expect(r.level).toBe('good');
      for (const src of Object.values(SRC)) expect(hears(sim, main, src), `${main} ${src}`).toBe(true);
    }
  });

  it('the congregation hears the band through the mains', () => {
    const r = probePoint(sim, 'congregation.listen');
    expect(r.level).toBe('good');
    expect(hears(sim, 'congregation.listen', SRC.pastor)).toBe(true);
  });

  it('each wedge carries its monitor mix', () => {
    expect(probePoint(sim, wedge(1)).content[0].source).toBe(SRC.leader);
    expect(probePoint(sim, wedge(3)).content[0].source).toBe(SRC.keys);
    expect(hears(sim, wedge(3), SRC.bass)).toBe(true);
    expect(hears(sim, wedge(5), SRC.bass)).toBe(true);
    for (let n = 1; n <= 6; n++) expect(probePoint(sim, wedge(n)).level, `wedge ${n}`).toBe('good');
  });

  it('wedges have limited low end, so bass sounds thin in them', () => {
    expect(sim.signals.get(wedge(3))![SRC.bass].flags).toContain('thin');
    expect(sim.signals.get(MAIN_L)![SRC.bass].flags).not.toContain('thin');
  });

  it("monitor mixes don't carry what wasn't sent to them", () => {
    expect(hears(sim, wedge(6), SRC.bass)).toBe(false);
    expect(hears(sim, wedge(1), SRC.pastor)).toBe(false);
  });

  it('no mic is near feedback', () => {
    expect(sim.feedback.length).toBeGreaterThan(0);
    for (const f of sim.feedback) expect(f.status, `${f.mic} → ${f.speaker}`).toBe('stable');
  });

  it('bass amp is heard on stage, independent of the mixer', () => {
    expect(levelOf(sim, 'bass-amp.speaker', SRC.bass)).toBe('good');
    expect(hears(sim, 'bass-player.ears', SRC.bass)).toBe(true);
  });

  it('the spare amp is off and silent', () => {
    expect(probePoint(sim, 'spare-amp.speaker').level).toBe('none');
  });

  it('device readouts look healthy', () => {
    expect(sim.readouts.stagebox).toMatchObject({ power: true, network: true, muteAll: false, in8: 'good' });
    expect(sim.readouts.mixer).toMatchObject({ power: true, network: true, mode: 'main', banner: '', mainL: 'good' });
    expect(sim.readouts['rx-wl1']).toMatchObject({ power: true, rf: 5, audio: 'good', txBattery: 3, interference: false });
    expect(sim.readouts['tx-hh']).toMatchObject({ power: true, mute: false });
    expect(sim.readouts['wedge-1']).toMatchObject({ power: true, signal: true, limit: false });
    expect(sim.readouts['bass-di']).toMatchObject({ powered: true });
    expect(sim.readouts['strip-left']).toMatchObject({ light: true });
  });

  it('simulates fast enough to re-run on every change', () => {
    const rig = createDefaultRig();
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) simulate(rig);
    expect((performance.now() - t0) / 5).toBeLessThan(100);
  });

  it('is deterministic and does not mutate the rig', () => {
    const rig = createDefaultRig();
    const before = JSON.stringify(rig);
    const a = simulate(rig);
    const b = simulate(rig);
    expect(JSON.stringify(rig)).toBe(before);
    expect(probePoint(a, MAIN_L)).toEqual(probePoint(b, MAIN_L));
  });

  it('rig survives a JSON round trip (for scenarios and saved progress)', () => {
    const rig = JSON.parse(JSON.stringify(createDefaultRig()));
    expect(probePoint(simulate(rig), MAIN_L)).toEqual(probePoint(sim, MAIN_L));
  });
});
