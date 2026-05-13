"""ebb-ai — carbon-aware scheduling for agentic AI workflows.

Python port of ``@ebb-ai/core``. Public surface mirrors the
TypeScript package so the two stay in sync.

Quick start
-----------

>>> import asyncio
>>> from ebb_ai import defer
>>> async def main():
...     return await defer(
...         lambda: 42,
...         deadline="2099-01-01T00:00:00Z",
...         carbon_budget_g=5,
...         region="US-CAL-CISO",
...     )
>>> asyncio.run(main())
42

The default scheduler runs in-memory. For durable receipts and
crash-recovery, instantiate a :class:`Scheduler` with a SQLite
``db_path``:

>>> from ebb_ai import Scheduler
>>> scheduler = Scheduler(db_path="/var/lib/ebb/queue.sqlite")

See ``packages/core-py/README.md`` for the full API reference.
"""

from __future__ import annotations

from .errors import CarbonBudgetExceededError, InvalidDeadlineError
from .grid import GridFeed, electricity_maps_feed, mock_grid_feed
from .recommend import (
    RecommendAlternative,
    RecommendResult,
    recommend_window,
)
from .scheduler import (
    DEFAULT_REGION,
    ENERGY_KWH_PER_TASK,
    MAX_HORIZON_HOURS,
    DeferrableTask,
    Scheduler,
    defer,
    normalize_deadline,
    pick_best_window,
)
from .types import (
    Band,
    CarbonReceipt,
    DeferOptions,
    GridForecast,
    GridForecastEntry,
    GridSource,
    IntensitySource,
    TaskRecord,
    TaskStatus,
)

__version__ = "0.2.0"

__all__ = [
    "DEFAULT_REGION",
    "ENERGY_KWH_PER_TASK",
    "MAX_HORIZON_HOURS",
    "Band",
    "CarbonBudgetExceededError",
    "CarbonReceipt",
    "DeferOptions",
    "DeferrableTask",
    "GridFeed",
    "GridForecast",
    "GridForecastEntry",
    "GridSource",
    "IntensitySource",
    "InvalidDeadlineError",
    "RecommendAlternative",
    "RecommendResult",
    "Scheduler",
    "TaskRecord",
    "TaskStatus",
    "__version__",
    "defer",
    "electricity_maps_feed",
    "mock_grid_feed",
    "normalize_deadline",
    "pick_best_window",
    "recommend_window",
]
