import { probeCable, probePoint, type Cable, type NodeInstance } from '../engine';
import { useGame } from '../store';
import { freePorts, isUnplugged, moveEnd, replaceCable, reseat, unplug } from '../ui/cables';
import { DEVICE_BLURBS } from '../ui/controls';
import { gearOf, userOf } from '../ui/gear';
import { shortName } from '../ui/layout';
import { DevicePanel } from './DevicePanel';
import { Content, LevelBadge } from './Level';

/** Good places to start looking when nothing is selected. */
const START_HERE = ['stagebox', 'mixer', 'rx-wl1', 'wedge-1', 'bass-di', 'strip-left'];

export function Inspector() {
  const selection = useGame((s) => s.selection);
  const rig = useGame((s) => s.rig);
  const select = useGame((s) => s.select);
  const node = selection ? rig.nodes[selection.id] : undefined;
  if (!node) {
    return (
      <aside className="inspector">
        <h2>Pick a device</h2>
        <p className="muted">
          Click anything on the stage to see the real thing: its front and back panels, what’s plugged into every jack, and its knobs,
          switches and lights. Click a plug to see where its cable goes, and follow it to the other end. Click a person to hear what
          they hear.
        </p>
        <div className="gear-list">
          {START_HERE.filter((id) => rig.nodes[id]).map((id) => (
            <button key={id} onClick={() => select({ id })}>
              {rig.nodes[id].name}
            </button>
          ))}
        </div>
      </aside>
    );
  }
  return (
    <aside className="inspector">
      <DeviceView node={node} />
    </aside>
  );
}

function DeviceView({ node }: { node: NodeInstance }) {
  const { sim, rig, selection, select } = useGame();
  const listen = node.type === 'performer' ? `${node.id}.ears` : node.type === 'room' ? `${node.id}.listen` : null;
  const loops = sim.feedback.filter((f) => (f.mic === node.id || f.speaker === node.id) && f.status !== 'stable');
  const role = (node.props as { role?: string }).role;
  const user = userOf(rig, node.id);
  const gear = node.type === 'performer' ? gearOf(rig, node.id) : [];
  const cable = selection?.cable ? rig.cables[selection.cable] : undefined;

  return (
    <>
      <h2>{node.name}</h2>
      <p className="muted">
        {role ?? DEVICE_BLURBS[node.type]}
        {user && (
          <>
            {' '}
            Used by{' '}
            <button className="link" onClick={() => select({ id: user })}>
              {rig.nodes[user]?.name}
            </button>
            .
          </>
        )}
      </p>

      {loops.map((f) => (
        <p key={`${f.mic}-${f.speaker}`} className={`alert ${f.status === 'feedback' ? 'alert-bad' : 'alert-warn'}`}>
          {f.status === 'feedback' ? 'Feedback!' : 'Ringing:'} {rig.nodes[f.mic]?.name} is hearing {rig.nodes[f.speaker]?.name} (loop gain{' '}
          {f.loopGainDb.toFixed(1)} dB). Turn it down in that mix, or the speaker’s volume.
        </p>
      ))}

      <DevicePanel node={node} />
      {cable && <CableCard cable={cable} here={node.id} />}

      {gear.length > 0 && (
        <section>
          <h3>Their gear</h3>
          <div className="gear-list">
            {gear.map((id) => (
              <button key={id} onClick={() => select({ id })}>
                {rig.nodes[id].name}
              </button>
            ))}
          </div>
        </section>
      )}

      {listen && (
        <section>
          <h3>What {node.name} hears</h3>
          <HearList point={listen} />
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

/** The picked-out cable: both ends, what it carries, and what you can do with it. */
function CableCard({ cable, here }: { cable: Cable; here: string }) {
  const { sim, rig, update, select } = useGame();
  const reading = probeCable(sim, cable.id);
  const issue = sim.graph.cables.get(cable.id)?.issue;
  const change = (fn: (c: Cable) => void) => update((r) => fn(r.cables[cable.id]));
  // This device's end first.
  const ends = (cable.to?.node === here && cable.from?.node !== here ? (['to', 'from'] as const) : (['from', 'to'] as const)).map((end) => ({
    end,
    e: cable[end],
    loose: !cable[end] || cable.faults?.unplugged === end || cable.faults?.unplugged === 'both',
  }));
  const far = ends[1];

  return (
    <section className="cable-card">
      <div className="cable-card-head">
        <h3>{cable.label ?? cable.id}</h3>
        <button className="link tiny" onClick={() => select({ id: here })} title="Put the cable down">
          close
        </button>
      </div>
      <p className="muted small-print">
        {cable.kind === 'network' ? 'Network (AVB) cable: carries all 16 inputs to the mixer and 8 mixes back.' : `${cable.kind === 'quarter-inch' ? '1/4" instrument' : cable.kind.toUpperCase()} cable.`}
      </p>
      <ol className="cable-run">
        {ends.map(({ end, e, loose }, i) => (
          <li key={end} className={loose ? 'end-loose' : ''}>
            <span className="end-where">
              <strong>{e ? shortName(rig, e.node) : 'Nothing'}</strong>
              {e && <span className="muted"> {sim.graph.ports.get(e.node)?.find((p) => p.id === e.port)?.label ?? e.port}</span>}
            </span>
            <span className={`end-state ${loose ? 'bad' : ''}`}>{loose ? 'not plugged in' : 'plugged in'}</span>
            {e && i === 0 && <EndMover cable={cable} end={end} />}
            {e && (loose ? (
              <button onClick={() => change(reseat)}>Plug in</button>
            ) : (
              <button onClick={() => change((c) => unplug(c, end))} title="Pull this end out of its jack">
                Pull out
              </button>
            ))}
            {i === 0 && (
              <div className="cable-wire">
                <LevelBadge level={reading.level} /> <Content items={reading.content} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {isUnplugged(cable) && <p className="alert alert-warn">This cable is not plugged in at both ends.</p>}
      {issue && cable.from && cable.to && <p className="alert alert-warn">{issue}.</p>}
      <div className="actions">
        {far.e && (
          <button className="primary" onClick={() => select({ id: far.e!.node, cable: cable.id })}>
            Follow it to {shortName(rig, far.e.node)} →
          </button>
        )}
        <button onClick={() => change(replaceCable)} title="Swap this cable for a known-good one. Fixes broken or crackly cables.">
          Swap for a new cable
        </button>
      </div>
    </section>
  );
}

/** Move this end to another jack on the same device (or click an empty jack on the panel). */
function EndMover({ cable, end }: { cable: Cable; end: 'from' | 'to' }) {
  const { sim, rig, update } = useGame();
  const e = cable[end];
  const options = freePorts(rig, sim.graph, cable, end);
  if (!e || options.length < 2) return null;
  return (
    <select
      value={e.port}
      onChange={(ev) => update((r) => moveEnd(r.cables[cable.id], end, ev.target.value))}
      title="Move this end to another jack. You can also click an empty jack on the panel above."
    >
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.id === e.port ? `In: ${p.label}` : `Move to ${p.label}`}
        </option>
      ))}
    </select>
  );
}
