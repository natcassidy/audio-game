// What each device physically looks like: one or more faces (front, rear),
// each a row of sections holding jacks, knobs, switches, lights and
// displays. The renderer (components/DevicePanel) draws them; this file
// only decides what goes where, so it can be unit-tested.

import type { CompiledGraph, NodeInstance } from '../engine';
import { controlsFor, type Control } from './controls';

export type PanelItem =
  /** A physical jack. The renderer draws whatever is plugged into it. */
  | { t: 'jack'; port: string; label?: string; led?: string; phantom?: number }
  /** A knob, switch, selector or button (from controls.ts, so tooltips stay in one place). */
  | { t: 'control'; control: Control }
  /** The power-cord inlet; the cord's other end is shown as a tag. */
  | { t: 'inlet'; control: Control }
  /** An on/off light driven by a readout. `bad` lights are red. */
  | { t: 'led'; key: string; label: string; bad?: boolean }
  /** Bar graph (RF, battery). */
  | { t: 'bars'; key: string; label: string; max: number }
  /** A level meter driven by a readout holding a Level. */
  | { t: 'meter'; key: string; label: string }
  /** A small LCD showing a readout's text. */
  | { t: 'lcd'; key: string; label?: string; suffix?: string }
  /** Outlets on a power strip; the renderer fills them with the devices plugged in. */
  | { t: 'outlets'; count: number }
  /** Printed text on the panel. */
  | { t: 'print'; text: string };

export interface PanelSection {
  label?: string;
  items: PanelItem[];
  /** Lay items out in a grid this many columns wide (jack banks). */
  columns?: number;
}

export type FaceStyle = 'rack' | 'box' | 'speaker' | 'pedal' | 'mic' | 'pack' | 'instrument' | 'strip';

export interface Face {
  name: string;
  style: FaceStyle;
  /** Brand/model printed on the face. */
  brand?: string;
  sections: PanelSection[];
}

const jack = (port: string, extra: Partial<Extract<PanelItem, { t: 'jack' }>> = {}): PanelItem => ({ t: 'jack', port, ...extra });

function ctl(node: NodeInstance, label: string): PanelItem[] {
  const c = controlsFor(node).find((x) => x.label === label);
  if (!c) return [];
  return [c.kind === 'plug' ? { t: 'inlet', control: c } : { t: 'control', control: c }];
}

/** Every control on the device that isn't already placed. */
function rest(node: NodeInstance, used: string[]): PanelItem[] {
  return controlsFor(node)
    .filter((c) => !used.includes(c.label))
    .map((c) => (c.kind === 'plug' ? { t: 'inlet', control: c } : { t: 'control', control: c }));
}

function powerSection(node: NodeInstance, label = 'Power'): PanelSection {
  return { label, items: [...ctl(node, 'Power'), ...ctl(node, 'Power cord')] };
}

function range(n: number, from = 1) {
  return Array.from({ length: n }, (_, i) => i + from);
}

type Builder = (node: NodeInstance, graph: CompiledGraph) => Face[];

const BUILDERS: Record<string, Builder> = {
  stagebox: (node) => {
    const p = node.props as { inputs: number; outputs: number };
    return [
      {
        name: 'Front',
        style: 'rack',
        brand: 'PreSonus NSB 16.8',
        sections: [
          {
            label: 'Inputs (mic / line)',
            columns: 8,
            items: range(p.inputs).map((i) => jack(`in${i}`, { label: String(i), led: `in${i}`, phantom: i })),
          },
          { label: 'Outputs', columns: 8, items: range(p.outputs).map((i) => jack(`out${i}`, { label: String(i) })) },
          {
            items: [
              { t: 'led', key: 'power', label: 'Power' },
              { t: 'led', key: 'network', label: 'Network' },
              { t: 'led', key: 'muteAll', label: 'Muted', bad: true },
              ...ctl(node, 'Mute All'),
            ],
          },
        ],
      },
      {
        name: 'Rear',
        style: 'rack',
        sections: [{ label: 'AVB', items: [jack('net', { label: 'Network' })] }, powerSection(node)],
      },
    ];
  },

  mixer: (node, graph) => {
    const ins = (graph.ports.get(node.id) ?? []).filter((port) => /^in\d+$/.test(port.id));
    return [
      {
        name: 'Rear',
        style: 'rack',
        brand: 'PreSonus StudioLive 32SC',
        sections: [
          { label: 'Analog inputs', columns: 8, items: ins.map((port) => jack(port.id, { label: port.id.slice(2) })) },
          { label: 'Main out', items: [jack('mainL', { label: 'L' }), jack('mainR', { label: 'R' })] },
          { label: 'AVB', items: [jack('net', { label: 'Network' })] },
          powerSection(node),
        ],
      },
      {
        name: 'Front',
        style: 'rack',
        sections: [
          { items: [{ t: 'print', text: 'Faders, sends and the Fat Channel are on the mixer panel below.' }] },
          { label: 'Phones', items: [jack('phones', { label: 'Phones' })] },
          {
            items: [
              { t: 'led', key: 'power', label: 'Power' },
              { t: 'led', key: 'network', label: 'Network' },
              { t: 'meter', key: 'mainL', label: 'Main L' },
              { t: 'meter', key: 'mainR', label: 'Main R' },
            ],
          },
        ],
      },
    ];
  },

  wedge: (node) => speakerFaces(node, 'Wharfedale Pro powered wedge'),
  'main-speaker': (node) => speakerFaces(node, 'Main PA speaker'),

  'wireless-rx': (node) => [
    {
      name: 'Front',
      style: 'rack',
      brand: 'Wireless receiver',
      sections: [
        { items: [{ t: 'lcd', key: 'frequency', suffix: 'MHz' }, ...ctl(node, 'Frequency')] },
        {
          items: [
            { t: 'bars', key: 'rf', label: 'RF', max: 5 },
            { t: 'meter', key: 'audio', label: 'AF' },
            { t: 'bars', key: 'txBattery', label: 'Tx batt', max: 3 },
            { t: 'led', key: 'interference', label: 'Interf.', bad: true },
          ],
        },
        { items: ctl(node, 'Power') },
      ],
    },
    {
      name: 'Rear',
      style: 'rack',
      sections: [
        { label: 'Audio out', items: [jack('out', { label: 'XLR' }), ...ctl(node, 'Output level')] },
        { label: 'Power', items: ctl(node, 'Power cord') },
      ],
    },
  ],

  'wireless-tx': (node) => {
    const handheld = (node.props as { kind: string }).kind === 'handheld';
    return [
      {
        name: handheld ? 'Handheld mic' : 'Body-pack',
        style: handheld ? 'mic' : 'pack',
        brand: handheld ? 'Wireless handheld' : 'Wireless body-pack + headset',
        sections: [
          {
            items: [
              { t: 'led', key: 'power', label: 'On' },
              { t: 'led', key: 'mute', label: 'Mute', bad: true },
              { t: 'bars', key: 'battery', label: 'Batt', max: 3 },
            ],
          },
          { items: [...ctl(node, 'Power'), ...ctl(node, 'Mute')] },
          { items: [{ t: 'lcd', key: 'frequency', suffix: 'MHz' }, ...ctl(node, 'Frequency')] },
          { items: rest(node, ['Power', 'Mute', 'Frequency']) },
        ],
      },
    ];
  },

  mic: (node) => {
    const condenser = (node.props as { micType: string }).micType === 'condenser';
    return [
      {
        name: 'Mic',
        style: 'mic',
        brand: condenser ? 'Condenser mic (needs 48V)' : 'Dynamic mic',
        sections: [{ items: [...ctl(node, 'On/off switch'), jack('out', { label: 'XLR out' })] }],
      },
    ];
  },

  di: (node) => {
    const active = (node.props as { active: boolean }).active;
    return [
      {
        name: 'DI box',
        style: 'box',
        brand: active ? 'Active DI' : 'Passive DI',
        sections: [
          { label: 'Instrument side', items: [jack('in', { label: 'Input' }), jack('thru', { label: 'Thru' })] },
          {
            items: [
              ...ctl(node, '-20 dB pad'),
              ...ctl(node, 'Ground lift'),
              ...(active ? [{ t: 'led', key: 'powered', label: 'Power' } as PanelItem] : []),
              ...rest(node, ['-20 dB pad', 'Ground lift']),
            ],
          },
          { label: 'To stagebox', items: [jack('xlr', { label: 'XLR out' })] },
        ],
      },
    ];
  },

  tuner: (node) => [
    {
      name: 'Pedal',
      style: 'pedal',
      brand: 'Tuner pedal',
      sections: [
        { items: [jack('in', { label: 'In' })] },
        { items: [{ t: 'led', key: 'display', label: 'Display' }, { t: 'led', key: 'tuning', label: 'Muted (tuning)', bad: true }] },
        { items: [...ctl(node, 'Engaged (tuning)'), ...rest(node, ['Engaged (tuning)'])] },
        { items: [jack('out', { label: 'Out' })] },
      ],
    },
  ],

  'bass-guitar': (node) => instrumentFaces(node, 'Electric bass'),
  'electric-guitar': (node) => instrumentFaces(node, 'Electric guitar'),
  'acoustic-guitar': (node) => [
    {
      name: 'Guitar',
      style: 'instrument',
      brand: 'Acoustic-electric guitar',
      sections: [
        { label: 'Pickup', items: [...ctl(node, 'Volume'), { t: 'lcd', key: 'battery', label: 'Battery' }, ...rest(node, ['Volume'])] },
        { label: 'Strap-pin jack', items: [jack('out', { label: 'Out' })] },
      ],
    },
  ],

  keyboard: (node) => [
    {
      name: 'Rear',
      style: 'box',
      brand: 'Stage piano',
      sections: [
        { items: ctl(node, 'Master volume') },
        { label: 'Outputs', items: [jack('outL', { label: 'L' }), jack('outR', { label: 'R' })] },
        { items: [{ t: 'led', key: 'power', label: 'Power' }] },
        powerSection(node),
      ],
    },
  ],

  modeler: (node) => [
    {
      name: 'Rear',
      style: 'pedal',
      brand: 'Amp modeler',
      sections: [
        { items: [jack('in', { label: 'Guitar in' })] },
        { items: ctl(node, 'Output level') },
        { items: [jack('xlr', { label: 'XLR out' })] },
        powerSection(node),
      ],
    },
  ],

  amp: (node) => [
    {
      name: 'Front',
      style: 'speaker',
      brand: String((node.props as { model?: string }).model ?? 'Amp'),
      sections: [
        { items: [jack('in', { label: 'Input' })] },
        { items: ctl(node, 'Volume') },
        {
          items: [
            { t: 'led', key: 'power', label: 'Power' },
            { t: 'led', key: 'clip', label: 'Clip', bad: true },
            { t: 'led', key: 'protect', label: 'Protect', bad: true },
          ],
        },
        powerSection(node),
      ],
    },
  ],

  'power-strip': (node) => [
    {
      name: 'Strip',
      style: 'strip',
      brand: 'Power strip',
      sections: [
        { items: [...ctl(node, 'Power'), { t: 'led', key: 'light', label: 'On' }, ...ctl(node, 'Press reset')] },
        { label: 'Outlets', items: [{ t: 'outlets', count: 6 }] },
        { label: 'Its own cord', items: ctl(node, 'Power cord') },
      ],
    },
  ],
};

function speakerFaces(node: NodeInstance, brand: string): Face[] {
  return [
    {
      name: 'Rear',
      style: 'speaker',
      brand,
      sections: [
        { label: 'Input', items: [jack('in', { label: 'XLR in' })] },
        { items: ctl(node, 'Volume') },
        {
          items: [
            { t: 'led', key: 'power', label: 'Power' },
            { t: 'led', key: 'signal', label: 'Signal' },
            { t: 'led', key: 'limit', label: 'Limit', bad: true },
            { t: 'led', key: 'protect', label: 'Protect', bad: true },
          ],
        },
        powerSection(node),
      ],
    },
  ];
}

function instrumentFaces(node: NodeInstance, brand: string): Face[] {
  return [
    {
      name: 'Instrument',
      style: 'instrument',
      brand,
      sections: [{ items: ctl(node, 'Volume') }, { label: 'Output', items: [jack('out', { label: 'Out' })] }],
    },
  ];
}

/** The faces of a device, or [] for things with no panel (people, the room, the drum kit). */
export function panelFor(node: NodeInstance, graph: CompiledGraph): Face[] {
  return BUILDERS[node.type]?.(node, graph) ?? [];
}

export function panelItems(faces: Face[]): PanelItem[] {
  return faces.flatMap((f) => f.sections.flatMap((s) => s.items));
}
