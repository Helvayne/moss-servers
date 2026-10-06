# Moss Servers

The homepage for our game servers: what's running, whether it's up, how to join, modpack downloads,
changelogs and news. One page, built with [Astro](https://astro.build) and hosted on Vercel.

Design: [`docs/specs/2026-10-05-servers-site-design.md`](docs/specs/2026-10-05-servers-site-design.md)

> **This repo is public.** Never commit IP addresses, port numbers, player names or anything else
> private. CI checks for IP addresses, plus any values in the optional `PRIVACY_DENYLIST` secret.

## Editing content

Everything you edit lives in `src/content/`. Each file is a settings block between `---` lines,
followed by normal Markdown. Push to `main` and the site updates in about a minute. If a file has a
mistake (missing setting, misspelled server name, bad date), the build fails with a clear error and
the live site stays as it was.

**YAML gotcha:** if a line in the settings block contains a colon followed by a space
(`Minecraft: Java Edition`), wrap the whole value in double quotes.

### Servers: `src/content/servers/<slug>.md`

The file name (without `.md`) is the server's slug. It's used in links (`/#cogsandcurses`) and by
changelog and news files.

| Setting | Required | Meaning |
|---|---|---|
| `name` | yes | Display name |
| `order` | yes | Position on the page, lowest first |
| `game` | yes | `minecraft-java` or `hytale` |
| `version` | yes | Shown under the name |
| `address` | no | Hostname players connect to. Never an IP, never a port |
| `status` | yes | `live` (live dot), `on-request` (grey "On request"), `none` (no indicator), `hidden` (not shown) |
| `pack` | no | Links the Downloads section to releases tagged `<pack>-v<version>` |
| `ram` | no | Shown under the join steps |
| `icon` | no | Card icon, a file in `public/icons/` (e.g. `/icons/moss.png`); otherwise the name's initials |
| `join` | yes | List of steps; Markdown allowed |
| `downloads` | no | One entry per pack file: `variant`, `label`, optional `note` (Markdown, shown above the button) |

The Markdown below the settings block is the **About** section.

### Changelog: `src/content/changelog/<slug>/<YYYY-MM-DD>.md`

```markdown
---
server: cogsandcurses
date: 2026-10-10
version: 3.0.1        # optional
title: Short title    # optional
---
- What changed, written for players.
```

A second entry on the same day: `<YYYY-MM-DD>-2.md`. The newest 3 entries show; older ones fold
under "Show older".

### News: `src/content/news/<YYYY-MM-DD>-<slug>.md`

```markdown
---
title: New server addresses
date: 2026-10-07
servers: [cogsandcurses, vanilla]   # optional, adds links to those cards
---
Post text.
```

### Banner: `src/content/banner/banner.md`

Set `enabled: true` and write the message below the settings block. Set it back to `false` to hide it.

## Publishing a modpack version

1. Export the Full and Lite profiles from the Modrinth App (profile → ⋯ → Export).
2. Prepare them:
   ```bash
   python scripts/prepare_pack.py cogsandcurses 4.0.1 "path/to/Full export.mrpack" "path/to/Lite export.mrpack" --update "path/to/UpdateYourself.zip"
   ```
   `--update` is optional: a zip of `mods/` and `resourcepacks/` for players who update by hand. It becomes
   `<pack>-<version>-update.zip` (one wrapper folder is fine; caches and configs are dropped). Every file
   must be under 2 GB (GitHub's limit), so export the Full pack **without** the Distant Horizons cache.
   This writes cleaned copies to `release-files/` and prints the release tag. It replaces your personal
   server list with just this server, removes `lastServer`, saves, screenshots, logs, waypoints and
   command history, and checks that both files target the same Minecraft and loader versions.
3. On GitHub, **Releases → Draft a new release**, use the printed tag (e.g. `cogsandcurses-v4.0.1`),
   attach the files, and publish. Drafts and pre-releases are ignored by the site, so you can test first.
4. Add a changelog entry and check the download notes in the server file still apply.

Publishing (or editing/deleting) a release runs the **Sync pack releases** workflow, which updates
`src/data/releases.json` and commits it. That commit redeploys the site.

## Live status

`/api/status` pings every `status: live` server with Minecraft's Server List Ping and returns only
online/offline, player count, version and MOTD. Player names in the reply are dropped. Results are
cached for 60 s (20 s if any server looked offline). "Offline" means not reachable from the internet.

## Local development

Requires Node 22.12+ and Python 3.12+.

```bash
npm install
npm run dev          # http://localhost:4321
npm test             # TypeScript tests
npm run test:py      # Python tests
npm run check        # type check
npm run build
python scripts/privacy_check.py
```

`LIVE=1 npx vitest run tests/live.test.ts` pings the real servers.

## One-time setup

1. **Vercel:** Add New → Project → import this repo. Defaults are fine.
2. **Optional secret:** Settings → Secrets and variables → Actions → `PRIVACY_DENYLIST`, one private
   value per line (e.g. player names). Without it, CI still checks for IP addresses.
3. **Domain:** in Vercel, Domains → add `servers.justinhere.net`, then add the CNAME record it shows at
   the DNS provider.
4. **Search engines:** `noindex` is on. Set `noindex: false` in `src/site.config.ts` to allow indexing.
