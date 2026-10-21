// Project-wide search and replace. Every replacement is saved by the server through the normal save path
// (a history copy of the old file, and a refusal if the file changed since the search).
const $ = (id) => document.getElementById(id);

export function initSearch(ctx) {
  const { tr, num, toast, post } = ctx;
  let last = null, timer = null, seq = 0;

  const params = () => ({ q: $("psQ").value, regex: $("psRegex").checked, case: $("psCase").checked, word: $("psWord").checked,
    all: $("psAll").checked, replacement: $("psR").value });

  async function run(silent) {
    const p = params();
    const my = ++seq;
    if (!p.q) { last = null; render(); return null; }
    const r = await post("/api/search", p);
    if (my !== seq) return null;
    if (!r.ok) {
      last = null; $("psResults").textContent = "";
      $("psSum").textContent = r.status === 400 ? tr("badRegex") + ctx.errText(r).replace(/^bad regular expression: /, "") : tr("opFailed") + ctx.errText(r);
      return null;
    }
    last = { p, data: r.data };
    render();
    return r.data;
  }

  function render() {
    const box = $("psResults"); box.textContent = "";
    if (!last) { $("psSum").textContent = ""; return; }
    const d = last.data, showRepl = last.p.replacement !== "";
    $("psSum").textContent = d.total ? tr("searchCount", num(d.total), num(d.results.length)) + (d.truncated ? " · " + tr("searchTrunc") : "") : tr("searchNone");
    for (const f of d.results) {
      const grp = document.createElement("div"); grp.className = "psgroup";
      const head = document.createElement("div"); head.className = "pshead";
      const nm = document.createElement("span"); nm.className = "nm"; nm.dir = "ltr"; nm.textContent = f.path;
      const cnt = document.createElement("span"); cnt.className = "meta"; cnt.textContent = num(f.matches.length);
      const sp = document.createElement("span"); sp.className = "grow";
      const rb = document.createElement("button"); rb.className = "btn sm"; rb.textContent = tr("replaceInFile");
      rb.onclick = (e) => { e.stopPropagation(); replaceFiles([f]); };
      head.append(nm, cnt, sp, rb);
      head.onclick = () => grp.classList.toggle("folded");
      grp.append(head);
      for (const m of f.matches) {
        const row = document.createElement("div"); row.className = "psrow";
        const ln = document.createElement("span"); ln.className = "ln"; ln.textContent = num(m.line);
        // same direction rule as the editor; a short context around the hit keeps the narrow panel readable
        const pre = m.pre.length > 28 ? "…" + m.pre.slice(-28) : m.pre, post = m.post.length > 44 ? m.post.slice(0, 44) + "…" : m.post;
        const tx = document.createElement("span"); tx.className = "tx"; tx.dir = ctx.LT.lineDir(m.pre + m.hit + m.post);
        ctx.appendSource(tx, pre);
        const hit = document.createElement("mark"); ctx.appendSource(hit, m.hit);
        if (showRepl) { hit.className = "del"; tx.append(hit); const ins = document.createElement("ins"); ctx.appendSource(ins, m.repl ?? ""); tx.append(ins); }
        else tx.append(hit);
        ctx.appendSource(tx, post);
        const one = document.createElement("button"); one.className = "btn sm one"; one.textContent = tr("replaceOne");
        one.onclick = (e) => { e.stopPropagation(); replaceOne(f, m); };
        row.append(ln, tx, one);
        row.onclick = () => ctx.openFile(f.path, m.line, { col: m.col, len: m.len });
        grp.append(row);
      }
      box.append(grp);
    }
  }

  // open files with unsaved edits are saved first (normal save path), then the search runs again on the saved text
  async function saveDirty(paths) {
    const dirty = paths.filter((p) => ctx.isDirty(p));
    if (!dirty.length) return true;
    toast(tr("savingFirst"));
    for (const p of dirty) if (!(await ctx.saveFile(p))) return false;
    return !!(await run(true));
  }
  async function apply(targets) {
    const p = last.p;
    const r = await post("/api/replace", { q: p.q, regex: p.regex, case: p.case, word: p.word, replacement: p.replacement, targets });
    if (!r.ok) { toast(tr("opFailed") + ctx.errText(r)); return; }
    let n = 0, files = 0, stale = false;
    for (const x of r.data.results) {
      if (x.code === 409) stale = true;
      if (x.content != null) { n += x.count; files++; ctx.reloadFromContent(x.path, x.content, x.sha256); }
    }
    toast(stale ? tr("replaceStale") : tr("replaced", num(n), num(files)));
    ctx.refreshIndex(); ctx.countProjectWords();
    await run(true);
  }
  async function replaceFiles(list) {
    if (!last) return;
    const paths = list.map((f) => f.path);
    if (!(await saveDirty(paths))) return;          // first, so the count below matches what is replaced
    const fresh = last.data.results.filter((f) => paths.includes(f.path));
    if (!fresh.length) return;
    const n = fresh.reduce((a, f) => a + f.matches.length, 0);
    if (!(await ctx.confirm(tr("replaceTitle"), tr("replaceConfirm", num(n), num(fresh.length)), tr("replaceAll")))) return;
    await apply(fresh.map((f) => ({ path: f.path, sha256: f.sha256 })));
  }
  async function replaceOne(f, m) {
    if (!last) return;
    if (ctx.isDirty(f.path)) {
      if (!(await saveDirty([f.path]))) return;
      const nf = last.data.results.find((x) => x.path === f.path);
      const nm = nf && nf.matches.find((x) => x.line === m.line && x.col === m.col && x.hit === m.hit);
      if (!nm) { toast(tr("replaceStale")); return; }
      f = nf; m = nm;
    }
    await apply([{ path: f.path, sha256: f.sha256, only: [m.i] }]);
  }

  $("psForm").onsubmit = (e) => { e.preventDefault(); run(); };
  $("psReplaceAll").onclick = async () => { if (!last) await run(); if (last && last.data.results.length) replaceFiles(last.data.results); };
  const live = () => { clearTimeout(timer); timer = setTimeout(() => { if ($("psQ").value.length >= 2 || !$("psQ").value) run(true); }, 400); };
  $("psQ").addEventListener("input", live);
  $("psR").addEventListener("input", () => { if (last) live(); });
  ["psCase", "psWord", "psRegex", "psAll"].forEach((id) => $(id).addEventListener("change", () => run(true)));
  ctx.focusSearch = (text) => {
    const pane = $("paneFiles");
    if (pane.classList.contains("hidden")) { pane.classList.remove("hidden"); $("rzSide").classList.remove("hidden"); ctx.store.set("side", "1"); }
    ctx.setSideTab("search");
    if (text && !text.includes("\n")) $("psQ").value = text;
    $("psQ").focus(); $("psQ").select();
    if ($("psQ").value) run(true);
  };
  ctx.langHooks.push(render);
}
