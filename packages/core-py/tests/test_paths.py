"""Home-dir resolution since 0.19 (mirrors paths.test.ts): always ``~/.tidegap``."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tidegap.paths import resolve_tidegap_home


@pytest.fixture
def home(tmp_path: Path) -> Path:
    h = tmp_path / "home"
    h.mkdir()
    return h


def test_neither_exists_returns_target_and_creates_nothing(home: Path) -> None:
    warnings: list[str] = []
    assert resolve_tidegap_home(home, warn=warnings.append) == home / ".tidegap"
    assert not (home / ".tidegap").exists()
    assert warnings == []


def test_old_dir_is_left_in_place_and_named_once(home: Path) -> None:
    old = home / ".ebb-ai"
    old.mkdir()
    (old / "queue.db").write_text("Q")
    warnings: list[str] = []
    assert resolve_tidegap_home(home, warn=warnings.append) == home / ".tidegap"
    assert (old / "queue.db").read_text() == "Q"
    assert not (home / ".tidegap").exists()
    assert len(warnings) == 1
    assert str(old) in warnings[0]
    assert "0.18" in warnings[0]


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_link_left_by_018_is_ignored(home: Path) -> None:
    (home / ".tidegap").mkdir()
    os.symlink(home / ".tidegap", home / ".ebb-ai", target_is_directory=True)
    warnings: list[str] = []
    assert resolve_tidegap_home(home, warn=warnings.append) == home / ".tidegap"
    assert warnings == []


def test_default_writer_reports_once_per_home(home: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (home / ".ebb-ai").mkdir()
    resolve_tidegap_home(home)
    resolve_tidegap_home(home)
    err = capsys.readouterr().err
    assert err.count("no longer read") == 1
