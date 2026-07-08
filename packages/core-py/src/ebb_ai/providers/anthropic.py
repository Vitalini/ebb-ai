"""Anthropic Claude adapter.

Implements :class:`ProviderAdapter` against the official
``anthropic`` Python SDK. The module imports cleanly even when the SDK
isn't installed — the import is deferred to first use, so:

    from ebb_ai.providers.anthropic import AnthropicAdapter  # always OK
    AnthropicAdapter()                                        # raises if missing

This matches the pattern in the Anthropic SDK quickstart but routed
through one common surface. For batches we use the
``client.messages.batches.create`` endpoint (Anthropic's Message
Batches API), which is a flat 50% discount with a 24-hour SLA.
"""

from __future__ import annotations

from typing import Any

from .base import BatchHandle, DispatchOptions, DispatchResult, ProviderAdapter


def _load_sdk() -> Any:
    try:
        import anthropic  # type: ignore[import-not-found]
    except ImportError as err:  # pragma: no cover - exercised in real env
        raise RuntimeError(
            "The `anthropic` package is required to use AnthropicAdapter. "
            "Install it with `pip install ebb-ai[anthropic]` or "
            "`pip install anthropic`."
        ) from err
    return anthropic


class AnthropicAdapter(ProviderAdapter):
    """Adapter for Anthropic Claude models.

    Parameters
    ----------
    api_key:
        Anthropic API key. If omitted, the SDK reads
        ``ANTHROPIC_API_KEY`` from the environment.
    client:
        Optional pre-built ``anthropic.AsyncAnthropic`` instance. Useful
        for tests (inject a mock) or for sharing one HTTP client across
        multiple adapters.
    """

    name = "anthropic"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        client: Any | None = None,
    ) -> None:
        if client is not None:
            self._client = client
        else:
            sdk = _load_sdk()
            # max_retries=0 — ebb-ai's scheduler owns the retry policy
            # (_retry_with_backoff); letting the SDK retry too multiplies
            # attempts and can double-bill ambiguous network errors.
            self._client = (
                sdk.AsyncAnthropic(api_key=api_key, max_retries=0)
                if api_key
                else sdk.AsyncAnthropic(max_retries=0)
            )

    async def dispatch(
        self,
        model: str,
        prompt: str,
        options: DispatchOptions | None = None,
    ) -> DispatchResult:
        """Run one prompt through ``messages.create``.

        Returns a :class:`DispatchResult` with the concatenated text
        blocks and usage stats. The raw SDK response is preserved in
        ``raw`` for advanced consumers (citations, tool calls, etc.).
        """
        opts = options or DispatchOptions()
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": opts.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        if opts.system is not None:
            kwargs["system"] = opts.system
        if opts.metadata:
            kwargs["metadata"] = opts.metadata
        kwargs.update(opts.extra)

        response = await self._client.messages.create(**kwargs)
        text = _extract_text(response)
        usage = getattr(response, "usage", None)
        return DispatchResult(
            text=text,
            model=getattr(response, "model", model),
            provider=self.name,
            raw=response,
            input_tokens=getattr(usage, "input_tokens", None) if usage else None,
            output_tokens=getattr(usage, "output_tokens", None) if usage else None,
        )

    async def dispatch_batch(
        self,
        model: str,
        prompts: list[str],
        options: DispatchOptions | None = None,
    ) -> BatchHandle:
        """Submit prompts to the Message Batches API.

        Anthropic's batches accept a list of request objects each with a
        ``custom_id``. We auto-assign ``custom_id = f"req-{i}"``.
        """
        opts = options or DispatchOptions()
        requests = []
        for i, prompt in enumerate(prompts):
            params: dict[str, Any] = {
                "model": model,
                "max_tokens": opts.max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            }
            if opts.system is not None:
                params["system"] = opts.system
            if opts.metadata:
                params["metadata"] = opts.metadata
            params.update(opts.extra)
            requests.append({"custom_id": f"req-{i}", "params": params})

        batch = await self._client.messages.batches.create(requests=requests)
        return BatchHandle(
            batch_id=getattr(batch, "id", ""),
            provider=self.name,
            model=model,
            prompt_count=len(prompts),
            raw=batch,
        )


def _extract_text(response: Any) -> str:
    """Pull the text out of an Anthropic ``Message`` response.

    The SDK returns a list of content blocks; only ``text`` blocks
    contribute. Tool-use blocks and other block types are ignored here —
    advanced consumers should reach into ``raw``.
    """
    content = getattr(response, "content", None)
    if not content:
        return ""
    chunks: list[str] = []
    for block in content:
        block_type = getattr(block, "type", None)
        if block_type == "text":
            chunks.append(getattr(block, "text", ""))
        elif isinstance(block, dict) and block.get("type") == "text":
            chunks.append(str(block.get("text", "")))
    return "".join(chunks)


__all__ = ["AnthropicAdapter"]
