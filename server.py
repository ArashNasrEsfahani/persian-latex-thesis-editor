#!/usr/bin/env python3
"""RTL LaTeX Live Editor: a local, Overleaf-like editor with first-class right-to-left support.

Standard library only.  Usage:

    python server.py [--root DIR] [--main main.tex] [--port 8765] [--config FILE]

Settings come from (highest priority first) the command line, a JSON config file
(``--config FILE`` or ``livetex.json`` in the project root) and the built-in defaults.
"""
import argparse, bisect, hashlib, json, os, posixpath, re, shutil, signal, subprocess, sys, tempfile, threading, time
import unicodedata, urllib.parse, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
HINTS_DIR = HERE / "hints"
CONFIG_NAME = "livetex.json"

ENGINES = {"xelatex": "-xelatex", "lualatex": "-lualatex", "pdflatex": "-pdf"}
# editable as text by path; only `extensions` are listed among the main documents
EDITABLE_EXTS = {".tex", ".bib", ".sty", ".cls", ".md", ".txt", ".csv", ".dat", ".tikz", ".pgf", ".bst", ".bbx",
                 ".cbx", ".lbx", ".def", ".cfg", ".clo", ".ltx", ".dtx", ".ins"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".pdf", ".svg", ".eps"}            # what \includegraphics can take
UPLOAD_EXTS = EDITABLE_EXTS | IMAGE_EXTS | {".ttf", ".otf"}
RAW_MIME = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
            ".pdf": "application/pdf", ".eps": "application/postscript"}
HIST_DIR = "_edit_history"
TRASH_DIR = "_edit_trash"
SKIP_ANYWHERE = {".git", "node_modules", "__pycache__"}
HIST_KEEP = 200
COMPILE_TIMEOUT = 600
MAX_UPLOAD = 25 * 1024 * 1024
MAX_BODY = 32 * 1024 * 1024
TREE_MAX = 20000
SEARCH_MAX = 5000
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8"}

DEFAULTS = {
    "root": ".", "main": "main.tex", "port": 8765, "title": "", "engine": "xelatex",
    "order": [], "names": {}, "extensions": [".tex", ".bib"], "outdir": "_live",
    "hints": [], "ui": "en", "uploads": "figs/uploads", "fast_pdf": True,
}
# xelatex writes an .xdv in ~3 s even for 120 pages; xdvipdfmx at its default (maximum) compression then needs ~36 s.
# Everyday compiles write the preview PDF with light compression; "Final PDF" rewrites it at full compression.
FAST_RC = ".livetex-fast.latexmkrc"
FAST_RC_TEXT = "$xdvipdfmx = 'xdvipdfmx -z 1 -E -o %D %O %S';\n"
CHANGED_SHOW = 30


class HttpError(Exception):
    def __init__(self, code, msg, extra=None):
        self.code, self.msg, self.extra = code, msg, extra


class ConfigError(Exception):
    pass


WIN_RESERVED = re.compile(r"(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$")


def bad_component(part):
    """True for a path component that must never come from the browser."""
    return (part in ("", ".", "..") or part.startswith((".", "~")) or part != part.rstrip(". ")
            or WIN_RESERVED.match(part) is not None or any(ord(c) < 32 for c in part)
            or any(c in part for c in '<>:"|?*\\'))


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
        self.uploads = str(d["uploads"] or "").strip().strip("/")
        self.base = Path(d.get("_base", self.root))   # where relative hint-pack paths resolve
        self.fast_pdf = bool(d["fast_pdf"])
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
        parts = self.uploads.split("/")
        if (not self.uploads or any(bad_component(p) for p in parts)
                or parts[0] in (self.outdir, HIST_DIR, TRASH_DIR)):
            raise ConfigError("uploads must be a relative folder inside the root such as \"figs/uploads\", got %r"
                              % (self.uploads,))

    @property
    def stem(self):
        return Path(self.main).stem

    @property
    def pdf_rel(self):
        return "%s/%s.pdf" % (self.outdir, self.stem)

    @property
    def fast_rc(self):
        """The latexmk rc (relative to the root) that sets the light-compression PDF writer, or None."""
        return self.outdir + "/" + FAST_RC if (self.fast_pdf and self.engine == "xelatex") else None

    @property
    def latexmk(self):
        rc = ["-r", self.fast_rc] if self.fast_rc else []
        return ["latexmk"] + rc + [ENGINES[self.engine], "-synctex=1", "-interaction=nonstopmode", "-file-line-error",
                                   "-outdir=" + self.outdir, self.main]

    def final_pdf(self, dest):
        """xdvipdfmx at its default compression over the .xdv the last build left (xelatex only)."""
        return ["xdvipdfmx", "-q", "-E", "-o", dest, "%s/%s.xdv" % (self.outdir, self.stem)]

    @property
    def latexmk_clean(self):
        return ["latexmk", "-C", "-outdir=" + self.outdir, self.main]

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


# ---------------------------------------------------------------- path safety
def protected_tops(cfg=None):
    cfg = cfg or CFG
    return {cfg.outdir, HIST_DIR, TRASH_DIR}


def check_rel(rel, root=None, cfg=None):
    """Validate a client-supplied project path such as "chapters/ch1.tex" (forward slashes only).

    Returns root / rel.  Rejects absolute paths, drive letters, "..", hidden or reserved names, the output, history
    and trash folders, and anything that resolves (through a symlink, for example) outside the root."""
    root = root or CFG.root
    cfg = cfg or CFG
    if not isinstance(rel, str) or not rel or len(rel) > 1024:
        raise HttpError(403, "bad path")
    if rel.startswith("/") or os.path.isabs(rel) or Path(rel).is_absolute():
        raise HttpError(403, "bad path")
    parts = rel.split("/")
    if any(bad_component(p) for p in parts):
        raise HttpError(403, "bad path")
    if parts[0] in protected_tops(cfg) or parts[0] == ".git":
        raise HttpError(403, "this folder is managed by the editor")
    p = root.joinpath(*parts)
    rroot = root.resolve()
    rp = p.resolve()
    if rp == rroot or rroot not in rp.parents:
        raise HttpError(403, "path leaves the project folder")
    return p


def safe_path(rel, root=None):
    """Validate a client-supplied text-file path; return an absolute Path inside root."""
    p = check_rel(rel, root)
    if Path(rel).suffix.lower() not in EDITABLE_EXTS:
        raise HttpError(403, "extension not allowed")
    return p


def rel_of(p, root):
    return Path(os.path.relpath(str(p), str(root))).as_posix()


def under_underscore(rel):
    """True when a folder (not the file name) of `rel` starts with "_"."""
    return any(part.startswith("_") for part in rel.split("/")[:-1])


def project_walk(root=None, cfg=None):
    """Yield (rel, is_dir, stat) for everything shown in the file tree, folders before their contents."""
    root = root or CFG.root
    cfg = cfg or CFG
    rroot = root.resolve()
    tops = protected_tops(cfg)
    for dirpath, dirnames, filenames in os.walk(str(root)):
        base = Path(dirpath)
        rel_dir = rel_of(base, root)
        rel_dir = "" if rel_dir == "." else rel_dir
        keep = []
        for d in sorted(dirnames, key=str.lower):
            full = base / d
            if (d.startswith(".") or d in SKIP_ANYWHERE or (not rel_dir and d in tops) or full.is_symlink()
                    or getattr(full, "is_junction", lambda: False)()):
                continue
            keep.append(d)
        dirnames[:] = keep
        for d in keep:
            try:
                yield (rel_dir + "/" + d if rel_dir else d), True, (base / d).stat()
            except OSError:
                pass
        for f in sorted(filenames, key=str.lower):
            if f.startswith(".") or f.startswith("~"):
                continue
            full = base / f
            try:
                if full.is_symlink():
                    rp = full.resolve()
                    if rroot not in rp.parents:
                        continue
                st = full.stat()
            except OSError:
                continue
            yield (rel_dir + "/" + f if rel_dir else f), False, st


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


def atomic_write(p, data):
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".edit-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


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


def file_states(paths, root=None):
    """sha256 of extra (open, possibly nested) files for the change poll; invalid paths are skipped."""
    root = root or CFG.root
    out = []
    for rel in paths[:200]:
        try:
            p = safe_path(rel, root)
        except HttpError:
            continue
        try:
            b = p.read_bytes()
            out.append({"name": rel, "mtime": p.stat().st_mtime, "size": len(b), "sha256": sha(b)})
        except OSError:
            out.append({"name": rel, "missing": True})
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


SAVE_LOCK = threading.Lock()        # the server is threaded: check-the-sha-then-write must not interleave


def save_file(rel, content, base_sha, root=None):
    with SAVE_LOCK:
        return _save_file(rel, content, base_sha, root)


def _save_file(rel, content, base_sha, root=None):
    root = root or CFG.root
    p = safe_path(rel, root)
    if not p.is_file():
        raise HttpError(404, "no such file")
    old = p.read_bytes()
    if sha(old) != base_sha:
        text, bom, eol = decode(old)
        raise HttpError(409, "changed on disk", {"content": text, "sha256": sha(old), "eol": eol})
    _, bom, eol = decode(old)
    hist = root / HIST_DIR / rel
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
    atomic_write(p, data)
    return {"sha256": sha(data)}


def history_list(rel, root=None):
    root = root or CFG.root
    safe_path(rel, root)
    d = root / HIST_DIR / rel
    if not d.is_dir():
        return []
    return [{"ts": p.stem, "size": p.stat().st_size} for p in sorted(d.glob("*.tex"), key=_hist_key, reverse=True)]


def history_file(rel, ts, root=None):
    root = root or CFG.root
    safe_path(rel, root)
    if not re.fullmatch(r"[0-9]{8}-[0-9]{6}(-[0-9]+)?", ts or ""):
        raise HttpError(403, "bad ts")
    p = root / HIST_DIR / rel / (ts + ".tex")
    if not p.is_file():
        raise HttpError(404, "no such version")
    text, _, _ = decode(p.read_bytes())
    return {"content": text}


# ---------------------------------------------------------------- project tree: list, create, rename, trash, upload
def project_tree(root=None, cfg=None):
    root = root or CFG.root
    cfg = cfg or CFG
    entries, truncated = [], False
    for rel, is_dir, st in project_walk(root, cfg):
        if len(entries) >= TREE_MAX:
            truncated = True
            break
        entries.append({"path": rel, "type": "dir" if is_dir else "file", "size": 0 if is_dir else st.st_size,
                        "mtime": round(st.st_mtime, 3)})
    sig = sha("\n".join("%s|%s|%d|%s" % (e["path"], e["type"], e["size"], e["mtime"]) for e in entries).encode())[:20]
    return {"entries": entries, "sig": sig, "truncated": truncated, "main": cfg.main, "uploads": cfg.uploads,
            "editable": sorted(EDITABLE_EXTS), "images": sorted(IMAGE_EXTS), "uploadExts": sorted(UPLOAD_EXTS),
            "maxUpload": MAX_UPLOAD}


def create_file(rel, content="", root=None):
    root = root or CFG.root
    p = safe_path(rel, root)
    if p.exists():
        raise HttpError(409, "already exists")
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(str(p), "xb") as f:            # exclusive create: never overwrites
            f.write((content or "").encode("utf-8"))
    except FileExistsError:
        raise HttpError(409, "already exists")
    return {"path": rel, "sha256": sha(p.read_bytes())}


def make_dir(rel, root=None):
    root = root or CFG.root
    p = check_rel(rel, root)
    if p.exists():
        raise HttpError(409, "already exists")
    p.mkdir(parents=True)
    return {"path": rel}


def rename_path(src, dst, root=None):
    """Rename or move a file or folder inside the project; its save history moves with it."""
    root = root or CFG.root
    ps, pd = check_rel(src, root), check_rel(dst, root)
    if not ps.exists():
        raise HttpError(404, "no such file or folder")
    same = False
    if pd.exists():
        try:
            same = os.path.samefile(str(ps), str(pd))   # case-only rename on a case-insensitive disk
        except OSError:
            same = False
        if not same:
            raise HttpError(409, "already exists")
    if ps.is_dir():
        if (dst + "/").startswith(src + "/"):
            raise HttpError(400, "cannot move a folder into itself")
    else:
        se, de = Path(src).suffix.lower(), Path(dst).suffix.lower()
        if de != se and de not in UPLOAD_EXTS:
            raise HttpError(403, "extension not allowed")
    if not pd.parent.is_dir():
        pd.parent.mkdir(parents=True, exist_ok=True)
    os.rename(str(ps), str(pd))
    hs, hd = root / HIST_DIR / src, root / HIST_DIR / dst
    if hs.exists() and not hd.exists():
        try:
            hd.parent.mkdir(parents=True, exist_ok=True)
            os.rename(str(hs), str(hd))
        except OSError:
            pass
    return {"path": dst}


def _tree_size(p):
    if p.is_file():
        return p.stat().st_size
    total = 0
    for dp, _, fns in os.walk(str(p)):
        for f in fns:
            try: total += os.path.getsize(os.path.join(dp, f))
            except OSError: pass
    return total


def trash_path(rel, root=None):
    """Move a file or folder to <root>/_edit_trash/<timestamp>/<rel>; nothing is ever deleted for good."""
    root = root or CFG.root
    p = check_rel(rel, root)
    if not p.exists():
        raise HttpError(404, "no such file or folder")
    base = root / TRASH_DIR
    ts = time.strftime("%Y%m%d-%H%M%S")
    tid, n = ts, 1
    while (base / tid).exists():
        tid = "%s-%d" % (ts, n); n += 1
    dest = base.joinpath(tid, *rel.split("/"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    kind = "dir" if p.is_dir() else "file"
    size = _tree_size(p)
    try:
        os.rename(str(p), str(dest))
    except OSError:
        shutil.move(str(p), str(dest))
    (base / tid / ".trashinfo.json").write_text(json.dumps({"path": rel, "kind": kind, "deleted": time.time(),
                                                              "size": size}, ensure_ascii=False), encoding="utf-8")
    return {"id": tid, "path": rel}


def trash_list(root=None):
    root = root or CFG.root
    base = root / TRASH_DIR
    out = []
    if not base.is_dir():
        return out
    for d in base.iterdir():
        if not d.is_dir() or not re.fullmatch(r"[0-9]{8}-[0-9]{6}(-[0-9]+)?", d.name):
            continue
        try:
            info = json.loads((d / ".trashinfo.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        rel = info.get("path", "")
        if not rel or not d.joinpath(*rel.split("/")).exists():
            continue
        out.append({"id": d.name, "path": rel, "kind": info.get("kind", "file"), "deleted": info.get("deleted", 0),
                    "size": info.get("size", 0)})
    out.sort(key=lambda x: (x["deleted"], x["id"]), reverse=True)
    return out


def trash_restore(tid, to=None, root=None):
    root = root or CFG.root
    if not isinstance(tid, str) or not re.fullmatch(r"[0-9]{8}-[0-9]{6}(-[0-9]+)?", tid):
        raise HttpError(403, "bad id")
    d = root / TRASH_DIR / tid
    try:
        info = json.loads((d / ".trashinfo.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise HttpError(404, "no such item in the trash")
    rel = info.get("path", "")
    check_rel(rel, root)
    src = d.joinpath(*rel.split("/"))
    if not src.exists():
        raise HttpError(404, "no such item in the trash")
    target = to or rel
    pd = check_rel(target, root)
    if pd.exists():
        raise HttpError(409, "a file or folder with this name already exists", {"path": target})
    pd.parent.mkdir(parents=True, exist_ok=True)
    os.rename(str(src), str(pd))
    shutil.rmtree(str(d), ignore_errors=True)
    return {"path": target}


def sanitize_name(name, image=False):
    """A safe ASCII file name for an upload: letters, digits, '-', '_' and '.'; the extension is lower-cased."""
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = unicodedata.normalize("NFKD", name)
    stem, ext = os.path.splitext(name)
    ext = ext.lower()
    stem = stem.encode("ascii", "ignore").decode("ascii")
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "-", stem)
    stem = re.sub(r"-{2,}", "-", stem).strip("-._")[:80].strip("-._")
    if not stem or WIN_RESERVED.match(stem):
        stem = ("image" if image or ext in IMAGE_EXTS else "file") + ("-" + stem if stem else "")
    return stem + ext


def unique_name(folder, name):
    stem, ext = os.path.splitext(name)
    cand, n = name, 1
    while (folder / cand).exists():
        cand = "%s-%d%s" % (stem, n, ext); n += 1
    return cand


def upload_file(dir_rel, name, data, image_only=False, root=None, cfg=None):
    root = root or CFG.root
    cfg = cfg or CFG
    if len(data) > MAX_UPLOAD:
        raise HttpError(413, "file too large (limit %d MB)" % (MAX_UPLOAD // (1024 * 1024)))
    folder = check_rel(dir_rel, root, cfg) if dir_rel else root
    if folder.exists() and not folder.is_dir():
        raise HttpError(400, "not a folder")
    clean = sanitize_name(name, image_only)
    ext = os.path.splitext(clean)[1]
    allowed = IMAGE_EXTS if image_only else UPLOAD_EXTS
    if ext not in allowed:
        raise HttpError(415, "file type not allowed: %s" % (ext or "(none)"))
    folder.mkdir(parents=True, exist_ok=True)
    final = unique_name(folder, clean)
    rel = (dir_rel + "/" + final) if dir_rel else final
    check_rel(rel, root, cfg)
    atomic_write(folder / final, data)
    return {"path": rel, "name": final, "renamed": final != clean, "requested": clean}


def raw_file(rel, root=None):
    root = root or CFG.root
    p = check_rel(rel, root)
    ext = Path(rel).suffix.lower()
    if ext not in RAW_MIME:
        raise HttpError(403, "only images can be previewed")
    if not p.is_file():
        raise HttpError(404, "no such file")
    return p, RAW_MIME[ext]


# ---------------------------------------------------------------- LaTeX scanning: labels, outline, includes, bib
SECTION_LEVELS = {"part": 0, "chapter": 1, "section": 2, "subsection": 3, "subsubsection": 4, "paragraph": 5}
FLOAT_ENVS = {"figure": "figure", "figure*": "figure", "wrapfigure": "figure", "sidewaysfigure": "figure",
              "table": "table", "table*": "table", "sidewaystable": "table", "longtable": "table"}
EQ_ENVS = {"equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "eqnarray",
           "flalign", "flalign*", "alignat", "alignat*", "subequations"}
VERBATIM_ENVS = ("verbatim", "verbatim*", "lstlisting", "minted", "comment", "Verbatim")
TOK_RE = re.compile(r"\\(part|chapter|section|subsection|subsubsection|paragraph|label|caption|input|include|subfile"
                    r"|import|subimport|begin|end|bibliography|addbibresource|graphicspath|newenvironment"
                    r"|renewenvironment|newcommand|renewcommand|providecommand|DeclareRobustCommand|newtheorem"
                    r"|DeclareMathOperator|def)(?![A-Za-z@])(\*?)")
COMMENT_RE = re.compile(r"(^|[^\\])((?:\\\\)*)%[^\n]*", re.M)


def blank_comments(text):
    """Replace every % comment with spaces (offsets and line numbers stay valid)."""
    def rep(m):
        keep = m.group(1) + m.group(2)
        return keep + " " * (len(m.group(0)) - len(keep))
    return COMMENT_RE.sub(rep, text)


def blank_verbatim(text):
    for env in VERBATIM_ENVS:
        if "\\begin{" + env not in text:
            continue
        pat = re.compile(r"(\\begin\{%s\})(.*?)(\\end\{%s\})" % (re.escape(env), re.escape(env)), re.S)
        text = pat.sub(lambda m: m.group(1) + re.sub(r"[^\n]", " ", m.group(2)) + m.group(3), text)
    return text


def skip_ws(s, i):
    while i < len(s) and s[i] in " \t\r\n":
        i += 1
    return i


def read_group(s, i, limit=20000):
    """s[i] must be '{'; return (content, index after the matching '}') or (None, i)."""
    if i >= len(s) or s[i] != "{":
        return None, i
    depth, j, end = 0, i, min(len(s), i + limit)
    while j < end:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
        j += 1
    return None, i


def read_opt(s, i, limit=5000):
    """s[i] must be '['; return (content, index after the matching ']') or (None, i)."""
    if i >= len(s) or s[i] != "[":
        return None, i
    depth, j, end = 0, i + 1, min(len(s), i + limit)
    while j < end:
        c = s[j]
        if c == "\\":
            j += 2
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth < 0:
                return None, i
        elif c == "]" and depth == 0:
            return s[i + 1:j], j + 1
        j += 1
    return None, i


KEEP_ARG_RE = re.compile(r"\\(lr|rl|textbf|textit|emph|texttt|textrm|textsf|textsc|underline|mbox|text|textlatin"
                         r"|textpersian|textnormal|textup|textsl|hbox)\s*\{")
DROP_ARG_RE = re.compile(r"\\(label|ref|eqref|pageref|autoref|cref|Cref|footnote|index|cite[A-Za-z]*|[A-Za-z]*cite)"
                         r"\*?\s*(\[[^\]]*\]\s*)*\{[^{}]*\}")


def clean_tex(s, n=140):
    """A one-line plain-text version of a LaTeX title or caption, for the outline and completion lists."""
    if not s:
        return ""
    s = DROP_ARG_RE.sub("", _logos(s))
    s = KEEP_ARG_RE.sub("{", s)
    s = re.sub(r"\\\\", " ", s)
    s = re.sub(r"\\([%&$#_{}])", r"\1", s)
    s = re.sub(r"\\[A-Za-z@]+\*?", "", s)
    s = s.replace("{", "").replace("}", "").replace("~", " ")
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"


def scan_tex(text):
    """Structure of one .tex file: sections, floats, labels (with context), includes, bib and graphics paths."""
    t = blank_verbatim(blank_comments(text))
    starts = [0] + [m.end() for m in re.finditer("\n", t)]

    def line_of(off):
        return bisect.bisect_right(starts, off)

    events, gpath, envs, cmds = [], [], set(), set()
    stack = []           # open environments: {"env", "float", "eq", "start", "ev", "labels"}
    last_sec = None      # (end offset, title) of the latest heading
    doc_at = t.find("\\begin{document}")
    for m in TOK_RE.finditer(t):
        cmd = m.group(1)
        i = skip_ws(t, m.end())
        ln = line_of(m.start())
        pre = 0 <= m.start() < doc_at          # in the preamble: definitions, not document structure
        if cmd in SECTION_LEVELS:
            short, i2 = read_opt(t, i)
            title, j = read_group(t, skip_ws(t, i2))
            if title is None or pre:
                continue
            ev = {"t": "sec", "line": ln, "level": SECTION_LEVELS[cmd], "cmd": cmd,
                  "title": clean_tex(title) or title.strip()[:80],
                  "short": clean_tex(short) if short else "", "star": m.group(2) == "*"}
            events.append(ev)
            last_sec = (j, ev["title"])
        elif cmd == "label":
            key, j = read_group(t, i, 300)
            if not key or not key.strip():
                continue
            key = key.strip()
            lab = {"t": "label", "line": ln, "key": key, "kind": "", "text": ""}
            fl = next((e for e in reversed(stack) if e["float"]), None)
            eq = next((e for e in reversed(stack) if e["eq"]), None)
            if last_sec and not t[last_sec[0]:m.start()].strip():
                lab["kind"], lab["text"] = "sec", last_sec[1]
            elif eq is not None:
                body = t[eq["start"]:m.start()].strip().splitlines()
                lab["kind"], lab["text"] = "eq", clean_tex(" ".join(x.strip() for x in body[:2]), 70)
            elif fl is not None:
                lab["kind"] = fl["float"]
                lab["text"] = fl["ev"]["title"]
                fl["labels"].append(lab)
            else:
                a = t.rfind("\n", 0, m.start()) + 1
                b = t.find("\n", m.start())
                lab["text"] = clean_tex(t[a:b if b >= 0 else len(t)], 90)
            if not lab["kind"]:
                pre = key.split(":")[0].split(".")[0].lower()
                lab["kind"] = {"fig": "figure", "tab": "table", "eq": "eq", "sec": "sec", "ch": "sec",
                               "chap": "sec", "subsec": "sec", "app": "sec", "lst": "listing"}.get(pre, "other")
            events.append(lab)
        elif cmd == "caption":
            short, i2 = read_opt(t, i)
            long_, j = read_group(t, skip_ws(t, i2))
            fl = next((e for e in reversed(stack) if e["float"]), None)
            if fl is not None and long_ is not None:
                fl["ev"]["title"] = clean_tex(short) if short and short.strip() else clean_tex(long_)
                fl["ev"]["long"] = clean_tex(long_, 300)
                for lab in fl["labels"]:
                    lab["text"] = fl["ev"]["title"]
        elif cmd == "begin":
            name, j = read_group(t, i, 100)
            if not name:
                continue
            name = name.strip()
            ent = {"env": name, "float": None if pre else FLOAT_ENVS.get(name), "eq": name in EQ_ENVS, "start": j,
                   "ev": None, "labels": []}
            if ent["float"] and not pre:
                ent["ev"] = {"t": "float", "line": ln, "kind": ent["float"], "title": "", "long": ""}
                events.append(ent["ev"])
            stack.append(ent)
        elif cmd == "end":
            name, j = read_group(t, i, 100)
            if not name:
                continue
            name = name.strip()
            for k in range(len(stack) - 1, -1, -1):
                if stack[k]["env"] == name:
                    del stack[k:]
                    break
        elif cmd in ("input", "include", "subfile"):
            arg, j = read_group(t, i, 500)
            if arg and arg.strip():
                events.append({"t": "include", "line": ln, "cmd": cmd, "dir": "", "file": arg.strip()})
        elif cmd in ("import", "subimport"):
            d, i2 = read_group(t, i, 500)
            f, j = read_group(t, skip_ws(t, i2), 500)
            if d is not None and f:
                events.append({"t": "include", "line": ln, "cmd": cmd, "dir": d.strip(), "file": f.strip()})
        elif cmd in ("bibliography", "addbibresource"):
            _, i2 = read_opt(t, i)
            arg, j = read_group(t, skip_ws(t, i2), 1000)
            if arg:
                names = [x.strip() for x in arg.split(",") if x.strip()]
                events.append({"t": "bib", "line": ln, "names": names})
        elif cmd == "graphicspath":
            arg, j = read_group(t, i, 2000)
            if arg:
                gpath += [g.strip() for g in re.findall(r"\{([^{}]*)\}", arg) if g.strip()]
        elif cmd in ("newenvironment", "renewenvironment", "newtheorem"):
            name, j = read_group(t, i, 100)
            if name and re.fullmatch(r"[A-Za-z@*]+", name.strip()):
                envs.add(name.strip())
        elif cmd in ("newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "DeclareMathOperator",
                     "def"):
            if cmd == "def":
                mm = re.match(r"\\([A-Za-z@]+)", t[m.end():m.end() + 60])
                if mm:
                    cmds.add(mm.group(1))
                continue
            name, j = read_group(t, i, 100)
            if name is None:
                mm = re.match(r"\\([A-Za-z@]+)", t[i:i + 60])
                name = "\\" + mm.group(1) if mm else None
            if name:
                mm = re.fullmatch(r"\s*\\([A-Za-z@]+)\s*", name)
                if mm:
                    cmds.add(mm.group(1))
    return {"events": events, "graphicspath": gpath, "envs": sorted(envs), "commands": sorted(cmds)}


_SCAN_CACHE = {}
_SCAN_LOCK = threading.Lock()


def read_text(p):
    """Decoded text of a project file, or None if it cannot be read as UTF-8."""
    try:
        return decode(p.read_bytes())[0]
    except (OSError, UnicodeDecodeError):
        return None


def scan_file(p):
    try:
        st = p.stat()
    except OSError:
        return None
    key = (st.st_mtime_ns, st.st_size)
    with _SCAN_LOCK:
        hit = _SCAN_CACHE.get(str(p))
    if hit and hit[0] == key:
        return hit[1]
    text = read_text(p)
    info = scan_tex(text) if text is not None else {"events": [], "graphicspath": [], "envs": [], "commands": []}
    with _SCAN_LOCK:
        if len(_SCAN_CACHE) > 4000:
            _SCAN_CACHE.clear()
        _SCAN_CACHE[str(p)] = (key, info)
    return info


def resolve_include(ev, cur, known):
    """Project path of an \\input / \\include / \\import target, or None."""
    f = ev["file"].replace("\\", "/")
    if not f or f.startswith("/") or ":" in f:
        return None
    curdir = posixpath.dirname(cur)
    if ev["cmd"] == "subimport":
        bases = [posixpath.join(curdir, ev["dir"])]
    elif ev["cmd"] == "import":
        bases = [ev["dir"]]
    else:
        bases = ["", curdir] if curdir else [""]       # LaTeX resolves against the compile folder (the root)
    for b in bases:
        p = posixpath.normpath(posixpath.join(b, f)) if b else posixpath.normpath(f)
        if p.startswith("../") or p == "..":
            continue
        for c in (p, p + ".tex"):
            if c in known:
                return c
    return None


BIB_SKIP = {"comment", "string", "preamble"}


def _bib_value(s, i):
    """Read one field value (braced, quoted, number or macro, joined with #); return (text, next index)."""
    parts = []
    while True:
        i = skip_ws(s, i)
        if i >= len(s):
            break
        c = s[i]
        if c == "{":
            v, j = read_group(s, i, 100000)
            if v is None:
                return " ".join(parts), len(s)
            parts.append(v)
            i = j
        elif c == '"':
            depth, j = 0, i + 1
            while j < len(s):
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "{":
                    depth += 1
                elif s[j] == "}":
                    depth -= 1
                elif s[j] == '"' and depth <= 0:
                    break
                j += 1
            parts.append(s[i + 1:j])
            i = j + 1
        else:
            mm = re.match(r"[^,#}\s)]+", s[i:])
            if not mm:
                break
            parts.append(mm.group(0))
            i += mm.end()
        i = skip_ws(s, i)
        if i < len(s) and s[i] == "#":
            i += 1
            continue
        break
    return "".join(parts), i


LOGOS = (("\\LaTeXe", "LaTeX2e"), ("\\LaTeX", "LaTeX"), ("\\BibTeX", "BibTeX"), ("\\XeTeX", "XeTeX"),
         ("\\XeLaTeX", "XeLaTeX"), ("\\TeX", "TeX"))


def _logos(v):
    for a, b in LOGOS:
        v = re.sub(re.escape(a) + r"(?![A-Za-z])(\{\})?", b, v)
    return v


def _bib_plain(v):
    v = re.sub(r"\\[A-Za-z]+\s*", "", _logos(v or ""))
    v = re.sub(r"\\(.)", r"\1", v)
    return re.sub(r"\s+", " ", v.replace("{", "").replace("}", "")).strip()


def short_authors(a):
    a = _bib_plain(a)
    if not a:
        return ""
    names = [x.strip() for x in re.split(r"\s+and\s+", a) if x.strip()]
    others = any(x.lower() == "others" for x in names)
    names = [x for x in names if x.lower() != "others"]

    def last(nm):
        return nm.split(",")[0].strip() if "," in nm else nm.split()[-1]
    if not names:
        return ""
    if len(names) == 1:
        return last(names[0]) + (" et al." if others else "")
    if len(names) == 2 and not others:
        return "%s and %s" % (last(names[0]), last(names[1]))
    return last(names[0]) + " et al."


def parse_bib(text):
    """Entries of a .bib file: [{key, type, author, year, title, venue, line}]."""
    out = []
    head = re.compile(r"@\s*([A-Za-z]+)\s*([{(])")
    pos = 0
    while True:
        m = head.search(text, pos)
        if not m:
            break
        typ = m.group(1).lower()
        opener = m.group(2)
        closer = "}" if opener == "{" else ")"
        # end of the entry: matching close bracket
        depth, j = 0, m.end() - 1
        while j < len(text):
            c = text[j]
            if c == "\\":
                j += 2
                continue
            if c == opener or (opener == "(" and c == "{"):
                depth += 1
            elif c == closer or (opener == "(" and c == "}"):
                depth -= 1
                if depth == 0:
                    break
            j += 1
        body = text[m.end():j]
        pos = j + 1 if j < len(text) else len(text)
        if typ in BIB_SKIP:
            continue
        km = re.match(r"\s*([^,\s{}()=\"#%'~]+)\s*,", body)
        if not km:
            continue
        fields, i = {}, km.end()
        while i < len(body):
            fm = re.compile(r"\s*([A-Za-z][A-Za-z0-9_:.+-]*)\s*=\s*").match(body, i)
            if not fm:
                nxt = body.find(",", i)
                if nxt < 0:
                    break
                i = nxt + 1
                continue
            val, i = _bib_value(body, fm.end())
            fields[fm.group(1).lower()] = val
            i = skip_ws(body, i)
            if i < len(body) and body[i] == ",":
                i += 1
        year = fields.get("year") or (re.match(r"\s*(\d{4})", fields.get("date", "")) or [None, ""])[1] or ""
        venue = next((fields[k] for k in ("journal", "journaltitle", "booktitle", "school", "institution",
                                          "publisher", "howpublished", "eprint") if fields.get(k)), "")
        out.append({"key": km.group(1), "type": typ, "author": short_authors(fields.get("author") or
                                                                              fields.get("editor", "")),
                    "year": _bib_plain(year), "title": _bib_plain(fields.get("title", ""))[:200],
                    "venue": _bib_plain(venue)[:120], "line": text.count("\n", 0, m.start()) + 1})
    return out


def _project_files(root, cfg):
    tex, bib, sty, img = [], [], [], []
    for rel, is_dir, _ in project_walk(root, cfg):
        if is_dir:
            continue
        ext = posixpath.splitext(rel)[1].lower()
        if ext == ".tex":
            tex.append(rel)
        elif ext == ".bib":
            bib.append(rel)
        elif ext in (".sty", ".cls"):
            sty.append(rel)
        if ext in IMAGE_EXTS:
            img.append(rel)
    return tex, bib, sty, img


def build_index(root=None, cfg=None):
    """Labels, citations, outline, images and custom commands of the project.

    Files reachable from the main file (through \\input, \\include, \\subfile, \\import) come first and give the
    outline; other .tex and .bib files are added too, except those inside folders whose names start with "_"."""
    root = root or CFG.root
    cfg = cfg or CFG
    tex, bibs, sty, images = _project_files(root, cfg)
    known = set(tex)
    reachable, outline, labels, gpath, bibrefs = [], [], [], [], []
    envs, cmds, seen = set(), set(), set()

    def take(rel, info, orphan):
        gpath.extend(g for g in info["graphicspath"] if g not in gpath)
        envs.update(info["envs"])
        cmds.update(info["commands"])

    def visit(rel, depth):
        if rel in seen or depth > 40:
            return
        seen.add(rel)
        reachable.append(rel)
        info = scan_file(root.joinpath(*rel.split("/")))
        if info is None:
            return
        take(rel, info, False)
        for ev in info["events"]:
            t = ev["t"]
            if t == "sec":
                outline.append({"kind": "sec", "level": ev["level"], "cmd": ev["cmd"], "title": ev["title"],
                                "file": rel, "line": ev["line"], "star": ev["star"]})
            elif t == "float" and ev["title"]:          # floats without a caption are not listed
                outline.append({"kind": ev["kind"], "level": 9, "title": ev["title"], "file": rel,
                                "line": ev["line"]})
            elif t == "label":
                labels.append({"key": ev["key"], "kind": ev["kind"], "text": ev["text"], "file": rel,
                               "line": ev["line"]})
            elif t == "include":
                target = resolve_include(ev, rel, known)
                if target:
                    visit(target, depth + 1)
            elif t == "bib":
                for nm in ev["names"]:
                    nm = nm.replace("\\", "/")
                    for c in (nm, nm + ".bib"):
                        c = posixpath.normpath(c)
                        if c in bibs and c not in bibrefs:
                            bibrefs.append(c)
                            break

    if cfg.main in known:
        visit(cfg.main, 0)
    main_keys = {lab["key"] for lab in labels}
    counts = {}
    for lab in labels:
        counts[lab["key"]] = counts.get(lab["key"], 0) + 1
    for lab in labels:
        if counts[lab["key"]] > 1:
            lab["dup"] = True
    for rel in sorted(tex):
        if rel in seen or under_underscore(rel):
            continue
        info = scan_file(root.joinpath(*rel.split("/")))
        if info is None:
            continue
        take(rel, info, True)
        for ev in info["events"]:
            if ev["t"] == "label" and ev["key"] not in main_keys:
                labels.append({"key": ev["key"], "kind": ev["kind"], "text": ev["text"], "file": rel,
                               "line": ev["line"], "orphan": True})
    for rel in sty:
        if under_underscore(rel):
            continue
        info = scan_file(root.joinpath(*rel.split("/")))
        if info:
            take(rel, info, True)
    bibfiles = bibrefs + [b for b in sorted(bibs) if b not in bibrefs and not under_underscore(b)]
    entries, bkeys = [], set()
    for b in bibfiles:
        text = read_text(root.joinpath(*b.split("/")))
        if text is None:
            continue
        for e in parse_bib(text):
            e["file"] = b
            if e["key"] in bkeys:
                e["dup"] = True
            bkeys.add(e["key"])
            entries.append(e)
    return {"labels": labels, "outline": outline, "bib": entries, "bibfiles": bibfiles, "images": images,
            "graphicspath": gpath, "texfiles": sorted(tex), "reachable": reachable, "envs": sorted(envs),
            "commands": sorted(cmds), "main": cfg.main}


# ---------------------------------------------------------------- word count
WC_DROP_ENVS = ("equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*", "eqnarray",
                "eqnarray*", "displaymath", "math", "flalign", "flalign*", "alignat", "alignat*", "tikzpicture",
                "verbatim", "verbatim*", "lstlisting", "minted", "comment", "thebibliography", "filecontents",
                "filecontents*")
WC_DROP_CMDS = ("label|ref|eqref|pageref|autoref|cref|Cref|nameref|vref|cite[A-Za-z]*|[A-Za-z]*cite|nocite"
                "|includegraphics|includesvg|input|include|subfile|import|subimport|url|bibliography|bibliographystyle"
                "|addbibresource|usepackage|RequirePackage|documentclass|graphicspath|begin|end|newcommand"
                "|renewcommand|providecommand|newenvironment|renewenvironment|setlength|addtolength|setcounter"
                "|addtocounter|vspace|hspace|newtheorem|settextfont|setlatintextfont|setdigitfont|definecolor"
                "|hypersetup|pagestyle|thispagestyle|pagenumbering|bibitem|color|fontsize|linespread"
                "|DeclareMathOperator|geometry|addcontentsline|includeonly|hyperref|cline|multicolumn|multirow"
                "|setmainfont|setsansfont|setmonofont|newfontfamily|captionsetup|setlist|rule|raisebox")
WC_DROP_RE = re.compile(r"\\(?:%s)(?![A-Za-z@])\*?\s*(?:\[[^\]]*\]\s*)*(?:\{[^{}]*\}\s*)?(?:\[[^\]]*\])?"
                        % WC_DROP_CMDS)
WC_MARKS = "\u064B-\u065F\u0670\u06D6-\u06ED"
WC_WORD_RE = re.compile(r"[\w%s]+(?:[\u200c\u200d'\u2019-][\w%s]+)*" % (WC_MARKS, WC_MARKS))


def word_count(text):
    """Words of LaTeX source as a reader sees them: comments, preamble, math, labels and citations removed.

    A Persian word joined by a zero-width non-joiner (می‌شود) counts once."""
    t = blank_verbatim(blank_comments(text or ""))
    if "\\begin{document}" in t:
        t = t.split("\\begin{document}", 1)[1]
    if "\\end{document}" in t:
        t = t.split("\\end{document}", 1)[0]
    for env in WC_DROP_ENVS:
        if "\\begin{" + env + "}" in t:
            t = re.sub(r"\\begin\{%s\}.*?\\end\{%s\}" % (re.escape(env), re.escape(env)), " ", t, flags=re.S)
    t = re.sub(r"\$\$.*?\$\$", " ", t, flags=re.S)
    t = re.sub(r"\\\[.*?\\\]", " ", t, flags=re.S)
    t = re.sub(r"\\\(.*?\\\)", " ", t, flags=re.S)
    t = re.sub(r"(?<!\\)\$(?:\\.|[^$\\])*\$", " ", t)
    t = re.sub(r"\\href\s*\{[^{}]*\}", " ", t)
    for _ in range(3):                           # nested \footnote{\cite{..}} and the like
        t2 = WC_DROP_RE.sub(" ", t)
        if t2 == t:
            break
        t = t2
    t = re.sub(r"\\[A-Za-z@]+\*?\s*(\[[^\]]*\])?", " ", t)   # other command names (with their optional argument)
    t = re.sub(r"\\.", " ", t)                                  # \% \& \\ and friends
    t = re.sub(r"[{}~&_^]", " ", t)
    return sum(1 for w in WC_WORD_RE.findall(t) if any(c.isalnum() for c in w))


def project_word_count(root=None, cfg=None):
    root = root or CFG.root
    cfg = cfg or CFG
    idx = build_index(root, cfg)
    files = [f for f in idx["reachable"] if f.lower().endswith(".tex")]
    if not files:
        files = [f for f in idx["texfiles"] if not under_underscore(f)]
    out, total = [], 0
    for rel in files:
        text = read_text(root.joinpath(*rel.split("/")))
        if text is None:
            continue
        n = word_count(text)
        total += n
        out.append({"path": rel, "words": n})
    return {"total": total, "files": out}


# ---------------------------------------------------------------- project search and replace
def search_files(include_underscore=False, root=None, cfg=None):
    root = root or CFG.root
    cfg = cfg or CFG
    reach = set(build_index(root, cfg)["reachable"])
    out = []
    for rel, is_dir, st in project_walk(root, cfg):
        if is_dir or posixpath.splitext(rel)[1].lower() not in EDITABLE_EXTS:
            continue
        if not include_underscore and under_underscore(rel) and rel not in reach:
            continue
        out.append(rel)
    return out


def compile_query(q, regex=False, case=False, word=False):
    if not isinstance(q, str) or not q:
        raise HttpError(400, "empty search")
    pat = q if regex else re.escape(q)
    if word:
        pat = r"(?<![\w\u200c])(?:%s)(?![\w\u200c])" % pat
    try:
        return re.compile(pat, (0 if case else re.IGNORECASE) | re.MULTILINE)
    except re.error as e:
        raise HttpError(400, "bad regular expression: %s" % e)


def expand_replacement(repl, m, regex):
    """Replacement text: literal in plain mode; in regex mode $1, ${name}, $& and $$ refer to the match.

    Backslashes are always literal, so LaTeX commands need no escaping."""
    if not regex:
        return repl

    def rep(mm):
        tok = mm.group(0)
        if tok == "$$":
            return "$"
        if tok in ("$&", "$0"):
            return m.group(0)
        name = mm.group(1) or mm.group(2)
        try:
            g = m.group(int(name) if name.isdigit() else name)
        except IndexError:                       # no such group: keep the text as typed
            return tok
        return g or ""
    return re.sub(r"\$\$|\$&|\$\{([A-Za-z_][A-Za-z0-9_]*|\d+)\}|\$(\d{1,2})", rep, repl)


def _u16(s):
    return len(s.encode("utf-16-le")) // 2


def iter_matches(rx, text):
    """Non-empty matches in order; the same numbering is used for search results and for replacing."""
    for m in rx.finditer(text):
        if m.end() > m.start():
            yield m


def search_project(q, regex=False, case=False, word=False, include_underscore=False, replacement=None,
                   root=None, cfg=None, limit=SEARCH_MAX):
    root = root or CFG.root
    rx = compile_query(q, regex, case, word)
    results, total, truncated = [], 0, False
    for rel in search_files(include_underscore, root, cfg):
        p = root.joinpath(*rel.split("/"))
        try:
            raw = p.read_bytes()
            text = decode(raw)[0]
        except (OSError, UnicodeDecodeError):
            continue
        starts = None
        matches = []
        for i, m in enumerate(iter_matches(rx, text)):
            if total >= limit:
                truncated = True
                break
            if starts is None:
                starts = [0] + [mm.end() for mm in re.finditer("\n", text)]
            ln = bisect.bisect_right(starts, m.start())
            ls = starts[ln - 1]
            le = text.find("\n", ls)
            line = text[ls:le if le >= 0 else len(text)]
            col = m.start() - ls
            hit = m.group(0).split("\n")[0]
            a = max(0, col - 60)
            item = {"i": i, "line": ln, "col": _u16(line[:col]), "len": _u16(m.group(0)),
                    "pre": ("…" if a else "") + line[a:col], "hit": hit[:200],
                    "post": line[col + len(hit):col + len(hit) + 100]}
            if replacement is not None:
                item["repl"] = expand_replacement(replacement, m, regex)
            matches.append(item)
            total += 1
        if matches:
            results.append({"path": rel, "sha256": sha(raw), "matches": matches})
        if truncated:
            break
    return {"results": results, "total": total, "truncated": truncated}


def replace_in_project(q, replacement, targets, regex=False, case=False, word=False, root=None):
    """Replace matches in the given files.  Each file goes through save_file: history copy + 409 if it changed."""
    root = root or CFG.root
    rx = compile_query(q, regex, case, word)
    if not isinstance(replacement, str):
        raise HttpError(400, "replacement required")
    if not isinstance(targets, list) or not targets:
        raise HttpError(400, "no files to replace in")
    out = []
    for t in targets:
        rel = t.get("path") if isinstance(t, dict) else None
        p = safe_path(rel, root)
        if not p.is_file():
            out.append({"path": rel, "error": "missing", "code": 404})
            continue
        raw = p.read_bytes()
        if sha(raw) != t.get("sha256"):
            out.append({"path": rel, "error": "changed on disk", "code": 409})
            continue
        try:
            text = decode(raw)[0]
        except UnicodeDecodeError:
            out.append({"path": rel, "error": "not UTF-8", "code": 415})
            continue
        only = t.get("only")
        only = set(only) if isinstance(only, list) else None
        pieces, last, n = [], 0, 0
        for i, m in enumerate(iter_matches(rx, text)):
            if only is not None and i not in only:
                continue
            pieces.append(text[last:m.start()])
            pieces.append(expand_replacement(replacement, m, regex))
            last = m.end()
            n += 1
        if not n:
            out.append({"path": rel, "count": 0})
            continue
        pieces.append(text[last:])
        new = "".join(pieces)
        try:
            res = save_file(rel, new, t.get("sha256"), root)
        except HttpError as e:
            out.append({"path": rel, "error": e.msg, "code": e.code})
            continue
        out.append({"path": rel, "count": n, "sha256": res["sha256"], "content": new})
    return {"results": out}


# ---------------------------------------------------------------- BibTeX entries
BIB_TYPES = ("article", "inproceedings", "book", "incollection", "inbook", "misc", "online", "phdthesis",
             "mastersthesis", "techreport", "unpublished", "manual", "proceedings")
BIB_VENUE = {"article": "journal", "inproceedings": "booktitle", "incollection": "booktitle", "inbook": "booktitle",
             "proceedings": "publisher", "book": "publisher", "phdthesis": "school", "mastersthesis": "school",
             "techreport": "institution", "manual": "organization", "misc": "howpublished",
             "online": "organization", "unpublished": "note"}
BIB_FIELDS = ("author", "editor", "title", "venue", "year", "volume", "number", "pages", "doi", "url", "note")


def _balanced(s):
    depth = 0
    for i, c in enumerate(s):
        if c == "{" and (i == 0 or s[i - 1] != "\\"):
            depth += 1
        elif c == "}" and (i == 0 or s[i - 1] != "\\"):
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def format_bib(entry, eol="\n"):
    if not isinstance(entry, dict):
        raise HttpError(400, "entry required")
    typ = str(entry.get("type", "")).lower().strip()
    if typ not in BIB_TYPES:
        raise HttpError(400, "unknown entry type")
    key = str(entry.get("key", "")).strip()
    if not re.fullmatch(r"[A-Za-z0-9_:./+-]{1,100}", key):
        raise HttpError(400, "bad key: use letters, digits and _ : . / + -")
    lines = ["@%s{%s," % (typ, key)]
    for f in BIB_FIELDS:
        v = re.sub(r"\s+", " ", str(entry.get(f, "") or "")).strip()
        if not v:
            continue
        if not _balanced(v):
            raise HttpError(400, "unbalanced braces in %s" % f)
        name = BIB_VENUE.get(typ, "howpublished") if f == "venue" else f
        if f == "url" and typ == "misc" and not entry.get("venue"):
            lines.append("  howpublished = {\\url{%s}}," % v)
            continue
        lines.append("  %s = {%s}," % (name, v))
    lines[-1] = lines[-1].rstrip(",") if len(lines) > 1 else lines[-1]
    lines.append("}")
    return eol.join(lines) + eol


def bib_add(rel, base_sha, entry, root=None):
    root = root or CFG.root
    p = safe_path(rel, root)
    if Path(rel).suffix.lower() != ".bib":
        raise HttpError(403, "not a .bib file")
    if not p.is_file():
        raise HttpError(404, "no such file")
    raw = p.read_bytes()
    try:
        text, _, _ = decode(raw)
    except UnicodeDecodeError:
        raise HttpError(415, "file is not valid UTF-8")
    if sha(raw) != base_sha:
        raise HttpError(409, "changed on disk", {"content": text, "sha256": sha(raw)})
    block = format_bib(entry)
    key = str(entry.get("key", "")).strip()
    if any(e["key"].lower() == key.lower() for e in parse_bib(text)):
        raise HttpError(409, "duplicate key", {"key": key})
    body = text.rstrip("\n")
    new = (body + "\n\n" if body.strip() else "") + block
    res = save_file(rel, new, base_sha, root)
    return {"sha256": res["sha256"], "content": new, "key": key}


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


def editable_relpath(path, root=None):
    """Project path of a file named by synctex (absolute, './x/y.tex' or 'x/y.tex'), or None."""
    root = root or CFG.root
    norm = path.replace("\\", "/").strip()
    cands = []
    try:
        if os.path.isabs(path):
            r = rel_of(Path(path).resolve(), root.resolve())
            if not r.startswith(".."):
                cands.append(r)
    except (OSError, ValueError):
        pass
    parts = [x for x in norm.split("/") if x not in ("", ".")]
    for k in range(len(parts)):
        cands.append("/".join(parts[k:]))
    for c in cands:
        try:
            p = safe_path(c, root)
        except HttpError:
            continue
        if p.is_file():
            return c
    return editable_basename(path, root)


def run_synctex(args):
    try:
        r = subprocess.run(["synctex"] + args, cwd=str(CFG.root), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HttpError(500, "synctex failed: %s" % e)
    return r.stdout


# ---------------------------------------------------------------- compile manager
def source_snapshot(root=None, cfg=None):
    """{rel: (mtime_ns, size)} of the files a build can read (sources, images, fonts), outside _ folders."""
    cfg = cfg or CFG
    exts = EDITABLE_EXTS | IMAGE_EXTS | {".ttf", ".otf"}
    snap = {}
    for rel, is_dir, st in project_walk(root or cfg.root, cfg):
        if not is_dir and Path(rel).suffix.lower() in exts and not under_underscore(rel):
            snap[rel] = (st.st_mtime_ns, st.st_size)
            if len(snap) >= TREE_MAX:
                break
    return snap


def changed_since(old, new, since_ns=None):
    """Files added, edited or removed between two snapshots; with no old snapshot, files newer than `since_ns`."""
    if old is None:
        return sorted(k for k, v in new.items() if since_ns is None or v[0] > since_ns)
    return sorted([k for k, v in new.items() if old.get(k) != v] + [k for k in old if k not in new])


def replace_retry(src, dst, tries=20):
    """os.replace that waits out a reader holding the PDF open (Windows refuses to replace an open file)."""
    for _ in range(tries):
        try:
            os.replace(src, dst)
            return True
        except PermissionError:
            time.sleep(0.1)
    return False


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
        self.pending_mode = ""
        self.proc = None
        self.killed = False
        self.mode = ""               # "" everyday (light PDF), "clean" from scratch, "final" full-compression PDF
        self.snap = None             # source snapshot taken when the last build started
        self.changed = []
        self.quality = None          # "fast" or "full": how the current PDF was written

    def request(self, clean=False, final=False):
        mode = "clean" if clean else ("final" if final else "")
        with self.lock:
            if self.state == "running":
                self.pending = True
                self.pending_mode = max(self.pending_mode, mode, key=("", "final", "clean").index)
                return "queued"
            self.state = "running"
            self.started = time.time()
            self.mode = mode
            threading.Thread(target=self._loop, args=(mode,), daemon=True).start()
            return "started"

    def _loop(self, mode=""):
        while True:
            self._once(mode)
            with self.lock:
                if self.pending:
                    self.pending = False
                    mode, self.pending_mode = self.pending_mode, ""
                    self.state = "running"
                    self.started = time.time()
                    self.mode = mode
                    continue
                return

    def _env(self, root):
        env = dict(os.environ)
        for k in ("BIBINPUTS", "BSTINPUTS", "TEXINPUTS"):   # bibtex/biber run inside outdir and must still see the project files
            env[k] = str(root) + os.pathsep + env.get(k, "")
        return env

    def _note_changes(self, root):
        """What changed since the last build started (or, after a restart, since the PDF was written)."""
        snap = source_snapshot(root)
        pdf = root / CFG.outdir / (CFG.stem + ".pdf")
        since = pdf.stat().st_mtime_ns if (self.snap is None and pdf.is_file()) else None
        changed = changed_since(self.snap, snap, since)
        with self.lock:
            self.snap, self.changed = snap, changed

    def _write_fast_rc(self, root):
        rc = root / CFG.fast_rc
        try:
            if not rc.is_file() or rc.read_text(encoding="utf-8") != FAST_RC_TEXT:
                rc.write_text(FAST_RC_TEXT, encoding="utf-8")
        except OSError:
            pass

    def _final(self, root, kw):
        """Rewrite the PDF at full compression from the .xdv; returns (ok, message)."""
        xdv = root / CFG.outdir / (CFG.stem + ".xdv")
        if CFG.engine != "xelatex" or not xdv.is_file():
            return True, ""
        tmp = "%s/%s.final-tmp.pdf" % (CFG.outdir, CFG.stem)
        try:
            r = subprocess.run(CFG.final_pdf(tmp), cwd=str(root), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               stdin=subprocess.DEVNULL, timeout=COMPILE_TIMEOUT, **kw)
        except (OSError, subprocess.TimeoutExpired) as e:
            return False, "final PDF failed: %s" % e
        if r.returncode != 0 or not (root / tmp).is_file():
            return False, "final PDF failed: " + (r.stdout.decode("utf-8", "replace").strip().splitlines() or ["xdvipdfmx"])[-1]
        if not replace_retry(str(root / tmp), str(root / CFG.pdf_rel)):
            return False, "final PDF written but the old one is still open: " + tmp
        return True, ""

    def _once(self, mode=""):
        root = CFG.root
        (root / CFG.outdir).mkdir(exist_ok=True)
        t0 = time.time()
        self.killed = False
        kw = {} if os.name == "nt" else {"start_new_session": True}
        self._note_changes(root)
        if mode == "clean":                      # "recompile from scratch": latexmk -C first
            try:
                subprocess.run(CFG.latexmk_clean, cwd=str(root), env=self._env(root), stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, timeout=120)
            except (OSError, subprocess.TimeoutExpired):
                pass
            (root / CFG.outdir).mkdir(exist_ok=True)
        if CFG.fast_rc:
            self._write_fast_rc(root)
        try:
            self.proc = subprocess.Popen(CFG.latexmk, cwd=str(root), env=self._env(root), stdout=subprocess.PIPE,
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
        quality = self.quality
        if not CFG.fast_rc:
            quality = "full"
        elif "Running 'xdvipdfmx" in text:
            quality = "fast"                     # latexmk rewrote the PDF with the light writer
        if mode == "final" and rc == 0 and not errors and not self.killed:
            ok, msg = self._final(root, kw)
            if ok:
                quality = "full"
            else:
                errors = [{"file": "", "line": 0, "message": msg}]
        with self.lock:
            self.errors = errors
            self.pages = pages
            self.quality = quality
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
                    "log_tail": self.log_tail, "finished": self.finished, "queued": self.pending,
                    "mode": self.mode, "quality": self.quality, "changed": self.changed[:CHANGED_SHOW],
                    "changed_count": len(self.changed),
                    "pdf": (CFG.root / CFG.outdir / (CFG.stem + ".pdf")).is_file()}


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
    server_version = "RTLLatexLiveEditor/2"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", headers=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if not headers or "Cache-Control" not in headers:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _allowed_hosts(self):
        port = self.server.server_address[1]
        return {"127.0.0.1:%d" % port, "localhost:%d" % port, "[::1]:%d" % port}

    def _guard(self, method):
        """Only this page may talk to the server: a foreign Host (DNS rebinding) or a write from another origin
        (a web page posting to 127.0.0.1) is refused.  Writes must carry the X-LiveTeX header, which a cross-site
        form cannot send without a CORS preflight that this server never approves."""
        host = (self.headers.get("Host") or "").strip().lower()
        if host and host not in self._allowed_hosts():
            raise HttpError(403, "unexpected Host header")
        if method != "GET":
            origin = self.headers.get("Origin")
            if origin and origin.lower().rstrip("/") not in {"http://" + h for h in self._allowed_hosts()}:
                raise HttpError(403, "cross-origin request refused")
            if self.headers.get("X-LiveTeX") != "1":
                raise HttpError(403, "missing X-LiveTeX header")

    def _read_body(self, limit):
        n = int(self.headers.get("Content-Length") or 0)
        if n < 0:
            raise HttpError(400, "bad length")
        if n > limit:
            if n <= 4 * limit:                   # drain so the browser sees the 413 instead of a reset
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    left -= len(chunk)
            else:
                self.close_connection = True
            raise HttpError(413, "request too large (limit %d MB)" % (limit // (1024 * 1024)))
        return self.rfile.read(n) if n else b""

    def _handle(self, method):
        u = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(u.query)
        q = {k: v[0] for k, v in qs.items()}
        try:
            self._guard(method)
            body = None
            if method in ("PUT", "POST"):
                if u.path == "/api/upload":
                    body = self._read_body(MAX_UPLOAD)
                else:
                    raw = self._read_body(MAX_BODY)
                    try:
                        body = json.loads(raw.decode("utf-8")) if raw else {}
                    except (ValueError, UnicodeDecodeError):
                        raise HttpError(400, "bad JSON")
            self._route(method, u.path, q, body, qs)
        except HttpError as e:
            payload = {"error": e.msg}
            if e.extra:
                payload.update(e.extra)
            try:
                self._send(e.code, payload)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception as e:
            try:
                self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})
            except Exception:
                pass

    def do_GET(self): self._handle("GET")
    def do_PUT(self): self._handle("PUT")
    def do_POST(self): self._handle("POST")

    def _route(self, m, path, q, body, qs=None):
        qs = qs or {}
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
        if not isinstance(body, (dict, bytes, type(None))):
            raise HttpError(400, "JSON object expected")
        b = body if isinstance(body, dict) else {}
        if m == "GET" and path == "/api/config":
            return self._send(200, CFG.public())
        if m == "GET" and path == "/api/files":
            return self._send(200, {"files": list_files()})
        if m == "GET" and path == "/api/file":
            return self._send(200, read_file(q.get("path", "")))
        if m == "PUT" and path == "/api/file":
            return self._send(200, save_file(b.get("path"), b.get("content", ""), b.get("base_sha256")))
        if m == "POST" and path == "/api/file/new":
            return self._send(200, create_file(b.get("path"), b.get("content", "")))
        if m == "POST" and path == "/api/mkdir":
            return self._send(200, make_dir(b.get("path")))
        if m == "POST" and path == "/api/rename":
            return self._send(200, rename_path(b.get("from"), b.get("to")))
        if m == "POST" and path == "/api/trash":
            return self._send(200, trash_path(b.get("path")))
        if m == "GET" and path == "/api/trash":
            return self._send(200, {"items": trash_list()})
        if m == "POST" and path == "/api/trash/restore":
            return self._send(200, trash_restore(b.get("id"), b.get("to")))
        if m == "POST" and path == "/api/upload":
            return self._send(200, upload_file(q.get("dir", ""), q.get("name", ""), body or b"",
                                               image_only=q.get("kind") == "image"))
        if m == "GET" and path == "/api/raw":
            p, ctype = raw_file(q.get("path", ""))
            st = p.stat()
            etag = '"%x-%x"' % (st.st_mtime_ns, st.st_size)
            hdr = {"ETag": etag, "Cache-Control": "no-cache",
                   "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox"}
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                for k, v in hdr.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self._send(200, p.read_bytes(), ctype, hdr)
        if m == "GET" and path == "/api/tree":
            return self._send(200, project_tree())
        if m == "GET" and path == "/api/index":
            return self._send(200, build_index())
        if m == "POST" and path == "/api/search":
            return self._send(200, search_project(b.get("q"), bool(b.get("regex")), bool(b.get("case")),
                                                  bool(b.get("word")), bool(b.get("all")), b.get("replacement")))
        if m == "POST" and path == "/api/replace":
            return self._send(200, replace_in_project(b.get("q"), b.get("replacement"), b.get("targets"),
                                                      bool(b.get("regex")), bool(b.get("case")), bool(b.get("word"))))
        if m == "GET" and path == "/api/wordcount":
            return self._send(200, project_word_count())
        if m == "POST" and path == "/api/wordcount":
            return self._send(200, {"words": word_count(str(b.get("text", "")))})
        if m == "POST" and path == "/api/bib/add":
            return self._send(200, bib_add(b.get("path"), b.get("base_sha256"), b.get("entry")))
        if m == "GET" and path == "/api/history":
            return self._send(200, {"versions": history_list(q.get("path", ""))})
        if m == "GET" and path == "/api/history/file":
            return self._send(200, history_file(q.get("path", ""), q.get("ts", "")))
        if m == "POST" and path == "/api/compile":
            return self._send(200, {"result": COMPILER.request(clean=q.get("clean") == "1" or bool(b.get("clean")), final=q.get("final") == "1" or bool(b.get("final")))})
        if m == "GET" and path == "/api/compile/status":
            return self._send(200, COMPILER.status())
        if m == "GET" and path == "/api/changes":
            return self._send(200, {"files": list_files(), "open": file_states(qs.get("open", []))})
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
            rel = editable_relpath(r["input"])
            if not rel:
                raise HttpError(404, "source %s is not editable" % r["input"])
            return self._send(200, {"file": rel, "line": r["line"]})
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
            cands = [str(CFG.root.joinpath(*f.split("/"))), f, "./" + f]
            if "/" in f:
                cands.append(str(CFG.root.joinpath(*f.split("/"))).replace("\\", "/"))
            for ln in [line] + [line + d for k in range(1, 6) for d in (k, -k)]:
                if ln < 1:
                    continue
                for cand in cands:
                    boxes = parse_synctex_view(run_synctex(["view", "-i", "%d:0:%s" % (ln, cand), "-o", CFG.pdf_rel]))
                    if boxes:
                        break
                if boxes:
                    used = ln
                    break
            return self._send(200, {"boxes": boxes, "line": used})
        raise HttpError(404, "not found")


class QuietServer(ThreadingHTTPServer):
    """A browser that drops a connection mid-request (a closed tab, an aborted PDF or range request) is normal: say nothing."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, TimeoutError)):
            return
        super().handle_error(request, client_address)


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
        srv = QuietServer(("127.0.0.1", cfg.port), Handler)
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
