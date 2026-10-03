// Reading and writing nested props by dotted path ("power.switch", "preamps.7.gain").

export function getIn(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Mutates `obj` in place. Intermediate objects must already exist. */
export function setIn(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    const next = cur[key];
    if (next === null || typeof next !== 'object') throw new Error(`No object at "${key}" in path "${path}"`);
    cur = next as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}
