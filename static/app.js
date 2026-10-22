import { EditorState, EditorSelection, StateEffect, StateField, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
         Decoration, ViewPlugin, MatchDecorator, hoverTooltip, Direction } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";
import { startCompletion } from "@codemirror/autocomplete";
import * as pdfjs from "pdfjs";
import * as LT from "./latex-tools.js";
import { ICONS } from "./icons.js";
import { latexCompletion, imageHover } from "./complete.js";
import { initTree } from "./tree.js";
import { initDialogs } from "./dialogs.js";
import { initSearch } from "./projsearch.js";

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
    merged: (f) => "Changes saved outside the editor were added to " + f + " (Ctrl+Z takes them out)",
    mergeOpen: "%>>>> saved outside the editor, commented out (remove the % to use it, or delete this block):",
    mergeClose: "%<<<< end of the outside version",
    mergeNote: (n) => n + (n === "1" ? " place was" : " places were") + " changed both here and outside the editor. Your text is kept; the outside version follows it as comments, between %>>>> and %<<<<.",
    mergeShow: "Show", mergeOk: "OK",
    seconds: (n) => n + " s", pages: (n) => n + (n === "1" ? " page" : " pages"), nErrors: (n) => n + (n === "1" ? " error" : " errors"), noErrors: "no errors",
    line: (n) => "line " + n, noSource: "No source found for this point", lineStale: "Line is from the last compile",
    lineNotFound: "This line was not found in the PDF (compile first)", pageOf: (a, b) => "page " + a + " of " + b,
    pickVersion: "Pick a version (red = old version, green = current text)", noVersions: "No versions yet",
    unchangedLines: (n) => "⋯ " + n + " unchanged lines", sameText: "This version is identical to the current text.",
    restored: "Version loaded; save to keep it", suggestion: "Suggestion: ", toggleLang: "فا",
    tabFiles: "Files", tabOutline: "Outline", tabSearch: "Search", sideToggle: "Show or hide the side panel",
    docsTitle: "Documents", treeTitle: "Project files", newFile: "New file", newFolder: "New folder", upload: "Upload files",
    refresh: "Refresh", trash: "Trash", collapseAll: "Collapse all folders", rename: "Rename or move",
    deleteItem: "Move to trash", open: "Open", copyPath: "Copy path", insertAsFigure: "Insert as figure",
    newFileHere: "New file here", newFolderHere: "New folder here", uploadHere: "Upload files here",
    newFilePrompt: "Name of the new file (use / for folders)", newFolderPrompt: "Name of the new folder",
    renamePrompt: "New name or path", ok: "OK", cancel: "Cancel", insert: "Insert",
    deleteConfirm: (p) => "Move \u201c" + p + "\u201d to the trash? You can restore it from the trash later.",
    deleteDirty: "It has unsaved changes; they will be lost.", deleteMain: "This is the main file; compiling will not work until you restore it.",
    movedToTrash: (p) => p + " moved to the trash", trashTitle: "Trash", trashEmpty: "The trash is empty",
    trashHint: "Deleted files and folders stay in the _edit_trash folder until you remove them yourself.",
    restoreItem: "Restore", restoredTo: (p) => "Restored: " + p, restoreExists: "A file or folder with that name already exists. Rename it first.",
    uploading: "Uploading…", uploaded: (p) => "Uploaded: " + p, uploadRenamed: (a, b) => b + " saved (" + a + " already existed)",
    tooLarge: (n, mb) => n + " is larger than " + mb + " MB", cannotOpen: "This file type cannot be opened in the editor",
    exists: "A file or folder with this name already exists", opFailed: "Failed: ", dropHere: "Drop files to upload them here",
    pathCopied: "Path copied", movedTo: (p) => "Moved to " + p,
    badExt: "Allowed text files: .tex .bib .sty .cls .md .txt .csv and similar; images can only be uploaded.",
    badName: "Names cannot start with . or ~ and cannot use \\ : * ? \" < > |",
    imgBack: "Back to the editor", imgNoPreview: "No preview for this file type", imgNotFound: "Image not found in the project",
    outlineEmpty: "No sections found. The outline starts at the main file and follows \\input and \\include.",
    showFloats: "Figures and tables", figureWord: "Figure", tableWord: "Table", secWord: "Section", eqWord: "Equation",
    customCmd: "defined in the project",
    searchPh: "Search the project", replacePh: "Replace with", optCase: "Match case", optWord: "Whole word",
    optRegex: "Regular expression ($1 in the replacement is group 1)", optAll: "Also search folders whose names start with _",
    searchBtn: "Search", replaceAll: "Replace all", replaceOne: "Replace", replaceInFile: "Replace in file",
    searchCount: (n, f) => n + (n === "1" ? " match in " : " matches in ") + f + (f === "1" ? " file" : " files"), searchNone: "No matches", searchTrunc: "Only the first matches are shown",
    replaceConfirm: (n, f) => "Replace " + n + (n === "1" ? " match in " : " matches in ") + f + (f === "1" ? " file" : " files") + "? Each file keeps its old version in History.",
    replaceTitle: "Replace in the project", replaced: (n, f) => n + " replaced in " + f + (f === "1" ? " file" : " files"),
    replaceStale: "A file changed in the meantime; the results were refreshed", savingFirst: "Saving the open files first…",
    badRegex: "Bad regular expression: ",
    actCompile: "Save and compile", actRecompile: "Recompile from scratch",
    actRecompileTip: "Delete the build files (latexmk -C) and compile again", moreMenu: "More compile options",
    actFinal: "Final PDF (full quality)", actFinalTip: "Compile, then write the PDF at full compression (smaller file, slower)",
    fastPdf: "quick preview PDF; use Final PDF before sending", fullPdf: "full-quality PDF",
    changedFiles: (n) => "Changed since the last compile (" + n + "):", nothingChanged: "Nothing changed since the last compile",
    actBold: "Bold", actItalic: "Italic", actLr: "Latin text in a Persian line (\\lr)", actSection: "Section",
    actSubsection: "Subsection", actSubsubsection: "Subsubsection", actItemize: "Bulleted list", actEnumerate: "Numbered list",
    actEquation: "Equation", actMath: "Inline math", actFootnote: "Footnote", actCite: "Cite a reference (\\cite)",
    actRef: "Refer to a label (\\ref)", actLink: "Link (\\href or \\url)", actComment: "Comment or uncomment lines",
    actFigure: "Insert figure", actTable: "Insert table", actBib: "New BibTeX entry", actFind: "Find in this file",
    actReplace: "Find and replace in this file", actSearchProject: "Search the project", actOutline: "Show the outline",
    actFiles: "Show the project files", actPalette: "All commands", actLang: "English / Persian interface",
    palettePh: "Type a command", paletteNone: "No command matches",
    stPos: (l, c) => "Ln " + l + ", Col " + c, stWords: (n) => n + (n === "1" ? " word" : " words"), stProject: (n) => "project: " + n,
    stWordsTip: "Words in this file (commands, comments and math are not counted)",
    stProjectTip: "Words in every file included from the main file. Click to count again.",
    noTextFile: "Open a .tex file to insert into", inserted: "Inserted",
    figTitle: "Insert figure", figUploadTab: "Upload", figProjectTab: "From the project",
    figDrop: "Drop an image here, paste it (Ctrl+V) or click to choose a file", figTypes: "PNG, JPG, PDF, EPS or SVG, up to 25 MB",
    figSaveAs: "Save as", figFolder: "in folder", figFilter: "Filter images", figNoImages: "No images in the project yet",
    figWidth: "Width", figWidthUnit: "of the text width", figCaption: "Caption", figShort: "Short caption (list of figures)",
    figShortHint: "Filled in from the caption until you edit it", figLabel: "Label", figPlacement: "Placement",
    figCenter: "Center it (\\centering)", figPickFirst: "Choose an image first", codePreview: "LaTeX code",
    figSvgWarn: "SVG needs \\usepackage{svg}, Inkscape and --shell-escape; it is inserted with \\includesvg.",
    figEpsWarn: "EPS works with XeLaTeX and LuaLaTeX; pdfLaTeX converts it with epstopdf.", labelTaken: "This label is already used",
    tabTitle: "Insert table", tabRows: "Rows", tabCols: "Columns", tabSize: (r, c) => r + " × " + c,
    tabCaption: "Caption", tabShort: "Short caption (list of tables)",
    tabPaste: "Or paste cells from a spreadsheet (Excel, LibreOffice, CSV)", tabPastePh: "Paste cells here",
    tabDetected: (r, c) => "Found " + r + " rows and " + c + " columns", tabEscape: "Escape special characters (& % $ # _ { } ~ ^ \\)",
    tabHeader: "The first row is a header", tabBooktabs: "booktabs rules (\\toprule, \\midrule, \\bottomrule)",
    tabAlign: "Column alignment", alignL: "left", alignC: "center", alignR: "right",
    bibTitle: "New BibTeX entry", bibFile: "Add to", bibType: "Type", bibKey: "Key", bibAuthor: "Authors (Last, First and Last, First)",
    bibTitleF: "Title", bibYear: "Year", bibVenue: "Journal, conference or publisher", bibDoi: "DOI", bibUrl: "URL",
    bibInsertCite: "Insert \\cite{…} at the cursor", bibAdd: "Add entry", bibAdded: (k, f) => k + " added to " + f,
    bibDup: "This key already exists", bibNoFile: "The project has no .bib file. Create one first (for example references.bib).",
    bibNeed: "Key and title are required",
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
    merged: (f) => "تغییرهایی که بیرون از ویرایشگر در " + f + " ذخیره شده بود، به متن شما اضافه شد (با Ctrl+Z برمی‌گردد)",
    mergeOpen: "%>>>> نسخه‌ای که بیرون از ویرایشگر ذخیره شد، به‌صورت توضیح (برای استفاده % را بردارید، یا این بخش را پاک کنید):",
    mergeClose: "%<<<< پایان نسخهٔ بیرونی",
    mergeNote: (n) => "این فایل در " + n + " جا هم اینجا و هم بیرون از ویرایشگر تغییر کرده بود. متن شما مانده است و نسخهٔ بیرونی، به‌صورت توضیح، زیر آن آمده است (میان %>>>> و %<<<<).",
    mergeShow: "نشان بده", mergeOk: "باشد",
    seconds: (n) => n + " ثانیه", pages: (n) => n + " صفحه", nErrors: (n) => n + " خطا", noErrors: "بدون خطا",
    line: (n) => "خط " + n, noSource: "منبعی برای این نقطه پیدا نشد", lineStale: "خط بر اساس آخرین کامپایل است",
    lineNotFound: "این خط در PDF پیدا نشد (کامپایل کنید)", pageOf: (a, b) => "صفحهٔ " + a + " از " + b,
    pickVersion: "یک نسخه را انتخاب کنید (قرمز = نسخهٔ قدیمی، سبز = متن فعلی)", noVersions: "هنوز نسخه‌ای نیست",
    unchangedLines: (n) => "⋯ " + n + " خط بدون تغییر", sameText: "این نسخه با متن فعلی یکی است.",
    restored: "نسخه بارگذاری شد؛ برای ثبت ذخیره کنید", suggestion: "پیشنهاد: ", toggleLang: "EN",
    tabFiles: "فایل‌ها", tabOutline: "ساختار", tabSearch: "جستجو", sideToggle: "نمایش یا پنهان کردن پنل کناری",
    docsTitle: "سندها", treeTitle: "فایل‌های پروژه", newFile: "فایل تازه", newFolder: "پوشهٔ تازه", upload: "بارگذاری فایل",
    refresh: "تازه‌سازی", trash: "سطل بازیافت", collapseAll: "بستن همهٔ پوشه‌ها", rename: "تغییر نام یا جابه‌جایی",
    deleteItem: "انتقال به سطل بازیافت", open: "باز کردن", copyPath: "کپی مسیر", insertAsFigure: "افزودن به‌صورت شکل",
    newFileHere: "فایل تازه در این پوشه", newFolderHere: "پوشهٔ تازه در این پوشه", uploadHere: "بارگذاری فایل در این پوشه",
    newFilePrompt: "نام فایل تازه (برای پوشه از / استفاده کنید)", newFolderPrompt: "نام پوشهٔ تازه",
    renamePrompt: "نام یا مسیر تازه", ok: "تأیید", cancel: "انصراف", insert: "درج",
    deleteConfirm: (p) => "«" + p + "» به سطل بازیافت برود؟ بعداً می‌توانید آن را بازگردانید.",
    deleteDirty: "تغییرهای ذخیره‌نشدهٔ آن از دست می‌رود.", deleteMain: "این فایل اصلی است؛ تا آن را بازنگردانید کامپایل کار نمی‌کند.",
    movedToTrash: (p) => "«" + p + "» به سطل بازیافت رفت", trashTitle: "سطل بازیافت", trashEmpty: "سطل بازیافت خالی است",
    trashHint: "فایل‌ها و پوشه‌های حذف‌شده در پوشهٔ _edit_trash می‌مانند تا خودتان پاکشان کنید.",
    restoreItem: "بازگردانی", restoredTo: (p) => "بازگردانده شد: " + p, restoreExists: "فایل یا پوشه‌ای با همین نام هست. اول نامش را عوض کنید.",
    uploading: "در حال بارگذاری…", uploaded: (p) => "بارگذاری شد: " + p, uploadRenamed: (a, b) => b + " ذخیره شد (" + a + " از قبل بود)",
    tooLarge: (n, mb) => n + " بزرگ‌تر از " + mb + " مگابایت است", cannotOpen: "این نوع فایل در ویرایشگر باز نمی‌شود",
    exists: "فایل یا پوشه‌ای با همین نام هست", opFailed: "انجام نشد: ", dropHere: "فایل‌ها را این‌جا رها کنید تا بارگذاری شوند",
    pathCopied: "مسیر کپی شد", movedTo: (p) => "به " + p + " منتقل شد",
    badExt: "فایل متنی مجاز: ‎.tex .bib .sty .cls .md .txt .csv‎ و مانند این‌ها؛ تصویر را فقط می‌شود بارگذاری کرد.",
    badName: "نام نباید با . یا ~ شروع شود و نباید این نویسه‌ها را داشته باشد: \\ : * ? \" < > |",
    imgBack: "برگشت به ویرایشگر", imgNoPreview: "برای این نوع فایل پیش‌نمایشی نیست", imgNotFound: "این تصویر در پروژه پیدا نشد",
    outlineEmpty: "بخشی پیدا نشد. ساختار از فایل اصلی و فایل‌هایی که با \\input و \\include آمده‌اند خوانده می‌شود.",
    showFloats: "شکل‌ها و جدول‌ها", figureWord: "شکل", tableWord: "جدول", secWord: "بخش", eqWord: "معادله",
    customCmd: "تعریف‌شده در پروژه",
    searchPh: "جستجو در پروژه", replacePh: "جایگزینی با", optCase: "حساس به حروف بزرگ و کوچک", optWord: "فقط کلمهٔ کامل",
    optRegex: "عبارت منظم (در متن جایگزین، $1 یعنی گروه ۱)", optAll: "جستجو در پوشه‌هایی که نامشان با _ شروع می‌شود هم",
    searchBtn: "جستجو", replaceAll: "جایگزینی همه", replaceOne: "جایگزینی", replaceInFile: "جایگزینی در فایل",
    searchCount: (n, f) => n + " مورد در " + f + " فایل", searchNone: "موردی پیدا نشد", searchTrunc: "فقط موردهای اول نمایش داده شده",
    replaceConfirm: (n, f) => n + " مورد در " + f + " فایل جایگزین شود؟ نسخهٔ قبلی هر فایل در تاریخچه می‌ماند.",
    replaceTitle: "جایگزینی در پروژه", replaced: (n, f) => n + " مورد در " + f + " فایل جایگزین شد",
    replaceStale: "یکی از فایل‌ها در این فاصله تغییر کرد؛ نتیجه‌ها تازه شد", savingFirst: "اول فایل‌های باز ذخیره می‌شوند…",
    badRegex: "عبارت منظم درست نیست: ",
    actCompile: "ذخیره و کامپایل", actRecompile: "کامپایل از صفر",
    actRecompileTip: "پاک کردن فایل‌های ساخت (latexmk -C) و کامپایل دوباره", moreMenu: "گزینه‌های بیشتر کامپایل",
    actFinal: "PDF نهایی (کیفیت کامل)", actFinalTip: "کامپایل و سپس ساخت PDF با فشرده‌سازی کامل (فایل کوچک‌تر، کندتر)",
    fastPdf: "PDF پیش‌نمایش سریع؛ پیش از فرستادن، PDF نهایی را بسازید", fullPdf: "PDF با کیفیت کامل",
    changedFiles: (n) => "تغییرها از کامپایل قبلی (" + n + "):", nothingChanged: "از کامپایل قبلی چیزی تغییر نکرده",
    actBold: "پررنگ", actItalic: "کج", actLr: "متن لاتین در خط فارسی (\\lr)", actSection: "بخش",
    actSubsection: "زیربخش", actSubsubsection: "زیربخش سطح سوم", actItemize: "فهرست نشانه‌دار", actEnumerate: "فهرست شماره‌دار",
    actEquation: "معادله", actMath: "ریاضی درون متن", actFootnote: "پانویس", actCite: "ارجاع به منبع (\\cite)",
    actRef: "ارجاع به برچسب (\\ref)", actLink: "پیوند (\\href یا \\url)", actComment: "کامنت کردن یا برداشتن کامنت",
    actFigure: "افزودن شکل", actTable: "افزودن جدول", actBib: "منبع تازه (BibTeX)", actFind: "جستجو در این فایل",
    actReplace: "جستجو و جایگزینی در این فایل", actSearchProject: "جستجو در پروژه", actOutline: "نمایش ساختار سند",
    actFiles: "نمایش فایل‌های پروژه", actPalette: "همهٔ فرمان‌ها", actLang: "رابط فارسی / انگلیسی",
    palettePh: "نام فرمان را بنویسید", paletteNone: "فرمانی پیدا نشد",
    stPos: (l, c) => "سطر " + l + "، ستون " + c, stWords: (n) => n + " واژه", stProject: (n) => "کل پروژه: " + n,
    stWordsTip: "تعداد واژه‌های این فایل (فرمان‌ها، کامنت‌ها و ریاضی شمرده نمی‌شوند)",
    stProjectTip: "واژه‌های همهٔ فایل‌هایی که از فایل اصلی آمده‌اند. برای شمارش دوباره کلیک کنید.",
    noTextFile: "یک فایل .tex باز کنید تا در آن درج شود", inserted: "درج شد",
    figTitle: "افزودن شکل", figUploadTab: "بارگذاری", figProjectTab: "از فایل‌های پروژه",
    figDrop: "تصویر را این‌جا رها کنید، بچسبانید (Ctrl+V) یا برای انتخاب فایل کلیک کنید", figTypes: "PNG، JPG، PDF، EPS یا SVG تا ۲۵ مگابایت",
    figSaveAs: "ذخیره با نام", figFolder: "در پوشهٔ", figFilter: "جستجوی تصویر", figNoImages: "هنوز تصویری در پروژه نیست",
    figWidth: "عرض", figWidthUnit: "از عرض متن", figCaption: "عنوان شکل", figShort: "عنوان کوتاه (برای فهرست شکل‌ها)",
    figShortHint: "تا وقتی خودتان ویرایشش نکنید، از روی عنوان پر می‌شود", figLabel: "برچسب", figPlacement: "جای قرار گرفتن",
    figCenter: "وسط‌چین (\\centering)", figPickFirst: "اول یک تصویر انتخاب کنید", codePreview: "کد LaTeX",
    figSvgWarn: "SVG به \\usepackage{svg}، برنامهٔ Inkscape و گزینهٔ --shell-escape نیاز دارد و با \\includesvg درج می‌شود.",
    figEpsWarn: "EPS با XeLaTeX و LuaLaTeX کار می‌کند؛ pdfLaTeX آن را با epstopdf تبدیل می‌کند.", labelTaken: "این برچسب قبلاً به کار رفته",
    tabTitle: "افزودن جدول", tabRows: "سطر", tabCols: "ستون", tabSize: (r, c) => r + " × " + c,
    tabCaption: "عنوان جدول", tabShort: "عنوان کوتاه (برای فهرست جدول‌ها)",
    tabPaste: "یا سلول‌ها را از صفحه‌گسترده بچسبانید (Excel، LibreOffice، CSV)", tabPastePh: "سلول‌ها را این‌جا بچسبانید",
    tabDetected: (r, c) => r + " سطر و " + c + " ستون پیدا شد", tabEscape: "نویسه‌های ویژه را بی‌اثر کن (⁦& % $ # _ { } ~ ^ \\⁩)",
    tabHeader: "سطر اول عنوان ستون‌هاست", tabBooktabs: "خط‌های booktabs ‏(\\toprule و \\midrule و \\bottomrule)",
    tabAlign: "تراز ستون‌ها", alignL: "چپ", alignC: "وسط", alignR: "راست",
    bibTitle: "منبع تازه (BibTeX)", bibFile: "افزودن به", bibType: "نوع", bibKey: "کلید", bibAuthor: "نویسندگان (Last, First and Last, First)",
    bibTitleF: "عنوان", bibYear: "سال", bibVenue: "مجله، همایش یا ناشر", bibDoi: "DOI", bibUrl: "نشانی (URL)",
    bibInsertCite: "درج \\cite{…} در جای مکان‌نما", bibAdd: "افزودن منبع", bibAdded: (k, f) => k + " به " + f + " افزوده شد",
    bibDup: "این کلید از قبل هست", bibNoFile: "پروژه فایل .bib ندارد. اول یکی بسازید (مثلاً references.bib).",
    bibNeed: "کلید و عنوان لازم است",
    cmPhrases: { "Find": "جستجو", "Replace": "جایگزین", "next": "بعدی", "previous": "قبلی", "all": "همه",
      "match case": "حساس به حروف", "regexp": "عبارت منظم", "by word": "کلمهٔ کامل", "replace": "جایگزینی",
      "replace all": "جایگزینی همه", "close": "بستن", "Go to line": "رفتن به خط", "go": "برو" },
  },
};
let lang = "en";
// In the Persian UI, LaTeX commands inside a label and Latin arguments (file paths, keys) are wrapped in Unicode
// directional isolates, so "\toprule" or "figs/a.png" keep their left-to-right shape inside a right-to-left sentence.
const ISO_CMD = /\\[A-Za-z]+\*?(\{[^{}]*\})?/g;
const isoArg = (x) => (typeof x === "string" && /[A-Za-z]/.test(x) ? "⁨" + x + "⁩" : x);
const tr = (k, ...a) => {
  const v = (I18N[lang] || I18N.en)[k];
  let s = typeof v === "function" ? v(...(lang === "fa" ? a.map(isoArg) : a)) : (v == null ? k : v);
  if (lang === "fa" && typeof s === "string" && s.includes("\\")) s = s.replace(ISO_CMD, "⁦$&⁩");
  return s;
};
const num = (n) => lang === "fa" ? String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]) : String(n);
const fmtNum = (n) => { const s = Number(n || 0).toLocaleString("en-US"); return lang === "fa" ? num(s).replace(/,/g, "٬") : s; };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
let NAMES = {};          // file name -> display name (from the project config)
let appTitle = "";
let mainFile = "main.tex";
const cmPhrases = {};    // one shared object: CodeMirror reads it on every lookup, so switching language updates the search panel

async function api(path, opts) {
  opts = opts || {};
  if (opts.method && opts.method !== "GET") opts.headers = Object.assign({ "X-LiveTeX": "1" }, opts.headers || {});
  let r;
  try { r = await fetch(path, opts); } catch (e) { return { status: 0, ok: false, data: { error: String(e) } }; }
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, data: j };
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
function toast(msg) {
  const el = $("toast"); el.textContent = msg; el.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.add("hidden"), 2600);
}
const errText = (r) => (r && r.data && r.data.error) || (r && r.status) || "?";

/* ------------------------------------------------------------------ language */
const langHooks = [];
function applyLang(l, rerender) {
  lang = I18N[l] ? l : "en";
  const root = document.documentElement;
  root.setAttribute("lang", lang); root.setAttribute("dir", lang === "fa" ? "rtl" : "ltr");
  for (const k of Object.keys(cmPhrases)) delete cmPhrases[k];
  Object.assign(cmPhrases, I18N[lang].cmPhrases);
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = tr(el.dataset.i18nPh); });
  $("btnLang").textContent = tr("toggleLang");
  $("appTitle").textContent = appTitle; document.title = appTitle;
  $("histInfo").textContent = tr("pickVersion");
  buildToolbar();
  if (rerender) {
    renderFiles(); updateEditorHead(); renderBanner(); updatePageInfo(); renderStatus();
    if (lastStatus) { setCompileUI(lastStatus); renderErrors(lastStatus); }
    if (pv.doc) $("zLabel").textContent = num(Math.round(pv.scale * 100)) + (lang === "fa" ? "٪" : "%");
    langHooks.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
}
$("btnLang").onclick = () => { applyLang(lang === "fa" ? "en" : "fa", true); store.set("lang", lang); };

/* ------------------------------------------------------------------ theme */
function applyTheme(v) { if (v) document.documentElement.setAttribute("data-theme", v); else document.documentElement.removeAttribute("data-theme"); }
applyTheme(store.get("theme", ""));
function toggleTheme() {
  const dark = document.documentElement.getAttribute("data-theme") === "dark" ||
    (!document.documentElement.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  const v = dark ? "light" : "dark"; store.set("theme", v); applyTheme(v);
}
$("btnTheme").onclick = toggleTheme;

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
const lineDir = LT.lineDir;   // shared with the dialogs and the search panel (latex-tools.js)
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
// Inside a right-to-left line, keep every \command (with its Latin arguments, LT.CMD_UNIT) one left-to-right unit, so
// "\lr{Gemma 4}" reads as typed. The units are real CodeMirror bidi isolates, also given to bidiIsolatedRanges: CodeMirror
// draws the cursor from its own reading of the line, and without them it put the cursor a character away from where
// typing goes (just before a "}" after a Latin argument).
const cmdMatcher = new MatchDecorator({ regexp: new RegExp(LT.CMD_UNIT.source, "g"),
  decoration: Decoration.mark({ class: "cm-cmd", bidiIsolate: Direction.LTR }) });
const cmdPlugin = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = cmdMatcher.createDeco(v); }
  update(u) { this.decorations = cmdMatcher.updateDeco(u, this.decorations); }
}, {
  decorations: (p) => p.decorations,
  provide: (plugin) => EditorView.bidiIsolatedRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.none),
});

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
const files = new Map();   // project path -> {name, state, savedDoc, sha, eol, diskSha, diskChanged, conflict, loaded}
let current = null;
let order = [];
let view;
let index = { labels: [], bib: [], images: [], graphicspath: [], outline: [], texfiles: [], bibfiles: [], envs: [], commands: [] };
let treeMeta = { entries: [], editable: [".tex", ".bib"], images: LT.IMAGE_EXTS, uploads: "figs/uploads", maxUpload: 25 * 1024 * 1024 };
let imageMode = null;      // project path of the image shown instead of the editor

function isDirty(f) {
  if (typeof f === "string") f = files.get(f);
  if (!f || !f.loaded) return false;
  const doc = f === current ? view.state.doc : f.state.doc;
  return !doc.eq(f.savedDoc);
}
const isEditablePath = (p) => (treeMeta.editable || []).includes(LT.extOf(p));

// shared state and helpers for the other modules (tree, dialogs, search, completion)
const ctx = {
  api, post, tr, num, fmtNum, toast, store, LT, ICONS, pdfjs, errText, langHooks,
  get lang() { return lang; }, get view() { return view; }, get current() { return current; }, files,
  get index() { return index; }, get tree() { return treeMeta; }, set tree(v) { treeMeta = v; },
  get order() { return order; }, get names() { return NAMES; }, get appTitle() { return appTitle; }, get main() { return mainFile; },
  get imageMode() { return imageMode; },
  isDirty, isEditablePath, openFile, showImage, gotoLine, saveFile, reloadFromContent, renamePath, closePath, insertBlock,
  refreshIndex, refreshDocs, startCompletion: () => { view.focus(); startCompletion(view); }, renderFiles, uploadFile,
  renderPdfThumb, countProjectWords,
  // filled in by the modules
  refreshTree: async () => {}, renderTree: () => {}, renderOutline: () => {}, openFigure: () => {}, openTable: () => {},
  openBib: () => {}, openTrash: () => {}, ask: async () => null, confirm: async () => false, prompt: async () => null,
  focusSearch: () => {}, setSideTab: () => {}, newFile: () => {}, newFolder: () => {}, pickUpload: () => {},
};

function imageFromClipboard(cd) {
  if (!cd) return null;
  const text = cd.getData && cd.getData("text/plain");
  if (text && text.trim()) return null;              // spreadsheet cells come with a picture too: paste the text
  for (const it of cd.items || []) {
    if (it.kind === "file" && /^image\/(png|jpe?g|svg\+xml)$/.test(it.type)) {
      const blob = it.getAsFile(); if (!blob) continue;
      const ext = it.type.includes("jpeg") || it.type.includes("jpg") ? "jpg" : it.type.includes("svg") ? "svg" : "png";
      const d = new Date(), p = (x) => String(x).padStart(2, "0");
      const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
      return new File([blob], "pasted-" + stamp + "." + ext, { type: it.type });
    }
  }
  return null;
}
function moveCursorTo(v, e) { const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }); if (pos != null) v.dispatch({ selection: { anchor: pos } }); }
const editorEvents = EditorView.domEventHandlers({
  paste(e) { const f = imageFromClipboard(e.clipboardData); if (!f) return false; e.preventDefault(); ctx.openFigure({ file: f }); return true; },
  drop(e, v) {
    const dt = e.dataTransfer; if (!dt) return false;
    const inner = dt.getData("application/x-livetex-path");
    if (inner) {
      e.preventDefault(); moveCursorTo(v, e);
      if (LT.isImagePath(inner)) ctx.openFigure({ path: inner });
      else if (/\.tex$/i.test(inner)) insertBlock("\\input{" + inner.replace(/\.tex$/i, "") + "}");
      return true;
    }
    const img = [...(dt.files || [])].find((f) => LT.isImagePath(f.name));
    if (img) { e.preventDefault(); moveCursorTo(v, e); ctx.openFigure({ file: img }); return true; }
    return false;
  },
});
const completionExt = latexCompletion(ctx);
const imageHoverExt = imageHover(ctx);
function extensions() {
  return [
    lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(),
    EditorView.lineWrapping, EditorView.perLineTextDirection.of(true), dirPlugin, cmdPlugin,
    EditorState.phrases.of(cmPhrases),
    StreamLanguage.define(stex), syntaxHighlighting(hl),
    search({ top: true }), highlightSelectionMatches(),
    lintPlugin, lintTooltip, flashField, completionExt, imageHoverExt, editorEvents,
    Prec.highest(keymap.of([
      { key: "Mod-s", run: () => { saveCurrent(false); return true; }, preventDefault: true },
      { key: "Mod-Enter", run: () => { saveCurrent(true); return true; }, preventDefault: true },
      { key: "Mod-j", run: () => { showInPdf(); return true; }, preventDefault: true },
      { key: "Mod-h", run: (v) => { openSearchPanel(v); return true; }, preventDefault: true },
      { key: "Mod-b", run: () => { runAction("bold"); return true; }, preventDefault: true },
      { key: "Mod-i", run: () => { runAction("italic"); return true; }, preventDefault: true },
      { key: "Mod-/", run: () => { runAction("comment"); return true; }, preventDefault: true },
      { key: "Mod-Shift-f", run: () => { runAction("searchProject"); return true; }, preventDefault: true },
    ])),
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged || u.selectionSet) { updateEditorHead(); renderStatus(); }
      if (u.docChanged) { renderFiles(); scheduleWordCount(); if (current && current._wasDirty !== isDirty(current)) { current._wasDirty = isDirty(current); ctx.renderTree(); } }
      if (u.selectionSet) { scheduleCursorSave(); scheduleOutlineMark(); }
    }),
  ];
}
function makeState(text) {
  return EditorState.create({ doc: text, extensions: extensions() });
}
view = new EditorView({ state: EditorState.create({ doc: "", extensions: extensions() }), parent: $("cm") });

function updateEditorHead() {
  if (imageMode) { $("curName").textContent = imageMode; $("curDirty").classList.add("hidden"); return; }
  if (!current) { $("curName").textContent = ""; $("curDirty").classList.add("hidden"); return; }
  $("curName").textContent = (NAMES[current.name] ? NAMES[current.name] + " — " : "") + current.name;
  $("curDirty").classList.toggle("hidden", !isDirty(current));
}
function renderStatus() {
  if (!current || imageMode) { $("stPos").textContent = ""; $("stEol").textContent = ""; $("stWords").textContent = ""; return; }
  const h = view.state.selection.main.head, l = view.state.doc.lineAt(h);
  $("stPos").textContent = tr("stPos", num(l.number), num(h - l.from + 1));
  $("stEol").textContent = current.eol || "";
  $("stWords").textContent = current._words != null && /\.tex$/i.test(current.name) ? tr("stWords", fmtNum(current._words)) : "";
  $("stProject").textContent = projectWords != null ? tr("stProject", fmtNum(projectWords)) : "";
}

/* ------------------------------------------------------------------ files: open, cursor memory, reload, rename, close */
const curKey = (name) => "cur:" + appTitle + ":" + name;
function rememberCursor(f) {
  if (!f || !f.loaded) return;
  const st = f === current ? view.state : f.state;
  const r = st.selection.main;
  store.set(curKey(f.name), r.anchor + "," + r.head);
}
let cursorTimer;
function scheduleCursorSave() { clearTimeout(cursorTimer); cursorTimer = setTimeout(() => rememberCursor(current), 1200); }

async function loadFile(name) {
  const r = await api("/api/file?path=" + encodeURIComponent(name));
  if (!r.ok) { toast(tr("readFail") + (r.data && r.data.error ? ": " + r.data.error : "")); return null; }
  const d = r.data;
  let state = makeState(d.content);
  const saved = store.get(curKey(name), "");
  if (saved) {
    const [a, h] = saved.split(",").map((x) => Math.min(Math.max(0, parseInt(x, 10) || 0), state.doc.length));
    state = state.update({ selection: EditorSelection.single(a, h) }).state;
  }
  const f = files.get(name) || { name };
  Object.assign(f, { state, savedDoc: state.doc, sha: d.sha256, diskSha: d.sha256, eol: d.eol, diskChanged: false, conflict: null, loaded: true, _restore: !!saved, _wasDirty: false });
  files.set(name, f);
  return f;
}
async function openFile(name, line, sel) {
  if (!files.has(name)) files.set(name, { name, loaded: false, eol: "" });
  let f = files.get(name);
  if (!f.loaded) { f = await loadFile(name); if (!f) return false; }
  if (current && current !== f) { current.state = view.state; rememberCursor(current); }
  hideImage();
  current = f;
  view.setState(f.state);
  store.set("lastFile:" + appTitle, name);
  renderFiles(); updateEditorHead(); renderBanner(); renderStatus(); ctx.renderTree(); ctx.renderOutline();
  if (line) gotoLine(line, sel);
  else {
    if (f._restore) { f._restore = false; view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) }); }
    view.focus();
  }
  current._words = null; countCurrentWords();
  return true;
}
function gotoLine(n, sel) {
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(n, doc.lines)));
  let anchor = l.from, head = l.from;
  if (sel && sel.col != null) { anchor = Math.min(l.from + sel.col, doc.length); head = Math.min(anchor + (sel.len || 0), doc.length); }
  view.dispatch({ selection: { anchor, head }, effects: [EditorView.scrollIntoView(anchor, { y: "center" }), flashEffect.of(l.from)] });
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
// replace a file's text with the smallest change, so the cursor, the scroll and the undo history stay put
function setDocText(f, text) {
  const old = (f === current ? view.state.doc : f.state.doc).toString();
  if (old === text) return;
  const max = Math.min(old.length, text.length);
  let a = 0, b = 0;
  while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++;
  while (b < max - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
  const changes = { from: a, to: old.length - b, insert: text.slice(a, text.length - b) };
  if (f === current) view.dispatch({ changes });
  else f.state = f.state.update({ changes }).state;
}
// another program (or another tool) saved this file while it was open here: the disk version becomes the saved one,
// and any unsaved typing is merged into it instead of being lost or overwriting it (one Ctrl+Z undoes the merge)
function takeDiskVersion(f, d) {
  const dirty = isDirty(f);
  let conflicts = 0;
  if (!dirty) setDocText(f, d.content);
  else {
    const mine = (f === current ? view.state.doc : f.state.doc).toString();
    const m = LT.merge3(f.savedDoc.toString(), mine, d.content, { open: tr("mergeOpen"), close: tr("mergeClose") });
    setDocText(f, m.text);
    conflicts = m.conflicts;
  }
  f.savedDoc = dirty ? makeState(d.content).doc : (f === current ? view.state.doc : f.state.doc);
  f.sha = d.sha256; f.diskSha = d.sha256; if (d.eol) f.eol = d.eol;
  f.diskChanged = false; f.conflict = null; f._wasDirty = isDirty(f);
  if (conflicts) f.mergeNote = conflicts;
  if (dirty) toast(tr("merged", f.name));
  if (f === current) { renderBanner(); updateEditorHead(); countCurrentWords(); }
  return conflicts;
}
// new saved content arrived from the server (project replace, new bib entry): show it as the saved version
function reloadFromContent(name, content, sha) {
  const f = files.get(name);
  if (!f || !f.loaded) { if (f) { f.diskSha = sha; f.diskChanged = false; } return; }
  if (f === current) { replaceDoc(content, true); f.savedDoc = view.state.doc; }
  else { f.state = makeState(content); f.savedDoc = f.state.doc; }
  f.sha = sha; f.diskSha = sha; f.diskChanged = false; f.conflict = null; f._wasDirty = false;
  renderFiles(); updateEditorHead(); renderBanner(); ctx.renderTree();
  if (f === current) countCurrentWords();
}
function renamePath(oldp, newp) {
  for (const [k, f] of [...files.entries()]) {
    let nk = null;
    if (k === oldp) nk = newp; else if (k.startsWith(oldp + "/")) nk = newp + k.slice(oldp.length);
    if (nk == null) continue;
    files.delete(k); f.name = nk; files.set(nk, f);
    const c = store.get(curKey(k), ""); if (c) store.set(curKey(nk), c);
  }
  if (imageMode && (imageMode === oldp || imageMode.startsWith(oldp + "/"))) imageMode = newp + imageMode.slice(oldp.length);
  if (store.get("lastFile:" + appTitle, "") === oldp) store.set("lastFile:" + appTitle, newp);
  updateEditorHead(); renderFiles();
}
async function closePath(p) {
  let closedCurrent = false;
  for (const k of [...files.keys()]) {
    if (k !== p && !k.startsWith(p + "/")) continue;
    if (current && current.name === k) closedCurrent = true;
    files.delete(k);
  }
  if (imageMode && (imageMode === p || imageMode.startsWith(p + "/"))) hideImage();
  if (closedCurrent) {
    current = null;
    const next = order.find((n) => n !== p && !n.startsWith(p + "/"));
    if (next) await openFile(next);
    else { view.setState(makeState("")); updateEditorHead(); renderStatus(); }
  }
}

/* ------------------------------------------------------------------ image viewer (shown in place of the editor) */
function showImage(path) {
  if (current) { current.state = view.state; rememberCursor(current); }
  imageMode = path;
  $("cm").classList.add("hidden"); $("fmtBar").classList.add("disabled"); $("imgView").classList.remove("hidden");
  $("imgName").textContent = path; $("imgInfo").textContent = "";
  const stage = $("imgStage"); stage.textContent = "";
  const ext = LT.extOf(path);
  const ent = (treeMeta.entries || []).find((e) => e.path === path);
  const size = ent ? fmtSize(ent.size) : "";
  if (ext === ".pdf") {
    const c = document.createElement("canvas"); stage.append(c);
    renderPdfThumb(path, c, Math.min(900, stage.clientWidth - 40 || 700)).then((d) => { if (d) $("imgInfo").textContent = num(d.w) + " × " + num(d.h) + " pt · " + size; });
  } else if (ext === ".eps") {
    const d = document.createElement("div"); d.className = "empty"; d.textContent = tr("imgNoPreview"); stage.append(d);
    $("imgInfo").textContent = size;
  } else {
    const img = document.createElement("img"); img.alt = path;
    img.src = "/api/raw?path=" + encodeURIComponent(path) + "&v=" + (ent ? ent.mtime : Date.now());
    img.onload = () => { $("imgInfo").textContent = num(img.naturalWidth) + " × " + num(img.naturalHeight) + " px · " + size; };
    stage.append(img);
  }
  updateEditorHead(); renderStatus(); ctx.renderTree();
}
function hideImage() {
  if (!imageMode) return;
  imageMode = null;
  $("imgView").classList.add("hidden"); $("cm").classList.remove("hidden"); $("fmtBar").classList.remove("disabled");
  $("imgStage").textContent = "";
  updateEditorHead(); renderStatus(); ctx.renderTree();
}
$("imgBack").onclick = () => { hideImage(); view.focus(); };
$("imgInsert").onclick = () => { const p = imageMode; hideImage(); ctx.openFigure({ path: p }); };
function fmtSize(n) {
  if (n == null) return "";
  const u = lang === "fa" ? ["بایت", "کیلوبایت", "مگابایت"] : ["B", "KB", "MB"];
  let i = 0, x = n; while (x >= 1024 && i < 2) { x /= 1024; i++; }
  return num(i ? x.toFixed(1) : String(x)) + " " + u[i];
}
ctx.fmtSize = fmtSize;
// write LaTeX source into `el` the way the editor shows it: per-line direction, commands kept as left-to-right units
function renderSource(el, text) {
  el.textContent = "";
  for (const line of String(text).split("\n")) {
    const d = document.createElement("div"); d.dir = lineDir(line); d.className = "srcline";
    appendSource(d, line || "\u00a0");
    el.append(d);
  }
}
function appendSource(el, text) {
  for (const seg of LT.cmdSegments(text)) {
    if (seg.cmd) { const s = document.createElement("span"); s.className = "cmdi"; s.textContent = seg.text; el.append(s); }
    else el.append(document.createTextNode(seg.text));
  }
}
ctx.renderSource = renderSource;
ctx.appendSource = appendSource;
async function renderPdfThumb(path, canvas, maxW) {
  try {
    const doc = await pdfjs.getDocument({ url: "/api/raw?path=" + encodeURIComponent(path) }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, (maxW || 240) / v1.width), dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    canvas.style.width = Math.floor(vp.width / dpr) + "px";
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    const d = { w: Math.round(v1.width), h: Math.round(v1.height) };
    doc.destroy();
    return d;
  } catch { return null; }
}

/* ------------------------------------------------------------------ inserting text */
// Put `text` on its own line(s) at the cursor, indented like the current line; LT.CURSOR marks where the cursor ends.
function insertBlock(text, inline) {
  if (imageMode) hideImage();
  if (!current) { toast(tr("noTextFile")); return false; }
  const st = view.state, r = st.selection.main, line = st.doc.lineAt(r.from), endLine = st.doc.lineAt(r.to);
  const indent = /^[ \t]*/.exec(line.text)[0];
  let s = inline ? text : text.replace(/\n/g, "\n" + indent);
  if (!inline) {
    if (st.sliceDoc(line.from, r.from).trim()) s = "\n" + indent + s;
    if (st.sliceDoc(r.to, endLine.to).trim()) s = s + "\n" + indent;
  }
  let c = s.indexOf(LT.CURSOR);
  if (c < 0) c = s.length; else s = s.slice(0, c) + s.slice(c + 1);
  view.dispatch({ changes: { from: r.from, to: r.to, insert: s }, selection: { anchor: r.from + c }, scrollIntoView: true, userEvent: "input" });
  view.focus();
  return true;
}
function toggleWrap(open, close) {
  if (!current || imageMode) { toast(tr("noTextFile")); return; }
  const st = view.state;
  view.dispatch(st.changeByRange((r) => {
    const before = st.sliceDoc(Math.max(0, r.from - open.length), r.from), sel = st.sliceDoc(r.from, r.to);
    const after = st.sliceDoc(r.to, r.to + close.length);
    const plan = LT.wrapPlan(before, sel, after, open, close);
    if (plan === "unwrap-outer") return { changes: [{ from: r.from - open.length, to: r.from }, { from: r.to, to: r.to + close.length }],
      range: EditorSelection.range(r.from - open.length, r.to - open.length) };
    if (plan === "unwrap-inner") return { changes: { from: r.from, to: r.to, insert: sel.slice(open.length, sel.length - close.length) },
      range: EditorSelection.range(r.from, r.to - open.length - close.length) };
    return { changes: [{ from: r.from, insert: open }, { from: r.to, insert: close }], range: EditorSelection.range(r.from + open.length, r.to + open.length) };
  }), { scrollIntoView: true, userEvent: "input" });
  view.focus();
}
function selectionText() { const r = view.state.selection.main; return view.state.sliceDoc(r.from, r.to); }
function heading(cmd) {
  const sel = current && !imageMode ? selectionText() : "";
  if (sel && !sel.includes("\n")) return toggleWrap("\\" + cmd + "{", "}");
  insertBlock("\\" + cmd + "{" + LT.CURSOR + "}");
}
function list(env) {
  const sel = current && !imageMode ? selectionText() : "";
  const items = sel.split("\n").filter((l) => l.trim()).map((l) => "  \\item " + l.trim().replace(/^\\item\s*/, ""));
  insertBlock("\\begin{" + env + "}\n" + (items.length ? items.join("\n") + LT.CURSOR : "  \\item " + LT.CURSOR) + "\n\\end{" + env + "}");
}
function refCmd(cmd) {
  const sel = current && !imageMode ? selectionText() : "";
  if (sel) return toggleWrap("\\" + cmd + "{", "}");
  if (insertBlock("\\" + cmd + "{" + LT.CURSOR + "}", true)) setTimeout(() => startCompletion(view), 30);
}
function link() {
  const sel = current && !imageMode ? selectionText() : "";
  if (/^(https?:\/\/|www\.)\S+$/.test(sel.trim())) return toggleWrap("\\url{", "}");
  if (sel) return insertBlock("\\href{" + LT.CURSOR + "}{" + sel + "}", true);
  insertBlock("\\url{" + LT.CURSOR + "}", true);
}
function toggleComment() {
  if (!current || imageMode) { toast(tr("noTextFile")); return; }
  const st = view.state, nums = new Set();
  for (const r of st.selection.ranges) {
    const a = st.doc.lineAt(r.from).number;
    let b = st.doc.lineAt(r.to).number;
    if (r.to > r.from && st.doc.lineAt(r.to).from === r.to) b--;
    for (let n = a; n <= Math.max(a, b); n++) nums.add(n);
  }
  const lines = [...nums].sort((x, y) => x - y).map((n) => st.doc.line(n));
  const plan = LT.commentPlan(lines.map((l) => l.text));
  const changes = plan.map((p) => p.op === "add" ? { from: lines[p.i].from, insert: "% " } : { from: lines[p.i].from + p.at, to: lines[p.i].from + p.at + p.len });
  if (changes.length) view.dispatch({ changes, userEvent: "input" });
  view.focus();
}

/* ------------------------------------------------------------------ actions: toolbar + command palette + shortcuts */
const ACTIONS = [
  { id: "bold", label: "actBold", key: "Ctrl+B", icon: "bold", tb: 1, run: () => toggleWrap("\\textbf{", "}") },
  { id: "italic", label: "actItalic", key: "Ctrl+I", icon: "italic", tb: 1, run: () => toggleWrap("\\textit{", "}") },
  { id: "lr", label: "actLr", icon: "lr", tb: 1, text: "lr", run: () => toggleWrap("\\lr{", "}") },
  { id: "section", label: "actSection", icon: "heading", tb: 2, text: "§", run: () => heading("section") },
  { id: "subsection", label: "actSubsection", tb: 2, text: "§²", run: () => heading("subsection") },
  { id: "subsubsection", label: "actSubsubsection", tb: 2, text: "§³", run: () => heading("subsubsection") },
  { id: "itemize", label: "actItemize", icon: "ul", tb: 3, run: () => list("itemize") },
  { id: "enumerate", label: "actEnumerate", icon: "ol", tb: 3, run: () => list("enumerate") },
  { id: "equation", label: "actEquation", icon: "equation", tb: 4, run: () => { const s = current && !imageMode ? selectionText() : ""; insertBlock("\\begin{equation}\n  " + s + LT.CURSOR + "\n\\end{equation}"); } },
  { id: "math", label: "actMath", icon: "math", tb: 4, run: () => toggleWrap("$", "$") },
  { id: "footnote", label: "actFootnote", icon: "footnote", tb: 5, run: () => toggleWrap("\\footnote{", "}") },
  { id: "cite", label: "actCite", icon: "cite", tb: 5, run: () => refCmd("cite") },
  { id: "ref", label: "actRef", icon: "ref", tb: 5, run: () => refCmd("ref") },
  { id: "link", label: "actLink", icon: "link", tb: 5, run: link },
  { id: "comment", label: "actComment", key: "Ctrl+/", icon: "comment", tb: 6, text: "%", run: toggleComment },
  { id: "figure", label: "actFigure", icon: "image", tb: 7, run: () => ctx.openFigure({}) },
  { id: "table", label: "actTable", icon: "table", tb: 7, run: () => ctx.openTable() },
  { id: "bib", label: "actBib", icon: "bib", tb: 7, run: () => ctx.openBib() },
  { id: "save", label: "save", key: "Ctrl+S", run: () => saveCurrent(false) },
  { id: "compile", label: "actCompile", key: "Ctrl+Enter", run: () => saveCurrent(true) },
  { id: "recompile", label: "actRecompile", run: () => recompileClean() },
  { id: "finalPdf", label: "actFinal", run: () => compileFinal() },
  { id: "showInPdf", label: "showInPdf", key: "Ctrl+J", run: () => showInPdf() },
  { id: "history", label: "history", run: () => openHistory() },
  { id: "find", label: "actFind", key: "Ctrl+F", run: () => { hideImage(); openSearchPanel(view); } },
  { id: "replace", label: "actReplace", key: "Ctrl+H", run: () => { hideImage(); openSearchPanel(view); } },
  { id: "searchProject", label: "actSearchProject", key: "Ctrl+Shift+F", run: () => ctx.focusSearch(current && !imageMode ? selectionText() : "") },
  { id: "outline", label: "actOutline", run: () => { showSide(true); ctx.setSideTab("outline"); } },
  { id: "files", label: "actFiles", run: () => { showSide(true); ctx.setSideTab("files"); } },
  { id: "newFile", label: "newFile", run: () => ctx.newFile() },
  { id: "newFolder", label: "newFolder", run: () => ctx.newFolder() },
  { id: "upload", label: "upload", run: () => ctx.pickUpload() },
  { id: "trash", label: "trash", run: () => ctx.openTrash() },
  { id: "toggleSide", label: "sideToggle", run: () => showSide(!sideShown()) },
  { id: "theme", label: "themeTip", run: toggleTheme },
  { id: "lang", label: "actLang", run: () => $("btnLang").click() },
];
const ACT = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
function runAction(id) { const a = ACT[id]; if (a) a.run(); }
function buildToolbar() {
  const bar = $("fmtBar"); bar.textContent = "";
  let group = 0;
  for (const a of ACTIONS.filter((x) => x.tb)) {
    if (group && a.tb !== group) { const s = document.createElement("span"); s.className = "sep"; bar.append(s); }
    group = a.tb;
    const b = document.createElement("button");
    b.className = "ibtn"; b.type = "button"; b.dataset.act = a.id;
    b.title = tr(a.label) + (a.key ? " (" + a.key + ")" : "");
    b.setAttribute("aria-label", tr(a.label));
    if (a.text) { const s = document.createElement("span"); s.className = "itext"; s.textContent = a.text; b.append(s); }
    else b.innerHTML = ICONS[a.icon] || "";
    b.onmousedown = (e) => e.preventDefault();       // keep the editor selection
    b.onclick = () => a.run();
    bar.append(b);
  }
}

/* command palette (Ctrl+Shift+P or F1) */
let palSel = 0, palItems = [];
function openPalette() {
  $("palette").classList.remove("hidden");
  const inp = $("palInput"); inp.value = ""; renderPalette(); inp.focus();
}
function closePalette() { $("palette").classList.add("hidden"); }
function renderPalette() {
  const q = $("palInput").value.trim().toLowerCase();
  palItems = ACTIONS.filter((a) => {
    if (!q) return true;
    const hay = (tr(a.label) + " " + I18N.en[a.label] + " " + I18N.fa[a.label] + " " + a.id).toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  const ul = $("palList"); ul.textContent = "";
  if (!palItems.length) { const li = document.createElement("li"); li.className = "meta"; li.textContent = tr("paletteNone"); ul.append(li); return; }
  palItems.forEach((a, i) => {
    const li = document.createElement("li");
    if (i === palSel) li.classList.add("active");
    const l = document.createElement("span"); l.textContent = tr(a.label);
    const k = document.createElement("kbd"); k.textContent = a.key || ""; if (!a.key) k.classList.add("hidden");
    li.append(l, k);
    li.onmousedown = (e) => { e.preventDefault(); closePalette(); a.run(); };
    ul.append(li);
  });
  const act = ul.querySelector(".active"); if (act) act.scrollIntoView({ block: "nearest" });
}
$("palInput").oninput = () => { palSel = 0; renderPalette(); };
$("palInput").onkeydown = (e) => {
  if (e.key === "ArrowDown") { palSel = Math.min(palItems.length - 1, palSel + 1); renderPalette(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { palSel = Math.max(0, palSel - 1); renderPalette(); e.preventDefault(); }
  else if (e.key === "Enter") { const a = palItems[palSel]; closePalette(); if (a) a.run(); e.preventDefault(); }
  else if (e.key === "Escape") { closePalette(); view.focus(); e.preventDefault(); e.stopPropagation(); }
};
$("palette").addEventListener("mousedown", (e) => { if (e.target === $("palette")) closePalette(); });
$("btnPalette").innerHTML = ICONS.palette;
$("btnPalette").onclick = openPalette;

/* compile menu */
$("btnCompileMore").onclick = (e) => {
  e.stopPropagation();
  const m = $("compileMenu"), r = $("btnCompileMore").getBoundingClientRect();
  m.classList.toggle("hidden");
  m.style.top = (r.bottom + 4) + "px";
  m.style.left = Math.max(8, Math.min(window.innerWidth - m.offsetWidth - 8, r.left)) + "px";
};
document.addEventListener("mousedown", (e) => { if (!$("compileMenu").contains(e.target) && e.target !== $("btnCompileMore")) $("compileMenu").classList.add("hidden"); });
$("compileMenu").querySelectorAll("[data-act]").forEach((b) => { b.onclick = () => { $("compileMenu").classList.add("hidden"); runAction(b.dataset.act); }; });

/* side panel visibility */
const sideShown = () => !$("paneFiles").classList.contains("hidden");
function showSide(on) {
  $("paneFiles").classList.toggle("hidden", !on); $("rzSide").classList.toggle("hidden", !on);
  store.set("side", on ? "1" : "0");
}
$("btnSide").innerHTML = ICONS.side;
$("btnSide").onclick = () => showSide(!sideShown());

/* ------------------------------------------------------------------ word count */
let projectWords = null, wcTimer = null, pwTimer = null;
function scheduleWordCount() { clearTimeout(wcTimer); wcTimer = setTimeout(countCurrentWords, 900); }
async function countCurrentWords() {
  const f = current;
  if (!f || !/\.tex$/i.test(f.name)) { renderStatus(); return; }
  const r = await post("/api/wordcount", { text: view.state.doc.toString() });
  if (r.ok && f === current) { f._words = r.data.words; renderStatus(); }
}
function countProjectWords() {
  clearTimeout(pwTimer);
  pwTimer = setTimeout(async () => { const r = await api("/api/wordcount"); if (r.ok) { projectWords = r.data.total; renderStatus(); } }, 300);
}
$("stProject").onclick = countProjectWords;

/* ------------------------------------------------------------------ index (labels, citations, outline, images) */
let idxTimer = null;
function refreshIndex() {
  clearTimeout(idxTimer);
  idxTimer = setTimeout(async () => {
    const r = await api("/api/index");
    if (r.ok) { index = r.data; ctx.renderOutline(); }
  }, 250);
}

/* ------------------------------------------------------------------ main documents list */
function renderFiles() {
  const ul = $("fileList"); ul.textContent = "";
  for (const name of order) {
    const f = files.get(name);
    const li = document.createElement("li");
    if (current && current.name === name && !imageMode) li.classList.add("active");
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
async function refreshDocs() {
  const r = await api("/api/files");
  if (!r.ok) return;
  order = r.data.files.map((x) => x.name);
  for (const x of r.data.files) if (!files.has(x.name)) files.set(x.name, { name: x.name, loaded: false, eol: "", diskSha: x.sha256 });
  renderFiles();
}

/* ------------------------------------------------------------------ save / conflicts */
function saveFile(name) {
  const f = typeof name === "string" ? files.get(name) : name;
  if (!f || !f.loaded) return Promise.resolve(true);
  if (f._saving) return f._saving;         // one request at a time per file; a second call waits for the first
  f._saving = saveFileOnce(f).finally(() => { f._saving = null; });
  return f._saving;
}
async function saveFileOnce(f, again = true) {
  if (f.conflict) { toast(tr("conflictFirst")); return false; }
  if (!isDirty(f)) return true;
  const doc = f === current ? view.state.doc : f.state.doc;
  const r = await api("/api/file", { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: f.name, content: doc.toString(), base_sha256: f.sha }) });
  if (r.status === 409) {
    // saved elsewhere since this file was loaded: merge that version in; save again only if nothing overlapped
    const conflicts = takeDiskVersion(f, r.data);
    renderFiles();
    return conflicts || !again ? false : saveFileOnce(f, false);
  }
  if (!r.ok) { toast(tr("saveFail") + errText(r)); return false; }
  f.sha = r.data.sha256; f.diskSha = r.data.sha256; f.savedDoc = doc; f.diskChanged = false; f._wasDirty = false;
  renderFiles(); updateEditorHead(); ctx.renderTree();
  refreshIndex(); countProjectWords();
  return true;
}
async function saveCurrent(thenCompile) {
  const f = current; if (!f) return;
  if (f.conflict) { toast(tr("conflictFirst")); return; }
  if (!isDirty(f)) { if (thenCompile || $("chkOnSave").checked) compile(); else toast(tr("nothingToSave")); return; }
  if (!(await saveFile(f))) return;
  toast(tr("saved"));
  if (thenCompile || $("chkOnSave").checked) compile();
}
function renderBanner() {
  const b = $("banner"); const f = current;
  if (!f || (!f.conflict && !f.mergeNote)) { b.classList.add("hidden"); b.textContent = ""; return; }
  b.classList.remove("hidden"); b.textContent = "";
  const msg = document.createElement("span");
  const mk = (label, fn, cls) => { const x = document.createElement("button"); x.className = "btn sm " + (cls || ""); x.textContent = label; x.onclick = fn; return x; };
  if (!f.conflict) {
    msg.textContent = tr("mergeNote", num(f.mergeNote));
    b.append(msg,
      mk(tr("mergeShow"), () => {
        const doc = view.state.doc, head = view.state.selection.main.head, text = doc.toString();
        let at = text.indexOf("\n" + LT.MERGE_OPEN, head);
        if (at < 0) at = text.indexOf("\n" + LT.MERGE_OPEN);
        if (at >= 0) gotoLine(doc.lineAt(at + 1).number);
      }, "primary"),
      mk(tr("mergeOk"), () => { f.mergeNote = 0; renderBanner(); }));
    return;
  }
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
    const extra = [...files.values()].filter((f) => f.loaded && !order.includes(f.name)).map((f) => "open=" + encodeURIComponent(f.name));
    const r = await api("/api/changes" + (extra.length ? "?" + extra.join("&") : ""));
    if (!r.ok) return;
    const names = r.data.files.map((x) => x.name);
    if (names.join("|") !== order.join("|")) { order = names; renderFiles(); }
    const list = r.data.files.concat((r.data.open || []).filter((x) => !x.missing));
    let changed = false;
    for (const x of list) {
      const f = files.get(x.name);
      if (f && !f.loaded && f.diskSha !== x.sha256) { f.diskSha = x.sha256; f.diskChanged = true; renderFiles(); changed = true; continue; }
      if (!f || !f.loaded || f.diskSha === x.sha256) continue;
      if (f.conflict && f.conflict.sha === x.sha256) continue;
      changed = true;
      const d = await api("/api/file?path=" + encodeURIComponent(x.name));
      if (!d.ok) continue;
      if (f._saving) continue;          // our own save is in flight; its answer settles the version
      takeDiskVersion(f, d.data);
      renderFiles();
    }
    if (changed) { refreshIndex(); countProjectWords(); }
    const bd = r.data.build;
    if (bd && !compPolling && (bd.state === "running" || (bd.finished && bd.finished !== lastBuildSeen))) pollCompile();
  } catch {}
}
setInterval(pollChanges, 2000);
setInterval(() => { if (document.visibilityState === "visible") ctx.refreshTree(); }, 6000);
window.addEventListener("focus", () => { ctx.refreshTree(); refreshIndex(); });

/* ------------------------------------------------------------------ compile */
let compTimer = null;
async function compile(mode) {
  $("compileStatus").className = "cstatus run";
  await api("/api/compile" + (mode === "clean" ? "?clean=1" : mode === "final" ? "?final=1" : ""), { method: "POST" });
  pollCompile();
}
async function recompileClean() {
  if (current && isDirty(current) && !(await saveFile(current))) return;
  compile("clean");
}
async function compileFinal() {
  if (current && isDirty(current) && !(await saveFile(current))) return;
  compile("final");
}
let lastStatus = null;
function setCompileUI(s) {
  lastStatus = s;
  const running = s.state === "running";
  $("spin").classList.toggle("hidden", !running);
  $("compileLabel").textContent = running ? tr("compiling") : tr("compile");
  const el = $("compileStatus");
  if (running) { el.className = "cstatus run"; el.textContent = tr("seconds", num(Math.floor(s.seconds))); }
  else if (s.state === "ok") { el.className = "cstatus ok"; el.textContent = "✓ " + tr("pages", s.pages ? num(s.pages) : "?") + " · " + tr("seconds", num(Math.round(s.seconds))); }
  else if (s.state === "error") { el.className = "cstatus err"; el.textContent = "✗ " + tr("nErrors", num(s.errors.length)); }
  else { el.className = "cstatus"; el.textContent = ""; }
  el.title = running ? "" : compileTip(s);
}
function compileTip(s) {
  const lines = [];
  if (s.quality) lines.push(tr(s.quality === "full" ? "fullPdf" : "fastPdf"));
  if (s.changed_count) lines.push(tr("changedFiles", num(s.changed_count)), ...s.changed.map((f) => "  " + f), ...(s.changed_count > s.changed.length ? ["  …"] : []));
  else if (s.finished) lines.push(tr("nothingChanged"));
  return lines.join("\n");
}
function renderErrors(s) {
  const ul = $("errList"); ul.textContent = "";
  for (const e of s.errors) {
    const li = document.createElement("li");
    const loc = document.createElement("span"); loc.className = "loc"; loc.textContent = e.file ? e.file + ":" + e.line : "—";
    const msg = document.createElement("span"); msg.className = "msg"; msg.textContent = e.message;
    li.append(loc, msg);
    const known = e.file && (order.includes(e.file) || (isEditablePath(e.file) && (treeMeta.entries || []).some((x) => x.path === e.file)));
    if (known) li.onclick = () => openFile(e.file, e.line);
    ul.append(li);
  }
  $("logTail").textContent = s.log_tail || "";
  $("drawerCount").textContent = s.state === "ok" ? tr("noErrors") : tr("nErrors", num(s.errors.length));
}
let compPolling = false, lastBuildSeen = null;   // a build the server started by itself (outside change) is followed too
function pollCompile() {
  clearTimeout(compTimer);
  compPolling = true;
  const tick = async () => {
    const r = await api("/api/compile/status");
    if (!r.ok) { compTimer = setTimeout(tick, 1000); return; }
    setCompileUI(r.data); renderErrors(r.data);
    if (r.data.state === "running" || r.data.queued) { compTimer = setTimeout(tick, 700); return; }
    compPolling = false; lastBuildSeen = r.data.finished;
    if (r.data.state === "error") $("drawer").classList.remove("collapsed");
    if (r.data.state === "ok") $("drawer").classList.add("collapsed");
    if (r.data.pdf !== false) loadPdf();
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
  if (!current || imageMode) return;
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
async function openHistory() {
  if (!current || imageMode) return;
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
}
$("btnHistory").onclick = openHistory;
$("histClose").onclick = () => $("histPanel").classList.add("hidden");
$("histPanel").onclick = (e) => { if (e.target === $("histPanel")) $("histPanel").classList.add("hidden"); };
$("histRestore").onclick = () => {
  if (histSel == null) return;
  replaceDoc(histSel, true); $("histPanel").classList.add("hidden"); toast(tr("restored"));
};

/* ------------------------------------------------------------------ uploads (tree and figure dialog share this) */
async function uploadFile(file, dir, name, imageOnly) {
  const max = treeMeta.maxUpload || 25 * 1024 * 1024;
  if (file.size > max) { toast(tr("tooLarge", file.name, num(Math.round(max / 1048576)))); return null; }
  let r;
  try {
    r = await fetch("/api/upload?dir=" + encodeURIComponent(dir || "") + "&name=" + encodeURIComponent(name || file.name) + (imageOnly ? "&kind=image" : ""),
      { method: "POST", headers: { "X-LiveTeX": "1", "Content-Type": "application/octet-stream" }, body: file });
  } catch (e) { toast(tr("opFailed") + e); return null; }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) { toast(tr("opFailed") + ((j && j.error) || r.status)); return null; }
  return j;
}

/* ------------------------------------------------------------------ resizers */
document.querySelectorAll(".resizer").forEach((rz) => {
  const target = $(rz.dataset.target);
  rz.onmousedown = (e) => {
    e.preventDefault(); rz.classList.add("drag");
    const startX = e.clientX, startW = target.getBoundingClientRect().width, left = rz.dataset.side === "left";
    const mv = (ev) => {
      const dx = ev.clientX - startX, w = Math.max(160, startW + (left ? dx : -dx));
      target.style.flex = "none"; target.style.width = w + "px";
    };
    const up = () => { rz.classList.remove("drag"); document.removeEventListener("mousemove", mv); document.removeEventListener("mouseup", up); store.set("w-" + rz.dataset.target, target.style.width); };
    document.addEventListener("mousemove", mv); document.addEventListener("mouseup", up);
  };
  const w = store.get("w-" + rz.dataset.target, ""); if (w) { target.style.flex = "none"; target.style.width = w; }
});

/* ------------------------------------------------------------------ global keys, unload, init */
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented) return;          // already handled by the editor's own key bindings (no double save)
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  const inDialog = !!document.querySelector(".modal:not(.hidden)");
  if (mod && k === "s") { e.preventDefault(); saveCurrent(false); }
  else if (mod && e.key === "Enter" && !inDialog) { e.preventDefault(); saveCurrent(true); }
  else if (mod && k === "j" && !inDialog) { e.preventDefault(); showInPdf(); }
  else if ((mod && e.shiftKey && k === "p") || e.key === "F1") { e.preventDefault(); openPalette(); }
  else if (mod && e.shiftKey && k === "f" && !inDialog) { e.preventDefault(); runAction("searchProject"); }
});
window.addEventListener("beforeunload", (e) => {
  rememberCursor(current);
  if ([...files.values()].some((f) => f.loaded && isDirty(f))) { e.preventDefault(); e.returnValue = ""; }
});
$("drawerArrow").textContent = "▲";

let outlineTimer;
function scheduleOutlineMark() { clearTimeout(outlineTimer); outlineTimer = setTimeout(() => ctx.renderOutline(true), 400); }

async function init() {
  lintOn = store.get("lint", "1") === "1"; $("chkLint").checked = lintOn;
  $("chkOnSave").checked = store.get("onSave", "0") === "1";
  $("chkOnSave").onchange = (e) => store.set("onSave", e.target.checked ? "1" : "0");
  const cr = await api("/api/config");
  const cfg = cr.ok ? cr.data : { title: "RTL LaTeX Live Editor", ui: "en", names: {} };
  NAMES = cfg.names || {};
  appTitle = cfg.title || "RTL LaTeX Live Editor";
  mainFile = cfg.main || "main.tex";
  initDialogs(ctx); initTree(ctx); initSearch(ctx);
  applyLang(store.get("lang", cfg.ui || "en"), false);
  showSide(store.get("side", "1") === "1");
  const [pr, fr] = await Promise.all([api("/api/phrases"), api("/api/files")]);
  if (pr.ok) { phrases = pr.data; matchers = buildMatchers(); }
  if (fr.ok) {
    order = fr.data.files.map((x) => x.name);
    for (const x of fr.data.files) files.set(x.name, { name: x.name, loaded: false, eol: "", diskSha: x.sha256 });
  }
  renderFiles();
  await ctx.refreshTree(true);
  const last = store.get("lastFile:" + (cfg.title || ""), "");
  const lastOk = last && (order.includes(last) || (treeMeta.entries || []).some((e) => e.path === last && isEditablePath(last)));
  if (lastOk) await openFile(last);
  else if (order.length) await openFile(order[0]);
  langHooks.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  refreshIndex(); countProjectWords();
  const st = await api("/api/compile/status");
  if (st.ok) { setCompileUI(st.data); renderErrors(st.data); lastBuildSeen = st.data.finished; if (st.data.state === "running") pollCompile(); }
  if (!st.ok || st.data.pdf !== false) loadPdf();     // no request (and no 404 in the console) before the first compile
}
init();
window.__editor = { get view() { return view; }, openFile, showInPdf, gotoLine, files, pv, ctx, runAction };
