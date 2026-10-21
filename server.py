#!/usr/bin/env python3
"""RTL LaTeX Live Editor: a local, Overleaf-like editor with first-class right-to-left support.

Standard library only.  Usage:

    python server.py [--root DIR] [--main main.tex] [--port 8765] [--config FILE]

Settings come from (highest priority first) the command line, a JSON config file
(``--config FILE`` or ``livetex.json`` in the project root) and the built-in defaults.
"""
import argparse, hashlib, json, os, re, signal, subprocess, sys, tempfile, threading, time, urllib.parse, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
HINTS_DIR = HERE / "hints"
CONFIG_NAME = "livetex.json"

ENGINES = {"xelatex": "-xelatex", "lualatex": "-lualatex", "pdflatex": "-pdf"}
EDITABLE_EXTS = {".tex", ".bib", ".sty", ".cls", ".md"}   # editable by name; only `extensions` are listed
HIST_KEEP = 200
COMPILE_TIMEOUT = 600
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}

DEFAULTS = {
    "root": ".", "main": "main.tex", "port": 8765, "title": "", "engine": "xelatex",
    "order": [], "names": {}, "extensions": [".tex", ".bib"], "outdir": "_live",
    "hints": [], "ui": "en",
}


class HttpError(Exception):
    def __init__(self, code, msg, extra=None):
        self.code, self.msg, self.extra = code, msg, extra


class ConfigError(Exception):
    pass


# ---------------------------------------------------------------- configuration
class Config:
    """Resolved settings.  `root` is an absolute Path; everything else is plain data."""

    def __init__(self, **kw):
        d = dict(DEFAULTS)
        d.update(kw)
        self.root = Path(d["root"]).resolve()
        self.main = d["main"]
        self.port = int(d["port"])
        self.title = d["title"] or self.root.name
        self.engine = d["engine"]
        self.order = list(d["order"])
        self.names = dict(d["names"])
        self.extensions = {e.lower() if e.startswith(".") else "." + e.lower() for e in d["extensions"]}
        self.outdir = d["outdir"]
        self.hints = list(d["hints"])
        self.ui = d["ui"]
        self.base = Path(d.get("_base", self.root))   # where relative hint-pack paths resolve
        self.validate()

    def validate(self):
        if self.engine not in ENGINES:
            raise ConfigError("engine must be one of %s, got %r" % (", ".join(ENGINES), self.engine))
        if self.ui not in ("en", "fa"):
            raise ConfigError('ui must be "en" or "fa", got %r' % (self.ui,))
        if not (0 < self.port < 65536):
            raise ConfigError("port out of range: %r" % (self.port,))
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", self.outdir or "") or self.outdir.startswith("."):
            raise ConfigError("outdir must be a plain folder name (letters, digits, _ - .), got %r" % (self.outdir,))
        if "/" in self.main or "\\" in self.main or not self.main.lower().endswith(".tex"):
            raise ConfigError("main must be a .tex file name inside the root, got %r" % (self.main,))
        if not isinstance(self.order, list) or not all(isinstance(x, str) for x in self.order):
            raise ConfigError("order must be a list of file names")
        if not isinstance(self.names, dict):
            raise ConfigError("names must be an object {file name: display name}")
        if not isinstance(self.hints, list):
            raise ConfigError("hints must be a list of pack names or paths")

    @property
    def stem(self):
        return Path(self.main).stem

    @property
    def pdf_rel(self):
        return "%s/%s.pdf" % (self.outdir, self.stem)

    @property
    def latexmk(self):
        return ["latexmk", ENGINES[self.engine], "-synctex=1", "-interaction=nonstopmode", "-file-line-error",
                "-outdir=" + self.outdir, self.main]

    def public(self):
        return {"title": self.title, "ui": self.ui, "main": self.main, "engine": self.engine,
                "names": self.names, "order": self.order}


CFG = Config()


def load_config(argv=None):
    ap = argparse.ArgumentParser(description="RTL LaTeX Live Editor")
    ap.add_argument("--root", help="LaTeX project folder (default: current folder, or `root` of the config)")
    ap.add_argument("--main", help="main .tex file (default: main.tex)")
    ap.add_argument("--port", type=int, help="port (default: 8765)")
    ap.add_argument("--config", help="config JSON (default: %s in the root)" % CONFIG_NAME)
    ap.add_argument("--open", action="store_true", help="open the editor in the default browser")
    a = ap.parse_args(argv)
    data, base = {}, None
    cfg_path = Path(a.config).resolve() if a.config else None
    if cfg_path is None:
        guess = Path(a.root or ".").resolve() / CONFIG_NAME
        if guess.is_file():
            cfg_path = guess
        elif a.root is None and (HERE / CONFIG_NAME).is_file():   # vendored copy: config kept next to server.py
            cfg_path = HERE / CONFIG_NAME
    if cfg_path is not None:
        try:
            data = json.loads(cfg_path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as e:
            raise ConfigError("cannot read config %s: %s" % (cfg_path, e))
        if not isinstance(data, dict):
            raise ConfigError("config %s must be a JSON object" % cfg_path)
        unknown = sorted(set(data) - set(DEFAULTS))
        if unknown:
            raise ConfigError("unknown config key(s): %s (known: %s)" % (", ".join(unknown), ", ".join(DEFAULTS)))
        base = cfg_path.parent
    data = dict(data)
    if "root" in data:                       # config-relative
        data["root"] = str((base / data["root"]).resolve())
    elif a.root is None:
        data["root"] = str(base) if base else os.getcwd()
    if a.root:                               # CLI-relative
        data["root"] = str(Path(a.root).resolve())
    if a.main:
        data["main"] = a.main
    if a.port:
        data["port"] = a.port
    data["_base"] = str(base or Path(data["root"]))
    return Config(**data), a


def set_config(cfg):
    global CFG
    CFG = cfg


def sha(b):
    return hashlib.sha256(b).hexdigest()


def safe_path(rel, root=None):
    """Validate a client-supplied file name; return an absolute Path directly inside root."""
    root = root or CFG.root
    if not isinstance(rel, str) or not rel:
        raise HttpError(403, "bad path")
    if ".." in rel or "/" in rel or "\\" in rel or ":" in rel or rel.startswith(("~", ".")):
        raise HttpError(403, "bad path")
    if Path(rel).is_absolute() or os.path.isabs(rel):
        raise HttpError(403, "bad path")
    if Path(rel).suffix.lower() not in EDITABLE_EXTS:
        raise HttpError(403, "extension not allowed")
    return root / rel


def decode(raw):
    bom = raw.startswith(b"\xef\xbb\xbf")
    if bom:
        raw = raw[3:]
    text = raw.decode("utf-8")
    eol = "CRLF" if b"\r\n" in raw else "LF"
    return text.replace("\r\n", "\n"), bom, eol


def encode(content, bom, eol):
    content = content.replace("\r\n", "\n")
    if eol == "CRLF":
        content = content.replace("\n", "\r\n")
    b = content.encode("utf-8")
    return (b"\xef\xbb\xbf" + b) if bom else b


def list_files(root=None, cfg=None):
    cfg = cfg or CFG
    root = root or cfg.root
    names = [p.name for p in root.iterdir() if p.is_file() and p.suffix.lower() in cfg.extensions]
    first = [n for n in cfg.order if n in names]
    rest = sorted(n for n in names if n not in first)
    out = []
    for n in first + rest:
        p = root / n
        try:
            b = p.read_bytes()
            out.append({"name": n, "mtime": p.stat().st_mtime, "size": len(b), "sha256": sha(b)})
        except OSError:
            pass
    return out


def read_file(rel, root=None):
    p = safe_path(rel, root)
    if not p.is_file():
        raise HttpError(404, "no such file")
    raw = p.read_bytes()
    try:
        text, bom, eol = decode(raw)
    except UnicodeDecodeError:
        raise HttpError(415, "file is not valid UTF-8")
    return {"content": text, "sha256": sha(raw), "mtime": p.stat().st_mtime, "eol": eol, "bom": bom}


def _hist_key(p):
    """Sort key for history files: (timestamp, same-second counter), so '...-10' sorts after '...-2'."""
    ts, _, n = p.stem.partition("-")
    rest, _, cnt = n.partition("-")
    return (ts, rest, int(cnt) if cnt.isdigit() else 0)


def save_file(rel, content, base_sha, root=None):
    root = root or CFG.root
    p = safe_path(rel, root)
    if not p.is_file():
        raise HttpError(404, "no such file")
    old = p.read_bytes()
    if sha(old) != base_sha:
        text, bom, eol = decode(old)
        raise HttpError(409, "changed on disk", {"content": text, "sha256": sha(old), "eol": eol})
    _, bom, eol = decode(old)
    hist = root / "_edit_history" / rel
    hist.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    hp = hist / (ts + ".tex")
    n = 1
    while hp.exists():
        hp = hist / ("%s-%d.tex" % (ts, n)); n += 1
    hp.write_bytes(old)
    for stale in sorted(hist.glob("*.tex"), key=_hist_key)[:-HIST_KEEP]:
        try: stale.unlink()
        except OSError: pass
    data = encode(content, bom, eol)
    fd, tmp = tempfile.mkstemp(dir=str(root), prefix=".edit-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return {"sha256": sha(data)}


def history_list(rel, root=None):
    root = root or CFG.root
    safe_path(rel, root)
    d = root / "_edit_history" / rel
    if not d.is_dir():
        return []
    return [{"ts": p.stem, "size": p.stat().st_size} for p in sorted(d.glob("*.tex"), key=_hist_key, reverse=True)]


def history_file(rel, ts, root=None):
    root = root or CFG.root
    safe_path(rel, root)
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}(-[0-9]+)?", ts or ""):
        raise HttpError(403, "bad ts")
    p = root / "_edit_history" / rel / (ts + ".tex")
    if not p.is_file():
        raise HttpError(404, "no such version")
    text, _, _ = decode(p.read_bytes())
    return {"content": text}


# ---------------------------------------------------------------- log / synctex parsing
ERR_RE = re.compile(r"^(?:\./)?([^\s:][^:\n]*?\.(?:tex|sty|cls|bib|def|cfg|clo)):(\d+): (.*)$")


def parse_errors(log):
    errs, seen = [], set()
    lines = log.splitlines()
    for i, ln in enumerate(lines):
        m = ERR_RE.match(ln.strip())
        if m:
            msg = m.group(3).strip()
            for nxt in lines[i + 1:i + 4]:      # context line carrying the culprit
                if nxt.startswith("l."):
                    msg += "  [" + nxt.strip() + "]"
                    break
            key = (m.group(1), m.group(2), msg)
            if key not in seen:
                seen.add(key)
                errs.append({"file": m.group(1), "line": int(m.group(2)), "message": msg})
        elif ln.startswith("! ") and not (i > 0 and ERR_RE.match(lines[i - 1].strip())):
            if not any(e["message"].startswith(ln[2:].strip()) for e in errs):
                errs.append({"file": "", "line": 0, "message": ln[2:].strip()})
    return errs


def parse_pages(log):
    m = re.findall(r"(?s)Output written on .*?\((\d+)\s+pages?", log)
    return int(m[-1]) if m else None


def count_warnings(log):
    return len(re.findall(r"(?:LaTeX|Package \S+|Class \S+) Warning", log))


def parse_synctex_edit(out):
    inp = re.search(r"^Input:(.*)$", out, re.M)
    line = re.search(r"^Line:(-?\d+)", out, re.M)
    if not inp or not line:
        return None
    return {"input": inp.group(1).strip(), "line": int(line.group(1))}


def parse_synctex_view(out):
    boxes = []
    for blk in out.split("SyncTeX result begin")[1:]:
        for rec in re.split(r"(?m)^Output:", blk)[1:]:
            d = {}
            for k in ("Page", "x", "y", "h", "v", "W", "H"):
                m = re.search(r"^%s:(-?[0-9.]+)" % k, rec, re.M)
                if m:
                    d[k] = float(m.group(1))
            if "Page" in d and "W" in d:
                boxes.append({"page": int(d["Page"]), "h": d.get("h", 0), "v": d.get("v", 0),
                              "W": d.get("W", 0), "H": d.get("H", 0)})
    return boxes


def editable_basename(path, root=None):
    root = root or CFG.root
    base = path.replace("\\", "/").split("/")[-1]
    if not base or Path(base).suffix.lower() not in EDITABLE_EXTS:
        return None
    return base if (root / base).is_file() else None


def run_synctex(args):
    try:
        r = subprocess.run(["synctex"] + args, cwd=str(CFG.root), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HttpError(500, "synctex failed: %s" % e)
    return r.stdout


# ---------------------------------------------------------------- compile manager
class Compiler:
    def __init__(self):
        self.lock = threading.Lock()
        self.state = "idle"
        self.started = None
        self.finished = None
        self.seconds = 0
        self.pages = None
        self.errors = []
        self.warnings = 0
        self.log_tail = ""
        self.pending = False
        self.proc = None
        self.killed = False

    def request(self):
        with self.lock:
            if self.state == "running":
                self.pending = True
                return "queued"
            self.state = "running"
            self.started = time.time()
            threading.Thread(target=self._loop, daemon=True).start()
            return "started"

    def _loop(self):
        while True:
            self._once()
            with self.lock:
                if self.pending:
                    self.pending = False
                    self.state = "running"
                    self.started = time.time()
                    continue
                return

    def _once(self):
        root = CFG.root
        (root / CFG.outdir).mkdir(exist_ok=True)
        t0 = time.time()
        self.killed = False
        try:
            env = dict(os.environ)
            for k in ("BIBINPUTS", "BSTINPUTS", "TEXINPUTS"):   # bibtex/biber run inside outdir and must still see the project files
                env[k] = str(root) + os.pathsep + env.get(k, "")
            kw = {} if os.name == "nt" else {"start_new_session": True}
            self.proc = subprocess.Popen(CFG.latexmk, cwd=str(root), env=env, stdout=subprocess.PIPE,
                                         stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, **kw)
            timer = threading.Timer(COMPILE_TIMEOUT, self._kill)
            timer.start()
            out = self.proc.communicate()[0]
            timer.cancel()
            rc = self.proc.returncode
        except OSError as e:
            out, rc = ("failed to start latexmk: %s (is a TeX distribution with latexmk on PATH?)" % e).encode(), -1
        text = out.decode("utf-8", errors="replace")
        logp = root / CFG.outdir / (CFG.stem + ".log")
        logtxt = logp.read_text(encoding="utf-8", errors="replace") if logp.is_file() else ""
        errors = parse_errors(logtxt) or parse_errors(text)
        if not errors and rc != 0:
            errors = [{"file": "", "line": 0, "message": (text.strip().splitlines() or ["latexmk failed"])[-1]}]
        pages = parse_pages(text) or parse_pages(logtxt)
        with self.lock:
            self.errors = errors
            self.pages = pages
            self.warnings = count_warnings(logtxt)
            self.log_tail = "\n".join((text or logtxt).splitlines()[-80:])
            self.finished = time.time()
            self.seconds = self.finished - t0
            if self.killed:
                self.errors = [{"file": "", "line": 0, "message": "compile killed after 10 minutes"}]
            self.state = "ok" if (rc == 0 and not self.errors) else "error"

    def _kill(self):
        self.killed = True
        try:
            if os.name == "nt":
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.proc.pid)], capture_output=True)
            else:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
        except Exception:
            try: self.proc.kill()
            except Exception: pass

    def status(self):
        with self.lock:
            running = self.state == "running"
            secs = (time.time() - self.started) if running else self.seconds
            return {"state": self.state, "started": self.started, "seconds": round(secs or 0, 1),
                    "pages": self.pages, "errors": self.errors, "warnings_count": self.warnings,
                    "log_tail": self.log_tail, "finished": self.finished, "queued": self.pending}


COMPILER = Compiler()


# ---------------------------------------------------------------- hint packs
def resolve_pack(ref, cfg=None):
    """A pack reference is a built-in name (hints/<name>.json) or a path (relative to the config file)."""
    cfg = cfg or CFG
    cands = []
    p = Path(ref)
    if p.is_absolute():
        cands.append(p)
    else:
        cands += [cfg.base / ref, HINTS_DIR / ref, HINTS_DIR / (ref + ".json")]
    for c in cands:
        if c.is_file():
            return c
    return None


def load_pack(path):
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    items = data.get("phrases", []) if isinstance(data, dict) else data
    out = []
    for it in items:
        if isinstance(it, dict) and isinstance(it.get("pattern"), str) and it["pattern"]:
            out.append({"pattern": it["pattern"], "hint": str(it.get("hint", "")), "re": bool(it.get("re"))})
    return out


def load_phrases(cfg=None):
    cfg = cfg or CFG
    out = []
    for ref in cfg.hints:
        p = resolve_pack(ref, cfg)
        if p is None:
            print("warning: hint pack not found: %s" % ref, file=sys.stderr)
            continue
        try:
            out += load_pack(p)
        except (OSError, ValueError) as e:
            print("warning: cannot read hint pack %s: %s" % (p, e), file=sys.stderr)
    return out


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "RTLLatexLiveEditor/1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            body = None
            if method in ("PUT", "POST"):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                body = json.loads(raw.decode("utf-8")) if raw else {}
            self._route(method, u.path, q, body)
        except HttpError as e:
            payload = {"error": e.msg}
            if e.extra:
                payload.update(e.extra)
            self._send(e.code, payload)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            try:
                self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})
            except Exception:
                pass

    def do_GET(self): self._handle("GET")
    def do_PUT(self): self._handle("PUT")
    def do_POST(self): self._handle("POST")

    def _route(self, m, path, q, body):
        if m == "GET" and path == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        if m == "GET" and not path.startswith(("/api/", "/pdf")):
            name = "index.html" if path in ("/", "") else path.lstrip("/")
            f = (STATIC / name).resolve()
            if STATIC.resolve() not in f.parents or not f.is_file():
                raise HttpError(404, "not found")
            return self._send(200, f.read_bytes(), MIME.get(f.suffix, "application/octet-stream"))
        if m == "GET" and path == "/pdf":
            p = CFG.root / CFG.outdir / (CFG.stem + ".pdf")
            if not p.is_file():
                raise HttpError(404, "no pdf yet")
            return self._send(200, p.read_bytes(), "application/pdf")
        if m == "GET" and path == "/api/config":
            return self._send(200, CFG.public())
        if m == "GET" and path == "/api/files":
            return self._send(200, {"files": list_files()})
        if m == "GET" and path == "/api/file":
            return self._send(200, read_file(q.get("path", "")))
        if m == "PUT" and path == "/api/file":
            body = body or {}
            return self._send(200, save_file(body.get("path"), body.get("content", ""), body.get("base_sha256")))
        if m == "GET" and path == "/api/history":
            return self._send(200, {"versions": history_list(q.get("path", ""))})
        if m == "GET" and path == "/api/history/file":
            return self._send(200, history_file(q.get("path", ""), q.get("ts", "")))
        if m == "POST" and path == "/api/compile":
            return self._send(200, {"result": COMPILER.request()})
        if m == "GET" and path == "/api/compile/status":
            return self._send(200, COMPILER.status())
        if m == "GET" and path == "/api/changes":
            return self._send(200, {"files": list_files()})
        if m == "GET" and path == "/api/phrases":
            return self._send(200, load_phrases())
        if m == "GET" and path == "/api/synctex/edit":
            try:
                page, x, y = int(q["page"]), float(q["x"]), float(q["y"])
            except (KeyError, ValueError):
                raise HttpError(400, "page, x, y required")
            out = run_synctex(["edit", "-o", "%d:%.3f:%.3f:%s" % (page, x, y, CFG.pdf_rel)])
            r = parse_synctex_edit(out)
            if not r:
                raise HttpError(404, "no source found")
            base = editable_basename(r["input"])
            if not base:
                raise HttpError(404, "source %s is not editable" % r["input"])
            return self._send(200, {"file": base, "line": r["line"]})
        if m == "GET" and path == "/api/synctex/view":
            f = q.get("file", "")
            safe_path(f)
            try:
                line = int(q["line"])
            except (KeyError, ValueError):
                raise HttpError(400, "line required")
            boxes, used = [], line
            # Some TeX distributions record inputs as absolute backslash paths; synctex matches the name as given.
            # Blank/comment lines have no box, so look at the neighbouring lines too.
            for ln in [line] + [line + d for k in range(1, 6) for d in (k, -k)]:
                if ln < 1:
                    continue
                for cand in (str(CFG.root / f), f, "./" + f):
                    boxes = parse_synctex_view(run_synctex(["view", "-i", "%d:0:%s" % (ln, cand), "-o", CFG.pdf_rel]))
                    if boxes:
                        break
                if boxes:
                    used = ln
                    break
            return self._send(200, {"boxes": boxes, "line": used})
        raise HttpError(404, "not found")


def main(argv=None):
    try:
        cfg, args = load_config(argv)
    except ConfigError as e:
        print("config error: %s" % e, file=sys.stderr)
        return 2
    set_config(cfg)
    if not cfg.root.is_dir():
        print("error: root folder does not exist: %s" % cfg.root, file=sys.stderr)
        return 2
    if not (cfg.root / cfg.main).is_file():
        print("warning: main file %s not found in %s" % (cfg.main, cfg.root), file=sys.stderr)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", cfg.port), Handler)
    except OSError as e:
        print("error: cannot listen on 127.0.0.1:%d (%s). Is another editor already running? Use --port." % (cfg.port, e),
              file=sys.stderr)
        return 1
    url = "http://127.0.0.1:%d" % cfg.port
    print("RTL LaTeX Live Editor on %s  (root %s, main %s, engine %s)" % (url, cfg.root, cfg.main, cfg.engine), flush=True)
    if args.open:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
