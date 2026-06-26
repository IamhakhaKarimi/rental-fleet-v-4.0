"""
Vehicle photo helpers — uniform size, multiple photos, lazy loading.

- Every uploaded photo is cropped+resized to ONE standard size (PHOTO_SIZE) so all
  cards/thumbnails line up; display uses object-fit:cover at a fixed height.
- A vehicle can have several photos (data.repositories.vehicle_photos).
- The vehicles listing carries NO photo data; thumbnails load the *primary* photo
  lazily and are cached with @st.cache_data, so pages stay fast on every rerun.
"""

import base64
import io

try:
    import streamlit as st
    _cache_data = st.cache_data
except Exception:
    # FastAPI backend: streamlit isn't installed (lean prod image). The encoders
    # below are pure Pillow; the cached-thumbnail / render helpers aren't used
    # server-side, so a no-op cache decorator lets this module import cleanly.
    st = None

    def _cache_data(*args, **kwargs):
        def _wrap(fn):
            fn.clear = lambda: None
            return fn
        return _wrap(args[0]) if args and callable(args[0]) else _wrap

from data.repositories import vehicle_photos as vphotos

PHOTO_TYPES = ["png", "jpg", "jpeg", "webp"]
PHOTO_SIZE = (640, 480)   # standard stored size (4:3)
LOGO_MAX = (280, 100)     # bounding box for the company logo (aspect preserved)
STAMP_MAX = (260, 180)    # bounding box for the company stamp/seal (aspect preserved)


def _encode_fit(uploaded_file, box) -> str:
    """One UploadedFile -> base64 PNG, fit within `box` (aspect preserved).

    Unlike encode_photo this does NOT crop — the whole image is kept, scaled down
    to fit the bounding box, flattened onto a white background. Shared by the logo
    and the stamp/seal (they differ only in their bounding box).
    """
    if uploaded_file is None:
        return ""
    raw = uploaded_file.getvalue()
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        bg.thumbnail(box, Image.LANCZOS)
        buf = io.BytesIO()
        bg.save(buf, format="PNG", optimize=True)
        raw = buf.getvalue()
    except Exception:
        pass   # Pillow missing / unreadable -> store original bytes
    return base64.b64encode(raw).decode("ascii")


def encode_logo(uploaded_file) -> str:
    """Company logo -> base64 PNG, fit within LOGO_MAX (aspect preserved, no crop)."""
    return _encode_fit(uploaded_file, LOGO_MAX)


def encode_stamp(uploaded_file) -> str:
    """Company stamp/seal -> base64 PNG, fit within STAMP_MAX (aspect preserved)."""
    return _encode_fit(uploaded_file, STAMP_MAX)


def encode_photo(uploaded_file) -> str:
    """One UploadedFile -> base64 JPEG, cropped to PHOTO_SIZE for a uniform look."""
    if uploaded_file is None:
        return ""
    raw = uploaded_file.getvalue()
    try:
        from PIL import Image, ImageOps
        img = Image.open(io.BytesIO(raw))
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        img = ImageOps.fit(img, PHOTO_SIZE, method=Image.LANCZOS, centering=(0.5, 0.5))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80, optimize=True)
        raw = buf.getvalue()
    except Exception:
        pass   # Pillow missing / unreadable -> store original bytes
    return base64.b64encode(raw).decode("ascii")


def encode_many(files) -> list[str]:
    return [b for b in (encode_photo(f) for f in (files or [])) if b]


def render_photo(b64: str, height: int = 150):
    """Render one photo (or 🚘 placeholder) at a FIXED height, cover-cropped."""
    if b64:
        st.markdown(
            f'<img src="data:image/jpeg;base64,{b64}" alt="vehicle" '
            f'style="width:100%;height:{height}px;object-fit:cover;border-radius:12px;'
            f'border:1px solid var(--border);display:block"/>',
            unsafe_allow_html=True,
        )
    else:
        st.markdown(f'<div class="car-ph" style="height:{height}px"><span class="msym">directions_car</span></div>',
                    unsafe_allow_html=True)


# ── lazy + cached primary thumbnail ──────────────────────────────────────────
@_cache_data(show_spinner=False, max_entries=256)
def _cached_primary(vehicle_id: str, version: int):
    return vphotos.primary_photo(vehicle_id)


def render_vehicle_thumb(vehicle_id: str, height: int = 150):
    """Card thumbnail: the primary photo, loaded lazily and cached per vehicle."""
    version = vphotos.photos_version(vehicle_id)   # cheap; changes when photos change
    render_photo(_cached_primary(vehicle_id, version), height)


def invalidate_cache():
    """Call after adding/removing photos so cached thumbnails refresh."""
    _cached_primary.clear()
