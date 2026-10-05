import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate } from '../src/lib/format';
import { md, mdInline } from '../src/lib/markdown';

describe('format', () => {
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(61_071_146)).toBe('61 MB');
    expect(formatBytes(613_117_295)).toBe('613 MB');
    expect(formatBytes(1_500_000_000)).toBe('1.5 GB');
  });
  it('formats dates in UTC', () => {
    expect(formatDate(new Date('2026-09-17T00:00:00Z'))).toBe('17 Sep 2026');
  });
  it('renders markdown', () => {
    expect(mdInline('**hi**')).toBe('<strong>hi</strong>');
    expect(md('a\n\n- b')).toContain('<li>b</li>');
  });
});
