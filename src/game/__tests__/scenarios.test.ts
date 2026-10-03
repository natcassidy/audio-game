import { describe, expect, it } from 'vitest';
import { createDefaultRig, simulate } from '../../engine';
import { SCENARIOS, scenarioById } from '../../scenarios';
import { loadProgress, recordResult, saveProgress } from '../progress';
import { applyChanges, debriefFor, evaluate, guardsFor, hintsFor, scoreRun, setPath, solvedRig, startRig } from '../scenario';

const healthy = simulate(createDefaultRig());
const guards = guardsFor(healthy);

/** Every change path must point at something that already exists (catches typos in scenario JSON). */
function pathExists(path: string): boolean {
  const keys = path.split('.');
  let cur: unknown = createDefaultRig();
  for (const [i, key] of keys.entries()) {
    if (cur === null || typeof cur !== 'object') return false;
    const obj = cur as Record<string, unknown>;
    // Fault objects are optional and may be created by the change.
    if (!(key in obj)) return key === 'faults' && i === keys.length - 1;
    cur = obj[key];
  }
  return true;
}

describe('scenario files', () => {
  it('there are 26, with unique ids, in order', () => {
    expect(SCENARIOS).toHaveLength(26);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(26);
    expect(SCENARIOS[0].id).toBe('01-dead-wedge');
    expect(scenarioById('13-feedback')?.title).toMatch(/Feedback/);
  });

  it('the healthy rig wins nothing it shouldn\'t and breaks no guards', () => {
    expect(guards.length).toBeGreaterThan(50);
    expect(evaluate(healthy, SCENARIOS[0], guards).collateral).toEqual([]);
  });
});

describe.each(SCENARIOS.map((s) => [s.id, s] as const))('%s', (_id, s) => {
  it('every setup and solution path exists in the rig', () => {
    for (const c of [...s.setup, ...s.solution]) expect(pathExists(c.path), c.path).toBe(true);
  });

  it('starts broken', () => {
    const sim = simulate(startRig(s));
    const e = evaluate(sim, s, guards);
    expect(e.won).toBe(false);
    expect(e.met.some((m) => !m) || e.collateral.length > 0).toBe(true);
  });

  it('the known solution wins, with nothing else broken', () => {
    const sim = simulate(solvedRig(s));
    const e = evaluate(sim, s, guards);
    expect(e.met).toEqual(s.win.map(() => true));
    expect(e.collateral).toEqual([]);
    expect(e.won).toBe(true);
  });

  it('gives escalating hints that end with something specific', () => {
    const hints = hintsFor(s, simulate(startRig(s)), healthy, guards);
    expect(hints.length).toBeGreaterThanOrEqual(2);
    const last = hints[hints.length - 1];
    expect(last.length).toBeGreaterThan(15);
    expect(last).not.toMatch(/undefined/);
  });

  it('has a debrief', () => {
    const d = debriefFor(s, simulate(solvedRig(s)));
    expect(d.brokeAt.length).toBeGreaterThan(10);
    if (s.win.some((c) => c.kind === 'hears' || c.kind === 'clean')) expect(d.path.length).toBeGreaterThan(3);
    expect(s.lesson.length).toBeGreaterThan(20);
  });
});

describe('hints point at the actual fault', () => {
  const lastHint = (id: string) => {
    const s = scenarioById(id)!;
    const hints = hintsFor(s, simulate(startRig(s)), healthy, guards);
    return { where: hints[hints.length - 2], why: hints[hints.length - 1] };
  };

  it('dead wedge → the wedge is switched off', () => {
    expect(lastHint('01-dead-wedge')).toEqual({
      where: 'The signal stops at Wedge 3 (Keys).',
      why: 'Wedge 3 (Keys) is switched off.',
    });
  });

  it('no bass in monitor → the send', () => {
    expect(lastHint('02-no-bass-in-monitor')).toEqual({
      where: "The signal stops at the mixer's Mix 3 (Keys).",
      why: "Ch 8 (Bass)'s send to Mix 3 (Keys) is turned all the way down.",
    });
  });

  it('DI battery → the DI', () => {
    expect(lastHint('03-bass-dead-everywhere').where).toBe('The signal stops at Bass DI.');
  });

  it('network → the network cable', () => {
    expect(lastHint('04-everything-dead').where).toBe('The signal stops at the Network cable (stagebox ↔ mixer).');
  });

  it('wrong mix → the output patch, thanks to the known-good route', () => {
    // First unmet goal is keys player vocal in Wedge 3.
    expect(lastHint('07-wrong-mix').why).toMatch(/patched to Mix 4 \(Bass\), not Mix 3 \(Keys\)/);
  });

  it('feedback → names the mic and the wedge', () => {
    expect(lastHint('13-feedback').where).toBe('Vox 1 mic is hearing Wedge 1 (Leader) and sending it straight back: a feedback loop.');
  });

  it('once the complaint is fixed, hints point at collateral damage', () => {
    const s = scenarioById('01-dead-wedge')!;
    const rig = solvedRig(s);
    setPath(rig, 'nodes.mixer.props.channels.13.mute', true); // muted the pastor by mistake
    const sim = simulate(rig);
    const e = evaluate(sim, s, guards);
    expect(e.met).toEqual([true]);
    expect(e.won).toBe(false);
    expect(e.collateral.map((g) => g.label)).toEqual(['Pastor in the mains']);
    expect(hintsFor(s, sim, healthy, guards).at(-1)).toBe('Ch 14 (WL1) is muted.');
  });
});

describe('post-fader wedge', () => {
  it('raising the room fader is not the fix', () => {
    const s = scenarioById('25-post-fader-wedge')!;
    const rig = startRig(s);
    setPath(rig, 'nodes.mixer.props.channels.0.fader', 0);
    const e = evaluate(simulate(rig), s, guards);
    expect(e.met).toEqual([true, false]);
    expect(e.won).toBe(false);
  });
});

describe('scoring', () => {
  it('three stars for a clean solve, fewer with hints or collateral', () => {
    expect(scoreRun({ seconds: 30, hintsUsed: 0, collateralEvents: 0 })).toEqual({ stars: 3, points: 1000 });
    expect(scoreRun({ seconds: 30, hintsUsed: 1, collateralEvents: 0 }).stars).toBe(2);
    expect(scoreRun({ seconds: 30, hintsUsed: 0, collateralEvents: 1 }).stars).toBe(2);
    expect(scoreRun({ seconds: 30, hintsUsed: 3, collateralEvents: 0 }).stars).toBe(1);
    expect(scoreRun({ seconds: 160, hintsUsed: 0, collateralEvents: 0 }).points).toBe(800);
    expect(scoreRun({ seconds: 9999, hintsUsed: 9, collateralEvents: 9 }).points).toBe(100);
  });
});

describe('progress', () => {
  it('keeps the best result per scenario', () => {
    let p = recordResult({}, 'a', { stars: 2, points: 700, bestSeconds: 90 });
    p = recordResult(p, 'a', { stars: 1, points: 900, bestSeconds: 120 });
    expect(p.a).toEqual({ stars: 2, points: 900, bestSeconds: 90 });
  });

  it('round-trips through storage and survives broken storage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveProgress({ a: { stars: 3, points: 1000, bestSeconds: 20 } }, storage);
    expect(loadProgress(storage).a.stars).toBe(3);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadProgress(broken)).toEqual({});
    expect(() => saveProgress({}, broken)).not.toThrow();
    expect(loadProgress(undefined)).toEqual({});
  });
});

describe('setPath', () => {
  it('creates missing objects, and copies values so scenarios are not mutated', () => {
    const value = { unplugged: 'to' };
    const rig = applyChanges(createDefaultRig(), [{ path: 'cables.c-in8.faults', value }]);
    expect(rig.cables['c-in8'].faults).toEqual({ unplugged: 'to' });
    expect(rig.cables['c-in8'].faults).not.toBe(value);
  });
});
