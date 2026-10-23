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
for bad in ["../x.tex", "..\\x.tex", "/etc/passwd.tex", "C:\\a.tex", "x.exe", "x.pdf", "", ".hidden.tex", "~x.tex", None]:
    check("reject %r" % (bad,), raises(403, S.safe_path, bad, tmp))
# v2: files in sub-folders are editable now (this check used to assert the opposite)
check("accept sub/x.tex (sub-folders)", S.safe_path("sub/x.tex", tmp) == tmp / "sub" / "x.tex")
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
check("latexmk xelatex/pdflatex", "-xelatex" in S.Config(engine="xelatex").latexmk and S.Config(engine="pdflatex").latexmk[1] == "-pdf")
check("xelatex compiles with the light PDF writer rc", S.Config().latexmk[:3] == ["latexmk", "-r", "_live/.livetex-fast.latexmkrc"]
      and S.Config(outdir="b").fast_rc == "b/.livetex-fast.latexmkrc" and "-z 1" in S.FAST_RC_TEXT)
check("no light-writer rc for pdflatex/lualatex or with fast_pdf off", "-r" not in S.Config(engine="pdflatex").latexmk
      and "-r" not in S.Config(engine="lualatex").latexmk and "-r" not in S.Config(fast_pdf=False).latexmk)
check("final PDF = xdvipdfmx at default compression over the .xdv",
      S.Config(outdir="b", main="t.tex").final_pdf("b/t.tmp.pdf") == ["xdvipdfmx", "-q", "-E", "-o", "b/t.tmp.pdf", "b/t.xdv"])
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

# ================================================================ v2: project tree, uploads, trash, index, search, words
import os, shutil, subprocess, threading, urllib.error, urllib.request

proj2 = Path(tempfile.mkdtemp(prefix="rtlled-v2-"))
S.set_config(S.Config(root=str(proj2)))


def w(rel, text, crlf=False):
    p = proj2.joinpath(*rel.split("/"))
    p.parent.mkdir(parents=True, exist_ok=True)
    data = text.replace("\n", "\r\n") if crlf else text
    p.write_bytes(data.encode("utf-8"))
    return p


# ---------------------------------------------------------------- path traversal and protected folders
for bad in ["../x.tex", "a/../../x.tex", "a/../x.tex", "/abs.tex", "C:/x.tex", "C:x.tex", "\\\\srv\\share\\x.tex",
            "a\\x.tex", "a/./b.tex", "a//b.tex", "a/b/", "_live/x.tex", "_edit_history/x.tex", "_edit_trash/x.tex",
            ".git/config.tex", "a/.hidden/x.tex", "con.tex", "a/nul.tex", "x.tex ", "x.tex.", "a\x00b.tex", "~x.tex",
            "a/~b.tex", "x<y.tex", "", None, 5]:
    check("check_rel rejects %r" % (bad,), raises(403, S.check_rel, bad, proj2))
check("check_rel accepts a nested path", S.check_rel("chapters/ch1.tex", proj2) == proj2 / "chapters" / "ch1.tex")
check("check_rel accepts images", S.check_rel("figs/a.png", proj2) == proj2 / "figs" / "a.png")
check("safe_path refuses images as text", raises(403, S.safe_path, "figs/a.png", proj2))
outside = Path(tempfile.mkdtemp(prefix="rtlled-outside-"))
(outside / "secret.tex").write_text("secret", encoding="utf-8")
linked = False
try:
    os.symlink(str(outside), str(proj2 / "link"), target_is_directory=True)
    linked = True
except (OSError, NotImplementedError, AttributeError):
    try:
        import _winapi
        _winapi.CreateJunction(str(outside), str(proj2 / "link"))
        linked = True
    except Exception:
        linked = False
if linked:
    check("a link that leaves the root is refused", raises(403, S.check_rel, "link/secret.tex", proj2)
          and raises(403, S.read_file, "link/secret.tex", proj2))
    check("links are not listed in the tree", not any(e["path"].startswith("link") for e in S.project_tree(proj2)["entries"]))
    try:
        os.rmdir(str(proj2 / "link"))
    except OSError:
        try: os.unlink(str(proj2 / "link"))
        except OSError: pass
else:
    print("note: could not create a symlink or junction here; the link checks were skipped")

# ---------------------------------------------------------------- tree listing
w("main.tex", "\\documentclass{article}\n\\begin{document}\n\\input{chapters/ch1}\n\\end{document}\n")
w("chapters/ch1.tex", "\\section{One}\nhello\n")
(proj2 / "figs").mkdir()
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c636060606000000005000174a3fd960000000049454e44ae426082")
(proj2 / "figs" / "plot.png").write_bytes(PNG)
for junk in ["_live/main.pdf", "_edit_history/x/1.tex", "_edit_trash/1/x.tex", ".git/HEAD", "node_modules/a.js",
             "chapters/__pycache__/a.pyc", ".hidden.tex", "chapters/.edit-1.tmp"]:
    w(junk, "x")
tr1 = S.project_tree(proj2)
paths = [e["path"] for e in tr1["entries"]]
check("tree lists folders and nested files", {"chapters", "chapters/ch1.tex", "figs", "figs/plot.png", "main.tex"} <= set(paths))
check("tree skips output, history, trash, .git, node_modules, __pycache__ and dot files",
      not any(p.startswith(("_live", "_edit_history", "_edit_trash", ".git", "node_modules")) or "__pycache__" in p
              or p.split("/")[-1].startswith(".") for p in paths))
check("tree marks folders", next(e for e in tr1["entries"] if e["path"] == "chapters")["type"] == "dir")
check("tree meta (uploads folder, editable and image extensions, limit)",
      tr1["uploads"] == "figs/uploads" and ".tex" in tr1["editable"] and ".png" in tr1["images"] and tr1["maxUpload"] == S.MAX_UPLOAD)
check("tree signature is stable", S.project_tree(proj2)["sig"] == tr1["sig"])
w("chapters/ch1.tex", "\\section{One}\nhello again\n")
check("tree signature changes with the files", S.project_tree(proj2)["sig"] != tr1["sig"])

# ---------------------------------------------------------------- new file / new folder
check("create a nested file", S.create_file("chapters/new.tex", "x", proj2)["path"] == "chapters/new.tex"
      and (proj2 / "chapters" / "new.tex").read_text(encoding="utf-8") == "x")
check("create refuses to overwrite (409)", raises(409, S.create_file, "chapters/new.tex", "y", proj2)
      and (proj2 / "chapters" / "new.tex").read_text(encoding="utf-8") == "x")
check("create makes parent folders", S.create_file("deep/er/a.tex", "", proj2) and (proj2 / "deep" / "er" / "a.tex").is_file())
check("create refuses non-text extensions", raises(403, S.create_file, "chapters/x.png", "", proj2))
check("create refuses protected folders", raises(403, S.create_file, "_live/x.tex", "", proj2))
check("mkdir", S.make_dir("newdir/sub", proj2) and (proj2 / "newdir" / "sub").is_dir())
check("mkdir twice is 409", raises(409, S.make_dir, "newdir/sub", proj2))
check("mkdir in a protected folder is 403", raises(403, S.make_dir, "_edit_trash/x", proj2))

# ---------------------------------------------------------------- rename / move (history moves along)
r = S.read_file("chapters/new.tex", proj2)
S.save_file("chapters/new.tex", "x2", r["sha256"], proj2)
check("rename a file", S.rename_path("chapters/new.tex", "chapters/renamed.tex", proj2)["path"] == "chapters/renamed.tex"
      and not (proj2 / "chapters" / "new.tex").exists() and (proj2 / "chapters" / "renamed.tex").read_text(encoding="utf-8") == "x2")
check("rename moves the save history", len(S.history_list("chapters/renamed.tex", proj2)) == 1
      and not (proj2 / "_edit_history" / "chapters" / "new.tex").exists())
check("rename onto an existing file is 409", raises(409, S.rename_path, "chapters/renamed.tex", "main.tex", proj2))
check("rename of a missing file is 404", raises(404, S.rename_path, "nope.tex", "nope2.tex", proj2))
check("rename to a forbidden extension is 403", raises(403, S.rename_path, "chapters/renamed.tex", "chapters/r.exe", proj2))
check("rename into a protected folder is 403", raises(403, S.rename_path, "chapters/renamed.tex", "_live/r.tex", proj2))
check("move a folder", S.rename_path("deep", "moved/deep", proj2) and (proj2 / "moved" / "deep" / "er" / "a.tex").is_file())
check("a folder cannot move into itself", raises(400, S.rename_path, "moved", "moved/inner/moved", proj2))

# ---------------------------------------------------------------- trash and restore (never deletes)
before = (proj2 / "chapters" / "renamed.tex").read_bytes()
t1 = S.trash_path("chapters/renamed.tex", proj2)
check("trash moves the file away", not (proj2 / "chapters" / "renamed.tex").exists())
check("trash keeps the bytes under _edit_trash/<id>/<path>",
      (proj2 / "_edit_trash" / t1["id"] / "chapters" / "renamed.tex").read_bytes() == before)
items = S.trash_list(proj2)
check("trash list shows it", any(i["id"] == t1["id"] and i["path"] == "chapters/renamed.tex" and i["kind"] == "file" for i in items))
check("restore puts it back byte for byte", S.trash_restore(t1["id"], None, proj2)["path"] == "chapters/renamed.tex"
      and (proj2 / "chapters" / "renamed.tex").read_bytes() == before)
check("restored item leaves the trash", not any(i["id"] == t1["id"] for i in S.trash_list(proj2)))
check("restore of an unknown id is 404", raises(404, S.trash_restore, t1["id"], None, proj2))
check("restore with a bad id is 403", raises(403, S.trash_restore, "../../x", None, proj2))
t2 = S.trash_path("moved", proj2)
check("trash a folder", not (proj2 / "moved").exists() and any(i["kind"] == "dir" for i in S.trash_list(proj2)))
(proj2 / "moved").mkdir()
check("restore refuses to overwrite (409)", raises(409, S.trash_restore, t2["id"], None, proj2))
check("restore to another name", S.trash_restore(t2["id"], "moved-back", proj2)["path"] == "moved-back"
      and (proj2 / "moved-back" / "deep" / "er" / "a.tex").is_file())
check("trash of a missing path is 404", raises(404, S.trash_path, "ghost.tex", proj2))
check("the trash itself cannot be trashed", raises(403, S.trash_path, "_edit_trash", proj2))
check("the trash is not in the tree", not any(e["path"].startswith("_edit_trash") for e in S.project_tree(proj2)["entries"]))

# ---------------------------------------------------------------- upload naming and limits
check("sanitize spaces and brackets", S.sanitize_name("My Plot (v2).PNG") == "My-Plot-v2.png")
check("sanitize Persian-only names", S.sanitize_name("نمودار.png") == "image.png")
check("sanitize mixed names", S.sanitize_name("plot نمودار 2.jpg") == "plot-2.jpg")
check("sanitize path parts", S.sanitize_name("../../evil.tex") == "evil.tex" and S.sanitize_name("C:\\x\\y.bib") == "y.bib")
check("sanitize reserved names", S.sanitize_name("con.png") == "image-con.png")
check("sanitize accents", S.sanitize_name("Résumé final.pdf") == "Resume-final.pdf")
u1 = S.upload_file("figs/uploads", "My Plot.png", PNG, True, proj2)
u2 = S.upload_file("figs/uploads", "My Plot.png", PNG, True, proj2)
check("upload creates the folder and cleans the name", u1["path"] == "figs/uploads/My-Plot.png" and not u1["renamed"])
check("upload never overwrites: a suffix is added", u2["path"] == "figs/uploads/My-Plot-1.png" and u2["renamed"]
      and (proj2 / "figs" / "uploads" / "My-Plot.png").read_bytes() == PNG)
check("upload of an image-only target refuses text", raises(415, S.upload_file, "figs", "a.tex", b"x", True, proj2))
check("upload refuses programs", raises(415, S.upload_file, "", "run.exe", b"MZ", False, proj2))
check("upload refuses files without an extension", raises(415, S.upload_file, "", "Makefile", b"x", False, proj2))
check("upload accepts text files in the tree", S.upload_file("", "notes.txt", b"hi", False, proj2)["path"] == "notes.txt")
check("upload into a protected folder is 403", raises(403, S.upload_file, "_live", "a.png", PNG, True, proj2))
check("upload with a traversal folder is 403", raises(403, S.upload_file, "../x", "a.png", PNG, True, proj2))
old_max = S.MAX_UPLOAD
S.MAX_UPLOAD = 10
check("upload over the size limit is 413", raises(413, S.upload_file, "figs", "big.png", PNG, True, proj2))
S.MAX_UPLOAD = old_max
p_raw, ctype = S.raw_file("figs/plot.png", proj2)
check("raw serves images with their type", ctype == "image/png" and p_raw.read_bytes() == PNG)
check("raw refuses text files", raises(403, S.raw_file, "main.tex", proj2))
check("raw of a missing image is 404", raises(404, S.raw_file, "figs/none.png", proj2))

# ---------------------------------------------------------------- label / citation / outline index
S.set_config(S.Config(root=str(proj2), main="main.tex"))
w("main.tex", "\\documentclass{article}\n\\usepackage{graphicx}\n\\graphicspath{{figs/}{./}}\n"
  "\\newcommand{\\foo}[1]{#1}\n\\newcommand\\bar{x}\n\\newenvironment{myenv}{}{}\n"
  "\\newcommand{\\listx}{\\chapter*{Not in the outline}}\n"
  "\\begin{document}\n\\input{chapters/ch1}\n\\include{chapters/ch2}\n\\input{_inc/part}\n"
  "\\bibliography{refs,more}\n\\end{document}\n")
w("chapters/ch1.tex", "\\chapter{مقدمه}\\label{ch:intro}\nمتن \\cite{k1}.\n"
  "\\begin{figure}[tbp]\n\\centering\n\\includegraphics{plot}\n\\caption[کوتاه]{عنوان بلند شکل}\n\\label{fig:a}\n\\end{figure}\n"
  "\\begin{equation}\n  E = mc^2 \\label{eq:e}\n\\end{equation}\n"
  "\\begin{table}\n\\label{tab:t}\n\\caption{Table \\lr{caption} here}\n\\end{table}\n"
  "% \\label{fig:commented}\n\\begin{verbatim}\n\\label{verb:x}\n\\end{verbatim}\n")
w("chapters/ch2.tex", "\\section*{Two}\nSee \\ref{fig:a}.\n\\label{fig:a}\n")
w("_inc/part.tex", "\\subsection{Included from an underscore folder}\\label{sec:inc}\n")
w("notes.tex", "\\section{Orphan}\\label{orphan:x}\n")
w("_old/draft.tex", "\\label{draft:y}\n")
w("refs.bib", "@string{jr = \"Journal\"}\n@comment{ignored}\n"
  "@article{k1,\n  author = {Doe, John and Roe, Ann},\n  title = {{A} Study of {\\TeX} Things},\n  year = 2020,\n  journal = jr\n}\n"
  "@inproceedings(k2, author = \"Smith, A. and Jones, B. and Brown, C.\", title = {Nested {braces {deep}} title}, booktitle = {Conf}, year = {2019})\n",
  crlf=True)
w("more.bib", "@misc{k3, title = \"Quoted {Title}\", date = {2021-05-01}}\n")
w("_old/x.bib", "@misc{hidden, title={x}}\n")
idx = S.build_index(proj2)
labels = {}
for l in idx["labels"]:
    labels.setdefault(l["key"], l)          # the first one (fig:a is defined twice on purpose)
check("index follows \\input / \\include in order", idx["reachable"][:4] == ["main.tex", "chapters/ch1.tex", "chapters/ch2.tex", "_inc/part.tex"])
check("label after a heading takes the heading", labels["ch:intro"]["kind"] == "sec" and labels["ch:intro"]["text"] == "مقدمه"
      and labels["ch:intro"]["file"] == "chapters/ch1.tex" and labels["ch:intro"]["line"] == 1)
check("figure label takes the short caption", labels["fig:a"]["kind"] == "figure" and labels["fig:a"]["text"] == "کوتاه")
check("equation label", labels["eq:e"]["kind"] == "eq" and "mc^2" in labels["eq:e"]["text"])
check("label before its caption still gets it", labels["tab:t"]["kind"] == "table" and labels["tab:t"]["text"] == "Table caption here")
check("commented and verbatim labels are ignored", "fig:commented" not in labels and "verb:x" not in labels)
check("duplicate labels are flagged", sum(1 for l in idx["labels"] if l["key"] == "fig:a") == 2
      and all(l.get("dup") for l in idx["labels"] if l["key"] == "fig:a"))
check("files included from _ folders are indexed", labels["sec:inc"]["file"] == "_inc/part.tex")
check("orphan files are indexed and marked", labels["orphan:x"].get("orphan") is True)
check("orphans inside _ folders are skipped", "draft:y" not in labels)
ol = [(o["kind"], o.get("level"), o["title"]) for o in idx["outline"]]
check("outline in document order", ol == [("sec", 1, "مقدمه"), ("figure", 9, "کوتاه"), ("table", 9, "Table caption here"),
                                          ("sec", 2, "Two"), ("sec", 3, "Included from an underscore folder")])
check("preamble headings are not in the outline", not any("Not in the outline" in o["title"] for o in idx["outline"]))
bib = {b["key"]: b for b in idx["bib"]}
check("bib keys from referenced files, _ folders skipped", set(bib) == {"k1", "k2", "k3"} and idx["bibfiles"][:2] == ["refs.bib", "more.bib"])
check("bib authors and years", bib["k1"]["author"] == "Doe and Roe" and bib["k1"]["year"] == "2020"
      and bib["k2"]["author"] == "Smith et al." and bib["k3"]["year"] == "2021")
check("bib titles are plain text (TeX logo kept)", bib["k1"]["title"] == "A Study of TeX Things"
      and bib["k2"]["title"] == "Nested braces deep title" and bib["k3"]["title"] == "Quoted Title")
check("bib venue and macro values", bib["k2"]["venue"] == "Conf" and bib["k1"]["venue"] == "jr")
check("bib line numbers", bib["k1"]["line"] == 3 and bib["k2"]["line"] == 9)
check("images and \\graphicspath", "figs/plot.png" in idx["images"] and idx["graphicspath"] == ["figs/", "./"])
check("custom environments and commands", "myenv" in idx["envs"] and {"foo", "bar", "listx"} <= set(idx["commands"]))
check("parse_bib skips @string/@comment/@preamble", [e["key"] for e in S.parse_bib("@preamble{x}@string{a=b}@book{z, title={t}}")] == ["z"])
check("blank_comments keeps offsets and \\%", S.blank_comments("a 50\\% b % c\nd") == "a 50\\% b    \nd")

# ---------------------------------------------------------------- word count (Persian aware)
check("words: Persian sentence", S.word_count("سلام دنیا، این یک آزمون است.") == 6)
check("words: zero-width non-joiner keeps one word", S.word_count("می\u200cشود") == 1 and S.word_count("نیم\u200cفاصله\u200cها را") == 2)
check("words: diacritics do not split", S.word_count("مُهم است") == 2)
check("words: commands, citations, math and comments", S.word_count(
    "\\section{مقدمه} متن \\lr{LaTeX} و \\cite{a,b} $x+y$ \\label{s} % not counted\n") == 4)
check("words: preamble and display math", S.word_count(
    "\\documentclass{article}\\usepackage{x}\n\\begin{document}\nHello world\n\\[ a = b \\]\n\\begin{equation}x\\end{equation}\n\\end{document}") == 2)
check("words: caption counts the long text only", S.word_count("\\caption[short words]{the long caption}") == 3)
check("words: English with apostrophes and hyphens", S.word_count("Hello, world! It's a test-case.") == 5)
check("words: escaped percent", S.word_count("50\\% done") == 2)
check("words: \\href text counts, the URL does not", S.word_count("\\href{https://x.org/a}{the site}") == 2)
check("words: Persian digits are words", S.word_count("سال ۱۴۰۳") == 2)
pw = S.project_word_count(proj2)
check("project words follow the main file", [f["path"] for f in pw["files"]] == ["main.tex", "chapters/ch1.tex", "chapters/ch2.tex", "_inc/part.tex"]
      and pw["total"] == sum(f["words"] for f in pw["files"]) and pw["total"] > 10)

# ---------------------------------------------------------------- project search
w("chapters/ch3.tex", "cat concat Cat\n\U0001F600 hit\nfoo=1 bar=2\n")
w("_old/s.tex", "cat\n")
res = S.search_project("cat", root=proj2)
hits = {r["path"]: len(r["matches"]) for r in res["results"]}
check("search is case-insensitive by default", hits.get("chapters/ch3.tex") == 3)
check("search skips _ folders by default", "_old/s.tex" not in hits)
check("search includes _ folders on request", "_old/s.tex" in {r["path"] for r in S.search_project("cat", include_underscore=True, root=proj2)["results"]})
check("search includes files reached from main inside _ folders", "_inc/part.tex" in {r["path"] for r in S.search_project("underscore", root=proj2)["results"]})
check("search match case", sum(len(r["matches"]) for r in S.search_project("Cat", case=True, root=proj2)["results"]) == 1)
check("search whole word", {r["path"]: len(r["matches"]) for r in S.search_project("cat", word=True, root=proj2)["results"]}["chapters/ch3.tex"] == 2)
m0 = res["results"][[r["path"] for r in res["results"]].index("chapters/ch3.tex")]["matches"]
check("search gives line, column and context", m0[1]["line"] == 1 and m0[1]["col"] == 7 and m0[1]["hit"] == "cat" and m0[1]["pre"] == "cat con")
emo = S.search_project("hit", root=proj2)["results"][0]["matches"][0]
check("search columns count UTF-16 units (as the editor does)", emo["line"] == 2 and emo["col"] == 3 and emo["len"] == 3)
rx = S.search_project(r"(\w+)=(\d)", regex=True, replacement="$2=$1", root=proj2)
check("regex search with a replacement preview", [m["repl"] for m in rx["results"][0]["matches"]] == ["1=foo", "2=bar"])
check("bad regular expression is 400", raises(400, S.search_project, "(", True, False, False, False, None, proj2))
check("empty search is 400", raises(400, S.search_project, "", False, False, False, False, None, proj2))
check("search finds Persian text", any(r["path"] == "chapters/ch1.tex" for r in S.search_project("مقدمه", root=proj2)["results"]))

# ---------------------------------------------------------------- replace (normal save path: history + 409)
sha3 = S.read_file("chapters/ch3.tex", proj2)["sha256"]
h0 = len(S.history_list("chapters/ch3.tex", proj2))
rr = S.replace_in_project("cat", "\\textbf{X}", [{"path": "chapters/ch3.tex", "sha256": sha3, "only": [1]}], root=proj2)["results"][0]
txt = S.read_file("chapters/ch3.tex", proj2)["content"]
check("replace one match only, backslashes literal", rr["count"] == 1 and txt.startswith("cat con\\textbf{X} Cat"))
check("replace goes through save_file (history copy)", len(S.history_list("chapters/ch3.tex", proj2)) == h0 + 1)
check("replace returns the new content and sha", rr["content"] == txt and rr["sha256"] == S.read_file("chapters/ch3.tex", proj2)["sha256"])
stale = S.replace_in_project("cat", "dog", [{"path": "chapters/ch3.tex", "sha256": sha3}], root=proj2)["results"][0]
check("replace with a stale sha is refused (409) and leaves the file", stale["code"] == 409 and S.read_file("chapters/ch3.tex", proj2)["content"] == txt)
sha3 = S.read_file("chapters/ch3.tex", proj2)["sha256"]
S.replace_in_project(r"(\w+)=(\d)", "$2=$1", [{"path": "chapters/ch3.tex", "sha256": sha3}], regex=True, root=proj2)
check("regex replace with groups", "1=foo 2=bar" in S.read_file("chapters/ch3.tex", proj2)["content"])
sha3 = S.read_file("chapters/ch3.tex", proj2)["sha256"]
S.replace_in_project(r"(?P<n>\d)=", "${n}${n}$$", [{"path": "chapters/ch3.tex", "sha256": sha3}], regex=True, root=proj2)
check("named groups and $$", "11$foo 22$bar" in S.read_file("chapters/ch3.tex", proj2)["content"])
check("replace refuses paths outside the project", raises(403, S.replace_in_project, "a", "b", [{"path": "../x.tex", "sha256": ""}], False, False, False, proj2))
check("replace without files is 400", raises(400, S.replace_in_project, "a", "b", [], False, False, False, proj2))

# ---------------------------------------------------------------- BibTeX entries (normal save path)
fb = S.format_bib({"type": "article", "key": "lee2024x", "author": "Lee, K.", "title": "On {RTL}", "venue": "J. Text", "year": "2024", "doi": "10.1/x"})
check("format_bib", fb == "@article{lee2024x,\n  author = {Lee, K.},\n  title = {On {RTL}},\n  journal = {J. Text},\n  year = {2024},\n  doi = {10.1/x}\n}\n")
check("format_bib venue field follows the type", "booktitle = {C}" in S.format_bib({"type": "inproceedings", "key": "a", "title": "t", "venue": "C"}))
check("format_bib rejects bad keys, types and braces", raises(400, S.format_bib, {"type": "article", "key": "a b", "title": "t"})
      and raises(400, S.format_bib, {"type": "poem", "key": "a", "title": "t"})
      and raises(400, S.format_bib, {"type": "misc", "key": "a", "title": "{t"}))
bs = S.read_file("refs.bib", proj2)["sha256"]
added = S.bib_add("refs.bib", bs, {"type": "misc", "key": "new1", "title": "New", "url": "https://x.org"}, proj2)
raw_bib = (proj2 / "refs.bib").read_bytes()
check("bib_add appends the entry", added["key"] == "new1" and "howpublished = {\\url{https://x.org}}" in added["content"])
check("bib_add keeps CRLF line ends", raw_bib.count(b"\n") == raw_bib.count(b"\r\n") and b"@misc{new1," in raw_bib)
check("bib_add saves a history copy", len(S.history_list("refs.bib", proj2)) == 1)
check("bib_add refuses a duplicate key (409)", raises(409, S.bib_add, "refs.bib", S.sha(raw_bib), {"type": "misc", "key": "K1", "title": "x"}, proj2))
check("bib_add refuses a stale sha (409)", raises(409, S.bib_add, "refs.bib", bs, {"type": "misc", "key": "z9", "title": "x"}, proj2))
check("bib_add only writes .bib files", raises(403, S.bib_add, "main.tex", "", {"type": "misc", "key": "z", "title": "x"}, proj2))

# ---------------------------------------------------------------- synctex paths, change poll, config, compile from scratch
check("synctex ./sub/file.tex", S.editable_relpath("./chapters/ch1.tex", proj2) == "chapters/ch1.tex")
check("synctex absolute path inside the root", S.editable_relpath(str(proj2 / "chapters" / "ch1.tex"), proj2) == "chapters/ch1.tex")
check("synctex absolute path from another machine", S.editable_relpath("D:/elsewhere/proj/chapters/ch1.tex", proj2) == "chapters/ch1.tex")
check("synctex unknown file", S.editable_relpath("D:/x/none.tex", proj2) is None)
fs = S.file_states(["chapters/ch1.tex", "../x.tex", "gone.tex"], proj2)
check("change poll covers open nested files", [x["name"] for x in fs] == ["chapters/ch1.tex", "gone.tex"]
      and len(fs[0]["sha256"]) == 64 and fs[1].get("missing"))
check("uploads default", S.Config().uploads == "figs/uploads" and S.Config(uploads="img/").uploads == "img")
for v in ["../x", "_live/x", "C:/x", ".hidden", ""]:
    try:
        S.Config(uploads=v)
        check("bad uploads %r rejected" % v, False)
    except S.ConfigError:
        check("bad uploads %r rejected" % v, True)
check("latexmk -C for a clean rebuild", S.Config(outdir="build", main="paper.tex").latexmk_clean == ["latexmk", "-C", "-outdir=build", "paper.tex"])

# ---------------------------------------------------------------- what changed since the last compile; compile modes
old = {"a.tex": (1, 10), "b.tex": (2, 20), "gone.tex": (3, 30)}
new = {"a.tex": (1, 10), "b.tex": (5, 21), "c.tex": (6, 5)}
check("changed: edited, added and removed files", S.changed_since(old, new) == ["b.tex", "c.tex", "gone.tex"])
check("changed: nothing", S.changed_since(new, dict(new)) == [])
check("changed after a restart = newer than the PDF", S.changed_since(None, new, 4) == ["b.tex", "c.tex"])
check("changed with no PDF yet = everything", S.changed_since(None, new) == ["a.tex", "b.tex", "c.tex"])
w("_drafts/x.tex", "x\n")
w("figs/p.png", "png")
snap = S.source_snapshot(proj2)
check("snapshot covers sources and images", "chapters/ch1.tex" in snap and "figs/p.png" in snap)
check("snapshot skips _ folders and build output", not any(k.startswith(("_drafts/", "_live/")) for k in snap))
_old_cfg = S.CFG
S.set_config(S.Config(root=str(proj2), pdf_copy="main.pdf"))
(proj2 / "main.pdf").write_bytes(b"%PDF old")
check("snapshot skips the pdf_copy target", "main.pdf" not in S.source_snapshot(proj2))
(proj2 / S.CFG.outdir).mkdir(exist_ok=True)
(proj2 / S.CFG.pdf_rel).write_bytes(b"%PDF new")
check("a finished build is copied to pdf_copy",
      S.Compiler()._copy_pdf(proj2) == "" and (proj2 / "main.pdf").read_bytes() == b"%PDF new")
try:
    S.Config(pdf_copy="../x.pdf"); _bad = False
except S.ConfigError:
    _bad = True
check("pdf_copy must be a .pdf inside the project", _bad)
S.set_config(_old_cfg)
c = S.Compiler()
c.state, c.started = "running", time.time()
check("request while running queues", c.request(final=True) == "queued" and c.pending_mode == "final")
c.request()
check("a plain request does not downgrade a queued final", c.pending_mode == "final")
c.request(clean=True)
check("a clean request wins over final", c.pending_mode == "clean")
c.request(final=True)
check("final does not downgrade a queued clean", c.pending_mode == "clean")
st = c.status()
check("status reports mode, quality and changed files", {"mode", "quality", "changed", "changed_count"} <= set(st))
check("replace_retry moves a file", (lambda a, b: (a.write_text("1"), S.replace_retry(str(a), str(b)))[1] and b.read_text() == "1")(proj2 / "r1.tmp", proj2 / "r2.tmp"))

# ---------------------------------------------------------------- two saves at once with the same base: one wins, one gets 409
w("race.tex", "base\n")
base = S.read_file("race.tex", proj2)["sha256"]
outcome = []


def racer(text):
    try:
        S.save_file("race.tex", text, base, proj2)
        outcome.append(200)
    except S.HttpError as e:
        outcome.append(e.code)


ths = [threading.Thread(target=racer, args=("v%d\n" % i,)) for i in range(4)]
for th in ths: th.start()
for th in ths: th.join()
check("concurrent saves are serialised (one 200, the rest 409)", sorted(outcome) == [200, 409, 409, 409]
      and len(S.history_list("race.tex", proj2)) == 1)

# ---------------------------------------------------------------- HTTP layer: guards, upload limit, raw headers
S.set_config(S.Config(root=str(proj2)))
srv = S.ThreadingHTTPServer(("127.0.0.1", 0), S.Handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()


def http(method, path, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode("utf-8") if body is not None else None)
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


W = {"X-LiveTeX": "1", "Content-Type": "application/json"}
st, hd, bd = http("GET", "/api/tree")
check("GET /api/tree", st == 200 and any(e["path"] == "chapters/ch1.tex" for e in json.loads(bd)["entries"]))
check("writes without the X-LiveTeX header are refused", http("POST", "/api/mkdir", {"path": "x1"}, {"Content-Type": "application/json"})[0] == 403
      and not (proj2 / "x1").exists())
check("writes from another origin are refused", http("POST", "/api/mkdir", {"path": "x2"}, dict(W, Origin="http://evil.example"))[0] == 403
      and not (proj2 / "x2").exists())
check("a foreign Host header is refused (DNS rebinding)", http("GET", "/api/tree", headers={"Host": "evil.example:%d" % port})[0] == 403)
check("same-origin writes work", http("POST", "/api/mkdir", {"path": "x3"}, dict(W, Origin="http://127.0.0.1:%d" % port))[0] == 200
      and (proj2 / "x3").is_dir())
check("GET /api/file of a nested file", json.loads(http("GET", "/api/file?path=chapters%2Fch1.tex")[2])["content"].startswith("\\chapter"))
check("GET /api/file with traversal is 403", http("GET", "/api/file?path=..%2Fx.tex")[0] == 403)
cur = json.loads(http("GET", "/api/file?path=chapters%2Fch1.tex")[2])
check("PUT /api/file nested save", http("PUT", "/api/file", {"path": "chapters/ch1.tex", "content": cur["content"] + "x\n", "base_sha256": cur["sha256"]}, W)[0] == 200)
st, hd, bd = http("POST", "/api/upload?dir=figs&name=Up%20Load.png&kind=image", raw=PNG, headers={"X-LiveTeX": "1", "Content-Type": "application/octet-stream"})
check("POST /api/upload", st == 200 and json.loads(bd)["path"] == "figs/Up-Load.png")
old_max = S.MAX_UPLOAD
S.MAX_UPLOAD = 50
st, hd, bd = http("POST", "/api/upload?dir=figs&name=big.png", raw=b"x" * 120, headers={"X-LiveTeX": "1"})
S.MAX_UPLOAD = old_max
check("upload over the limit is 413", st == 413 and not (proj2 / "figs" / "big.png").exists())
st, hd, bd = http("GET", "/api/raw?path=figs%2Fplot.png")
check("GET /api/raw: type, nosniff and a sandboxing CSP", st == 200 and hd.get("Content-Type") == "image/png" and bd == PNG
      and hd.get("X-Content-Type-Options") == "nosniff" and "sandbox" in hd.get("Content-Security-Policy", ""))
check("GET /api/raw refuses text", http("GET", "/api/raw?path=main.tex")[0] == 403)
check("POST /api/search", json.loads(http("POST", "/api/search", {"q": "مقدمه"}, W)[2])["total"] >= 1)
check("POST /api/wordcount", json.loads(http("POST", "/api/wordcount", {"text": "یک دو \\cite{x} three"}, W)[2])["words"] == 3)
check("GET /api/wordcount", json.loads(http("GET", "/api/wordcount")[2])["total"] > 0)
check("GET /api/index", "fig:a" in {l["key"] for l in json.loads(http("GET", "/api/index")[2])["labels"]})
check("GET /api/changes with open nested files", json.loads(http("GET", "/api/changes?open=chapters%2Fch1.tex")[2])["open"][0]["name"] == "chapters/ch1.tex")
check("trash and restore over HTTP", http("POST", "/api/trash", {"path": "x3"}, W)[0] == 200 and not (proj2 / "x3").exists()
      and http("POST", "/api/trash/restore", {"id": json.loads(http("GET", "/api/trash")[2])["items"][0]["id"]}, W)[0] == 200
      and (proj2 / "x3").is_dir())
check("bad JSON is 400", http("POST", "/api/search", raw=b"{nope", headers=W)[0] == 400)
srv.shutdown()
srv.server_close()

# ---------------------------------------------------------------- the browser helpers (static/latex-tools.js), through node if installed
node = shutil.which("node")
if node:
    js_test = r"""
import * as LT from __LT_URL__;
const out = [];
const eq = (name, a, b) => out.push([name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a)]);
eq("escapeLatex", LT.escapeLatex("a&b%c$d#e_f{g}h~i^j\\k"), "a\\&b\\%c\\$d\\#e\\_f\\{g\\}h\\textasciitilde{}i\\textasciicircum{}j\\textbackslash{}k");
eq("parse TSV with quotes", LT.parseDelimited('a\t"b\nc"\td\n1\t2\n'), [["a", "b c", "d"], ["1", "2", ""]]);
eq("parse CSV", LT.parseDelimited('x,"y, z"\n1,2'), [["x", "y, z"], ["1", "2"]]);
eq("parse semicolon CSV", LT.parseDelimited("a;b;c\n1;2;3"), [["a", "b", "c"], ["1", "2", "3"]]);
eq("tabular booktabs + header", LT.buildTabular([["A", "B"], ["1", "2"]], { header: true, align: "l" }),
  ["\\begin{tabular}{ll}", "\\toprule", "A & B \\\\", "\\midrule", "1 & 2 \\\\", "\\bottomrule", "\\end{tabular}"]);
eq("tabular hline + escape", LT.buildTabular([["5%"]], { booktabs: false, escape: true })[2], "5\\% \\\\");
eq("figure", LT.buildFigure({ path: "figs/a.png", width: 0.75, caption: "Long one.", short: "Short", label: "fig:a" }),
  "\\begin{figure}[tbp]\n\\centering\n\\includegraphics[width=0.75\\textwidth]{figs/a.png}\n\\caption[Short]{Long one.}\n\\label{fig:a}\n\\end{figure}");
eq("figure svg + full width", LT.buildFigure({ path: "x/d.svg", width: 1, caption: "c" }).split("\n")[2], "\\includesvg[width=\\textwidth]{x/d}");
eq("figure without caption puts the cursor there", LT.buildFigure({ path: "a.png", width: 0.5 }).includes("\\caption{" + LT.CURSOR + "}"), true);
eq("table cursor in the first cell", LT.buildTable({ nrows: 2, ncols: 2, caption: "T", label: "tab:t" }).split("\n")[6], LT.CURSOR + " &  \\\\");
eq("shortCaption sentence", LT.shortCaption("نرخ موفقیت در سه آشپزخانه. هر ستون یک روش است."), "نرخ موفقیت در سه آشپزخانه");
eq("shortCaption keeps braces whole", LT.shortCaption("A \\lr{B. C} d e f g h i j k", 4), "A \\lr{B. C} d e");
eq("slugify", [LT.slugify("My Plot (v2)"), LT.slugify("نمودار")], ["my-plot-v2", ""]);
eq("uniqueLabel", LT.uniqueLabel("fig:a", new Set(["fig:a", "fig:a-2"])), "fig:a-3");
eq("context ref after comma", LT.completionContext("see \\cref{fig:a, sec:"), { kind: "ref", prefix: "sec:" });
eq("context cite with options", LT.completionContext("\\citep[p.~3][]{kn"), { kind: "cite", prefix: "kn" });
eq("context image", LT.completionContext("\\includegraphics[width=1cm]{figs/"), { kind: "img", prefix: "figs/", cmd: "includegraphics" });
eq("context begin / end", [LT.completionContext("\\begin{fig").kind, LT.completionContext("\\end{").kind], ["begin", "end"]);
eq("context command", LT.completionContext("text \\textb"), { kind: "cmd", prefix: "\\textb" });
eq("\\href is not a reference", LT.completionContext("\\href{"), null);
eq("\\\\ is not a command", LT.completionContext("a \\\\"), null);
eq("open environments", LT.openEnvs("\\begin{figure}\\begin{center}\\end{center}\\begin{itemize}% \\end{itemize}"), ["figure", "itemize"]);
eq("resolveImage via graphicspath, no extension", LT.resolveImage("plot", ["figs/plot.pdf", "figs/plot.png"], ["figs/"]), "figs/plot.pdf");
eq("resolveImage ./ and missing", [LT.resolveImage("./figs/plot.png", ["figs/plot.png"], []), LT.resolveImage("none", ["a.png"], [])], ["figs/plot.png", null]);
eq("comment plan adds", LT.commentPlan(["a", "", "b"]).map((p) => p.op + p.i), ["add0", "add2"]);
eq("comment plan removes", LT.commentPlan(["% a", "  %b"]).map((p) => [p.op, p.at, p.len]), [["remove", 0, 2], ["remove", 2, 1]]);
eq("wrap plans", [LT.wrapPlan("x \\textbf{", "a", "} y", "\\textbf{", "}"), LT.wrapPlan("", "\\textbf{a}", "", "\\textbf{", "}"), LT.wrapPlan("", "a", "", "\\textbf{", "}")],
  ["unwrap-outer", "unwrap-inner", "wrap"]);
eq("bib key", LT.suggestBibKey("Ahn, Michael and others", "2022", "Do As I Can, Not As I Say"), "ahn2022can");
eq("line direction", [LT.lineDir("\\item ربات باید"), LT.lineDir("\\section{مقدمه}"), LT.lineDir("\\begin{equation}"), LT.lineDir("\\label{fig:x} متن")], ["rtl", "rtl", "ltr", "rtl"]);
eq("command segments", LT.cmdSegments("a \\lr{b}").map((s) => s.cmd), [false, true]);
eq("command units keep Latin arguments, not Persian ones",
  LT.cmdSegments("مدل \\lr{Gemma 4} و \\textbf{متن} و \\includegraphics[width=0.9\\linewidth]{figs/a.png} \\\\ \\cite{a,b}{متن} \\lr{\\textbf{X}}")
    .filter((s) => s.cmd).map((s) => s.text),
  ["\\lr{Gemma 4}", "\\textbf", "\\includegraphics[width=0.9\\linewidth]{figs/a.png}", "\\cite{a,b}", "\\lr", "\\textbf{X}"]);
eq("formatBib preview", LT.formatBib({ type: "article", key: "k", title: "T", venue: "J" }), "@article{k,\n  title = {T},\n  journal = {J}\n}");
eq("lineDiff", LT.lineDiff(["a", "b", "c"], ["a", "x", "c", "d"]), [{ s: 1, e: 2, lines: ["x"] }, { s: 3, e: 3, lines: ["d"] }]);
const M3 = (b, a, t) => LT.merge3(b.join("\n"), a.join("\n"), t.join("\n"), { open: "%>>", close: "%<<" });
eq("merge: edits on different lines are both kept", M3(["a", "b", "c", "d", "e"], ["A", "b", "c", "d", "e"], ["a", "b", "c", "d", "E"]),
  { text: "A\nb\nc\nd\nE", conflicts: 0 });
eq("merge: typing kept when the disk rewrote another paragraph",
  M3(["p1", "", "p2", "", "p3"], ["p1 typed", "", "p2", "", "p3"], ["p1", "", "p2", "", "new p3", "more"]),
  { text: "p1 typed\n\np2\n\nnew p3\nmore", conflicts: 0 });
eq("merge: the same edit on both sides is not a conflict", M3(["a", "b"], ["a", "B"], ["a", "B"]), { text: "a\nB", conflicts: 0 });
eq("merge: only the disk changed", M3(["x", "y"], ["x", "y"], ["x", "y", "z"]), { text: "x\ny\nz", conflicts: 0 });
eq("merge: same lines changed on both sides keep mine, then theirs as comments",
  M3(["a", "b", "", "c"], ["a", "mine", "", "c"], ["a", "theirs", "", "c"]), { text: "a\nmine\n%>>\n% theirs\n%<<\n\nc", conflicts: 1 });
eq("merge: an empty line on the disk side is commented as a bare %", M3(["a", "b"], ["a", "m"], ["a", "", "t"]).text.split("\n").slice(2, 6),
  ["%>>", "%", "% t", "%<<"]);
console.log(JSON.stringify(out));
""".replace("__LT_URL__", json.dumps((S.STATIC / "latex-tools.js").as_uri()))
    tmpjs = Path(tempfile.mkdtemp(prefix="rtlled-js-")) / "t.mjs"
    tmpjs.write_text(js_test, encoding="utf-8")
    try:
        pr = subprocess.run([node, str(tmpjs)], capture_output=True, text=True, encoding="utf-8", timeout=60)
        results = json.loads(pr.stdout.strip().splitlines()[-1])
        for name, good, got in results:
            check("js: %s (got %s)" % (name, got) if not good else "js: " + name, good)
    except Exception as e:
        check("js helper tests ran (%s)" % e, False)
else:
    print("note: node not found; the JavaScript helper checks were skipped")

# ---------------------------------------------------------------- UI strings: English and Persian must have the same keys
js = (S.STATIC / "app.js").read_text(encoding="utf-8")
check("command units are CodeMirror bidi isolates, registered for cursor drawing and motion",
      "bidiIsolate: Direction.LTR" in js and "EditorView.bidiIsolatedRanges.of(" in js and "LT.CMD_UNIT" in js)
check("a file saved outside the editor is merged into unsaved typing, on the disk check and on a refused save",
      js.count("takeDiskVersion(f, ") >= 2 and "LT.merge3(" in js and "f.conflict = { content: d.data.content" not in js)


def keys(lang):
    m = re.search(r"^  %s: \{\n(.*?)^  \},?\n" % lang, js, re.S | re.M)
    return set(re.findall(r"(?m)(?:^|[,{]\s*)\s*([A-Za-z0-9]+):", m.group(1))) if m else set()


en, fa_k = keys("en"), keys("fa")
check("i18n blocks found", len(en) > 30 and len(fa_k) > 30)
check("i18n en/fa same keys (diff: %s)" % sorted(en ^ fa_k), en == fa_k)
html = (S.STATIC / "index.html").read_text(encoding="utf-8")
used = set(re.findall(r'data-i18n(?:-title)?="([A-Za-z0-9]+)"', html))
check("every data-i18n key exists (missing: %s)" % sorted(used - en), used <= en)
ph = set(re.findall(r'data-i18n-ph="([A-Za-z0-9]+)"', html))
check("every data-i18n-ph key exists (missing: %s)" % sorted(ph - en), ph and ph <= en)
alljs = "\n".join(p.read_text(encoding="utf-8") for p in S.STATIC.glob("*.js"))
called = set(re.findall(r'\btr\("([A-Za-z0-9]+)"', alljs)) | set(re.findall(r'label: "([A-Za-z0-9]+)"', js))
check("every tr(...) key used by the modules exists (missing: %s)" % sorted(called - en), called <= en)
for mod in ["latex-tools.js", "icons.js", "complete.js", "tree.js", "dialogs.js", "projsearch.js"]:
    check("module %s exists and is imported" % mod, (S.STATIC / mod).is_file() and ("./" + mod) in alljs)
check("autocomplete is pinned like the other CodeMirror packages", "@codemirror/autocomplete@6.16.0?deps=@codemirror/state@6.4.1" in html)

print("selftest: %d passed, %d failed" % (ok, fail))
sys.exit(1 if fail else 0)
