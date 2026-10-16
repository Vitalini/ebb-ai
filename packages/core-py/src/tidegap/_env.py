"""Read a Tidegap environment variable, falling back to its 0.17 ``EBB_*`` name.

``TIDEGAP_<NAME>`` wins when set. Otherwise ``EBB_<NAME>`` is read, and the
first fallback for each name prints one deprecation line to stderr. The
fallback is removed in 0.19.
"""

from __future__ import annotations

import os
import sys

KEY_PREFIX = "TIDEGAP_"
LEGACY_KEY_PREFIX = "EBB_"

_reported: set[str] = set()


def env_value(name: str) -> str | None:
    """``TIDEGAP_<name>``, else ``EBB_<name>`` (with one stderr line), else ``None``."""
    current = os.environ.get(KEY_PREFIX + name)
    if current is not None and current.strip() != "":
        return current
    legacy = os.environ.get(LEGACY_KEY_PREFIX + name)
    if legacy is not None and legacy.strip() != "":
        if name not in _reported:
            _reported.add(name)
            print(
                f"tidegap: rename EBB_{name} -> TIDEGAP_{name}; "
                "the EBB_* names stop working in 0.19.",
                file=sys.stderr,
            )
        return legacy
    return current


def with_tidegap_keys(values: dict[str, str]) -> dict[str, str]:
    """Fold ``EBB_*`` keys into ``TIDEGAP_*`` names; a ``TIDEGAP_*`` key wins."""
    out = {k: v for k, v in values.items() if not k.startswith(LEGACY_KEY_PREFIX)}
    for key, value in values.items():
        if key.startswith(LEGACY_KEY_PREFIX):
            out.setdefault(KEY_PREFIX + key[len(LEGACY_KEY_PREFIX) :], value)
    return out
