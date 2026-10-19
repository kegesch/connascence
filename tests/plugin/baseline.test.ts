// Durable baseline fixtures. The positive case is the reload it exists for:
// a baseline saved by one plugin instance must come back unchanged for the
// next. Negatives are the records that must NOT be trusted, because storage
// is user-writable — a malformed record has to degrade to "no baseline"
// rather than silently anchoring the diff to garbage.
import { describe, it, expect } from 'vitest';
import {
  BaselineRecord,
  BaselineStore,
  baselineKey,
  clearBaseline,
  isBaselineRecord,
  loadBaseline,
  saveBaseline,
} from '../../plugin/baseline.ts';

class MemoryStore implements BaselineStore {
  readonly data = new Map<string, unknown>();
  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }
  async set(key: string, value: BaselineRecord): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const record: BaselineRecord = {
  at: '2026-10-19T19:00:00.000Z',
  count: 2,
  keys: ['position|src/a.ts|0|src/b.ts|host', 'identity|src/a.ts|log|src/b.ts|log'],
};

describe('baseline round trip', () => {
  it('returns exactly what a prior instance saved (the reload case)', async () => {
    const store = new MemoryStore();
    await saveBaseline(store, 'ses_1', record);
    expect(await loadBaseline(store, 'ses_1')).toEqual(record);
  });

  it('treats a missing key as no baseline', async () => {
    expect(await loadBaseline(new MemoryStore(), 'ses_missing')).toBeNull();
  });

  it('isolates sessions', async () => {
    const store = new MemoryStore();
    await saveBaseline(store, 'ses_1', record);
    expect(await loadBaseline(store, 'ses_1')).toEqual(record);
    expect(await loadBaseline(store, 'ses_2')).toBeNull();
  });

  it('removes the record on session end', async () => {
    const store = new MemoryStore();
    await saveBaseline(store, 'ses_1', record);
    await clearBaseline(store, 'ses_1');
    expect(await loadBaseline(store, 'ses_1')).toBeNull();
    expect(store.data.has(baselineKey('ses_1'))).toBe(false);
  });

  it('ignores a baseline stored under an older key scheme', async () => {
    const store = new MemoryStore();
    // pre-M3a key scheme: baseline keys changed, so diffing against this record
    // would report every edge as newly added; it must be treated as absent
    await store.set('baseline/ses_1', record);
    expect(await loadBaseline(store, 'ses_1')).toBeNull();
  });

  it('propagates store failures (the loop degrades, it does not hang)', async () => {
    const broken: BaselineStore = {
      get: async () => {
        throw new Error('storage offline');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    await expect(loadBaseline(broken, 'ses_1')).rejects.toThrow('storage offline');
  });
});

describe('isBaselineRecord', () => {
  it.each([
    ['null', null],
    ['a string', 'baseline'],
    ['an empty object', {}],
    ['a missing keys array', { at: 'x', count: 0 }],
    ['non-string keys', { at: 'x', count: 1, keys: [1] }],
    ['a count that disagrees with keys', { at: 'x', count: 3, keys: ['a'] }],
    ['a negative count', { at: 'x', count: -1, keys: [] }],
    ['a fractional count', { at: 'x', count: 1.5, keys: ['a'] }],
    ['an array', [record]],
  ])('rejects %s', (_label, value) => {
    expect(isBaselineRecord(value)).toBe(false);
  });

  it('accepts a well-formed record, including an empty baseline', () => {
    expect(isBaselineRecord(record)).toBe(true);
    expect(isBaselineRecord({ at: 'x', count: 0, keys: [] })).toBe(true);
  });

  it('turns a malformed stored value into "no baseline"', async () => {
    const store = new MemoryStore();
    store.data.set(baselineKey('ses_1'), { at: 'x', count: 1, keys: 'not-an-array' });
    expect(await loadBaseline(store, 'ses_1')).toBeNull();
  });
});
