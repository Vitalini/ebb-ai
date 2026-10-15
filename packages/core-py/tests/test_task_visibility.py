"""v0.17 task-visibility storage parity with the TS ledger.

The Python port reads and preserves the new columns a TS host writes,
backfills ``read_at`` when it migrates a v0.16 ledger, derives a redacted
title at enqueue, and redacts ``body_json.messages`` like the prompt.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

from ebb_ai import DeferOptions, ProviderCallSpec, Scheduler, mock_grid_feed
from ebb_ai.scheduler import _derive_title, _redact_body_json, _TaskStore

SECRET = "sk-ant-abc123DEF456ghi789JKL012mno"

V016_SCHEMA = """
CREATE TABLE tasks (
    task_id TEXT PRIMARY KEY, status TEXT NOT NULL, enqueued_at TEXT NOT NULL,
    scheduled_for TEXT, completed_at TEXT, region TEXT NOT NULL,
    carbon_budget_g REAL, result_json TEXT, error TEXT, receipt_json TEXT,
    intensity_source TEXT, body_json TEXT, estimated_carbon_g REAL,
    deadline TEXT, batch_id TEXT, routing_decision TEXT
);
"""

V017_COLUMNS = (
    "title TEXT, origin_host TEXT, origin_cwd TEXT, read_at TEXT, "
    "parent_task_id TEXT, deadline_kind TEXT, quota_provider TEXT"
)


def _columns(path: Path) -> set[str]:
    with sqlite3.connect(path) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM pragma_table_info('tasks')")}


async def test_v016_ledger_gets_columns_and_read_at_backfill(tmp_path: Path) -> None:
    path = tmp_path / "queue.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(V016_SCHEMA)
        conn.executescript(
            """
            INSERT INTO tasks (task_id, status, enqueued_at, completed_at, region)
              VALUES ('done', 'completed', '2026-10-01T00:00:00Z', '2026-10-01T01:00:00Z', 'DE');
            INSERT INTO tasks (task_id, status, enqueued_at, completed_at, region)
              VALUES ('bad', 'failed', '2026-10-01T00:00:00Z', '2026-10-01T02:00:00Z', 'DE');
            INSERT INTO tasks (task_id, status, enqueued_at, region)
              VALUES ('later', 'scheduled', '2026-10-01T00:00:00Z', 'DE');
            """
        )
    store = _TaskStore(str(path))
    await store.connect()
    try:
        done = await store.load("done")
        bad = await store.load("bad")
        later = await store.load("later")
        assert done is not None and done.read_at == "2026-10-01T01:00:00Z"
        assert bad is not None and bad.read_at == "2026-10-01T02:00:00Z"
        assert later is not None and later.read_at is None
        assert done.deadline_kind == "absolute"
    finally:
        await store.close()
    cols = _columns(path)
    assert {"title", "read_at", "deadline_kind", "quota_provider", "parent_task_id"} <= cols
    with sqlite3.connect(path) as conn:
        indexes = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "tasks_parent_idx" in indexes


async def test_reads_and_preserves_ts_written_fields(tmp_path: Path) -> None:
    path = tmp_path / "queue.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(V016_SCHEMA.replace("routing_decision TEXT", f"routing_decision TEXT, {V017_COLUMNS}"))
        conn.execute(
            "INSERT INTO tasks (task_id, status, enqueued_at, completed_at, region, title, "
            "origin_host, origin_cwd, read_at, parent_task_id, deadline_kind, quota_provider) "
            "VALUES ('t1', 'completed', '2026-10-10T00:00:00Z', '2026-10-10T01:00:00Z', 'DE', "
            "'Weekly digest', 'mcp', '/work', '2026-10-10T02:00:00Z', 'p0', 'quota_reset', 'claude')"
        )
    store = _TaskStore(str(path))
    await store.connect()
    try:
        record = await store.load("t1")
        assert record is not None
        assert record.title == "Weekly digest"
        assert record.origin_host == "mcp"
        assert record.origin_cwd == "/work"
        assert record.read_at == "2026-10-10T02:00:00Z"
        assert record.parent_task_id == "p0"
        assert record.deadline_kind == "quota_reset"
        assert record.quota_provider == "claude"
        # A status change written by this port keeps every TS-written field,
        # even when the in-memory record has lost them.
        record.status = "failed"
        record.title = "rewritten"
        record.read_at = None
        record.deadline_kind = None
        record.quota_provider = None
        await store.upsert(record)
        again = await store.load("t1")
        assert again is not None
        assert again.status == "failed"
        assert again.title == "Weekly digest"
        assert again.read_at == "2026-10-10T02:00:00Z"
        assert again.deadline_kind == "quota_reset"
        assert again.quota_provider == "claude"
    finally:
        await store.close()


async def test_enqueue_stores_redacted_title(tmp_path: Path) -> None:
    async with Scheduler(feed=mock_grid_feed(), db_path=str(tmp_path / "queue.db")) as sched:
        record = await sched.enqueue_provider_call(
            ProviderCallSpec(
                provider="anthropic",
                model="claude-sonnet-4-5",
                prompt=f"use key {SECRET} to summarize\nsecond line",
            ),
            DeferOptions(deadline=datetime.now(UTC) + timedelta(hours=6)),
        )
        stored = await sched._store.load(record.task_id)  # type: ignore[union-attr]
        assert stored is not None
        assert stored.title == "use key [REDACTED] to summarize"
        assert stored.deadline_kind == "absolute"


def test_derive_title_matches_ts_rules() -> None:
    assert _derive_title("\n\n  Summarize the report  \nnext", None) == "Summarize the report"
    long_title = _derive_title("x" * 200, None)
    assert long_title is not None
    assert len(long_title) == 80
    assert long_title.endswith("…")
    assert _derive_title("\x1b[31mred\x1b[0m title\x07", None) == "[31mred[0m title"
    assert _derive_title("   \n\t", None) is None


def test_redact_body_json_covers_messages() -> None:
    body = json.dumps(
        {
            "type": "provider_call",
            "prompt": "now",
            "messages": [
                {"role": "user", "content": f"earlier {SECRET}"},
                {"role": "assistant", "content": "ok"},
            ],
        }
    )
    redacted = _redact_body_json(body)
    assert redacted is not None
    assert SECRET not in redacted
    assert json.loads(redacted)["messages"][0]["content"] == "earlier [REDACTED]"
