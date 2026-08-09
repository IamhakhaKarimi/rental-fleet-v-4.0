"""Phase 0 HTTP behaviour tests — DOCUMENTATION.md §8.10 verification.

Two things that cannot be verified by inspection:

  C2  Does a photo upload still freeze the whole API?
      Polls /api/health continuously while uploading 8 phone-sized photos and
      reports the WORST health latency observed. On the unfixed code the encoder
      runs on the event loop, so health cannot be answered until the upload ends.

  L4  Do concurrent heavy operations cap cleanly?
      Fires N simultaneous invoice PDF builds and reports the status mix. With
      the semaphores in place, the excess must come back 429 + Retry-After
      rather than all of them stalling the box.

Usage:  python bench_http.py <port> <case-label>
"""
from __future__ import annotations

import io
import json
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent
PORT = sys.argv[1] if len(sys.argv) > 1 else "8012"
LABEL = sys.argv[2] if len(sys.argv) > 2 else "current"
ROOT = f"http://127.0.0.1:{PORT}"
TOKEN = (BASE / ".token").read_text().strip()
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def get(path: str, timeout: float = 30.0):
    req = urllib.request.Request(ROOT + path, headers=AUTH)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            return r.status, (time.perf_counter() - started) * 1000.0
    except urllib.error.HTTPError as e:
        e.read()
        return e.code, (time.perf_counter() - started) * 1000.0
    except Exception:
        return 0, (time.perf_counter() - started) * 1000.0


def make_photos(n: int, dim: int = 4000) -> list[Path]:
    from PIL import Image
    out = []
    for i in range(n):
        p = BASE / f"_photo{i}.jpg"
        if not p.exists():
            buf = io.BytesIO()
            Image.new("RGB", (dim, int(dim * 0.75)), (40 + i * 12, 110, 170)).save(
                buf, "JPEG", quality=88)
            p.write_bytes(buf.getvalue())
        out.append(p)
    return out


def first_vehicle() -> str:
    req = urllib.request.Request(ROOT + "/api/vehicles", headers=AUTH)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())[0]["vehicle_id"]


# ── C2: does an upload freeze the event loop? ────────────────────────────────
def test_event_loop_block(vehicle_id: str, photos: list[Path]) -> None:
    samples: list[float] = []
    stop = threading.Event()

    def poll():
        while not stop.is_set():
            _, ms = get("/api/health", timeout=60)
            samples.append(ms)
            time.sleep(0.02)

    # Baseline before any load, for comparison.
    base = [get("/api/health")[1] for _ in range(20)]

    t = threading.Thread(target=poll, daemon=True)
    t.start()
    time.sleep(0.3)

    cmd = ["curl", "-s", "-o", str(BASE / "_upload_out.json"), "-w", "%{http_code}",
           "-X", "POST", f"{ROOT}/api/vehicles/{vehicle_id}/photos",
           "-H", f"Authorization: Bearer {TOKEN}"]
    for p in photos:
        cmd += ["-F", f"files=@{p};type=image/jpeg"]
    started = time.perf_counter()
    status = subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    upload_ms = (time.perf_counter() - started) * 1000.0

    stop.set()
    t.join(timeout=5)

    during = samples or [0.0]
    print(f"\n=== C2  event-loop blocking [{LABEL}] ===")
    print(f"  upload: {len(photos)} x 12MP -> HTTP {status} in {upload_ms:.0f} ms")
    print(f"  /api/health BEFORE upload : p50 {statistics.median(base):6.1f} ms   "
          f"max {max(base):7.1f} ms")
    print(f"  /api/health DURING upload : p50 {statistics.median(during):6.1f} ms   "
          f"max {max(during):7.1f} ms   ({len(during)} probes)")
    verdict = "PASS - API stayed responsive" if max(during) < 500 else \
              "FAIL - API was stalled by the upload"
    print(f"  -> {verdict}")


# ── L4: do concurrent heavy operations cap? ──────────────────────────────────
def test_heavy_concurrency(deal_id: str, n: int = 8) -> None:
    results: list[tuple[int, float]] = []
    lock = threading.Lock()

    def fire():
        r = get(f"/api/rentals/{deal_id}/invoice.pdf", timeout=60)
        with lock:
            results.append(r)

    threads = [threading.Thread(target=fire) for _ in range(n)]
    started = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    total = (time.perf_counter() - started) * 1000.0

    ok = sum(1 for s, _ in results if s == 200)
    busy = sum(1 for s, _ in results if s == 429)
    other = len(results) - ok - busy
    print(f"\n=== L4  concurrency cap [{LABEL}] ===")
    print(f"  {n} simultaneous invoice PDFs in {total:.0f} ms")
    print(f"  200 OK: {ok}    429 busy: {busy}    other: {other}")
    if results:
        lat = [ms for _, ms in results]
        print(f"  latency p50 {statistics.median(lat):.0f} ms   max {max(lat):.0f} ms")
    print(f"  -> {'PASS - excess shed as 429' if busy else 'note: none shed (cap not reached)'}")


def main() -> None:
    vid = first_vehicle()
    req = urllib.request.Request(ROOT + "/api/rentals/all", headers=AUTH)
    with urllib.request.urlopen(req, timeout=10) as r:
        rentals = json.loads(r.read())
    deal_id = (rentals[0] if isinstance(rentals, list) else rentals["items"][0])["deal_id"]

    n = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    if "l4only" not in LABEL:
        photos = make_photos(8)
        test_event_loop_block(vid, photos)
    test_heavy_concurrency(deal_id, n=n)


if __name__ == "__main__":
    main()
