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

from .base import (
    BatchHandle,
    BatchResultItem,
    BatchRetrieveResult,
    DispatchOptions,
    DispatchResult,
    ProviderAdapter,
)


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

    async def retrieve_batch(self, batch_id: str) -> BatchRetrieveResult:
        """Poll a Message Batch.

        Maps Anthropic's ``processing_status`` (``"in_progress"`` |
        ``"canceling"`` | ``"ended"``) onto the uniform result. Once the
        batch has ended we stream ``messages.batches.results``, which
        yields one entry per request with a ``result`` union (succeeded /
        errored / expired / canceled).
        """
        batch = await self._client.messages.batches.retrieve(batch_id)
        processing_status = getattr(batch, "processing_status", None)
        if processing_status != "ended":
            # "in_progress" and "canceling" are both still-running here.
            return BatchRetrieveResult(status="in_progress")

        results: list[BatchResultItem] = []
        saw_expired = False
        saw_error = False
        first_error: str | None = None
        stream = await self._client.messages.batches.results(batch_id)
        async for entry in stream:
            result = getattr(entry, "result", None)
            result_type = getattr(result, "type", None)
            if result_type == "succeeded":
                message = getattr(result, "message", None)
                text = _extract_text(message) if message is not None else ""
                usage = getattr(message, "usage", None)
                input_tokens = getattr(usage, "input_tokens", None) if usage else None
                output_tokens = (
                    getattr(usage, "output_tokens", None) if usage else None
                )
                total = (
                    input_tokens + output_tokens
                    if input_tokens is not None and output_tokens is not None
                    else None
                )
                results.append(
                    BatchResultItem(
                        text=text,
                        model=getattr(message, "model", None),
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                        total_tokens=total,
                    )
                )
            elif result_type == "expired":
                saw_expired = True
            else:
                saw_error = True
                if first_error is None:
                    err = getattr(result, "error", None)
                    first_error = (
                        getattr(err, "message", None)
                        or f"batch request result type: {result_type}"
                    )

        if results:
            return BatchRetrieveResult(status="completed", results=results)
        if saw_expired:
            return BatchRetrieveResult(
                status="expired", error="Anthropic batch request expired"
            )
        if saw_error:
            return BatchRetrieveResult(
                status="failed",
                error=first_error or "Anthropic batch request failed",
            )
        return BatchRetrieveResult(
            status="failed", error="Anthropic batch ended with no results"
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
