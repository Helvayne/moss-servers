#!/usr/bin/env python3
"""Prepare Modrinth App .mrpack exports for public release.

Usage:
  python scripts/prepare_pack.py <pack> <version> <full.mrpack> <lite.mrpack>
                                 [--update mods.zip] [--content src/content/servers] [--out dist/packs]

For each export it writes <out>/<pack>-<version>-<variant>.mrpack with:
  - overrides/servers.dat replaced by a single entry for this pack's server
  - lastServer removed from options.txt
  - saves, screenshots, logs, crash reports, minimap waypoints and command history removed
  - modrinth.index.json versionId/name set
--update also writes <out>/<pack>-<version>-update.zip: just the mods/ and resourcepacks/ files from
a "drop these into your instance" zip (one wrapper folder is allowed; caches and configs are dropped).
Fails if the two exports disagree on Minecraft/loader versions, if the lite export contains
Distant Horizons server data, or if any output is too big for a GitHub release asset.
Standard library only.
"""
import argparse, json, os, re, struct, sys, zipfile

OVERRIDE_ROOTS = ("overrides/", "client-overrides/", "server-overrides/")
REMOVED_DIRS = {"saves", "screenshots", "logs", "crash-reports", "xaero", "XaeroWaypoints", "XaeroWorldMap",
                "journeymap"}
REMOVED_FILES = {"command_history.txt", "servers.dat_old"}
DH_DIR = "Distant_Horizons_server_data"
MAX_RELEASE_BYTES = 2 * 1024**3 - 1  # GitHub release assets must be under 2 GiB


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


def check_size(path):
    size = os.path.getsize(path)
    if size > MAX_RELEASE_BYTES:
        sys.exit(f"{path} is {size / 1e9:.2f} GB; GitHub release files must be under 2 GiB. "
                 f"For a full pack, export without the Distant Horizons cache.")


def prepare_update_zip(src, dst):
    """Copy only top-level files in mods/ plus everything in resourcepacks/ (wrapper folder stripped)."""
    with zipfile.ZipFile(src) as zin:
        infos = [i for i in zin.infolist() if not i.is_dir()]
        firsts = {i.filename.split("/", 1)[0] for i in infos}
        wrapper = next(iter(firsts)) + "/" if len(firsts) == 1 and firsts - {"mods", "resourcepacks"} else ""
        kept = dropped = jars = 0
        os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
        with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in infos:
                rel = info.filename[len(wrapper):]
                parts = rel.split("/")
                keep = (parts[0] == "mods" and len(parts) == 2) or (parts[0] == "resourcepacks" and len(parts) >= 2)
                if not keep:
                    dropped += 1
                    continue
                zi = zipfile.ZipInfo(rel, info.date_time)
                zi.compress_type = zipfile.ZIP_DEFLATED
                with zin.open(info) as fsrc, zout.open(zi, "w") as fdst:
                    while chunk := fsrc.read(1 << 20):
                        fdst.write(chunk)
                kept += 1
                jars += rel.endswith(".jar") and parts[0] == "mods"
    if jars == 0:
        os.remove(dst)
        sys.exit(f"{src}: no mods/*.jar found")
    return {"size": os.path.getsize(dst), "jars": jars, "files": kept, "dropped": dropped}


def _deps(path):
    with zipfile.ZipFile(path) as z:
        return json.loads(z.read("modrinth.index.json")).get("dependencies", {})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pack")
    ap.add_argument("version")
    ap.add_argument("full")
    ap.add_argument("lite")
    ap.add_argument("--update", help="optional mods/resourcepacks zip for players updating by hand")
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
        check_size(dst)
        print(f"{variant:6} {dst}\n       {r['size'] / 1e6:.1f} MB, {r['mods']} indexed mods, "
              f"{r['overrides']} override files, Minecraft {r['minecraft']}, {r['loader']}")
    if args.update:
        dst = os.path.join(args.out, f"{args.pack}-{args.version}-update.zip")
        r = prepare_update_zip(args.update, dst)
        check_size(dst)
        print(f"update {dst}\n       {r['size'] / 1e6:.1f} MB, {r['jars']} mod jars, {r['files']} files kept, "
              f"{r['dropped']} dropped (caches, configs, other folders)")
    print(f"\nCreate a GitHub release with tag: {args.pack}-v{args.version}")
    print("Attach the files above, then publish.")


if __name__ == "__main__":
    main()
