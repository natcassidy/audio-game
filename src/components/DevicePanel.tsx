// Draws a device's real faces (front/rear) with what's plugged into each
// jack. Click a plug to pick out its cable; with a cable picked out, click
// an empty jack of the same kind to move the plug there.

import { useRef } from 'react';
import { probeCable, type Cable, type CableEnd, type CompiledGraph, type Level, type NodeInstance, type PeerInfo, type PortDef, type PowerProps, type Readouts, type Rig } from '../engine';
import { useGame } from '../store';
import { freePorts, isUnplugged, moveEnd } from '../ui/cables';
import { plugOptions, type Control } from '../ui/controls';
import { pluggedInto } from '../ui/gear';
import { shortName } from '../ui/layout';
import { panelFor, type Face, type PanelItem, type PanelSection } from '../ui/panels';
import { getIn, setIn } from '../ui/paths';
import { LEVEL_TEXT } from './Level';

export function DevicePanel({ node }: { node: NodeInstance }) {
  const sim = useGame((s) => s.sim);
  const faces = panelFor(node, sim.graph);
  if (faces.length === 0) return null;
  const off = sim.readouts[node.id]?.power === false;
  return (
    <div className="faces">
      {faces.map((face) => (
        <FaceView key={face.name} node={node} face={face} off={off} />
      ))}
    </div>
  );
}

function FaceView({ node, face, off }: { node: NodeInstance; face: Face; off: boolean }) {
  return (
    <figure className={`face face-${face.style} ${off ? 'face-off' : ''}`}>
      <figcaption>
        <span className="face-name">{face.name}</span>
        {face.brand && <span className="face-brand">{face.brand}</span>}
      </figcaption>
      <div className="face-body">
        {face.sections.map((s, i) => (
          <SectionView key={i} node={node} section={s} />
        ))}
      </div>
    </figure>
  );
}

function SectionView({ node, section }: { node: NodeInstance; section: PanelSection }) {
  if (section.items.length === 0) return null;
  return (
    <div className="face-section">
      {section.label && <div className="silk">{section.label}</div>}
      <div className="face-items" style={section.columns ? { gridTemplateColumns: `repeat(${section.columns}, auto)` } : undefined}>
        {section.items.map((item, i) => (
          <Item key={i} node={node} item={item} />
        ))}
      </div>
    </div>
  );
}

function Item({ node, item }: { node: NodeInstance; item: PanelItem }) {
  const readouts = useGame((s) => s.sim.readouts[node.id]);
  switch (item.t) {
    case 'jack':
      return <Jack node={node} item={item} />;
    case 'control':
      return <ControlView node={node} control={item.control} />;
    case 'inlet':
      return <Inlet node={node} control={item.control} />;
    case 'led':
      return <Led on={!!readouts?.[item.key]} bad={item.bad} label={item.label} />;
    case 'bars':
      return <Bars value={Number(readouts?.[item.key] ?? 0)} max={item.max} label={item.label} />;
    case 'meter':
      return <LevelMeter level={(readouts?.[item.key] as Level) ?? 'none'} label={item.label} />;
    case 'lcd':
      return <Lcd node={node} readouts={readouts} item={item} />;
    case 'outlets':
      return <Outlets node={node} count={item.count} />;
    case 'print':
      return <p className="print">{item.text}</p>;
  }
}

// --- Jacks and plugs ---------------------------------------------------------

const CONNECTOR_NAMES: Record<string, string> = { xlr: 'XLR', 'quarter-inch': '1/4"', network: 'Network', speakon: 'Speakon' };

function Jack({ node, item }: { node: NodeInstance; item: Extract<PanelItem, { t: 'jack' }> }) {
  const { sim, rig, selection, select, update } = useGame();
  const port = sim.graph.ports.get(node.id)?.find((p) => p.id === item.port);
  if (!port) return null;
  const peer = sim.ctx.peer(node.id, port.id);
  const focused = !!peer && selection?.cable === peer.cable.id;
  const led = item.led ? (sim.readouts[node.id]?.[item.led] as Level | undefined) : undefined;
  const phantom = item.phantom !== undefined && !!getIn(node.props, `preamps.${item.phantom - 1}.phantom`);

  // With a cable picked out, an empty jack on this device can take its plug.
  const focusCable = selection?.cable ? rig.cables[selection.cable] : undefined;
  const movable = !peer && focusCable ? endOn(focusCable, node.id) : null;
  const moveHere = movable && freePorts(rig, sim.graph, focusCable!, movable).some((p) => p.id === port.id) ? movable : null;

  const title = `${node.name} — ${port.label} (${CONNECTOR_NAMES[port.connector] ?? port.connector} ${port.dir === 'in' ? 'input' : port.dir === 'out' ? 'output' : 'link'})`;
  return (
    <div className={`jack-cell ${focused ? 'focused' : ''}`}>
      <span className="jack-label">{item.label ?? port.label}</span>
      {(led !== undefined || item.phantom !== undefined) && (
        <span className="jack-leds">
          {led !== undefined && <span className={`led led-sig lvl-${led}`} title={`Signal: ${LEVEL_TEXT[led]}`} />}
          {item.phantom !== undefined && <span className={`led led-48 ${phantom ? 'on' : ''}`} title={phantom ? '48V phantom on' : '48V off'} />}
        </span>
      )}
      {peer ? (
        <Plugged port={port} peer={peer} focused={focused} title={title} onPick={() => select({ id: node.id, cable: peer.cable.id })} />
      ) : (
        <button
          className={`jack jack-${port.connector} ${moveHere ? 'jack-target' : ''}`}
          title={moveHere ? `Move the plug here (${port.label})` : `${title}: empty`}
          onClick={() => {
            if (moveHere && focusCable) update((r) => moveEnd(r.cables[focusCable.id], moveHere, port.id));
          }}
        >
          <Socket connector={port.connector} male={port.dir === 'out'} />
        </button>
      )}
    </div>
  );
}

/** Which end of the cable is on this device, if either. */
function endOn(cable: Cable, nodeId: string): 'from' | 'to' | null {
  if (cable.from?.node === nodeId) return 'from';
  if (cable.to?.node === nodeId) return 'to';
  return null;
}

/** What's written on the tape at this end: the far device, plus the jack on big boxes ("Stagebox In 8"). */
function tapeLabel(graph: CompiledGraph, rig: Rig, other: CableEnd): string {
  const ports = graph.ports.get(other.node) ?? [];
  const name = shortName(rig, other.node);
  if (ports.length < 8) return name;
  const port = ports.find((p) => p.id === other.port);
  return `${name} ${(port?.label ?? other.port).replace(/^Analog /, '').replace(/ out$/, '')}`;
}

function Socket({ connector, male = false }: { connector: string; male?: boolean }) {
  if (connector === 'xlr')
    return (
      <span className={`socket socket-xlr ${male ? 'socket-male' : ''}`}>
        <i />
        <i />
        <i />
      </span>
    );
  if (connector === 'network') return <span className="socket socket-net" />;
  return <span className="socket socket-qi" />;
}

function Plugged({
  port,
  peer,
  focused,
  title,
  onPick,
}: {
  port: PortDef;
  peer: PeerInfo;
  focused: boolean;
  title: string;
  onPick: () => void;
}) {
  const { sim, rig } = useGame();
  const loose = peer.cable.faults?.unplugged === peer.end || peer.cable.faults?.unplugged === 'both';
  const level = probeCable(sim, peer.cable.id).level;
  const where = peer.other ? tapeLabel(sim.graph, rig, peer.other) : 'loose end';
  const state = loose ? 'pulled out of the jack' : isUnplugged(peer.cable) ? 'plugged in here; the far end is loose' : 'plugged in';
  return (
    <button
      className={`jack jack-${port.connector} has-plug ${loose ? 'plug-loose' : ''} ${focused ? 'focused' : ''}`}
      title={`${title}\n${peer.cable.label ?? 'Cable'} → ${where} (${state}). Click to inspect or follow it.`}
      onClick={onPick}
      aria-label={`${port.label}: ${peer.cable.label ?? 'cable'} to ${where}`}
    >
      <Socket connector={port.connector} male={port.dir === 'out'} />
      <span className={`plug plug-${port.connector}`} />
      <span className={`tail lvl-${level}`} />
      <span className={`tape ${loose ? 'tape-loose' : ''}`}>
        <span className={`tape-dot lvl-${level}`} />
        {where}
      </span>
    </button>
  );
}

// --- Power -------------------------------------------------------------------

function Inlet({ node, control }: { node: NodeInstance; control: Control }) {
  const { rig, update, select } = useGame();
  const plug = (node.props as { power: PowerProps }).power.plug;
  const options = plugOptions(rig, node.id);
  const target = plug && plug !== 'wall' ? plug : null;
  return (
    <div className="jack-cell inlet-cell" title={control.hint}>
      <span className="jack-label">Power in</span>
      <span className={`inlet ${plug ? 'has-plug' : ''}`}>
        <span className="socket socket-iec" />
        {plug && <span className="plug plug-iec" />}
        {plug && <span className="tail tail-power" />}
      </span>
      <select
        className={`tape tape-select ${plug ? '' : 'tape-loose'}`}
        value={plug ?? ''}
        onChange={(e) => update((r) => setIn(r.nodes[node.id].props, 'power.plug', e.target.value || null))}
        aria-label={`${node.name} power cord`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === '' ? 'Unplugged' : o.value === 'wall' ? 'Wall' : shortName(rig, o.value)}
          </option>
        ))}
      </select>
      {target && (
        <button className="link tiny" onClick={() => select({ id: target })}>
          go to strip
        </button>
      )}
    </div>
  );
}

function Outlets({ node, count }: { node: NodeInstance; count: number }) {
  const { rig, select } = useGame();
  const devices = pluggedInto(rig, node.id);
  const n = Math.max(count, devices.length);
  return (
    <div className="outlets">
      {Array.from({ length: n }, (_, i) => {
        const id = devices[i];
        return (
          <div key={i} className="jack-cell">
            <span className="jack-label">{i + 1}</span>
            {id ? (
              <button className="outlet has-plug" onClick={() => select({ id })} title={`${rig.nodes[id]?.name}'s power cord. Click to go to it.`}>
                <span className="socket socket-outlet" />
                <span className="plug plug-power" />
                <span className="tail tail-power" />
                <span className="tape">{shortName(rig, id)}</span>
              </button>
            ) : (
              <span className="outlet" title="Empty outlet">
                <span className="socket socket-outlet" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Controls ------------------------------------------------------------------

function ControlView({ node, control }: { node: NodeInstance; control: Control }) {
  const update = useGame((s) => s.update);
  const set = (path: string, value: unknown) => update((r) => setIn(r.nodes[node.id].props, path, value));
  switch (control.kind) {
    case 'toggle': {
      const on = !!getIn(node.props, control.path);
      return (
        <div className="ctl" title={control.hint}>
          <span className="ctl-label">{control.label}</span>
          <button className={`toggle ${on ? 'on' : ''}`} onClick={() => set(control.path, !on)} aria-pressed={on} aria-label={control.label}>
            <span className="lever" />
          </button>
          <span className="ctl-value">{on ? (control.onLabel ?? 'On') : (control.offLabel ?? 'Off')}</span>
        </div>
      );
    }
    case 'knob': {
      const v = Number(getIn(node.props, control.path) ?? 0);
      return <Knob label={control.label} hint={control.hint} value={v} onChange={(x) => set(control.path, x)} />;
    }
    case 'select': {
      const raw = getIn(node.props, control.path);
      const i = Math.max(0, control.options.findIndex((o) => o.value === String(raw)));
      const pick = (k: number) => {
        const o = control.options[(k + control.options.length) % control.options.length];
        set(control.path, control.numeric ? Number(o.value) : o.value);
      };
      if (control.options.length <= 3) {
        return (
          <div className="ctl" title={control.hint}>
            <span className="ctl-label">{control.label}</span>
            <span className="slide" role="radiogroup" aria-label={control.label}>
              {control.options.map((o, k) => (
                <button key={o.value} role="radio" aria-checked={k === i} className={k === i ? 'on' : ''} onClick={() => pick(k)}>
                  {o.label}
                </button>
              ))}
            </span>
          </div>
        );
      }
      return (
        <div className="ctl" title={control.hint}>
          <span className="ctl-label">{control.label}</span>
          <span className="stepper">
            <button onClick={() => pick(i - 1)} aria-label={`${control.label} down`}>
              ▼
            </button>
            <button onClick={() => pick(i + 1)} aria-label={`${control.label} up`}>
              ▲
            </button>
          </span>
        </div>
      );
    }
    case 'action':
      return (
        <div className="ctl" title={control.hint}>
          <span className="ctl-label">&nbsp;</span>
          <button className={`push ${/battery/i.test(control.label) ? 'push-battery' : ''}`} onClick={() => update((r) => control.apply(r.nodes[node.id]))}>
            {control.label}
          </button>
        </div>
      );
    case 'plug':
      return <Inlet node={node} control={control} />;
  }
}

/** Rotary knob, 0–10. Drag up/down, or use the arrow keys. */
function Knob({ label, hint, value, onChange }: { label: string; hint: string; value: number; onChange: (v: number) => void }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.max(0, Math.min(10, Math.round(v * 2) / 2));
  const angle = -135 + value * 27;
  return (
    <div className="ctl" title={`${hint} Drag up/down or use the arrow keys.`}>
      <span className="ctl-label">{label}</span>
      <button
        className="knob"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, v: value };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const next = clamp(drag.current.v + (drag.current.y - e.clientY) / 12);
          if (next !== value) onChange(next);
        }}
        onPointerUp={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5 }[e.key];
          if (step) {
            e.preventDefault();
            onChange(clamp(value + step));
          }
        }}
      >
        <span className="knob-cap" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="knob-mark" />
        </span>
      </button>
      <span className="ctl-value">{value}</span>
    </div>
  );
}

// --- Lights and displays -------------------------------------------------------

function Led({ on, bad, label }: { on: boolean; bad?: boolean; label: string }) {
  return (
    <div className="ctl">
      <span className="ctl-label">{label}</span>
      <span className={`led led-big ${on ? (bad ? 'on bad' : 'on') : ''}`} />
    </div>
  );
}

function Bars({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div className="ctl" title={`${label}: ${value} of ${max}`}>
      <span className="ctl-label">{label}</span>
      <span className="bars">
        {Array.from({ length: max }, (_, i) => (
          <i key={i} className={i < value ? (value <= 1 ? 'on bad' : 'on') : ''} style={{ height: `${6 + (i * 10) / max}px` }} />
        ))}
      </span>
    </div>
  );
}

function LevelMeter({ level, label }: { level: Level; label: string }) {
  const lit = { none: 0, low: 1, good: 3, hot: 4, clipping: 5 }[level];
  return (
    <div className="ctl" title={`${label}: ${LEVEL_TEXT[level]}`}>
      <span className="ctl-label">{label}</span>
      <span className="ladder">
        {[5, 4, 3, 2, 1].map((i) => (
          <i key={i} className={i <= lit ? `on seg-${i}` : ''} />
        ))}
      </span>
    </div>
  );
}

function Lcd({ node, readouts, item }: { node: NodeInstance; readouts: Readouts | undefined; item: Extract<PanelItem, { t: 'lcd' }> }) {
  const lit = readouts?.power !== false;
  const text = readouts?.[item.key];
  return (
    <div className="ctl">
      {item.label && <span className="ctl-label">{item.label}</span>}
      <span className={`lcd ${lit ? '' : 'lcd-off'}`} aria-label={`${node.name} ${item.label ?? item.key}`}>
        {lit ? `${String(text ?? '')}${item.suffix ? ` ${item.suffix}` : ''}` : ''}
      </span>
    </div>
  );
}
