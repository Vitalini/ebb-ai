"""Shared pytest fixtures for the ebb-ai test suite."""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    """Redirect ``~`` to a throwaway directory for every test.

    The Scheduler signs receipts by default (v0.11), creating an Ed25519
    keypair at ``~/.ebb-ai/signing.key`` on first dispatch. Pointing
    ``HOME`` at a per-test temp dir keeps the suite from writing to the
    developer's real home, while ``default_signing_key_path()`` still
    resolves to ``<tmp>/.ebb-ai/signing.key`` — same basename and parent,
    so path-shape assertions in ``test_sign.py`` keep passing.
    """
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))  # Windows fallback
