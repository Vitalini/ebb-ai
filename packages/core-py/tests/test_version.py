"""The import package reads its version from the installed ``tidegap`` dist."""

import tomllib
from pathlib import Path

import tidegap


def test_version_matches_pyproject() -> None:
    pyproject = Path(__file__).resolve().parent.parent / "pyproject.toml"
    expected = tomllib.loads(pyproject.read_text())["project"]["version"]
    assert tidegap.__version__ == expected
