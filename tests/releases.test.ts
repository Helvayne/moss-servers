import { describe, expect, it } from 'vitest';
import { resolveDownloads, groupDownloads, type ReleasesFile } from '../src/lib/releases';

const releases: ReleasesFile = {
  packs: {
    cogsandcurses: {
      tag: 'cogsandcurses-v3.0.0', version: '3.0.0', publishedAt: '2026-10-06T00:00:00Z',
      url: 'https://github.com/o/r/releases/tag/cogsandcurses-v3.0.0',
      assets: {
        full: { name: 'cogsandcurses-3.0.0-full.mrpack', size: 10, url: 'https://x/full' },
        lite: { name: 'cogsandcurses-3.0.0-lite.mrpack', size: 5, url: 'https://x/lite' },
      },
    },
  },
};
const downloads = [{ variant: 'full', label: 'Full', note: 'Read me' }, { variant: 'lite', label: 'Lite' }];

describe('resolveDownloads', () => {
  it('returns none when the server has no pack', () => {
    expect(resolveDownloads('vanilla', undefined, [], releases)).toEqual({ state: 'none' });
  });
  it('returns missing-release when the pack has no release yet', () => {
    expect(resolveDownloads('x', 'otherpack', downloads, releases)).toEqual({ state: 'missing-release' });
  });
  it('maps variants to assets in the order of the server file', () => {
    const r = resolveDownloads('cnc', 'cogsandcurses', downloads, releases);
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') return;
    expect(r.version).toBe('3.0.0');
    expect(r.items.map((i) => [i.variant, i.label, i.note, i.asset.url])).toEqual([
      ['full', 'Full', 'Read me', 'https://x/full'],
      ['lite', 'Lite', undefined, 'https://x/lite'],
    ]);
  });
  it('throws when the release lacks a listed variant', () => {
    expect(() => resolveDownloads('cnc', 'cogsandcurses', [{ variant: 'shaders', label: 'S' }], releases))
      .toThrow(/shaders/);
  });
});

describe('groupDownloads', () => {
  const asset = { name: 'x', size: 1, url: 'u' };
  const items = [
    { variant: 'full', label: 'Full', asset },
    { variant: 'lite', label: 'Lite', asset },
    { variant: 'update', label: 'Update', asset },
  ];
  it('orders groups and items as configured', () => {
    const groups = groupDownloads(items, [
      { title: 'Existing players', highlight: true, variants: ['update'] },
      { title: 'New players', variants: ['full', 'lite'] },
    ]);
    expect(groups.map((g) => [g.title, g.highlight, g.items.map((i) => i.variant)])).toEqual([
      ['Existing players', true, ['update']],
      ['New players', false, ['full', 'lite']],
    ]);
  });
  it('puts everything in one untitled group when no groups are configured', () => {
    expect(groupDownloads(items, [])).toEqual([{ title: undefined, intro: undefined, highlight: false, items }]);
  });
  it('appends variants no group mentions', () => {
    const groups = groupDownloads(items, [{ title: 'Update', variants: ['update'] }]);
    expect(groups.map((g) => g.items.map((i) => i.variant))).toEqual([['update'], ['full', 'lite']]);
  });
});
