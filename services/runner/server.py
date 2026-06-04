#!/usr/bin/env python3
"""VHPCE local measurement runner (Phase 2 prototype).

Producer B from docs/01-architecture.md: compiles and runs the OpenMP kernels in
experiments/bench.c on THIS machine and serves the measured sweeps to the flagship
UI behind a Model | Measured toggle. Standard library only — no pip install needed.

Run inside WSL (where gcc lives):
    python3 services/runner/server.py

Then the browser fetches http://localhost:8099/run?exp=...&variant=...&maxthreads=24
(WSL2 forwards localhost to Windows, so it's reachable from the Windows browser).

NOTE: the eventual production gateway is FastAPI (see docs); this stdlib server is a
zero-dependency stand-in so we can measure today without setting up a venv.
"""
import json, os, subprocess, threading, urllib.parse
import http.server, socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
SRC  = os.path.join(HERE, "experiments", "bench.c")
BIN  = "/tmp/vhpce_bench"
PORT = 8099
DOCKER_IMAGE = "vhpce-runner"
DEFAULT_SWEEP = [1, 2, 4, 8, 12, 16, 20, 24]
MAX_SOURCE = 64 * 1024  # bytes

# Allow-list: frontend exp id -> (bench exp, {allowed variants})
ALLOWED = {
    "falsesharing": {"shared", "padded"},
    "sync":         {"critical", "atomic", "reduction"},
    "bandwidth":    {"triad"},
    "imbalance":    {"static", "guided", "dynamic"},
}

_cache = {}
_lock = threading.Lock()
_run = threading.Lock()   # serialize benchmark subprocesses so timings aren't polluted


def compile_bench():
    cmd = ["gcc", "-O2", "-fopenmp", "-march=native", "-o", BIN, SRC, "-lm"]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("compile failed:\n" + r.stderr)
    return " ".join(cmd)


def ensure_built():
    if not os.path.exists(BIN) or os.path.getmtime(SRC) > os.path.getmtime(BIN):
        return compile_bench()
    return "up-to-date"


def run_bench(exp, variant, maxt):
    if exp not in ALLOWED or variant not in ALLOWED[exp]:
        raise ValueError(f"unknown exp/variant: {exp}/{variant}")
    maxt = max(1, min(int(maxt), 64))
    key = (exp, variant, maxt)
    with _lock:
        if key in _cache:
            return _cache[key]
    ensure_built()
    with _run:
        proc = subprocess.run([BIN, exp, variant, str(maxt)],
                              capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise RuntimeError("run failed:\n" + proc.stderr)
    data = json.loads(proc.stdout)
    data["source"] = "measured"
    data["cores"] = os.cpu_count()
    data["machine"] = "wsl2-local"
    with _lock:
        _cache[key] = data
    return data


def run_user_code(source, sweep, reps, profile=False):
    """Compile + benchmark arbitrary OpenMP C in a locked-down Docker container.
    Source arrives via stdin; nothing from the host filesystem is exposed."""
    if not source or len(source) > MAX_SOURCE:
        raise ValueError("source missing or too large")
    sweep = [int(p) for p in (sweep or DEFAULT_SWEEP) if isinstance(p, (int, float)) and 1 <= int(p) <= 64][:32] or DEFAULT_SWEEP
    reps = max(1, min(int(reps), 5))
    cmd = [
        "docker", "run", "--rm", "-i",
        "--network", "none",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", "2g", "--memory-swap", "2g",
        "--pids-limit", "256",
        "--read-only", "--tmpfs", "/tmp:rw,exec,size=512m",
        DOCKER_IMAGE,
        " ".join(str(p) for p in sweep), str(reps), "1" if profile else "0",
    ]
    with _run:
        proc = subprocess.run(cmd, input=source, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise RuntimeError("docker run failed: " + (proc.stderr.strip()[-1500:] or f"rc={proc.returncode}"))
    data = json.loads(proc.stdout)
    if "error" not in data:
        data["source"] = "measured"
        data["cores"] = os.cpu_count()
        data["sweepThreads"] = sweep
    return data


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path == "/health":
                gcc = subprocess.run(["gcc", "--version"], capture_output=True, text=True)
                dk = subprocess.run(["docker", "version", "--format", "{{.Server.Version}}"], capture_output=True, text=True)
                self._send(200, {"ok": True, "cores": os.cpu_count(),
                                 "gcc": gcc.stdout.splitlines()[0] if gcc.returncode == 0 else None,
                                 "docker": dk.stdout.strip() if dk.returncode == 0 and dk.stdout.strip() else None})
                return
            if u.path == "/run":
                exp     = q.get("exp", [""])[0]
                variant = q.get("variant", [""])[0]
                maxt    = q.get("maxthreads", ["24"])[0]
                self._send(200, run_bench(exp, variant, maxt))
                return
            self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001 — surface the message to the UI
            self._send(500, {"error": str(e)})

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw or b"{}")
            if u.path == "/run-code":
                data = run_user_code(body.get("source", ""), body.get("threads"), body.get("reps", 2), bool(body.get("profile")))
                self._send(200, data)
                return
            self._send(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": str(e)})

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    try:
        print("[runner] compile:", ensure_built(), flush=True)
    except Exception as e:  # noqa: BLE001
        print("[runner] compile error:", e, flush=True)
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"[runner] listening on 0.0.0.0:{PORT}  cores={os.cpu_count()}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
