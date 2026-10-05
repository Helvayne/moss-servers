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
        ip = ".".join(["10", "20", "30", "40"])  # built at runtime so this file passes the check itself
        p = self.write("a.md", f"ok\nconnect to {ip} now\n")
        self.assertEqual(scan([p], []), [(p, 2, "ipv4")])

    def test_allows_loopback_and_documentation_ranges(self):
        p = self.write("e.md", "127.0.0.1 and 192.0.2.10 and 203.0.113.5\n")
        self.assertEqual(scan([p], []), [])

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
            f.write(b"\x00\x01" + ".".join(["10", "0", "0", "1"]).encode())
        self.assertEqual(scan([p], []), [])


if __name__ == "__main__":
    unittest.main()
