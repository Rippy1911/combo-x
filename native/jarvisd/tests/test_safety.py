"""Safety boundary rules."""

import unittest

from jarvisd.errors import PermissionDenied
from jarvisd import safety


class TestSensitiveApps(unittest.TestCase):
    def test_bundle_id(self):
        self.assertTrue(safety.is_sensitive_app("1Password", "com.1password.1password"))
        self.assertTrue(safety.is_sensitive_app("x", "com.apple.Terminal"))

    def test_polish_bank_name(self):
        self.assertTrue(safety.is_sensitive_app("mBank Online", None))
        self.assertTrue(safety.is_sensitive_app("ING Bank", None))
        self.assertTrue(safety.is_sensitive_app("Revolut", None))

    def test_safe_app(self):
        self.assertFalse(safety.is_sensitive_app("Safari", "com.apple.Safari"))

    def test_typing_unknown_denied(self):
        with self.assertRaises(PermissionDenied) as ctx:
            safety.assert_typing_target({"name": "", "bundleId": ""})
        self.assertEqual(ctx.exception.code, "denied:typing_target")

    def test_secure_field(self):
        self.assertTrue(safety.is_secure_field("AXSecureTextField"))
        with self.assertRaises(PermissionDenied) as ctx:
            safety.assert_not_secure_field("AXSecureTextField")
        self.assertEqual(ctx.exception.code, "denied:secure_field")

    def test_assert_capture_sensitive(self):
        with self.assertRaises(PermissionDenied) as ctx:
            safety.assert_capture_allowed({"name": "Terminal", "bundleId": "com.apple.Terminal"})
        self.assertEqual(ctx.exception.code, "denied:sensitive_app")


class TestCheckPath(unittest.TestCase):
    def setUp(self):
        self.home = "/Users/me"
        self.roots = ["~/projects", "~/Documents"]

    def fake_realpath(self, p):
        # Identity realpath for hermetic tests (no FS)
        return p

    def test_allowlisted(self):
        p = safety.check_path(
            "~/projects/base44/README.md",
            self.roots,
            home=self.home,
            realpath=self.fake_realpath,
        )
        self.assertEqual(p, "/Users/me/projects/base44/README.md")

    def test_reject_dotdot(self):
        with self.assertRaises(PermissionDenied):
            safety.check_path(
                "~/projects/../Documents/secret",
                ["~/projects"],
                home=self.home,
                realpath=self.fake_realpath,
            )

    def test_proj_evil_boundary(self):
        with self.assertRaises(PermissionDenied) as ctx:
            safety.check_path(
                "/Users/me/proj-evil/x",
                ["/Users/me/proj"],
                home=self.home,
                realpath=self.fake_realpath,
            )
        self.assertEqual(ctx.exception.code, "denied:path")

    def test_nul_byte(self):
        with self.assertRaises(PermissionDenied):
            safety.check_path(
                "/Users/me/projects/\0evil",
                self.roots,
                home=self.home,
                realpath=self.fake_realpath,
            )

    def test_relative_rejected(self):
        with self.assertRaises(PermissionDenied):
            safety.check_path(
                "relative/path",
                self.roots,
                home=self.home,
                realpath=self.fake_realpath,
            )

    def test_symlink_escape_via_injected_realpath(self):
        def sneaky(p):
            if p.startswith("/Users/me/projects/link"):
                return "/etc/passwd"
            return p

        with self.assertRaises(PermissionDenied):
            safety.check_path(
                "~/projects/link",
                self.roots,
                home=self.home,
                realpath=sneaky,
            )


if __name__ == "__main__":
    unittest.main()
