"""``ebb_ai`` is now ``tidegap``. This shim re-exports it and stops receiving updates.

``import ebb_ai`` gives the ``tidegap`` API and prints one deprecation line to
stderr. Submodules resolve lazily to their ``tidegap`` twins, so
``from ebb_ai.grid import ...`` keeps working without importing optional
provider extras up front.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import sys

import tidegap
from tidegap import *  # noqa: F403

__all__ = list(getattr(tidegap, "__all__", []))
__version__ = tidegap.__version__

print(
    "ebb-ai is now tidegap; install tidegap and import tidegap "
    "(this package stops receiving updates).",
    file=sys.stderr,
)

_PREFIX = __name__ + "."


class _AliasLoader(importlib.abc.Loader):
    def __init__(self, real: str) -> None:
        self._real = real

    def create_module(self, spec):  # type: ignore[no-untyped-def]
        return importlib.import_module(self._real)

    def exec_module(self, module) -> None:  # type: ignore[no-untyped-def]
        return None


class _AliasFinder(importlib.abc.MetaPathFinder):
    """Maps ``ebb_ai.<x>`` to the already-importable ``tidegap.<x>``."""

    def find_spec(self, fullname, path=None, target=None):  # type: ignore[no-untyped-def]
        if not fullname.startswith(_PREFIX):
            return None
        real = "tidegap." + fullname[len(_PREFIX) :]
        if importlib.util.find_spec(real) is None:
            return None
        return importlib.util.spec_from_loader(fullname, _AliasLoader(real))


if not any(isinstance(f, _AliasFinder) for f in sys.meta_path):
    sys.meta_path.insert(0, _AliasFinder())
