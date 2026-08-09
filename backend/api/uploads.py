"""Bounded reads for uploaded files.

``await file.read()`` with no argument returns the entire body as one bytes object.
On an endpoint reachable by any authenticated user that is memory exhaustion from a
single request (DOCUMENTATION.md §8.2 H2).

This reads in chunks and aborts the moment the cap is exceeded, so an oversized
upload costs the chunk size rather than its full length. It is the real guarantee:
the Content-Length check in `api.middleware.BodySizeLimitMiddleware` is only a fast
path (the header is absent under chunked encoding and a client can lie), and
Nginx's `client_max_body_size` is the outer layer that stops the bytes arriving at
all.
"""
from __future__ import annotations

from fastapi import HTTPException, UploadFile, status

_CHUNK = 64 * 1024


async def read_capped(file: UploadFile, max_bytes: int, detail: str = "file_too_large") -> bytes:
    """Read an upload fully, or fail with 413 as soon as it exceeds `max_bytes`."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=detail,
            )
        chunks.append(chunk)
    return b"".join(chunks)
