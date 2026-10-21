// Project file tree (open, new, rename/move, upload, trash + restore), the outline panel and the side tabs.
const $ = (id) => document.getElementById(id);

export function initTree(ctx) {
  const { tr, api, post, toast, store, ICONS, LT } = ctx;
  let entries = [], sig = "", selDir = "", menuTarget = null;
  const expKey = () => "tree-open:" + ctx.appTitle;
  let expanded = new Set();
  const loadExpanded = () => { try { expanded = new Set(JSON.parse(store.get(expKey(), "[]"))); } catch { expanded = new Set(); } };
  const saveExpanded = () => store.set(expKey(), JSON.stringify([...expanded]));

  /* ---------------------------------------------------------------- side tabs */
  function setSideTab(name) {
    document.querySelectorAll(".stab").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    $("sideFiles").classList.toggle("hidden", name !== "files");
    $("sideOutline").classList.toggle("hidden", name !== "outline");
    $("sideSearch").classList.toggle("hidden", name !== "search");
    store.set("sideTab", name);
    if (name === "outline") renderOutline();
  }
  document.querySelectorAll(".stab").forEach((b) => { b.onclick = () => setSideTab(b.dataset.tab); });
  ctx.setSideTab = setSideTab;

  /* ---------------------------------------------------------------- data */
  async function refreshTree(force) {
    const r = await api("/api/tree");
    if (!r.ok) return;
    if (!force && r.data.sig === sig) return;
    const first = !sig;
    sig = r.data.sig; entries = r.data.entries;
    ctx.tree = r.data;
    if (first) loadExpanded();
    renderTree();
    if (!first) { ctx.refreshIndex(); ctx.refreshDocs(); }
  }
  ctx.refreshTree = refreshTree;

  function children() {
    const kids = new Map();          // dir path -> [entries]
    for (const e of entries) {
      const parent = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(e);
    }
    for (const list of kids.values()) list.sort((a, b) => (a.type === b.type ? a.path.toLowerCase().localeCompare(b.path.toLowerCase()) : a.type === "dir" ? -1 : 1));
    return kids;
  }
  const baseName = (p) => p.split("/").pop();
  const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const isDir = (p) => entries.some((e) => e.path === p && e.type === "dir");
  function iconFor(e) {
    if (e.type === "dir") return expanded.has(e.path) ? ICONS.folderOpen : ICONS.folder;
    const x = LT.extOf(e.path);
    if (x === ".tex" || x === ".sty" || x === ".cls") return ICONS.tex;
    if (x === ".bib") return ICONS.bib;
    if (LT.isImagePath(e.path)) return ICONS.image;
    return ICONS.file;
  }

  /* ---------------------------------------------------------------- render */
  // rows are rebuilt only when the visible structure changes; otherwise their state is updated in place (so a
  // double click still lands on the same element after the first click opened the file)
  let lastKey = "";
  function paintRow(row) {
    const p = row.dataset.path, cur = ctx.imageMode || (ctx.current && ctx.current.name);
    row.classList.toggle("active", p === cur);
    row.classList.toggle("seldir", row.dataset.type === "dir" && p === selDir);
    const f = ctx.files.get(p), dirty = !!(f && f.loaded && ctx.isDirty(f));
    let dot = row.querySelector(".dot.unsaved");
    if (dirty && !dot) { dot = document.createElement("span"); dot.className = "dot unsaved"; dot.title = tr("unsaved"); row.append(dot); }
    else if (!dirty && dot) dot.remove();
  }
  function renderTree() {
    const box = $("tree"); if (!box) return;
    const kids = children();
    const visible = [];
    const walk = (dir, depth) => {
      for (const e of kids.get(dir) || []) {
        visible.push([e, depth]);
        if (e.type === "dir" && expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    const key = visible.map(([e]) => e.type[0] + (expanded.has(e.path) ? "+" : "") + e.path).join("\n") + "|" + ctx.main;
    if (key === lastKey) { box.querySelectorAll(".trow").forEach(paintRow); return; }
    lastKey = key;
    const frag = document.createDocumentFragment();
    for (const [e, depth] of visible) {
      const row = document.createElement("div");
      row.className = "trow" + (e.type === "dir" ? " dir" : "");
      row.dataset.path = e.path; row.dataset.type = e.type;
      row.style.paddingInlineStart = (6 + depth * 14) + "px";
      row.draggable = true;
      row.setAttribute("role", "treeitem");
      const editable = e.type === "file" && ctx.isEditablePath(e.path), image = e.type === "file" && LT.isImagePath(e.path);
      if (e.type === "file" && !editable && !image) row.classList.add("muted");
      const car = document.createElement("span"); car.className = "car";
      if (e.type === "dir") { car.innerHTML = ICONS.caret; if (expanded.has(e.path)) car.classList.add("open"); }
      const ic = document.createElement("span"); ic.className = "ico"; ic.innerHTML = iconFor(e);
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = baseName(e.path); nm.dir = "ltr";
      row.append(car, ic, nm);
      if (e.path === ctx.main) { const s = document.createElement("span"); s.className = "mainstar"; s.innerHTML = ICONS.star; s.title = "main"; row.append(s); }
      paintRow(row);
      frag.append(row);
    }
    box.textContent = ""; box.append(frag);
    if (ctx.tree.truncated) { const m = document.createElement("div"); m.className = "meta pad"; m.textContent = "…"; box.append(m); }
  }
  ctx.renderTree = renderTree;

  /* ---------------------------------------------------------------- row actions */
  async function activate(path, type) {
    if (type === "dir") {
      if (expanded.has(path)) expanded.delete(path); else expanded.add(path);
      selDir = path; saveExpanded(); renderTree(); return;
    }
    selDir = dirOf(path);
    if (ctx.isEditablePath(path)) await ctx.openFile(path);
    else if (LT.isImagePath(path)) ctx.showImage(path);
    else toast(tr("cannotOpen"));
  }
  $("tree").addEventListener("click", (e) => {
    const row = e.target.closest(".trow"); if (!row) { selDir = ""; renderTree(); return; }
    activate(row.dataset.path, row.dataset.type);
  });
  $("tree").addEventListener("dblclick", (e) => {
    const row = e.target.closest(".trow"); if (row && row.dataset.type === "file") renameItem(row.dataset.path);
  });

  const errMsg = (r) => (r.status === 409 ? tr("exists") : r.status === 403 && /extension/.test(ctx.errText(r)) ? tr("badExt")
    : r.status === 403 && /bad path/.test(ctx.errText(r)) ? tr("badName") : tr("opFailed") + ctx.errText(r));
  const cleanPath = (p) => String(p || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");

  async function newFile(dir) {
    dir = dir == null ? selDir : dir;
    const v = await ctx.prompt(tr("newFile"), (dir ? dir + "/" : "") + "untitled.tex", tr("newFilePrompt"), { selectStem: true });
    if (!v) return;
    const path = cleanPath(v);
    const r = await post("/api/file/new", { path, content: "" });
    if (!r.ok) { toast(errMsg(r)); return; }
    expandTo(path); await refreshTree(true); ctx.refreshDocs();
    await ctx.openFile(path);
  }
  async function newFolder(dir) {
    dir = dir == null ? selDir : dir;
    const v = await ctx.prompt(tr("newFolder"), dir ? dir + "/" : "", tr("newFolderPrompt"));
    if (!v) return;
    const path = cleanPath(v);
    const r = await post("/api/mkdir", { path });
    if (!r.ok) { toast(errMsg(r)); return; }
    expandTo(path + "/x"); expanded.add(path); selDir = path; saveExpanded();
    await refreshTree(true);
  }
  function expandTo(path) {
    const parts = path.split("/"); parts.pop();
    for (let i = 1; i <= parts.length; i++) expanded.add(parts.slice(0, i).join("/"));
    saveExpanded();
  }
  async function renameItem(path) {
    const v = await ctx.prompt(tr("rename"), path, tr("renamePrompt"), { selectStem: true });
    if (!v) return;
    const to = cleanPath(v);
    if (!to || to === path) return;
    await moveItem(path, to);
  }
  async function moveItem(path, to) {
    const f = ctx.files.get(path);
    if (f && f.loaded && ctx.isDirty(f) && !(await ctx.saveFile(path))) return;
    const r = await post("/api/rename", { from: path, to });
    if (!r.ok) { toast(errMsg(r)); return; }
    ctx.renamePath(path, to);
    if (expanded.has(path)) { expanded.delete(path); expanded.add(to); }
    expandTo(to); saveExpanded();
    await refreshTree(true); ctx.refreshDocs(); ctx.refreshIndex();
    toast(tr("movedTo", to));
  }
  async function trashItem(path) {
    const dirtyOpen = [...ctx.files.values()].some((f) => (f.name === path || f.name.startsWith(path + "/")) && f.loaded && ctx.isDirty(f));
    let msg = tr("deleteConfirm", path);
    if (dirtyOpen) msg += " " + tr("deleteDirty");
    if (path === ctx.main) msg += " " + tr("deleteMain");
    if (!(await ctx.confirm(tr("deleteItem"), msg, tr("deleteItem"), true))) return;
    const r = await post("/api/trash", { path });
    if (!r.ok) { toast(errMsg(r)); return; }
    await ctx.closePath(path);
    await refreshTree(true); ctx.refreshDocs(); ctx.refreshIndex();
    toast(tr("movedToTrash", path));
  }
  async function uploadFiles(fileList, dir) {
    const list = [...fileList];
    if (!list.length) return;
    toast(tr("uploading"));
    let lastOk = null;
    for (const file of list) {
      const res = await ctx.uploadFile(file, dir, file.name, false);
      if (!res) continue;
      lastOk = res;
      toast(res.renamed ? tr("uploadRenamed", res.requested, res.name) : tr("uploaded", res.path));
    }
    if (lastOk) { if (dir) { expandTo(dir + "/x"); expanded.add(dir); saveExpanded(); } await refreshTree(true); }
  }
  function pickUpload(dir) {
    const inp = $("upPick");
    inp.onchange = () => { uploadFiles(inp.files, dir == null ? selDir : dir); inp.value = ""; };
    inp.click();
  }
  ctx.newFile = newFile; ctx.newFolder = newFolder; ctx.pickUpload = pickUpload;

  /* ---------------------------------------------------------------- toolbar */
  const tb = [["tbNewFile", "newFile", () => newFile()], ["tbNewFolder", "newFolder", () => newFolder()], ["tbUpload", "upload", () => pickUpload()],
    ["tbRefresh", "refresh", async () => { await refreshTree(true); ctx.refreshIndex(); }], ["tbCollapse", "collapse", () => { expanded.clear(); saveExpanded(); renderTree(); }],
    ["tbTrash", "trash", () => openTrash()]];
  for (const [id, icon, fn] of tb) { const b = $(id); b.innerHTML = ICONS[icon]; b.onclick = fn; }

  /* ---------------------------------------------------------------- context menu */
  const menu = $("ctxMenu");
  function showMenu(x, y, items) {
    menu.textContent = "";
    for (const it of items) {
      if (it === "-") { const s = document.createElement("div"); s.className = "menusep"; menu.append(s); continue; }
      const b = document.createElement("button"); b.className = "menuitem" + (it.danger ? " danger" : ""); b.textContent = it.label;
      b.onclick = () => { hideMenu(); it.run(); };
      menu.append(b);
    }
    menu.classList.remove("hidden");
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + "px";
  }
  function hideMenu() { menu.classList.add("hidden"); menuTarget = null; }
  document.addEventListener("mousedown", (e) => { if (!menu.contains(e.target)) hideMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideMenu(); });
  const copy = async (p) => { try { await navigator.clipboard.writeText(p); toast(tr("pathCopied")); } catch { toast(p); } };
  $("filesScroll").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const row = e.target.closest(".trow");
    if (!row) { showMenu(e.clientX, e.clientY, [{ label: tr("newFile"), run: () => newFile("") }, { label: tr("newFolder"), run: () => newFolder("") }, { label: tr("upload"), run: () => pickUpload("") }]); return; }
    const p = row.dataset.path, dir = row.dataset.type === "dir";
    menuTarget = p;
    const items = [];
    if (dir) items.push({ label: tr("newFileHere"), run: () => newFile(p) }, { label: tr("newFolderHere"), run: () => newFolder(p) }, { label: tr("uploadHere"), run: () => pickUpload(p) }, "-");
    else {
      items.push({ label: tr("open"), run: () => activate(p, "file") });
      if (LT.isImagePath(p)) items.push({ label: tr("insertAsFigure"), run: () => ctx.openFigure({ path: p }) });
      items.push("-");
    }
    items.push({ label: tr("rename"), run: () => renameItem(p) }, { label: tr("copyPath"), run: () => copy(p) }, "-", { label: tr("deleteItem"), danger: true, run: () => trashItem(p) });
    showMenu(e.clientX, e.clientY, items);
  });

  /* ---------------------------------------------------------------- drag and drop: move inside the tree, upload from the desktop */
  const scrollBox = $("filesScroll");
  let dropRow = null;
  const targetDirOf = (el) => { const row = el && el.closest && el.closest(".trow"); if (!row) return ""; return row.dataset.type === "dir" ? row.dataset.path : dirOf(row.dataset.path); };
  const markDrop = (el) => {
    if (dropRow) dropRow.classList.remove("droptarget");
    const row = el && el.closest && el.closest(".trow");
    dropRow = row && row.dataset.type === "dir" ? row : null;
    if (dropRow) dropRow.classList.add("droptarget");
    scrollBox.classList.toggle("dropall", !dropRow);
  };
  $("tree").addEventListener("dragstart", (e) => {
    const row = e.target.closest(".trow"); if (!row) return;
    e.dataTransfer.setData("application/x-livetex-path", row.dataset.path);
    e.dataTransfer.setData("text/plain", row.dataset.path);
    e.dataTransfer.effectAllowed = "copyMove";
  });
  scrollBox.addEventListener("dragover", (e) => {
    const types = [...(e.dataTransfer.types || [])];
    if (!types.includes("Files") && !types.includes("application/x-livetex-path")) return;
    e.preventDefault(); e.dataTransfer.dropEffect = types.includes("Files") ? "copy" : "move";
    markDrop(e.target);
  });
  scrollBox.addEventListener("dragleave", (e) => { if (!scrollBox.contains(e.relatedTarget)) { markDrop(null); scrollBox.classList.remove("dropall"); } });
  scrollBox.addEventListener("drop", async (e) => {
    e.preventDefault();
    const dir = targetDirOf(e.target);
    markDrop(null); scrollBox.classList.remove("dropall");
    const inner = e.dataTransfer.getData("application/x-livetex-path");
    if (inner) {
      const to = (dir ? dir + "/" : "") + baseName(inner);
      if (to === inner || dir === inner || dir.startsWith(inner + "/")) return;
      await moveItem(inner, to);
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) await uploadFiles(e.dataTransfer.files, dir);
  });

  /* ---------------------------------------------------------------- trash dialog */
  async function openTrash() {
    const r = await api("/api/trash");
    const ul = $("trashList"); ul.textContent = "";
    const items = (r.ok && r.data.items) || [];
    if (!items.length) { const li = document.createElement("li"); li.className = "meta"; li.textContent = tr("trashEmpty"); ul.append(li); }
    for (const it of items) {
      const li = document.createElement("li");
      const ic = document.createElement("span"); ic.className = "ico"; ic.innerHTML = it.kind === "dir" ? ICONS.folder : iconFor({ type: "file", path: it.path });
      const nm = document.createElement("span"); nm.className = "nm"; nm.dir = "ltr"; nm.textContent = it.path;
      const when = document.createElement("span"); when.className = "meta";
      when.textContent = new Date(it.deleted * 1000).toLocaleString(ctx.lang === "fa" ? "fa-IR" : "en-GB") + " · " + ctx.fmtSize(it.size);
      const b = document.createElement("button"); b.className = "btn sm"; b.textContent = tr("restoreItem");
      b.onclick = async () => {
        const x = await post("/api/trash/restore", { id: it.id });
        if (!x.ok) { toast(x.status === 409 ? tr("restoreExists") : tr("opFailed") + ctx.errText(x)); return; }
        toast(tr("restoredTo", x.data.path)); expandTo(x.data.path);
        await refreshTree(true); ctx.refreshDocs(); ctx.refreshIndex(); openTrash();
      };
      li.append(ic, nm, when, b);
      ul.append(li);
    }
    $("trashPanel").classList.remove("hidden");
  }
  ctx.openTrash = openTrash;

  /* ---------------------------------------------------------------- outline */
  $("chkFloats").checked = store.get("outlineFloats", "1") === "1";
  $("chkFloats").onchange = (e) => { store.set("outlineFloats", e.target.checked ? "1" : "0"); renderOutline(); };
  function renderOutline(markOnly) {
    const box = $("outline");
    if (!box || $("sideOutline").classList.contains("hidden")) return;
    const ol = (ctx.index && ctx.index.outline) || [];
    if (!markOnly) {
      box.textContent = "";
      if (!ol.length) { const m = document.createElement("div"); m.className = "meta pad"; m.textContent = tr("outlineEmpty"); box.append(m); return; }
      const floats = $("chkFloats").checked;
      const secLevels = ol.filter((o) => o.kind === "sec").map((o) => o.level);
      const min = secLevels.length ? Math.min(...secLevels) : 0;
      let lastLevel = min;
      ol.forEach((o, i) => {
        if (o.kind !== "sec" && !floats) return;
        const depth = o.kind === "sec" ? o.level - min : lastLevel - min + 1;
        if (o.kind === "sec") lastLevel = o.level;
        const row = document.createElement("div");
        row.className = "orow " + (o.kind === "sec" ? "lvl" + Math.min(depth, 4) : "float");
        row.style.paddingInlineStart = (8 + depth * 14) + "px";
        row.dataset.i = i;
        if (o.kind !== "sec") { const ic = document.createElement("span"); ic.className = "ico"; ic.innerHTML = o.kind === "table" ? ICONS.table : ICONS.image; row.append(ic); }
        const t = document.createElement("span"); t.className = "ot"; t.dir = "auto";
        t.textContent = (o.kind === "figure" ? tr("figureWord") + ": " : o.kind === "table" ? tr("tableWord") + ": " : "") + (o.title || "—");
        row.title = o.file + ":" + o.line;
        row.append(t);
        row.onclick = () => ctx.openFile(o.file, o.line);
        box.append(row);
      });
    }
    // mark the section that holds the cursor
    box.querySelectorAll(".orow.here").forEach((x) => x.classList.remove("here"));
    const cur = ctx.current; if (!cur || ctx.imageMode) return;
    const ln = ctx.view.state.doc.lineAt(ctx.view.state.selection.main.head).number;
    let best = null;
    box.querySelectorAll(".orow").forEach((row) => { const o = ol[+row.dataset.i]; if (o && o.kind === "sec" && o.file === cur.name && o.line <= ln) best = row; });
    if (best) best.classList.add("here");
  }
  ctx.renderOutline = renderOutline;

  ctx.langHooks.push(() => { lastKey = ""; renderTree(); renderOutline(); });
  setSideTab(store.get("sideTab", "files"));
}
