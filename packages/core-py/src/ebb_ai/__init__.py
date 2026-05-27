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

from .energy import (
    DEFAULT_PUE,
    ENERGY_SOURCES,
    LEGACY_KWH_PER_TASK,
    MODEL_ENERGY_COEFFICIENTS,
    EnergySourceTier,
    ModelEnergyCoefficients,
    estimate_energy_kwh,
    grams_for_intensity,
    lookup_model_energy,
    normalize_model_name,
)
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
from .sign import (
    SigningKeyPair,
    SigningNotInstalled,
    VerifyOutcome,
    VerifyResult,
    default_signing_key_path,
    is_signing_available,
    load_or_create_signing_key,
    sign_receipt,
    verify_receipt,
)
from .types import (
    Band,
    CarbonReceipt,
    DeferOptions,
    GridForecast,
    GridForecastEntry,
    GridSource,
    IntensitySource,
    Provider,
    ProviderCallSpec,
    TaskRecord,
    TaskStatus,
    TickResult,
    TickResultEntry,
)

__version__ = "0.11.0"

__all__ = [
    "DEFAULT_PUE",
    "DEFAULT_REGION",
    "ENERGY_KWH_PER_TASK",
    "ENERGY_SOURCES",
    "LEGACY_KWH_PER_TASK",
    "MAX_HORIZON_HOURS",
    "MODEL_ENERGY_COEFFICIENTS",
    "Band",
    "CarbonBudgetExceededError",
    "CarbonReceipt",
    "DeferOptions",
    "DeferrableTask",
    "EnergySourceTier",
    "GridFeed",
    "GridForecast",
    "GridForecastEntry",
    "GridSource",
    "IntensitySource",
    "InvalidDeadlineError",
    "ModelEnergyCoefficients",
    "Provider",
    "ProviderCallSpec",
    "RecommendAlternative",
    "RecommendResult",
    "Scheduler",
    "SigningKeyPair",
    "SigningNotInstalled",
    "TaskRecord",
    "TaskStatus",
    "TickResult",
    "TickResultEntry",
    "VerifyOutcome",
    "VerifyResult",
    "__version__",
    "default_signing_key_path",
    "defer",
    "electricity_maps_feed",
    "estimate_energy_kwh",
    "grams_for_intensity",
    "is_signing_available",
    "load_or_create_signing_key",
    "lookup_model_energy",
    "mock_grid_feed",
    "normalize_deadline",
    "normalize_model_name",
    "pick_best_window",
    "recommend_window",
    "sign_receipt",
    "verify_receipt",
]
