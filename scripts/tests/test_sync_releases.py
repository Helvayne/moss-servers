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

    def test_accepts_zip_assets(self):
        out = build_releases([rel("p-v4.0.0", "2026-10-06T00:00:00Z",
                                  [("p-4.0.0-full.mrpack", 2), ("p-4.0.0-update.zip", 9)])])
        self.assertEqual(sorted(out["packs"]["p"]["assets"]), ["full", "update"])
        self.assertEqual(out["packs"]["p"]["assets"]["update"]["name"], "p-4.0.0-update.zip")

    def test_ignores_assets_with_other_names(self):
        out = build_releases([rel("p-v1.0.0", "2026-01-01T00:00:00Z", [("notes.txt", 1), ("p-1.0.0-full.mrpack", 2)])])
        self.assertEqual(list(out["packs"]["p"]["assets"]), ["full"])


if __name__ == "__main__":
    unittest.main()
