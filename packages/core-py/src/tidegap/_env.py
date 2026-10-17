"""Read a Tidegap environment variable by its ``TIDEGAP_*`` name.

0.19 removed the 0.17 ``EBB_*`` fallback. A left-over ``EBB_<NAME>`` is never
used: when it is set and ``TIDEGAP_<NAME>`` is not, the first read of that
name prints one stderr line naming both.
"""

from __future__ import annotations

import os
import sys

KEY_PREFIX = "TIDEGAP_"
_OLD_PREFIX = "EBB_"

_reported: set[str] = set()


def report_ignored(old_name: str) -> None:
    """Print the one "no longer read" line for ``old_name`` (``EBB_*``), once per name."""
    if old_name in _reported:
        return
    _reported.add(old_name)
    new_name = KEY_PREFIX + old_name[len(_OLD_PREFIX) :]
    print(
        f"tidegap: {old_name} is no longer read (removed in 0.19); rename it to {new_name}",
        file=sys.stderr,
    )


def env_value(name: str) -> str | None:
    """``TIDEGAP_<name>``, else ``None``. A left-over ``EBB_<name>`` is only reported."""
    current = os.environ.get(KEY_PREFIX + name)
    if current is not None and current.strip() != "":
        return current
    old = os.environ.get(_OLD_PREFIX + name)
    if old is not None and old.strip() != "":
        report_ignored(_OLD_PREFIX + name)
    return current


def report_ignored_keys(values: dict[str, str]) -> None:
    """Report every ``EBB_*`` key in a parsed config file, once per key."""
    for key in values:
        if key.startswith(_OLD_PREFIX):
            report_ignored(key)
