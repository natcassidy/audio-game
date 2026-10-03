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

- **Stage map:** a top-down drawing of the stage and house: mic stands,
  wedges aimed at their musician, amps, the kit, the keyboard, the stagebox
  and wireless rack, the pews and the FOH desk. Speakers show sound waves
  coloured by level. Only the selected device's cables are drawn (plus its
  power cord); "Show every cable" draws the rest faintly.
- **Device view:** click anything.
  - **Devices:** the real front/rear panels (`src/ui/panels.ts`): jacks,
    knobs, switches, LEDs, meters and displays. Each jack shows the plug in
    it and a tape label naming the far end; a pulled-out plug hangs below
    its jack. The power inlet's tape shows where the cord goes, and a power
    strip shows what's plugged into its outlets.
  - **Cables:** click a plug to see what the cable carries, pull out or
    plug in either end, swap it, or move it (pick a jack, or click an empty
    one on the panel). "Follow it" jumps to the device at the other end.
  - **Musicians:** their gear, and what they hear, loudest first.
- **Mixer panel:** 16 strips, Main / Mix 1–8 select with the "Editing MIX 3,
  not Main" banner, the master, the Fat Channel (source, gain, 48V, HPF, EQ,
  pan, Main assign, link), solo to headphones, and the output patch.

**Cut to keep it simple:** drag-to-connect cables (you click a plug, then
reseat, swap or move it), the separate patch table, scenes, and FX in the UI
(still in the engine), and Mixes 9–16 in the UI.

### Phase 3: Scenarios
Merges the old phases 6–8.

- 16 scenarios as JSON in `src/scenarios/`: starter scenarios 1–14, a
  two-fault scenario, and a 3-minute pre-service rush. Tutorials are the
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
