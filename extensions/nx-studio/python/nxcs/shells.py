"""Finding a bash that actually works.

On Windows the first `bash` on PATH is often C:\\Windows\\System32\\bash.exe, the WSL launcher, which fails with
exit code 1 when no Linux distribution is installed (this is the default on GitHub's Windows runners). Git for Windows
ships a real bash, so it is preferred and the WSL launcher is never used.
"""
import os, shutil, subprocess

_CACHE = None


def _candidates():
    c = []
    if os.name == "nt":
        roots = [os.environ.get("ProgramFiles"), os.environ.get("ProgramW6432"), os.environ.get("ProgramFiles(x86)")]
        local = os.environ.get("LOCALAPPDATA")
        roots.append(os.path.join(local, "Programs") if local else None)
        for r in roots:
            if r:
                c += [os.path.join(r, "Git", "bin", "bash.exe"), os.path.join(r, "Git", "usr", "bin", "bash.exe")]
        git = shutil.which("git")  # <GitRoot>\cmd\git.exe -> <GitRoot>\bin\bash.exe
        if git:
            base = os.path.dirname(os.path.dirname(git))
            c += [os.path.join(base, "bin", "bash.exe"), os.path.join(base, "usr", "bin", "bash.exe")]
    w = shutil.which("bash")
    if w:
        c.append(w)
    return c


def _is_wsl_launcher(path):
    p = path.lower().replace("/", "\\")
    return "\\windows\\system32\\" in p or "\\windows\\sysnative\\" in p or "\\windowsapps\\" in p


def find_bash():
    """Path of a working bash, or None. Result is cached."""
    global _CACHE
    if _CACHE is not None:
        return _CACHE or None
    seen = set()
    for c in _candidates():
        key = os.path.normcase(c)
        if key in seen or not os.path.isfile(c):
            continue
        seen.add(key)
        if os.name == "nt" and _is_wsl_launcher(c):
            continue
        try:
            r = subprocess.run([c, "-c", "echo nxok"], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            continue
        if r.returncode == 0 and "nxok" in r.stdout:
            _CACHE = c
            return c
    _CACHE = ""
    return None
