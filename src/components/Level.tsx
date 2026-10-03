import type { ContentItem, Level } from '../engine';

export const LEVEL_TEXT: Record<Level, string> = {
  none: 'No signal',
  low: 'Low',
  good: 'Good',
  hot: 'Hot',
  clipping: 'Clipping',
};

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`level level-${level}`}>{LEVEL_TEXT[level]}</span>;
}

/** A small 5-segment meter. */
export function Meter({ level, vertical = false }: { level: Level; vertical?: boolean }) {
  const lit = { none: 0, low: 1, good: 3, hot: 4, clipping: 5 }[level];
  return (
    <span className={`meter ${vertical ? 'meter-v' : ''}`} title={LEVEL_TEXT[level]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`seg ${i <= lit ? `on seg-${i}` : ''}`} />
      ))}
    </span>
  );
}

/** "Bass (thin) + Keys" as a list of chips. */
export function Content({ items }: { items: ContentItem[] }) {
  if (items.length === 0) return <span className="muted">nothing</span>;
  return (
    <span className="content">
      {items.map((i) => (
        <span key={i.source} className={`chip ${i.flags.includes('feedback') ? 'chip-bad' : ''}`}>
          {i.label}
          {i.flags.filter((f) => f !== 'fx').map((f) => (
            <em key={f}> {f}</em>
          ))}
        </span>
      ))}
    </span>
  );
}
