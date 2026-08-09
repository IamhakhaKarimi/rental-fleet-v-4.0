"""Vehicle-photos mutation router — upload + delete.

Adds the two write endpoints under the /api/vehicles prefix that the existing
vehicles router doesn't carry (it already serves GET /{id}/photos,
/{id}/photos/version, /{id}/thumb). FastAPI merges the two routers on the shared
prefix; the paths here don't collide with the existing ones.

Photos are encoded exactly like the Streamlit Fleet page: ui.photos.encode_photo
crops+resizes each upload to PHOTO_SIZE and returns a base64 JPEG, which
vehicle_photos.add_photos stores. encode_photo expects an UploadedFile-like
object exposing .getvalue(); we read the upload through `api.uploads.read_capped`
(bounded — never a bare `.read()`) and wrap the bytes in a tiny adapter exposing
that method. The encode itself runs in a worker thread, never on the event loop.

Both routes gated by require("service_vehicle") (level 1). Mutations audit.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from api.concurrency import heavy_slot
from api.deps import require
from api.settings import settings
from api.uploads import read_capped
from data.repositories import vehicle_photos as vphotos
from services import audit_service
from ui.photos import PHOTO_TYPES, encode_photo

router = APIRouter(prefix="/api/vehicles", tags=["photos"])


class _BytesUpload:
    """Adapter so a raw bytes payload satisfies encode_photo's .getvalue() call."""

    def __init__(self, raw: bytes):
        self._raw = raw

    def getvalue(self) -> bytes:
        return self._raw


def _is_image(file: UploadFile) -> bool:
    """Accept png/jpg/jpeg/webp by content-type or filename extension."""
    ctype = (file.content_type or "").lower()
    if ctype.startswith("image/") and ctype.split("/", 1)[-1].replace("jpeg", "jpg") in (
        [t for t in PHOTO_TYPES] + ["jpeg"]
    ):
        return True
    name = (file.filename or "").lower()
    return any(name.endswith("." + ext) for ext in PHOTO_TYPES)


@router.post("/{vehicle_id}/photos")
async def upload_photos(vehicle_id: str,
                        files: list[UploadFile] = File(...),
                        user: dict = Depends(require("service_vehicle")),
                        _slot: dict = Depends(heavy_slot)) -> dict:
    """Encode and store vehicle photos.

    Two things this handler must NOT do, both of which it used to:

      * ``encode_photo`` is Pillow — it decodes, crops and re-encodes a JPEG, which
        is CPU-bound and blocking. Called directly from an ``async def`` it ran on
        the event loop and froze the entire API for every other user for the whole
        upload (DOCUMENTATION.md §8.2 C2). ``run_in_threadpool`` moves it to a
        worker thread, turning a service outage into a slow request.
      * ``await f.read()`` was unbounded. Now capped per file and in total, so a
        single request cannot exhaust process memory (§8.2 H2).

    The ``heavy_slot`` dependency additionally bounds how many of these may run at
    once, globally and per user — the rate limiter alone cannot do that (§8.4).
    """
    encoded: list[str] = []
    budget = settings.max_request_bytes
    for f in files:
        if not _is_image(f):
            continue
        raw = await read_capped(f, min(settings.max_upload_bytes, budget))
        if not raw:
            continue
        budget -= len(raw)
        b64 = await run_in_threadpool(encode_photo, _BytesUpload(raw))
        if b64:
            encoded.append(b64)
    if not encoded:
        raise HTTPException(400, detail="fields_required")
    await run_in_threadpool(vphotos.add_photos, vehicle_id, encoded)
    audit_service.record(user, "add_photos", "vehicle", vehicle_id, str(len(encoded)))
    return {"ok": True, "added": len(encoded)}


@router.delete("/photos/{photo_id}")
def delete_photo(photo_id: int,
                 user: dict = Depends(require("service_vehicle"))) -> dict:
    vphotos.delete_photo(photo_id)
    audit_service.record(user, "delete_photo", "vehicle_photo", str(photo_id))
    return {"ok": True}
