"""Desktop launcher for the Fleet Console — the thing `start.bat` runs.

Serves the repo-root ``index.html`` over http (so its buttons can actually do
something) and supervises the two servers behind it:

    This PC only        API 127.0.0.1:8001   +  next dev   -H 127.0.0.1
    Local WiFi network  API 0.0.0.0:8001     +  next start -H 0.0.0.0

LAN mode runs a production build because ``next dev`` is too slow and memory
hungry to put five people on. The build is IP-independent — ``lib/api.ts``
resolves the API host from ``window.location`` at runtime — so it is done once
and reused for every address the machine ever has.

Binds 127.0.0.1 only: this control surface starts and stops processes and is
never exposed to the network, whatever mode the app itself is running in.
"""
from __future__ import annotations

import atexit
import io
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
INDEX = ROOT / "index.html"
FIREWALL_BAT = HERE / "allow-firewall.bat"

LAUNCHER_PORT = 8800
API_PORT = 8001
WEB_PORT = 3000
READY_TIMEOUT = 180          # seconds to wait for both ports after a start
FIREWALL_RULES = ("Balkan Fleet Web", "Balkan Fleet API")

IS_WINDOWS = os.name == "nt"
# next/uvicorn colourise their output; the log panel renders text, not a terminal.
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
# CREATE_NO_WINDOW keeps the children from flashing console windows;
# CREATE_NEW_PROCESS_GROUP lets taskkill /T reap the whole tree.
CREATE_FLAGS = (
    subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    if IS_WINDOWS
    else 0
)

TOKEN = secrets.token_urlsafe(18)
PRIVATE_RE = re.compile(r"^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)")


# --------------------------------------------------------------------------
# host / port helpers
# --------------------------------------------------------------------------
def primary_lan_ip() -> str:
    """The address on the interface holding the default route.

    A machine with WSL or Hyper-V has several IPv4 addresses (the 172.x virtual
    switches) and ``getaddrinfo`` order between them is meaningless. Opening a
    UDP socket makes Windows pick the one it would actually route through — no
    packet is ever sent.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def candidate_ips() -> list[str]:
    """Every private IPv4 on this box, default-route address first."""
    found: list[str] = []
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if PRIVATE_RE.match(ip) and ip not in found:
                found.append(ip)
    except OSError:
        pass
    primary = primary_lan_ip()
    if PRIVATE_RE.match(primary):
        found = [primary] + [i for i in found if i != primary]
    return found


def port_open(host: str, port: int, timeout: float = 0.4) -> bool:
    try:
        with socket.create_connection((host, port), timeout):
            return True
    except OSError:
        return False


_fw_cache = {"at": 0.0, "ok": False}


def firewall_ready() -> bool:
    """Are both inbound rules present? Cached — this poll runs every 2s."""
    if not IS_WINDOWS:
        return True
    now = time.time()
    if now - _fw_cache["at"] < 5:
        return bool(_fw_cache["ok"])
    ok = True
    for rule in FIREWALL_RULES:
        r = subprocess.run(
            ["netsh", "advfirewall", "firewall", "show", "rule", f"name={rule}"],
            capture_output=True, text=True, creationflags=CREATE_FLAGS,
        )
        if r.returncode != 0:
            ok = False
            break
    _fw_cache.update(at=now, ok=ok)
    return ok


def npm_path() -> str | None:
    return shutil.which("npm")


def lan_origins(lan_ip: str) -> list[str]:
    """Frontend origins the API should trust in LAN mode.

    ``CORS_ALLOW_LAN`` already covers loopback and IP literals via regex, but a
    Windows box also answers to its own NetBIOS name — someone who types
    ``http://<pc-name>:3000`` would load the page and then have every API call
    refused. Hostnames can't go in the regex, so list them.
    """
    name = socket.gethostname()
    origins = [
        f"http://localhost:{WEB_PORT}",
        f"http://127.0.0.1:{WEB_PORT}",
        f"http://{lan_ip}:{WEB_PORT}",
    ]
    for host in (name, name.lower()):
        origins += [f"http://{host}:{WEB_PORT}", f"http://{host}.local:{WEB_PORT}"]
    # dict.fromkeys keeps first-seen order while dropping duplicates.
    return list(dict.fromkeys(origins))


# --------------------------------------------------------------------------
# managed child processes
# --------------------------------------------------------------------------
class Service:
    """One child process plus a rolling tail of its output.

    The tail is the point: with the old two-`cmd`-window launcher a server that
    died on boot took its own error message off screen with it.
    """

    def __init__(self, name: str) -> None:
        self.name = name
        self.proc: subprocess.Popen | None = None
        self._lines: deque[str] = deque(maxlen=400)
        self._lock = threading.Lock()

    def log(self, text: str) -> None:
        with self._lock:
            self._lines.append(ANSI_RE.sub("", text).rstrip("\r\n"))

    def tail(self) -> list[str]:
        with self._lock:
            return list(self._lines)

    def clear(self) -> None:
        with self._lock:
            self._lines.clear()

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def spawn(self, cmd: list[str], cwd: Path, env: dict) -> None:
        self.stop()
        self.log(f"$ {' '.join(cmd)}")
        self.proc = subprocess.Popen(
            cmd, cwd=str(cwd), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
            creationflags=CREATE_FLAGS,
        )
        threading.Thread(target=self._pump, args=(self.proc,), daemon=True).start()

    def _pump(self, proc: subprocess.Popen) -> None:
        try:
            for line in proc.stdout:  # type: ignore[union-attr]
                self.log(line)
        except Exception:
            pass
        code = proc.poll()
        if code:
            self.log(f"[{self.name} exited with code {code}]")

    def stop(self) -> None:
        proc, self.proc = self.proc, None
        if proc is None or proc.poll() is not None:
            return
        if IS_WINDOWS:
            # /T is required — npm spawns a node child that outlives terminate().
            subprocess.run(
                ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                capture_output=True, creationflags=CREATE_FLAGS,
            )
        else:
            proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


class Launcher:
    def __init__(self) -> None:
        self.api = Service("api")
        self.web = Service("web")
        self.build = Service("build")
        self.mode: str | None = None
        self.ip = ""
        self.phase = "idle"   # idle | starting | building | running | error
        self.message = ""
        self._lock = threading.Lock()

    # -- state ------------------------------------------------------------
    def state(self) -> dict:
        lan = self.ip if self.mode == "lan" else ""
        return {
            "mode": self.mode,
            "phase": self.phase,
            "message": self.message,
            "api_up": port_open("127.0.0.1", API_PORT),
            "web_up": port_open("127.0.0.1", WEB_PORT),
            "lan_ip": lan,
            "candidate_ips": candidate_ips(),
            "deps_ok": (FRONTEND / "node_modules").is_dir(),
            "built": (FRONTEND / ".next" / "BUILD_ID").exists(),
            "firewall_ok": firewall_ready(),
            "urls": {
                "local_web": f"http://localhost:{WEB_PORT}",
                "local_api": f"http://localhost:{API_PORT}",
                "lan_web": f"http://{lan}:{WEB_PORT}" if lan else "",
                "lan_api": f"http://{lan}:{API_PORT}" if lan else "",
            },
        }

    # -- start / stop -----------------------------------------------------
    def start(self, mode: str, ip: str = "", rebuild: bool = False) -> dict:
        with self._lock:
            if self.phase in ("starting", "building"):
                return {"ok": False, "error": "A start is already in progress."}
            self.phase = "starting"
            self.message = ""
        threading.Thread(
            target=self._start, args=(mode, ip, rebuild), daemon=True
        ).start()
        return {"ok": True}

    def _fail(self, msg: str) -> None:
        self.phase = "error"
        self.message = msg

    def _start(self, mode: str, ip: str, rebuild: bool) -> None:
        try:
            self.stop(quiet=True)
            npm = npm_path()
            if npm is None:
                return self._fail("npm was not found on PATH. Install Node.js and retry.")
            if not (FRONTEND / "node_modules").is_dir():
                return self._fail(
                    "frontend/node_modules is missing — run `npm install` in the frontend folder first."
                )

            # Something else already owns a port — most often servers left over
            # from an older start.bat. Spawning anyway would "succeed" (the port
            # answers) while the stale server actually serves the requests, so
            # say so instead. Ports we just released can linger for a moment, so
            # give them a grace period before calling it a conflict.
            busy_ports: list[str] = []
            deadline = time.time() + 5
            while True:
                busy_ports = [
                    str(p) for p in (API_PORT, WEB_PORT) if port_open("127.0.0.1", p)
                ]
                if not busy_ports or time.time() > deadline:
                    break
                time.sleep(0.3)
            if busy_ports:
                return self._fail(
                    f"Port {' and '.join(busy_ports)} already in use by another "
                    f"program. Run stop.bat, then try again."
                )

            lan = ip or primary_lan_ip()
            if mode == "lan" and not PRIVATE_RE.match(lan):
                return self._fail(
                    f"{lan} is not a private LAN address. Connect to your wifi and retry."
                )

            self.mode = mode
            self.ip = lan if mode == "lan" else "127.0.0.1"
            self.api.clear()
            self.web.clear()

            env = os.environ.copy()
            env["PYTHONUNBUFFERED"] = "1"
            # Always the loopback literal, in BOTH modes: lib/api.ts reads that
            # as "follow the host this page came from", which is what makes one
            # build serve localhost and every LAN address at the same time.
            env["NEXT_PUBLIC_API_BASE"] = f"http://127.0.0.1:{API_PORT}"

            host = "0.0.0.0" if mode == "lan" else "127.0.0.1"
            if mode == "local":
                # Keep dev output out of .next so it can't invalidate the
                # production build (see next.config.mjs) — otherwise every
                # switch back to LAN mode pays for a full rebuild.
                env["NEXT_DIST_DIR"] = ".next-dev"
            else:
                env.pop("NEXT_DIST_DIR", None)
            if mode == "lan":
                env["CORS_ALLOW_LAN"] = "1"
                env["CORS_ORIGINS"] = ",".join(lan_origins(lan))
                # Password-reset links are built from this; without it staff get
                # a link to the host PC's own loopback.
                env["APP_BASE_URL"] = f"http://{lan}:{WEB_PORT}"
            else:
                env.pop("CORS_ALLOW_LAN", None)

            self.api.spawn(
                [sys.executable, "-m", "uvicorn", "api.main:app",
                 "--host", host, "--port", str(API_PORT)],
                BACKEND, env,
            )

            if mode == "lan":
                if not self._ensure_build(npm, env, rebuild):
                    self.api.stop()
                    return self._fail("The web build failed — see the build log below.")
                self.web.spawn([npm, "run", "start", "--", "-H", host], FRONTEND, env)
            else:
                self.web.spawn([npm, "run", "dev", "--", "-H", host], FRONTEND, env)

            self.phase = "starting"
            if self._wait_ready():
                self.phase = "running"
            else:
                self._fail("The servers did not come up in time — check the logs below.")
        except Exception as exc:  # never leave the UI stuck on "starting"
            self._fail(f"{type(exc).__name__}: {exc}")

    def _ensure_build(self, npm: str, env: dict, rebuild: bool) -> bool:
        build_id = FRONTEND / ".next" / "BUILD_ID"
        if build_id.exists() and not rebuild:
            return True
        self.phase = "building"
        self.build.clear()
        self.build.log("[building the web app — the first run takes a couple of minutes]")
        proc = subprocess.Popen(
            [npm, "run", "build"], cwd=str(FRONTEND), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
            creationflags=CREATE_FLAGS,
        )
        self.build.proc = proc
        for line in proc.stdout:  # type: ignore[union-attr]
            self.build.log(line)
        ok = proc.wait() == 0
        self.build.log("[build finished]" if ok else "[build FAILED]")
        self.build.proc = None
        return ok

    def _wait_ready(self) -> bool:
        deadline = time.time() + READY_TIMEOUT
        api_healthy = False
        while time.time() < deadline:
            if not self.api.running():
                self.message = "The API process exited on startup."
                return False
            if not self.web.running():
                self.message = "The web process exited on startup."
                return False

            # Check if API is actually responding (not just listening on port)
            if not api_healthy:
                try:
                    import urllib.request
                    response = urllib.request.urlopen("http://127.0.0.1:8001/api/health", timeout=1)
                    if response.status == 200:
                        api_healthy = True
                except Exception:
                    pass

            # Both ports open AND API is healthy
            if api_healthy and port_open("127.0.0.1", WEB_PORT):
                return True

            time.sleep(0.5)
        return False

    def stop(self, quiet: bool = False) -> dict:
        self.web.stop()
        self.api.stop()
        if not quiet:
            self.mode = None
            self.ip = ""
            self.phase = "idle"
            self.message = ""
        return {"ok": True}


APP = Launcher()
atexit.register(lambda: APP.stop(quiet=True))


def qr_svg(url: str) -> bytes:
    import segno  # already a backend dependency

    buf = io.BytesIO()
    segno.make(url, error="m").save(
        buf, kind="svg", scale=4, border=2, dark="#1A1C1E", light=None
    )
    return buf.getvalue()


# --------------------------------------------------------------------------
# http control surface
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "FleetLauncher/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):   # keep the console clean
        pass

    # -- plumbing ---------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionAbortedError):
            pass

    def _json(self, data, code: int = 200) -> None:
        self._send(code, json.dumps(data).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _authed(self, query: dict | None = None) -> bool:
        """Token-gate the control API.

        The launcher listens on loopback, but any web page the user has open can
        also reach loopback. The token lives in the served HTML, which the same
        origin policy keeps another site from reading, and the Host check blocks
        DNS rebinding. The query-string form exists for `<img src>`, which
        cannot carry a custom header.
        """
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return False
        if self.headers.get("X-Launcher-Token") == TOKEN:
            return True
        return bool(query) and (query.get("t") or [""])[0] == TOKEN

    # -- routes -----------------------------------------------------------
    def do_GET(self) -> None:
        route = urlparse(self.path)
        path, query = route.path, parse_qs(route.query)

        if path in ("/", "/index.html"):
            try:
                html = INDEX.read_text(encoding="utf-8")
            except OSError as exc:
                return self._send(500, f"Cannot read index.html: {exc}".encode(),
                                  "text/plain; charset=utf-8")
            html = html.replace("__LAUNCHER_TOKEN__", TOKEN)
            return self._send(200, html.encode("utf-8"), "text/html; charset=utf-8")

        if path.startswith("/api/"):
            if not self._authed(query):
                return self._json({"error": "forbidden"}, 403)
            if path == "/api/state":
                return self._json(APP.state())
            if path == "/api/logs":
                svc = (query.get("svc") or ["web"])[0]
                target = {"api": APP.api, "web": APP.web, "build": APP.build}.get(svc)
                if target is None:
                    return self._json({"error": "unknown service"}, 404)
                return self._json({"svc": svc, "lines": target.tail()})
            if path == "/api/qr.svg":
                url = (query.get("u") or [""])[0]
                if not url:
                    return self._json({"error": "missing u"}, 400)
                try:
                    return self._send(200, qr_svg(url), "image/svg+xml")
                except Exception as exc:
                    return self._json({"error": str(exc)}, 500)

        self._send(404, b"not found", "text/plain; charset=utf-8")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if not self._authed():
            return self._json({"error": "forbidden"}, 403)

        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            payload = {}

        if path == "/api/start":
            mode = payload.get("mode")
            if mode not in ("local", "lan"):
                return self._json({"error": "mode must be 'local' or 'lan'"}, 400)
            return self._json(APP.start(mode, payload.get("ip", ""),
                                        bool(payload.get("rebuild"))))
        if path == "/api/stop":
            return self._json(APP.stop())
        if path == "/api/firewall":
            if not IS_WINDOWS:
                return self._json({"error": "Windows only"}, 400)
            if not FIREWALL_BAT.exists():
                return self._json({"error": "allow-firewall.bat is missing"}, 500)
            # Elevation prompt is Windows' own UAC dialog — the user approves it.
            subprocess.Popen(
                ["powershell", "-NoProfile", "-Command",
                 f"Start-Process -FilePath '{FIREWALL_BAT}' -Verb RunAs"],
                creationflags=CREATE_FLAGS,
            )
            _fw_cache["at"] = 0.0
            return self._json({"ok": True})

        self._json({"error": "not found"}, 404)


def main() -> int:
    if not INDEX.exists():
        print(f"index.html not found at {INDEX}", file=sys.stderr)
        return 1
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", LAUNCHER_PORT), Handler)
    except OSError as exc:
        print(f"Cannot bind 127.0.0.1:{LAUNCHER_PORT} — is the launcher already "
              f"running?\n  {exc}", file=sys.stderr)
        return 1
    httpd.daemon_threads = True

    url = f"http://127.0.0.1:{LAUNCHER_PORT}/"
    print("=" * 52)
    print("  Balkan Car Rentals - Fleet Console launcher")
    print("=" * 52)
    print(f"\n  {url}\n")
    print("  Leave this window open. Ctrl+C stops everything.\n")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping servers...")
    finally:
        APP.stop(quiet=True)
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
