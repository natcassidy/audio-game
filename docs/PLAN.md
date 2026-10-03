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

## Next

### Phase 3: Scenarios
Merges the old phases 6–8.

- Scenario JSON files: a complaint, the faults to inject, and a win
  condition such as "bass reaches Wedge 3".
- Starter scenarios 1–15. Tutorials are just the first few, easy scenarios
  with extra hint text, not a separate mode.
- Escalating hints from `trace()` (using `prefer` with the known-good rig).
- Debrief: the signal path, where it broke, and the real-world lesson.
- Simple scoring (time, hints used, collateral damage) and progress saved in
  localStorage.

## Maybe later
- Extended devices (choir mics, in-ears, click/tracks laptop, livestream mix,
  subwoofer).
- Pre-service rush and full-soundcheck modes.
- Signal-flow animation.
- Real audio with Web Audio.
