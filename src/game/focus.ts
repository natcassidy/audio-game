// Which devices a scenario is about. The stage only shows these during a
// scenario, so the player sees the handful of things involved in the
// complaint instead of the whole rig.

import { createDefaultRig, simulate, trace, type Rig, type Simulation } from '../engine';
import { startRig } from './scenario';
import type { Condition, Scenario } from './types';

/** Source/point pairs whose working signal path the player needs to see. */
function routesOf(c: Condition): { source: string; point: string }[] {
  switch (c.kind) {
    case 'hears':
    case 'silent':
    case 'clean':
      return [{ source: c.source, point: c.point }];
    case 'balanced':
      return [
        { source: c.source, point: c.a },
        { source: c.source, point: c.b },
      ];
    default:
      return [];
  }
}

/** The node a change path ("nodes.X…" or "cables.Y…") touches, and a cable's ends. */
function nodesTouchedBy(rig: Rig, path: string): string[] {
  const [kind, id] = path.split('.');
  if (kind === 'nodes') return [id];
  if (kind === 'cables') {
    const c = rig.cables[id];
    return [c?.from?.node, c?.to?.node].filter((n): n is string => !!n);
  }
  return [];
}

function addRoute(into: Set<string>, sim: Simulation, source: string, point: string) {
  const t = trace(sim, source, point);
  for (const hop of t.path) into.add(hop.nodeId);
}

/** In the default rig, who plays each instrument: shown with it so the stage reads as people, not just boxes. */
const PLAYERS: Record<string, string> = { keys: 'keys-player', bass: 'bass-player', drums: 'drummer', acoustic: 'leader' };

let healthyCache: Simulation | undefined;
const cache = new Map<string, Set<string>>();

/**
 * Devices shown on stage for a scenario: everything on the healthy signal
 * path for each goal, every device the fault or the fix touches, the main
 * speakers when a goal is about the mains, and anything listed in `show`.
 */
export function focusNodes(s: Scenario): Set<string> {
  const hit = cache.get(s.id);
  if (hit) return hit;
  healthyCache ??= simulate(createDefaultRig());
  const start = simulate(startRig(s));
  const nodes = new Set<string>(['mixer']);

  for (const c of s.win) {
    for (const r of routesOf(c)) {
      addRoute(nodes, healthyCache, r.source, r.point);
      if (r.point.startsWith('mixer.main.')) nodes.add('main-l').add('main-r');
    }
    if (c.kind === 'noFeedback') {
      for (const f of start.feedback) if (f.status === 'feedback') nodes.add(f.mic).add(f.speaker);
    }
  }
  const rig = createDefaultRig();
  for (const ch of [...s.setup, ...s.solution]) for (const n of nodesTouchedBy(rig, ch.path)) nodes.add(n);
  for (const n of s.show ?? []) nodes.add(n);
  for (const [instrument, player] of Object.entries(PLAYERS)) if (nodes.has(instrument)) nodes.add(player);

  for (const n of [...nodes]) if (!rig.nodes[n]) nodes.delete(n);
  cache.set(s.id, nodes);
  return nodes;
}
