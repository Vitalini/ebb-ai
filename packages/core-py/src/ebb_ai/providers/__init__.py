"""Provider adapters for ebb-ai.

Each adapter is importable even without its vendor SDK installed —
construction is what fails. This lets the scheduler depend on the
adapter type without forcing every user to pull in every SDK.

Import paths:

>>> from ebb_ai.providers import AnthropicAdapter, OpenAIAdapter
>>> from ebb_ai.providers.base import ProviderAdapter, DispatchOptions
"""

from __future__ import annotations

from .anthropic import AnthropicAdapter
from .base import (
    BatchHandle,
    DispatchOptions,
    DispatchResult,
    ProviderAdapter,
)
from .openai import OpenAIAdapter

__all__ = [
    "AnthropicAdapter",
    "BatchHandle",
    "DispatchOptions",
    "DispatchResult",
    "OpenAIAdapter",
    "ProviderAdapter",
]
