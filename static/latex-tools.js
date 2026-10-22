// Pure helpers (no DOM, no CodeMirror) used by the dialogs, the toolbar and the completion code.
// selftest.py runs the checks at the bottom of this list through node when node is installed.

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".pdf", ".svg", ".eps"];

export function extOf(path) {
  const m = /\.[^./\\]+$/.exec(String(path || ""));
  return m ? m[0].toLowerCase() : "";
}
export const isImagePath = (p) => IMAGE_EXTS.includes(extOf(p));

/* ------------------------------------------------------------------ direction of a source line */
// A line is right-to-left when its Persian letters outnumber its Latin ones. LaTeX command names and the arguments of
// \label / \ref / \cite / \lr / \includegraphics ... do not count, so "\item ربات باید ..." reads RTL and "\section{...}" with a
// Persian title reads RTL too, while pure markup lines stay LTR.
const RTL_CH = /[֐-ࣿיִ-﷿ﹰ-﻿]/g;
const LTR_CH = /[A-Za-z]/g;
export function lineDir(text) {
  const s = String(text).replace(/(^|[^\\])%.*$/, "$1")
    .replace(/\\(label|ref|eqref|pageref|cite|citep|citet|includegraphics|input|include|lr|url|href|textlatin)\*?\s*(\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\\[A-Za-z@]+\*?/g, " ");
  const r = (s.match(RTL_CH) || []).length, l = (s.match(LTR_CH) || []).length;
  return r > 0 && r >= l ? "rtl" : "ltr";
}
// One left-to-right unit inside a right-to-left line: a \command plus the [..] / {..} groups right after it that hold no
// Persian letters ("\lr{Gemma 4}", "\cite{key}", "\includegraphics[width=0.5\textwidth]{figs/a.png}"). A group with Persian
// text ("\textbf{متن}") stays outside the unit, so it still reads right to left.
const NOT_RTL = "[^\\[\\]{}\\n\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF]*";
export const CMD_UNIT = new RegExp("\\\\[A-Za-z@]+\\*?(?:\\[" + NOT_RTL + "\\]|\\{" + NOT_RTL + "\\})*", "g");
// pieces of a line with every command unit marked, so a viewer can keep each one left-to-right
export function cmdSegments(text) {
  const out = [], re = new RegExp(CMD_UNIT.source, "g");
  let last = 0, m;
  const s = String(text);
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ cmd: false, text: s.slice(last, m.index) });
    out.push({ cmd: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ cmd: false, text: s.slice(last) });
  return out;
}

/* ------------------------------------------------------------------ escaping and slugs */
const ESC = { "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", "$": "\\$", "#": "\\#", "_": "\\_",
  "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };
export function escapeLatex(s) {
  return String(s ?? "").replace(/[\\&%$#_{}~^]/g, (c) => ESC[c]);
}

// ASCII slug for labels and keys: "My Plot (v2).png" -> "my-plot-v2"; Persian text gives "".
export function slugify(s, max = 40) {
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");
}
export function stemOf(path) {
  const base = String(path || "").split("/").pop();
  return base.replace(/\.[^.]+$/, "");
}
export function uniqueLabel(base, taken) {
  const has = (k) => (taken instanceof Set ? taken.has(k) : (taken || []).includes(k));
  if (!has(base)) return base;
  for (let n = 2; ; n++) if (!has(base + "-" + n)) return base + "-" + n;
}

// A short caption for the list of figures: the first sentence, or the first words, never cut inside {...}.
export function shortCaption(caption, maxWords = 8) {
  const s = String(caption ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  let depth = 0, words = 0, cut = s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") { i++; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[.:;؛!?؟]/.test(c) && (i + 1 === s.length || s[i + 1] === " ") && i > 0) { cut = i; break; }
    else if (depth === 0 && c === " ") { words++; if (words >= maxWords) { cut = i; break; } }
  }
  return s.slice(0, cut).replace(/[\s،,;؛:.]+$/, "");
}

/* ------------------------------------------------------------------ spreadsheet paste -> rows */
export function parseDelimited(text) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!src.trim()) return [];
  const first = src.split("\n")[0];
  const delim = src.includes("\t") ? "\t" : ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",");
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
      continue;
    }
    if (c === '"' && cell === "") { inQ = true; continue; }
    if (c === delim) { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += c;
  }
  row.push(cell); rows.push(row);
  const n = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.concat(Array(n - r.length).fill("")).map((x) => x.replace(/\s*\n\s*/g, " ").trim()));
}

/* ------------------------------------------------------------------ environments */
const CUR = "\u0001";     // cursor marker understood by the editor's insertBlock
export const CURSOR = CUR;

function captionLine(caption, short) {
  const c = String(caption ?? "").trim(), s = String(short ?? "").trim();
  if (!c) return "\\caption{" + CUR + "}";
  return s ? "\\caption[" + s + "]{" + c + "}" : "\\caption{" + c + "}";
}
function widthArg(w) {
  const x = Math.round(Number(w) * 100) / 100;
  return !x || x >= 1 ? "\\textwidth" : String(x) + "\\textwidth";
}
// \begin{figure}...\end{figure} in the thesis style: [tbp], \centering, \caption[short]{long}, \label{fig:...}
export function buildFigure(o) {
  const path = String(o.path || "");
  const svg = extOf(path) === ".svg";
  const inc = svg ? "\\includesvg[width=" + widthArg(o.width) + "]{" + path.replace(/\.svg$/i, "") + "}"
                  : "\\includegraphics[width=" + widthArg(o.width) + "]{" + path + "}";
  const place = String(o.placement ?? "tbp").replace(/[\[\]\s]/g, "");
  const lines = ["\\begin{figure}" + (place ? "[" + place + "]" : "")];
  if (o.center !== false) lines.push("\\centering");
  lines.push(inc, captionLine(o.caption, o.short));
  if (o.label) lines.push("\\label{" + o.label + "}");
  lines.push("\\end{figure}");
  return lines.join("\n");
}

export function buildTabular(rows, o = {}) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const esc = o.escape ? escapeLatex : (x) => String(x ?? "");
  const rule = (k) => (o.booktabs === false ? "\\hline" : ["\\toprule", "\\midrule", "\\bottomrule"][k]);
  const out = ["\\begin{tabular}{" + (o.align || "c").repeat(cols) + "}", rule(0)];
  rows.forEach((r, i) => {
    out.push(Array.from({ length: cols }, (_, j) => esc(r[j] ?? "")).join(" & ") + " \\\\");
    if (i === 0 && o.header && rows.length > 1) out.push(rule(1));
  });
  out.push(rule(2), "\\end{tabular}");
  return out;
}
export function emptyRows(r, c) {
  return Array.from({ length: Math.max(1, r) }, () => Array(Math.max(1, c)).fill(""));
}
// table environment; with empty cells the cursor goes to the first cell
export function buildTable(o) {
  const rows = o.rows && o.rows.length ? o.rows : emptyRows(o.nrows || 2, o.ncols || 2);
  const place = String(o.placement ?? "tbp").replace(/[\[\]\s]/g, "");
  const lines = ["\\begin{table}" + (place ? "[" + place + "]" : "")];
  if (o.center !== false) lines.push("\\centering");
  lines.push(captionLine(o.caption, o.short));
  if (o.label) lines.push("\\label{" + o.label + "}");
  const tab = buildTabular(rows, o);
  const empty = rows.every((r) => r.every((x) => !String(x).trim()));
  if (empty && String(o.caption ?? "").trim()) tab[2] = CUR + tab[2];
  lines.push(...tab, "\\end{table}");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ editing plans (applied by the editor) */
// What a wrap button does: remove the wrapper around the selection, remove it from inside the selection, or add it.
export function wrapPlan(before, sel, after, open, close) {
  if (before.endsWith(open) && after.startsWith(close)) return "unwrap-outer";
  if (sel.length >= open.length + close.length && sel.startsWith(open) && sel.endsWith(close)) return "unwrap-inner";
  return "wrap";
}
// Ctrl+/ on a set of lines: [{i, op: "add"|"remove", at, len}] (at = column, len = chars to remove)
export function commentPlan(lines) {
  const nonEmpty = lines.map((l, i) => [l, i]).filter(([l]) => l.trim());
  const all = nonEmpty.length > 0 && nonEmpty.every(([l]) => /^\s*%/.test(l));
  const out = [];
  lines.forEach((l, i) => {
    if (all) { const m = /^(\s*)% ?/.exec(l); if (m) out.push({ i, op: "remove", at: m[1].length, len: m[0].length - m[1].length }); }
    else if (l.trim() || lines.length === 1) out.push({ i, op: "add", at: 0, len: 0 });
  });
  return out;
}

/* ------------------------------------------------------------------ completion context */
const REF_CMDS = "ref|eqref|autoref|cref|Cref|pageref|nameref|vref|Vref|cpageref|Cpageref|labelcref|crefrange|Crefrange|subref";
// What the text before the cursor asks to complete: {kind, prefix, cmd} or null
export function completionContext(before) {
  let m;
  if ((m = new RegExp("\\\\(?:" + REF_CMDS + ")\\*?\\{([^{}]*)$").exec(before)))
    return { kind: "ref", prefix: m[1].split(",").pop().replace(/^\s+/, "") };
  if ((m = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/.exec(before)))
    return { kind: "cite", prefix: m[1].split(",").pop().replace(/^\s+/, "") };
  if ((m = /\\(includegraphics|includesvg)\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]*)$/.exec(before)))
    return { kind: "img", prefix: m[2], cmd: m[1] };
  if ((m = /\\(input|include|subfile|includeonly)\{([^{}]*)$/.exec(before)))
    return { kind: "input", prefix: m[2].split(",").pop().replace(/^\s+/, ""), cmd: m[1] };
  if ((m = /\\(?:bibliography|addbibresource)(?:\[[^\]]*\])?\{([^{}]*)$/.exec(before)))
    return { kind: "bib", prefix: m[1].split(",").pop().replace(/^\s+/, "") };
  if ((m = /\\begin\{([A-Za-z*]*)$/.exec(before))) return { kind: "begin", prefix: m[1] };
  if ((m = /\\end\{([A-Za-z*]*)$/.exec(before))) return { kind: "end", prefix: m[1] };
  if ((m = /(?:^|[^\\])(\\[A-Za-z@]*)$/.exec(before))) return { kind: "cmd", prefix: m[1] };
  return null;
}

// environments still open at the end of `text`, innermost last
export function openEnvs(text) {
  const st = [];
  const re = /\\(begin|end)\{([^{}]+)\}/g;
  let m;
  const clean = String(text).replace(/(^|[^\\])%.*$/gm, "$1");
  while ((m = re.exec(clean))) {
    if (m[1] === "begin") st.push(m[2]);
    else { const k = st.lastIndexOf(m[2]); if (k >= 0) st.splice(k); }
  }
  return st;
}

/* ------------------------------------------------------------------ images */
function joinPath(a, b) {
  const s = (a ? a.replace(/\/+$/, "") + "/" : "") + b;
  const out = [];
  for (const part of s.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!out.length) return null; out.pop(); } else out.push(part);
  }
  return out.join("/");
}
// project path of an \includegraphics argument, trying \graphicspath folders and the usual extensions
export function resolveImage(ref, images, graphicspath, fromDir = "") {
  const set = images instanceof Set ? images : new Set(images || []);
  const r = String(ref || "").trim();
  if (!r) return null;
  const bases = ["", ...(graphicspath || [])];
  if (fromDir) bases.push(fromDir);
  const exts = extOf(r) ? [""] : ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".svg"];
  for (const b of bases) for (const e of exts) {
    const p = joinPath(b, r + e);
    if (p && set.has(p)) return p;
  }
  return null;
}

/* ------------------------------------------------------------------ BibTeX */
const STOP = new Set("a an the on of for in to and with towards toward from via is are do does by at as into its".split(" "));
export function suggestBibKey(author, year, title) {
  const first = String(author || "").split(/\s+and\s+/i)[0].trim();
  const last = first.includes(",") ? first.split(",")[0] : first.split(/\s+/).pop();
  const word = String(title || "").replace(/[{}]/g, "").split(/[^A-Za-z0-9]+/).find((w) => w.length >= 3 && !STOP.has(w.toLowerCase())) || "";
  return slugify(last, 30).replace(/-/g, "") + String(year || "").replace(/\D/g, "").slice(0, 4) + slugify(word, 20).replace(/-/g, "");
}
export const BIB_VENUE = { article: "journal", inproceedings: "booktitle", incollection: "booktitle", inbook: "booktitle",
  proceedings: "publisher", book: "publisher", phdthesis: "school", mastersthesis: "school", techreport: "institution",
  manual: "organization", misc: "howpublished", online: "organization", unpublished: "note" };
// preview only; the server formats the entry that is saved (server.format_bib), with the same field order
export function formatBib(e) {
  const lines = ["@" + (e.type || "misc") + "{" + (e.key || "") + ","];
  for (const f of ["author", "editor", "title", "venue", "year", "volume", "number", "pages", "doi", "url", "note"]) {
    const v = String(e[f] ?? "").replace(/\s+/g, " ").trim();
    if (!v) continue;
    if (f === "url" && e.type === "misc" && !e.venue) { lines.push("  howpublished = {\\url{" + v + "}},"); continue; }
    lines.push("  " + (f === "venue" ? (BIB_VENUE[e.type] || "howpublished") : f) + " = {" + v + "},");
  }
  if (lines.length > 1) lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, "");
  lines.push("}");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ three-way merge: the file changed on disk while
   the editor holds unsaved typing; both edits are kept instead of one overwriting the other */
// line diff of a -> b as hunks {s, e, lines}: a[s:e] becomes lines; hunks are separated by at least one equal line
export function lineDiff(a, b) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf), n = A.length, m = B.length;
  if (!n && !m) return [];
  if (!n || !m || n * m > 4e6) return [{ s: pre, e: pre + n, lines: B }];
  const W = m + 1, t = new Uint32Array((n + 1) * W);      // t[i][j] = longest common subsequence of A[i:], B[j:]
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i * W + j] = A[i] === B[j] ? t[(i + 1) * W + j + 1] + 1 : Math.max(t[(i + 1) * W + j], t[i * W + j + 1]);
  const hunks = [];
  let i = 0, j = 0, hs = -1, hl = null;
  const flush = () => { if (hs >= 0) { hunks.push({ s: pre + hs, e: pre + i, lines: hl }); hs = -1; } };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; continue; }
    if (hs < 0) { hs = i; hl = []; }
    if (j < m && (i >= n || t[i * W + j + 1] >= t[(i + 1) * W + j])) hl.push(B[j++]);
    else i++;
  }
  flush();
  return hunks;
}
// Merge "mine" (the editor) and "theirs" (the disk), two edits of "base", line by line. Changes to different lines are
// both kept. Where both changed the same or neighbouring lines differently, "mine" stays and "theirs" follows it as
// commented-out lines between mark.open and mark.close, so nothing is lost and the file still compiles.
export const MERGE_OPEN = "%>>>>", MERGE_CLOSE = "%<<<<";
export function merge3(base, mine, theirs, mark = {}) {
  const O = base.split("\n"), A = mine.split("\n"), B = theirs.split("\n");
  const open = mark.open || MERGE_OPEN + " saved outside the editor (commented out):", close = mark.close || MERGE_CLOSE;
  const hunks = lineDiff(O, A).map((h) => ({ ...h, who: "a" })).concat(lineDiff(O, B).map((h) => ({ ...h, who: "b" })))
    .sort((x, y) => x.s - y.s || x.e - y.e);
  const side = (hs, s, e) => {
    const r = []; let p = s;
    for (const h of hs) { r.push(...O.slice(p, h.s), ...h.lines); p = h.e; }
    r.push(...O.slice(p, e));
    return r;
  };
  const out = [];
  let pos = 0, k = 0, conflicts = 0;
  while (k < hunks.length) {
    const g = [hunks[k]], s = hunks[k].s;
    let e = hunks[k].e; k++;
    while (k < hunks.length && hunks[k].s <= e) { g.push(hunks[k]); e = Math.max(e, hunks[k].e); k++; }
    out.push(...O.slice(pos, s));
    const ga = g.filter((h) => h.who === "a"), gb = g.filter((h) => h.who === "b");
    const ra = side(ga, s, e), rb = side(gb, s, e);
    if (!gb.length || ra.join("\n") === rb.join("\n")) out.push(...ra);
    else if (!ga.length) out.push(...rb);
    else { conflicts++; out.push(...ra, open, ...rb.map((l) => (l ? "% " + l : "%")), close); }
    pos = e;
  }
  out.push(...O.slice(pos));
  return { text: out.join("\n"), conflicts };
}
