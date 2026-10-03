import {
  INPUT_SOURCE_NAMES,
  OUTPUT_SOURCES,
  effectiveChannel,
  mixLabel,
  mixSelectLabel,
  outputSourceLabel,
  probePoint,
  type InputSource,
  type Level,
  type MixSelect,
  type MixerProps,
  type OutputSource,
  type PreampState,
} from '../engine';
import { useGame } from '../store';
import {
  SLIDER_MAX,
  SLIDER_MIN,
  controllingChannel,
  dbToSlider,
  faderValue,
  formatDb,
  masterOf,
  mixerOf,
  preampPath,
  setFaderValue,
  sliderToDb,
} from '../ui/mixerModel';
import { getIn, setIn } from '../ui/paths';
import { Content, Meter } from './Level';

const HPF_OPTIONS = [0, 80, 100, 150, 250];

/** Edit the mixer's props with a mutating function. */
function useMixer() {
  const { rig, sim, update } = useGame();
  const p = mixerOf(rig);
  const edit = (fn: (p: MixerProps) => void) => update((r) => fn(mixerOf(r)));
  return { rig, sim, p, edit, update };
}

export function MixerPanel() {
  const { p, sim, edit } = useMixer();
  const mode = p.selectedMix;
  const readouts = sim.readouts.mixer ?? {};
  const on = readouts.power !== false;

  return (
    <section className={`mixer ${on ? '' : 'mixer-off'}`} aria-label="Mixer">
      <div className="mix-select">
        <span className="mix-select-label" title="Which mix the faders control. In a Mix, faders set how much of each channel goes to that wedge.">
          Faders control:
        </span>
        <button className={mode === 'main' ? 'active' : ''} onClick={() => edit((m) => (m.selectedMix = 'main'))}>
          Main
        </button>
        {p.mixes.slice(0, 8).map((mix, i) => {
          const id = `mix${i + 1}` as MixSelect;
          return (
            <button key={id} className={mode === id ? 'active' : ''} onClick={() => edit((m) => (m.selectedMix = id))} title={mixLabel(p, i + 1)}>
              Mix {i + 1}
              {mix.name !== `Mix ${i + 1}` && <small>{mix.name}</small>}
            </button>
          );
        })}
        {!on && <span className="alert alert-bad">Mixer is off</span>}
      </div>
      {mode !== 'main' && <div className="banner">{readouts.banner} — faders are sends to this mix.</div>}

      <div className="mixer-body">
        <div className="strips">
          {p.channels.map((_, i) => (
            <Strip key={i} n={i + 1} />
          ))}
          <MasterStrip />
        </div>
        <div className="mixer-side">
          <FatChannel />
          <OutputPatch />
        </div>
      </div>
    </section>
  );
}

function Strip({ n }: { n: number }) {
  const { p, sim, edit } = useMixer();
  const ch = p.channels[n - 1];
  const eff = effectiveChannel(p, n);
  const lead = controllingChannel(p, n);
  const followed = lead !== n;
  const value = faderValue(p, n);
  const level = (sim.readouts.mixer?.[`ch${n}`] ?? 'none') as Level;
  const selected = p.selectedChannel === n;

  return (
    <div className={`strip ${selected ? 'selected' : ''} ${p.selectedMix !== 'main' ? 'strip-send' : ''}`}>
      <button className="strip-name" onClick={() => edit((m) => (m.selectedChannel = n))} title="Select: show this channel in the Fat Channel">
        <span>{n}</span>
        {ch.name}
      </button>
      <Meter level={level} vertical />
      <button
        className={`small ${ch.solo ? 'solo-on' : ''}`}
        onClick={() => edit((m) => (m.channels[n - 1].solo = !m.channels[n - 1].solo))}
        title="Solo: listen to this channel in the headphones"
      >
        S
      </button>
      <button
        className={`small ${eff.mute ? 'mute-on' : ''}`}
        disabled={followed}
        onClick={() => edit((m) => (m.channels[lead - 1].mute = !m.channels[lead - 1].mute))}
        title="Mute: silences this channel everywhere, including its monitor sends"
      >
        M
      </button>
      <input
        className="fader"
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={1}
        value={dbToSlider(value)}
        disabled={followed}
        aria-label={`${ch.name} ${p.selectedMix === 'main' ? 'fader' : 'send'}`}
        onChange={(e) => edit((m) => setFaderValue(m, n, sliderToDb(Number(e.target.value))))}
      />
      <span className="db">{followed ? `→${lead}` : formatDb(value)}</span>
    </div>
  );
}

function MasterStrip() {
  const { p, sim, edit } = useMixer();
  const mode = p.selectedMix;
  const master = masterOf(p);
  const meter = (sim.readouts.mixer?.[mode === 'main' ? 'mainL' : mode] ?? 'none') as Level;
  const setMaster = (fn: (m: { master: number; mute: boolean }) => void) => edit((m) => fn(masterOf(m)));
  const k = mode.startsWith('mix') ? Number(mode.slice(3)) : 0;

  return (
    <div className="strip master">
      <div className="strip-name">
        <span>M</span>
        {mode === 'main' ? 'Main' : mixSelectLabel(p, mode)}
      </div>
      <Meter level={meter} vertical />
      {k > 0 ? (
        <button
          className="small"
          onClick={() => edit((m) => (m.mixes[k - 1].preFader = !m.mixes[k - 1].preFader))}
          title="Pre-fader: this mix ignores the Main faders (normal for wedges). Post-fader: it follows them."
        >
          {p.mixes[k - 1].preFader ? 'Pre' : 'Post'}
        </button>
      ) : (
        <span />
      )}
      <button className={`small ${master.mute ? 'mute-on' : ''}`} onClick={() => setMaster((m) => (m.mute = !m.mute))} title="Mute this mix">
        M
      </button>
      <input
        className="fader"
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={1}
        value={dbToSlider(master.master)}
        aria-label="Master fader"
        onChange={(e) => setMaster((m) => (m.master = sliderToDb(Number(e.target.value))))}
      />
      <span className="db">{formatDb(master.master)}</span>
    </div>
  );
}

function FatChannel() {
  const { p, rig, sim, edit, update } = useMixer();
  const n = p.selectedChannel;
  const ch = p.channels[n - 1];
  const pre = preampPath(rig, n);
  const preamp = pre ? (getIn(rig.nodes[pre.nodeId].props, pre.path) as PreampState) : null;
  const setPre = (key: keyof PreampState, value: unknown) =>
    pre && update((r) => setIn(r.nodes[pre.nodeId].props, `${pre.path}.${key}`, value));
  const solo = probePoint(sim, 'mixer.phones');

  return (
    <div className="fat">
      <h3>
        Fat Channel — Ch {n} {ch.name}
      </h3>
      <label className="control" title="Where this channel gets its signal. Network = the stagebox on stage.">
        <span>Input source</span>
        <select value={ch.source} onChange={(e) => edit((m) => (m.channels[n - 1].source = e.target.value as InputSource))}>
          {(Object.keys(INPUT_SOURCE_NAMES) as InputSource[]).map((s) => (
            <option key={s} value={s}>
              {INPUT_SOURCE_NAMES[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="control" title="Preamp gain. Set it so the meter sits in the green when the source is playing normally.">
        <span>Gain</span>
        <input
          type="range"
          min={0}
          max={65}
          step={1}
          disabled={!preamp}
          value={preamp?.gain ?? 0}
          onChange={(e) => setPre('gain', Number(e.target.value))}
        />
        <output>{preamp ? `${preamp.gain} dB` : 'n/a'}</output>
      </label>
      <label className="control" title="48V phantom power, sent down the cable. Condenser mics and active DIs need it.">
        <span>48V</span>
        <button className={`switch ${preamp?.phantom ? 'on' : ''}`} disabled={!preamp} onClick={() => setPre('phantom', !preamp?.phantom)}>
          {preamp?.phantom ? 'On' : 'Off'}
        </button>
      </label>
      <label className="control" title="High-pass filter: cuts low rumble. Good on vocals; too high makes bass and kick thin.">
        <span>HPF</span>
        <select value={ch.hpf} onChange={(e) => edit((m) => (m.channels[n - 1].hpf = Number(e.target.value)))}>
          {HPF_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f === 0 ? 'Off' : `${f} Hz`}
            </option>
          ))}
        </select>
      </label>
      {(['low', 'mid', 'high'] as const).map((band) => (
        <label key={band} className="control" title={`EQ: boost or cut the ${band} frequencies.`}>
          <span>EQ {band}</span>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            value={ch.eq[band]}
            onChange={(e) => edit((m) => (m.channels[n - 1].eq[band] = Number(e.target.value)))}
          />
          <output>{formatDb(ch.eq[band])}</output>
        </label>
      ))}
      <label className="control" title="Left/right position in the Main mix.">
        <span>Pan</span>
        <input type="range" min={-1} max={1} step={0.1} value={ch.pan} onChange={(e) => edit((m) => (m.channels[n - 1].pan = Number(e.target.value)))} />
        <output>{ch.pan === 0 ? 'C' : ch.pan < 0 ? `L${Math.round(-ch.pan * 100)}` : `R${Math.round(ch.pan * 100)}`}</output>
      </label>
      <label className="control" title="Send this channel to the Main mix (the room).">
        <span>Main assign</span>
        <button className={`switch ${ch.toMain ? 'on' : ''}`} onClick={() => edit((m) => (m.channels[n - 1].toMain = !ch.toMain))}>
          {ch.toMain ? 'On' : 'Off'}
        </button>
      </label>
      {n % 2 === 1 && (
        <label className="control" title={`Link Ch ${n} and Ch ${n + 1} as a stereo pair: one fader controls both, panned left and right.`}>
          <span>Link {n}+{n + 1}</span>
          <button className={`switch ${ch.link ? 'on' : ''}`} onClick={() => edit((m) => (m.channels[n - 1].link = !ch.link))}>
            {ch.link ? 'Linked' : 'Off'}
          </button>
        </label>
      )}
      <div className="phones">
        <strong>Headphones (solo):</strong> <Content items={solo.content.slice(0, 5)} />
      </div>
    </div>
  );
}

function OutputPatch() {
  const { p, edit } = useMixer();
  return (
    <div className="patch">
      <h3 title="Which mix comes out of each stagebox output (and so which wedge it reaches).">Output patch</h3>
      {p.networkPatch.map((src, j) => (
        <label key={j} className="control">
          <span>Stagebox Out {j + 1}</span>
          <select value={src ?? ''} onChange={(e) => edit((m) => (m.networkPatch[j] = (e.target.value || null) as OutputSource | null))}>
            <option value="">— nothing —</option>
            {OUTPUT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {outputSourceLabel(p, s)}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
