"""OpenAI adapter.

Implements :class:`ProviderAdapter` against the official ``openai``
Python SDK. The module imports cleanly even when the SDK isn't
installed — the import is deferred to first use.

The sync path uses ``chat.completions.create`` for the broadest model
compatibility. The batch path uses ``batches.create``, which requires a
JSONL "input file" — we build the file in memory and upload it via
``files.create(purpose="batch")``. This is the same flow the official
OpenAI batch cookbook recommends.

o-series reasoning models and the gpt-5 family reject the legacy
``max_tokens`` parameter (400 "Unsupported parameter") and require
``max_completion_tokens``; o-series additionally rejects
``temperature``. :func:`_completion_params` maps the request
accordingly, mirroring the TS adapter's ``completionParams``.
"""

from __future__ import annotations

import io
import json
import re
from typing import Any

from .base import BatchHandle, DispatchOptions, DispatchResult, ProviderAdapter


def _load_sdk() -> Any:
    try:
        import openai  # type: ignore[import-not-found]
    except ImportError as err:  # pragma: no cover - exercised in real env
        raise RuntimeError(
            "The `openai` package is required to use OpenAIAdapter. "
            "Install it with `pip install ebb-ai[openai]` or "
            "`pip install openai`."
        ) from err
    return openai


def _is_o_series_model(model: str) -> bool:
    """o-series reasoning models (o1, o3, o4-mini, …)."""
    return re.match(r"^o\d", model.strip().lower()) is not None


def _is_gpt5_family_model(model: str) -> bool:
    """gpt-5 family (gpt-5, gpt-5-mini, gpt-5.1, …)."""
    return model.strip().lower().startswith("gpt-5")


def _completion_params(model: str, opts: DispatchOptions) -> dict[str, Any]:
    """Build the token/temperature portion of a chat.completions payload.

    o-series and gpt-5-family models reject the legacy ``max_tokens``
    parameter and require ``max_completion_tokens``; o-series
    additionally rejects ``temperature`` (which arrives via
    ``opts.extra``). Everything else keeps the classic parameters.
    """
    params: dict[str, Any] = {}
    if _is_o_series_model(model) or _is_gpt5_family_model(model):
        params["max_completion_tokens"] = opts.max_tokens
    else:
        params["max_tokens"] = opts.max_tokens
    params.update(opts.extra)
    if _is_o_series_model(model):
        params.pop("temperature", None)
    return params


class OpenAIAdapter(ProviderAdapter):
    """Adapter for OpenAI chat models (GPT-4o family and successors).

    Parameters
    ----------
    api_key:
        OpenAI API key. If omitted, the SDK reads ``OPENAI_API_KEY``
        from the environment.
    client:
        Optional pre-built ``openai.AsyncOpenAI`` instance. Useful for
        injecting a mock in tests.
    """

    name = "openai"

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
                sdk.AsyncOpenAI(api_key=api_key, max_retries=0)
                if api_key
                else sdk.AsyncOpenAI(max_retries=0)
            )

    async def dispatch(
        self,
        model: str,
        prompt: str,
        options: DispatchOptions | None = None,
    ) -> DispatchResult:
        """Run one prompt through the Chat Completions API.

        We use ``chat.completions.create`` for the broadest model
        compatibility. Advanced consumers can pass ``response_format``
        or other knobs via ``options.extra``.
        """
        opts = options or DispatchOptions()
        messages: list[dict[str, str]] = []
        if opts.system is not None:
            messages.append({"role": "system", "content": opts.system})
        messages.append({"role": "user", "content": prompt})

        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            **_completion_params(model, opts),
        }
        if opts.metadata:
            kwargs["metadata"] = opts.metadata

        response = await self._client.chat.completions.create(**kwargs)
        text = _extract_text(response)
        usage = getattr(response, "usage", None)
        return DispatchResult(
            text=text,
            model=getattr(response, "model", model),
            provider=self.name,
            raw=response,
            input_tokens=getattr(usage, "prompt_tokens", None) if usage else None,
            output_tokens=getattr(usage, "completion_tokens", None) if usage else None,
        )

    async def dispatch_batch(
        self,
        model: str,
        prompts: list[str],
        options: DispatchOptions | None = None,
    ) -> BatchHandle:
        """Submit prompts to OpenAI's Batch API.

        The Batch API takes a JSONL file uploaded via the Files API,
        then references that file by id. We build the JSONL in memory
        and upload it once per batch.
        """
        opts = options or DispatchOptions()
        buf = io.BytesIO()
        for i, prompt in enumerate(prompts):
            messages: list[dict[str, str]] = []
            if opts.system is not None:
                messages.append({"role": "system", "content": opts.system})
            messages.append({"role": "user", "content": prompt})
            body: dict[str, Any] = {
                "model": model,
                "messages": messages,
                **_completion_params(model, opts),
            }
            line = {
                "custom_id": f"req-{i}",
                "method": "POST",
                "url": "/v1/chat/completions",
                "body": body,
            }
            buf.write(json.dumps(line).encode("utf-8"))
            buf.write(b"\n")
        buf.seek(0)

        upload = await self._client.files.create(
            file=("ebb-ai-batch.jsonl", buf, "application/jsonl"),
            purpose="batch",
        )
        batch = await self._client.batches.create(
            input_file_id=getattr(upload, "id", ""),
            endpoint="/v1/chat/completions",
            completion_window="24h",
            metadata=opts.metadata or {},
        )
        return BatchHandle(
            batch_id=getattr(batch, "id", ""),
            provider=self.name,
            model=model,
            prompt_count=len(prompts),
            raw=batch,
        )


def _extract_text(response: Any) -> str:
    """Pull the assistant text out of a chat-completions response."""
    choices = getattr(response, "choices", None)
    if not choices:
        return ""
    first = choices[0]
    message = getattr(first, "message", None)
    if message is None and isinstance(first, dict):
        message = first.get("message")
    if message is None:
        return ""
    content = getattr(message, "content", None)
    if content is None and isinstance(message, dict):
        content = message.get("content")
    return content or ""


__all__ = ["OpenAIAdapter"]
