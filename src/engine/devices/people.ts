import type { DeviceDef } from '../graph';
import { SPECTRA } from '../sources';
import type { NodeInstance, Vec2 } from '../types';

export interface PerformerProps {
  role: string;
  sings: boolean;
  /** Content label for their voice, e.g. "Leader vocal". */
  voiceLabel?: string;
  /** Voice level in dB SPL at 1 m. */
  voiceDb: number;
}

/** A person on stage: a voice (if they sing or speak) and a pair of ears. */
export const performer: DeviceDef<PerformerProps> = {
  type: 'performer',
  build(node, b) {
    const p = node.props;
    if (p.sings) {
      b.point('voice', `${node.name}'s voice`, 'close', 'emitter');
      const src = b.source('voice', p.voiceLabel ?? `${node.name} vocal`, 'voice', SPECTRA.voice);
      b.inject('voice', src, p.voiceDb);
      b.emitter('voice', { offAxis: 0, reinforcement: false });
    }
    b.point('ears', `What ${node.name} hears`, 'acoustic', 'receiver');
    b.receiver('ears', { kind: 'ear', owner: node.id, targets: [], offAxis: 0 });
    b.primary('ears');
  },
};

/** The congregation's listening position. */
export const room: DeviceDef<Record<string, never>> = {
  type: 'room',
  build(node, b) {
    b.point('listen', `What ${node.name} hears`, 'acoustic', 'receiver');
    b.receiver('listen', { kind: 'room', owner: node.id, targets: [], offAxis: 0 });
    b.primary('listen');
  },
};

export function makePerformer(
  id: string,
  name: string,
  position: Vec2,
  opts: Partial<PerformerProps> = {},
): NodeInstance<PerformerProps> {
  return {
    id,
    type: 'performer',
    name,
    position,
    props: { role: opts.role ?? 'musician', sings: opts.sings ?? true, voiceDb: opts.voiceDb ?? 75, ...opts },
  };
}

export function makeRoom(id: string, name: string, position: Vec2): NodeInstance<Record<string, never>> {
  return { id, type: 'room', name, position, props: {} };
}
