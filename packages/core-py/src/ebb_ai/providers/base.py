"""Provider adapter interface.

A provider adapter abstracts the differences between LLM vendors so the
scheduler can route a deferred task to a sync endpoint *or* a batch
endpoint without the caller needing to know which one will be picked.

Both adapters in v0.2 (:class:`ebb_ai.providers.AnthropicAdapter`,
:class:`ebb_ai.providers.OpenAIAdapter`) implement this surface.
Adapters are *lazy* about importing the vendor SDK so that:

- ``import ebb_ai.providers.anthropic`` succeeds even if the
  ``anthropic`` package isn't installed.
- The first time a caller actually constructs the adapter (or invokes
  it) we raise a clear, actionable error.

This pattern matches what the official Anthropic and OpenAI quickstarts
show users, but bundled behind one common surface.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class DispatchOptions:
    """Per-call knobs for provider adapters.

    Parameters
    ----------
    max_tokens:
        Maximum tokens the provider should generate. Required by some
        SDKs (Anthropic); optional for others.
    system:
        Optional system prompt.
    metadata:
        Free-form key/value pairs forwarded as the provider's
        ``metadata`` field where supported.
    extra:
        Vendor-specific knobs the caller wants passed straight through
        (e.g. ``temperature``, ``stop_sequences``).
    """

    max_tokens: int = 1024
    system: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class DispatchResult:
    """Normalized adapter response.

    Both providers' SDKs return rich domain objects; we keep them in
    ``raw`` for advanced callers but expose a flattened ``text`` field
    so simple agent code doesn't have to know each SDK's shape.
    """

    text: str
    model: str
    provider: str
    raw: Any = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    batch_id: str | None = None


@dataclass(slots=True)
class BatchHandle:
    """Receipt for an enqueued batch.

    Batch APIs return *eventually* (24h SLA at both Anthropic and
    OpenAI), so the dispatch call yields a handle the scheduler can
    poll. v0.3 will add a polling helper; for now the caller can
    retrieve the batch directly via the SDK if needed.
    """

    batch_id: str
    provider: str
    model: str
    prompt_count: int
    raw: Any = None


class ProviderAdapter(ABC):
    """Common adapter surface for LLM vendors."""

    #: Stable string identifier for the provider, used in carbon
    #: receipts (``receipt.provider``). Must be lowercase.
    name: str

    @abstractmethod
    async def dispatch(
        self,
        model: str,
        prompt: str,
        options: DispatchOptions | None = None,
    ) -> DispatchResult:
        """Send a single prompt through the provider's sync API."""

    @abstractmethod
    async def dispatch_batch(
        self,
        model: str,
        prompts: list[str],
        options: DispatchOptions | None = None,
    ) -> BatchHandle:
        """Submit a batch of prompts to the provider's batch API."""


__all__ = [
    "BatchHandle",
    "DispatchOptions",
    "DispatchResult",
    "ProviderAdapter",
]
