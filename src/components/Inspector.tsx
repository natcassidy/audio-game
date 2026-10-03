import {
  probeCable,
  probePoint,
  probePort,
  type Cable,
  type NodeInstance,
  type PowerProps,
  type Readouts,
} from '../engine';
import { useGame } from '../store';
import { freePorts, isUnplugged, moveEnd, portLabel, reseat, replaceCable } from '../ui/cables';
import { DEVICE_BLURBS, controlsFor, plugOptions, type Control } from '../ui/controls';
import { getIn, setIn } from '../ui/paths';
import { Content, LevelBadge } from './Level';

export function Inspector() {
  const selection = useGame((s) => s.selection);
  const rig = useGame((s) => s.rig);
  if (!selection) {
    return (
      <aside className="inspector">
        <h2>Inspector</h2>
        <p className="muted">
          Click anything on stage. Devices show their controls and what’s on each jack. Cables show what they carry. Musicians show
          everything they hear.
        </p>
      </aside>
    );
  }
  if (selection.kind === 'cable') {
    const cable = rig.cables[selection.id];
    return <aside className="inspector">{cable ? <CableInspector cable={cable} /> : <p>Cable removed.</p>}</aside>;
  }
  const node = rig.nodes[selection.id];
  return <aside className="inspector">{node ? <DeviceInspector node={node} /> : <p>Device removed.</p>}</aside>;
}

function ControlRow({ node, control }: { node: NodeInstance; control: Control }) {
  const { rig, update } = useGame();
  const set = (path: string, value: unknown) => update((r) => setIn(r.nodes[node.id].props, path, value));
  switch (control.kind) {
    case 'toggle': {
      const on = !!getIn(node.props, control.path);
      return (
        <label className="control" title={control.hint}>
          <span>{control.label}</span>
          <button className={`switch ${on ? 'on' : ''}`} onClick={() => set(control.path, !on)} aria-pressed={on}>
            {on ? (control.onLabel ?? 'On') : (control.offLabel ?? 'Off')}
          </button>
        </label>
      );
    }
    case 'knob': {
      const v = Number(getIn(node.props, control.path) ?? 0);
      return (
        <label className="control" title={control.hint}>
          <span>{control.label}</span>
          <input type="range" min={0} max={10} step={0.5} value={v} onChange={(e) => set(control.path, Number(e.target.value))} />
          <output>{v}</output>
        </label>
      );
    }
    case 'select': {
      const v = String(getIn(node.props, control.path));
      return (
        <label className="control" title={control.hint}>
          <span>{control.label}</span>
          <select value={v} onChange={(e) => set(control.path, control.numeric ? Number(e.target.value) : e.target.value)}>
            {control.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case 'plug': {
      const power = (node.props as { power: PowerProps }).power;
      return (
        <label className="control" title={control.hint}>
          <span>{control.label}</span>
          <select value={power.plug ?? ''} onChange={(e) => set('power.plug', e.target.value || null)}>
            {plugOptions(rig, node.id).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    }
    case 'action':
      return (
        <div className="control" title={control.hint}>
          <span />
          <button onClick={() => update((r) => control.apply(r.nodes[node.id]))}>{control.label}</button>
        </div>
      );
  }
}

/** Readouts worth showing as lights; per-channel meters are shown elsewhere. */
function lights(readouts: Readouts | undefined) {
  if (!readouts) return [];
  return Object.entries(readouts).filter(([k]) => !/^(in|ch|mix|netOut)\d+$/.test(k) && k !== 'mode' && k !== 'banner');
}

const READOUT_NAMES: Record<string, string> = {
  power: 'Power',
  network: 'Network link',
  muteAll: 'Mute All',
  rf: 'RF',
  audio: 'Audio',
  txBattery: 'Tx battery',
  interference: 'Interference',
  battery: 'Battery',
  mute: 'Mute',
  signal: 'Signal',
  limit: 'Limit',
  protect: 'Protect',
  clip: 'Clip',
  light: 'Light',
  powered: 'Powered',
  groundLift: 'Ground lift',
  display: 'Display',
  tuning: 'Tuning',
  frequency: 'Freq',
  mainL: 'Main L',
  mainR: 'Main R',
  phones: 'Phones',
};

function Light({ name, value }: { name: string; value: string | number | boolean }) {
  const label = READOUT_NAMES[name] ?? name;
  if (typeof value === 'boolean') {
    const bad = ['muteAll', 'interference', 'mute', 'limit', 'protect', 'clip'].includes(name);
    return <span className={`light ${value ? (bad ? 'light-bad' : 'light-on') : ''}`}>{label}</span>;
  }
  if (name === 'rf' || name === 'battery' || name === 'txBattery') {
    const max = name === 'rf' ? 5 : 3;
    return (
      <span className="light-bars" title={`${label}: ${value}/${max}`}>
        {label} {'▮'.repeat(Number(value) || 0)}
        <span className="muted">{'▯'.repeat(max - (Number(value) || 0))}</span>
      </span>
    );
  }
  return (
    <span className="light-text">
      {label}: <strong>{String(value)}</strong>
    </span>
  );
}

function DeviceInspector({ node }: { node: NodeInstance }) {
  const { sim, rig, select } = useGame();
  const ports = sim.graph.ports.get(node.id) ?? [];
  const listen = node.type === 'performer' ? `${node.id}.ears` : node.type === 'room' ? `${node.id}.listen` : null;
  const loops = sim.feedback.filter((f) => (f.mic === node.id || f.speaker === node.id) && f.status !== 'stable');
  const role = (node.props as { role?: string }).role;

  return (
    <>
      <h2>{node.name}</h2>
      <p className="muted">{role ?? DEVICE_BLURBS[node.type]}</p>

      {loops.map((f) => (
        <p key={`${f.mic}-${f.speaker}`} className={`alert ${f.status === 'feedback' ? 'alert-bad' : 'alert-warn'}`}>
          {f.status === 'feedback' ? 'Feedback!' : 'Ringing:'} {rig.nodes[f.mic]?.name} is hearing {rig.nodes[f.speaker]?.name} (loop gain{' '}
          {f.loopGainDb.toFixed(1)} dB). Turn it down in that mix, or the speaker’s volume.
        </p>
      ))}

      {listen && (
        <section>
          <h3>What {node.name} hears</h3>
          <HearList point={listen} />
        </section>
      )}

      {controlsFor(node).length > 0 && (
        <section>
          <h3>Controls</h3>
          {controlsFor(node).map((c) => (
            <ControlRow key={c.label} node={node} control={c} />
          ))}
        </section>
      )}

      {lights(sim.readouts[node.id]).length > 0 && (
        <section>
          <h3>Lights and meters</h3>
          <div className="lights">
            {lights(sim.readouts[node.id]).map(([k, v]) => (
              <Light key={k} name={k} value={v} />
            ))}
          </div>
        </section>
      )}

      {ports.length > 0 && (
        <section>
          <h3>Jacks</h3>
          <table className="ports">
            <tbody>
              {ports.map((port) => {
                const reading = probePort(sim, node.id, port.id);
                const peer = sim.ctx.peer(node.id, port.id);
                return (
                  <tr key={port.id}>
                    <th>{port.label}</th>
                    <td>
                      <LevelBadge level={reading.level} />
                    </td>
                    <td>
                      <Content items={reading.content.slice(0, 4)} />
                      {reading.content.length > 4 && <span className="muted"> +{reading.content.length - 4} more</span>}
                    </td>
                    <td>
                      {peer ? (
                        <button className="link" onClick={() => select({ kind: 'cable', id: peer.cable.id })}>
                          {peer.other ? `→ ${rig.nodes[peer.other.node]?.name ?? peer.other.node}` : 'loose cable'}
                          {isUnplugged(peer.cable) ? ' (unplugged)' : ''}
                        </button>
                      ) : (
                        <span className="muted">empty</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

/** How loud each thing is for a listener, relative to the loudest thing they hear. */
export function loudnessWord(relDb: number): string {
  if (relDb > -4) return 'Loud';
  if (relDb > -10) return 'Clear';
  return 'Faint';
}

function HearList({ point }: { point: string }) {
  const sim = useGame((s) => s.sim);
  const reading = probePoint(sim, point);
  if (reading.content.length === 0) return <p className="muted">Silence.</p>;
  const loudest = reading.content[0].db;
  return (
    <>
      <p className="muted small-print">Overall: {LEVEL_WORDS[reading.level]}. Compared with the loudest thing they hear:</p>
      <ul className="hear">
        {reading.content.map((c) => {
          const rel = c.db - loudest;
          return (
            <li key={c.source} title={`${rel.toFixed(1)} dB compared with the loudest`}>
              <span className="hear-bar" style={{ width: `${Math.max(4, 100 + rel * 5)}%` }} />
              <span className="hear-word">{loudnessWord(rel)}</span>
              <span>
                {c.label}
                {c.flags.length > 0 && <em className="muted"> ({c.flags.join(', ')})</em>}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const LEVEL_WORDS = { none: 'silent', low: 'quiet', good: 'comfortable', hot: 'loud', clipping: 'painfully loud' } as const;

function CableInspector({ cable }: { cable: Cable }) {
  const { sim, rig, update, select } = useGame();
  const reading = probeCable(sim, cable.id);
  const issue = sim.graph.cables.get(cable.id)?.issue;
  const change = (fn: (c: Cable) => void) => update((r) => fn(r.cables[cable.id]));

  return (
    <>
      <h2>{cable.label ?? cable.id}</h2>
      <p className="muted">{cable.kind === 'network' ? 'Network (AVB) cable — carries all 16 inputs and 8 outputs.' : `${cable.kind.toUpperCase()} cable`}</p>
      <section>
        <h3>On this cable</h3>
        <p>
          <LevelBadge level={reading.level} /> <Content items={reading.content} />
        </p>
        {isUnplugged(cable) && <p className="alert alert-warn">This cable is not plugged in properly.</p>}
        {issue && cable.from && cable.to && <p className="alert alert-warn">{issue}.</p>}
      </section>
      <section>
        <h3>Ends</h3>
        {(['from', 'to'] as const).map((end) => {
          const e = cable[end];
          const options = freePorts(rig, sim.graph, cable, end);
          const loose = cable.faults?.unplugged === end || cable.faults?.unplugged === 'both';
          return (
            <div key={end} className="control">
              <button className="link" onClick={() => e && select({ kind: 'node', id: e.node })}>
                {e ? rig.nodes[e.node]?.name : 'nothing'}
              </button>
              {e ? (
                <select value={e.port} onChange={(ev) => change((c) => moveEnd(c, end, ev.target.value))} title="Move this end to another jack">
                  {options.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted">{portLabel(sim.graph, rig, e)}</span>
              )}
              {loose && <span className="light light-bad">unplugged</span>}
            </div>
          );
        })}
      </section>
      <section className="actions">
        {isUnplugged(cable) && cable.from && cable.to && <button onClick={() => change(reseat)}>Plug it back in</button>}
        <button onClick={() => change(replaceCable)} title="Swap this cable for a known-good one. Fixes broken or crackly cables.">
          Swap for a new cable
        </button>
      </section>
    </>
  );
}
