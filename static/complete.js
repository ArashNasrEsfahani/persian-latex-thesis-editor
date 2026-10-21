// Autocompletion for \ref, \cite, \includegraphics, \input, \begin/\end and commands, plus the image hover preview.
import { autocompletion, snippetCompletion, startCompletion } from "@codemirror/autocomplete";
import { EditorView, hoverTooltip } from "@codemirror/view";
import * as LT from "./latex-tools.js";

const ENVS = ["figure", "figure*", "table", "table*", "tabular", "tabularx", "longtable", "itemize", "enumerate",
  "description", "equation", "equation*", "align", "align*", "gather", "multline", "split", "cases", "matrix", "pmatrix",
  "bmatrix", "array", "center", "flushleft", "flushright", "quote", "quotation", "verbatim", "minipage", "abstract",
  "theorem", "lemma", "proof", "definition", "example", "remark", "latin", "persian", "tikzpicture", "subfigure",
  "algorithm", "algorithmic", "lstlisting", "frame", "thebibliography", "document", "titlepage", "appendix"];
const ENV_BODY = {
  itemize: "\\item ", enumerate: "\\item ", description: "\\item[] ",
  figure: "\\centering\n\\includegraphics[width=0.8\\textwidth]{}\n\\caption[]{}\n\\label{fig:}",
  table: "\\centering\n\\caption[]{}\n\\label{tab:}\n\\begin{tabular}{cc}\n\\toprule\n & \\\\\n\\midrule\n & \\\\\n\\bottomrule\n\\end{tabular}",
  tabular: "", frame: "\\frametitle{}",
};
const ENV_ARGS = { tabular: "{cc}", tabularx: "{\\textwidth}{XX}", minipage: "{0.48\\textwidth}", array: "{cc}", subfigure: "{0.48\\textwidth}",
  longtable: "{cc}", "figure": "[tbp]", "table": "[tbp]", "figure*": "[tbp]", "table*": "[tbp]" };
const CMDS = [
  ["\\section{${}}", "\\section"], ["\\subsection{${}}", "\\subsection"], ["\\subsubsection{${}}", "\\subsubsection"],
  ["\\chapter{${}}", "\\chapter"], ["\\paragraph{${}}", "\\paragraph"], ["\\textbf{${}}", "\\textbf"],
  ["\\textit{${}}", "\\textit"], ["\\emph{${}}", "\\emph"], ["\\underline{${}}", "\\underline"], ["\\texttt{${}}", "\\texttt"],
  ["\\lr{${}}", "\\lr"], ["\\rl{${}}", "\\rl"], ["\\label{${}}", "\\label"], ["\\ref{${}}", "\\ref"], ["\\eqref{${}}", "\\eqref"],
  ["\\pageref{${}}", "\\pageref"], ["\\autoref{${}}", "\\autoref"], ["\\cite{${}}", "\\cite"], ["\\citep{${}}", "\\citep"],
  ["\\citet{${}}", "\\citet"], ["\\footnote{${}}", "\\footnote"], ["\\caption[${}]{${}}", "\\caption"],
  ["\\includegraphics[width=0.8\\textwidth]{${}}", "\\includegraphics"], ["\\input{${}}", "\\input"], ["\\include{${}}", "\\include"],
  ["\\usepackage{${}}", "\\usepackage"], ["\\url{${}}", "\\url"], ["\\href{${}}{${}}", "\\href"], ["\\frac{${}}{${}}", "\\frac"],
  ["\\sqrt{${}}", "\\sqrt"], ["\\vspace{${}}", "\\vspace"], ["\\hspace{${}}", "\\hspace"], ["\\textcolor{${}}{${}}", "\\textcolor"],
  ["\\multicolumn{${}}{${c}}{${}}", "\\multicolumn"], ["\\item ", "\\item"],
];
const PLAIN = ["\\centering", "\\noindent", "\\newline", "\\newpage", "\\clearpage", "\\tableofcontents", "\\listoffigures",
  "\\listoftables", "\\maketitle", "\\hline", "\\toprule", "\\midrule", "\\bottomrule", "\\addlinespace", "\\textwidth",
  "\\linewidth", "\\small", "\\footnotesize", "\\large", "\\Large", "\\today", "\\LaTeX", "\\quad", "\\qquad", "\\dots",
  "\\appendix", "\\bibliography", "\\bibliographystyle"];

function infoDom(text) {
  return () => { const d = document.createElement("div"); d.dir = "auto"; d.className = "cm-cinfo"; d.textContent = text; return d; };
}
const KIND_TYPE = { figure: "fig", table: "tab", sec: "sec", eq: "eq", listing: "tab" };

export function latexCompletion(ctx) {
  const tr = ctx.tr;
  const kindWord = (k) => ({ figure: tr("figureWord"), table: tr("tableWord"), sec: tr("secWord"), eq: tr("eqWord") }[k] || "");

  function applyEnv(view, completion, from, to) {
    const name = completion.label;
    const line = view.state.doc.lineAt(from);
    const indent = /^[ \t]*/.exec(line.text)[0];
    const closeBrace = view.state.sliceDoc(to, to + 1) === "}" ? 1 : 0;
    const body = (ENV_BODY[name] || "").replace(/\n/g, "\n" + indent + "  ");
    const head = name + "}" + (ENV_ARGS[name] || "");
    const insert = head + "\n" + indent + "  " + body + "\n" + indent + "\\end{" + name + "}";
    let cursor = from + head.length + 1 + indent.length + 2 + body.length;
    const empty = body.indexOf("{}");               // first empty argument of the body, e.g. \includegraphics{}
    if (empty >= 0) cursor = from + head.length + 1 + indent.length + 2 + empty + 1;
    view.dispatch({ changes: { from, to: to + closeBrace, insert }, selection: { anchor: cursor }, userEvent: "input.complete" });
  }

  function source(context) {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const c = LT.completionContext(before);
    if (!c) return null;
    const idx = ctx.index || {};
    const from = context.pos - c.prefix.length;
    if (c.kind === "ref") {
      const options = (idx.labels || []).map((l) => ({
        label: l.key, type: KIND_TYPE[l.kind] || "lbl", boost: l.orphan ? -20 : 0,
        detail: (kindWord(l.kind) ? kindWord(l.kind) + " · " : "") + l.file + ":" + l.line + (l.dup ? " ⚠" : ""),
        info: l.text ? infoDom(l.text) : undefined,
      }));
      return { from, options, validFor: /^[^,{}\s]*$/ };
    }
    if (c.kind === "cite") {
      const options = (idx.bib || []).map((b) => ({
        label: b.key, type: "bib", detail: [b.author, b.year].filter(Boolean).join(" "),
        info: infoDom([b.title, b.venue].filter(Boolean).join(" — ") + "  (" + b.file + ")"),
      }));
      return { from, options, validFor: /^[^,{}\s]*$/ };
    }
    if (c.kind === "img") {
      const seen = new Set(), options = [];
      for (const p of idx.images || []) {
        if (c.cmd === "includesvg" && LT.extOf(p) !== ".svg") continue;
        const lab = c.cmd === "includesvg" ? p.replace(/\.svg$/i, "") : p;
        if (!seen.has(lab)) { seen.add(lab); options.push({ label: lab, type: "img" }); }
        for (const g of idx.graphicspath || []) {
          const gp = g.replace(/^\.\//, "");
          if (gp && p.startsWith(gp) && !seen.has(p.slice(gp.length))) {
            seen.add(p.slice(gp.length)); options.push({ label: p.slice(gp.length), type: "img", detail: "\\graphicspath", boost: -5 });
          }
        }
      }
      return { from, options, validFor: /^[^{}]*$/ };
    }
    if (c.kind === "input") {
      const options = (idx.texfiles || []).map((p) => ({ label: p.replace(/\.tex$/i, ""), type: "file", detail: p }));
      return { from, options, validFor: /^[^,{}]*$/ };
    }
    if (c.kind === "bib") {
      const options = (idx.bibfiles || []).map((p) => ({ label: p.replace(/\.bib$/i, ""), type: "file", detail: p }));
      return { from, options, validFor: /^[^,{}]*$/ };
    }
    if (c.kind === "begin") {
      const names = [...new Set([...ENVS, ...(idx.envs || [])])];
      return { from, options: names.map((n) => ({ label: n, type: "env", apply: applyEnv })), validFor: /^[A-Za-z*]*$/ };
    }
    if (c.kind === "end") {
      const open = LT.openEnvs(context.state.sliceDoc(Math.max(0, context.pos - 200000), from));
      const names = [...new Set([...open.slice().reverse(), ...ENVS])];
      return { from, options: names.map((n, i) => ({ label: n, type: "env", boost: i < open.length ? 50 - i : 0, apply: n + (context.state.sliceDoc(context.pos, context.pos + 1) === "}" ? "" : "}") })),
        validFor: /^[A-Za-z*]*$/ };
    }
    if (c.kind === "cmd") {
      if (!context.explicit && c.prefix.length < 2) return null;
      const options = CMDS.map(([tpl, label]) => snippetCompletion(tpl, { label, type: "cmd" }));
      for (const p of PLAIN) options.push({ label: p, type: "cmd" });
      options.push({ label: "\\begin", type: "cmd", apply: "\\begin{" });
      for (const name of idx.commands || []) options.push({ label: "\\" + name, type: "cmd", detail: tr("customCmd"), boost: -1 });
      return { from, options, validFor: /^\\[A-Za-z@]*$/ };
    }
    return null;
  }

  // after picking \cite{}, \ref{}, \begin{ ... from the list, open the next list right away
  const retrigger = EditorView.updateListener.of((u) => {
    if (!u.transactions.some((tr) => tr.isUserEvent("input.complete"))) return;
    const st = u.state, pos = st.selection.main.head, line = st.doc.lineAt(pos);
    const c = LT.completionContext(line.text.slice(0, pos - line.from));
    if (c && c.prefix === "" && ["ref", "cite", "img", "input", "bib", "begin"].includes(c.kind)) setTimeout(() => startCompletion(u.view), 20);
  });

  return [autocompletion({ override: [source], activateOnTyping: true, maxRenderedOptions: 300, icons: true }), retrigger];
}

export function imageHover(ctx) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const re = /\\(?:includegraphics|includesvg)\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g;
    let m;
    while ((m = re.exec(line.text))) {
      const s = line.from + m.index, e = s + m[0].length;
      if (pos < s || pos > e) continue;
      const ref = m[1].trim();
      return { pos: s, end: e, above: true, create() {
        const idx = ctx.index || {};
        const dir = ctx.current ? ctx.current.name.split("/").slice(0, -1).join("/") : "";
        const path = LT.resolveImage(ref, idx.images || [], idx.graphicspath || [], dir);
        const d = document.createElement("div"); d.className = "cm-imgtip";
        const cap = document.createElement("div"); cap.className = "cap"; cap.dir = "ltr"; cap.textContent = path || ref;
        if (!path) { const x = document.createElement("div"); x.className = "miss"; x.textContent = ctx.tr("imgNotFound"); d.append(x, cap); return { dom: d }; }
        const ext = LT.extOf(path);
        if (ext === ".pdf") { const c = document.createElement("canvas"); d.append(c); ctx.renderPdfThumb(path, c, 260); }
        else if (ext === ".eps") { const x = document.createElement("div"); x.className = "miss"; x.textContent = ctx.tr("imgNoPreview"); d.append(x); }
        else {
          const ent = (ctx.tree.entries || []).find((x) => x.path === path);
          const img = document.createElement("img"); img.alt = "";
          img.src = "/api/raw?path=" + encodeURIComponent(path) + "&v=" + (ent ? ent.mtime : "0");
          d.append(img);
        }
        d.append(cap);
        return { dom: d };
      } };
    }
    return null;
  }, { hoverTime: 300 });
}
