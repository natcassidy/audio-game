# Church Sound Simulator

A local, in-browser game for learning to run our church's sound system: a
PreSonus StudioLive 32SC, an NSB 16.8 stagebox, DI boxes, wedges and the
band. Sound is simulated as **signal levels flowing through a graph**, not
real audio.

```sh
npm install
npm run dev      # app at http://localhost:5173
npm test         # engine unit tests (Vitest)
npm run build    # typecheck + production build
```

## Status

**Phase 1 (signal engine, device models, unit tests): done.** The app is a
placeholder that lists what each mixer channel carries. Next up is Phase 2:
the patch view and probe tool.

## Engine overview (`src/engine`)

The **rig** (`Rig`) is the editable state: devices (`nodes`) with settings
(`props`) and hidden `faults`, plus `cables` between ports. It's plain
JSON, so scenarios and saved progress can store it directly.

`simulate(rig)` compiles the rig into a flat graph of **points** (device
ports and internal stages such as "Ch 8 (pre-fader)" or "Mix 3 (sum)") joined
by **edges**:

| Edge kind | Comes from |
|---|---|
| `internal` | A device's own wiring and controls (gain, mute, faders, sends, power) |
| `cable` | A cable between an output and an input (direction comes from the ports) |
| `network` | The AVB cable: 16 channels to the mixer and 8 back to the stagebox |
| `rf` | Wireless transmitter to receiver (frequency must match) |
| `acoustic` | Sound through the air, by distance and aim (voices, drums and amps into mics, everything into ears) |

Each edge has a gain in dB. A control that's off, or a fault, **blocks** the
edge and records a plain-language reason, e.g. *"Ch 8 (Bass)'s send to Mix 3
(Keys) is turned all the way down"*. Signals carry one component per
source, so every point reports both a **level** (none / low / good / hot /
clipping, judged on that point's own scale: mic, instrument, line, acoustic
or close) and its **content** (e.g. "Keys + Keys player vocal + Bass (thin)").
Components pick up flags such as `thin`, `distorted`, `bleed`,
`intermittent`, `interference` and `feedback`.

**Feedback.** Wedge or main to mic pickup isn't propagated, since that would
make the graph loop. Instead, hidden probe signals measure the round-trip
gain of each mic/speaker loop: at -3 dB or more it rings, and at 0 dB or more it
feeds back, which adds a squeal source to that speaker.

### API

```ts
import { createDefaultRig, simulate, probePoint, probeCable, trace, explainTrace } from './engine';

const rig = createDefaultRig();
rig.nodes['bass-di'].props.battery = 'dead';
const sim = simulate(rig);

probePoint(sim, 'mixer.ch8.pre');      // { level: 'none', summary: 'nothing', … }
probeCable(sim, 'c-in8');              // what's on the Bass DI XLR cable
sim.readouts['rx-wl1'];                // LEDs and meters: { rf: 5, audio: 'good', … }
sim.feedback;                          // loop gain per mic/speaker pair

const t = trace(sim, 'bass', 'wedge-3');
t.break?.reason;  // "Bass DI is an active DI: its battery is dead and no 48V phantom
                  //  power is reaching it (turn on 48V for Stagebox In 8, or replace the battery)"
explainTrace(t);  // one-line summary for hints and debriefs
```

`trace(sim, source, destination)` returns the route that needs the fewest
fixes, the **first point where the signal dies** with its reason, and the
problems along the working part (weak, buried, hot, thin, hum, bleed). When
there's no physical route at all, it names the dead end: an empty jack, a
loose cable end, or a cable between two outputs. Pass `{ prefer: goodTrace }`
(a trace of the same source on a known-good rig) to steer it to the intended
route when two fixes would both work.

### Devices (`src/engine/devices`)

Vocal and condenser mics; wireless body-packs, handhelds and receivers; bass,
electric and acoustic guitars; keys; drum kit; DI boxes (active or passive,
ground lift); tuner pedal; amp modeler; bass amps (Fender Rumble 15, Peavey
Basic 112); NSB 16.8 stagebox; StudioLive 32SC mixer (16 channels, Fat
Channel HPF/EQ, Main / Mix 1–16 / FX A–D, pre/post sends, stereo link,
output patch, solo, input source); powered wedges and mains; power strips;
performers (voice and ears); the congregation.

To add a device, write a `DeviceDef` (ports, points, edges and gates in
`build`; optionally `phantomOn` and `readouts`) and register it in
`devices/index.ts`.

### Default rig (`src/engine/rigs/default.ts`)

The channel list matches our board: 1–6 Vox 1–6 · 7 Keys · 8 Bass · 9 Tom ·
10 Hi-hat · 11–12 Room L/R (linked) · 13 Guitar · 14 WL1 · 15 WL2 ·
16 Handheld. For now, stagebox In N feeds channel N and stagebox Out N
carries Mix N to Wedge N. **TODO:** confirm against a real stage inventory.
