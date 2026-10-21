import { EditorState, StateEffect, StateField, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
         Decoration, ViewPlugin, MatchDecorator, hoverTooltip } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";
import * as pdfjs from "pdfjs";

pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
/* ------------------------------------------------------------------ i18n (every UI string, English + Persian) */
const I18N = {
  en: {
    save: "Save", saveTip: "Save (Ctrl+S)", compile: "Compile", compiling: "Compiling…", compileTip: "Save and compile (Ctrl+Enter)",
    compileOnSave: "Compile on save", showHints: "Show phrase hints", showInPdf: "Show in PDF", history: "History",
    themeTip: "Light / dark", fitWidth: "Fit width", pdfEmpty: "Compile to see the PDF", errorsTitle: "Compile errors",
    historyTitle: "History of this file", close: "Close", restore: "Restore this version",
    readFail: "Could not read the file", conflictFirst: "Resolve the file conflict first", nothingToSave: "Nothing to save",
    saveFail: "Save failed: ", saved: "Saved", unsaved: "Unsaved changes", diskChanged: "Changed outside the editor",
    conflict0: "This file was changed outside the editor", loadDisk: "Load the disk version", keepMine: "Keep my version",
    conflict1: "The next save overwrites the disk version (the old one stays in History). Sure?", yesKeep: "Yes, keep mine",
    back: "Back", saveWithCtrlS: "Press Ctrl+S to save",
    seconds: (n) => n + " s", pages: (n) => n + (n === "1" ? " page" : " pages"), nErrors: (n) => n + (n === "1" ? " error" : " errors"), noErrors: "no errors",
    line: (n) => "line " + n, noSource: "No source found for this point", lineStale: "Line is from the last compile",
    lineNotFound: "This line was not found in the PDF (compile first)", pageOf: (a, b) => "page " + a + " of " + b,
    pickVersion: "Pick a version (red = old version, green = current text)", noVersions: "No versions yet",
    unchangedLines: (n) => "⋯ " + n + " unchanged lines", sameText: "This version is identical to the current text.",
    restored: "Version loaded; save to keep it", suggestion: "Suggestion: ", toggleLang: "فا",
    cmPhrases: {},
  },
  fa: {
    save: "ذخیره", saveTip: "ذخیره (Ctrl+S)", compile: "کامپایل", compiling: "در حال کامپایل…", compileTip: "ذخیره و کامپایل (Ctrl+Enter)",
    compileOnSave: "کامپایل هنگام ذخیره", showHints: "نمایش عبارت‌های مشکوک", showInPdf: "نمایش در PDF", history: "تاریخچه",
    themeTip: "تم روشن/تیره", fitWidth: "عرض صفحه", pdfEmpty: "برای دیدن PDF کامپایل کنید", errorsTitle: "خطاهای کامپایل",
    historyTitle: "تاریخچهٔ این فایل", close: "بستن", restore: "بازگردانی این نسخه",
    readFail: "خواندن فایل ممکن نشد", conflictFirst: "ابتدا تعارض فایل را حل کنید", nothingToSave: "تغییری برای ذخیره نیست",
    saveFail: "ذخیره نشد: ", saved: "ذخیره شد", unsaved: "ذخیره‌نشده", diskChanged: "بیرون از ویرایشگر تغییر کرده",
    conflict0: "این فایل بیرون از ویرایشگر تغییر کرد", loadDisk: "بارگذاری نسخهٔ دیسک", keepMine: "نگه داشتن نسخهٔ من",
    conflict1: "ذخیرهٔ بعدی نسخهٔ دیسک را بازنویسی می‌کند (نسخهٔ قبلی در تاریخچه می‌ماند). مطمئنید؟", yesKeep: "بله، نسخهٔ من بماند",
    back: "برگشت", saveWithCtrlS: "با Ctrl+S ذخیره کنید",
    seconds: (n) => n + " ثانیه", pages: (n) => n + " صفحه", nErrors: (n) => n + " خطا", noErrors: "بدون خطا",
    line: (n) => "خط " + n, noSource: "منبعی برای این نقطه پیدا نشد", lineStale: "خط بر اساس آخرین کامپایل است",
    lineNotFound: "این خط در PDF پیدا نشد (کامپایل کنید)", pageOf: (a, b) => "صفحهٔ " + a + " از " + b,
    pickVersion: "یک نسخه را انتخاب کنید (قرمز = نسخهٔ قدیمی، سبز = متن فعلی)", noVersions: "هنوز نسخه‌ای نیست",
    unchangedLines: (n) => "⋯ " + n + " خط بدون تغییر", sameText: "این نسخه با متن فعلی یکی است.",
    restored: "نسخه بارگذاری شد؛ برای ثبت ذخیره کنید", suggestion: "پیشنهاد: ", toggleLang: "EN",
    cmPhrases: { "Find": "جستجو", "Replace": "جایگزین", "next": "بعدی", "previous": "قبلی", "all": "همه",
      "match case": "حساس به حروف", "regexp": "عبارت منظم", "by word": "کلمهٔ کامل", "replace": "جایگزینی",
      "replace all": "جایگزینی همه", "close": "بستن", "Go to line": "رفتن به خط", "go": "برو" },
  },
};
let lang = "en";
const tr = (k, ...a) => { const v = (I18N[lang] || I18N.en)[k]; return typeof v === "function" ? v(...a) : (v == null ? k : v); };
const num = (n) => lang === "fa" ? String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]) : String(n);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let NAMES = {};          // file name -> display name (from the project config)
let appTitle = "";
const cmPhrases = {};    // one shared object: CodeMirror reads it on every lookup, so switching language updates the search panel

async function api(path, opts) {
  const r = await fetch(path, opts);
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, data: j };
}
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

/* ------------------------------------------------------------------ language */
function applyLang(l, rerender) {
  lang = I18N[l] ? l : "en";
  const root = document.documentElement;
  root.setAttribute("lang", lang); root.setAttribute("dir", lang === "fa" ? "rtl" : "ltr");
  for (const k of Object.keys(cmPhrases)) delete cmPhrases[k];
  Object.assign(cmPhrases, I18N[lang].cmPhrases);
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  $("btnLang").textContent = tr("toggleLang");
  $("appTitle").textContent = appTitle; document.title = appTitle;
  $("histInfo").textContent = tr("pickVersion");
  if (rerender) {
    renderFiles(); updateEditorHead(); renderBanner(); updatePageInfo();
    if (lastStatus) { setCompileUI(lastStatus); renderErrors(lastStatus); }
    if (pv.doc) $("zLabel").textContent = num(Math.round(pv.scale * 100)) + (lang === "fa" ? "٪" : "%");
  }
}
$("btnLang").onclick = () => { applyLang(lang === "fa" ? "en" : "fa", true); store.set("lang", lang); };

/* ------------------------------------------------------------------ theme */
function applyTheme(v) { if (v) document.documentElement.setAttribute("data-theme", v); else document.documentElement.removeAttribute("data-theme"); }
applyTheme(store.get("theme", ""));
$("btnTheme").onclick = () => {
  const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const v = dark ? "light" : "dark"; store.set("theme", v); applyTheme(v);
};

/* ------------------------------------------------------------------ phrase hints */
let phrases = [];
let lintOn = true;
const refreshLint = StateEffect.define();
const flashEffect = StateEffect.define();

function buildMatchers() {
  return phrases.map((p) => {
    let re;
    try { re = new RegExp(p.re ? p.pattern : p.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gu"); } catch { return null; }
    return { re, hint: p.hint || "" };
  }).filter(Boolean);
}
let matchers = [];
function findMatches(text, offset) {
  const out = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    let x;
    while ((x = m.re.exec(text)) !== null) {
      if (x[0].length === 0) { m.re.lastIndex++; continue; }
      out.push({ from: offset + x.index, to: offset + x.index + x[0].length, hint: m.hint });
    }
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}
const lintMark = Decoration.mark({ class: "cm-lint-phrase" });
const lintPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decos = this.build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLint)))) this.decos = this.build(u.view);
  }
  build(view) {
    if (!lintOn || !matchers.length) return Decoration.none;
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      const a = view.state.doc.lineAt(from).from, b = view.state.doc.lineAt(to).to;
      for (const m of findMatches(view.state.doc.sliceString(a, b), a)) ranges.push(lintMark.range(m.from, m.to));
    }
    return Decoration.set(ranges, true);
  }
}, { decorations: (v) => v.decos });
const lintTooltip = hoverTooltip((view, pos) => {
  if (!lintOn) return null;
  const line = view.state.doc.lineAt(pos);
  const hit = findMatches(line.text, line.from).filter((m) => m.from <= pos && pos <= m.to);
  if (!hit.length) return null;
  return { pos: hit[0].from, end: hit[0].to, above: true, create() {
    const d = document.createElement("div");
    d.textContent = tr("suggestion") + hit.map((h) => h.hint).join(" — ");
    return { dom: d };
  } };
}, { hoverTime: 250 });

/* ------------------------------------------------------------------ per-line direction */
// A line is right-to-left when its Persian letters outnumber its Latin ones. LaTeX command names and the arguments of
// \label / \ref / \cite / \lr / \includegraphics ... do not count, so "\item ربات باید ..." reads RTL and "\section{...}" with a
// Persian title reads RTL too, while pure markup lines stay LTR.
const RTL_CH = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const LTR_CH = /[A-Za-z]/g;
function lineDir(text) {
  const s = text.replace(/(^|[^\\])%.*$/, "$1")
    .replace(/\\(label|ref|eqref|pageref|cite|citep|citet|includegraphics|input|include|lr|url|href|textlatin)\*?\s*(\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\\[A-Za-z@]+\*?/g, " ");
  const r = (s.match(RTL_CH) || []).length, l = (s.match(LTR_CH) || []).length;
  return r > 0 && r >= l ? "rtl" : "ltr";
}
const dirDeco = { rtl: Decoration.line({ attributes: { dir: "rtl" } }), ltr: Decoration.line({ attributes: { dir: "ltr" } }) };
const dirPlugin = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = this.build(v); }
  update(u) { if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view); }
  build(v) {
    const out = [];
    for (const { from, to } of v.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = v.state.doc.lineAt(pos);
        out.push(dirDeco[lineDir(line.text)].range(line.from));
        pos = line.to + 1;
      }
    }
    return Decoration.set(out, true);
  }
}, { decorations: (p) => p.decorations });
// inside a right-to-left line, keep every \command one left-to-right unit (otherwise the backslash shows at the wrong end)
const cmdMatcher = new MatchDecorator({ regexp: /\\[A-Za-z@]+\*?/g, decoration: Decoration.mark({ class: "cm-cmd" }) });
const cmdPlugin = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = cmdMatcher.createDeco(v); }
  update(u) { this.decorations = cmdMatcher.updateDeco(u, this.decorations); }
}, { decorations: (p) => p.decorations });

/* ------------------------------------------------------------------ flash line */
const flashField = StateField.define({
  create: () => Decoration.none,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(flashEffect)) {
      if (e.value == null) return Decoration.none;
      const l = tr.state.doc.lineAt(Math.min(e.value, tr.state.doc.length));
      return Decoration.set([Decoration.line({ class: "cm-flash" }).range(l.from)]);
    }
    return tr.docChanged ? v.map(tr.changes) : v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ------------------------------------------------------------------ editor */
const hl = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword], color: "var(--tok-kw)" },
  { tag: [t.string, t.special(t.string)], color: "var(--tok-str)" },
  { tag: [t.comment], color: "var(--tok-com)", fontStyle: "italic" },
  { tag: [t.number, t.atom], color: "var(--tok-num)" },
  { tag: [t.tagName, t.typeName, t.definition(t.variableName), t.className], color: "var(--tok-def)" },
  { tag: [t.bracket, t.punctuation, t.meta], color: "var(--tok-com)" },
]);
const files = new Map();   // name -> {name, state, savedDoc, sha, eol, diskSha, diskChanged, conflict, loaded}
let current = null;
let order = [];
let view;

function isDirty(f) {
  if (!f) return false;
  const doc = f === current ? view.state.doc : f.state.doc;
  return !doc.eq(f.savedDoc);
}
function extensions() {
  return [
    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(),
    EditorView.lineWrapping, EditorView.perLineTextDirection.of(true), dirPlugin, cmdPlugin,
    EditorState.phrases.of(cmPhrases),
    StreamLanguage.define(stex), syntaxHighlighting(hl),
    search({ top: true }), highlightSelectionMatches(),
    lintPlugin, lintTooltip, flashField,
    Prec.highest(keymap.of([
      { key: "Mod-s", run: () => { saveCurrent(false); return true; }, preventDefault: true },
      { key: "Mod-Enter", run: () => { saveCurrent(true); return true; }, preventDefault: true },
      { key: "Mod-j", run: () => { showInPdf(); return true; }, preventDefault: true },
      { key: "Mod-h", run: (v) => { openSearchPanel(v); return true; }, preventDefault: true },
    ])),
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => { if (u.docChanged || u.selectionSet) updateEditorHead(); if (u.docChanged) renderFiles(); }),
  ];
}
function makeState(text, f) {
  return EditorState.create({ doc: text, extensions: extensions() });
}
view = new EditorView({ state: EditorState.create({ doc: "", extensions: extensions() }), parent: $("cm") });

function updateEditorHead() {
  if (!current) return;
  $("curName").textContent = (NAMES[current.name] ? NAMES[current.name] + " — " : "") + current.name;
  $("curDirty").classList.toggle("hidden", !isDirty(current));
  const ln = view.state.doc.lineAt(view.state.selection.main.head).number;
  $("curMeta").textContent = tr("line", num(ln)) + " · " + current.eol;
}

async function loadFile(name) {
  const r = await api("/api/file?path=" + encodeURIComponent(name));
  if (!r.ok) { toast(tr("readFail")); return null; }
  const d = r.data;
  const state = makeState(d.content);
  const f = files.get(name) || { name };
  Object.assign(f, { state, savedDoc: state.doc, sha: d.sha256, diskSha: d.sha256, eol: d.eol, diskChanged: false, conflict: null, loaded: true });
  files.set(name, f);
  return f;
}
async function openFile(name, line) {
  if (!files.has(name)) files.set(name, { name, loaded: false, eol: "" });
  let f = files.get(name);
  if (!f.loaded) { f = await loadFile(name); if (!f) return; }
  if (current && current !== f) current.state = view.state;
  current = f;
  view.setState(f.state);
  store.set("lastFile:" + appTitle, name);
  renderFiles(); updateEditorHead(); renderBanner();
  if (line) gotoLine(line);
  else view.focus();
}
function gotoLine(n) {
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(n, doc.lines)));
  view.dispatch({ selection: { anchor: l.from }, effects: [EditorView.scrollIntoView(l.from, { y: "center" }), flashEffect.of(l.from)] });
  view.focus();
  clearTimeout(gotoLine._t);
  gotoLine._t = setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 1600);
}
function replaceDoc(text, keepLine) {
  const old = view.state.doc;
  const ln = old.lineAt(view.state.selection.main.head).number;
  view.dispatch({ changes: { from: 0, to: old.length, insert: text } });
  const doc = view.state.doc;
  const l = doc.line(Math.min(ln, doc.lines));
  if (keepLine) view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
}

/* ------------------------------------------------------------------ file list */
function renderFiles() {
  const ul = $("fileList"); ul.textContent = "";
  for (const name of order) {
    const f = files.get(name);
    const li = document.createElement("li");
    if (current && current.name === name) li.classList.add("active");
    const fn = document.createElement("span"); fn.className = "fn"; fn.textContent = NAMES[name] || name;
    const sm = document.createElement("span"); sm.className = "fsmall"; sm.textContent = name;
    li.append(fn, sm);
    const sp = document.createElement("span"); sp.className = "grow"; li.append(sp);
    if (f && f.loaded && isDirty(f)) { const d = document.createElement("span"); d.className = "dot unsaved"; d.title = tr("unsaved"); li.append(d); }
    if (f && f.diskChanged) { const d = document.createElement("span"); d.className = "dot disk"; d.title = tr("diskChanged"); li.append(d); }
    li.onclick = () => openFile(name);
    ul.append(li);
  }
}

/* ------------------------------------------------------------------ save / conflicts */
async function saveCurrent(thenCompile) {
  const f = current; if (!f) return;
  if (f.conflict) { toast(tr("conflictFirst")); return; }
  const content = view.state.doc.toString();
  if (!isDirty(f)) { if (thenCompile || $("chkOnSave").checked) compile(); else toast(tr("nothingToSave")); return; }
  const r = await api("/api/file", { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: f.name, content, base_sha256: f.sha }) });
  if (r.status === 409) {
    f.conflict = { content: r.data.content, sha: r.data.sha256, stage: 0 }; f.diskChanged = true;
    renderBanner(); renderFiles(); return;
  }
  if (!r.ok) { toast(tr("saveFail") + ((r.data && r.data.error) || r.status)); return; }
  f.sha = r.data.sha256; f.diskSha = r.data.sha256; f.savedDoc = view.state.doc; f.diskChanged = false;
  renderFiles(); updateEditorHead(); toast(tr("saved"));
  if (thenCompile || $("chkOnSave").checked) compile();
}
function renderBanner() {
  const b = $("banner"); const f = current;
  if (!f || !f.conflict) { b.classList.add("hidden"); b.textContent = ""; return; }
  b.classList.remove("hidden"); b.textContent = "";
  const msg = document.createElement("span");
  const mk = (label, fn, cls) => { const x = document.createElement("button"); x.className = "btn sm " + (cls || ""); x.textContent = label; x.onclick = fn; return x; };
  if (f.conflict.stage === 0) {
    msg.textContent = tr("conflict0");
    b.append(msg,
      mk(tr("loadDisk"), () => { const c = f.conflict; f.conflict = null; f.sha = c.sha; f.diskSha = c.sha; f.diskChanged = false;
        replaceDoc(c.content, true); f.savedDoc = view.state.doc; renderBanner(); renderFiles(); updateEditorHead(); }),
      mk(tr("keepMine"), () => { f.conflict.stage = 1; renderBanner(); }));
  } else {
    msg.textContent = tr("conflict1");
    b.append(msg,
      mk(tr("yesKeep"), () => { f.sha = f.conflict.sha; f.diskSha = f.conflict.sha; f.conflict = null; renderBanner(); toast(tr("saveWithCtrlS")); }, "primary"),
      mk(tr("back"), () => { f.conflict.stage = 0; renderBanner(); }));
  }
}

/* ------------------------------------------------------------------ external-change polling */
async function pollChanges() {
  try {
    const r = await api("/api/changes");
    if (!r.ok) return;
    const list = r.data.files;
    const names = list.map((x) => x.name);
    if (names.join("|") !== order.join("|")) { order = names; renderFiles(); }
    for (const x of list) {
      const f = files.get(x.name);
      if (f && !f.loaded && f.diskSha !== x.sha256) { f.diskSha = x.sha256; f.diskChanged = true; renderFiles(); continue; }
      if (!f || !f.loaded || f.diskSha === x.sha256) continue;
      if (f.conflict && f.conflict.sha === x.sha256) continue;
      if (!isDirty(f)) {
        const d = await api("/api/file?path=" + encodeURIComponent(x.name));
        if (!d.ok) continue;
        if (f === current) { replaceDoc(d.data.content, true); f.savedDoc = view.state.doc; }
        else { f.state = EditorState.create({ doc: d.data.content, extensions: extensions() }); f.savedDoc = f.state.doc; }
        f.sha = d.data.sha256; f.diskSha = d.data.sha256; f.eol = d.data.eol; f.diskChanged = false;
      } else {
        const d = await api("/api/file?path=" + encodeURIComponent(x.name));
        if (!d.ok) continue;
        f.diskChanged = true; f.conflict = { content: d.data.content, sha: d.data.sha256, stage: 0 };
        if (f === current) renderBanner();
      }
      renderFiles();
    }
  } catch {}
}
setInterval(pollChanges, 2000);

/* ------------------------------------------------------------------ compile */
let compTimer = null;
async function compile() {
  $("compileStatus").className = "cstatus run";
  await api("/api/compile", { method: "POST" });
  pollCompile();
}
let lastStatus = null;
function setCompileUI(s) {
  lastStatus = s;
  const running = s.state === "running";
  $("spin").classList.toggle("hidden", !running);
  $("compileLabel").textContent = running ? tr("compiling") : tr("compile");
  const el = $("compileStatus");
  if (running) { el.className = "cstatus run"; el.textContent = tr("seconds", num(Math.floor(s.seconds))); }
  else if (s.state === "ok") { el.className = "cstatus ok"; el.textContent = "✓ " + tr("pages", s.pages ? num(s.pages) : "?"); }
  else if (s.state === "error") { el.className = "cstatus err"; el.textContent = "✗ " + tr("nErrors", num(s.errors.length)); }
  else { el.className = "cstatus"; el.textContent = ""; }
}
function renderErrors(s) {
  const ul = $("errList"); ul.textContent = "";
  for (const e of s.errors) {
    const li = document.createElement("li");
    const loc = document.createElement("span"); loc.className = "loc"; loc.textContent = e.file ? e.file + ":" + e.line : "—";
    const msg = document.createElement("span"); msg.className = "msg"; msg.textContent = e.message;
    li.append(loc, msg);
    if (e.file && order.includes(e.file)) li.onclick = () => openFile(e.file, e.line);
    ul.append(li);
  }
  $("logTail").textContent = s.log_tail || "";
  $("drawerCount").textContent = s.state === "ok" ? tr("noErrors") : tr("nErrors", num(s.errors.length));
}
function pollCompile() {
  clearTimeout(compTimer);
  const tick = async () => {
    const r = await api("/api/compile/status");
    if (!r.ok) { compTimer = setTimeout(tick, 1000); return; }
    setCompileUI(r.data); renderErrors(r.data);
    if (r.data.state === "running" || r.data.queued) { compTimer = setTimeout(tick, 700); return; }
    if (r.data.state === "error") $("drawer").classList.remove("collapsed");
    if (r.data.state === "ok") $("drawer").classList.add("collapsed");
    loadPdf();
  };
  tick();
}
$("btnCompile").onclick = () => saveCurrent(true);
$("btnSave").onclick = () => saveCurrent(false);
$("compileStatus").onclick = () => $("drawer").classList.remove("collapsed");
$("drawerBar").onclick = () => $("drawer").classList.toggle("collapsed");
$("chkLint").onchange = (e) => { lintOn = e.target.checked; store.set("lint", lintOn ? "1" : "0"); view.dispatch({ effects: refreshLint.of(null) }); };

/* ------------------------------------------------------------------ PDF viewer */
const pv = { doc: null, pages: [], scale: 1, fit: true, baseW: 612, rendering: new Map(), gen: 0 };
const scroller = $("pdfScroll"), pagesEl = $("pdfPages");

function fitScale() { return Math.max(0.3, (scroller.clientWidth - 40) / pv.baseW); }
function setScale(s, fit) {
  const frac = scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0;
  pv.fit = !!fit; pv.scale = Math.min(5, Math.max(0.3, s));
  layoutPages(); scroller.scrollTop = frac * scroller.scrollHeight; renderVisible();
  $("zLabel").textContent = num(Math.round(pv.scale * 100)) + (lang === "fa" ? "٪" : "%");
}
function layoutPages() {
  for (const p of pv.pages) {
    p.el.style.width = Math.round(p.w * pv.scale) + "px"; p.el.style.height = Math.round(p.h * pv.scale) + "px";
    if (p.canvas) { p.canvas.remove(); p.canvas = null; p.renderedScale = 0; }
  }
}
async function loadPdf() {
  const keepTop = scroller.scrollTop, keepScale = pv.fit ? null : pv.scale;
  let doc;
  try { doc = await pdfjs.getDocument({ url: "/pdf?t=" + Date.now() }).promise; }
  catch { $("pdfEmpty").classList.toggle("hidden", !!pv.doc); return; }
  const gen = ++pv.gen;
  const sizes = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1).then((p) => { const v = p.getViewport({ scale: 1 }); return { page: p, w: v.width, h: v.height }; })));
  if (gen !== pv.gen) return;
  if (pv.doc) pv.doc.destroy();
  pv.doc = doc; pv.baseW = sizes[0].w;
  $("pdfEmpty").classList.add("hidden");
  const frag = document.createDocumentFragment();
  pv.pages = sizes.map((s, i) => {
    const el = document.createElement("div"); el.className = "pg"; el.dataset.page = i + 1;
    el.ondblclick = (ev) => onPdfDbl(ev, i + 1, el);
    frag.append(el);
    return { n: i + 1, page: s.page, w: s.w, h: s.h, el, canvas: null, renderedScale: 0 };
  });
  pagesEl.textContent = ""; pagesEl.append(frag);
  pv.scale = keepScale || fitScale();
  layoutPages(); scroller.scrollTop = keepTop; renderVisible();
  $("zLabel").textContent = num(Math.round(pv.scale * 100)) + (lang === "fa" ? "٪" : "%");
  updatePageInfo();
}
function visiblePages() {
  const top = scroller.scrollTop, bot = top + scroller.clientHeight;
  const base = pagesEl.offsetTop;
  let first = -1, last = -1;
  pv.pages.forEach((p, i) => {
    const y0 = p.el.offsetTop - base + 12, y1 = y0 + p.el.offsetHeight;
    if (y1 >= top && y0 <= bot) { if (first < 0) first = i; last = i; }
  });
  return [first, last];
}
function renderVisible() {
  if (!pv.pages.length) return;
  let [a, b] = visiblePages(); if (a < 0) { a = 0; b = 0; }
  const lo = Math.max(0, a - 2), hi = Math.min(pv.pages.length - 1, b + 2);
  pv.pages.forEach((p, i) => {
    if (i >= lo && i <= hi) renderPage(p);
    else if (p.canvas && (i < lo - 4 || i > hi + 4)) { p.canvas.remove(); p.canvas = null; p.renderedScale = 0; }
  });
  updatePageInfo();
}
async function renderPage(p) {
  if (p.renderedScale === pv.scale || p.busy === pv.scale) return;
  p.busy = pv.scale;
  const scale = pv.scale, dpr = window.devicePixelRatio || 1;
  const vp = p.page.getViewport({ scale: scale * dpr });
  const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  try { await p.page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; } catch { p.busy = 0; return; }
  if (scale !== pv.scale) { p.busy = 0; return; }
  if (p.canvas) p.canvas.remove();
  p.el.prepend(c); p.canvas = c; p.renderedScale = scale; p.busy = 0;
}
function updatePageInfo() {
  if (!pv.pages.length) { $("pageInfo").textContent = ""; return; }
  const [a] = visiblePages();
  $("pageInfo").textContent = tr("pageOf", num(Math.max(1, a + 1)), num(pv.pages.length));
}
let scTimer; scroller.addEventListener("scroll", () => { clearTimeout(scTimer); scTimer = setTimeout(renderVisible, 60); });
new ResizeObserver(() => { if (pv.fit && pv.pages.length) { const s = fitScale(); if (Math.abs(s - pv.scale) > 0.01) setScale(s, true); } }).observe(scroller);
$("zIn").onclick = () => setScale(pv.scale * 1.15, false);
$("zOut").onclick = () => setScale(pv.scale / 1.15, false);
$("zFit").onclick = () => setScale(fitScale(), true);

async function onPdfDbl(ev, page, el) {
  const r = el.getBoundingClientRect();
  const x = (ev.clientX - r.left) / pv.scale, y = (ev.clientY - r.top) / pv.scale;
  const res = await api("/api/synctex/edit?page=" + page + "&x=" + x.toFixed(2) + "&y=" + y.toFixed(2));
  if (!res.ok) { toast(tr("noSource")); return; }
  await openFile(res.data.file, res.data.line);
}
async function showInPdf() {
  if (!current) return;
  const ln = view.state.doc.lineAt(view.state.selection.main.head).number;
  if (isDirty(current)) toast(tr("lineStale"));
  const res = await api("/api/synctex/view?file=" + encodeURIComponent(current.name) + "&line=" + ln);
  const good = res.ok ? res.data.boxes.filter((x) => x.W > 0 && x.H > 0 && x.W < 700) : [];
  if (!good.length) { toast(tr("lineNotFound")); return; }
  const b = good[0];
  const p = pv.pages[b.page - 1]; if (!p) return;
  const top = b.v - b.H;
  scroller.scrollTop = p.el.offsetTop - pagesEl.offsetTop + top * pv.scale - scroller.clientHeight / 2 + 12;
  renderVisible();
  document.querySelectorAll(".pg .box").forEach((x) => x.remove());
  for (const bx of good.filter((x) => x.page === b.page)) {
    const d = document.createElement("div"); d.className = "box";
    d.style.left = (bx.h * pv.scale - 2) + "px"; d.style.top = ((bx.v - bx.H) * pv.scale - 2) + "px";
    d.style.width = (bx.W * pv.scale + 4) + "px"; d.style.height = (bx.H * pv.scale + 4) + "px";
    p.el.append(d); setTimeout(() => d.remove(), 2000);
  }
}
$("btnShow").onclick = showInPdf;

/* ------------------------------------------------------------------ history */
let histSel = null;
function lineDiff(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length; while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb), n = A.length, m = B.length;
  const out = a.slice(0, s).map((x) => ["=", x]);
  if (n * m > 6e6) { A.forEach((x) => out.push(["-", x])); B.forEach((x) => out.push(["+", x])); }
  else {
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push(["=", A[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", A[i++]]); else out.push(["+", B[j++]]);
    }
    while (i < n) out.push(["-", A[i++]]); while (j < m) out.push(["+", B[j++]]);
  }
  a.slice(ea).forEach((x) => out.push(["=", x]));
  return out;
}
function renderDiff(oldText, curText) {
  const d = lineDiff(oldText.split("\n"), curText.split("\n"));
  const pre = $("histDiff"); pre.textContent = "";
  let ctx = 0, hidden = 0;
  d.forEach((x, i) => {
    const near = d.slice(Math.max(0, i - 2), i + 3).some((y) => y[0] !== "=");
    if (x[0] === "=" && !near) { hidden++; return; }
    if (hidden) { const g = document.createElement("span"); g.className = "ctx"; g.textContent = tr("unchangedLines", num(hidden)); pre.append(g); hidden = 0; }
    const s = document.createElement("span"); s.className = x[0] === "+" ? "add" : x[0] === "-" ? "del" : "ctx";
    s.textContent = (x[0] === "=" ? "  " : x[0] + " ") + x[1]; pre.append(s);
  });
  if (!d.some((x) => x[0] !== "=")) pre.textContent = tr("sameText");
}
$("btnHistory").onclick = async () => {
  if (!current) return;
  const r = await api("/api/history?path=" + encodeURIComponent(current.name));
  const ul = $("histList"); ul.textContent = ""; histSel = null;
  $("histRestore").classList.add("hidden"); $("histDiff").textContent = ""; $("histInfo").textContent = tr("pickVersion");
  const vs = (r.data && r.data.versions) || [];
  if (!vs.length) { const li = document.createElement("li"); li.textContent = tr("noVersions"); ul.append(li); }
  for (const v of vs) {
    const li = document.createElement("li");
    li.textContent = v.ts.replace(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d).*/, "$1-$2-$3  $4:$5:$6");
    li.onclick = async () => {
      ul.querySelectorAll("li").forEach((x) => x.classList.remove("active")); li.classList.add("active");
      const h = await api("/api/history/file?path=" + encodeURIComponent(current.name) + "&ts=" + v.ts);
      if (!h.ok) return;
      histSel = h.data.content; renderDiff(histSel, view.state.doc.toString());
      $("histRestore").classList.remove("hidden"); $("histInfo").textContent = "";
    };
    ul.append(li);
  }
  $("histPanel").classList.remove("hidden");
};
$("histClose").onclick = () => $("histPanel").classList.add("hidden");
$("histPanel").onclick = (e) => { if (e.target === $("histPanel")) $("histPanel").classList.add("hidden"); };
$("histRestore").onclick = () => {
  if (histSel == null) return;
  replaceDoc(histSel, true); $("histPanel").classList.add("hidden"); toast(tr("restored"));
};

/* ------------------------------------------------------------------ resizers */
document.querySelectorAll(".resizer").forEach((rz) => {
  const target = $(rz.dataset.target);
  rz.onmousedown = (e) => {
    e.preventDefault(); rz.classList.add("drag");
    const startX = e.clientX, startW = target.getBoundingClientRect().width, left = rz.dataset.side === "left";
    const mv = (ev) => {
      const dx = ev.clientX - startX, w = Math.max(120, startW + (left ? dx : -dx));
      target.style.flex = "none"; target.style.width = w + "px";
    };
    const up = () => { rz.classList.remove("drag"); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); store.set("w-" + rz.dataset.target, target.style.width); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  };
  const w = store.get("w-" + rz.dataset.target, ""); if (w) { target.style.flex = "none"; target.style.width = w; }
});

/* ------------------------------------------------------------------ global keys, unload, init */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveCurrent(false); }
  else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); saveCurrent(true); }
  else if ((e.ctrlKey || e.metaKey) && e.key === "j") { e.preventDefault(); showInPdf(); }
});
window.addEventListener("beforeunload", (e) => { if ([...files.values()].some((f) => f.loaded && isDirty(f))) { e.preventDefault(); e.returnValue = ""; } });
$("drawerArrow").textContent = "▲";

async function init() {
  lintOn = store.get("lint", "1") === "1"; $("chkLint").checked = lintOn;
  $("chkOnSave").checked = store.get("onSave", "0") === "1";
  $("chkOnSave").onchange = (e) => store.set("onSave", e.target.checked ? "1" : "0");
  const cr = await api("/api/config");
  const cfg = cr.ok ? cr.data : { title: "RTL LaTeX Live Editor", ui: "en", names: {} };
  NAMES = cfg.names || {};
  appTitle = cfg.title || "RTL LaTeX Live Editor";
  applyLang(store.get("lang", cfg.ui || "en"), false);
  const [pr, fr] = await Promise.all([api("/api/phrases"), api("/api/files")]);
  if (pr.ok) { phrases = pr.data; matchers = buildMatchers(); }
  if (fr.ok) {
    order = fr.data.files.map((x) => x.name);
    for (const x of fr.data.files) files.set(x.name, { name: x.name, loaded: false, eol: "", diskSha: x.sha256 });
  }
  renderFiles();
  const last = store.get("lastFile:" + (cfg.title || ""), "");
  if (order.length) await openFile(order.includes(last) ? last : order[0]);
  for (const f of files.values()) if (!f.loaded) f.diskSha = f.diskSha;   // not loaded: nothing to compare yet
  const st = await api("/api/compile/status");
  if (st.ok) { setCompileUI(st.data); renderErrors(st.data); if (st.data.state === "running") pollCompile(); }
  loadPdf();
}
init();
window.__editor = { get view() { return view; }, openFile, showInPdf, gotoLine, files, pv };
