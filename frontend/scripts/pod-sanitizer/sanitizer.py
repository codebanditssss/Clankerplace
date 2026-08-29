#!/usr/bin/env python3
# pods.ml content-sanitizer proxy.
#
# Lives inside each Hermes pod. Hermes' `model.base_url` points here
# (http://127.0.0.1:8765/v1) instead of directly at the upstream
# provider. We forward every request through unchanged EXCEPT we
# rewrite any empty `text` blocks / empty `content` strings to a
# placeholder before they leave the box.
#
# Why: Hermes' chat_completions transport (OpenAI-format) doesn't
# sanitize empty content. When the agent runs a silent terminal
# command (`curl -s` returning nothing, an already-installed npm
# package, `true`), the tool result lands as content="". When that
# payload reaches Anthropic via the provider's relay, Anthropic
# rejects with HTTP 400 "messages: text content blocks must be
# non-empty" and the whole conversation aborts.
#
# Upgrade-resilient: operates only on the wire format (OpenAI
# chat.completion request shape), which is stable. Hermes can update
# freely.
#
# Config (via /home/container/.pods/sanitizer.env or env vars):
#   PODS_SANITIZER_UPSTREAM  required — e.g. https://api.example.com
#   PODS_SANITIZER_PORT      default 8765
#   PODS_SANITIZER_PLACEHOLDER default "(no output)"

import asyncio
import json
import logging
import os
import sys
from typing import Any

import aiohttp
from aiohttp import web

UPSTREAM = (os.environ.get("PODS_SANITIZER_UPSTREAM") or "").rstrip("/")
PORT = int(os.environ.get("PODS_SANITIZER_PORT", "8765"))
PLACEHOLDER = os.environ.get("PODS_SANITIZER_PLACEHOLDER", "(no output)")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s sanitizer: %(message)s",
)
log = logging.getLogger("sanitizer")

if not UPSTREAM:
    log.error("PODS_SANITIZER_UPSTREAM is required")
    sys.exit(2)


def _pad(value: Any) -> Any:
    """Replace empty strings / empty text blocks with the placeholder.

    Recurses into list-shaped content (the OpenAI multimodal/tool
    format) but leaves any non-empty value untouched."""
    if value is None:
        return PLACEHOLDER
    if isinstance(value, str):
        return value if value.strip() else PLACEHOLDER
    if isinstance(value, list):
        if not value:
            return [{"type": "text", "text": PLACEHOLDER}]
        out = []
        for block in value:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text")
                if not (isinstance(text, str) and text.strip()):
                    block = {**block, "text": PLACEHOLDER}
            out.append(block)
        return out
    return value


def sanitize_messages(messages: list) -> int:
    """Mutate messages list in place. Returns count of blocks rewritten."""
    rewritten = 0
    for msg in messages:
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        new_content = _pad(content)
        if new_content is not content and new_content != content:
            msg["content"] = new_content
            rewritten += 1
        # OpenAI tool messages may also have empty `tool_calls`; the
        # actual problematic shape is `content=""`, which the loop
        # above handled.
    return rewritten


async def handle(request: web.Request) -> web.StreamResponse:
    raw = await request.read()
    headers = {k: v for k, v in request.headers.items() if k.lower() != "host"}
    upstream_url = f"{UPSTREAM}{request.rel_url}"

    # Only inspect JSON bodies (the chat-completion payloads).
    body = raw
    if (
        raw
        and headers.get("Content-Type", "").lower().startswith("application/json")
    ):
        try:
            payload = json.loads(raw)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            messages = payload.get("messages")
            if isinstance(messages, list):
                fixed = sanitize_messages(messages)
                if fixed:
                    log.info(
                        "padded %d empty content block(s) on %s",
                        fixed,
                        request.path,
                    )
                    body = json.dumps(payload).encode()
                    headers.pop("Content-Length", None)

    timeout = aiohttp.ClientTimeout(total=600, connect=15)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            request.method,
            upstream_url,
            headers=headers,
            data=body if body else None,
            allow_redirects=False,
        ) as upstream:
            resp = web.StreamResponse(
                status=upstream.status,
                headers={
                    k: v
                    for k, v in upstream.headers.items()
                    if k.lower() not in ("content-length", "transfer-encoding")
                },
            )
            await resp.prepare(request)
            async for chunk in upstream.content.iter_chunked(8192):
                await resp.write(chunk)
            await resp.write_eof()
            return resp


async def healthz(_request):
    return web.json_response({"ok": True, "upstream": UPSTREAM})


def main() -> None:
    app = web.Application(client_max_size=64 * 1024 * 1024)
    app.router.add_get("/healthz", healthz)
    app.router.add_route("*", "/{path:.*}", handle)
    log.info("listening on 127.0.0.1:%d → %s", PORT, UPSTREAM)
    web.run_app(app, host="127.0.0.1", port=PORT, print=None)


if __name__ == "__main__":
    main()
