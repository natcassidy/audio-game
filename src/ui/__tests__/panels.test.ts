import { describe, expect, it } from 'vitest';
import { compile, createDefaultRig } from '../../engine';
import { controlsFor } from '../controls';
import { gearOf, pluggedInto, userOf } from '../gear';
import { panelFor, panelItems } from '../panels';

function labelsOnPanel(rig: ReturnType<typeof createDefaultRig>, id: string) {
  const { graph } = compile(rig);
  return panelItems(panelFor(rig.nodes[id], graph)).flatMap((i) => (i.t === 'control' || i.t === 'inlet' ? [i.control.label] : []));
}

describe('device panels', () => {
  const rig = createDefaultRig();
  const { graph } = compile(rig);

  it('shows every jack of every device exactly once', () => {
    for (const node of Object.values(rig.nodes)) {
      const ports = (graph.ports.get(node.id) ?? []).map((p) => p.id).sort();
      const jacks = panelItems(panelFor(node, graph))
        .flatMap((i) => (i.t === 'jack' ? [i.port] : []))
        .sort();
      expect(jacks, node.id).toEqual(ports);
    }
  });

  it('puts every control on the panel, so nothing is only reachable elsewhere', () => {
    for (const node of Object.values(rig.nodes)) {
      expect(labelsOnPanel(rig, node.id).sort(), node.id).toEqual(controlsFor(node).map((c) => c.label).sort());
    }
  });

  it('shows battery buttons once a battery needs replacing', () => {
    const r = createDefaultRig();
    (r.nodes['tx-hh'].props as { battery: string }).battery = 'dead';
    (r.nodes['bass-di'].props as { battery: string }).battery = 'dead';
    (r.nodes.acoustic.props as { pickupBattery: string }).pickupBattery = 'low';
    expect(labelsOnPanel(r, 'tx-hh')).toContain('Replace battery');
    expect(labelsOnPanel(r, 'bass-di')).toContain('Replace battery');
    expect(labelsOnPanel(r, 'acoustic')).toContain('Replace pickup battery');
  });

  it('people, the room and the drum kit have no panel', () => {
    for (const id of ['leader', 'congregation', 'drums']) expect(panelFor(rig.nodes[id], graph), id).toEqual([]);
  });
});

describe('gear', () => {
  const rig = createDefaultRig();

  it("lists a musician's mic, wedge and instruments", () => {
    expect(gearOf(rig, 'leader')).toEqual(['vox1', 'wedge-1', 'acoustic', 'tuner', 'acoustic-di']);
    expect(gearOf(rig, 'pastor')).toEqual(['tx-wl1']);
  });

  it('knows who uses a device', () => {
    expect(userOf(rig, 'wedge-3')).toBe('keys-player');
    expect(userOf(rig, 'bass-di')).toBe('bass-player');
    expect(userOf(rig, 'stagebox')).toBeUndefined();
  });

  it('lists what is plugged into a power strip', () => {
    expect(pluggedInto(rig, 'strip-left')).toEqual(['wedge-2', 'wedge-4']);
  });
});
