export function checkReferences(serverIds: string[], changelogServers: string[], newsServers: string[]): void {
  const known = new Set(serverIds);
  const unknown = [...new Set([...changelogServers, ...newsServers])].filter((s) => !known.has(s));
  if (unknown.length > 0) {
    throw new Error(`Unknown server slug(s) in changelog/news: ${unknown.join(', ')}. Known: ${serverIds.join(', ')}`);
  }
}

export function byDateDesc<T extends { data: { date: Date } }>(a: T, b: T): number {
  return b.data.date.getTime() - a.data.date.getTime();
}
