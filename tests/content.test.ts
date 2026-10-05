import { describe, expect, it } from 'vitest';
import { checkReferences, byDateDesc } from '../src/lib/content';

describe('checkReferences', () => {
  it('passes when every slug exists', () => {
    expect(() => checkReferences(['a', 'b'], ['a'], ['b', 'a'])).not.toThrow();
  });
  it('names every unknown slug', () => {
    expect(() => checkReferences(['a'], ['zz'], ['yy'])).toThrow(/zz.*yy|yy.*zz/s);
  });
});

describe('byDateDesc', () => {
  it('sorts newest first', () => {
    const items = [{ data: { date: new Date('2026-01-01') } }, { data: { date: new Date('2026-03-01') } }];
    expect(items.sort(byDateDesc)[0].data.date.toISOString()).toContain('2026-03-01');
  });
});
