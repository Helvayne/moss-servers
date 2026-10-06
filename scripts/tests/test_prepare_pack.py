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

    def test_main_writes_update_zip(self):
        full, lite = os.path.join(self.d, "f.mrpack"), os.path.join(self.d, "l.mrpack")
        make_pack(full)
        make_pack(lite)
        upd = os.path.join(self.d, "u.zip")
        with zipfile.ZipFile(upd, "w") as z:
            z.writestr("Wrap/mods/a.jar", b"jar")
        out = os.path.join(self.d, "out")
        pp.main(["cogsandcurses", "4.0.0", full, lite, "--update", upd, "--content", self.content, "--out", out])
        self.assertIn("cogsandcurses-4.0.0-update.zip", os.listdir(out))


class UpdateZipTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def make_zip(self, entries):
        p = os.path.join(self.d, "in.zip")
        with zipfile.ZipFile(p, "w") as z:
            for name, data in entries.items():
                z.writestr(name, data)
        return p

    def test_keeps_mods_and_resourcepacks_under_a_wrapper_folder(self):
        src = self.make_zip({
            "CnC_UpdateYourself/mods/a.jar": b"jar",
            "CnC_UpdateYourself/mods/old.jar.disabled": b"x",
            "CnC_UpdateYourself/resourcepacks/r.zip": b"rp",
            "CnC_UpdateYourself/mods/mcef-cache/Visited Links": b"history",
            "CnC_UpdateYourself/mods/mcef-cache/Cookies": b"c",
            "CnC_UpdateYourself/config/x.toml": b"x",
        })
        dst = os.path.join(self.d, "out.zip")
        report = pp.prepare_update_zip(src, dst)
        with zipfile.ZipFile(dst) as z:
            self.assertEqual(sorted(z.namelist()),
                             ["mods/a.jar", "mods/old.jar.disabled", "resourcepacks/r.zip"])
        self.assertEqual(report["jars"], 1)
        self.assertEqual(report["dropped"], 3)

    def test_rejects_a_zip_without_mods(self):
        src = self.make_zip({"resourcepacks/r.zip": b"rp"})
        with self.assertRaises(SystemExit):
            pp.prepare_update_zip(src, os.path.join(self.d, "o.zip"))


class SizeLimitTest(unittest.TestCase):
    def test_rejects_files_over_the_release_limit(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "big.bin")
            with open(p, "wb") as f:
                f.truncate(pp.MAX_RELEASE_BYTES + 1)
            with self.assertRaises(SystemExit):
                pp.check_size(p)


if __name__ == "__main__":
    unittest.main()
