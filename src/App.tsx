import { useMemo } from 'react';
import { CHANNEL_NAMES, createDefaultRig, probePoint, simulate } from './engine';

// Placeholder until Phase 2 (patch view and probe tool): shows that the
// signal engine runs in the browser by listing what each channel carries.
export function App() {
  const sim = useMemo(() => simulate(createDefaultRig()), []);
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16, maxWidth: 900, margin: '0 auto' }}>
      <h1>Church Sound Simulator</h1>
      <p>Signal engine: default rig, everything working.</p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <th align="left">Channel</th>
            <th align="left">Level</th>
            <th align="left">Carries</th>
          </tr>
        </thead>
        <tbody>
          {CHANNEL_NAMES.map((name, i) => {
            const r = probePoint(sim, `mixer.ch${i + 1}.pre`);
            return (
              <tr key={name} style={{ borderTop: '1px solid #ddd' }}>
                <td>
                  {i + 1}. {name}
                </td>
                <td>{r.level}</td>
                <td>{r.summary}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
