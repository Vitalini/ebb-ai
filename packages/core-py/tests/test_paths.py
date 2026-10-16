"""Home-dir resolution and the ``~/.ebb-ai`` -> ``~/.tidegap`` move (mirrors paths.test.ts)."""

from __future__ import annotations

import errno
import os
from pathlib import Path

import pytest

from tidegap.paths import _Fs, resolve_tidegap_home


@pytest.fixture
def home(tmp_path: Path) -> Path:
    return tmp_path / "home"


def seed_legacy(home: Path, files: dict[str, str]) -> Path:
    legacy = home / ".ebb-ai"
    legacy.mkdir(parents=True)
    for name, body in files.items():
        (legacy / name).write_text(body)
    return legacy


def resolve(home: Path, warnings: list[str], fs: _Fs | None = None) -> Path:
    return resolve_tidegap_home(home, fs=fs or _Fs(), warn=warnings.append)


def test_neither_exists_returns_target_and_creates_nothing(home: Path) -> None:
    home.mkdir()
    warnings: list[str] = []
    assert resolve(home, warnings) == home / ".tidegap"
    assert not (home / ".tidegap").exists()
    assert warnings == []


def test_only_legacy_moves_everything_and_links_back(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q", "signing.key": "K", "config": "C"})
    warnings: list[str] = []
    target = home / ".tidegap"
    assert resolve(home, warnings) == target
    assert (target / "queue.db").read_text() == "Q"
    assert (target / "config").read_text() == "C"
    assert (home / ".ebb-ai").is_symlink()
    assert (home / ".ebb-ai" / "signing.key").read_text() == "K"
    assert warnings == []


def test_already_migrated_tree_is_left_alone(home: Path) -> None:
    """The tree a TS core (or an earlier run) migrated: target dir plus link."""
    target = home / ".tidegap"
    target.mkdir(parents=True)
    (target / "queue.db").write_text("Q")
    os.symlink(target, home / ".ebb-ai", target_is_directory=True)
    warnings: list[str] = []
    assert resolve(home, warnings) == target
    assert os.readlink(home / ".ebb-ai") == str(target)
    assert warnings == []


def test_target_with_only_logs_merges(home: Path) -> None:
    legacy = seed_legacy(home, {"queue.db": "Q", "signing.key": "K"})
    (legacy / "logs").mkdir()
    (legacy / "logs" / "ui-tick.log").write_text("old")
    (home / ".tidegap" / "logs").mkdir(parents=True)
    (home / ".tidegap" / "logs" / "tick.log").write_text("new")
    warnings: list[str] = []
    target = home / ".tidegap"
    assert resolve(home, warnings) == target
    assert (target / "queue.db").read_text() == "Q"
    assert (target / "logs" / "ui-tick.log").read_text() == "old"
    assert (target / "logs" / "tick.log").read_text() == "new"
    assert (home / ".ebb-ai").is_symlink()
    assert warnings == []


def test_both_hold_queue_db_nothing_moves(home: Path) -> None:
    seed_legacy(home, {"queue.db": "OLD"})
    (home / ".tidegap").mkdir()
    (home / ".tidegap" / "queue.db").write_text("NEW")
    warnings: list[str] = []
    assert resolve(home, warnings) == home / ".tidegap"
    assert (home / ".ebb-ai" / "queue.db").read_text() == "OLD"
    assert not (home / ".ebb-ai").is_symlink()
    assert len(warnings) == 1
    assert str(home / ".ebb-ai") in warnings[0] and str(home / ".tidegap") in warnings[0]


class _RacingFs(_Fs):
    def rename(self, src: Path, dst: Path) -> None:
        os.rename(src, dst)
        os.symlink(dst, src, target_is_directory=True)
        raise OSError(errno.EEXIST, "exists")


class _DeniedFs(_Fs):
    def rename(self, src: Path, dst: Path) -> None:
        raise OSError(errno.EPERM, "denied")


class _NoLinkFs(_Fs):
    def symlink(self, target: Path, link: Path) -> None:
        raise OSError(errno.EPERM, "no links")


def test_rename_race_rechecks_without_warning(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q"})
    warnings: list[str] = []
    assert resolve(home, warnings, _RacingFs()) == home / ".tidegap"
    assert warnings == []


def test_rename_eperm_uses_legacy_in_place(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q"})
    warnings: list[str] = []
    assert resolve(home, warnings, _DeniedFs()) == home / ".ebb-ai"
    assert (home / ".ebb-ai" / "queue.db").read_text() == "Q"
    assert len(warnings) == 1


def test_link_failure_moves_data_back(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q", "signing.key": "K"})
    warnings: list[str] = []
    assert resolve(home, warnings, _NoLinkFs()) == home / ".ebb-ai"
    assert (home / ".ebb-ai" / "queue.db").read_text() == "Q"
    assert not (home / ".tidegap").exists()
    assert len(warnings) == 1


def test_file_in_both_uses_legacy_in_place(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q", "config": "OLD"})
    (home / ".tidegap").mkdir()
    (home / ".tidegap" / "config").write_text("NEW")
    warnings: list[str] = []
    assert resolve(home, warnings) == home / ".ebb-ai"
    assert (home / ".ebb-ai" / "queue.db").read_text() == "Q"
    assert (home / ".tidegap" / "config").read_text() == "NEW"
    assert len(warnings) == 1


def test_merge_then_link_failure_moves_entries_back(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q"})
    (home / ".tidegap" / "logs").mkdir(parents=True)
    warnings: list[str] = []
    assert resolve(home, warnings, _NoLinkFs()) == home / ".ebb-ai"
    assert (home / ".ebb-ai" / "queue.db").read_text() == "Q"
    assert not (home / ".tidegap" / "queue.db").exists()
    assert (home / ".tidegap" / "logs").is_dir()
    assert len(warnings) == 1


def test_user_link_elsewhere_is_followed(home: Path) -> None:
    home.mkdir()
    elsewhere = home / "data-elsewhere"
    elsewhere.mkdir()
    (elsewhere / "queue.db").write_text("Q")
    os.symlink(elsewhere, home / ".ebb-ai", target_is_directory=True)
    warnings: list[str] = []
    assert resolve(home, warnings) == home / ".ebb-ai"
    assert (home / ".ebb-ai" / "queue.db").read_text() == "Q"
    assert not (home / ".tidegap").exists()
    assert len(warnings) == 1 and str(elsewhere) in warnings[0]


def test_user_link_elsewhere_and_target_data_uses_target(home: Path) -> None:
    home.mkdir()
    elsewhere = home / "data-elsewhere"
    elsewhere.mkdir()
    os.symlink(elsewhere, home / ".ebb-ai", target_is_directory=True)
    (home / ".tidegap").mkdir()
    (home / ".tidegap" / "signing.key").write_text("K")
    warnings: list[str] = []
    assert resolve(home, warnings) == home / ".tidegap"
    assert len(warnings) == 1


def test_dangling_link_returns_target_silently(home: Path) -> None:
    home.mkdir()
    os.symlink(home / "gone", home / ".ebb-ai", target_is_directory=True)
    warnings: list[str] = []
    assert resolve(home, warnings) == home / ".tidegap"
    assert warnings == []


class _NoLinkNoMkdirFs(_NoLinkFs):
    def mkdir(self, path: Path) -> None:
        raise OSError(errno.EACCES, "denied")


def test_rollback_mkdir_failure_never_raises(home: Path) -> None:
    seed_legacy(home, {"queue.db": "Q"})
    (home / ".tidegap" / "logs").mkdir(parents=True)
    warnings: list[str] = []
    resolve(home, warnings, _NoLinkNoMkdirFs())
    assert len(warnings) >= 1


def _resolve_in_child(home: str) -> str:
    return str(resolve_tidegap_home(Path(home), fs=_Fs(), warn=lambda _line: None))


def test_concurrent_first_runs_agree_and_keep_data(home: Path) -> None:
    import multiprocessing

    seed_legacy(home, {"queue.db": "Q", "signing.key": "K"})
    ctx = multiprocessing.get_context("spawn")
    with ctx.Pool(4) as pool:
        results = pool.map(_resolve_in_child, [str(home)] * 8)
    assert set(results) == {str(home / ".tidegap")}
    assert (home / ".tidegap" / "queue.db").read_text() == "Q"
    assert (home / ".tidegap" / "signing.key").read_text() == "K"
    assert (home / ".ebb-ai").is_symlink()
