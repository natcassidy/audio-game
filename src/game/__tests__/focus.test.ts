import { describe, expect, it } from 'vitest';
import { createDefaultRig } from '../../engine';
import { SCENARIOS } from '../../scenarios';
import { focusNodes } from '../focus';

const ALL = Object.keys(createDefaultRig().nodes).length;

describe.each(SCENARIOS.map((s) => [s.id, s] as const))('%s focus', (_id, s) => {
  const focus = focusNodes(s);

  it('shows every device the fault and the fix touch', () => {
    const rig = createDefaultRig();
    for (const c of [...s.setup, ...s.solution]) {
      const [kind, id] = c.path.split('.');
      const nodes = kind === 'nodes' ? [id] : [rig.cables[id]?.from?.node, rig.cables[id]?.to?.node];
      for (const n of nodes) expect(focus.has(n!), `${c.path} → ${n}`).toBe(true);
    }
  });

  it('shows a small part of the stage', () => {
    expect(focus.size).toBeGreaterThanOrEqual(3);
    expect(focus.size).toBeLessThanOrEqual(Math.min(16, ALL / 2));
  });
});
