"""Grid carbon-intensity feeds.

The Python port ships two sources:

- :func:`mock_grid_feed` — deterministic synthetic data with a
  realistic intraday curve, for development and tests without an API
  key.
- :func:`electricity_maps_feed` — hits the Electricity Maps free-tier
  API. Falls back to the mock feed (and logs a warning) if the API key
  is missing, the request fails, or the response shape is unexpected —
  matching the TS implementation's deliberate behavior.

The TS port additionally implements UK Carbon Intensity, EIA, and
ENTSO-E feeds; records they persist round-trip through the Python types
unchanged (see :data:`ebb_ai.types.GridSource`). Porting those feeds —
and a WattTime marginal-emissions source — is tracked in ROADMAP.md.

Every forecast this module emits carries ``kind="forecast"`` (v0.12+):
both feeds return genuine forward-looking series, never realised
observations relabelled as a forecast.
"""

from __future__ import annotations

import logging
import math
import os
from abc import ABC, abstractmethod
from datetime import UTC, datetime, timedelta
from typing import Final
from urllib.parse import quote

import httpx

from .types import Band, GridForecast, GridForecastEntry, GridSource

_log = logging.getLogger(__name__)

_REGION_FLOOR: Final[dict[str, int]] = {
    "US-CAL-CISO": 280,  # California — lots of solar daytime, gas overnight
    "US-TEX-ERCO": 340,  # Texas — wind off-peak, gas peak
    "US-NE-ISNE": 320,  # New England
    "US-NY-NYIS": 360,
    "US-MIDA-PJM": 420,
    "US-MIDW-MISO": 460,
    "FR": 60,  # mostly nuclear
    "DE": 380,
    "GB": 220,
}
_DEFAULT_FLOOR: Final[int] = 380
_AMPLITUDE: Final[int] = 220

_ELECTRICITY_MAPS_ENDPOINT: Final[str] = (
    "https://api.electricitymap.org/v3/carbon-intensity/forecast"
)
_FETCH_TIMEOUT_S: Final[float] = 5.0


def _classify(g: float) -> Band:
    """Bucket a gCO2/kWh value into a coarse band.

    Thresholds mirror the TS implementation exactly so JSON output round
    -trips.
    """
    if g < 100:
        return "very_clean"
    if g < 250:
        return "clean"
    if g < 450:
        return "average"
    if g < 700:
        return "dirty"
    return "very_dirty"


def _synthetic_intensity_for_hour(dt: datetime, region: str) -> int:
    """Build a synthetic intraday carbon curve.

    Real grid intensity in the US typically dips overnight (lots of
    base-load nuclear and hydro, plus wind) and peaks late afternoon
    (residential AC, gas peaker plants). We mimic that shape with a
    sinusoid that bottoms at 03:00 UTC and peaks at 17:00 UTC.

    UTC is intentional: the curve is deterministic across CI and
    developer machines, and the ISO timestamps we emit are also UTC.
    """
    floor = _REGION_FLOOR.get(region, _DEFAULT_FLOOR)
    hour = dt.astimezone(UTC).hour
    phase = (hour - 17) * (math.pi / 12)
    value = floor + _AMPLITUDE * math.cos(phase)
    return round(value)


def _iso_utc(dt: datetime) -> str:
    """Render a datetime as a TS-compatible ISO-8601 string in UTC.

    Matches JavaScript's ``Date.prototype.toISOString`` output:
    millisecond precision, trailing ``Z``.
    """
    aware = dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    # Truncate to milliseconds, like Date.prototype.toISOString.
    ms = aware.microsecond // 1000
    return aware.strftime("%Y-%m-%dT%H:%M:%S") + f".{ms:03d}Z"


def _now_utc() -> datetime:
    """Wall clock in UTC. Exposed for monkey-patching in tests."""
    return datetime.now(UTC)


class GridFeed(ABC):
    """A source of carbon-intensity forecasts for a region."""

    source: GridSource

    @abstractmethod
    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        """Return up to ``hours`` hourly buckets for ``region``."""


class _MockGridFeed(GridFeed):
    """Deterministic synthetic feed for dev and tests."""

    source: GridSource = "mock"

    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        now = _now_utc().replace(minute=0, second=0, microsecond=0)
        entries: list[GridForecastEntry] = []
        for i in range(hours):
            t = now + timedelta(hours=i)
            g = _synthetic_intensity_for_hour(t, region)
            entries.append(
                GridForecastEntry(
                    datetime=_iso_utc(t),
                    carbon_intensity_g_co2_per_kwh=g,
                    band=_classify(g),
                )
            )
        return GridForecast(
            region=region,
            source="mock",
            generated_at=_iso_utc(_now_utc()),
            entries=entries,
            kind="forecast",
        )


def mock_grid_feed() -> GridFeed:
    """Construct a deterministic mock grid feed.

    The returned feed is stateless and safe to share across schedulers
    and threads.
    """
    return _MockGridFeed()


class _ElectricityMapsFeed(GridFeed):
    """Electricity Maps free-tier API client.

    Docs: https://www.electricitymaps.com/free-tier-api
    Endpoint: ``GET /v3/carbon-intensity/forecast?zone=<region>``
    Header: ``auth-token: <key>``

    Falls back to the mock feed (and logs) if the API key is missing,
    the request fails, or the response shape is unexpected.
    """

    source: GridSource = "electricityMaps"

    def __init__(self, api_key: str, *, timeout_s: float = _FETCH_TIMEOUT_S) -> None:
        self._key = api_key
        self._timeout_s = timeout_s
        self._mock = _MockGridFeed()

    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        url = f"{_ELECTRICITY_MAPS_ENDPOINT}?zone={quote(region, safe='')}"
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self._timeout_s)) as client:
                res = await client.get(url, headers={"auth-token": self._key})
            if res.status_code != httpx.codes.OK:
                raise RuntimeError(f"Electricity Maps returned {res.status_code}")
            payload = res.json()
            if not isinstance(payload, dict):
                raise RuntimeError("Electricity Maps response was not a JSON object")
            raw = payload.get("forecast") or []
            if not isinstance(raw, list):
                raise RuntimeError("Electricity Maps response.forecast was not a list")
            raw = raw[:hours]
            if not raw:
                raise RuntimeError("Electricity Maps returned empty forecast")
            entries: list[GridForecastEntry] = []
            for e in raw:
                if not isinstance(e, dict):
                    raise RuntimeError("Electricity Maps entry was not an object")
                dt_str = e.get("datetime")
                intensity = e.get("carbonIntensity")
                if dt_str is None or intensity is None:
                    raise RuntimeError("Electricity Maps entry missing fields")
                entries.append(
                    GridForecastEntry(
                        datetime=str(dt_str),
                        carbon_intensity_g_co2_per_kwh=round(float(intensity)),
                        band=_classify(float(intensity)),
                    )
                )
            return GridForecast(
                region=region,
                source="electricityMaps",
                generated_at=_iso_utc(_now_utc()),
                entries=entries,
                kind="forecast",
            )
        except (httpx.HTTPError, RuntimeError, ValueError) as err:
            _log.warning(
                "[ebb-ai/grid] electricity-maps fetch failed (%s); falling back to mock",
                err,
            )
            return await self._mock.fetch_forecast(region, hours)


class _MockWithWarning(GridFeed):
    """Mock feed that warns once that no API key was configured.

    Wrapped so that the user still sees ``source = "mock"`` and the
    fallback is explicit. Matches the TS implementation's behavior.
    """

    source: GridSource = "mock"

    def __init__(self) -> None:
        self._mock = _MockGridFeed()
        self._warned = False

    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        if not self._warned:
            _log.warning(
                "[ebb-ai/grid] no EBB_ELECTRICITY_MAPS_API_KEY set — using mock data"
            )
            self._warned = True
        return await self._mock.fetch_forecast(region, hours)


def electricity_maps_feed(
    api_key: str | None = None,
    *,
    timeout_s: float = _FETCH_TIMEOUT_S,
) -> GridFeed:
    """Construct an Electricity Maps feed.

    Reads the API key from the ``EBB_ELECTRICITY_MAPS_API_KEY``
    environment variable if not passed explicitly. If no key is found,
    returns a mock-backed feed that warns once on first use — matching
    the TS implementation's deliberate fallback so the stack still runs
    end-to-end for developers who haven't signed up.

    Parameters
    ----------
    api_key:
        Electricity Maps API key. Optional; falls back to env.
    timeout_s:
        Hard per-request timeout, in seconds. Defaults to 5s — without
        one a degraded Electricity Maps edge can hang the scheduler
        indefinitely.
    """
    key = api_key or os.environ.get("EBB_ELECTRICITY_MAPS_API_KEY")
    if not key:
        return _MockWithWarning()
    return _ElectricityMapsFeed(key, timeout_s=timeout_s)


__all__ = [
    "GridFeed",
    "electricity_maps_feed",
    "mock_grid_feed",
]
