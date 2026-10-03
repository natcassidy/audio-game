import { probeCable, probePoint, type Cable, type Level, type Rig } from '../engine';
import { useGame } from '../store';
import { isUnplugged } from '../ui/cables';
import { STAGE, placementOf } from '../ui/layout';

const S = 64; // pixels per metre
const PAD = 24;
const W = STAGE.width * S + PAD * 2;
const H = (STAGE.depth + STAGE.house) * S + PAD * 2;

function toScreen(p: { x: number; y: number }) {
  return { x: PAD + p.x * S, y: PAD + (STAGE.depth - p.y) * S };
}

type Shape = 'person' | 'mic' | 'speaker' | 'amp' | 'instrument' | 'box' | 'rack' | 'room';

const SHAPES: Record<string, Shape> = {
  performer: 'person',
  room: 'room',
  mic: 'mic',
  'wireless-tx': 'mic',
  wedge: 'speaker',
  'main-speaker': 'speaker',
  amp: 'amp',
  'bass-guitar': 'instrument',
  'electric-guitar': 'instrument',
  'acoustic-guitar': 'instrument',
  keyboard: 'instrument',
  'drum-kit': 'instrument',
  stagebox: 'rack',
  mixer: 'rack',
};

/** Devices whose "sound" output we colour by level. */
const SOUND_POINT: Record<string, string> = { wedge: 'sound', 'main-speaker': 'sound', amp: 'speaker' };

function Glyph({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'person':
      return <circle r={13} />;
    case 'mic':
      return <circle r={6} />;
    case 'speaker':
      return <path d="M -15 -9 L 15 -9 L 11 9 L -11 9 Z" />;
    case 'amp':
      return <rect x={-12} y={-12} width={24} height={24} rx={3} />;
    case 'instrument':
      return <rect x={-14} y={-9} width={28} height={18} rx={9} />;
    case 'rack':
      return <rect x={-30} y={-11} width={60} height={22} rx={3} />;
    case 'room':
      return <rect x={-60} y={-14} width={120} height={28} rx={6} />;
    default:
      return <rect x={-9} y={-7} width={18} height={14} rx={2} />;
  }
}

function nodeStatus(readouts: Record<string, unknown> | undefined, soundLevel: Level | undefined) {
  if (readouts && readouts.power === false) return 'off';
  if (soundLevel) return soundLevel === 'none' ? 'silent' : `lvl-${soundLevel}`;
  return 'on';
}

function cablePath(rig: Rig, cable: Cable): { d: string; mid: { x: number; y: number } } | null {
  const ends = [cable.from, cable.to].map((e) => (e ? toScreen(placementOf(rig, e.node)) : null));
  const [a, b] = ends;
  if (!a && !b) return null;
  if (!a || !b) {
    // Loose end: a short stub hanging off the connected end.
    const p = (a ?? b)!;
    return { d: `M ${p.x} ${p.y} q 10 18 26 22`, mid: { x: p.x + 18, y: p.y + 16 } };
  }
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + Math.min(40, Math.abs(a.x - b.x) * 0.12 + 8);
  return { d: `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`, mid: { x: mx, y: (a.y + b.y) / 2 + (my - (a.y + b.y) / 2) / 2 } };
}

export function StageView() {
  const { rig, sim, selection, select } = useGame();
  const selectedNode = selection?.kind === 'node' ? selection.id : null;
  const selectedCable = selection?.kind === 'cable' ? selection.id : null;
  const front = toScreen({ x: 0, y: 0 });
  const back = toScreen({ x: 0, y: STAGE.depth });

  return (
    <svg className="stage" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stage view">
      <rect className="stage-floor" x={PAD - 10} y={back.y - 10} width={STAGE.width * S + 20} height={front.y - back.y + 10} rx={8} />
      <text className="area-label" x={PAD} y={back.y + 6}>
        STAGE (back)
      </text>
      <text className="area-label" x={PAD} y={front.y + 18}>
        HOUSE
      </text>

      <g>
        {Object.values(rig.cables).map((c) => {
          const geo = cablePath(rig, c);
          if (!geo) return null;
          const level = probeCable(sim, c.id).level;
          const classes = ['cable', `cable-${level}`, c.kind === 'network' ? 'cable-network' : '', isUnplugged(c) ? 'cable-unplugged' : '', selectedCable === c.id ? 'selected' : '']
            .filter(Boolean)
            .join(' ');
          return (
            <g key={c.id} className={classes} onClick={() => select({ kind: 'cable', id: c.id })}>
              <path className="cable-hit" d={geo.d} />
              <path className="cable-line" d={geo.d} />
              <title>{`${c.label ?? c.id}${isUnplugged(c) ? ' (unplugged)' : ''}`}</title>
            </g>
          );
        })}
      </g>

      <g>
        {Object.values(rig.nodes).map((n) => {
            const place = placementOf(rig, n.id);
            const p = toScreen(place);
            const shape = SHAPES[n.type] ?? 'box';
            const soundPoint = SOUND_POINT[n.type];
            const soundLevel = soundPoint ? probePoint(sim, `${n.id}.${soundPoint}`).level : undefined;
            const status = nodeStatus(sim.readouts[n.id], soundLevel);
            const squeal = sim.feedback.some((f) => f.speaker === n.id && f.status === 'feedback');
            return (
              <g
                key={n.id}
                className={`device shape-${shape} status-${status} ${selectedNode === n.id ? 'selected' : ''} ${squeal ? 'squeal' : ''}`}
                transform={`translate(${p.x} ${p.y})`}
                onClick={() => select({ kind: 'node', id: n.id })}
              >
                <title>{n.name}</title>
                <g className="glyph">
                  <Glyph shape={shape} />
                </g>
                <text className="device-label" y={shape === 'room' ? 4 : shape === 'mic' ? 16 : 24}>
                  {place.short}
                </text>
              </g>
            );
          })}
      </g>
    </svg>
  );
}
