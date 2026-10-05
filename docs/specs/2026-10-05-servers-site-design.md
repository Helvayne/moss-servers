# servers.justinhere.net — design

Status: approved design, 2026-10-05. Implementation plan to follow.

> This repo is **public**. Nothing in it may contain IP addresses, port numbers, player names,
> or other private details about the servers. See [Privacy guard](#privacy-guard).

## Goal

A public homepage for the Moss Gang game servers where players can see what's running, whether
it's up, how to join, download modpacks, and read changelogs and news.

## Decisions

| Topic | Decision |
|---|---|
| Audience | Public: anyone with the link. `noindex` by default so it isn't search-listed. |
| Hosting | Vercel (Hobby), static site plus one serverless function. Nothing runs at home. |
| Framework | Astro, Markdown content collections. |
| Layout | One page. No per-server pages. |
| Authoring | Markdown files in this repo; push to `main` publishes. No admin UI, no database. |
| Pack hosting | GitHub Releases on this repo. |
| Live status | Minecraft Server List Ping from the serverless function, cached 60 s. |
| Player privacy | Player names are never fetched into the page, stored, or published. |

## 1. Page layout

Single page at `/`, top to bottom:

1. **Header** with the site name.
2. **Status banner**, shown only when enabled in `src/data/banner.yaml`.
3. **Server cards**, one column, full width, ordered by `order`.
4. **News**: latest posts, same collapsible style. A `/news` archive page is out of scope until there
   are enough posts to need it.
5. **Footer**: site name and a link to the GitHub Releases page. No Discord invite link (decided 2026-10-05).

### Server card

Collapsed state shows: name, game and version, live status indicator, address with a copy button.

Clicking the card expands a panel directly below it with independently collapsible sections:

| Section | Default | Content |
|---|---|---|
| About | open | Server file body: description and rules. |
| How to join | open | Numbered steps from the server file's `join` list. |
| Downloads | closed | Only when the server has a `pack`. One block per variant: note box, then button. |
| Changelog | closed | Entries for this server, newest first; latest 3 shown, "Show older" reveals the rest. |

Behaviour:

- Built on native `<details>/<summary>` so it works without JavaScript; JS only adds deep-link handling.
- Several cards may be open at once.
- Deep links: `/#<slug>` opens that card; `/#<slug>-<section>` (e.g. `#cogsandcurses-changelog`)
  opens the card and that section and scrolls to it.
- Mobile-first; usable at phone width with no horizontal scroll.

### Status indicator

| State | When |
|---|---|
| Grey "Checking…" | Before the first status response, or if the status endpoint fails. |
| Green "Online · n/max" | Server answered the status ping. |
| Red "Offline" | No answer within the timeout. Means "not reachable from the internet". |
| Grey "On request" | `status: on-request`. No ping is made. |
| *(no indicator)* | `status: none`. The card shows no status at all. |

## 2. Content model

All editable content lives in `src/content/` and `src/data/`, validated with Astro content-collection
schemas (zod). A missing required field, an unknown server slug, or an invalid date **fails the build**,
so a bad edit never replaces the live site.

### Servers — `src/content/servers/<slug>.md`

```markdown
---
name: Cogs & Curses
order: 1
game: minecraft-java          # minecraft-java | hytale
version: "1.21.1 · NeoForge 21.1.248"
address: cogsandcurses.justinhere.net
status: live                  # live | on-request | none | hidden
pack: cogsandcurses           # optional; links Downloads to releases tagged cogsandcurses-v*
ram: 8 GB                     # optional
join:
  - Install the [Modrinth App](https://modrinth.com/app).
  - Download the Full or Lite pack below.
  - In the app, choose **File → Add instance → Import** and pick the file.
  - Set memory to at least 8 GB, launch, and join `cogsandcurses.justinhere.net`.
downloads:                    # optional; one entry per release asset variant
  - variant: full
    label: Full
    note: |
      Markdown shown in a highlighted box above the download button.
  - variant: lite
    label: Lite (low-end PCs)
    note: Optional.
---
About text (Markdown).
```

`status: hidden` removes the server from the page entirely. `address` is a hostname only: never an
IP, never a port.

### Changelog — `src/content/changelog/<slug>/<YYYY-MM-DD>.md`

Frontmatter: `server` (must match a server slug), `date`, optional `version`, optional `title`.
Body: Markdown, usually a bullet list. A second entry on the same day uses `<YYYY-MM-DD>-2.md`.

### News — `src/content/news/<YYYY-MM-DD>-<slug>.md`

Frontmatter: `title`, `date`, optional `servers: [slug, ...]`. Body: Markdown.

### Banner — `src/data/banner.yaml`

```yaml
enabled: false
text: "Short message, Markdown allowed"
```

## 3. Live status — `/api/status`

One Vercel serverless function (Node runtime; it needs raw TCP).

1. Reads the server list from the content collection at build time; only `game: minecraft-java` with
   `status: live` is pinged.
2. For each server, in parallel: resolve `_minecraft._tcp.<address>` SRV (fall back to the A record and
   the default port, as the vanilla client does), open TCP, send a Server List Ping handshake + status
   request, read the JSON response. Timeout 3 s per server.
3. Returns, per slug: `online`, `players.online`, `players.max`, `version`, `motd` (formatting codes
   stripped). **The `players.sample` array is discarded before the response is built**: player names
   never leave the function.
4. Response header `Cache-Control: s-maxage=60, stale-while-revalidate=30`, so the CDN serves cached
   results and each server is pinged at most about once a minute regardless of traffic.

Client: fetches once on load, then every 60 s while `document.visibilityState === "visible"`.
Any fetch error leaves indicators grey; the rest of the page is unaffected.

Hytale uses a different protocol and is not pinged. Its card is listed like the others but uses
`status: none` (decided 2026-10-05: no status for Hytale).

**Tests**

- Unit tests for VarInt encoding/decoding, packet framing, and response parsing, using recorded
  responses.
- A test that a response containing `players.sample` produces output with no player names.
- Timeout behaviour against a local socket that never answers.
- Before launch: one manual run against the real servers from outside the home network.

## 4. Pack releases

### Versioning

One release per pack version containing **both** variants at the same version number:

- Tag: `<pack>-v<version>`, e.g. `cogsandcurses-v3.0.0`
- Assets: `<pack>-<version>-<variant>.mrpack`, e.g. `cogsandcurses-3.0.0-full.mrpack`,
  `cogsandcurses-3.0.0-lite.mrpack`. `<variant>` matches a `downloads[].variant` in the server file.

Full and Lite always share a version, because both must match the server's current mod set. (The
existing Lite 1.0.0 export is renumbered to match Full.)

### Publishing workflow

1. Export the Full and Lite profiles from the Modrinth App.
2. Run `python scripts/prepare_pack.py <pack> <version> <full.mrpack> <lite.mrpack>`. It writes sanitized
   copies to `dist/packs/` (git-ignored) and prints the tag and file names to use. The server's display
   name and hostname come from the server file whose `pack` equals `<pack>`.
3. Create a GitHub release with that tag, attach both files, publish.
4. Add a changelog entry; update the download notes if needed; push.
5. The release triggers a rebuild (see below).

### `scripts/prepare_pack.py`

Python 3, standard library only. For each input `.mrpack`:

- **`overrides/servers.dat`** is replaced with a newly generated file containing a single entry: the
  pack's server name and its public hostname. (The exported file carries the exporter's personal
  server list.)
- **`overrides/options.txt`**: the `lastServer` key is removed; everything else is kept.
- **Removed if present** (under `overrides/` and `client-overrides/`): `saves/`, `screenshots/`,
  `logs/`, `crash-reports/`, minimap and world-map waypoint/cache folders (Xaero's, JourneyMap),
  `command_history.txt`.
- **Lite only**: fails if a Distant Horizons data folder is present.
- **Validation**: both packs must report the same `minecraft` and loader versions in
  `modrinth.index.json`; the script sets `versionId` to the requested version and the pack `name` to
  the server's `name` plus the variant label (e.g. "Cogs & Curses (Lite)").
- **Report**: size, number of indexed mods, number of override files, and loader/game versions for each.

Tests run against a small generated fixture pack containing a multi-entry `servers.dat`, an
`options.txt` with `lastServer`, a waypoint file, and a `screenshots/` entry, and assert each is
handled.

### Site build

At build time the site calls the GitHub REST API for this repo's releases, picks the newest
non-draft, non-prerelease release whose tag starts with `<pack>-v`, and maps assets to `downloads[]`
entries by their `-<variant>.mrpack` suffix. A `downloads` entry with no matching asset fails the build. Each download block shows the note, version, file size and a direct asset link,
plus an "Older versions" link to the repo's Releases page.

If the API call fails, **the build fails** and Vercel keeps serving the previous deployment.

`.github/workflows/release-rebuild.yml`: on `release: published`, POST to the Vercel deploy hook stored
in the `VERCEL_DEPLOY_HOOK` repository secret.

## 5. Repo, CI, deployment

- **Repo**: `Helvayne/moss-servers`, public. Default branch `main`.
- **Vercel**: project imported from the repo (Astro preset). `main` deploys to production; other
  branches get preview deployments, used for review before launch.
- **Domain**: `servers.justinhere.net`, added in Vercel; a CNAME record at the DNS provider with the
  value Vercel shows. It is a separate record and does not touch any game-server DNS records.
- **`noindex`**: `<meta name="robots" content="noindex">` plus `robots.txt` disallow, controlled by one
  config flag.

### CI — `.github/workflows/ci.yml` (push and pull request)

1. `astro check` and `astro build` (content schema validation happens here).
2. Unit tests (status ping, `prepare_pack.py`).
3. **Privacy guard** (below).

### Privacy guard

`scripts/privacy_check.py`, run in CI over every tracked file:

- Fails on anything matching an IPv4 address pattern (an allow-list can be added for documentation
  example ranges if ever needed).
- Fails on any value listed in the `PRIVACY_DENYLIST` repository secret: newline-separated strings
  (the real address, old dynamic-DNS hostnames, port numbers, player names). The list itself never appears in the repo or logs;
  failures report the file and line, not the matched value.

## Launch checklist

1. Repo created; token access verified; Vercel project imported; deploy hook secret and
   `PRIVACY_DENYLIST` secret added.
2. Site built with first-round content (four server files, rewritten C&C changelog history); owner
   reviews on the preview deployment.
3. Each server's whitelist setting checked, so it's known whether a public address lets strangers join.
4. Pack 3.0.0 prepared with `prepare_pack.py`; owner test-imports in the Modrinth App and joins.
5. Release published; domain added; site live.
6. Announced in Discord.

## Out of scope for v1

Player names or leaderboards, comments, accounts or login, search, a `/news` archive page, a world map,
Discord-channel mirroring, an admin editor.

## Open questions (content, not design)

- Intro text and the site's display name.
- Hytale's public address. Hytale clients don't resolve SRV records, so the address is a plain DNS
  name, and players must type the port unless the server uses Hytale's default port. Recommended:
  move the server to the default port so the published address is just a hostname. Until it is
  reachable from outside, its card says so in the How to join section.

Resolved 2026-10-05: no Discord invite link; Hytale is listed like the other servers, with no status
indicator.
