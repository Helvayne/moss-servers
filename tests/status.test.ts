import { describe, expect, it } from 'vitest';
import { stripFormatting, motdText, toPublicStatus, resolveTarget, checkAll, cacheControl } from '../src/lib/status';

describe('formatting', () => {
  it('strips section-sign codes', () => {
    expect(stripFormatting('§f§lMoss §aVanilla§r')).toBe('Moss Vanilla');
  });
  it('flattens chat components', () => {
    expect(motdText({ text: 'A', extra: [{ text: 'B', extra: [{ text: '§cC' }] }, 'D'] })).toBe('ABCD');
    expect(motdText('plain')).toBe('plain');
    expect(motdText(undefined)).toBe('');
  });
});

describe('toPublicStatus', () => {
  const raw = {
    version: { name: 'Paper 1.21.11', protocol: 774 },
    players: { online: 2, max: 20, sample: [{ name: 'SecretPlayer', id: '00000000-0000-0000-0000-000000000000' }] },
    description: { text: '§aHello' },
    favicon: 'data:image/png;base64,AAAA',
    modinfo: { modList: [] },
  };
  it('keeps only public fields', () => {
    expect(toPublicStatus(raw)).toEqual({
      online: true, players: { online: 2, max: 20 }, version: 'Paper 1.21.11', motd: 'Hello',
    });
  });
  it('never includes player names', () => {
    const out = JSON.stringify(toPublicStatus(raw));
    expect(out).not.toContain('SecretPlayer');
    expect(out).not.toContain('sample');
    expect(out).not.toContain('favicon');
  });
  it('tolerates junk', () => {
    expect(toPublicStatus(null)).toEqual({ online: true });
    expect(toPublicStatus({ players: { online: 'x' } })).toEqual({ online: true });
  });
});

describe('resolveTarget', () => {
  it('uses the SRV record when present', async () => {
    const lookup = async () => [{ name: 'home.example.org', port: 26000, priority: 0, weight: 0 }];
    await expect(resolveTarget('mc.example.org', lookup)).resolves.toEqual({ host: 'home.example.org', port: 26000 });
  });
  it('falls back to the default port without SRV', async () => {
    const lookup = async () => { throw Object.assign(new Error('nodata'), { code: 'ENODATA' }); };
    await expect(resolveTarget('mc.example.org', lookup)).resolves.toEqual({ host: 'mc.example.org', port: 25565 });
  });
  it('picks the lowest priority record', async () => {
    const lookup = async () => [
      { name: 'b.example.org', port: 2, priority: 10, weight: 0 },
      { name: 'a.example.org', port: 1, priority: 0, weight: 0 },
    ];
    await expect(resolveTarget('x.example.org', lookup)).resolves.toEqual({ host: 'a.example.org', port: 1 });
  });
});

describe('checkAll', () => {
  it('reports online and offline servers independently', async () => {
    const deps = {
      lookup: async () => { throw new Error('no srv'); },
      ping: async (host: string) => {
        if (host === 'up.example.org') return { players: { online: 1, max: 5, sample: [{ name: 'Hidden' }] } };
        throw new Error('timeout');
      },
    };
    const out = await checkAll(
      [{ id: 'up', address: 'up.example.org' }, { id: 'down', address: 'down.example.org' }], 100, deps,
    );
    expect(out).toEqual({ up: { online: true, players: { online: 1, max: 5 } }, down: { online: false } });
    expect(JSON.stringify(out)).not.toContain('Hidden');
  });
});

describe('cacheControl', () => {
  it('caches for 60 s when everything answered', () => {
    expect(cacheControl({ a: { online: true } })).toBe('public, s-maxage=60, stale-while-revalidate=30');
  });
  it('caches briefly when a server looked offline, so a dropped ping clears quickly', () => {
    expect(cacheControl({ a: { online: true }, b: { online: false } })).toBe('public, s-maxage=20, stale-while-revalidate=10');
  });
});
