"""NX Code Studio core (Feature 50). Python 3.8-compatible, standard library only."""
__version__ = "0.1.0"

# Vendored pure-Python PyYAML is a *fallback*: a system-installed PyYAML wins because this path is appended last.
import os as _os, sys as _sys
_v = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "_vendor")
if _v not in _sys.path:
    _sys.path.append(_v)
