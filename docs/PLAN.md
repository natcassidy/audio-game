# Build plan (condensed)

The original plan had nine phases. It's now three, plus optional extras. The
game stays focused on one thing: **find out why someone can't hear something,
and fix it.**

## Done

### Phase 1: Signal engine
Signal levels and content flow through a graph of devices, cables and mixer
stages. `trace()` finds the first point where a signal dies and explains why.
Core devices, the default church rig, and unit tests.

### Phase 2: Playable sandbox (one screen)
Merges the old phases 2–5 (patch view, probe tool, mixer view, stage view,
"who hears what").

- **Stage view:** every device and cable on a top-down stage. Cables are
  coloured by signal level and dashed when unplugged.
- **Inspector:** click anything.
  - **Devices:** controls (with tooltips), lights and meters, and a probe
    reading for every jack.
  - **Cables:** what they carry. Plug back in, swap for a new one, or move
    an end to another jack.
  - **Musicians:** what they hear, loudest first. This is the "who hears
    what" view.
- **Mixer panel:** 16 strips, Main / Mix 1–8 select with the "Editing MIX 3,
  not Main" banner, the master, the Fat Channel (source, gain, 48V, HPF, EQ,
  pan, Main assign, link), solo to headphones, and the output patch.

**Cut to keep it simple:** drag-to-connect cables (you click to reseat, swap
or move an end instead), the separate patch table, scenes, and FX in the UI
(still in the engine), and Mixes 9–16 in the UI.

### Phase 3: Scenarios
Merges the old phases 6–8.

- 26 scenarios as JSON in `src/scenarios/`: starter scenarios 1–14, a
  two-fault scenario, a 3-minute pre-service rush, and scenarios 17–26
  (wireless dropouts and interference, a crackly cable, Main mute and
  assign, input source, swapped inputs, receiver output level, a
  post-fader monitor mix, and a second pre-service rush). Tutorials are the
  easy ones, with an intro line. Each file has the complaint, the faults
  (path/value edits to the default rig), win conditions, a known solution,
  the cause and the lesson.
- Goals are checked live after every change. A win also requires that
  nothing that works in the healthy rig is broken (collateral damage).
- Escalating hints: the scenario's own nudges, then where the signal stops,
  then exactly why. They're generated from `trace()`, using the healthy
  rig's route as the reference.
- Debrief: what was wrong, where the signal died, the working signal path,
  and the lesson. "Give up" shows the answer and can apply the fix on stage.
- Scoring: stars and points, losing points for hints, collateral damage and
  time. The best result per scenario is saved in localStorage.
- Tests prove every scenario starts broken, its solution wins with nothing
  else broken, and its hints end with something specific.

Not included: the click-routed-to-Main scenario (it needs the extended
click/tracks device) and the full-soundcheck mode.

## Maybe later
- The click-routed-to-Main scenario, and full soundcheck from a blank board.
- Extended devices (choir mics, in-ears, click/tracks laptop, livestream mix,
  subwoofer).
- Signal-flow animation.
- Real audio with Web Audio.
