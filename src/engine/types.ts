// Core data model for the rig (what the player edits) and for signals.
//
// Sound is simulated as levels in dB flowing through a graph of "points"
// (device ports and internal stages). A signal is a set of components, one
// per source (e.g. "Bass", "Leader vocal"), so every point can report both
// how loud it is and what it carries.

/**
 * What kind of signal a point carries. Each domain has its own idea of
 * "good": a mic cable at -45 dBu is healthy, a line output at -45 is not.
 */
export type Domain = 'mic' | 'instrument' | 'line' | 'acoustic' | 'close';

export type Level = 'none' | 'low' | 'good' | 'hot' | 'clipping';

/** Qualities attached to a component as it passes through the system. */
export type Flag =
  | 'distorted' // passed through a stage that was clipping
  | 'thin' // lost its low end (high HPF, small wedge)
  | 'bleed' // picked up by a mic aimed at something else
  | 'intermittent' // crackly cable or RF dropouts
  | 'interference' // two transmitters on one frequency
  | 'feedback' // part of a feedback loop
  | 'fx'; // effects return (reverb etc.)

export interface Component {
  db: number;
  flags: Flag[];
}

/** Keyed by source id. Keys starting with "~" are hidden analysis probes. */
export type Signal = Readonly<Record<string, Component>>;

export interface Vec2 {
  x: number;
  y: number;
}

/** Hidden faults that the player can't directly see as a switch or knob. */
export interface Faults {
  /** Device is dead (internal failure). Blocks everything inside it. */
  broken?: boolean;
  /** DI: a ground loop exists, so hum appears unless Ground Lift is on. */
  groundLoop?: boolean;
  /** Wireless receiver: RF dropouts. */
  rfDropouts?: boolean;
  /** Mic: pointed at a wedge instead of away from it. */
  facingWedge?: boolean;
  /** Power amp / powered speaker in protect mode. */
  protectMode?: boolean;
}

export interface NodeInstance<P = any> {
  id: string;
  type: string;
  name: string;
  /** Stage position in metres. x runs across the stage, y from the front edge (0) to the back. */
  position?: Vec2;
  props: P;
  faults?: Faults;
}

export interface CableEnd {
  node: string;
  port: string;
}

export type CableKind = 'xlr' | 'quarter-inch' | 'network' | 'speaker';

export interface CableFaults {
  /** An end is sitting next to its jack, not plugged in. */
  unplugged?: 'from' | 'to' | 'both';
  broken?: boolean;
  intermittent?: boolean;
}

/**
 * A physical cable. `from`/`to` are just the two ends; signal direction is
 * worked out from the ports (output → input), so a cable plugged in
 * "backwards" behaves exactly as it would in real life. An end of `null`
 * means that end is lying loose with nowhere it's meant to go.
 */
export interface Cable {
  id: string;
  kind: CableKind;
  label?: string;
  from: CableEnd | null;
  to: CableEnd | null;
  faults?: CableFaults;
}

export interface Rig {
  nodes: Record<string, NodeInstance>;
  cables: Record<string, Cable>;
}

/** Settings shared by mains-powered devices. */
export interface PowerProps {
  /** Front-panel power switch. */
  switch: boolean;
  /** Where the power cord goes: 'wall', a power-strip node id, or null if unplugged. */
  plug: string | null;
}

export type Battery = 'good' | 'low' | 'dead';
