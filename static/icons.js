// 16 px line icons (stroke = currentColor, so they follow the light and dark themes)
const s = (body, extra = "") =>
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + extra + ">" + body + "</svg>";

export const ICONS = {
  newFile: s('<path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6z"/><path d="M9 1.8v3.8h3.8M8 8v4M6 10h4"/>'),
  newFolder: s('<path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.4 1.6h5.6a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/><path d="M8 7.2v4M6 9.2h4"/>'),
  upload: s('<path d="M8 10.5V2.5M5 5.3 8 2.3l3 3"/><path d="M2.5 10.5v2.2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2.2"/>'),
  refresh: s('<path d="M13.2 6.2A5.3 5.3 0 1 0 13.4 9.6"/><path d="M13.6 2.6v3.8H9.8"/>'),
  trash: s('<path d="M2.5 4.2h11M6.2 4.2V2.6h3.6v1.6M3.8 4.2l.7 9.2a1 1 0 0 0 1 .9h5a1 1 0 0 0 1-.9l.7-9.2"/><path d="M6.6 7v4.6M9.4 7v4.6"/>'),
  collapse: s('<path d="M4.5 6.5 8 3l3.5 3.5M4.5 13 8 9.5l3.5 3.5"/>'),
  folder: s('<path d="M1.8 4.2a1 1 0 0 1 1-1h3.4l1.4 1.6h5.6a1 1 0 0 1 1 1v6.9a1 1 0 0 1-1 1H2.8a1 1 0 0 1-1-1z"/>'),
  folderOpen: s('<path d="M1.8 12.7V4.2a1 1 0 0 1 1-1h3.4l1.4 1.6h5a1 1 0 0 1 1 1v1"/><path d="M1.8 12.7 3.6 7.6a1 1 0 0 1 .9-.7h9.6a.6.6 0 0 1 .6.8l-1.6 4.4a1 1 0 0 1-.9.6z"/>'),
  file: s('<path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6z"/><path d="M9 1.8v3.8h3.8"/>'),
  tex: s('<path d="M9 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V5.6z"/><path d="M9 1.8v3.8h3.8M5.6 8.4h4.8M5.6 10.6h4.8M5.6 12.6h2.8"/>'),
  bib: s('<path d="M3 2.6a1 1 0 0 1 1-1h8.2v10.6H4a1 1 0 0 0-1 1z"/><path d="M3 13.2a1 1 0 0 0 1 1h8.2v-2M6 4.6h3.6"/>'),
  image: s('<rect x="2" y="2.6" width="12" height="10.8" rx="1.2"/><circle cx="5.8" cy="6.2" r="1.2"/><path d="m2.4 12.4 3.8-3.6 2.6 2.4 2-1.8 2.8 2.8"/>'),
  table: s('<rect x="2" y="2.6" width="12" height="10.8" rx="1"/><path d="M2 6.2h12M2 9.8h12M6.2 2.6v10.8M10 2.6v10.8"/>'),
  bold: s('<path d="M4.5 2.8h4.3a2.5 2.5 0 0 1 0 5H4.5zM4.5 7.8h5a2.7 2.7 0 0 1 0 5.4h-5z"/>', ' stroke-width="1.9"'),
  italic: s('<path d="M7 2.8h5M4 13.2h5M9.6 2.8 6.4 13.2"/>'),
  lr: s('<path d="M3 5.2h10M3 5.2l2.4-2.2M3 5.2l2.4 2.2M13 10.8H3M13 10.8l-2.4-2.2M13 10.8l-2.4 2.2"/>'),
  ul: s('<circle cx="3.2" cy="4.2" r=".9"/><circle cx="3.2" cy="8" r=".9"/><circle cx="3.2" cy="11.8" r=".9"/><path d="M6.4 4.2h7.2M6.4 8h7.2M6.4 11.8h7.2"/>'),
  ol: s('<path d="M2.6 3.2h1v3M2.4 6.2h1.6M2.4 9.6c0-1 1.8-1 1.8 0 0 .7-1.8 1.4-1.8 2.4h1.8M6.4 4.6h7.2M6.4 8h7.2M6.4 11.6h7.2"/>'),
  equation: s('<path d="M12.4 3.2H4l4.2 4.8L4 12.8h8.4"/>'),
  math: s('<path d="M2.8 13c1.2 0 1.6-.8 2-2.6l1.4-6.6c.4-1.8.8-2.6 2-2.6M4.6 7h3.6M9.6 8.2l3.4 4.4M13 8.2l-3.4 4.4"/>'),
  footnote: s('<path d="M2.6 6.6h6.6M2.6 10h4.4M2.6 13.2h8"/><path d="M11.4 2.6v4M10.2 3.6l1.2-1 "/>'),
  cite: s('<path d="M5.6 3.4H3.2v9.2h2.4M10.4 3.4h2.4v9.2h-2.4"/><path d="M7 8h2"/>'),
  ref: s('<path d="M3.8 6h9M3.2 10h9M6.6 2.6 5.4 13.4M10.6 2.6 9.4 13.4"/>'),
  link: s('<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.9.9"/><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.9-.9"/>'),
  comment: s('<path d="M5.2 13.4 10.8 2.6M3 8h1.4M11.6 8H13"/>'),
  heading: s('<path d="M3.2 3v10M9.4 3v10M3.2 8h6.2"/>'),
  palette: s('<rect x="2" y="3" width="12" height="10" rx="1.4"/><path d="m4.6 6.4 2 1.6-2 1.6M8.2 10h3.2"/>'),
  search: s('<circle cx="7" cy="7" r="4.4"/><path d="m10.4 10.4 3.2 3.2"/>'),
  side: s('<rect x="2" y="2.8" width="12" height="10.4" rx="1.2"/><path d="M6 2.8v10.4"/>'),
  caret: s('<path d="m6 4 4 4-4 4"/>'),
  star: s('<path d="m8 2.4 1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z"/>'),
};
