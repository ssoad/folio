// Annotate mode (phones): the notes-app toolbar's tools on the page.
//
// - Text tools (highlight, underline, strikethrough, wavy) mark text: a drag
//   selects whole words from where the finger went down to where it is, and
//   lifting the finger saves them as a highlight in the current style
//   (MARK_EVENT, handled by the popup menu, so they're stored and synced
//   like any other highlight).
// - Pen and marker draw freehand ink on PDF pages. Ink is kept per book and
//   page in normalised page coordinates, so it follows zoom and resizing,
//   and is drawn on its own canvas above the page image (unaffected by the
//   dark theme's inversion).
// - The eraser removes ink strokes and highlights it passes over.
// While a tool is on, a drag doesn't scroll, turn the page or open menus.

import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { recognizeShape } from "./shapeRecognizer";
import { STICKY_SIZE } from "./inkConstants";
import { InkBook, Stroke, changePage, loadBookInk } from "./inkStore";

export const MARK_EVENT = "folio-mark-text";
export const MARK_MODE_EVENT = "folio-mark-mode";
export const ERASE_NOTE_EVENT = "folio-erase-note";
export const ANNOTATE_HISTORY_EVENT = "folio-annotate-history";

export interface MarkEventDetail {
  // PDFs: the page the mark is on
  chapterDocIndex?: number;
}

export type TextTool = "background" | "underline" | "strikethrough" | "wavy";
export type InkTool = "pen" | "marker";
export type InsertTool = "text" | "sticky";
export type AnnotateTool = TextTool | InkTool | InsertTool | "eraser" | "lasso";
export const isInsertTool = (tool: AnnotateTool | null): tool is InsertTool =>
  tool === "text" || tool === "sticky";
// The stroke eraser removes whole strokes; the pixel eraser only the part
// it passes over
export type EraserKind = "stroke" | "pixel";

export const TEXT_TOOLS: TextTool[] = [
  "background",
  "underline",
  "strikethrough",
  "wavy",
];
export const isTextTool = (tool: AnnotateTool | null): tool is TextTool =>
  !!tool && (TEXT_TOOLS as string[]).includes(tool);
export const isInkTool = (tool: AnnotateTool | null): tool is InkTool =>
  tool === "pen" || tool === "marker";

export interface InkStyle {
  color: string;
  // Fraction of the page width
  width: number;
  // Pen: "fountain" follows pen pressure, "ball" is even
  kind?: PenKind;
}
export type PenKind = "fountain" | "ball";

// A stroke that ended with the pen held still becomes the shape it looks
// like (line, circle, rectangle...). Points are matched in page pixels so
// the page's proportions don't skew them.
const HOLD_MS = 450;
const applyShape = (stroke: Stroke, pageWidth: number, pageHeight: number) => {
  const px: number[] = [];
  for (let i = 0; i < stroke.points.length; i += 2) {
    px.push(stroke.points[i] * pageWidth, stroke.points[i + 1] * pageHeight);
  }
  const shape = recognizeShape(px);
  if (!shape) return stroke;
  const points: number[] = [];
  for (let i = 0; i < shape.points.length; i += 2) {
    points.push(shape.points[i] / pageWidth, shape.points[i + 1] / pageHeight);
  }
  return { ...stroke, points, pressures: undefined };
};

// Strokes, text boxes and sticky notes, and how they're stored: inkStore

// Undo history: ink is handled here; highlights by the toolbar (it has the
// book's renderer and the store)
// Entries with the same group (one eraser swipe) are undone together
export type HistoryEntry =
  | {
      kind: "ink";
      page: number;
      stroke: Stroke;
      added: boolean;
      group?: number;
    }
  | { kind: "note"; note: any; added: boolean; group?: number }
  // Strokes changed (moved, recoloured, partly erased): "added" means the
  // change is in place
  | {
      kind: "replace";
      page: number;
      before: Stroke[];
      after: Stroke[];
      added: boolean;
      group?: number;
    };
export interface EraseNoteDetail {
  key: string;
  group: number;
}
let eraseGroup = 0;

const MARKING_CLASS = "folio-marking";
const MARKING_STYLE = `html.${MARKING_CLASS}, html.${MARKING_CLASS} body {
  touch-action: none !important;
  -webkit-touch-callout: none !important;
  -webkit-user-select: none !important;
  user-select: none !important;
}
html.${MARKING_CLASS}.folio-text-tool, html.${MARKING_CLASS}.folio-text-tool body {
  -webkit-user-select: text !important;
  user-select: text !important;
}
.folio-ink {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 5;
}`;

let tool: AnnotateTool | null = null;
let bookKey = "";
const inkStyles: Record<InkTool, InkStyle> = {
  pen: { color: "#1f2937", width: 0.004, kind: "fountain" },
  marker: { color: "#facc15", width: 0.022 },
};
const boundDocs = new WeakSet<Document>();
const markedDocs = new Set<Document>();
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

// With the native ink layer and stylus-only drawing, fingers still scroll
// and turn pages while a pen is picked
export const isMarkMode = () =>
  tool !== null && !(isNativeInkTool() && !drawWithFinger);
export const getAnnotateTool = () => tool;
export const getInkStyle = (inkTool: InkTool) => inkStyles[inkTool];
export const setInkStyle = (inkTool: InkTool, style: Partial<InkStyle>) => {
  inkStyles[inkTool] = { ...inkStyles[inkTool], ...style };
  syncNativeInk();
};

const applyMarkMode = (doc: Document) => {
  if (!doc?.documentElement) return;
  if (!doc.getElementById("folio-mark-mode")) {
    const style = doc.createElement("style");
    style.id = "folio-mark-mode";
    style.textContent = MARKING_STYLE;
    (doc.head || doc.documentElement).appendChild(style);
  }
  // The native layer takes the pen's touches; the page keeps the rest
  doc.documentElement.classList.toggle(
    MARKING_CLASS,
    tool !== null && !isNativeInkTool()
  );
  doc.documentElement.classList.toggle("folio-text-tool", isTextTool(tool));
};

export const setAnnotateTool = (next: AnnotateTool | null, key?: string) => {
  if (next !== "lasso" && lasso) clearLasso();
  tool = next;
  if (key !== undefined) bookKey = key;
  if (!next) {
    undoStack.length = 0;
    redoStack.length = 0;
    emitHistory();
  }
  markedDocs.forEach((doc) => {
    if (!doc.defaultView) {
      markedDocs.delete(doc);
      return;
    }
    applyMarkMode(doc);
    if (!isTextTool(next)) doc.getSelection()?.removeAllRanges();
  });
  window.dispatchEvent(new CustomEvent(MARK_MODE_EVENT, { detail: next }));
  syncNativeInk();
};

/* ---------- history ---------- */

const emitHistory = () =>
  window.dispatchEvent(
    new CustomEvent(ANNOTATE_HISTORY_EVENT, {
      detail: { canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 },
    })
  );
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export const pushHistory = (entry: HistoryEntry) => {
  undoStack.push(entry);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  emitHistory();
};
// Moves the last change (or group of changes) from one stack to the other
const takeLast = (from: HistoryEntry[], to: HistoryEntry[]) => {
  const taken: HistoryEntry[] = [];
  const last = from[from.length - 1];
  while (from.length) {
    const entry = from[from.length - 1];
    if (
      taken.length &&
      (last.group === undefined || entry.group !== last.group)
    ) {
      break;
    }
    taken.push(from.pop()!);
    to.push(entry);
  }
  emitHistory();
  return taken;
};
// Reverses the last change; note changes are returned for the caller to
// apply (added: whether the note should now exist)
export const undo = (): HistoryEntry[] =>
  takeLast(undoStack, redoStack)
    .map((entry) => applyEntry(entry, !entry.added))
    .filter((entry): entry is HistoryEntry => !!entry);
export const redo = (): HistoryEntry[] =>
  takeLast(redoStack, undoStack)
    .reverse()
    .map((entry) => applyEntry(entry, entry.added))
    .filter((entry): entry is HistoryEntry => !!entry);
const applyEntry = (
  entry: HistoryEntry,
  exists: boolean
): HistoryEntry | null => {
  if (entry.kind === "replace") {
    const [from, to] = exists
      ? [entry.before, entry.after]
      : [entry.after, entry.before];
    replaceStrokes(
      entry.page,
      from.map((s) => s.id),
      to
    );
    if (lasso && lasso.page === entry.page) clearLasso();
    return null;
  }
  if (entry.kind === "ink") {
    if (exists) addStroke(entry.page, entry.stroke);
    else removeStroke(entry.page, entry.stroke.id);
    return null;
  }
  return { ...entry, added: exists };
};

/* ---------- ink storage ---------- */

let inkVersion = 0;
const loadInk = (): InkBook => loadBookInk(bookKey);
// Swaps strokes for others in the same place in the drawing order
const replaceStrokes = (page: number, removeIds: string[], add: Stroke[]) => {
  if (!bookKey) return;
  changePage(bookKey, page, removeIds, add);
  inkVersion++;
  redrawAll();
};
const addStroke = (page: number, stroke: Stroke) =>
  replaceStrokes(page, [stroke.id], [stroke]);
const removeStroke = (page: number, id: string) =>
  replaceStrokes(page, [id], []);

// Ink changed elsewhere (a sync): draw it again
export const refreshInk = () => {
  inkVersion++;
  redrawAll();
};

/* ---------- ink drawing ---------- */

// PDF pages are frames named "...-N"
const pageIndexOf = (doc: Document) => {
  const id = doc.defaultView?.frameElement?.getAttribute("id") || "";
  const index = parseInt(id.split("-").reverse()[0]);
  return isNaN(index) ? undefined : index;
};

const inkCanvasOf = (doc: Document) =>
  doc.querySelector<HTMLCanvasElement>("canvas.folio-ink");

// Dark pages are the paper inverted, so ink is too: very dark ink shows
// light on them (and white ink dark on light pages), with its hue kept
let isDarkPage = false;
const visibleInk = (color: string) => {
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!hex) return color;
  const [r, g, b] = hex.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (isDarkPage ? light >= 0.3 : light <= 0.85) return color;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue =
      max === r
        ? ((g - b) / d + (g < b ? 6 : 0)) * 60
        : max === g
          ? ((b - r) / d + 2) * 60
          : ((r - g) / d + 4) * 60;
  }
  return `hsl(${Math.round(hue)}, ${Math.round(sat * 100)}%, ${Math.round(
    (1 - light) * 100
  )}%)`;
};

/* ---------- text boxes and sticky notes ---------- */

export const INK_TEXT_EDIT_EVENT = "folio-ink-text-edit";
export interface InkTextEdit {
  page: number;
  item: Stroke;
  isNew: boolean;
  // The page's size in CSS pixels (to lay text out)
  pageWidth: number;
  pageHeight: number;
}
export { STICKY_SIZE };
export const TEXT_FONT = '"Inter", system-ui, -apple-system, sans-serif';
const LINE_HEIGHT = 1.3;

// Words wrapped to the box's width (and long words broken)
export const layoutText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) => {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (ctx.measureText(next).width <= maxWidth || !line.trim()) {
        line = next;
        while (ctx.measureText(line).width > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (
            cut > 1 &&
            ctx.measureText(line.slice(0, cut)).width > maxWidth
          )
            cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
};

// A text box's height, a fraction of the page height, for its text
export const measureTextHeight = (
  item: Stroke,
  pageWidth: number,
  pageHeight: number
) => {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !pageHeight) return 0.05;
  const fontPx = (item.fontSize || 0.03) * pageWidth;
  ctx.font = `${fontPx}px ${TEXT_FONT}`;
  const lines = layoutText(
    ctx,
    item.text || " ",
    (item.width || 0.4) * pageWidth
  );
  return (lines.length * fontPx * LINE_HEIGHT + fontPx * 0.4) / pageHeight;
};

const drawTextItem = (
  ctx: CanvasRenderingContext2D,
  item: Stroke,
  w: number,
  h: number
) => {
  const x = item.points[0] * w;
  const y = item.points[1] * h;
  if (item.tool === "sticky") {
    // A folded note
    const size = STICKY_SIZE * w;
    const fold = size * 0.28;
    ctx.fillStyle = item.color || "#fde68a";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x + size, y + size - fold);
    ctx.lineTo(x + size - fold, y + size);
    ctx.lineTo(x, y + size);
    ctx.closePath();
    ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.stroke();
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";
    ctx.beginPath();
    ctx.moveTo(x + size, y + size - fold);
    ctx.lineTo(x + size - fold, y + size - fold);
    ctx.lineTo(x + size - fold, y + size);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    for (let i = 1; i <= 3; i++) {
      const ly = y + (size * i) / 4.6;
      ctx.beginPath();
      ctx.moveTo(x + size * 0.18, ly);
      ctx.lineTo(x + size * (i === 3 ? 0.5 : 0.78), ly);
      ctx.stroke();
    }
    return;
  }
  const fontPx = (item.fontSize || 0.03) * w;
  ctx.font = `${fontPx}px ${TEXT_FONT}`;
  ctx.textBaseline = "top";
  ctx.fillStyle = visibleInk(item.color);
  const lines = layoutText(ctx, item.text || "", (item.width || 0.4) * w);
  lines.forEach((line, i) =>
    ctx.fillText(line, x, y + fontPx * 0.2 + i * fontPx * LINE_HEIGHT)
  );
};

// The box a text box or sticky note takes on the page (normalised)
const itemBox = (item: Stroke, aspect: number) => {
  const x = item.points[0];
  const y = item.points[1];
  if (item.tool === "sticky") {
    return { x, y, w: STICKY_SIZE, h: STICKY_SIZE * aspect };
  }
  return { x, y, w: item.width || 0.4, h: item.height || 0.05 };
};
const isTextItem = (s: Stroke) => s.tool === "text" || s.tool === "sticky";

// The topmost text box or sticky note at a point of the page
const textItemAt = (page: number, nx: number, ny: number, aspect: number) => {
  const items = (loadInk()[page] || []).filter(isTextItem);
  for (let i = items.length - 1; i >= 0; i--) {
    const b = itemBox(items[i], aspect);
    const pad = 0.01;
    if (
      nx >= b.x - pad &&
      nx <= b.x + b.w + pad &&
      ny >= b.y - pad &&
      ny <= b.y + b.h + pad
    ) {
      return items[i];
    }
  }
  return null;
};

const requestTextEdit = (detail: InkTextEdit) =>
  window.dispatchEvent(new CustomEvent(INK_TEXT_EDIT_EVENT, { detail }));

// Saves a text box or sticky note from the editor (one undo step)
export const saveTextItem = (page: number, item: Stroke, isNew: boolean) => {
  const before = isNew
    ? []
    : (loadInk()[page] || []).filter((s) => s.id === item.id);
  replaceStrokes(page, [item.id], [item]);
  pushHistory({ kind: "replace", page, before, after: [item], added: true });
};
export const deleteTextItem = (page: number, item: Stroke) => {
  const before = (loadInk()[page] || []).filter((s) => s.id === item.id);
  if (!before.length) return;
  replaceStrokes(page, [item.id], []);
  pushHistory({ kind: "replace", page, before, after: [], added: true });
};

const drawStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  w: number,
  h: number
) => {
  const pts = stroke.points;
  if (pts.length < 2) return;
  if (isTextItem(stroke)) {
    ctx.save();
    drawTextItem(ctx, stroke, w, h);
    ctx.restore();
    return;
  }
  ctx.save();
  const color = stroke.tool === "pen" ? visibleInk(stroke.color) : stroke.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, stroke.width * w);
  ctx.lineCap = stroke.tool === "marker" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = stroke.tool === "marker" ? 0.38 : 1;
  const pressures = stroke.tool === "pen" ? stroke.pressures : undefined;
  if (pressures && pressures.length * 2 === pts.length && pts.length > 2) {
    // Stylus: each segment as wide as the pen was pressed
    const base = ctx.lineWidth;
    for (let i = 2; i < pts.length; i += 2) {
      const p = (pressures[i / 2 - 1] + pressures[i / 2]) / 2;
      ctx.lineWidth = Math.max(0.6, base * (0.35 + 0.9 * p));
      ctx.beginPath();
      ctx.moveTo(pts[i - 2] * w, pts[i - 1] * h);
      ctx.lineTo(pts[i] * w, pts[i + 1] * h);
      ctx.stroke();
    }
  } else if (pts.length === 2) {
    ctx.beginPath();
    ctx.arc(pts[0] * w, pts[1] * h, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smoothed through the midpoints, so fast strokes aren't jagged
    ctx.beginPath();
    ctx.moveTo(pts[0] * w, pts[1] * h);
    for (let i = 2; i < pts.length - 2; i += 2) {
      const mx = ((pts[i] + pts[i + 2]) / 2) * w;
      const my = ((pts[i + 1] + pts[i + 3]) / 2) * h;
      ctx.quadraticCurveTo(pts[i] * w, pts[i + 1] * h, mx, my);
    }
    ctx.lineTo(pts[pts.length - 2] * w, pts[pts.length - 1] * h);
    ctx.stroke();
  }
  ctx.restore();
};

const drawPage = (doc: Document, extra?: Stroke) => {
  const overrides =
    lasso && lasso.doc === doc && lasso.preview ? lasso.preview : null;
  const canvas = inkCanvasOf(doc);
  const page = pageIndexOf(doc);
  if (!canvas || page === undefined) return;
  const ratio = doc.defaultView?.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * ratio))
    canvas.width = Math.round(w * ratio);
  if (canvas.height !== Math.round(h * ratio)) {
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const strokes = loadInk()[page] || [];
  strokes.forEach((stroke) =>
    drawStroke(ctx, overrides?.get(stroke.id) || stroke, w, h)
  );
  if (extra) drawStroke(ctx, extra, w, h);
  if (lasso && lasso.doc === doc) drawLasso(ctx, w, h);
  canvas.dataset.version = inkStamp(w, h);
};

const inkStamp = (w: number, h: number) =>
  `${inkVersion}:${bookKey}:${isDarkPage}:${w}x${h}`;

const redrawAll = () =>
  markedDocs.forEach((doc) => {
    if (doc.defaultView && inkCanvasOf(doc)) drawPage(doc);
  });

// Called for each PDF page as it's rendered (and on a timer): adds the ink
// canvas to the page and draws its strokes when anything changed
export const syncInk = (doc: Document, key: string, isDark: boolean) => {
  if (key) bookKey = key;
  isDarkPage = isDark;
  const layer = doc.querySelector<HTMLElement>(".koodoPDFLayer");
  if (!layer) return;
  let canvas = inkCanvasOf(doc);
  if (!canvas || canvas.parentElement !== layer) {
    canvas?.remove();
    canvas = doc.createElement("canvas");
    canvas.className = "folio-ink";
    if (getComputedStyle(layer).position === "static") {
      layer.style.position = "relative";
    }
    layer.appendChild(canvas);
  }
  if (
    canvas.dataset.version !== inkStamp(canvas.clientWidth, canvas.clientHeight)
  ) {
    drawPage(doc);
  }
};

/* ---------- text marking ---------- */

type Caret = { node: Node; offset: number };

const caretAt = (doc: Document, x: number, y: number): Caret | null => {
  const anyDoc = doc as any;
  if (anyDoc.caretRangeFromPoint) {
    const range: Range | null = anyDoc.caretRangeFromPoint(x, y);
    if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
      return { node: range.startContainer, offset: range.startOffset };
    }
  } else if (anyDoc.caretPositionFromPoint) {
    const pos = anyDoc.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode.nodeType === Node.TEXT_NODE) {
      return { node: pos.offsetNode, offset: pos.offset };
    }
  }
  return null;
};

const WORD_CHAR = /[\p{L}\p{N}\p{M}'’_-]/u;

// Moves a caret to the start (or end) of the word it's in, so a mark never
// cuts a word in two
const snapToWord = (caret: Caret, toEnd: boolean): Caret => {
  const text = caret.node.textContent || "";
  let offset = Math.min(caret.offset, text.length);
  if (toEnd) {
    while (offset < text.length && WORD_CHAR.test(text[offset])) offset++;
  } else {
    while (offset > 0 && WORD_CHAR.test(text[offset - 1])) offset--;
  }
  return { node: caret.node, offset };
};

const isBefore = (doc: Document, a: Caret, b: Caret) => {
  const range = doc.createRange();
  range.setStart(a.node, a.offset);
  range.collapse(true);
  return range.comparePoint(b.node, b.offset) >= 0;
};

const selectBetween = (doc: Document, from: Caret, to: Caret) => {
  const [first, last] = isBefore(doc, from, to) ? [from, to] : [to, from];
  const start = snapToWord(first, false);
  const end = snapToWord(last, true);
  const range = doc.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return;
  }
  const selection = doc.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
};

/* ---------- erasing ---------- */

const ERASER_RADIUS = 14;
let eraserKind: EraserKind = "stroke";
export const getEraserKind = () => eraserKind;
export const setEraserKind = (kind: EraserKind) => {
  eraserKind = kind;
};

let pieceCount = 0;
// The pixel eraser: the stroke without the points within the eraser's
// reach of (x, y), as one stroke per run of points left. The line is
// filled in every couple of pixels first, so the cut is clean.
const splitStroke = (
  stroke: Stroke,
  x: number,
  y: number,
  radius: number,
  rect: DOMRect
): Stroke[] => {
  const src = stroke.points;
  const pressures = stroke.pressures;
  const dense: { x: number; y: number; p?: number }[] = [];
  for (let i = 0; i < src.length; i += 2) {
    const a = { x: src[i], y: src[i + 1], p: pressures?.[i / 2] };
    if (i + 2 >= src.length) {
      dense.push(a);
      break;
    }
    const b = { x: src[i + 2], y: src[i + 3], p: pressures?.[i / 2 + 1] };
    const length = Math.hypot(
      (b.x - a.x) * rect.width,
      (b.y - a.y) * rect.height
    );
    const n = Math.max(1, Math.ceil(length / 2));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      dense.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        p: a.p !== undefined && b.p !== undefined ? a.p + (b.p - a.p) * t : a.p,
      });
    }
  }
  const reach = radius + (stroke.width * rect.width) / 2;
  const pieces: Stroke[] = [];
  let run: typeof dense = [];
  const flush = () => {
    if (run.length >= 2) {
      pieces.push({
        ...stroke,
        id: `${stroke.id.split("~")[0]}~${(pieceCount++).toString(36)}`,
        points: run.flatMap((p) => [p.x, p.y]),
        pressures: pressures ? run.map((p) => p.p ?? 0.5) : undefined,
      });
    }
    run = [];
  };
  for (const p of dense) {
    const away = Math.hypot(
      rect.left + p.x * rect.width - x,
      rect.top + p.y * rect.height - y
    );
    if (away <= reach) flush();
    else run.push(p);
  }
  flush();
  return pieces;
};

// Distance from a point to a line segment
const segmentDistance = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length))
    : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
};

// The eraser's path between two touch samples, every few pixels, so a fast
// swipe still erases everything it crossed
const eraserPath = (
  from: { x: number; y: number } | null,
  x: number,
  y: number
) => {
  if (!from) return [{ x, y }];
  const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / 6));
  return Array.from({ length: steps }, (_, i) => ({
    x: from.x + ((x - from.x) * (i + 1)) / steps,
    y: from.y + ((y - from.y) * (i + 1)) / steps,
  }));
};

const eraseAt = (doc: Document, x: number, y: number, erased: Set<string>) => {
  // Highlights under the eraser
  doc.querySelectorAll<HTMLElement>(".kookit-note").forEach((note) => {
    const key = note.dataset.key;
    if (!key || erased.has(key)) return;
    const hit = Array.from(note.getClientRects()).some(
      (r) =>
        x >= r.left - 4 &&
        x <= r.right + 4 &&
        y >= r.top - 4 &&
        y <= r.bottom + 4
    );
    if (!hit) return;
    erased.add(key);
    window.dispatchEvent(
      new CustomEvent<EraseNoteDetail>(ERASE_NOTE_EVENT, {
        detail: { key, group: eraseGroup },
      })
    );
  });
  // Ink strokes under the eraser
  const canvas = inkCanvasOf(doc);
  const page = pageIndexOf(doc);
  if (!canvas || page === undefined) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const strokes = loadInk()[page] || [];
  for (const stroke of strokes) {
    if (erased.has(stroke.id)) continue;
    if (isTextItem(stroke)) {
      // Text boxes and notes go whole, whichever eraser
      const b = itemBox(stroke, rect.width / rect.height);
      const px = (x - rect.left) / rect.width;
      const py = (y - rect.top) / rect.height;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        erased.add(stroke.id);
        removeStroke(page, stroke.id);
        pushHistory({
          kind: "ink",
          page,
          stroke,
          added: false,
          group: eraseGroup,
        });
      }
      continue;
    }
    const reach = ERASER_RADIUS + (stroke.width * rect.width) / 2;
    const pts = stroke.points;
    for (let i = 0; i < pts.length; i += 2) {
      // Each point, and the line to the next one
      const j = Math.min(i + 2, pts.length - 2);
      const distance = segmentDistance(
        x,
        y,
        rect.left + pts[i] * rect.width,
        rect.top + pts[i + 1] * rect.height,
        rect.left + pts[j] * rect.width,
        rect.top + pts[j + 1] * rect.height
      );
      if (distance <= reach) {
        erased.add(stroke.id);
        if (eraserKind === "pixel") {
          // Only the part under the eraser goes
          const pieces = splitStroke(stroke, x, y, ERASER_RADIUS, rect);
          replaceStrokes(page, [stroke.id], pieces);
          pushHistory({
            kind: "replace",
            page,
            before: [stroke],
            after: pieces,
            added: true,
            group: eraseGroup,
          });
          break;
        }
        removeStroke(page, stroke.id);
        pushHistory({
          kind: "ink",
          page,
          stroke,
          added: false,
          group: eraseGroup,
        });
        break;
      }
    }
  }
};

/* ---------- touch input ---------- */

const MIN_DRAG = 8;

const pageGeometry = (doc: Document, x: number, y: number) => {
  const canvas = inkCanvasOf(doc);
  const page = pageIndexOf(doc);
  if (!canvas || page === undefined) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    page,
    rect,
    nx: (x - rect.left) / rect.width,
    ny: (y - rect.top) / rect.height,
    aspect: rect.width / rect.height,
  };
};

// A tap with the text or sticky-note tool: edit the one there, or add one
const placeTextItem = (doc: Document, x: number, y: number) => {
  const g = pageGeometry(doc, x, y);
  if (!g || g.nx < 0 || g.nx > 1 || g.ny < 0 || g.ny > 1) return;
  const existing = textItemAt(g.page, g.nx, g.ny, g.aspect);
  if (existing) {
    requestTextEdit({
      page: g.page,
      item: existing,
      isNew: false,
      pageWidth: g.rect.width,
      pageHeight: g.rect.height,
    });
    return;
  }
  const isSticky = tool === "sticky";
  const width = isSticky ? STICKY_SIZE : 0.45;
  const item: Stroke = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    tool: isSticky ? "sticky" : "text",
    color: isSticky ? "#fde68a" : inkStyles.pen.color,
    width,
    // Kept on the page
    points: [Math.min(g.nx, 1 - width), g.ny],
    text: "",
    fontSize: 0.032,
  };
  requestTextEdit({
    page: g.page,
    item,
    isNew: true,
    pageWidth: g.rect.width,
    pageHeight: g.rect.height,
  });
};

// Reading: a tap on a sticky note opens it (from the reader's tap handler,
// utils/reader/mouseEvent); true when it did
export const openStickyAt = (doc: Document, x: number, y: number) => {
  const hit = stickyAt(doc, x, y);
  if (hit) requestTextEdit(hit);
  return !!hit;
};

const stickyAt = (doc: Document, x: number, y: number): InkTextEdit | null => {
  const g = pageGeometry(doc, x, y);
  if (!g) return null;
  const item = textItemAt(g.page, g.nx, g.ny, g.aspect);
  if (!item || item.tool !== "sticky") return null;
  return {
    page: g.page,
    item,
    isNew: false,
    pageWidth: g.rect.width,
    pageHeight: g.rect.height,
  };
};

export const bindMarkMode = (doc: Document) => {
  if (!doc?.documentElement) return;
  markedDocs.add(doc);
  applyMarkMode(doc);
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);

  let start: Caret | null = null;
  let startPoint: { x: number; y: number } | null = null;
  let isDragging = false;
  let stroke: Stroke | null = null;
  let erased = new Set<string>();
  let frame = 0;

  const inkPoint = (x: number, y: number) => {
    const rect = inkCanvasOf(doc)?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return [(x - rect.left) / rect.width, (y - rect.top) / rect.height];
  };

  // A touch with a tool isn't a tap on a highlight (which would open its
  // note sheet) or on the page: the engine's handlers don't see it
  let lastErase: { x: number; y: number } | null = null;
  let lastInkMove: { x: number; y: number; time: number } | null = null;
  let tapPoint: { x: number; y: number } | null = null;
  const swallow = (event: Event) => {
    if (!tool) {
      return;
    }
    event.stopPropagation();
    if (event.type === "click") event.preventDefault();
  };
  ["click", "mousedown", "mouseup", "pointerdown", "pointerup"].forEach(
    (type) => doc.addEventListener(type, swallow, { capture: true })
  );
  doc.addEventListener(
    "touchstart",
    (event: TouchEvent) => {
      start = null;
      startPoint = null;
      isDragging = false;
      stroke = null;
      erased = new Set();
      if (!tool || event.touches.length !== 1) return;
      if (tool === "lasso") {
        const touch = event.touches[0];
        startPoint = { x: touch.clientX, y: touch.clientY };
        lassoStart(doc, touch.clientX, touch.clientY);
        return;
      }
      if (isInsertTool(tool)) {
        const touch = event.touches[0];
        startPoint = { x: touch.clientX, y: touch.clientY };
        tapPoint = { x: touch.clientX, y: touch.clientY };
        return;
      }
      // Pen and marker strokes come from the native layer
      if (isNativeInkTool()) return;
      const touch = event.touches[0];
      startPoint = { x: touch.clientX, y: touch.clientY };
      if (isTextTool(tool)) {
        start = caretAt(doc, touch.clientX, touch.clientY);
      } else if (isInkTool(tool)) {
        const point = inkPoint(touch.clientX, touch.clientY);
        if (point) {
          const style = inkStyles[tool];
          stroke = {
            id:
              Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            tool,
            color: style.color,
            width: style.width,
            points: point,
          };
        }
      } else if (tool === "eraser") {
        eraseGroup++;
        lastErase = { x: touch.clientX, y: touch.clientY };
        eraseAt(doc, touch.clientX, touch.clientY, erased);
      }
    },
    { passive: true, capture: true }
  );
  doc.addEventListener(
    "touchmove",
    (event: TouchEvent) => {
      if (!tool || !startPoint) return;
      // The drag annotates: no scrolling, page turns or native selection
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const touch = event.touches[0];
      if (!touch) return;
      if (
        !isDragging &&
        Math.hypot(touch.clientX - startPoint.x, touch.clientY - startPoint.y) <
          MIN_DRAG
      ) {
        return;
      }
      isDragging = true;
      if (isInsertTool(tool)) return;
      if (tool === "lasso") {
        lassoMove(doc, touch.clientX, touch.clientY);
        return;
      }
      if (isTextTool(tool)) {
        const here = caretAt(doc, touch.clientX, touch.clientY);
        if (!here) return;
        // Started between lines or in a margin: the mark starts where the
        // finger first reaches text
        if (!start) start = here;
        selectBetween(doc, start, here);
      } else if (stroke) {
        const point = inkPoint(touch.clientX, touch.clientY);
        if (!point) return;
        stroke.points.push(point[0], point[1]);
        if (
          !lastInkMove ||
          Math.hypot(
            touch.clientX - lastInkMove.x,
            touch.clientY - lastInkMove.y
          ) > 4
        ) {
          lastInkMove = {
            x: touch.clientX,
            y: touch.clientY,
            time: Date.now(),
          };
        }
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (stroke) drawPage(doc, stroke);
          });
        }
      } else if (tool === "eraser") {
        for (const p of eraserPath(lastErase, touch.clientX, touch.clientY)) {
          eraseAt(doc, p.x, p.y, erased);
        }
        lastErase = { x: touch.clientX, y: touch.clientY };
      }
    },
    { passive: false, capture: true }
  );
  doc.addEventListener(
    "touchend",
    () => {
      const wasDragging = isDragging;
      const done = stroke;
      start = null;
      startPoint = null;
      isDragging = false;
      stroke = null;
      if (!tool) return;
      if (tool === "lasso") {
        lassoEnd(doc);
        return;
      }
      if (isInsertTool(tool)) {
        if (!wasDragging && tapPoint)
          placeTextItem(doc, tapPoint.x, tapPoint.y);
        tapPoint = null;
        return;
      }
      if (done) {
        const page = pageIndexOf(doc);
        if (page === undefined) return;
        const held = !!lastInkMove && Date.now() - lastInkMove.time > HOLD_MS;
        lastInkMove = null;
        const rect = inkCanvasOf(doc)?.getBoundingClientRect();
        const finished =
          held && rect ? applyShape(done, rect.width, rect.height) : done;
        addStroke(page, finished);
        pushHistory({ kind: "ink", page, stroke: finished, added: true });
        return;
      }
      if (!isTextTool(tool) || !wasDragging) return;
      const text = doc.getSelection()?.toString().trim();
      if (!text) return;
      window.dispatchEvent(
        new CustomEvent<MarkEventDetail>(MARK_EVENT, {
          detail: { chapterDocIndex: pageIndexOf(doc) },
        })
      );
    },
    { passive: true, capture: true }
  );
};

/* ---------- lasso ---------- */

// Draw a loop around ink to select it; then drag inside the box to move
// it, drag the corner handle to resize it, or recolour or delete it from
// the toolbar. Each change is one undo step.

export const LASSO_EVENT = "folio-lasso";
const LASSO_COLOR = "#4f5bd5";
const HANDLE_RADIUS = 9;

interface Lasso {
  doc: Document;
  page: number;
  // The loop being drawn, normalised page points
  path: number[];
  ids: string[];
  box: { x: number; y: number; w: number; h: number } | null;
  // While dragging: the strokes as they were, and as they look now
  drag: {
    mode: "move" | "resize";
    x: number;
    y: number;
    before: Stroke[];
  } | null;
  preview: Map<string, Stroke> | null;
}
let lasso: Lasso | null = null;

const emitLasso = () =>
  window.dispatchEvent(
    new CustomEvent(LASSO_EVENT, { detail: { count: lasso?.ids.length || 0 } })
  );
export const clearLasso = () => {
  const doc = lasso?.doc;
  lasso = null;
  if (doc?.defaultView) drawPage(doc);
  emitLasso();
};
export const getLassoCount = () => lasso?.ids.length || 0;

const selectedStrokes = () => {
  if (!lasso) return [];
  const ids = lasso.ids;
  return (loadInk()[lasso.page] || []).filter((s) => ids.includes(s.id));
};

const boxOf = (strokes: Stroke[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rect = lasso ? inkCanvasOf(lasso.doc)?.getBoundingClientRect() : null;
  const aspect = rect && rect.height ? rect.width / rect.height : 0.77;
  for (const s of strokes) {
    if (isTextItem(s)) {
      const b = itemBox(s, aspect);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
      continue;
    }
    const pad = s.width / 2;
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i] - pad);
      maxX = Math.max(maxX, s.points[i] + pad);
      minY = Math.min(minY, s.points[i + 1] - pad);
      maxY = Math.max(maxY, s.points[i + 1] + pad);
    }
  }
  return isFinite(minX)
    ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    : null;
};

const insidePolygon = (x: number, y: number, poly: number[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const transformed = (
  strokes: Stroke[],
  map: (x: number, y: number) => [number, number],
  scale = 1
) =>
  strokes.map((s) => {
    const points: number[] = [];
    for (let i = 0; i < s.points.length; i += 2) {
      points.push(...map(s.points[i], s.points[i + 1]));
    }
    return {
      ...s,
      points,
      width: s.width * scale,
      fontSize: s.fontSize !== undefined ? s.fontSize * scale : undefined,
      height: s.height !== undefined ? s.height * scale : undefined,
    };
  });

const drawLasso = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  if (!lasso) return;
  ctx.save();
  ctx.strokeStyle = LASSO_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  const path = lasso.path;
  if (path.length >= 4) {
    ctx.beginPath();
    ctx.moveTo(path[0] * w, path[1] * h);
    for (let i = 2; i < path.length; i += 2) {
      ctx.lineTo(path[i] * w, path[i + 1] * h);
    }
    ctx.stroke();
  }
  let box = lasso.box;
  if (box && lasso.preview) {
    box = boxOf(Array.from(lasso.preview.values())) || box;
  }
  if (box) {
    const pad = 6;
    const x = box.x * w - pad;
    const y = box.y * h - pad;
    const bw = box.w * w + pad * 2;
    const bh = box.h * h + pad * 2;
    ctx.fillStyle = "rgba(79, 91, 213, 0.06)";
    ctx.fillRect(x, y, bw, bh);
    ctx.strokeRect(x, y, bw, bh);
    // The resize handle, bottom right
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + bw, y + bh, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

const lassoStart = (doc: Document, x: number, y: number) => {
  const canvas = inkCanvasOf(doc);
  const page = pageIndexOf(doc);
  if (!canvas || page === undefined) return;
  const rect = canvas.getBoundingClientRect();
  const nx = (x - rect.left) / rect.width;
  const ny = (y - rect.top) / rect.height;
  if (lasso && lasso.doc === doc && lasso.box) {
    const b = lasso.box;
    const pad = 6;
    const hx = rect.left + (b.x + b.w) * rect.width + pad;
    const hy = rect.top + (b.y + b.h) * rect.height + pad;
    const before = selectedStrokes();
    if (Math.hypot(x - hx, y - hy) <= HANDLE_RADIUS + 14) {
      lasso.drag = { mode: "resize", x: nx, y: ny, before };
      return;
    }
    const m = pad / rect.width;
    if (
      nx >= b.x - m &&
      nx <= b.x + b.w + m &&
      ny >= b.y - m &&
      ny <= b.y + b.h + m
    ) {
      lasso.drag = { mode: "move", x: nx, y: ny, before };
      return;
    }
  }
  // A new loop
  const old = lasso?.doc;
  lasso = {
    doc,
    page,
    path: [nx, ny],
    ids: [],
    box: null,
    drag: null,
    preview: null,
  };
  if (old && old !== doc && old.defaultView) drawPage(old);
  emitLasso();
};

const lassoMove = (doc: Document, x: number, y: number) => {
  if (!lasso || lasso.doc !== doc) return;
  const rect = inkCanvasOf(doc)?.getBoundingClientRect();
  if (!rect) return;
  const nx = (x - rect.left) / rect.width;
  const ny = (y - rect.top) / rect.height;
  const drag = lasso.drag;
  if (drag && lasso.box) {
    let next: Stroke[];
    if (drag.mode === "move") {
      // Kept on the page
      const b = lasso.box;
      const dx = Math.max(-b.x, Math.min(1 - b.x - b.w, nx - drag.x));
      const dy = Math.max(-b.y, Math.min(1 - b.y - b.h, ny - drag.y));
      next = transformed(drag.before, (px, py) => [px + dx, py + dy]);
    } else {
      // Resized from the top-left corner, keeping its proportions
      const b = lasso.box;
      const aspect = rect.height / rect.width;
      const from = Math.hypot(b.w, b.h * aspect);
      const to = Math.hypot(
        Math.max(0.01, nx - b.x),
        Math.max(0.01, ny - b.y) * aspect
      );
      const scale = Math.max(0.1, to / Math.max(from, 0.001));
      next = transformed(
        drag.before,
        (px, py) => [b.x + (px - b.x) * scale, b.y + (py - b.y) * scale],
        scale
      );
    }
    lasso.preview = new Map(next.map((s) => [s.id, s]));
  } else {
    lasso.path.push(nx, ny);
  }
  drawPage(doc);
};

const lassoEnd = (doc: Document) => {
  if (!lasso || lasso.doc !== doc) return;
  if (lasso.drag) {
    const before = lasso.drag.before;
    const after = lasso.preview ? Array.from(lasso.preview.values()) : null;
    lasso.drag = null;
    lasso.preview = null;
    if (after && after.length) {
      replaceStrokes(
        lasso.page,
        before.map((s) => s.id),
        after
      );
      pushHistory({
        kind: "replace",
        page: lasso.page,
        before,
        after,
        added: true,
      });
      lasso.box = boxOf(after);
    }
    drawPage(doc);
    return;
  }
  // Select strokes with most of their points inside the loop
  const path = lasso.path;
  const strokes = loadInk()[lasso.page] || [];
  const ids =
    path.length >= 6
      ? strokes
          .filter((s) => {
            let inside = 0;
            for (let i = 0; i < s.points.length; i += 2) {
              if (insidePolygon(s.points[i], s.points[i + 1], path)) inside++;
            }
            return inside * 2 >= s.points.length / 2;
          })
          .map((s) => s.id)
      : [];
  if (!ids.length) {
    clearLasso();
    return;
  }
  lasso.ids = ids;
  lasso.path = [];
  lasso.box = boxOf(strokes.filter((s) => ids.includes(s.id)));
  drawPage(doc);
  emitLasso();
};

const changeSelection = (change: (strokes: Stroke[]) => Stroke[]) => {
  if (!lasso) return;
  const before = selectedStrokes();
  if (!before.length) return;
  const after = change(before);
  replaceStrokes(
    lasso.page,
    before.map((s) => s.id),
    after
  );
  pushHistory({
    kind: "replace",
    page: lasso.page,
    before,
    after,
    added: true,
  });
};
export const recolorSelection = (color: string) =>
  changeSelection((strokes) => strokes.map((s) => ({ ...s, color })));
export const deleteSelection = () => {
  changeSelection(() => []);
  clearLasso();
};

/* ---------- native ink (Android) ---------- */

// The native layer (android/.../ink) draws pen and marker strokes with very
// little lag, and hands each finished stroke here to be stored and drawn
// in the page. Elsewhere (web, desktop) the page draws them itself.

interface NativeStroke {
  id: string;
  tool: string;
  // Ended with the pen held still (shape recognition)
  held: boolean;
  toolType: string;
  // x, y pairs in CSS pixels of the app's viewport
  points: number[];
  pressures: number[];
}
interface NativeErase {
  points: number[];
  start: boolean;
  end: boolean;
}
interface FolioInkPlugin {
  configure(options: {
    active: boolean;
    tool?: string;
    color?: string;
    size?: number;
    drawWithFinger?: boolean;
    passThrough?: {
      left: number;
      top: number;
      right: number;
      bottom: number;
    }[];
  }): Promise<void>;
  release(options: { ids: string[] }): Promise<void>;
  addListener(
    event: "stroke",
    fn: (data: NativeStroke) => void
  ): Promise<unknown>;
  addListener(
    event: "erase",
    fn: (data: NativeErase) => void
  ): Promise<unknown>;
  addListener(event: "stylus", fn: () => void): Promise<unknown>;
}

const FolioInk = registerPlugin<FolioInkPlugin>("FolioInk");
export const hasNativeInk = () =>
  Capacitor.getPlatform() === "android" &&
  Capacitor.isPluginAvailable("FolioInk");

export const STYLUS_SEEN_EVENT = "folio-stylus-seen";
const FINGER_CONFIG = "folioDrawWithFinger";
let drawWithFinger = ConfigService.getReaderConfig(FINGER_CONFIG) !== "no";
export const getDrawWithFinger = () => drawWithFinger;
export const setDrawWithFinger = (on: boolean) => {
  drawWithFinger = on;
  ConfigService.setReaderConfig(FINGER_CONFIG, on ? "yes" : "no");
  markedDocs.forEach((doc) => doc.defaultView && applyMarkMode(doc));
  syncNativeInk();
};

const isNativeInkTool = () => isInkTool(tool) && hasNativeInk();

// The PDF pages, with where their ink canvas sits in the app's viewport
const pageFrames = () => {
  const outer = document.querySelector<HTMLIFrameElement>("#page-area iframe");
  const outerRect = outer?.getBoundingClientRect();
  if (!outer?.contentDocument || !outerRect) return [];
  return Array.from(outer.contentDocument.querySelectorAll("iframe"))
    .map((frame) => {
      const doc = (frame as HTMLIFrameElement).contentDocument;
      const canvas = doc && inkCanvasOf(doc);
      const page = doc ? pageIndexOf(doc) : undefined;
      if (!doc || !canvas || page === undefined) return null;
      const frameRect = frame.getBoundingClientRect();
      const rect = canvas.getBoundingClientRect();
      // Pages can be scaled as a whole (zoom)
      const scale =
        frameRect.width / (doc.documentElement.clientWidth || frameRect.width);
      const left = outerRect.left + frameRect.left + rect.left * scale;
      const top = outerRect.top + frameRect.top + rect.top * scale;
      return {
        doc,
        page,
        scale,
        frameLeft: outerRect.left + frameRect.left,
        frameTop: outerRect.top + frameRect.top,
        left,
        top,
        width: rect.width * scale,
        height: rect.height * scale,
      };
    })
    .filter((f): f is NonNullable<typeof f> => !!f && f.width > 0);
};

const pageAt = (x: number, y: number) => {
  const frames = pageFrames();
  return (
    frames.find(
      (f) =>
        x >= f.left &&
        x <= f.left + f.width &&
        y >= f.top &&
        y <= f.top + f.height
    ) ||
    // Nearest page by its centre (a stroke that starts in the gap)
    frames.sort(
      (a, b) =>
        Math.hypot(a.left + a.width / 2 - x, a.top + a.height / 2 - y) -
        Math.hypot(b.left + b.width / 2 - x, b.top + b.height / 2 - y)
    )[0]
  );
};

// Any CSS colour as #rrggbb (the native layer takes hex)
const toHex = (color: string) => {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return color;
  ctx.fillStyle = color;
  return ctx.fillStyle as string;
};

// Re-sent when the tool, its style, the theme or the toolbar changes
let lastConfig = "";
export const syncNativeInk = () => {
  if (!hasNativeInk()) return;
  bindNativeInk();
  const active = isInkTool(tool) && pageFrames().length > 0;
  if (!active || !isInkTool(tool)) {
    if (lastConfig !== "off") {
      lastConfig = "off";
      FolioInk.configure({ active: false });
    }
    return;
  }
  const style = inkStyles[tool];
  const page = pageFrames()[0];
  const color = toHex(tool === "pen" ? visibleInk(style.color) : style.color);
  // The marker is see-through, as on the page
  const argb = tool === "marker" ? "#61" + color.slice(1) : color;
  const passThrough = Array.from(
    document.querySelectorAll<HTMLElement>(".annotate-bar > *")
  ).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left - 6,
      top: r.top - 6,
      right: r.right + 6,
      bottom: r.bottom + 6,
    };
  });
  const config = {
    active: true,
    // The ball pen is the pen with an even line
    tool: tool === "pen" && style.kind === "ball" ? "ball" : tool,
    color: argb,
    size: Math.max(1, style.width * (page?.width || window.innerWidth)),
    drawWithFinger,
    passThrough,
  };
  const key = JSON.stringify(config);
  if (key === lastConfig) return;
  lastConfig = key;
  FolioInk.configure(config);
};

let isNativeBound = false;
let nativeErased = new Set<string>();
let nativeLastErase: { x: number; y: number } | null = null;
const bindNativeInk = () => {
  if (isNativeBound) return;
  isNativeBound = true;
  FolioInk.addListener("stroke", (data) => {
    const ids = [data.id];
    const release = () => FolioInk.release({ ids });
    if (!isInkTool(tool) || data.points.length < 2) return release();
    const frame = pageAt(data.points[0], data.points[1]);
    if (!frame) return release();
    const points: number[] = [];
    for (let i = 0; i < data.points.length; i += 2) {
      points.push(
        (data.points[i] - frame.left) / frame.width,
        (data.points[i + 1] - frame.top) / frame.height
      );
    }
    const style = inkStyles[tool];
    let stroke: Stroke = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      tool,
      color: style.color,
      width: style.width,
      points,
      // Only a real pen's pressure shapes the line (fountain pen)
      pressures:
        data.toolType === "stylus" && tool === "pen" && style.kind !== "ball"
          ? data.pressures
          : undefined,
    };
    // Drawn mostly off the pages (the gap below the last one): not kept
    let inside = 0;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) inside++;
    }
    if (inside < points.length / 4) return release();
    if (data.held) stroke = applyShape(stroke, frame.width, frame.height);
    addStroke(frame.page, stroke);
    pushHistory({ kind: "ink", page: frame.page, stroke, added: true });
    // The page has painted it: the native copy can go
    requestAnimationFrame(() => requestAnimationFrame(release));
  });
  FolioInk.addListener("erase", (data) => {
    if (data.start) {
      eraseGroup++;
      nativeErased = new Set();
      nativeLastErase = null;
    }
    for (let i = 0; i < data.points.length; i += 2) {
      const x = data.points[i];
      const y = data.points[i + 1];
      for (const p of eraserPath(nativeLastErase, x, y)) {
        const frame = pageAt(p.x, p.y);
        if (!frame) continue;
        // Into the page's own coordinates
        eraseAt(
          frame.doc,
          (p.x - frame.frameLeft) / frame.scale,
          (p.y - frame.frameTop) / frame.scale,
          nativeErased
        );
      }
      nativeLastErase = { x, y };
    }
  });
  FolioInk.addListener("stylus", () => {
    // A real pen: draw with it, and let fingers scroll, as notes apps do
    if (drawWithFinger) setDrawWithFinger(false);
    window.dispatchEvent(new CustomEvent(STYLUS_SEEN_EVENT));
  });
};
