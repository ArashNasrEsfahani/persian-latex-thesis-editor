# RTL LaTeX Live Editor

A local, Overleaf-like LaTeX editor with first-class **right-to-left (Persian / Arabic / Hebrew)** support.
It runs on your own machine, edits the `.tex` files of a project in place, compiles with `latexmk`, and shows the PDF
next to the source. The server is a single Python file with no dependencies.

![Overview: Persian source on the left, compiled PDF on the right](screenshots/01-overview.png)

## Features

- **Per-line direction.** Every source line is shown right-to-left or left-to-right depending on its content, so
  `\item متن فارسی` reads RTL while `\begin{equation}` stays LTR. LaTeX command names and the arguments of
  `\label`, `\ref`, `\cite`, `\lr`, `\includegraphics`... do not count when deciding.
- **Commands stay left-to-right units.** Inside an RTL line every `\command` is isolated, so the backslash never jumps
  to the wrong end of the word.
- **SyncTeX both ways.** Double-click the PDF to jump to the source line; press `Ctrl+J` to find the cursor line in the PDF.
- **`latexmk` compile** (XeLaTeX, LuaLaTeX or pdfLaTeX) with a status badge, a clickable error list that opens the
  offending line, and the log tail.
- **Save history.** Every save keeps the previous version (last 200 per file) with a line diff and one-click restore.
- **Conflict detection.** If a file changes on disk (git, another editor) while you have unsaved edits, you get a banner
  instead of a silent overwrite; saves are refused with HTTP 409 if the base version is stale.
- **Phrase hints.** Underline wording you want to avoid, with a suggestion on hover. Hints come in packs
  (a JSON file); a Persian "plain wording" pack is included.
- **English and Persian UI** with a toggle in the page; light and dark themes; resizable panes.
- Preserves your files exactly: UTF-8, BOM and CRLF/LF are kept as they were.

![Phrase hints](screenshots/02-phrase-hints.png)

## Requirements

- Python 3.9 or newer (standard library only).
- A TeX distribution that provides `latexmk` and `synctex` on `PATH` (TeX Live, MiKTeX, MacTeX), plus the packages your
  document needs. The bundled example needs `xepersian` and works with XeLaTeX.
- A browser that can reach the internet: CodeMirror 6 (from `esm.sh`, pinned versions), PDF.js (from jsDelivr, pinned
  to 4.4.168) and the Vazirmatn font (Google Fonts) are loaded from CDNs.

## Quick start

```bash
git clone <this repository>
cd rtl-latex-live-editor
python server.py --root example --open        # the bundled bilingual example
```

Or use the launchers: `start-editor.bat` (Windows) / `./start-editor.sh` (macOS, Linux). Pass your project folder as the
first argument; with no argument the example opens.

For your own project, either point the server at the folder:

```bash
python server.py --root /path/to/my-paper --main paper.tex --port 8765
```

or drop a `livetex.json` into the project folder (it is picked up automatically) and run
`python server.py --root /path/to/my-paper`. If neither `--root` nor `--config` is given, `livetex.json` in the current folder is used, then one next to `server.py`
(handy when you vendor the editor into a repository). Then open <http://127.0.0.1:8765>.

The server listens on `127.0.0.1` only. Compiled output goes to `<root>/<outdir>/` (default `_live/`), save history to
`<root>/_edit_history/`; add both to your `.gitignore`.

## Config reference

A JSON file, `livetex.json` in the LaTeX project folder, or any path given with `--config FILE`. All keys are optional.
Relative paths are resolved against the folder that holds the config file. Unknown keys are rejected (typos get caught).

| key | default | meaning |
|---|---|---|
| `root` | the config's folder (or `--root`, or the current folder) | LaTeX project folder |
| `main` | `"main.tex"` | file passed to `latexmk` (a file name directly inside `root`) |
| `port` | `8765` | port on `127.0.0.1` |
| `title` | root folder name | shown in the top bar and tab title |
| `engine` | `"xelatex"` | `"xelatex"`, `"lualatex"` or `"pdflatex"` |
| `order` | `[]` | file names listed first, in this order; the rest follow alphabetically |
| `names` | `{}` | display names, `{"fasl1.tex": "Chapter 1"}` |
| `extensions` | `[".tex", ".bib"]` | extensions shown in the file list (files are editable by name even if not listed: `.tex .bib .sty .cls .md`) |
| `outdir` | `"_live"` | `latexmk -outdir` folder name |
| `hints` | `[]` | phrase-hint packs: built-in names (`"fa-plain-persian"`) or file paths |
| `ui` | `"en"` | UI language, `"en"` or `"fa"` (the in-page toggle overrides it for that browser) |

Command line (overrides the config): `--root DIR`, `--main FILE`, `--port N`, `--config FILE`, `--open` (launch the browser).

Example:

```json
{
  "main": "paper.tex",
  "title": "My paper",
  "engine": "xelatex",
  "ui": "fa",
  "order": ["paper.tex", "intro.tex", "refs.bib"],
  "names": {"paper.tex": "Main file", "intro.tex": "Introduction"},
  "hints": ["fa-plain-persian", "my-hints.json"]
}
```

## Keyboard shortcuts

| keys | action |
|---|---|
| `Ctrl+S` | save |
| `Ctrl+Enter` | save and compile |
| `Ctrl+J` | show the cursor line in the PDF |
| `Ctrl+F` / `Ctrl+H` | find / find and replace |
| `Ctrl+Z`, `Ctrl+Shift+Z` | undo / redo |
| double-click in the PDF | jump to the source line |

On macOS use `Cmd` in place of `Ctrl`.

## How hints work

A hint pack is a JSON list of `{"pattern", "hint", "re"?}` objects (or an object with a `"phrases"` list):

```json
[
  {"pattern": "in order to", "hint": "to"},
  {"pattern": "\\butilis(e|ing)\\b", "hint": "use", "re": true}
]
```

`pattern` is matched literally, or as a JavaScript regular expression when `"re": true`. Matches are underlined while
you type; hovering shows `Suggestion: <hint>`. A pack is found by name in `hints/<name>.json`, or by path relative to
the config file. Several packs can be combined. The checkbox "Show phrase hints" turns underlining off.

`hints/fa-plain-persian.json` flags stiff, formal or machine-sounding Persian wording (for example «می‌باشد» → «است»).

![History](screenshots/03-history.png)

The UI switches between English and Persian (right-to-left layout):

![Persian UI](screenshots/04-persian-ui.png)

## Tests

```bash
python selftest.py
```

Covers config loading and validation, path safety, CRLF/LF/BOM round trips, the 409 conflict, history, log and SyncTeX
parsing, hint packs, and that every UI string exists in both languages. It needs no TeX installation and works only on
temporary folders.

## Limitations

- Single user, local only. There is no login and no collaboration; do not expose the port to a network.
- Only files directly inside the root folder are listed and editable (no `chapters/ch1.tex` sub-folders yet; `\input`
  of files in sub-folders compiles fine but those files cannot be opened in the editor).
- Files must be UTF-8.
- The error list is parsed from `-file-line-error` output; errors that LaTeX does not attribute to a line show without a location.
- Compilation uses `latexmk` with the options in `server.py`; custom `latexmkrc` settings in the project still apply.
- The PDF is redrawn after every compile, not incrementally; very large documents take a moment.
- Needs internet access for CodeMirror, PDF.js and the font (they are not bundled).

## بخش فارسی

**ویرایشگر زندهٔ LaTeX با پشتیبانی کامل از راست‌به‌چپ.** برنامه‌ای محلی، شبیه Overleaf، که فایل‌های `.tex` پروژهٔ شما را
روی همان رایانه ویرایش می‌کند، با `latexmk` کامپایل می‌کند و PDF را کنار متن نشان می‌دهد. سرور فقط یک فایل پایتون است و به
هیچ بستهٔ اضافه‌ای نیاز ندارد.

- جهت هر خط جدا تشخیص داده می‌شود (فارسی از راست، فرمان‌ها از چپ) و هر `\command` یک واحد چپ‌به‌راست می‌ماند.
- SyncTeX دوطرفه: دوبار کلیک در PDF شما را به خط منبع می‌برد، و `Ctrl+J` خط فعلی را در PDF نشان می‌دهد.
- تاریخچهٔ ذخیره، تشخیص تعارض هنگام تغییر فایل بیرون از ویرایشگر، فهرست خطاهای کامپایل.
- عبارت‌های مشکوک با بستهٔ قابل‌افزودن زیر خط کشیده می‌شوند؛ بستهٔ «فارسی ساده» همراه برنامه است.
- رابط انگلیسی یا فارسی (کلید `فا` / `EN` در نوار بالا، یا `"ui": "fa"` در پیکربندی).

اجرا:

```bash
python server.py --root example --open
```

برای پروژهٔ خودتان یک فایل `livetex.json` در پوشهٔ پروژه بگذارید (کلیدها در جدول بالا) و `python server.py --root پوشه-پروژه` را بزنید.
نیازمندی‌ها: پایتون ۳٫۹ به بالا، `latexmk` و `synctex` روی `PATH`، و اینترنت برای بارگذاری CodeMirror و PDF.js و فونت.

## License

MIT, copyright 2026 Arash NasrEsfahani. See [LICENSE](LICENSE).
