// Top-down map of the stage and house. Gear is drawn roughly as it looks
// from above; cables are hidden except for the selected device's (or all
// of them, if the player asks), so the map stays readable.

import { useState, type ReactNode } from 'react';
import { probeCable, probePoint, type Cable, type Level, type NodeInstance, type Rig, type Vec2 } from '../engine';
import { useGame } from '../store';
import { isUnplugged } from '../ui/cables';
import { STAGE, placementOf } from '../ui/layout';

const S = 64; // pixels per metre
const PAD = 24;
const W = STAGE.width * S + PAD * 2;
const H = (STAGE.depth + STAGE.house) * S + PAD * 2;

function toScreen(p: Vec2) {
  return { x: PAD + p.x * S, y: PAD + (STAGE.depth - p.y) * S };
}

/** Devices whose "sound" we show as waves, coloured by level. */
const SOUND_POINT: Record<string, string> = { wedge: 'sound', 'main-speaker': 'sound', amp: 'speaker' };

/** Screen angle (degrees) from one device to another; glyphs are drawn facing down (towards the house). */
function facing(rig: Rig, from: string, to: string | undefined): number {
  if (!to || !rig.nodes[to]) return 0;
  const a = toScreen(placementOf(rig, from));
  const b = toScreen(placementOf(rig, to));
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI - 90;
}

function rotationOf(rig: Rig, n: NodeInstance): number {
  const p = n.props as { aim?: string; owner?: string; targets?: { point: string }[] };
  switch (n.type) {
    case 'wedge':
    case 'main-speaker':
      return facing(rig, n.id, p.aim);
    case 'mic':
      return facing(rig, n.id, p.owner ?? p.targets?.[0]?.point.split('.')[0]);
    case 'bass-guitar':
    case 'electric-guitar':
      return -60;
    case 'acoustic-guitar':
      return -65;
    default:
      return 0;
  }
}

function Glyph({ n }: { n: NodeInstance }): ReactNode {
  switch (n.type) {
    case 'performer':
      return (
        <>
          <ellipse className="g-cloth" rx={15} ry={8} />
          <circle className="g-skin" cy={1} r={7} />
        </>
      );
    case 'room':
      return (
        <>
          {[-36, -18, 0, 18].map((y) =>
            [-110, -55, 0, 55].map((x) => <rect key={`${x},${y}`} className="g-pew" x={x - 25} y={y - 5} width={50} height={10} rx={3} />),
          )}
        </>
      );
    case 'mic': {
      const condenser = (n.props as { micType: string }).micType === 'condenser';
      return (
        <>
          {[0, 120, 240].map((a) => (
            <line key={a} className="g-stand" x2={8 * Math.sin((a * Math.PI) / 180)} y2={-8 * Math.cos((a * Math.PI) / 180)} />
          ))}
          <line className="g-stand" x2={0} y2={13} />
          <rect className={condenser ? 'g-metal' : 'g-dark'} x={-2.5} y={10} width={5} height={10} rx={2} />
          {!condenser && <circle className="g-grille" cy={20} r={3.5} />}
        </>
      );
    }
    case 'wireless-tx':
      return (n.props as { kind: string }).kind === 'handheld' ? (
        <>
          <rect className="g-dark" x={-2.5} y={-10} width={5} height={14} rx={2} />
          <circle className="g-grille" cy={6} r={4} />
        </>
      ) : (
        <>
          <rect className="g-dark" x={-5} y={-6} width={10} height={12} rx={2} />
          <line className="g-stand" x1={3} y1={-6} x2={3} y2={-11} />
        </>
      );
    case 'wedge':
      return (
        <>
          <rect className="g-dark" x={-17} y={-12} width={34} height={24} rx={3} />
          <rect className="g-grille" x={-15} y={1} width={30} height={9} rx={2} />
        </>
      );
    case 'main-speaker':
      return (
        <>
          <rect className="g-dark" x={-15} y={-13} width={30} height={26} rx={3} />
          <rect className="g-grille" x={-13} y={5} width={26} height={6} rx={1.5} />
        </>
      );
    case 'amp':
      return (
        <>
          <rect className="g-dark" x={-18} y={-11} width={36} height={22} rx={3} />
          <rect className="g-grille" x={-16} y={5} width={32} height={5} rx={1} />
        </>
      );
    case 'keyboard':
      return (
        <>
          <rect className="g-dark" x={-40} y={-11} width={80} height={22} rx={3} />
          <rect className="g-keys" x={-36} y={-2} width={72} height={10} />
          {Array.from({ length: 17 }, (_, i) => (
            <rect key={i} className="g-dark" x={-35 + i * 4.2} y={-2} width={2} height={5.5} />
          ))}
        </>
      );
    case 'bass-guitar':
    case 'electric-guitar':
      return (
        <>
          <rect className="g-wood-dark" x={-1.8} y={-30} width={3.6} height={26} rx={1} />
          <rect className="g-wood-dark" x={-3} y={-35} width={6} height={7} rx={1.5} />
          <ellipse className="g-wood" cy={4} rx={9} ry={11} />
        </>
      );
    case 'acoustic-guitar':
      return (
        <>
          <rect className="g-wood-dark" x={-1.8} y={-28} width={3.6} height={20} rx={1} />
          <rect className="g-wood-dark" x={-3} y={-33} width={6} height={6} rx={1.5} />
          <ellipse className="g-wood" cy={-4} rx={8} ry={8} />
          <ellipse className="g-wood" cy={8} rx={11} ry={10} />
          <circle className="g-hole" cy={1} r={3} />
        </>
      );
    case 'drum-kit':
      // Seen from above with the drummer upstage (top) and the kick facing the house.
      return (
        <>
          <circle className="g-cymbal" cx={-24} cy={12} r={10} />
          <circle className="g-cymbal" cx={26} cy={10} r={11} />
          <rect className="g-drum" x={-9} y={0} width={18} height={20} rx={3} />
          <circle className="g-drumhead" cx={-5} cy={-4} r={6} />
          <circle className="g-drumhead" cx={7} cy={-4} r={6} />
          <circle className="g-drumhead" cx={-14} cy={-14} r={7} />
          <circle className="g-drumhead" cx={18} cy={-12} r={8.5} />
          <circle className="g-cymbal" cx={-27} cy={-10} r={7.5} />
        </>
      );
    case 'di':
      return <rect className="g-steel" x={-8} y={-5} width={16} height={10} rx={1.5} />;
    case 'tuner':
      return (
        <>
          <rect className="g-pedal" x={-7} y={-9} width={14} height={18} rx={2.5} />
          <circle className="g-metal" cy={4} r={3} />
        </>
      );
    case 'stagebox':
      return (
        <>
          <rect className="g-rack" x={-36} y={-12} width={72} height={24} rx={2} />
          {Array.from({ length: 8 }, (_, i) => (
            <circle key={i} className="g-hole" cx={-28 + i * 8} cy={4} r={2.2} />
          ))}
        </>
      );
    case 'wireless-rx':
      return (
        <>
          <rect className="g-rack" x={-19} y={-9} width={38} height={18} rx={2} />
          <rect className="g-lcd" x={-14} y={0} width={14} height={5} />
          <line className="g-stand" x1={-15} y1={-9} x2={-17} y2={-17} />
          <line className="g-stand" x1={15} y1={-9} x2={17} y2={-17} />
        </>
      );
    case 'power-strip':
      return (
        <>
          <rect className="g-strip" x={-26} y={-5} width={52} height={10} rx={2} />
          {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} className="g-dark" x={-21 + i * 7.5} y={-2} width={3} height={4} />
          ))}
        </>
      );
    case 'mixer':
      return (
        <>
          <rect className="g-desk" x={-62} y={-26} width={124} height={52} rx={4} />
          <rect className="g-rack" x={-52} y={-20} width={104} height={36} rx={3} />
          {Array.from({ length: 17 }, (_, i) => (
            <line key={i} className="g-fader" x1={-46 + i * 5.7} y1={-2} x2={-46 + i * 5.7} y2={12} />
          ))}
          <rect className="g-lcd" x={-20} y={-16} width={40} height={10} />
        </>
      );
    default:
      return <rect className="g-dark" x={-8} y={-6} width={16} height={12} rx={2} />;
  }
}

/** Sound coming out of a speaker or amp, drawn as arcs in front of it. */
function Waves({ level, squeal }: { level: Level; squeal: boolean }) {
  if (level === 'none' && !squeal) return null;
  const count = squeal ? 3 : { none: 0, low: 1, good: 2, hot: 3, clipping: 3 }[level];
  return (
    <g className={`waves lvl-${squeal ? 'clipping' : level} ${squeal ? 'squeal' : ''}`}>
      {Array.from({ length: count }, (_, i) => {
        const r = 18 + i * 6;
        return <path key={i} d={`M ${-r * 0.6} ${r * 0.8} Q 0 ${r * 1.15} ${r * 0.6} ${r * 0.8}`} />;
      })}
    </g>
  );
}

function labelOffset(n: NodeInstance): number {
  if (n.type === 'performer') return -11;
  if (n.type === 'room') return 46;
  if (n.type === 'mixer') return 40;
  if (n.type === 'drum-kit') return 32;
  return 22;
}

function cablePath(rig: Rig, cable: Cable): string | null {
  const [a, b] = [cable.from, cable.to].map((e) => (e ? toScreen(placementOf(rig, e.node)) : null));
  if (!a && !b) return null;
  if (!a || !b) {
    const p = (a ?? b)!;
    return `M ${p.x} ${p.y} q 10 18 26 22`;
  }
  // Cables lie on the floor: a gentle sag rather than a straight line.
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.min(30, Math.abs(a.x - b.x) * 0.08 + 6);
  return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
}

export function StageView() {
  const { rig, sim, selection, select } = useGame();
  const [allCables, setAllCables] = useState(false);
  const selected = selection?.id ?? null;
  const front = toScreen({ x: 0, y: 0 });
  const back = toScreen({ x: 0, y: STAGE.depth });

  const touches = (c: Cable) => c.from?.node === selected || c.to?.node === selected;
  const cables = Object.values(rig.cables).filter((c) => allCables || touches(c));
  // The selected device's power cord, if it goes to a strip.
  const plug = selected ? (rig.nodes[selected]?.props as { power?: { plug: string | null } } | undefined)?.power?.plug : null;
  const cordTo = plug && plug !== 'wall' && rig.nodes[plug] ? plug : null;

  return (
    <div className="stage-wrap">
      <svg className="stage" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stage map">
        <defs>
          <pattern id="boards" width="64" height="16" patternUnits="userSpaceOnUse">
            <rect width="64" height="16" className="floor-board" />
            <line x1="0" y1="16" x2="64" y2="16" className="floor-seam" />
            <line x1="40" y1="0" x2="40" y2="16" className="floor-seam" />
          </pattern>
        </defs>
        <rect className="house-floor" x={0} y={front.y} width={W} height={H - front.y} />
        <rect className="stage-floor" x={PAD - 10} y={back.y - 10} width={STAGE.width * S + 20} height={front.y - back.y + 10} rx={6} fill="url(#boards)" />
        <line className="stage-edge" x1={PAD - 10} y1={front.y} x2={PAD + STAGE.width * S + 10} y2={front.y} />
        <text className="area-label" x={PAD} y={back.y + 8}>
          STAGE
        </text>
        <text className="area-label" x={PAD + 2.2 * S} y={front.y + 20}>
          HOUSE
        </text>

        <g className="cables">
          {cordTo && selected && (
            <path
              className="cable cable-power"
              d={cablePath(rig, { id: 'cord', kind: 'xlr', from: { node: selected, port: '' }, to: { node: cordTo, port: '' } }) ?? ''}
            >
              <title>Power cord</title>
            </path>
          )}
          {cables.map((c) => {
            const d = cablePath(rig, c);
            if (!d) return null;
            const level = probeCable(sim, c.id).level;
            const mine = touches(c);
            const classes = [
              'cable',
              `lvl-${level}`,
              c.kind === 'network' ? 'cable-network' : '',
              isUnplugged(c) ? 'cable-unplugged' : '',
              mine ? 'mine' : 'faint',
              selection?.cable === c.id ? 'selected' : '',
            ];
            return (
              <g
                key={c.id}
                className={classes.filter(Boolean).join(' ')}
                onClick={() => select({ id: mine && selected ? selected : (c.from?.node ?? c.to!.node), cable: c.id })}
              >
                <path className="cable-hit" d={d} />
                <path className="cable-line" d={d} />
                <title>{`${c.label ?? c.id}${isUnplugged(c) ? ' (unplugged)' : ''}`}</title>
              </g>
            );
          })}
        </g>

        <g>
          {Object.values(rig.nodes).map((n) => {
            const place = placementOf(rig, n.id);
            const p = toScreen(place);
            const soundPoint = SOUND_POINT[n.type];
            const soundLevel = soundPoint ? probePoint(sim, `${n.id}.${soundPoint}`).level : 'none';
            const off = sim.readouts[n.id]?.power === false;
            const squeal = sim.feedback.some((f) => f.speaker === n.id && f.status === 'feedback');
            const rot = rotationOf(rig, n);
            const linked = selected && !allCables && cables.some((c) => touches(c) && (c.from?.node === n.id || c.to?.node === n.id));
            const owned = !!(n.props as { owner?: string }).owner;
            const classes = ['device', `type-${n.type}`, owned ? 'owned' : '', off ? 'off' : '', selected === n.id ? 'selected' : '', linked || cordTo === n.id ? 'linked' : ''];
            return (
              <g
                key={n.id}
                className={classes.filter(Boolean).join(' ')}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => select({ id: n.id })}
              >
                <title>{n.name}</title>
                {n.type !== 'room' && <circle className="hit" r={n.type === 'mixer' || n.type === 'stagebox' || n.type === 'keyboard' ? 30 : 14} />}
                <g transform={`rotate(${rot})`}>
                  {soundPoint && <Waves level={off ? 'none' : soundLevel} squeal={squeal} />}
                  <g className="glyph">
                    <Glyph n={n} />
                  </g>
                </g>
                <text className="device-label" y={labelOffset(n)}>
                  {place.short}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="legend">
        <label className="check">
          <input type="checkbox" checked={allCables} onChange={(e) => setAllCables(e.target.checked)} /> Show every cable
        </label>
        <span className="muted">{selected ? 'Showing the selected device’s cables.' : 'Click a device to see its cables.'}</span>
        <span className="push-right">
          <i className="sw lvl-good" /> signal
        </span>
        <span>
          <i className="sw lvl-low" /> low
        </span>
        <span>
          <i className="sw lvl-hot" /> hot
        </span>
        <span>
          <i className="sw lvl-none" /> nothing
        </span>
        <span>
          <i className="sw sw-dash" /> unplugged
        </span>
      </div>
    </div>
  );
}
