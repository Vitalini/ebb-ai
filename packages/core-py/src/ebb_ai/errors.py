"""Typed errors raised by the scheduler.

Mirrors the TS errors in ``packages/core-ts/src/scheduler.ts`` so that
callers translating the JS examples have a 1:1 reference. Both carry
structured fields (``minimum_g_co2`` / ``budget_g_co2`` /
``received``) so callers can decide how to react without parsing the
message text.
"""

from __future__ import annotations

from typing import Any


class CarbonBudgetExceededError(Exception):
    """No candidate window meets the user-supplied carbon budget.

    Attributes
    ----------
    minimum_g_co2:
        Grams CO2e the cheapest reachable window would have emitted.
    budget_g_co2:
        Grams CO2e the caller specified as the cap.
    """

    minimum_g_co2: float
    budget_g_co2: float

    def __init__(self, minimum_g_co2: float, budget_g_co2: float) -> None:
        self.minimum_g_co2 = minimum_g_co2
        self.budget_g_co2 = budget_g_co2
        super().__init__(
            f"No window inside the deadline keeps the task under "
            f"{budget_g_co2:.1f} gCO2e. Cheapest reachable window costs "
            f"{minimum_g_co2:.1f} gCO2e."
        )


class InvalidDeadlineError(ValueError):
    """The supplied deadline could not be parsed or is already in the past.

    Inherits from :class:`ValueError` so callers using a broad
    ``except ValueError`` continue to work.

    Attributes
    ----------
    received:
        Original value the caller passed.
    """

    received: Any

    def __init__(self, received: Any) -> None:
        self.received = received
        super().__init__(
            "Invalid deadline: expected an ISO-8601 timestamp in the future, "
            f"received {received!r}"
        )


__all__ = ["CarbonBudgetExceededError", "InvalidDeadlineError"]
