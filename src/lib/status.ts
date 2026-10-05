import { resolveSrv } from 'node:dns/promises';
import { pingServer } from './slp';

export type PublicStatus = {
  online: boolean;
  players?: { online: number; max: number };
  version?: string;
  motd?: string;
};

type SrvRecord = { name: string; port: number; priority: number; weight: number };
export type SrvLookup = (name: string) => Promise<SrvRecord[]>;
export type Deps = {
  lookup: SrvLookup;
  ping: (host: string, port: number, timeoutMs: number) => Promise<unknown>;
};

const DEFAULT_PORT = 25565;
const defaultDeps: Deps = { lookup: resolveSrv, ping: pingServer };

export function stripFormatting(s: string): string {
  return s.replace(/§[0-9a-fk-orx]/gi, '');
}

export function motdText(description: unknown): string {
  if (typeof description === 'string') return stripFormatting(description);
  if (!description || typeof description !== 'object') return '';
  const d = description as { text?: unknown; extra?: unknown };
  let out = typeof d.text === 'string' ? stripFormatting(d.text) : '';
  if (Array.isArray(d.extra)) out += d.extra.map(motdText).join('');
  return out;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Builds the response from an allow-list of fields. Nothing else from the raw
// reply (player sample, favicon, mod list) is ever copied.
export function toPublicStatus(raw: unknown): PublicStatus {
  const out: PublicStatus = { online: true };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { players?: { online?: unknown; max?: unknown }; version?: { name?: unknown }; description?: unknown };
  if (r.players && isCount(r.players.online) && isCount(r.players.max)) {
    out.players = { online: r.players.online, max: r.players.max };
  }
  if (r.version && typeof r.version.name === 'string') out.version = stripFormatting(r.version.name).slice(0, 64);
  const motd = motdText(r.description).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (motd) out.motd = motd;
  return out;
}

export async function resolveTarget(address: string, lookup: SrvLookup = resolveSrv): Promise<{ host: string; port: number }> {
  try {
    const records = await lookup(`_minecraft._tcp.${address}`);
    if (records.length > 0) {
      const best = [...records].sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0];
      return { host: best.name, port: best.port };
    }
  } catch {
    // No SRV record: the vanilla client falls back to the A record and the default port.
  }
  return { host: address, port: DEFAULT_PORT };
}

async function checkOne(address: string, timeoutMs: number, deps: Deps): Promise<PublicStatus> {
  try {
    const { host, port } = await resolveTarget(address, deps.lookup);
    return toPublicStatus(await deps.ping(host, port, timeoutMs));
  } catch {
    return { online: false };
  }
}

export async function checkAll(
  servers: { id: string; address: string }[],
  timeoutMs: number,
  deps: Deps = defaultDeps,
): Promise<Record<string, PublicStatus>> {
  const results = await Promise.all(servers.map((s) => checkOne(s.address, timeoutMs, deps)));
  return Object.fromEntries(servers.map((s, i) => [s.id, results[i]]));
}
