"""Secret Scanner: finds likely hard-coded credentials in a workspace. Findings are masked, never echoed in full.

Honest scope: regex heuristics. Hits are CANDIDATES (false positives possible); absence of hits is not proof
that no secret exists.
"""
import os, re
from . import workspace

MAX_BYTES = 1 << 20  # skip files > 1 MiB
BINARY_EXT = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".zip", ".gz", ".7z", ".exe", ".dll", ".so", ".pdf",
              ".woff", ".woff2", ".ttf", ".mp3", ".mp4", ".pyc", ".class", ".jar", ".bundle", ".lock"}

PATTERNS = [
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b")),
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b")),
    ("hardcoded-secret", re.compile(r"""(?i)(api[_-]?key|secret|passwd|password|token)\s*[:=]\s*['"][^'"\s]{8,}['"]""")),
]
PLACEHOLDER = re.compile(r"(?i)(example|changeme|your[_-]?|xxxx|<.*>|\$\{|\{\{|dummy|placeholder|test)")


def mask(s):
    s = s.strip()
    return (s[:4] + "***" + "(%d chars)" % len(s)) if len(s) > 8 else "***"


def scan_text(text, name=""):
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        if len(line) > 2000:
            continue
        for kind, rx in PATTERNS:
            m = rx.search(line)
            if not m:
                continue
            if kind == "hardcoded-secret" and PLACEHOLDER.search(m.group(0)):
                continue
            out.append({"kind": kind, "line": i, "file": name, "preview": mask(m.group(0)),
                        "severity": "security", "msg": "possible %s: %s" % (kind, mask(m.group(0)))})
    return out


def scan(root, limit=500):
    findings = []
    for p in workspace.iter_files(root):
        if os.path.splitext(p)[1].lower() in BINARY_EXT:
            continue
        try:
            if os.path.getsize(p) > MAX_BYTES:
                continue
            text = workspace.read_text(p)
        except OSError:
            continue
        if "\x00" in text[:1024]:
            continue
        findings += scan_text(text, os.path.relpath(p, root))
        if len(findings) >= limit:
            break
    return findings[:limit]
