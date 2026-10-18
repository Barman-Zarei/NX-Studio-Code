import json, os, subprocess, sys, tempfile, unittest
from nxcs import secretscan, cilint, bridge

PY_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _bridge(method, args):
    r = subprocess.run([sys.executable, "-m", "nxcs.bridge", method], input=json.dumps(args), cwd=PY_DIR,
                       capture_output=True, text=True, env=dict(os.environ, PYTHONPATH=PY_DIR, PYTHONUTF8="1"))
    lines = [json.loads(l) for l in r.stdout.splitlines() if l.strip()]
    return lines[:-1], lines[-1]


class SecretScan(unittest.TestCase):
    def test_finds_and_masks(self):
        tok = "ghp_" + "a" * 36
        f = secretscan.scan_text('x = "%s"\n' % tok, "a.py")
        self.assertEqual(f[0]["kind"], "github-token")
        self.assertNotIn(tok, json.dumps(f))  # never echoed in full

    def test_placeholders_ignored(self):
        self.assertEqual(secretscan.scan_text('password = "your-password-here"\n'), [])


class CiLint(unittest.TestCase):
    def _lint(self, body):
        with tempfile.NamedTemporaryFile("w", suffix=".yml", delete=False) as t:
            t.write(body)
        try:
            return cilint.lint(t.name)
        finally:
            os.unlink(t.name)

    def test_injection_unpinned_permissions(self):
        f = self._lint("on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n"
                       "      - uses: actions/checkout@v4\n      - run: echo ${{ github.event.issue.title }}\n")
        msgs = " | ".join(x["msg"] for x in f)
        self.assertIn("injection", msgs); self.assertIn("pinned", msgs); self.assertIn("permissions", msgs)

    def test_pinned_sha_clean(self):
        f = self._lint("on: push\npermissions: {}\njobs:\n  a:\n    runs-on: x\n    timeout-minutes: 5\n    steps:\n"
                       "      - uses: actions/checkout@" + "a" * 40 + "\n")
        self.assertEqual(f, [])

    def test_pr_target_checkout_head(self):
        f = self._lint("on: pull_request_target\npermissions: {}\njobs:\n  a:\n    runs-on: x\n    timeout-minutes: 5\n    steps:\n"
                       "      - uses: actions/checkout@" + "b" * 40 + "\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}\n")
        self.assertTrue(any(x["severity"] == "error" for x in f))

    def test_invalid_yaml(self):
        self.assertEqual(self._lint("a: [\n")[0]["severity"], "error")


class Bridge(unittest.TestCase):
    def test_unknown_method(self):
        _, fin = _bridge("nope", {})
        self.assertFalse(fin["ok"]); self.assertEqual(fin["kind"], "usage")

    def test_task_graph_with_failure_skips_dependents(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, ".nx"))
            json.dump({"tasks": {"a": {"cmd": "exit 0"}, "b": {"cmd": "exit 3", "deps": ["a"]}, "c": {"cmd": "exit 0", "deps": ["b"]}}},
                      open(os.path.join(d, ".nx", "tasks.json"), "w"))
            ev, fin = _bridge("tasks.run", {"root": d})
        self.assertTrue(fin["ok"]); self.assertEqual(fin["result"]["status"], {"a": "ok", "b": "failed", "c": "skipped"})
        self.assertTrue(any(e.get("event") == "job" for e in ev))

    def test_patch_apply_refuses_when_file_changed(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "f.txt"); open(p, "w").write("new user edit\n")
            _, fin = _bridge("patch.apply", {"path": p, "base_text": "old\n", "new_text": "agent\n"})
        self.assertFalse(fin["result"]["applied"])

    def test_git_destructive_needs_confirm(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d]); 
            _, fin = _bridge("git.discard", {"root": d, "path": "x"})
        self.assertFalse(fin["ok"]); self.assertIn("confirm", fin["error"])


if __name__ == "__main__":
    unittest.main()
