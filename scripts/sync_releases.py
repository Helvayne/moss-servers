#!/usr/bin/env python3
"""Write src/data/releases.json from this repo's GitHub releases.

Picks, per pack, the newest published release (not draft, not prerelease) whose tag is
<pack>-v<version>, and maps its <pack>-<version>-<variant>.mrpack (or .zip) assets to variants.
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
        asset_re = re.compile(rf"^{re.escape(pack)}-{re.escape(version)}-(?P<variant>[a-z0-9-]+)\.(?:mrpack|zip)$")
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
