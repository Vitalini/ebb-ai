"""Provider adapters for Tidegap.

Each adapter is importable even without its vendor SDK installed —
construction is what fails. This lets the scheduler depend on the
adapter type without forcing every user to pull in every SDK.

Import paths:

>>> from tidegap.providers import AnthropicAdapter, OpenAIAdapter
>>> from tidegap.providers.base import ProviderAdapter, DispatchOptions
"""

from __future__ import annotations

from .anthropic import AnthropicAdapter
from .base import (
    BatchHandle,
    DispatchOptions,
    DispatchResult,
    ProviderAdapter,
    ProviderRefusalError,
)
from .gemini import GeminiAdapter
from .ollama import OllamaAdapter
from .openai import OpenAIAdapter

__all__ = [
    "AnthropicAdapter",
    "BatchHandle",
    "DispatchOptions",
    "DispatchResult",
    "GeminiAdapter",
    "OllamaAdapter",
    "OpenAIAdapter",
    "ProviderAdapter",
    "ProviderRefusalError",
]
