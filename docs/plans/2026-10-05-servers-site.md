# servers.justinhere.net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the public single-page game-server homepage described in the spec: server cards with live status, join steps, pack downloads with notes, changelogs, news, and a pack-preparation script.

**Architecture:** Astro 7 static site with one on-demand Vercel function (`/api/status`) that pings Minecraft servers with the Server List Ping protocol. Content is Markdown in `src/content/` validated by zod schemas. Pack releases live on GitHub Releases; a GitHub Action writes their metadata to `src/data/releases.json` and commits it, which triggers the Vercel rebuild. Python stdlib scripts handle pack sanitising, release syncing, and the privacy guard.

**Tech Stack:** Node 22, Astro 7.3, @astrojs/vercel 11, zod 4 (via `astro/zod`), marked 18, Vitest 5, TypeScript 6, Python 3.12+ (stdlib only), GitHub Actions (checkout/setup-node/setup-python v7).

**Spec:** `docs/specs/2026-10-05-servers-site-design.md`

## Global Constraints

- Repo is public: no IP addresses, port numbers, player names, or old dynamic-DNS hostnames anywhere in tracked files.
- Player names are never fetched into the page, stored, or published; `players.sample` is discarded inside the function.
- `address` values are hostnames only, never an IP, never a port.
- `noindex` on by default (meta tag + `robots.txt`), one config flag.
- Status cache header: `public, s-maxage=60, stale-while-revalidate=30`; ping timeout 3 s per server.
- Pack tags `<pack>-v<version>`; assets `<pack>-<version>-<variant>.mrpack`.
- Python scripts use the standard library only.
- Everything works with JavaScript disabled except live status, copy buttons and deep-link scrolling.

## Deviations from the spec (decided while planning; Task 1 updates the spec)

1. **Release metadata is committed, not fetched at build.** Vercel build machines share IPs, so unauthenticated GitHub API calls at build time can hit the 60/hour limit and fail deploys. Instead `.github/workflows/release-sync.yml` runs on release events with the built-in `GITHUB_TOKEN`, writes `src/data/releases.json`, and commits it; that push triggers Vercel. This removes the `VERCEL_DEPLOY_HOOK` secret. A pack with no release yet shows "No download yet" instead of failing the build; a release that lacks a variant listed in `downloads` fails the build.
2. **Banner is `src/content/banner/banner.md`** (frontmatter `enabled`, Markdown body) instead of `banner.yaml`, so every editable file is Markdown.
3. **`address` is optional** in server files (Hytale has no public address yet). `status: live` requires an address.

## File map

| Path | Responsibility |
|---|---|
| `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Tooling |
| `src/site.config.ts` | Site name, tagline, `noindex` flag, repo slug |
| `src/content.config.ts` | Collections + zod schemas |
| `src/content/servers/*.md`, `changelog/<slug>/*.md`, `news/*.md`, `banner/banner.md` | Content |
| `src/data/releases.json` | Generated release metadata (committed by CI) |
| `src/lib/slp.ts` | Server List Ping protocol (VarInt, packets, socket) |
| `src/lib/status.ts` | SRV resolution, public-field filtering, check all servers |
| `src/lib/releases.ts` | Map server `downloads` to release assets |
| `src/lib/content.ts` | Cross-collection validation + sorting helpers |
| `src/lib/markdown.ts` | Render Markdown strings from frontmatter |
| `src/lib/format.ts` | Byte sizes and dates |
| `src/pages/index.astro` | The page |
| `src/pages/api/status.ts` | Status function |
| `src/pages/robots.txt.ts` | robots.txt from the `noindex` flag |
| `src/layouts/Layout.astro`, `src/styles/global.css` | Shell + styles |
| `src/components/{Banner,ServerCard,Downloads,Changelog,News}.astro` | UI pieces |
| `src/scripts/client.ts` | Status polling, copy buttons, deep links |
| `scripts/prepare_pack.py` | Sanitise `.mrpack` exports |
| `scripts/sync_releases.py` | Build `releases.json` from the GitHub API |
| `scripts/privacy_check.py` | CI privacy guard |
| `scripts/tests/test_*.py` | Python tests |
| `tests/*.test.ts` | Vitest tests |
| `.github/workflows/ci.yml`, `release-sync.yml` | CI |
| `README.md` | How to edit content and publish packs |

---

### Task 1: Scaffold, config, layout shell

**Files:**
- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/site.config.ts`, `src/layouts/Layout.astro`, `src/styles/global.css`, `src/pages/index.astro` (placeholder), `src/pages/robots.txt.ts`, `src/data/releases.json`
- Modify: `docs/specs/2026-10-05-servers-site-design.md` (record the three deviations above)

**Interfaces:**
- Produces: `site` object `{ name: string; tagline: string; noindex: boolean; repo: string; url: string }` from `src/site.config.ts`; `Layout.astro` with props `{ title?: string }` and a default slot.

- [ ] **Step 1: Write tooling files**

`package.json`:
```json
{
  "name": "moss-servers",
  "type": "module",
  "private": true,
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "check": "astro check",
    "test": "vitest run",
    "test:py": "python -m unittest discover -s scripts/tests -v"
  },
  "dependencies": {
    "@astrojs/vercel": "^11.0.11",
    "astro": "^7.3.5",
    "marked": "^18.1.0"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.10",
    "@types/node": "^22.0.0",
    "typescript": "^6.0.0",
    "vitest": "^5.0.3"
  }
}
```

`astro.config.mjs`:
```js
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://servers.justinhere.net',
  output: 'static',
  adapter: vercel(),
});
```

`tsconfig.json`:
```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist", ".vercel"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

`.gitignore`:
```
node_modules/
dist/
.vercel/
.astro/
dist/packs/
__pycache__/
*.mrpack
.env
```

`src/data/releases.json`:
```json
{ "packs": {} }
```

`src/site.config.ts`:
```ts
export const site = {
  name: 'Moss Servers',
  tagline: 'Our game servers: what is running, how to join, and what changed.',
  noindex: true,
  repo: 'Helvayne/moss-servers',
  url: 'https://servers.justinhere.net',
};
```

- [ ] **Step 2: Layout, styles, robots, placeholder page**

`src/pages/robots.txt.ts`:
```ts
import type { APIRoute } from 'astro';
import { site } from '../site.config';

export const GET: APIRoute = () =>
  new Response(site.noindex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n', {
    headers: { 'content-type': 'text/plain' },
  });
```

`src/layouts/Layout.astro`:
```astro
---
import '../styles/global.css';
import { site } from '../site.config';
interface Props { title?: string }
const { title = site.name } = Astro.props;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={site.tagline} />
    {site.noindex && <meta name="robots" content="noindex, nofollow" />}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <title>{title}</title>
  </head>
  <body>
    <slot />
  </body>
</html>
```

`public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#3f7d4e"/><path d="M8 22V10l8 7 8-7v12" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>
```

`src/styles/global.css`: theme tokens on `:root`, dark overrides under `@media (prefers-color-scheme: dark)`; base typography; `.wrap { max-width: 860px; margin: 0 auto; padding: 0 16px }`. (Full stylesheet is written in Task 6 alongside the components that use it; this step only needs tokens and base rules.)
```css
:root {
  --bg: #f6f7f4; --surface: #ffffff; --surface-2: #eef1ec; --text: #1c211d; --muted: #5d665f;
  --border: #d9ded8; --accent: #3f7d4e; --accent-text: #ffffff;
  --ok: #2f9e55; --bad: #c8463d; --idle: #9aa39c; --note-bg: #fff6dc; --note-border: #e6c25a;
  --radius: 12px; --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121512; --surface: #1a1f1b; --surface-2: #222923; --text: #e6ebe6; --muted: #9aa59c;
    --border: #2f3830; --accent: #6fbf83; --accent-text: #0e130f;
    --ok: #4cc777; --bad: #e0675d; --idle: #6c756d; --note-bg: #2b2716; --note-border: #8a7330;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 var(--font); }
a { color: var(--accent); }
code { font-size: 0.92em; background: var(--surface-2); padding: 0.1em 0.35em; border-radius: 5px; }
.wrap { max-width: 860px; margin: 0 auto; padding: 0 16px; }
```

`src/pages/index.astro` (placeholder, replaced in Task 6):
```astro
---
import Layout from '../layouts/Layout.astro';
import { site } from '../site.config';
---
<Layout><main class="wrap"><h1>{site.name}</h1></main></Layout>
```

- [ ] **Step 3: Install and build**

Run: `npm install && npm run build`
Expected: build completes; `.vercel/output/static/index.html` exists and contains `noindex`.

- [ ] **Step 4: Update the spec with the three deviations, commit**

```bash
git add -A
git commit -m "chore: scaffold Astro site with Vercel adapter"
```

---

### Task 2: Server List Ping protocol (`src/lib/slp.ts`)

**Files:**
- Create: `src/lib/slp.ts`
- Test: `tests/slp.test.ts`

**Interfaces:**
- Produces:
  - `encodeVarInt(value: number): Buffer`
  - `decodeVarInt(buf: Buffer, offset?: number): { value: number; size: number } | null` (null = incomplete)
  - `handshakePacket(host: string, port: number, protocol?: number): Buffer`
  - `STATUS_REQUEST: Buffer`
  - `parseStatusResponse(buf: Buffer): string | null` (null = incomplete; throws on wrong packet id)
  - `pingServer(host: string, port: number, timeoutMs: number): Promise<unknown>` (resolves parsed JSON; rejects on timeout/close/error)

- [ ] **Step 1: Write the failing tests**

`tests/slp.test.ts`:
```ts
import { describe, expect, it, afterEach } from 'vitest';
import net from 'node:net';
import {
  encodeVarInt, decodeVarInt, handshakePacket, STATUS_REQUEST, parseStatusResponse, pingServer,
} from '../src/lib/slp';

function frame(id: number, payload: Buffer) {
  const body = Buffer.concat([encodeVarInt(id), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}
function statusPacket(json: string) {
  const s = Buffer.from(json, 'utf8');
  return frame(0, Buffer.concat([encodeVarInt(s.length), s]));
}

describe('VarInt', () => {
  it.each([0, 1, 127, 128, 255, 25565, 2097151, 2147483647, -1])('round-trips %i', (n) => {
    const enc = encodeVarInt(n);
    expect(decodeVarInt(enc)).toEqual({ value: n, size: enc.length });
  });
  it('encodes known values', () => {
    expect([...encodeVarInt(300)]).toEqual([0xac, 0x02]);
    expect([...encodeVarInt(-1)]).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f]);
  });
  it('returns null when incomplete', () => {
    expect(decodeVarInt(Buffer.from([0x80]))).toBeNull();
  });
  it('throws when longer than 5 bytes', () => {
    expect(() => decodeVarInt(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]))).toThrow();
  });
});

describe('packets', () => {
  it('builds a handshake for the status state', () => {
    const p = handshakePacket('a.b', 25565);
    const len = decodeVarInt(p)!;
    expect(p.length).toBe(len.size + len.value);
    expect(p[len.size]).toBe(0x00);           // packet id
    expect(p.subarray(-3, -1).readUInt16BE()).toBe(25565);
    expect(p[p.length - 1]).toBe(0x01);        // next state = status
  });
  it('status request is an empty packet 0x00', () => {
    expect([...STATUS_REQUEST]).toEqual([0x01, 0x00]);
  });
  it('parses a complete status response', () => {
    expect(parseStatusResponse(statusPacket('{"a":1}'))).toBe('{"a":1}');
  });
  it('returns null for a partial response', () => {
    const full = statusPacket('{"a":1}');
    expect(parseStatusResponse(full.subarray(0, full.length - 2))).toBeNull();
  });
  it('throws on an unexpected packet id', () => {
    expect(() => parseStatusResponse(frame(5, Buffer.alloc(1)))).toThrow(/packet id/);
  });
});

describe('pingServer', () => {
  let server: net.Server | undefined;
  afterEach(() => server?.close());

  function listen(onConn: (s: net.Socket) => void): Promise<number> {
    return new Promise((resolve) => {
      server = net.createServer(onConn);
      server.listen(0, '127.0.0.1', () => resolve((server!.address() as net.AddressInfo).port));
    });
  }

  it('resolves the JSON from a server that answers in two chunks', async () => {
    const port = await listen((s) => {
      s.once('data', () => {
        const pkt = statusPacket('{"version":{"name":"1.21.1"}}');
        s.write(pkt.subarray(0, 4));
        setTimeout(() => s.write(pkt.subarray(4)), 20);
      });
    });
    await expect(pingServer('127.0.0.1', port, 1000)).resolves.toEqual({ version: { name: '1.21.1' } });
  });

  it('rejects on timeout when the server never answers', async () => {
    const port = await listen(() => {});
    await expect(pingServer('127.0.0.1', port, 200)).rejects.toThrow(/timeout/);
  });

  it('rejects when the connection is refused', async () => {
    const port = await listen(() => {});
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await expect(pingServer('127.0.0.1', port, 1000)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/slp.test.ts`
Expected: FAIL, cannot resolve `../src/lib/slp`.

- [ ] **Step 3: Implement**

`src/lib/slp.ts`:
```ts
import net from 'node:net';

const MAX_RESPONSE_BYTES = 1024 * 1024;

export function encodeVarInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

export function decodeVarInt(buf: Buffer, offset = 0): { value: number; size: number } | null {
  let value = 0;
  let size = 0;
  let b: number;
  do {
    if (size >= 5) throw new Error('VarInt too long');
    if (offset + size >= buf.length) return null;
    b = buf[offset + size];
    value |= (b & 0x7f) << (7 * size);
    size++;
  } while (b & 0x80);
  return { value: value | 0, size };
}

function packet(id: number, payload: Buffer): Buffer {
  const body = Buffer.concat([encodeVarInt(id), payload]);
  return Buffer.concat([encodeVarInt(body.length), body]);
}

function mcString(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([encodeVarInt(b.length), b]);
}

export function handshakePacket(host: string, port: number, protocol = -1): Buffer {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(port);
  return packet(0x00, Buffer.concat([encodeVarInt(protocol), mcString(host), portBuf, encodeVarInt(1)]));
}

export const STATUS_REQUEST = packet(0x00, Buffer.alloc(0));

export function parseStatusResponse(buf: Buffer): string | null {
  const len = decodeVarInt(buf, 0);
  if (!len) return null;
  if (buf.length < len.size + len.value) return null;
  let off = len.size;
  const id = decodeVarInt(buf, off);
  if (!id) return null;
  if (id.value !== 0x00) throw new Error(`unexpected packet id ${id.value}`);
  off += id.size;
  const strLen = decodeVarInt(buf, off);
  if (!strLen) return null;
  off += strLen.size;
  return buf.subarray(off, off + strLen.value).toString('utf8');
}

export function pingServer(host: string, port: number, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let data = Buffer.alloc(0);
    const socket = net.createConnection({ host, port });
    const finish = (err: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    socket.once('error', (e) => finish(e));
    socket.once('close', () => finish(new Error('connection closed')));
    socket.once('connect', () => socket.write(Buffer.concat([handshakePacket(host, port), STATUS_REQUEST])));
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > MAX_RESPONSE_BYTES) return finish(new Error('response too large'));
      try {
        const json = parseStatusResponse(data);
        if (json !== null) finish(null, JSON.parse(json));
      } catch (e) {
        finish(e as Error);
      }
    });
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/slp.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slp.ts tests/slp.test.ts
git commit -m "feat: Minecraft Server List Ping client"
```

---

### Task 3: Status checks and the `/api/status` function

**Files:**
- Create: `src/lib/status.ts`, `src/pages/api/status.ts`
- Test: `tests/status.test.ts`

**Interfaces:**
- Consumes: `pingServer(host, port, timeoutMs)` from Task 2.
- Produces:
  - `type PublicStatus = { online: boolean; players?: { online: number; max: number }; version?: string; motd?: string }`
  - `stripFormatting(s: string): string`
  - `motdText(description: unknown): string`
  - `toPublicStatus(raw: unknown): PublicStatus`
  - `resolveTarget(address: string, lookup?: SrvLookup): Promise<{ host: string; port: number }>`
  - `checkAll(servers: { id: string; address: string }[], timeoutMs: number, deps?: Deps): Promise<Record<string, PublicStatus>>`
  - HTTP: `GET /api/status` → `Record<serverId, PublicStatus>` JSON. Task 6's client script reads it.

- [ ] **Step 1: Write the failing tests**

`tests/status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { stripFormatting, motdText, toPublicStatus, resolveTarget, checkAll } from '../src/lib/status';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/status.test.ts`
Expected: FAIL, cannot resolve `../src/lib/status`.

- [ ] **Step 3: Implement `src/lib/status.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/pages/api/status.ts`**

```ts
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { checkAll } from '../../lib/status';

export const prerender = false;

const TIMEOUT_MS = 3000;

export const GET: APIRoute = async () => {
  const servers = (await getCollection('servers')).filter((s) => s.data.status === 'live' && s.data.address);
  const statuses = await checkAll(servers.map((s) => ({ id: s.id, address: s.data.address! })), TIMEOUT_MS);
  return new Response(JSON.stringify(statuses), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=30',
    },
  });
};
```
(The `servers` collection is defined in Task 4; until then `astro check` reports the missing collection. Run Step 5 tests only; the build is verified in Task 4.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/status.ts src/pages/api/status.ts tests/status.test.ts
git commit -m "feat: live status function with player-name filtering"
```

---

### Task 4: Content schemas, releases mapping, content helpers

**Files:**
- Create: `src/content.config.ts`, `src/lib/releases.ts`, `src/lib/content.ts`, `src/lib/markdown.ts`, `src/lib/format.ts`
- Create (minimal fixture content so the build runs; real content in Task 9): `src/content/servers/example.md`, `src/content/banner/banner.md`
- Test: `tests/releases.test.ts`, `tests/content.test.ts`, `tests/format.test.ts`

**Interfaces:**
- Produces:
  - Collections `servers`, `changelog`, `news`, `banner` (schemas below).
  - `type ReleasesFile = { packs: Record<string, PackRelease> }`; `type PackRelease = { tag: string; version: string; publishedAt: string; url: string; assets: Record<string, { name: string; size: number; url: string }> }`
  - `type DownloadItem = { variant: string; label: string; note?: string; asset: { name: string; size: number; url: string } }`
  - `resolveDownloads(serverId: string, pack: string | undefined, downloads: {variant: string; label: string; note?: string}[], releases: ReleasesFile): { state: 'none' } | { state: 'missing-release' } | { state: 'ok'; version: string; tag: string; publishedAt: string; url: string; items: DownloadItem[] }` (throws if the release lacks a listed variant)
  - `checkReferences(serverIds: string[], changelogServers: string[], newsServers: string[]): void` (throws listing unknown slugs)
  - `byDateDesc<T extends { data: { date: Date } }>(a: T, b: T): number`
  - `md(s: string): string`, `mdInline(s: string): string`
  - `formatBytes(n: number): string`, `formatDate(d: Date | string): string`

- [ ] **Step 1: Write the failing tests**

`tests/releases.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { resolveDownloads, type ReleasesFile } from '../src/lib/releases';

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
```

`tests/content.test.ts`:
```ts
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
```

`tests/format.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement libs**

`src/lib/releases.ts`:
```ts
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
```

`src/lib/content.ts`:
```ts
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
```

`src/lib/markdown.ts`:
```ts
import { marked } from 'marked';

// Content comes only from this repo's own Markdown files, so the HTML is trusted.
export const md = (s: string): string => marked.parse(s, { async: false }) as string;
export const mdInline = (s: string): string => marked.parseInline(s, { async: false }) as string;
```

`src/lib/format.ts`:
```ts
export function formatBytes(n: number): string {
  if (n < 1_000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1_000)} KB`;
  if (n < 1_000_000_000) return `${Math.round(n / 1_000_000)} MB`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} GB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Fixed month names: ICU output differs between runtimes (e.g. "Sept" in en-GB).
export function formatDate(d: Date | string): string {
  const date = new Date(d);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
```

- [ ] **Step 4: Content config**

`src/content.config.ts`:
```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const slug = z.string().regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes');
const hostname = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'address must be a hostname: no IP address, no port');

const servers = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/servers' }),
  schema: z
    .object({
      name: z.string(),
      order: z.number().int(),
      game: z.enum(['minecraft-java', 'hytale']),
      version: z.string(),
      address: hostname.optional(),
      status: z.enum(['live', 'on-request', 'none', 'hidden']),
      pack: slug.optional(),
      ram: z.string().optional(),
      join: z.array(z.string()).min(1),
      downloads: z.array(z.object({ variant: slug, label: z.string(), note: z.string().optional() })).default([]),
    })
    .refine((d) => d.status !== 'live' || (d.game === 'minecraft-java' && !!d.address), {
      message: 'status: live needs game: minecraft-java and an address',
    })
    .refine((d) => d.downloads.length === 0 || !!d.pack, { message: 'downloads need a pack' }),
});

const changelog = defineCollection({
  loader: glob({ pattern: '*/*.md', base: './src/content/changelog' }),
  schema: z.object({
    server: slug,
    date: z.coerce.date(),
    version: z.string().optional(),
    title: z.string().optional(),
  }),
});

const news = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    servers: z.array(slug).default([]),
  }),
});

const banner = defineCollection({
  loader: glob({ pattern: 'banner.md', base: './src/content/banner' }),
  schema: z.object({ enabled: z.boolean() }),
});

export const collections = { servers, changelog, news, banner };
```

`src/content/banner/banner.md`:
```markdown
---
enabled: false
---
C&C is down for updates until 8 pm.
```

`src/content/servers/example.md` (deleted in Task 9):
```markdown
---
name: Example
order: 99
game: minecraft-java
version: "1.21.1"
status: none
join:
  - Example step.
---
Example.
```

- [ ] **Step 5: Run tests and build**

Run: `npx vitest run && npm run build && npm run check`
Expected: tests PASS; build completes; `astro check` reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: content schemas, release mapping and helpers"
```

---

### Task 5: Release sync script and workflow

**Files:**
- Create: `scripts/sync_releases.py`, `scripts/tests/test_sync_releases.py`, `.github/workflows/release-sync.yml`

**Interfaces:**
- Consumes: GitHub REST `GET /repos/{repo}/releases`.
- Produces: `build_releases(api_releases: list[dict]) -> dict` returning the `ReleasesFile` shape from Task 4; CLI `python scripts/sync_releases.py --repo OWNER/NAME --out src/data/releases.json` (token from `GITHUB_TOKEN` env, optional).

- [ ] **Step 1: Write the failing test**

`scripts/tests/test_sync_releases.py`:
```python
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sync_releases import build_releases


def rel(tag, published, assets, draft=False, prerelease=False):
    return {
        "tag_name": tag, "published_at": published, "draft": draft, "prerelease": prerelease,
        "html_url": f"https://github.com/o/r/releases/tag/{tag}",
        "assets": [{"name": n, "size": s, "browser_download_url": f"https://dl/{n}"} for n, s in assets],
    }


class BuildReleasesTest(unittest.TestCase):
    def test_picks_newest_published_per_pack(self):
        data = [
            rel("cogsandcurses-v3.0.0", "2026-10-06T00:00:00Z",
                [("cogsandcurses-3.0.0-full.mrpack", 10), ("cogsandcurses-3.0.0-lite.mrpack", 5)]),
            rel("cogsandcurses-v2.0.0", "2026-09-01T00:00:00Z", [("cogsandcurses-2.0.0-full.mrpack", 9)]),
            rel("cogsandcurses-v4.0.0", "2026-10-07T00:00:00Z", [("cogsandcurses-4.0.0-full.mrpack", 1)], draft=True),
            rel("cogsandcurses-v3.1.0-beta", "2026-10-08T00:00:00Z", [], prerelease=True),
            rel("other-v1.0.0", "2026-01-01T00:00:00Z", [("other-1.0.0-full.mrpack", 3)]),
            rel("not-a-pack-tag", "2026-01-01T00:00:00Z", []),
        ]
        out = build_releases(data)
        self.assertEqual(sorted(out["packs"]), ["cogsandcurses", "other"])
        cnc = out["packs"]["cogsandcurses"]
        self.assertEqual(cnc["version"], "3.0.0")
        self.assertEqual(cnc["tag"], "cogsandcurses-v3.0.0")
        self.assertEqual(cnc["assets"]["full"], {"name": "cogsandcurses-3.0.0-full.mrpack", "size": 10,
                                                 "url": "https://dl/cogsandcurses-3.0.0-full.mrpack"})
        self.assertEqual(sorted(cnc["assets"]), ["full", "lite"])

    def test_ignores_assets_with_other_names(self):
        out = build_releases([rel("p-v1.0.0", "2026-01-01T00:00:00Z", [("notes.txt", 1), ("p-1.0.0-full.mrpack", 2)])])
        self.assertEqual(list(out["packs"]["p"]["assets"]), ["full"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m unittest discover -s scripts/tests -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'sync_releases'`.

- [ ] **Step 3: Implement `scripts/sync_releases.py`**

```python
#!/usr/bin/env python3
"""Write src/data/releases.json from this repo's GitHub releases.

Picks, per pack, the newest published release (not draft, not prerelease) whose tag is
<pack>-v<version>, and maps its <pack>-<version>-<variant>.mrpack assets to variants.
Usage: python scripts/sync_releases.py --repo OWNER/NAME --out src/data/releases.json
Reads an optional GITHUB_TOKEN from the environment.
"""
import argparse, json, os, re, sys, urllib.request

TAG_RE = re.compile(r"^(?P<pack>[a-z0-9-]+?)-v(?P<version>\d+\.\d+\.\d+)$")


def build_releases(api_releases):
    packs = {}
    for r in api_releases:
        if r.get("draft") or r.get("prerelease"):
            continue
        m = TAG_RE.match(r.get("tag_name", ""))
        if not m:
            continue
        pack, version = m["pack"], m["version"]
        current = packs.get(pack)
        if current and current["publishedAt"] >= r["published_at"]:
            continue
        asset_re = re.compile(rf"^{re.escape(pack)}-{re.escape(version)}-(?P<variant>[a-z0-9-]+)\.mrpack$")
        assets = {}
        for a in r.get("assets", []):
            am = asset_re.match(a["name"])
            if am:
                assets[am["variant"]] = {"name": a["name"], "size": a["size"], "url": a["browser_download_url"]}
        packs[pack] = {
            "tag": r["tag_name"], "version": version, "publishedAt": r["published_at"],
            "url": r["html_url"], "assets": dict(sorted(assets.items())),
        }
    return {"packs": dict(sorted(packs.items()))}


def fetch_releases(repo, token):
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    out, page = [], 1
    while True:
        req = urllib.request.Request(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}",
                                     headers=headers)
        with urllib.request.urlopen(req, timeout=30) as resp:
            batch = json.load(resp)
        out.extend(batch)
        if len(batch) < 100:
            return out
        page += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    data = build_releases(fetch_releases(args.repo, os.environ.get("GITHUB_TOKEN")))
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print(f"wrote {args.out}: " + (", ".join(f"{p} {v['version']}" for p, v in data["packs"].items()) or "no packs"))


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m unittest discover -s scripts/tests -v`
Expected: PASS.

- [ ] **Step 5: Workflow `.github/workflows/release-sync.yml`**

```yaml
name: Sync pack releases
on:
  release:
    types: [published, edited, unpublished, deleted]
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: release-sync
  cancel-in-progress: false
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: main
      - uses: actions/setup-python@v7
        with:
          python-version: '3.12'
      - name: Write src/data/releases.json
        run: python scripts/sync_releases.py --repo "${{ github.repository }}" --out src/data/releases.json
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Commit if changed
        run: |
          if git diff --quiet -- src/data/releases.json; then echo "No change"; exit 0; fi
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add src/data/releases.json
          git commit -m "chore: sync pack releases"
          git push origin HEAD:main
```

- [ ] **Step 6: Commit**

```bash
git add scripts/sync_releases.py scripts/tests/test_sync_releases.py .github/workflows/release-sync.yml
git commit -m "feat: sync pack release metadata from GitHub releases"
```

---

### Task 6: The page (components, styles, client script)

**Files:**
- Create: `src/components/Banner.astro`, `ServerCard.astro`, `Downloads.astro`, `Changelog.astro`, `News.astro`, `src/scripts/client.ts`
- Modify: `src/pages/index.astro` (replace placeholder), `src/styles/global.css` (append component styles)

**Interfaces:**
- Consumes: collections from Task 4; `resolveDownloads`, `checkReferences`, `byDateDesc`, `md`, `mdInline`, `formatBytes`, `formatDate`; `/api/status` response shape from Task 3; `releases.json`.
- Produces: DOM contract used by `client.ts`:
  - Card: `<details class="card" id="{slug}">`; status element `<span class="status" data-status-for="{slug}" data-state="checking|online|offline|on-request">` containing `<span class="status-text">`.
  - Sections: `<details class="section" id="{slug}-{about|join|downloads|changelog}">`.
  - Copy button: `<button class="copy" type="button" data-copy="{address}">`.

- [ ] **Step 1: Components**

`src/components/Banner.astro`:
```astro
---
import { getCollection, render } from 'astro:content';
const entry = (await getCollection('banner'))[0];
const show = entry?.data.enabled;
const Content = show ? (await render(entry)).Content : null;
---
{show && Content && (
  <div class="banner" role="status"><div class="wrap"><Content /></div></div>
)}
```

`src/components/Downloads.astro`:
```astro
---
import type { Downloads } from '../lib/releases';
import { md } from '../lib/markdown';
import { formatBytes, formatDate } from '../lib/format';
import { site } from '../site.config';
interface Props { downloads: Downloads }
const { downloads } = Astro.props;
---
{downloads.state === 'missing-release' && <p class="muted">No download yet. Check back soon.</p>}
{downloads.state === 'ok' && (
  <div class="downloads">
    <p class="muted">Version <strong>{downloads.version}</strong>, released {formatDate(downloads.publishedAt)}.</p>
    {downloads.items.map((item) => (
      <div class="download">
        {item.note && <div class="note" set:html={md(item.note)} />}
        <a class="button" href={item.asset.url} download>
          Download {item.label} <span class="size">{formatBytes(item.asset.size)}</span>
        </a>
      </div>
    ))}
    <p class="muted small"><a href={`https://github.com/${site.repo}/releases`}>Older versions</a></p>
  </div>
)}
```

`src/components/Changelog.astro`:
```astro
---
import { render, type CollectionEntry } from 'astro:content';
import { formatDate } from '../lib/format';
interface Props { entries: CollectionEntry<'changelog'>[] }
const SHOWN = 3;
const rendered = await Promise.all(Astro.props.entries.map(async (e) => ({ e, ...(await render(e)) })));
const recent = rendered.slice(0, SHOWN);
const older = rendered.slice(SHOWN);
---
{rendered.length === 0 && <p class="muted">No changes recorded yet.</p>}
<ol class="changelog">
  {recent.map(({ e, Content }) => (
    <li>
      <p class="entry-head"><time datetime={e.data.date.toISOString()}>{formatDate(e.data.date)}</time>{e.data.version && <span class="tag">v{e.data.version}</span>}{e.data.title && <strong>{e.data.title}</strong>}</p>
      <Content />
    </li>
  ))}
</ol>
{older.length > 0 && (
  <details class="older">
    <summary>Show older ({older.length})</summary>
    <ol class="changelog">
      {older.map(({ e, Content }) => (
        <li>
          <p class="entry-head"><time datetime={e.data.date.toISOString()}>{formatDate(e.data.date)}</time>{e.data.version && <span class="tag">v{e.data.version}</span>}{e.data.title && <strong>{e.data.title}</strong>}</p>
          <Content />
        </li>
      ))}
    </ol>
  </details>
)}
```

`src/components/ServerCard.astro`:
```astro
---
import type { CollectionEntry } from 'astro:content';
import { render } from 'astro:content';
import type { Downloads as DownloadsData } from '../lib/releases';
import { mdInline } from '../lib/markdown';
import Downloads from './Downloads.astro';
import Changelog from './Changelog.astro';
interface Props {
  server: CollectionEntry<'servers'>;
  downloads: DownloadsData;
  changelog: CollectionEntry<'changelog'>[];
}
const { server, downloads, changelog } = Astro.props;
const { id } = server;
const d = server.data;
const { Content } = await render(server);
const gameLabel = d.game === 'hytale' ? 'Hytale' : 'Minecraft Java';
const initialState = d.status === 'live' ? 'checking' : d.status === 'on-request' ? 'on-request' : null;
const initialText = { checking: 'Checking…', 'on-request': 'On request' } as const;
---
<details class="card" id={id}>
  <summary>
    <span class="card-main">
      <span class="card-title">{d.name}</span>
      <span class="card-meta">{gameLabel} · {d.version}</span>
    </span>
    {initialState && (
      <span class="status" data-status-for={id} data-state={initialState}>
        <span class="dot" aria-hidden="true"></span><span class="status-text">{initialText[initialState]}</span>
      </span>
    )}
    {d.address && (
      <span class="address">
        <code>{d.address}</code>
        <button class="copy" type="button" data-copy={d.address} aria-label={`Copy ${d.address}`}>Copy</button>
      </span>
    )}
    <span class="chevron" aria-hidden="true"></span>
  </summary>
  <div class="panel">
    <details class="section" id={`${id}-about`} open>
      <summary>About</summary>
      <div class="section-body"><Content /></div>
    </details>
    <details class="section" id={`${id}-join`} open>
      <summary>How to join</summary>
      <div class="section-body">
        <ol class="steps">{d.join.map((step) => <li set:html={mdInline(step)} />)}</ol>
        {d.ram && <p class="muted small">Recommended memory: {d.ram}.</p>}
      </div>
    </details>
    {downloads.state !== 'none' && (
      <details class="section" id={`${id}-downloads`}>
        <summary>Downloads</summary>
        <div class="section-body"><Downloads downloads={downloads} /></div>
      </details>
    )}
    <details class="section" id={`${id}-changelog`}>
      <summary>Changelog</summary>
      <div class="section-body"><Changelog entries={changelog} /></div>
    </details>
  </div>
</details>
```

`src/components/News.astro`:
```astro
---
import { render, type CollectionEntry } from 'astro:content';
import { formatDate } from '../lib/format';
interface Props { posts: CollectionEntry<'news'>[]; serverNames: Record<string, string> }
const { posts, serverNames } = Astro.props;
const rendered = await Promise.all(posts.map(async (p) => ({ p, ...(await render(p)) })));
---
<section class="news" id="news" aria-labelledby="news-title">
  <h2 id="news-title">News</h2>
  {rendered.length === 0 && <p class="muted">Nothing yet.</p>}
  {rendered.map(({ p, Content }, i) => (
    <details class="section post" id={`news-${p.id}`} open={i === 0}>
      <summary>
        <span>{p.data.title}</span>
        <time class="muted small" datetime={p.data.date.toISOString()}>{formatDate(p.data.date)}</time>
      </summary>
      <div class="section-body">
        {p.data.servers.length > 0 && (
          <p class="small">{p.data.servers.map((s) => <a class="tag" href={`#${s}`}>{serverNames[s]}</a>)}</p>
        )}
        <Content />
      </div>
    </details>
  ))}
</section>
```

- [ ] **Step 2: Page**

`src/pages/index.astro`:
```astro
---
import { getCollection } from 'astro:content';
import Layout from '../layouts/Layout.astro';
import Banner from '../components/Banner.astro';
import ServerCard from '../components/ServerCard.astro';
import News from '../components/News.astro';
import { site } from '../site.config';
import { resolveDownloads, type ReleasesFile } from '../lib/releases';
import { checkReferences, byDateDesc } from '../lib/content';
import releasesJson from '../data/releases.json';

const releases = releasesJson as ReleasesFile;
const allServers = await getCollection('servers');
const changelog = (await getCollection('changelog')).sort(byDateDesc);
const news = (await getCollection('news')).sort(byDateDesc);

checkReferences(
  allServers.map((s) => s.id),
  changelog.map((c) => c.data.server),
  news.flatMap((n) => n.data.servers),
);

const servers = allServers.filter((s) => s.data.status !== 'hidden').sort((a, b) => a.data.order - b.data.order);
const cards = servers.map((server) => ({
  server,
  downloads: resolveDownloads(server.id, server.data.pack, server.data.downloads, releases),
  changelog: changelog.filter((c) => c.data.server === server.id),
}));
const serverNames = Object.fromEntries(allServers.map((s) => [s.id, s.data.name]));
---
<Layout>
  <Banner />
  <header class="site-header">
    <div class="wrap">
      <h1>{site.name}</h1>
      <p class="tagline">{site.tagline}</p>
    </div>
  </header>
  <main class="wrap">
    <section class="servers" aria-label="Servers">
      {cards.map((c) => <ServerCard {...c} />)}
    </section>
    <News posts={news} serverNames={serverNames} />
  </main>
  <footer class="site-footer">
    <div class="wrap muted small">
      {site.name} · <a href={`https://github.com/${site.repo}/releases`}>Pack downloads on GitHub</a>
    </div>
  </footer>
  <script src="../scripts/client.ts"></script>
</Layout>
```

- [ ] **Step 3: Client script `src/scripts/client.ts`**

```ts
type PublicStatus = { online: boolean; players?: { online: number; max: number } };

const REFRESH_MS = 60_000;

function setStatus(el: HTMLElement, state: 'online' | 'offline', text: string) {
  el.dataset.state = state;
  const t = el.querySelector('.status-text');
  if (t) t.textContent = text;
}

async function refreshStatus() {
  const els = [...document.querySelectorAll<HTMLElement>('[data-status-for]')].filter((e) => e.dataset.state !== 'on-request');
  if (els.length === 0) return;
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, PublicStatus>;
    for (const el of els) {
      const s = data[el.dataset.statusFor!];
      if (!s) continue;
      if (s.online) setStatus(el, 'online', s.players ? `Online · ${s.players.online}/${s.players.max}` : 'Online');
      else setStatus(el, 'offline', 'Offline');
    }
  } catch {
    // Leave indicators as they are; the page works without status.
  }
}

function startPolling() {
  refreshStatus();
  setInterval(() => {
    if (document.visibilityState === 'visible') refreshStatus();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStatus();
  });
}

function setupCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>('button.copy').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault(); // the button sits inside <summary>; don't toggle the card
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(btn.dataset.copy ?? '');
        btn.textContent = 'Copied';
      } catch {
        btn.textContent = 'Copy failed';
      }
      setTimeout(() => (btn.textContent = 'Copy'), 1500);
    });
  });
}

function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  let el: HTMLElement | null = target;
  while (el) {
    if (el instanceof HTMLDetailsElement) el.open = true;
    el = el.parentElement;
  }
  target.scrollIntoView({ block: 'start' });
}

setupCopyButtons();
openFromHash();
window.addEventListener('hashchange', openFromHash);
startPolling();
```

- [ ] **Step 4: Component styles (append to `src/styles/global.css`)**

```css
.muted { color: var(--muted); }
.small { font-size: 0.875rem; }
.site-header { padding: 40px 0 16px; }
.site-header h1 { margin: 0; font-size: clamp(1.8rem, 5vw, 2.4rem); letter-spacing: -0.02em; }
.tagline { margin: 6px 0 0; color: var(--muted); }
.site-footer { padding: 32px 0 40px; }
.banner { background: var(--note-bg); border-bottom: 1px solid var(--note-border); padding: 10px 0; }
.banner p { margin: 0; }

.servers { display: grid; gap: 12px; margin: 16px 0 40px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.card > summary {
  display: grid; grid-template-columns: 1fr auto auto; grid-template-areas: "main status chevron" "address address address";
  gap: 6px 14px; align-items: center; padding: 16px; cursor: pointer; list-style: none;
}
.card > summary::-webkit-details-marker { display: none; }
.card > summary:hover { background: var(--surface-2); }
.card-main { grid-area: main; display: flex; flex-direction: column; min-width: 0; }
.card-title { font-weight: 650; font-size: 1.15rem; }
.card-meta { color: var(--muted); font-size: 0.9rem; }
.status { grid-area: status; display: inline-flex; align-items: center; gap: 6px; font-size: 0.9rem; color: var(--muted); white-space: nowrap; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--idle); }
.status[data-state="online"] { color: var(--text); }
.status[data-state="online"] .dot { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
.status[data-state="offline"] .dot { background: var(--bad); }
.address { grid-area: address; display: flex; align-items: center; gap: 8px; min-width: 0; }
.address code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { grid-area: chevron; width: 10px; height: 10px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); transition: transform 0.15s; margin-top: -4px; }
.card[open] > summary .chevron { transform: rotate(-135deg); margin-top: 4px; }

button.copy, .button {
  font: inherit; font-size: 0.85rem; border-radius: 8px; cursor: pointer; text-decoration: none;
}
button.copy { border: 1px solid var(--border); background: var(--surface-2); color: var(--text); padding: 2px 10px; }
.button { display: inline-flex; align-items: center; gap: 10px; background: var(--accent); color: var(--accent-text); padding: 10px 16px; font-weight: 600; font-size: 0.95rem; }
.button .size { font-weight: 400; opacity: 0.85; }

.panel { border-top: 1px solid var(--border); padding: 4px 16px 12px; }
.section { border-bottom: 1px solid var(--border); }
.section:last-child { border-bottom: 0; }
.section > summary { cursor: pointer; padding: 12px 0; font-weight: 600; display: flex; justify-content: space-between; gap: 12px; }
.section-body { padding: 0 0 14px; }
.section-body > :first-child { margin-top: 0; }
.steps { padding-left: 1.3em; margin: 0; }
.steps li + li { margin-top: 6px; }

.downloads { display: grid; gap: 14px; }
.download { display: grid; gap: 8px; justify-items: start; }
.note { background: var(--note-bg); border: 1px solid var(--note-border); border-radius: 8px; padding: 10px 12px; width: 100%; }
.note > :first-child { margin-top: 0; }
.note > :last-child { margin-bottom: 0; }

.changelog { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
.entry-head { margin: 0 0 4px; display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.entry-head time { color: var(--muted); font-size: 0.9rem; }
.changelog ul { margin: 0; padding-left: 1.2em; }
.tag { display: inline-block; font-size: 0.78rem; padding: 1px 8px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); text-decoration: none; margin-right: 4px; }
.older > summary { cursor: pointer; color: var(--accent); margin-top: 12px; }

.news h2 { font-size: 1.3rem; }
.news .post { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 0 16px; margin-bottom: 10px; }

@media (max-width: 560px) {
  .card > summary { grid-template-columns: 1fr auto; grid-template-areas: "main chevron" "status status" "address address"; }
}
```

- [ ] **Step 5: Build and inspect**

Run: `npm run build && npm run check`
Expected: build passes. Then:
```bash
grep -c 'class="card"' .vercel/output/static/index.html   # 1 (the example server)
grep -c 'data-status-for' .vercel/output/static/index.html # 0 (example has status: none)
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: single-page layout with collapsible server cards"
```

---

### Task 7: `prepare_pack.py`

**Files:**
- Create: `scripts/prepare_pack.py`, `scripts/tests/test_prepare_pack.py`

**Interfaces:**
- Consumes: server files `src/content/servers/*.md` (top-level `name`, `address`, `pack` scalars).
- Produces:
  - `servers_dat(name: str, ip: str) -> bytes` (uncompressed NBT)
  - `read_server_info(content_dir: str, pack: str) -> dict` with `name`, `address`
  - `sanitize_pack(src: str, dst: str, *, pack: str, version: str, variant: str, server_name: str, address: str) -> dict` report `{size, mods, overrides, minecraft, loader}`
  - CLI: `python scripts/prepare_pack.py <pack> <version> <full.mrpack> <lite.mrpack> [--content src/content/servers] [--out dist/packs]`

- [ ] **Step 1: Write the failing tests**

`scripts/tests/test_prepare_pack.py`:
```python
import io, json, os, struct, sys, tempfile, unittest, zipfile
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import prepare_pack as pp


def read_nbt_servers(data):
    """Minimal reader for the exact structure servers_dat() writes."""
    buf = io.BytesIO(data)
    def u8(): return buf.read(1)[0]
    def s(): n = struct.unpack(">H", buf.read(2))[0]; return buf.read(n).decode("utf-8")
    assert u8() == 10 and s() == ""
    assert u8() == 9 and s() == "servers" and u8() == 10
    count = struct.unpack(">i", buf.read(4))[0]
    out = []
    for _ in range(count):
        entry = {}
        while True:
            t = u8()
            if t == 0: break
            key = s()
            entry[key] = s() if t == 8 else buf.read(1)[0]
        out.append(entry)
    assert u8() == 0
    return out


def make_pack(path, *, dh=False, extra=None):
    index = {"formatVersion": 1, "game": "minecraft", "versionId": "old", "name": "Old",
             "files": [{"path": "mods/a.jar"}, {"path": "mods/b.jar"}],
             "dependencies": {"minecraft": "1.21.1", "neoforge": "21.1.248"}}
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("modrinth.index.json", json.dumps(index))
        z.writestr("overrides/servers.dat", b"personal list")
        z.writestr("overrides/servers.dat_old", b"personal list")
        z.writestr("overrides/options.txt", "fov:0.5\nlastServer:old.example.org\nkey_jump:key.keyboard.space\n")
        z.writestr("overrides/config/a.toml", "x=1")
        z.writestr("overrides/XaeroWaypoints/w.txt", "waypoint:home:10:64:20")
        z.writestr("overrides/screenshots/a.png", b"png")
        z.writestr("overrides/logs/latest.log", "log")
        z.writestr("client-overrides/saves/w/level.dat", b"x")
        z.writestr("overrides/command_history.txt", "/tp")
        if dh:
            z.writestr("overrides/Distant_Horizons_server_data/x.sqlite", b"dh")
        for k, v in (extra or {}).items():
            z.writestr(k, v)


SERVER_MD = """---
name: Cogs & Curses
order: 1
game: minecraft-java
version: "1.21.1"
address: cogsandcurses.example.org
status: live
pack: cogsandcurses
join:
  - Step
---
About.
"""


class PreparePackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.content = os.path.join(self.d, "servers")
        os.makedirs(self.content)
        with open(os.path.join(self.content, "cogsandcurses.md"), "w", encoding="utf-8") as f:
            f.write(SERVER_MD)

    def tearDown(self):
        self.tmp.cleanup()

    def test_servers_dat_round_trip(self):
        self.assertEqual(read_nbt_servers(pp.servers_dat("Cogs & Curses", "cnc.example.org")),
                         [{"ip": "cnc.example.org", "name": "Cogs & Curses"}])

    def test_read_server_info(self):
        self.assertEqual(pp.read_server_info(self.content, "cogsandcurses"),
                         {"name": "Cogs & Curses", "address": "cogsandcurses.example.org"})
        with self.assertRaises(SystemExit):
            pp.read_server_info(self.content, "nope")

    def test_sanitize(self):
        src, dst = os.path.join(self.d, "in.mrpack"), os.path.join(self.d, "out.mrpack")
        make_pack(src, dh=True)
        report = pp.sanitize_pack(src, dst, pack="cogsandcurses", version="3.0.0", variant="full",
                                  server_name="Cogs & Curses", address="cogsandcurses.example.org")
        with zipfile.ZipFile(dst) as z:
            names = set(z.namelist())
            self.assertIn("overrides/config/a.toml", names)
            self.assertIn("overrides/Distant_Horizons_server_data/x.sqlite", names)  # allowed in full
            for gone in ["overrides/XaeroWaypoints/w.txt", "overrides/screenshots/a.png", "overrides/logs/latest.log",
                         "client-overrides/saves/w/level.dat", "overrides/command_history.txt",
                         "overrides/servers.dat_old"]:
                self.assertNotIn(gone, names)
            self.assertEqual(read_nbt_servers(z.read("overrides/servers.dat")),
                             [{"ip": "cogsandcurses.example.org", "name": "Cogs & Curses"}])
            options = z.read("overrides/options.txt").decode()
            self.assertNotIn("lastServer", options)
            self.assertIn("key_jump:key.keyboard.space", options)
            index = json.loads(z.read("modrinth.index.json"))
            self.assertEqual(index["versionId"], "3.0.0")
            self.assertEqual(index["name"], "Cogs & Curses (Full)")
        self.assertEqual(report["mods"], 2)
        self.assertEqual(report["minecraft"], "1.21.1")
        self.assertEqual(report["loader"], "neoforge 21.1.248")

    def test_lite_rejects_distant_horizons_data(self):
        src = os.path.join(self.d, "lite.mrpack")
        make_pack(src, dh=True)
        with self.assertRaises(SystemExit):
            pp.sanitize_pack(src, os.path.join(self.d, "o.mrpack"), pack="cogsandcurses", version="3.0.0",
                             variant="lite", server_name="C", address="c.example.org")

    def test_main_rejects_mismatched_versions(self):
        full, lite = os.path.join(self.d, "f.mrpack"), os.path.join(self.d, "l.mrpack")
        make_pack(full)
        idx = {"formatVersion": 1, "files": [], "dependencies": {"minecraft": "1.21.2", "neoforge": "21.1.248"}}
        with zipfile.ZipFile(lite, "w") as z:
            z.writestr("modrinth.index.json", json.dumps(idx))
        with self.assertRaises(SystemExit):
            pp.main(["cogsandcurses", "3.0.0", full, lite, "--content", self.content,
                     "--out", os.path.join(self.d, "out")])

    def test_main_writes_named_files(self):
        full, lite = os.path.join(self.d, "f.mrpack"), os.path.join(self.d, "l.mrpack")
        make_pack(full)
        make_pack(lite)
        out = os.path.join(self.d, "out")
        pp.main(["cogsandcurses", "3.0.0", full, lite, "--content", self.content, "--out", out])
        self.assertEqual(sorted(os.listdir(out)),
                         ["cogsandcurses-3.0.0-full.mrpack", "cogsandcurses-3.0.0-lite.mrpack"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m unittest discover -s scripts/tests -v`
Expected: FAIL, `No module named 'prepare_pack'`.

- [ ] **Step 3: Implement `scripts/prepare_pack.py`**

```python
#!/usr/bin/env python3
"""Prepare Modrinth App .mrpack exports for public release.

Usage:
  python scripts/prepare_pack.py <pack> <version> <full.mrpack> <lite.mrpack>
                                 [--content src/content/servers] [--out dist/packs]

For each export it writes <out>/<pack>-<version>-<variant>.mrpack with:
  - overrides/servers.dat replaced by a single entry for this pack's server
  - lastServer removed from options.txt
  - saves, screenshots, logs, crash reports, minimap waypoints and command history removed
  - modrinth.index.json versionId/name set
Fails if the two exports disagree on Minecraft/loader versions, or if the lite export
contains Distant Horizons server data. Standard library only.
"""
import argparse, json, os, re, struct, sys, zipfile

OVERRIDE_ROOTS = ("overrides/", "client-overrides/", "server-overrides/")
REMOVED_DIRS = {"saves", "screenshots", "logs", "crash-reports", "xaero", "XaeroWaypoints", "XaeroWorldMap",
                "journeymap"}
REMOVED_FILES = {"command_history.txt", "servers.dat_old"}
DH_DIR = "Distant_Horizons_server_data"


def _nbt_string(s):
    b = s.encode("utf-8")
    return struct.pack(">H", len(b)) + b


def servers_dat(name, ip):
    """Uncompressed NBT: {servers: [{ip, name}]} as Minecraft's multiplayer list expects."""
    entry = b"\x08" + _nbt_string("ip") + _nbt_string(ip) + b"\x08" + _nbt_string("name") + _nbt_string(name) + b"\x00"
    servers = b"\x09" + _nbt_string("servers") + b"\x0a" + struct.pack(">i", 1) + entry
    return b"\x0a" + _nbt_string("") + servers + b"\x00"


def _frontmatter_scalars(text):
    m = re.match(r"^---\r?\n(.*?)\r?\n---", text, re.S)
    out = {}
    if not m:
        return out
    for line in m.group(1).splitlines():
        km = re.match(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$", line)
        if km and km.group(2) and not km.group(2).startswith(("|", ">")):
            out[km.group(1)] = km.group(2).strip("\"'")
    return out


def read_server_info(content_dir, pack):
    for fn in sorted(os.listdir(content_dir)):
        if not fn.endswith(".md"):
            continue
        with open(os.path.join(content_dir, fn), encoding="utf-8") as f:
            fm = _frontmatter_scalars(f.read())
        if fm.get("pack") == pack:
            if not fm.get("address"):
                sys.exit(f"{fn}: pack {pack} has no address; the server list entry needs one")
            return {"name": fm["name"], "address": fm["address"]}
    sys.exit(f"No server file in {content_dir} has pack: {pack}")


def _is_removed(name):
    root = next((r for r in OVERRIDE_ROOTS if name.startswith(r)), None)
    if root is None:
        return False
    rel = name[len(root):]
    first = rel.split("/", 1)[0]
    return first in REMOVED_DIRS or rel in REMOVED_FILES


def _loader(deps):
    for key in ("neoforge", "forge", "fabric-loader", "quilt-loader"):
        if key in deps:
            return f"{key} {deps[key]}"
    return "vanilla"


def sanitize_pack(src, dst, *, pack, version, variant, server_name, address):
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        if variant == "lite" and any(DH_DIR in n for n in names):
            sys.exit(f"{src}: the lite pack must not contain {DH_DIR}/")
        index = json.loads(zin.read("modrinth.index.json"))
        index["versionId"] = version
        index["name"] = f"{server_name} ({variant.title()})"
        overrides = 0
        os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
        with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
            zout.writestr("modrinth.index.json", json.dumps(index, indent=2))
            wrote_servers = False
            for info in zin.infolist():
                n = info.filename
                if n == "modrinth.index.json" or info.is_dir() or _is_removed(n):
                    continue
                if n.endswith("/servers.dat") and n.count("/") == 1:
                    zout.writestr(n, servers_dat(server_name, address))
                    wrote_servers = True
                elif n.endswith("/options.txt") and n.count("/") == 1:
                    text = zin.read(n).decode("utf-8", "replace")
                    kept = [l for l in text.splitlines() if not l.startswith("lastServer:")]
                    zout.writestr(n, "\n".join(kept) + "\n")
                else:
                    zi = zipfile.ZipInfo(n, info.date_time)
                    zi.compress_type = zipfile.ZIP_DEFLATED  # ZipInfo defaults to STORED
                    with zin.open(info) as fsrc, zout.open(zi, "w") as fdst:
                        while chunk := fsrc.read(1 << 20):
                            fdst.write(chunk)
                overrides += 1
            if not wrote_servers:
                zout.writestr("overrides/servers.dat", servers_dat(server_name, address))
    deps = index.get("dependencies", {})
    return {"size": os.path.getsize(dst), "mods": len(index.get("files", [])), "overrides": overrides,
            "minecraft": deps.get("minecraft"), "loader": _loader(deps)}


def _deps(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("modrinth.index.json")).get("dependencies", {})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("version")
    ap.add_argument("full")
    ap.add_argument("lite")
    ap.add_argument("--content", default="src/content/servers")
    ap.add_argument("--out", default="dist/packs")
    args = ap.parse_args(argv)
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        sys.exit("version must look like 3.0.1")
    if _deps(args.full) != _deps(args.lite):
        sys.exit(f"Full and Lite disagree on versions: {_deps(args.full)} vs {_deps(args.lite)}")
    info = read_server_info(args.content, args.pack)
    for variant, src in (("full", args.full), ("lite", args.lite)):
        dst = os.path.join(args.out, f"{args.pack}-{args.version}-{variant}.mrpack")
        r = sanitize_pack(src, dst, pack=args.pack, version=args.version, variant=variant,
                          server_name=info["name"], address=info["address"])
        print(f"{variant:5} {dst}\n      {r['size'] / 1e6:.1f} MB, {r['mods']} indexed mods, {r['overrides']} override files, "
              f"Minecraft {r['minecraft']}, {r['loader']}")
    print(f"\nCreate a GitHub release with tag: {args.pack}-v{args.version}")
    print("Attach both files above, then publish.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m unittest discover -s scripts/tests -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/prepare_pack.py scripts/tests/test_prepare_pack.py
git commit -m "feat: prepare_pack.py sanitises modpack exports for release"
```

---

### Task 8: Privacy guard and CI

**Files:**
- Create: `scripts/privacy_check.py`, `scripts/tests/test_privacy_check.py`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `scan(paths: list[str], deny: list[str]) -> list[tuple[str, int, str]]` (file, line, reason: `"ipv4"` or `"denylist entry #N"`); CLI scans `git ls-files`, reads `PRIVACY_DENYLIST` env (newline-separated), exits 1 on findings without printing matched values.

- [ ] **Step 1: Failing test**

`scripts/tests/test_privacy_check.py`:
```python
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from privacy_check import scan


class PrivacyCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        p = os.path.join(self.tmp.name, name)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def test_flags_ipv4(self):
        p = self.write("a.md", "ok\nconnect to 10.20.30.40 now\n")
        self.assertEqual(scan([p], []), [(p, 2, "ipv4")])

    def test_ignores_versions_and_invalid_octets(self):
        p = self.write("b.md", "NeoForge 21.1.248 and 1.21.11 and 999.1.1.1\n")
        self.assertEqual(scan([p], []), [])

    def test_denylist_whole_token_only(self):
        p = self.write("c.md", "port 26999 here\nhash abc26999xyz\nSecretName joined\n")
        found = scan([p], ["26999", "secretname"])
        self.assertEqual(found, [(p, 1, "denylist entry #1"), (p, 3, "denylist entry #2")])

    def test_skips_binary(self):
        p = os.path.join(self.tmp.name, "d.bin")
        with open(p, "wb") as f:
            f.write(b"\x00\x0110.0.0.1")
        self.assertEqual(scan([p], []), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m unittest discover -s scripts/tests -v`
Expected: FAIL, `No module named 'privacy_check'`.

- [ ] **Step 3: Implement `scripts/privacy_check.py`**

```python
#!/usr/bin/env python3
"""Fail if tracked files contain IPv4 addresses or any value from the PRIVACY_DENYLIST secret.

PRIVACY_DENYLIST is newline-separated (real address, old DDNS names, ports, player names).
Findings report file and line only, never the matched value.
"""
import os, re, subprocess, sys

IPV4 = re.compile(r"(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])")
MAX_BYTES = 5_000_000


def _deny_patterns(deny):
    return [re.compile(r"(?<![A-Za-z0-9])" + re.escape(d) + r"(?![A-Za-z0-9])", re.I) for d in deny if d.strip()]


def scan(paths, deny):
    patterns = _deny_patterns([d.strip() for d in deny])
    findings = []
    for path in paths:
        try:
            if os.path.getsize(path) > MAX_BYTES:
                continue
            with open(path, "rb") as f:
                raw = f.read()
        except OSError:
            continue
        if b"\x00" in raw:
            continue
        for lineno, line in enumerate(raw.decode("utf-8", "replace").splitlines(), 1):
            if IPV4.search(line):
                findings.append((path, lineno, "ipv4"))
            for i, pat in enumerate(patterns, 1):
                if pat.search(line):
                    findings.append((path, lineno, f"denylist entry #{i}"))
    return findings


def main():
    files = subprocess.run(["git", "ls-files"], capture_output=True, text=True, check=True).stdout.split("\n")
    files = [f for f in files if f]
    deny = os.environ.get("PRIVACY_DENYLIST", "").splitlines()
    if not any(d.strip() for d in deny):
        print("warning: PRIVACY_DENYLIST is empty; only the IPv4 check ran")
    findings = scan(files, deny)
    for path, line, reason in findings:
        print(f"{path}:{line}: {reason}")
    print(f"privacy check: {len(files)} files, {len(findings)} finding(s)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m unittest discover -s scripts/tests -v && python scripts/privacy_check.py`
Expected: tests PASS; privacy check prints `0 finding(s)` (with the empty-denylist warning).

- [ ] **Step 5: CI workflow `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - uses: actions/setup-python@v7
        with:
          python-version: '3.12'
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npm run test:py
      - run: npm run build
      - name: Privacy guard
        run: python scripts/privacy_check.py
        env:
          PRIVACY_DENYLIST: ${{ secrets.PRIVACY_DENYLIST }}
```

- [ ] **Step 6: Commit**

```bash
git add scripts/privacy_check.py scripts/tests/test_privacy_check.py .github/workflows/ci.yml
git commit -m "ci: build, tests and privacy guard"
```

---

### Task 9: First-round content

**Files:**
- Delete: `src/content/servers/example.md`
- Create: `src/content/servers/{cogsandcurses,vanilla,skyfactory,hytale}.md`, `src/content/changelog/cogsandcurses/*.md`, `src/content/news/2026-10-07-new-addresses.md`

**Rules for the text:** player-facing; no player names, coordinates, chunk counts, internal paths, IPs or ports; all three Minecraft servers are whitelisted, so every join list ends with asking to be whitelisted.

- [ ] **Step 1: Server files** (content as listed below; exact wording in the files)

- `cogsandcurses.md`: order 1, `minecraft-java`, version `1.21.1 · NeoForge 21.1.248`, address `cogsandcurses.justinhere.net`, `status: live`, `pack: cogsandcurses`, ram `8 GB`, join steps (Modrinth App → download → File → Add instance → Import → memory → join → whitelist), downloads `full` (note: delete old instance before importing a new major version; includes ~550 MB distant-terrain cache) and `lite` (note: same world, fewer client-side extras, for low-end PCs).
- `vanilla.md`: order 2, version `Paper 1.21.11`, address `mc.justinhere.net`, `status: live`, join: Java Edition 1.21.11 → Multiplayer → Add Server → address → whitelist.
- `skyfactory.md`: order 3, version `SkyFactory 3 · Forge 1.10.2`, address `sf.justinhere.net`, `status: on-request`, join: install SkyFactory 3 (CurseForge app) → Java 8 → ask for it to be started → whitelist.
- `hytale.md`: order 4, `game: hytale`, version `Hytale`, no address, `status: none`, join: not open to outside players yet; ask in the group chat.

- [ ] **Step 2: C&C changelog** from the pack history (player wording): 2026-09-04 (re-sync, removed Ad Astra/Elytra Slot/Caelus/Waystones/BetterNether), 2026-09-12 (Saro's Essentials removed, FTB Essentials handles /tpa /home), 2026-09-13 (Lite pack), 2026-09-15 (stone mining fix; Dynamic Lights and Spawn Animations removed for lag), 2026-09-17 (version 3.0.0, 25 mod updates), 2026-09-22 (in-game backup mod removed; fixes freezes), 2026-09-23 (Air War removed; its ores turned into stone/deepslate), 2026-09-24 (Molten Vents can't be moved by contraptions or Aeronautics), 2026-10-05 (simulation distance 8 → 7 for performance).

- [ ] **Step 3: News post** `2026-10-07-new-addresses.md`: the servers have new `justinhere.net` addresses; the old address stops working soon; list the three addresses; tagged `[cogsandcurses, vanilla, skyfactory]`.

- [ ] **Step 4: Build, check, privacy scan**

Run: `npm run build && npm run check && python scripts/privacy_check.py`
Expected: pass; `grep -c 'class="card"' .vercel/output/static/index.html` → 4; `grep -c 'data-status-for' …` → 3 (two live + one on-request).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "content: servers, C&C changelog history, new-addresses post"
```

---

### Task 10: README and live checks

**Files:**
- Create: `README.md`

- [ ] **Step 1: README** covering: what the site is; how to edit server/changelog/news/banner files (with the frontmatter field tables); how to publish a pack (export → `prepare_pack.py` → GitHub release → automatic sync); local dev (`npm install`, `npm run dev`, tests); one-time setup (Vercel import, `PRIVACY_DENYLIST` secret, domain CNAME); privacy rules.

- [ ] **Step 2: Live status check from this machine**

Run a one-off Node script that imports the built `checkAll` logic against the real addresses (through `npx tsx` or a vitest `.skip`-by-default integration test run with `LIVE=1`):
```ts
// tests/live.test.ts
import { describe, it, expect } from 'vitest';
import { checkAll } from '../src/lib/status';
describe.skipIf(!process.env.LIVE)('live servers', () => {
  it('answers for the public addresses', async () => {
    const out = await checkAll([
      { id: 'cogsandcurses', address: 'cogsandcurses.justinhere.net' },
      { id: 'vanilla', address: 'mc.justinhere.net' },
    ], 3000);
    console.log(out);
    expect(Object.keys(out)).toEqual(['cogsandcurses', 'vanilla']);
    expect(JSON.stringify(out)).not.toMatch(/sample|"name"/);
  });
});
```
Run: `LIVE=1 npx vitest run tests/live.test.ts`
Expected: C&C online with a player count (if running); Vanilla offline is acceptable until its port-forward is fixed (it is reached through the public address, so this is the outside view). Note: from inside the home network this depends on the router supporting NAT loopback.

- [ ] **Step 3: Commit and push; confirm CI passes**

```bash
git add -A
git commit -m "docs: README with editing and publishing guide"
git push origin main
```
Check the CI run via the GitHub API: latest run on `main` concludes `success`.

---

### Task 11: Pack 3.0.0 as a draft release

- [ ] **Step 1:** Run `python scripts/prepare_pack.py cogsandcurses 3.0.0 "<Downloads>/Cogs & Curses 3.0.0.mrpack" "<Downloads>/Cogs & Curses Lite.mrpack"` after confirming the Lite export matches 3.0.0's Minecraft/loader versions. Inspect the report.
- [ ] **Step 2:** Create a **draft** release `cogsandcurses-v3.0.0` via the GitHub API and upload both files. Drafts are ignored by `sync_releases.py`, so the site is unaffected until the owner test-imports the pack and publishes the release.

---

## Owner steps (cannot be done from this machine)

1. Import the repo into Vercel (Add New → Project → `moss-servers`, defaults).
2. Add repo secret `PRIVACY_DENYLIST` (Settings → Secrets and variables → Actions).
3. Test-import the draft pack in the Modrinth App and join; then publish the draft release.
4. Add `servers.justinhere.net` in Vercel → Domains, and the CNAME it shows in Namecheap.
5. Regenerate / narrow the GitHub token.
