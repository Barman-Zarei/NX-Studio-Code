"""NX Bridge: JSON command surface used by the NX Studio Code extension.

Usage:  python -m nxcs.bridge <method>      (arguments: one JSON object on stdin)
Output: JSON lines on stdout. Zero or more {"event": ...} lines, then exactly one final line:
        {"ok": true, "result": ...}  or  {"ok": false, "kind": ..., "error": ...}
Python 3.8-compatible, standard library only (PyYAML is vendored as a fallback).
"""
import json, os, shutil, subprocess, sys, threading
from . import (__version__, intel, workspace, testintel, pipeline, gitcc, claude, review, releasepilot, depguard,
               forge, logexp, patch, profiler, saferun, taskgraph, secretscan, cilint, shells)

_lock = threading.Lock()


def emit(obj):
    with _lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def _shell_argv(cmd):
    bash = shells.find_bash()
    if bash:
        return [bash, "-eo", "pipefail", "-c", cmd]
    if os.name == "nt":
        return ["cmd", "/d", "/s", "/c", cmd]
    return ["sh", "-c", cmd]


# ---- individual methods -------------------------------------------------------------------------------

def m_ping(a):
    return {"nxcs": __version__, "python": sys.version.split()[0], "platform": sys.platform,
            "bash": bool(shells.find_bash()), "git": bool(shutil.which("git"))}


def m_analyze(a):
    return intel.analyze(a["root"])


def m_review(a):
    p = a["path"]
    out = review.review_python(p) if p.endswith(".py") else []
    out += [dict(x, kind="confirmed", file=p) for x in secretscan.scan_text(workspace.read_text(p), p)]
    return out


def m_secrets(a):
    return secretscan.scan(a["root"])


def m_test_discover(a):
    return testintel.discover(a["root"])


def m_test_run(a):
    r = testintel.run_unittest(a["root"], a.get("start", "."), a.get("pattern", "test_*.py"), a.get("timeout", 300))
    r["locations"] = testintel.failure_locations(r["output"])
    return r


def m_git(a, name):
    repo = gitcc.Repo(a["root"])
    kw = {k: v for k, v in a.items() if k != "root"}
    if name in ("stage", "unstage"):  # these take *paths
        return getattr(repo, name)(*kw.get("paths", ["."]))
    return getattr(repo, name)(**kw)


def m_pipeline_inspect(a):
    return pipeline.inspect(a["path"])


def m_pipeline_lint(a):
    return cilint.lint(a["path"])


def _closure(info, wanted):
    jobs, todo = info["jobs"], list(wanted or info["jobs"])
    seen = set()
    while todo:
        j = todo.pop()
        if j in seen:
            continue
        if j not in jobs:
            raise KeyError("unknown job %r" % j)
        seen.add(j)
        todo += jobs[j]["needs"]
    return seen


def m_pipeline_run(a):
    """Run workflow jobs locally in `needs` order (independent jobs concurrently). Only `run:` steps execute."""
    info = pipeline.inspect(a["path"])
    if info.get("error"):
        raise RuntimeError(info["error"])
    if not shells.find_bash():
        raise RuntimeError("no usable bash found (on Windows install Git for Windows; the WSL launcher is not used)")
    names = _closure(info, a.get("jobs"))
    cwd, restricted, timeout = a["cwd"], a.get("restricted", True), a.get("timeout", 600)
    g, details = taskgraph.Graph(), {}

    def make(job):
        def fn():
            res = pipeline.run_job(info, job, cwd, timeout=timeout, restricted=restricted,
                                   on_output=lambda line: emit({"event": "output", "job": job, "data": line}))
            details[job] = res
            return 0 if all(not r.get("returncode") for r in res) else 1
        return fn
    for j in names:
        g.add(j, make(j), [d for d in info["jobs"][j]["needs"] if d in names])
    status = g.run(workers=a.get("workers", 2), on_event=lambda n, s: emit({"event": "job", "job": n, "status": s}))
    return {"status": status, "steps": details, "unsupported": info.get("unsupported", [])}


def m_tasks_run(a):
    """Run `.nx/tasks.json`: {"tasks": {"name": {"cmd": "...", "deps": ["other"]}}}"""
    cfg_path = os.path.join(a["root"], ".nx", "tasks.json")
    cfg = json.loads(workspace.read_text(cfg_path))
    tasks = cfg.get("tasks", {})
    g = taskgraph.Graph()

    def make(name, cmd):
        def fn():
            r = saferun.run(_shell_argv(cmd), cwd=a["root"], timeout=a.get("timeout", 600), restricted=False,
                            on_output=lambda line: emit({"event": "output", "job": name, "data": line}))
            return r["returncode"]
        return fn
    for n, t in tasks.items():
        g.add(n, make(n, t["cmd"]), t.get("deps", []))
    g.validate()
    status = g.run(workers=a.get("workers", 2), on_event=lambda n, s: emit({"event": "job", "job": n, "status": s}))
    return {"status": status}


def m_tasks_list(a):
    p = os.path.join(a["root"], ".nx", "tasks.json")
    if not os.path.exists(p):
        return {}
    return {n: t.get("deps", []) for n, t in json.loads(workspace.read_text(p)).get("tasks", {}).items()}


def m_release(a):
    out = {}
    if "version" in a and "part" in a:
        out["next"] = releasepilot.bump(a["version"], a["part"])
    out["changelog"] = releasepilot.changelog(a["root"], a.get("since"))
    out["checklist"] = releasepilot.checklist(a["root"], a.get("tests_ok", False), out.get("next", a.get("version", "0.0.0")))
    return out


def m_deps_outdated(a):
    return depguard.outdated(a.get("python", sys.executable))


def m_deps_preview(a):
    return depguard.preview_upgrade(a["name"], a["current"], a["latest"])


def m_forge(a):
    return forge.create(a["kind"], a["dest"], a["name"])


def m_logs(a):
    text = a.get("text") or workspace.read_text(a["path"])
    if a.get("sanitize"):
        text = logexp.sanitize(text)
    return logexp.filter_lines(text, a.get("min_level", "INFO"), a.get("pattern")) if a.get("filter", True) else text


def m_profile(a):
    return profiler.profile_script(a["path"], a.get("top", 15))


def m_patch_hunks(a):
    return [{"index": i, "tag": t, "old": "".join(o), "new": "".join(n)} for i, t, o, n, _ in patch.hunks(a["old"], a["new"])]


def m_patch_apply(a):
    return patch.apply_to_file(a["path"], a["base_text"], a["new_text"], a.get("accept"))


def m_claude_ask(a):
    c = claude.Client(model=a.get("model", "claude-sonnet-4-6"), max_tokens=a.get("max_tokens", 2048))
    files = {k: workspace.read_text(os.path.join(a["root"], k)) for k in a.get("files", [])} if a.get("root") else None
    return c.ask(a["prompt"], system=a.get("system"), context_files=files)


def m_agent_propose(a):
    """Step 1 of the Project Agent: ask for a rewrite. NOTHING is written; the editor shows a diff and asks."""
    path = os.path.join(a["root"], a["rel_path"])
    base = workspace.read_text(path)
    c = claude.Client(model=a.get("model", "claude-sonnet-4-6"), max_tokens=a.get("max_tokens", 4096))
    r = c.ask("Task: %s\nReturn ONLY the complete new content of %s, no commentary, no code fences." % (a["task"], a["rel_path"]),
              context_files={a["rel_path"]: base})
    new = r["text"]
    if new.startswith("```"):  # tolerate a fenced reply
        new = "\n".join(l for l in new.splitlines() if not l.startswith("```")) + "\n"
    return {"base_text": base, "new_text": new, "diff": patch.diff(base, new, a["rel_path"]), "source": r["source"]}


METHODS = {
    "ping": m_ping, "analyze": m_analyze, "review": m_review, "secrets": m_secrets,
    "test.discover": m_test_discover, "test.run": m_test_run,
    "pipeline.inspect": m_pipeline_inspect, "pipeline.lint": m_pipeline_lint, "pipeline.run": m_pipeline_run,
    "tasks.run": m_tasks_run, "tasks.list": m_tasks_list, "release": m_release,
    "deps.outdated": m_deps_outdated, "deps.preview": m_deps_preview, "forge": m_forge, "logs": m_logs,
    "profile": m_profile, "patch.hunks": m_patch_hunks, "patch.apply": m_patch_apply,
    "claude.ask": m_claude_ask, "agent.propose": m_agent_propose,
}
GIT = ("status", "diff", "stage", "unstage", "commit", "log", "branches", "create_branch", "switch", "conflicts",
       "merge", "discard", "delete_branch", "push")
for _g in GIT:
    METHODS["git." + _g] = (lambda name: (lambda a: m_git(a, name)))(_g)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    if not argv or argv[0] not in METHODS:
        emit({"ok": False, "kind": "usage", "error": "unknown method; available: %s" % ", ".join(sorted(METHODS))})
        return 2
    try:
        raw = sys.stdin.read() if not sys.stdin.isatty() else ""
        args = json.loads(raw) if raw.strip() else {}
        emit({"ok": True, "result": METHODS[argv[0]](args)})
        return 0
    except claude.ClaudeError as e:
        emit({"ok": False, "kind": "claude:" + e.kind, "error": str(e)})
    except gitcc.GitError as e:
        emit({"ok": False, "kind": "git", "error": str(e)})
    except Exception as e:  # report, never crash silently
        emit({"ok": False, "kind": type(e).__name__, "error": str(e)})
    return 1


if __name__ == "__main__":
    sys.exit(main())
