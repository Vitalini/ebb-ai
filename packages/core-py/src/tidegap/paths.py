"""The Tidegap data directory and the one-time move from the 0.17 name.

Mirrors ``packages/core-ts/src/paths.ts`` rule for rule: both cores open the
same ledger, so they must agree on where it lives.

0.17 kept its state in ``~/.ebb-ai``; 0.18 uses ``~/.tidegap``. The first
process that needs the directory moves the old one and leaves ``~/.ebb-ai``
as a link to the new one, so a 0.17 process keeps reading the same ledger.

- ``~/.ebb-ai`` absent, or already a link: use ``~/.tidegap``.
- ``~/.ebb-ai`` a real dir, ``~/.tidegap`` absent: rename, then link back.
- ``~/.ebb-ai`` a real dir, ``~/.tidegap`` present without ``queue.db`` and
  ``signing.key``: move each entry in (directories merge), remove the empty
  ``~/.ebb-ai``, link back. A file present in both stops the move.
- Both hold a ``queue.db`` or a ``signing.key``: change nothing, use
  ``~/.tidegap``.
- The link cannot be made: move the data back, use ``~/.ebb-ai`` in place.
- A rename that loses a race (source gone, target appeared): re-check.
- Any other rename failure: use ``~/.ebb-ai`` in place.

Nothing is deleted except the emptied ``~/.ebb-ai`` directory itself.
"""

from __future__ import annotations

import contextlib
import errno
import os
import sys
from collections.abc import Callable
from pathlib import Path

TIDEGAP_HOME_DIR = ".tidegap"
LEGACY_HOME_DIR = ".ebb-ai"

_DATA_FILES = ("queue.db", "signing.key")
_RACE_ERRNOS = {errno.ENOENT, errno.EEXIST, errno.ENOTEMPTY}
_MAX_ATTEMPTS = 3
_resolved: dict[str, Path] = {}


class _Fs:
    """The filesystem calls the resolver makes; tests replace single calls."""

    def rename(self, src: Path, dst: Path) -> None:
        os.rename(src, dst)

    def symlink(self, target: Path, link: Path) -> None:
        os.symlink(target, link, target_is_directory=True)

    def rmdir(self, path: Path) -> None:
        os.rmdir(path)

    def mkdir(self, path: Path) -> None:
        os.mkdir(path)


def _warn_stderr(line: str) -> None:
    print(line, file=sys.stderr)


def resolve_tidegap_home(
    home: Path | None = None,
    *,
    fs: _Fs | None = None,
    warn: Callable[[str], None] | None = None,
) -> Path:
    """The Tidegap data directory, after moving a 0.17 ``~/.ebb-ai`` into it.

    Returns ``~/.ebb-ai`` only when the move could not be completed safely.
    Creates nothing when neither directory exists. Each home is resolved
    once per process unless ``fs`` or ``warn`` is given (tests).
    """
    base = Path(home) if home is not None else Path.home()
    cacheable = fs is None and warn is None
    key = str(base)
    if cacheable and key in _resolved:
        return _resolved[key]
    result = _migrate(base, fs or _Fs(), warn or _warn_stderr)
    if cacheable:
        _resolved[key] = result
    return result


def tidegap_path(*parts: str) -> Path:
    """A path inside the Tidegap data directory, e.g. ``tidegap_path("queue.db")``."""
    return resolve_tidegap_home().joinpath(*parts)


def _exists(path: Path) -> bool:
    return os.path.lexists(path)


def _migrate(home: Path, fs: _Fs, warn: Callable[[str], None]) -> Path:
    legacy = home / LEGACY_HOME_DIR
    target = home / TIDEGAP_HOME_DIR

    def in_place(why: str) -> Path:
        warn(f"tidegap: could not move {legacy} to {target} ({why}); using {legacy} for now.")
        return legacy

    def link() -> bool:
        try:
            fs.symlink(target, legacy)
            return True
        except OSError:
            return False

    for _ in range(_MAX_ATTEMPTS):
        if not legacy.is_dir() or legacy.is_symlink():
            return target

        if not _exists(target):
            try:
                fs.rename(legacy, target)
            except OSError as err:
                if err.errno in _RACE_ERRNOS:
                    continue
                return in_place(err.strerror or str(err))
            if link():
                return target
            try:
                fs.rename(target, legacy)
            except OSError as err:
                warn(
                    f"tidegap: moved {legacy} to {target} but could not link it back "
                    f"or undo the move ({err.strerror or err})."
                )
                return target
            return in_place("cannot create the link")

        if any(_exists(target / name) for name in _DATA_FILES):
            warn(
                f"tidegap: both {legacy} and {target} hold data; using {target}. "
                f"Move anything you need from {legacy} by hand."
            )
            return target

        plan = _plan_merge(legacy, target)
        if isinstance(plan, str):
            return in_place(plan)
        done: list[tuple[Path, Path]] = []
        try:
            for src, dst in plan:
                fs.rename(src, dst)
                done.append((src, dst))
        except OSError as err:
            _undo(fs, done)
            if err.errno in _RACE_ERRNOS:
                continue
            return in_place(err.strerror or str(err))

        emptied = _empty_dirs(legacy)
        try:
            for d in emptied:
                fs.rmdir(d)
        except OSError as err:
            _restore_dirs(fs, emptied)
            _undo(fs, done)
            return in_place(err.strerror or str(err))
        if link():
            return target
        _restore_dirs(fs, emptied)
        _undo(fs, done)
        return in_place("cannot create the link")
    return in_place("the directory kept changing")


def _undo(fs: _Fs, done: list[tuple[Path, Path]]) -> None:
    """Move the renamed entries back, newest first. Best effort."""
    for src, dst in reversed(done):
        with contextlib.suppress(OSError):
            fs.rename(dst, src)


def _restore_dirs(fs: _Fs, emptied: list[Path]) -> None:
    """Recreate removed directories, parents first."""
    for d in reversed(emptied):
        if not _exists(d):
            fs.mkdir(d)


def _plan_merge(src_dir: Path, dst_dir: Path) -> list[tuple[Path, Path]] | str:
    out: list[tuple[Path, Path]] = []
    for entry in sorted(os.listdir(src_dir)):
        src = src_dir / entry
        dst = dst_dir / entry
        if not _exists(dst):
            out.append((src, dst))
            continue
        both_dirs = (
            src.is_dir() and not src.is_symlink() and dst.is_dir() and not dst.is_symlink()
        )
        if both_dirs:
            inner = _plan_merge(src, dst)
            if isinstance(inner, str):
                return inner
            out.extend(inner)
            continue
        return f"{entry} exists in both"
    return out


def _empty_dirs(path: Path) -> list[Path]:
    """``path`` and the directories under it, deepest first."""
    out: list[Path] = []
    for entry in sorted(os.listdir(path)):
        sub = path / entry
        if sub.is_dir() and not sub.is_symlink():
            out.extend(_empty_dirs(sub))
    out.append(path)
    return out
