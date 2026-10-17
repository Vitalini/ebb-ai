"""The Tidegap data directory, ``~/.tidegap``.

Mirrors ``packages/core-ts/src/paths.ts``: both cores open the same ledger, so
they must agree on where it lives.

0.17 kept its state in ``~/.ebb-ai``; 0.18 moved it to ``~/.tidegap`` on first
use and left a link back. 0.19 removed that move: ``~/.ebb-ai`` is never
read. When it still holds data (a real directory, or a user's own link to a
directory other than ``~/.tidegap``), the process prints one stderr line
naming it, so a 0.17 install that skipped 0.18 does not silently start an
empty ledger. A ``~/.ebb-ai`` link back to ``~/.tidegap``, left by 0.18, is
ignored without a line.
"""

from __future__ import annotations

import os
import stat
import sys
from collections.abc import Callable
from pathlib import Path

TIDEGAP_HOME_DIR = ".tidegap"

# The 0.17 directory name; only checked to print the notice.
_OLD_HOME_DIR = ".ebb-ai"
_checked: set[str] = set()


def _warn_stderr(line: str) -> None:
    print(line, file=sys.stderr)


def _is_link(st: os.stat_result) -> bool:
    """A symlink or (on Windows) a junction."""
    if stat.S_ISLNK(st.st_mode):
        return True
    if sys.platform == "win32":
        tag = getattr(st, "st_reparse_tag", 0)
        return tag == getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", 0xA0000003)
    return False


def _old_home_data(old: Path, target: Path) -> Path | None:
    """Where a 0.17 ``~/.ebb-ai`` still holds data.

    ``old`` itself when it is a real directory, the directory it links to when
    that is not ``target``, else ``None`` (absent, a 0.18 link back to
    ``target``, or a dangling link).
    """
    try:
        st = os.lstat(old)
    except OSError:
        return None
    if not _is_link(st):
        return old if stat.S_ISDIR(st.st_mode) else None
    points = Path(os.path.realpath(old))
    if not points.is_dir():
        return None
    try:
        if os.path.samefile(points, target):
            return None
    except OSError:
        pass  # No ~/.tidegap yet: the link points somewhere else.
    return points


def resolve_tidegap_home(
    home: Path | None = None,
    *,
    warn: Callable[[str], None] | None = None,
) -> Path:
    """The Tidegap data directory (``~/.tidegap``). Creates nothing.

    Prints one line when a 0.17 ``~/.ebb-ai`` still holds data, once per
    process and home unless ``warn`` is given (tests).
    """
    base = Path(home) if home is not None else Path.home()
    target = base / TIDEGAP_HOME_DIR
    if warn is None:
        key = str(base)
        if key in _checked:
            return target
        _checked.add(key)
    old = base / _OLD_HOME_DIR
    data = _old_home_data(old, target)
    if data is not None:
        label = str(old) if data == old else f"{old} (a link to {data})"
        (warn or _warn_stderr)(
            f"tidegap: {label} is no longer read (removed in 0.19); tidegap uses {target}. "
            f"To keep its data, stop tidegap (daemon and MCP hosts), move {target} aside, "
            f"then rename {old} to {target}. "
            f"Otherwise move {old} out of your home directory to hide this line."
        )
    return target


def tidegap_path(*parts: str) -> Path:
    """A path inside the Tidegap data directory, e.g. ``tidegap_path("queue.db")``."""
    return resolve_tidegap_home().joinpath(*parts)
