// Modal dialogs: prompt / confirm, Insert figure, Insert table, New BibTeX entry.
const $ = (id) => document.getElementById(id);

export function initDialogs(ctx) {
  const { tr, num, toast, LT, api, post } = ctx;

  /* ---------------------------------------------------------------- generic modal behaviour */
  const closers = new Map();       // modal element -> function run when it closes
  function openModal(m, onClose) { closers.set(m, onClose || null); m.classList.remove("hidden"); }
  function closeModal(m) {
    if (m.classList.contains("hidden")) return;
    m.classList.add("hidden");
    const f = closers.get(m); closers.delete(m);
    if (f) f();
  }
  document.querySelectorAll(".modal").forEach((m) => {
    if (m.id === "histPanel" || m.id === "palette") return;   // these two have their own handlers
    m.addEventListener("mousedown", (e) => { if (e.target === m) closeModal(m); });
    m.querySelectorAll("[data-close]").forEach((b) => { b.addEventListener("click", () => closeModal(m)); });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = [...document.querySelectorAll(".modal:not(.hidden)")].filter((m) => m.id !== "palette").pop();
    if (!open) return;
    e.preventDefault();
    if (open.id === "histPanel") open.classList.add("hidden"); else closeModal(open);
  });

  /* ---------------------------------------------------------------- prompt / confirm */
  ctx.ask = ({ title, message, value, okText, danger, input, selectStem }) => new Promise((resolve) => {
    const m = $("askDialog");
    let done = false;
    const finish = (v) => { if (done) return; done = true; resolve(v); };
    $("askTitle").textContent = title || "";
    $("askMsg").textContent = message || ""; $("askMsg").classList.toggle("hidden", !message);
    const inp = $("askInput");
    inp.classList.toggle("hidden", !input);
    inp.value = value || "";
    const ok = $("askOk");
    ok.textContent = okText || tr("ok");
    ok.classList.toggle("danger", !!danger);
    ok.onclick = () => { const v = input ? inp.value : true; finish(v); closeModal(m); };
    $("askCancel").onclick = () => closeModal(m);
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } };
    openModal(m, () => finish(null));
    setTimeout(() => {
      if (input) {
        inp.focus();
        const v = inp.value, slash = v.lastIndexOf("/") + 1, dot = v.lastIndexOf(".");
        if (selectStem && dot > slash) inp.setSelectionRange(slash, dot); else inp.select();
      } else ok.focus();
    }, 20);
  });
  ctx.prompt = (title, value, message, o = {}) => ctx.ask({ title, value, message, input: true, selectStem: o.selectStem });
  ctx.confirm = async (title, message, okText, danger) => (await ctx.ask({ title, message, okText, danger })) !== null;

  const takenLabels = () => new Set(((ctx.index && ctx.index.labels) || []).map((l) => l.key));
  const fileNameOf = (name) => {
    const n = String(name || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
    const m = /^(.*?)(\.[^.]*)?$/.exec(n.split(/[\\/]/).pop());
    let stem = (m[1] || "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 80);
    if (!stem) stem = "image";
    return stem + (m[2] || "").toLowerCase();
  };
  const predictUnique = (folder, name) => {
    const have = new Set((ctx.tree.entries || []).map((e) => e.path));
    const join = (n) => (folder ? folder.replace(/\/+$/, "") + "/" : "") + n;
    if (!have.has(join(name))) return join(name);
    const m = /^(.*?)(\.[^.]*)?$/.exec(name);
    for (let i = 1; ; i++) { const c = join(m[1] + "-" + i + (m[2] || "")); if (!have.has(c)) return c; }
  };
  function bindAutoShort(captionEl, shortEl, state, update) {
    captionEl.oninput = () => { if (!state.shortTouched) shortEl.value = LT.shortCaption(captionEl.value); update(); };
    shortEl.oninput = () => { state.shortTouched = shortEl.value.trim() !== ""; update(); };
  }

  /* ---------------------------------------------------------------- Insert figure */
  const fig = { file: null, path: null, url: null, shortTouched: false, labelTouched: false, tab: "upload" };
  function figTab(name) {
    fig.tab = name;
    document.querySelectorAll("[data-figtab]").forEach((b) => b.classList.toggle("active", b.dataset.figtab === name));
    $("figUpload").classList.toggle("hidden", name !== "upload");
    $("figProject").classList.toggle("hidden", name !== "project");
    if (name === "project") renderGrid();
    figUpdate();
  }
  document.querySelectorAll("[data-figtab]").forEach((b) => { b.onclick = () => figTab(b.dataset.figtab); });
  function figPreview(src, kind) {
    const box = $("figPreview"); box.textContent = "";
    if (!src) return;
    if (kind === "pdf-path") { const c = document.createElement("canvas"); box.append(c); ctx.renderPdfThumb(src, c, 300); return; }
    if (kind === "pdf-file") {
      const c = document.createElement("canvas"); box.append(c);
      src.arrayBuffer().then((buf) => ctx.pdfjs.getDocument({ data: buf }).promise).then(async (doc) => {
        const page = await doc.getPage(1), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 300 / v1.width });
        c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; doc.destroy();
      }).catch(() => {});
      return;
    }
    if (kind === "none") { const d = document.createElement("div"); d.className = "meta"; d.textContent = tr("imgNoPreview"); box.append(d); return; }
    const img = document.createElement("img"); img.src = src; img.alt = ""; box.append(img);
  }
  function autoFigLabel(path) {
    if (fig.labelTouched) return;
    const slug = LT.slugify(LT.stemOf(path)) || "figure";
    $("figLabel").value = LT.uniqueLabel("fig:" + slug, takenLabels());
  }
  function setFigFile(file) {
    if (fig.url) URL.revokeObjectURL(fig.url);
    fig.file = file; fig.path = null; fig.url = null;
    $("figName").value = fileNameOf(file.name);
    $("figNameRow").classList.remove("hidden");
    const ext = LT.extOf(file.name);
    if (ext === ".pdf") figPreview(file, "pdf-file");
    else if (ext === ".eps") figPreview("x", "none");
    else { fig.url = URL.createObjectURL(file); figPreview(fig.url, "img"); }
    autoFigLabel(file.name);
    figUpdate();
  }
  function selectProjectImage(path) {
    fig.path = path; fig.file = null;
    document.querySelectorAll("#figGrid .thumb").forEach((t) => t.classList.toggle("sel", t.dataset.path === path));
    const ext = LT.extOf(path);
    if (ext === ".pdf") figPreview(path, "pdf-path");
    else if (ext === ".eps") figPreview("x", "none");
    else { const ent = (ctx.tree.entries || []).find((e) => e.path === path); figPreview("/api/raw?path=" + encodeURIComponent(path) + "&v=" + (ent ? ent.mtime : 0), "img"); }
    autoFigLabel(path);
    figUpdate();
  }
  function renderGrid() {
    const q = $("figFilter").value.trim().toLowerCase();
    const imgs = (ctx.tree.entries || []).filter((e) => e.type === "file" && LT.isImagePath(e.path) && (!q || e.path.toLowerCase().includes(q)));
    const grid = $("figGrid"); grid.textContent = "";
    if (!imgs.length) { const d = document.createElement("div"); d.className = "meta pad"; d.textContent = tr("figNoImages"); grid.append(d); return; }
    for (const e of imgs.slice(0, 400)) {
      const t = document.createElement("button"); t.type = "button"; t.className = "thumb"; t.dataset.path = e.path; t.title = e.path;
      if (e.path === fig.path) t.classList.add("sel");
      const ext = LT.extOf(e.path);
      const pic = document.createElement("div"); pic.className = "pic";
      if (ext === ".pdf" || ext === ".eps") { const b = document.createElement("span"); b.className = "badge"; b.textContent = ext.slice(1).toUpperCase(); pic.append(b); }
      else { const img = document.createElement("img"); img.loading = "lazy"; img.alt = ""; img.src = "/api/raw?path=" + encodeURIComponent(e.path) + "&v=" + e.mtime; pic.append(img); }
      const cap = document.createElement("span"); cap.className = "cap"; cap.dir = "ltr"; cap.textContent = e.path.split("/").pop();
      t.append(pic, cap);
      t.onclick = () => selectProjectImage(e.path);
      t.ondblclick = () => { selectProjectImage(e.path); figInsert(); };
      grid.append(t);
    }
  }
  $("figFilter").oninput = renderGrid;
  function figTargetPath() {
    if (fig.path) return fig.path;
    if (fig.file) return predictUnique($("figFolder").value.trim().replace(/^\/+|\/+$/g, ""), fileNameOf($("figName").value || fig.file.name));
    return "";
  }
  function figUpdate() {
    const w = Number($("figWidth").value);
    $("figWidthOut").textContent = num(w.toFixed(2));
    const path = figTargetPath();
    const label = $("figLabel").value.trim();
    ctx.renderSource($("figCode"), LT.buildFigure({ path: path || "…", width: w, caption: $("figCaption").value, short: $("figShort").value,
      label, placement: $("figPlace").value, center: $("figCenter").checked }).replace(LT.CURSOR, ""));
    const ext = LT.extOf(path);
    const warn = ext === ".svg" ? tr("figSvgWarn") : ext === ".eps" ? tr("figEpsWarn") : "";
    $("figWarn").textContent = warn; $("figWarn").classList.toggle("hidden", !warn);
    const taken = label && takenLabels().has(label);
    $("figMsg").textContent = taken ? tr("labelTaken") : "";
  }
  bindAutoShort($("figCaption"), $("figShort"), fig, figUpdate);
  $("figLabel").oninput = () => { fig.labelTouched = true; figUpdate(); };
  ["figWidth", "figPlace", "figCenter", "figName", "figFolder"].forEach((id) => { $(id).addEventListener("input", figUpdate); $(id).addEventListener("change", figUpdate); });
  const drop = $("figDrop");
  drop.onclick = () => $("figPick").click();
  drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("figPick").click(); } };
  $("figPick").onchange = () => { const f = $("figPick").files[0]; if (f) setFigFile(f); $("figPick").value = ""; };
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault(); drop.classList.remove("over");
    const inner = e.dataTransfer.getData("application/x-livetex-path");
    if (inner && LT.isImagePath(inner)) { figTab("project"); selectProjectImage(inner); return; }
    const f = [...(e.dataTransfer.files || [])].find((x) => LT.isImagePath(x.name));
    if (f) setFigFile(f);
  });
  $("figDialog").addEventListener("paste", (e) => {
    for (const it of e.clipboardData.items || []) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const b = it.getAsFile(); if (!b) continue;
        e.preventDefault();
        const ext = it.type.includes("jpeg") ? "jpg" : it.type.includes("svg") ? "svg" : "png";
        figTab("upload"); setFigFile(new File([b], "pasted-" + Date.now() + "." + ext, { type: it.type }));
        return;
      }
    }
  });
  async function figInsert() {
    let path = fig.path;
    if (fig.file) {
      const folder = $("figFolder").value.trim().replace(/^\/+|\/+$/g, "");
      const res = await ctx.uploadFile(fig.file, folder, $("figName").value || fig.file.name, true);
      if (!res) return;
      path = res.path;
      if (res.renamed) toast(tr("uploadRenamed", res.requested, res.name));
    }
    if (!path) { $("figMsg").textContent = tr("figPickFirst"); return; }
    const text = LT.buildFigure({ path, width: Number($("figWidth").value), caption: $("figCaption").value, short: $("figShort").value,
      label: $("figLabel").value.trim(), placement: $("figPlace").value, center: $("figCenter").checked });
    closeModal($("figDialog"));
    if (ctx.insertBlock(text)) toast(tr("inserted"));
    ctx.refreshTree(true); ctx.refreshIndex();
  }
  $("figOk").onclick = figInsert;
  ctx.openFigure = (opts = {}) => {
    if (!ctx.current) { toast(tr("noTextFile")); return; }
    Object.assign(fig, { file: null, path: null, shortTouched: false, labelTouched: false });
    $("figCaption").value = ""; $("figShort").value = ""; $("figLabel").value = ""; $("figPlace").value = "tbp";
    $("figWidth").value = "0.8"; $("figCenter").checked = true; $("figFilter").value = "";
    $("figFolder").value = ctx.tree.uploads || "figs/uploads"; $("figName").value = ""; $("figNameRow").classList.add("hidden");
    $("figMsg").textContent = ""; figPreview(null);
    openModal($("figDialog"), () => { if (fig.url) { URL.revokeObjectURL(fig.url); fig.url = null; } });
    if (opts.path) { figTab("project"); selectProjectImage(opts.path); const t = document.querySelector('#figGrid .thumb.sel'); if (t) t.scrollIntoView({ block: "nearest" }); }
    else { figTab("upload"); if (opts.file) setFigFile(opts.file); }
    setTimeout(() => (opts.file || opts.path ? $("figCaption") : $("figDrop")).focus(), 30);
  };

  /* ---------------------------------------------------------------- Insert table */
  const tab = { rows: 3, cols: 3, pasted: null, shortTouched: false, labelTouched: false };
  const GR = 8, GC = 10;
  const grid = $("tabGrid");
  for (let r = 1; r <= GR; r++) for (let c = 1; c <= GC; c++) {
    const d = document.createElement("div"); d.className = "gcell"; d.dataset.r = r; d.dataset.c = c; grid.append(d);
  }
  function paintGrid(R, C) {
    grid.querySelectorAll(".gcell").forEach((d) => d.classList.toggle("on", +d.dataset.r <= R && +d.dataset.c <= C));
    $("tabSizeOut").textContent = tr("tabSize", num(R), num(C));
  }
  grid.addEventListener("mouseover", (e) => { const d = e.target.closest(".gcell"); if (d && !tab.pasted) paintGrid(+d.dataset.r, +d.dataset.c); });
  grid.addEventListener("mouseleave", () => tabUpdate());
  grid.addEventListener("click", (e) => {
    const d = e.target.closest(".gcell"); if (!d || tab.pasted) return;
    tab.rows = +d.dataset.r; tab.cols = +d.dataset.c; $("tabRows").value = tab.rows; $("tabCols").value = tab.cols; tabUpdate();
  });
  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || lo));
  $("tabRows").oninput = () => { tab.rows = clampInt($("tabRows").value, 1, 60); tabUpdate(); };
  $("tabCols").oninput = () => { tab.cols = clampInt($("tabCols").value, 1, 26); tabUpdate(); };
  $("tabPasteBox").oninput = () => {
    const rows = LT.parseDelimited($("tabPasteBox").value);
    tab.pasted = rows.length ? rows : null;
    $("tabDetected").textContent = rows.length ? tr("tabDetected", num(rows.length), num(rows[0].length)) : "";
    grid.classList.toggle("disabled", !!tab.pasted);
    tabUpdate();
  };
  function autoTabLabel() {
    if (tab.labelTouched) return;
    const slug = LT.slugify($("tabCaption").value) || "table";
    $("tabLabel").value = LT.uniqueLabel("tab:" + slug, takenLabels());
  }
  function tabOpts() {
    return { rows: tab.pasted || null, nrows: tab.rows, ncols: tab.cols, align: $("tabAlign").value, booktabs: $("tabBooktabs").checked,
      header: $("tabHeader").checked, escape: !!tab.pasted && $("tabEscape").checked, caption: $("tabCaption").value, short: $("tabShort").value,
      label: $("tabLabel").value.trim(), placement: $("tabPlace").value, center: $("tabCenter").checked };
  }
  function tabUpdate() {
    paintGrid(tab.rows, tab.cols);
    if (tab.pasted) $("tabSizeOut").textContent = tr("tabSize", num(tab.pasted.length), num(tab.pasted[0].length));
    ctx.renderSource($("tabCode"), LT.buildTable(tabOpts()).replace(LT.CURSOR, ""));
    const label = $("tabLabel").value.trim();
    $("tabMsg").textContent = label && takenLabels().has(label) ? tr("labelTaken") : "";
  }
  bindAutoShort($("tabCaption"), $("tabShort"), tab, () => { autoTabLabel(); tabUpdate(); });
  $("tabLabel").oninput = () => { tab.labelTouched = true; tabUpdate(); };
  ["tabAlign", "tabBooktabs", "tabHeader", "tabEscape", "tabPlace", "tabCenter"].forEach((id) => { $(id).addEventListener("input", tabUpdate); $(id).addEventListener("change", tabUpdate); });
  $("tabOk").onclick = () => {
    const text = LT.buildTable(tabOpts());
    closeModal($("tabDialog"));
    if (ctx.insertBlock(text)) toast(tr("inserted"));
  };
  ctx.openTable = () => {
    if (!ctx.current) { toast(tr("noTextFile")); return; }
    Object.assign(tab, { rows: 3, cols: 3, pasted: null, shortTouched: false, labelTouched: false });
    $("tabRows").value = 3; $("tabCols").value = 3; $("tabPasteBox").value = ""; $("tabDetected").textContent = "";
    $("tabCaption").value = ""; $("tabShort").value = ""; $("tabPlace").value = "tbp"; grid.classList.remove("disabled");
    autoTabLabel(); tabUpdate();
    openModal($("tabDialog"));
    setTimeout(() => $("tabCaption").focus(), 30);
  };

  /* ---------------------------------------------------------------- New BibTeX entry */
  const bib = { keyTouched: false };
  const TYPES = ["article", "inproceedings", "book", "incollection", "misc", "online", "phdthesis", "mastersthesis", "techreport", "unpublished"];
  $("bibType").textContent = "";
  for (const t of TYPES) { const o = document.createElement("option"); o.value = t; o.textContent = t; $("bibType").append(o); }
  const bibEntry = () => ({ type: $("bibType").value, key: $("bibKey").value.trim(), author: $("bibAuthor").value, title: $("bibTitleIn").value,
    year: $("bibYear").value, venue: $("bibVenue").value, doi: $("bibDoi").value, url: $("bibUrl").value });
  function bibUpdate() {
    if (!bib.keyTouched) $("bibKey").value = LT.suggestBibKey($("bibAuthor").value, $("bibYear").value, $("bibTitleIn").value);
    $("bibVenueField").textContent = "(" + (LT.BIB_VENUE[$("bibType").value] || "howpublished") + ")";
    const e = bibEntry();
    ctx.renderSource($("bibCode"), LT.formatBib(e));
    const keys = new Set(((ctx.index && ctx.index.bib) || []).map((b) => b.key.toLowerCase()));
    $("bibMsg").textContent = e.key && keys.has(e.key.toLowerCase()) ? tr("bibDup") : "";
  }
  ["bibType", "bibAuthor", "bibTitleIn", "bibYear", "bibVenue", "bibDoi", "bibUrl", "bibFile"].forEach((id) => { $(id).addEventListener("input", bibUpdate); $(id).addEventListener("change", bibUpdate); });
  $("bibKey").oninput = () => { bib.keyTouched = $("bibKey").value.trim() !== ""; bibUpdate(); };
  async function bibAdd() {
    const path = $("bibFile").value, e = bibEntry();
    if (!path) { $("bibMsg").textContent = tr("bibNoFile"); return; }
    if (!e.key || !e.title.trim()) { $("bibMsg").textContent = tr("bibNeed"); return; }
    const f = ctx.files.get(path);
    if (f && f.loaded && ctx.isDirty(f) && !(await ctx.saveFile(path))) return;
    let sha = f && f.loaded ? f.sha : null;
    if (!sha) { const r = await api("/api/file?path=" + encodeURIComponent(path)); if (!r.ok) { $("bibMsg").textContent = tr("opFailed") + ctx.errText(r); return; } sha = r.data.sha256; }
    const r = await post("/api/bib/add", { path, base_sha256: sha, entry: e });
    if (!r.ok) { $("bibMsg").textContent = r.data && r.data.error === "duplicate key" ? tr("bibDup") : tr("opFailed") + ctx.errText(r); return; }
    ctx.reloadFromContent(path, r.data.content, r.data.sha256);
    closeModal($("bibDialog"));
    toast(tr("bibAdded", r.data.key, path));
    if ($("bibCite").checked && ctx.current && /\.tex$/i.test(ctx.current.name) && !ctx.imageMode) ctx.insertBlock("\\cite{" + r.data.key + "}", true);
    ctx.refreshIndex();
  }
  $("bibOk").onclick = bibAdd;
  ctx.openBib = () => {
    const files = [...new Set([...((ctx.index && ctx.index.bibfiles) || []), ...(ctx.tree.entries || []).filter((x) => x.type === "file" && /\.bib$/i.test(x.path)).map((x) => x.path)])];
    const sel = $("bibFile"); sel.textContent = "";
    for (const p of files) { const o = document.createElement("option"); o.value = p; o.textContent = p; sel.append(o); }
    bib.keyTouched = false;
    ["bibKey", "bibAuthor", "bibTitleIn", "bibYear", "bibVenue", "bibDoi", "bibUrl"].forEach((id) => { $(id).value = ""; });
    $("bibType").value = "article";
    $("bibCite").checked = !!(ctx.current && /\.tex$/i.test(ctx.current.name));
    bibUpdate();
    $("bibOk").disabled = !files.length;
    if (!files.length) $("bibMsg").textContent = tr("bibNoFile");
    openModal($("bibDialog"));
    setTimeout(() => $("bibAuthor").focus(), 30);
  };

  ctx.langHooks.push(() => {
    if (!$("figDialog").classList.contains("hidden")) { figUpdate(); if (fig.tab === "project") renderGrid(); }
    if (!$("tabDialog").classList.contains("hidden")) tabUpdate();
    if (!$("bibDialog").classList.contains("hidden")) bibUpdate();
  });
}
