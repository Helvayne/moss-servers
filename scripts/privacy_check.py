#!/usr/bin/env python3
"""Fail if tracked files contain IPv4 addresses or any value from the PRIVACY_DENYLIST secret.

PRIVACY_DENYLIST is newline-separated (real address, old DDNS names, ports, player names).
Findings report file and line only, never the matched value.
"""
import os, re, subprocess, sys

IPV4 = re.compile(r"(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])")
# Loopback, "this host", and the RFC 5737 documentation ranges are never real server addresses.
ALLOWED_IPV4 = re.compile(r"^(127\.|0\.0\.0\.0$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)")
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
            if any(not ALLOWED_IPV4.match(m.group()) for m in IPV4.finditer(line)):
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
