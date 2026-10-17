"""``env_value`` since 0.19: only ``TIDEGAP_*`` is read; ``EBB_*`` is named once."""

from __future__ import annotations

import pytest

from tidegap import _env
from tidegap._env import env_value


@pytest.fixture(autouse=True)
def _fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(_env, "_reported", set())
    monkeypatch.delenv("TIDEGAP_EIA_API_KEY", raising=False)
    monkeypatch.delenv("EBB_EIA_API_KEY", raising=False)


def test_only_ebb_set_returns_none_and_prints_once(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("EBB_EIA_API_KEY", "old")
    assert env_value("EIA_API_KEY") is None
    assert env_value("EIA_API_KEY") is None
    err = capsys.readouterr().err.strip().splitlines()
    assert len(err) == 1
    assert "EBB_EIA_API_KEY" in err[0] and "TIDEGAP_EIA_API_KEY" in err[0]


def test_tidegap_wins_without_a_line(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("EBB_EIA_API_KEY", "old")
    monkeypatch.setenv("TIDEGAP_EIA_API_KEY", "new")
    assert env_value("EIA_API_KEY") == "new"
    assert capsys.readouterr().err == ""


def test_neither_set(capsys: pytest.CaptureFixture[str]) -> None:
    assert env_value("EIA_API_KEY") is None
    assert capsys.readouterr().err == ""
