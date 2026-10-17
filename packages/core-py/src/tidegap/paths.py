"""The Tidegap data directory, ``~/.tidegap``.

Mirrors ``packages/core-ts/src/paths.ts``: both cores open the same ledger, so
they must agree on where it lives.

0.17 kept its state in ``~/.ebb-ai``; 0.18 moved it to ``~/.tidegap`` on first
use and left a link back. 0.19 removed that move: a real ``~/.ebb-ai``
directory is never read. When one is found, the process prints one stderr
line naming it, so a 0.17 install that skipped 0.18 does not silently start an
empty ledger. A ``~/.ebb-ai`` link left behind by 0.18 is ignored without a
line.
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


def _is_real_dir(path: Path) -> bool:
    """A directory that is not a symlink or (on Windows) a junction."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    if not stat.S_ISDIR(st.st_mode):
        return False
    if sys.platform == "win32":
        tag = getattr(st, "st_reparse_tag", 0)
        return tag != getattr(stat, "IO_REPARSE_TAG_MOUNT_POINT", 0xA0000003)
    return True


def resolve_tidegap_home(
    home: Path | None = None,
    *,
    warn: Callable[[str], None] | None = None,
) -> Path:
    """The Tidegap data directory (``~/.tidegap``). Creates nothing.

    Prints one line when a 0.17 ``~/.ebb-ai`` directory is still there, once
    per process and home unless ``warn`` is given (tests).
    """
    base = Path(home) if home is not None else Path.home()
    target = base / TIDEGAP_HOME_DIR
    if warn is None:
        key = str(base)
        if key in _checked:
            return target
        _checked.add(key)
    old = base / _OLD_HOME_DIR
    if _is_real_dir(old):
        (warn or _warn_stderr)(
            f"tidegap: {old} is no longer read (removed in 0.19); tidegap uses {target}. "
            f"Upgrade through 0.18 once, or move its contents to {target} by hand."
        )
    return target


def tidegap_path(*parts: str) -> Path:
    """A path inside the Tidegap data directory, e.g. ``tidegap_path("queue.db")``."""
    return resolve_tidegap_home().joinpath(*parts)
