import { useMemo } from 'react';
import { probeCable, probePoint, type Cable, type Level, type Rig } from '../engine';
import { focusNodes } from '../game/focus';
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

export type Shape = 'person' | 'mic' | 'speaker' | 'amp' | 'instrument' | 'box' | 'rack' | 'room';

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

export function Glyph({ shape }: { shape: Shape }) {
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

/** Smallest part of the stage that holds these points, kept to the full view's shape so the panel doesn't jump. */
function viewBoxAround(points: { x: number; y: number }[]): string {
  if (points.length === 0) return `0 0 ${W} ${H}`;
  const margin = 70;
  let x0 = Math.min(...points.map((p) => p.x)) - margin;
  let x1 = Math.max(...points.map((p) => p.x)) + margin;
  let y0 = Math.min(...points.map((p) => p.y)) - margin;
  let y1 = Math.max(...points.map((p) => p.y)) + margin;
  // Don't zoom in so far that a two-device problem fills the screen.
  const w = Math.min(W, Math.max(x1 - x0, (y1 - y0) * (W / H), W * 0.55));
  const h = w * (H / W);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = Math.min(Math.max(cx - w / 2, 0), W - w);
  y0 = Math.min(Math.max(cy - h / 2, 0), H - h);
  return `${x0} ${y0} ${w} ${h}`;
}

/** True when every plugged-in end of the cable is on a shown device. */
function cableShown(cable: Cable, shown: (id: string) => boolean): boolean {
  const ends = [cable.from, cable.to].filter((e) => !!e);
  return ends.length > 0 && ends.every((e) => shown(e!.node));
}

function StageToolbar({ focusCount }: { focusCount: number | null }) {
  const { run, wholeStage, setWholeStage, rig } = useGame();
  if (!run) {
    return (
      <div className="stage-toolbar muted">Click a device to see its controls and light up its cables. Everything here is working.</div>
    );
  }
  const total = Object.keys(rig.nodes).length;
  return (
    <div className="stage-toolbar">
      {wholeStage ? (
        <span className="muted">Whole stage ({total} devices). The ones this problem involves are bright.</span>
      ) : (
        <span className="muted">Showing only the {focusCount} things this problem involves.</span>
      )}
      <button onClick={() => setWholeStage(!wholeStage)}>{wholeStage ? 'Just this problem' : 'Show whole stage'}</button>
    </div>
  );
}

export function StageView() {
  const { rig, sim, selection, select, run, wholeStage } = useGame();
  const selectedNode = selection?.kind === 'node' ? selection.id : null;
  const selectedCable = selection?.kind === 'cable' ? selection.id : null;
  const focus = useMemo(() => (run ? focusNodes(run.scenario) : null), [run?.scenario]);
  const hideOthers = !!focus && !wholeStage;
  const shown = (id: string) => !hideOthers || focus!.has(id);
  const nodes = Object.values(rig.nodes).filter((n) => shown(n.id));
  const cables = Object.values(rig.cables).filter((c) => cableShown(c, shown));
  const viewBox = hideOthers ? viewBoxAround(nodes.map((n) => toScreen(placementOf(rig, n.id)))) : `0 0 ${W} ${H}`;
  const [vx, vy] = viewBox.split(' ').map(Number);
  const front = toScreen({ x: 0, y: 0 });
  const back = toScreen({ x: 0, y: STAGE.depth });
  const touchesSelected = (c: Cable) => c.from?.node === selectedNode || c.to?.node === selectedNode;

  return (
    <>
      <StageToolbar focusCount={focus?.size ?? null} />
      <svg className="stage" viewBox={viewBox} role="img" aria-label="Stage view">
        <rect className="stage-floor" onClick={() => select(null)} x={PAD - 10} y={back.y - 10} width={STAGE.width * S + 20} height={front.y - back.y + 10} rx={8} />
        <text className="area-label" x={vx + 14} y={Math.max(back.y + 6, vy + 18)}>
          STAGE
        </text>
        <text className="area-label" x={vx + 14} y={front.y + 18}>
          AUDIENCE
        </text>

        <g>
          {cables.map((c) => {
            const geo = cablePath(rig, c);
            if (!geo) return null;
            const level = probeCable(sim, c.id).level;
            const faded = (selectedNode && !touchesSelected(c)) || (focus && wholeStage && !cableShown(c, (id) => focus.has(id)));
            const classes = [
              'cable',
              `cable-${level}`,
              c.kind === 'network' ? 'cable-network' : '',
              isUnplugged(c) ? 'cable-unplugged' : '',
              selectedCable === c.id ? 'selected' : '',
              faded ? 'cable-faded' : '',
            ]
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
          {nodes.map((n) => {
            const place = placementOf(rig, n.id);
            const p = toScreen(place);
            const shape = SHAPES[n.type] ?? 'box';
            const soundPoint = SOUND_POINT[n.type];
            const soundLevel = soundPoint ? probePoint(sim, `${n.id}.${soundPoint}`).level : undefined;
            const status = nodeStatus(sim.readouts[n.id], soundLevel);
            const squeal = sim.feedback.some((f) => f.speaker === n.id && f.status === 'feedback');
            const dim = focus && wholeStage && !focus.has(n.id);
            return (
              <g
                key={n.id}
                className={`device shape-${shape} status-${status} ${selectedNode === n.id ? 'selected' : ''} ${squeal ? 'squeal' : ''} ${dim ? 'device-dim' : ''}`}
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
    </>
  );
}
