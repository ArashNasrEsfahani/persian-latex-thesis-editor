"""Offline selftest for RTL LaTeX Live Editor. Works only on temporary folders; never needs TeX installed."""
import json, re, sys, tempfile, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server as S

ok = fail = 0


def check(name, cond):
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print("FAIL:", name)


def raises(code, fn, *a):
    try:
        fn(*a)
    except S.HttpError as e:
        return e.code == code
    return False


def cfg_raises(argv):
    try:
        S.load_config(argv)
    except S.ConfigError:
        return True
    return False


# ---------------------------------------------------------------- path safety
tmp = Path(tempfile.mkdtemp(prefix="rtlled-"))
for bad in ["../x.tex", "..\\x.tex", "/etc/passwd.tex", "C:\\a.tex", "sub/x.tex", "x.exe", "x.pdf", "", ".hidden.tex", "~x.tex", None]:
    check("reject %r" % (bad,), raises(403, S.safe_path, bad, tmp))
check("accept chapter1.tex", S.safe_path("chapter1.tex", tmp) == tmp / "chapter1.tex")
check("accept refs.bib", S.safe_path("refs.bib", tmp) == tmp / "refs.bib")

# ---------------------------------------------------------------- CRLF / LF / BOM round trips
persian = "سلام دنیا\nخط دوم \\textbf{x}\n"
samples = {"crlf.tex": persian.replace("\n", "\r\n").encode("utf-8"),
           "lf.tex": persian.encode("utf-8"),
           "bom.tex": b"\xef\xbb\xbf" + persian.encode("utf-8"),
           "bomcrlf.tex": b"\xef\xbb\xbf" + persian.replace("\n", "\r\n").encode("utf-8")}
for n, raw in samples.items():
    (tmp / n).write_bytes(raw)
for n, raw in samples.items():
    r = S.read_file(n, tmp)
    check(n + " eol", r["eol"] == ("CRLF" if "crlf" in n else "LF"))
    check(n + " bom flag", r["bom"] == raw.startswith(b"\xef\xbb\xbf"))
    check(n + " content has no CR", "\r" not in r["content"])
    new = r["content"].replace("دنیا", "جهان")
    res = S.save_file(n, new, r["sha256"], tmp)
    disk = (tmp / n).read_bytes()
    check(n + " bom kept", disk.startswith(b"\xef\xbb\xbf") == raw.startswith(b"\xef\xbb\xbf"))
    body = disk[3:] if disk.startswith(b"\xef\xbb\xbf") else disk
    if "crlf" in n:
        check(n + " all CRLF", body.count(b"\n") == body.count(b"\r\n") == 2)
    else:
        check(n + " no CR", b"\r" not in body)
    check(n + " edit applied", "جهان".encode() in body)
    check(n + " sha returned", res["sha256"] == S.sha(disk))
    hist = list((tmp / "_edit_history" / n).glob("*.tex"))
    check(n + " history copy is old bytes", len(hist) == 1 and hist[0].read_bytes() == raw)
(tmp / "latin1.tex").write_bytes("caf\xe9\n".encode("latin-1"))
check("non-UTF-8 file is refused", raises(415, S.read_file, "latin1.tex", tmp))
check("missing file 404", raises(404, S.read_file, "nope.tex", tmp))
check("save to missing file 404", raises(404, S.save_file, "nope.tex", "x", "0", tmp))

# ---------------------------------------------------------------- 409 conflict
r = S.read_file("lf.tex", tmp)
(tmp / "lf.tex").write_bytes(b"changed elsewhere\n")
try:
    S.save_file("lf.tex", "mine", r["sha256"], tmp)
    check("409 raised", False)
except S.HttpError as e:
    check("409 raised", e.code == 409 and e.extra["content"].startswith("changed elsewhere")
          and e.extra["sha256"] == S.sha(b"changed elsewhere\n"))
check("409 left file alone", (tmp / "lf.tex").read_bytes() == b"changed elsewhere\n")

# ---------------------------------------------------------------- history
for i in range(3):
    c = S.read_file("lf.tex", tmp)
    S.save_file("lf.tex", "v%d\n" % i, c["sha256"], tmp)
vs = S.history_list("lf.tex", tmp)
check("history list", len(vs) >= 3)
check("history newest first", [v["ts"] for v in vs] == sorted([v["ts"] for v in vs], reverse=True))
check("history file (oldest = the original text)", S.history_file("lf.tex", vs[-1]["ts"], tmp)["content"] == persian)
check("history file (changed elsewhere kept)", any(S.history_file("lf.tex", v["ts"], tmp)["content"].startswith("changed elsewhere") for v in vs))
check("history bad ts", raises(403, S.history_file, "lf.tex", "../../x", tmp))
check("history missing version", raises(404, S.history_file, "lf.tex", "20000101-000000", tmp))
check("history empty list", S.history_list("bom.tex", tmp) != [] and S.history_list("zzz.tex", tmp) == [])
old_keep = S.HIST_KEEP
S.HIST_KEEP = 2
for i in range(4):
    c = S.read_file("lf.tex", tmp)
    S.save_file("lf.tex", "p%d\n" % i, c["sha256"], tmp)
check("history pruned to HIST_KEEP", len(S.history_list("lf.tex", tmp)) == 2)
S.HIST_KEEP = old_keep

# ---------------------------------------------------------------- file listing / ordering
lst = Path(tempfile.mkdtemp(prefix="rtlled-list-"))
for n in ["main.tex", "ch2.tex", "ch1.tex", "zzz.tex", "aaa.bib", "ignored.pdf", "notes.md", "style.sty"]:
    (lst / n).write_bytes(b"x")
c1 = S.Config(root=str(lst), order=["main.tex", "ch1.tex", "ch2.tex"])
names = [f["name"] for f in S.list_files(lst, c1)]
check("order", names[:3] == ["main.tex", "ch1.tex", "ch2.tex"])
check("rest sorted after ordered", names[3:] == ["aaa.bib", "zzz.tex"])
check("pdf/md/sty not listed by default", not {"ignored.pdf", "notes.md", "style.sty"} & set(names))
c2 = S.Config(root=str(lst), extensions=["tex", ".sty"])
names2 = [f["name"] for f in S.list_files(lst, c2)]
check("custom extensions (with and without dot)", "style.sty" in names2 and "aaa.bib" not in names2)
check("list entries carry sha", all(len(f["sha256"]) == 64 for f in S.list_files(lst, c1)))

# ---------------------------------------------------------------- configuration
proj = Path(tempfile.mkdtemp(prefix="rtlled-proj-"))
(proj / "paper.tex").write_text("x", encoding="utf-8")
check("defaults", S.Config().port == 8765 and S.Config().engine == "xelatex" and S.Config().ui == "en")
cfg, _ = S.load_config(["--root", str(proj)])
check("no config: root from --root", cfg.root == proj.resolve() and cfg.main == "main.tex")
(proj / "livetex.json").write_text(json.dumps({
    "main": "paper.tex", "port": 9001, "title": "Paper", "engine": "lualatex", "ui": "fa",
    "order": ["paper.tex"], "names": {"paper.tex": "مقاله"}, "extensions": [".tex"], "outdir": "build",
    "hints": ["fa-plain-persian"]}), encoding="utf-8")
cfg, _ = S.load_config(["--root", str(proj)])
check("config discovered in root", cfg.main == "paper.tex" and cfg.port == 9001 and cfg.title == "Paper")
check("config fields", cfg.engine == "lualatex" and cfg.ui == "fa" and cfg.outdir == "build" and cfg.names["paper.tex"] == "مقاله")
check("latexmk lualatex", cfg.latexmk[:2] == ["latexmk", "-lualatex"] and "-outdir=build" in cfg.latexmk and cfg.latexmk[-1] == "paper.tex")
check("pdf rel path", cfg.pdf_rel == "build/paper.pdf" and cfg.stem == "paper")
check("latexmk xelatex/pdflatex", S.Config(engine="xelatex").latexmk[1] == "-xelatex" and S.Config(engine="pdflatex").latexmk[1] == "-pdf")
cfg, _ = S.load_config(["--root", str(proj), "--port", "7000", "--main", "other.tex"])
check("CLI overrides config", cfg.port == 7000 and cfg.main == "other.tex")
cfg, _ = S.load_config(["--config", str(proj / "livetex.json")])
check("--config alone: root is the config folder", cfg.root == proj.resolve())
sub = proj / "cfgs"
sub.mkdir()
(sub / "a.json").write_text(json.dumps({"root": "..", "main": "paper.tex"}), encoding="utf-8")
cfg, _ = S.load_config(["--config", str(sub / "a.json")])
check("config root is relative to the config file", cfg.root == proj.resolve())
(sub / "b.json").write_text("\ufeff" + json.dumps({"root": "..", "ui": "en"}), encoding="utf-8")
check("config with BOM", S.load_config(["--config", str(sub / "b.json")])[0].ui == "en")
(sub / "bad1.json").write_text('{"engine": "word"}', encoding="utf-8")
(sub / "bad2.json").write_text('{"nonsense": 1}', encoding="utf-8")
(sub / "bad3.json").write_text("{not json", encoding="utf-8")
(sub / "bad4.json").write_text('{"ui": "de"}', encoding="utf-8")
(sub / "bad5.json").write_text('{"outdir": "../x"}', encoding="utf-8")
(sub / "bad6.json").write_text('{"main": "a/b.tex"}', encoding="utf-8")
(sub / "bad7.json").write_text('[1, 2]', encoding="utf-8")
for i in range(1, 8):
    check("bad config %d rejected" % i, cfg_raises(["--config", str(sub / ("bad%d.json" % i))]))
check("missing --config file rejected", cfg_raises(["--config", str(sub / "none.json")]))
check("public config has no paths", set(cfg.public()) == {"title", "ui", "main", "engine", "names", "order"})

# ---------------------------------------------------------------- hint packs
pk = Path(tempfile.mkdtemp(prefix="rtlled-hints-"))
(pk / "mine.json").write_text(json.dumps([{"pattern": "very unique", "hint": "unique"},
                                          {"pattern": r"\bfoo+\b", "hint": "bar", "re": True}, {"nopattern": 1}]), encoding="utf-8")
(pk / "wrapped.json").write_text(json.dumps({"name": "w", "phrases": [{"pattern": "alpha", "hint": "beta"}]}), encoding="utf-8")
c = S.Config(root=str(pk), hints=["mine.json", "wrapped.json", "fa-plain-persian", "does-not-exist"])
ph = S.load_phrases(c)
fa = json.loads((S.HINTS_DIR / "fa-plain-persian.json").read_text(encoding="utf-8"))
check("fa pack >= 40 phrases", len(fa) >= 40)
check("packs merged, bad ones skipped", len(ph) == 2 + 1 + len(fa))
check("regex flag kept", any(p["re"] and p["pattern"].startswith(r"\bfoo") for p in ph))
check("object pack format", any(p["pattern"] == "alpha" for p in ph))
check("no hints by default", S.load_phrases(S.Config(root=str(pk))) == [])
check("pack path relative to config base", S.resolve_pack("mine.json", c) == pk / "mine.json")
check("built-in pack by name", S.resolve_pack("fa-plain-persian", c) == S.HINTS_DIR / "fa-plain-persian.json")
check("fa pack shape", all(isinstance(p.get("pattern"), str) and p["pattern"] and isinstance(p.get("hint"), str) for p in fa))
for p in fa:
    if p.get("re"):
        try:
            re.compile(p["pattern"])
        except re.error:
            check("regex " + p["pattern"], False)
check("fa pack is readable Persian (not mojibake)", any("می‌باشد" in p["pattern"] for p in fa))

# ---------------------------------------------------------------- error-log parsing
LOG = r"""This is XeTeX
(./main.tex (./fasl1.tex
./fasl1.tex:42: Undefined control sequence.
l.42 \foo
            bar
./fasl3.tex:7: LaTeX Error: Environment bar undefined.
See the LaTeX manual
l.7 \begin{bar}
! Emergency stop.
LaTeX Warning: Reference `x' on page 1 undefined on input line 3.
Package hyperref Warning: Token not allowed.
Output written on _live/main.pdf (142 pages, 5123456 bytes).
"""
errs = S.parse_errors(LOG)
check("errs count", len(errs) == 3)
check("err1", errs[0]["file"] == "fasl1.tex" and errs[0]["line"] == 42 and "Undefined" in errs[0]["message"] and "l.42" in errs[0]["message"])
check("err2", errs[1]["file"] == "fasl3.tex" and errs[1]["line"] == 7)
check("err bang", errs[2]["file"] == "" and "Emergency" in errs[2]["message"])
check("errors deduplicated", len(S.parse_errors(LOG + LOG)) == 3)
check("clean log has no errors", S.parse_errors("This is XeTeX\nOutput written on x.pdf (1 page).") == [])
check("pages", S.parse_pages(LOG) == 142)
check("pages singular", S.parse_pages("Output written on x.pdf (1 page, 10 bytes).") == 1)
check("pages none", S.parse_pages("nothing") is None)
check("warnings", S.count_warnings(LOG) == 2)
check("pages wrapped", S.parse_pages("Output written on D:/a b/main.xdv (107 \npages, 99 bytes).") == 107)

# ---------------------------------------------------------------- synctex parsing
EDIT = "This is SyncTeX command line utility, version 1.5\nSyncTeX result begin\nOutput:_live/main.pdf\nInput:D:/some folder/proj/./fasl1.tex\nLine:12\nColumn:-1\nOffset:0\nContext:\nSyncTeX result end\n"
r = S.parse_synctex_edit(EDIT)
check("edit parse", r and r["line"] == 12 and r["input"].endswith("fasl1.tex"))
(lst / "fasl1.tex").write_bytes(b"x")
check("edit basename missing", S.editable_basename("x/nofile.tex", lst) is None)
check("edit basename pdf", S.editable_basename("x/a.pdf", lst) is None)
check("edit basename ok", S.editable_basename(r["input"], lst) == "fasl1.tex")
check("edit basename backslashes", S.editable_basename("C:\\x\\y\\fasl1.tex", lst) == "fasl1.tex")
check("edit none", S.parse_synctex_edit("SyncTeX result begin\nSyncTeX result end") is None)
VIEW = "SyncTeX result begin\nOutput:_live/main.pdf\nPage:3\nx:100.5\ny:200.25\nh:90.0\nv:210.5\nW:300.0\nH:12.5\nbefore:\noffset:0\nmiddle:\nafter:\nOutput:_live/main.pdf\nPage:4\nx:1\ny:2\nh:3\nv:4\nW:5\nH:6\nSyncTeX result end\n"
b = S.parse_synctex_view(VIEW)
check("view parse", len(b) == 2 and b[0] == {"page": 3, "h": 90.0, "v": 210.5, "W": 300.0, "H": 12.5} and b[1]["page"] == 4)
check("view none", S.parse_synctex_view("SyncTeX result begin\nSyncTeX result end") == [])

# ---------------------------------------------------------------- UI strings: English and Persian must have the same keys
js = (S.STATIC / "app.js").read_text(encoding="utf-8")


def keys(lang):
    m = re.search(r"^  %s: \{\n(.*?)^  \},?\n" % lang, js, re.S | re.M)
    return set(re.findall(r"(?m)(?:^|[,{]\s*)\s*([A-Za-z0-9]+):", m.group(1))) if m else set()


en, fa_k = keys("en"), keys("fa")
check("i18n blocks found", len(en) > 30 and len(fa_k) > 30)
check("i18n en/fa same keys (diff: %s)" % sorted(en ^ fa_k), en == fa_k)
html = (S.STATIC / "index.html").read_text(encoding="utf-8")
used = set(re.findall(r'data-i18n(?:-title)?="([A-Za-z0-9]+)"', html))
check("every data-i18n key exists (missing: %s)" % sorted(used - en), used <= en)

print("selftest: %d passed, %d failed" % (ok, fail))
sys.exit(1 if fail else 0)
