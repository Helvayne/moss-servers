export type Asset = { name: string; size: number; url: string };
export type PackRelease = { tag: string; version: string; publishedAt: string; url: string; assets: Record<string, Asset> };
export type ReleasesFile = { packs: Record<string, PackRelease> };
export type DownloadSpec = { variant: string; label: string; note?: string };
export type DownloadItem = DownloadSpec & { asset: Asset };
export type Downloads =
  | { state: 'none' }
  | { state: 'missing-release' }
  | { state: 'ok'; version: string; tag: string; publishedAt: string; url: string; items: DownloadItem[] };

export function resolveDownloads(
  serverId: string,
  pack: string | undefined,
  downloads: DownloadSpec[],
  releases: ReleasesFile,
): Downloads {
  if (!pack || downloads.length === 0) return { state: 'none' };
  const release = releases.packs[pack];
  if (!release) return { state: 'missing-release' };
  const missing = downloads.filter((d) => !release.assets[d.variant]).map((d) => d.variant);
  if (missing.length > 0) {
    throw new Error(
      `servers/${serverId}: release ${release.tag} has no asset for variant(s) ${missing.join(', ')}. ` +
        `Expected files named ${pack}-${release.version}-<variant>.mrpack.`,
    );
  }
  return {
    state: 'ok',
    version: release.version,
    tag: release.tag,
    publishedAt: release.publishedAt,
    url: release.url,
    items: downloads.map((d) => ({ ...d, asset: release.assets[d.variant] })),
  };
}

export type DownloadGroupSpec = { title: string; intro?: string; highlight?: boolean; variants: string[] };
export type DownloadGroup = { title?: string; intro?: string; highlight: boolean; items: DownloadItem[] };

// Arrange download items into the server file's groups, in that order. Variants no group
// mentions go into a trailing untitled group so nothing silently disappears.
export function groupDownloads(items: DownloadItem[], groups: DownloadGroupSpec[]): DownloadGroup[] {
  const used = new Set<string>();
  const out: DownloadGroup[] = groups.map((g) => {
    const groupItems = g.variants.flatMap((v) => items.filter((i) => i.variant === v));
    groupItems.forEach((i) => used.add(i.variant));
    return { title: g.title, intro: g.intro, highlight: g.highlight ?? false, items: groupItems };
  });
  const rest = items.filter((i) => !used.has(i.variant));
  if (rest.length > 0) out.push({ title: undefined, intro: undefined, highlight: false, items: rest });
  return out.filter((g) => g.items.length > 0);
}
