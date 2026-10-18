"""CI Doctor: static lint of GitHub Actions workflows (supply-chain and injection hygiene).

Honest scope: deterministic, text/YAML-structure checks only. It does not run the workflow and does not
know about org-level policies.
"""
import re
from . import workspace

try:
    import yaml
except ImportError:  # vendored fallback (pure-Python PyYAML)
    import os, sys
    sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_vendor"))
    import yaml

SHA = re.compile(r"^[0-9a-f]{40}$")
UNTRUSTED = re.compile(r"\$\{\{\s*github\.(event\.(issue|pull_request|comment|review|head_commit|pages)[^}]*"
                       r"(title|body|name|label|ref|message|email|login)|head_ref)[^}]*\}\}")


def _line(text, needle):
    for i, l in enumerate(text.splitlines(), 1):
        if needle and needle in l:
            return i
    return 1


def lint(path):
    text = workspace.read_text(path)
    try:
        wf = yaml.safe_load(text) or {}
    except yaml.YAMLError as e:
        return [{"severity": "error", "line": 1, "msg": "invalid YAML: %s" % str(e).splitlines()[0], "file": path}]
    f = []

    def add(sev, needle, msg):
        f.append({"severity": sev, "line": _line(text, needle), "msg": msg, "file": path})

    on = wf.get("on", wf.get(True))  # PyYAML (YAML 1.1) parses the key `on` as boolean True
    triggers = on if isinstance(on, (dict, list)) else [on]
    if "permissions" not in wf:
        add("warning", "jobs:", "no top-level `permissions:`; GITHUB_TOKEN may get broad default rights")
    for jn, job in (wf.get("jobs") or {}).items():
        if not isinstance(job, dict):
            continue
        if "timeout-minutes" not in job and "uses" not in job:
            add("info", jn + ":", "job %s has no timeout-minutes (default is 360 min)" % jn)
        for s in job.get("steps", []) or []:
            u = s.get("uses")
            if u and not u.startswith("./") and not u.startswith("docker://"):
                ref = u.split("@", 1)[1] if "@" in u else ""
                if not SHA.match(ref):
                    add("warning", u, "%s is not pinned to a full commit SHA (supply-chain risk)" % u)
                if u.startswith("actions/checkout") and "pull_request_target" in triggers:
                    w = s.get("with") or {}
                    if "pull_request.head" in str(w.get("ref", "")):
                        add("error", "pull_request.head", "pull_request_target checks out PR head code: "
                            "untrusted code runs with write token/secrets")
            run = s.get("run")
            if run and UNTRUSTED.search(run):
                add("error", UNTRUSTED.search(run).group(0)[:30], "untrusted event data interpolated into `run:` "
                    "(script injection); pass it through an env var instead")
    return sorted(f, key=lambda x: x["line"])
