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
export type AnnotateTool = TextTool | InkTool | "eraser";

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
}

interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  width: number;
  // Flat list of x, y pairs, each 0..1 of the page
  points: number[];
}
type InkBook = Record<string, Stroke[]>;

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
  | { kind: "note"; note: any; added: boolean; group?: number };
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
  pen: { color: "#1f2937", width: 0.004 },
  marker: { color: "#facc15", width: 0.022 },
};
const boundDocs = new WeakSet<Document>();
const markedDocs = new Set<Document>();
const undoStack: HistoryEntry[] = [];
const redoStack: HistoryEntry[] = [];

export const isMarkMode = () => tool !== null;
export const getAnnotateTool = () => tool;
export const getInkStyle = (inkTool: InkTool) => inkStyles[inkTool];
export const setInkStyle = (inkTool: InkTool, style: Partial<InkStyle>) => {
  inkStyles[inkTool] = { ...inkStyles[inkTool], ...style };
};

const applyMarkMode = (doc: Document) => {
  if (!doc?.documentElement) return;
  if (!doc.getElementById("folio-mark-mode")) {
    const style = doc.createElement("style");
    style.id = "folio-mark-mode";
    style.textContent = MARKING_STYLE;
    (doc.head || doc.documentElement).appendChild(style);
  }
  doc.documentElement.classList.toggle(MARKING_CLASS, tool !== null);
  doc.documentElement.classList.toggle("folio-text-tool", isTextTool(tool));
};

export const setAnnotateTool = (next: AnnotateTool | null, key?: string) => {
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
  if (entry.kind === "ink") {
    if (exists) addStroke(entry.page, entry.stroke);
    else removeStroke(entry.page, entry.stroke.id);
    return null;
  }
  return { ...entry, added: exists };
};

/* ---------- ink storage ---------- */

let inkVersion = 0;
const INK_CONFIG = "folioInk";
const loadInk = (): InkBook =>
  bookKey ? ConfigService.getObjectConfig(bookKey, INK_CONFIG, {}) || {} : {};
const saveInk = (ink: InkBook) => {
  if (!bookKey) return;
  ConfigService.setObjectConfig(bookKey, ink, INK_CONFIG);
  inkVersion++;
};
const addStroke = (page: number, stroke: Stroke) => {
  const ink = loadInk();
  ink[page] = [...(ink[page] || []).filter((s) => s.id !== stroke.id), stroke];
  saveInk(ink);
  redrawAll();
};
const removeStroke = (page: number, id: string) => {
  const ink = loadInk();
  ink[page] = (ink[page] || []).filter((s) => s.id !== id);
  if (!ink[page].length) delete ink[page];
  saveInk(ink);
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

const drawStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  w: number,
  h: number
) => {
  const pts = stroke.points;
  if (pts.length < 2) return;
  ctx.save();
  const color = stroke.tool === "pen" ? visibleInk(stroke.color) : stroke.color;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, stroke.width * w);
  ctx.lineCap = stroke.tool === "marker" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = stroke.tool === "marker" ? 0.38 : 1;
  if (pts.length === 2) {
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
  strokes.forEach((stroke) => drawStroke(ctx, stroke, w, h));
  if (extra) drawStroke(ctx, extra, w, h);
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
    const reach = ERASER_RADIUS + (stroke.width * rect.width) / 2;
    for (let i = 0; i < stroke.points.length; i += 2) {
      const px = rect.left + stroke.points[i] * rect.width;
      const py = rect.top + stroke.points[i + 1] * rect.height;
      if (Math.hypot(px - x, py - y) <= reach) {
        erased.add(stroke.id);
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
  const swallow = (event: Event) => {
    if (!tool) return;
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
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (stroke) drawPage(doc, stroke);
          });
        }
      } else if (tool === "eraser") {
        eraseAt(doc, touch.clientX, touch.clientY, erased);
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
      if (done) {
        const page = pageIndexOf(doc);
        if (page === undefined) return;
        addStroke(page, done);
        pushHistory({ kind: "ink", page, stroke: done, added: true });
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
