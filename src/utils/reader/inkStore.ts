// Ink kept with each book: freehand strokes, text boxes and sticky notes,
// per page, in normalised page coordinates (0..1), so they follow zoom and
// resizing.
//
// Each item records when it last changed (t), and deleted items leave a
// dated record, so ink from two devices merges item by item (the newer
// change wins) instead of one device's ink replacing the other's
// (utils/reader/inkSync).

import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

export type InkItemTool = "pen" | "marker" | "text" | "sticky";

export interface Stroke {
  id: string;
  tool: InkItemTool;
  color: string;
  // Line width (or a text box's width), a fraction of the page width
  width: number;
  // Flat list of x, y pairs, each 0..1 of the page (text: its top left)
  points: number[];
  // Stylus pressure (0..1) at each point
  pressures?: number[];
  // Text boxes and sticky notes
  text?: string;
  // Font size, a fraction of the page width
  fontSize?: number;
  // Text boxes and sticky notes: height, a fraction of the page height
  height?: number;
  // Last changed (ms)
  t?: number;
}
export type InkBook = Record<string, Stroke[]>;
// Deleted item id → when
export type InkDeleted = Record<string, number>;

export const INK_CONFIG = "folioInk";
export const INK_DELETED_CONFIG = "folioInkDeleted";

export const loadBookInk = (bookKey: string): InkBook =>
  bookKey ? ConfigService.getObjectConfig(bookKey, INK_CONFIG, {}) || {} : {};

export const loadBookDeleted = (bookKey: string): InkDeleted =>
  bookKey
    ? ConfigService.getObjectConfig(bookKey, INK_DELETED_CONFIG, {}) || {}
    : {};

export const saveBookInk = (bookKey: string, ink: InkBook) => {
  if (!bookKey) return;
  ConfigService.setObjectConfig(bookKey, ink, INK_CONFIG);
};

export const saveBookDeleted = (bookKey: string, deleted: InkDeleted) => {
  if (!bookKey) return;
  ConfigService.setObjectConfig(bookKey, deleted, INK_DELETED_CONFIG);
};

/**
 * Applies a change to one page: removes the items with these ids (leaving
 * deletion records) and adds these items, at the place of the first one
 * removed so the drawing order stays. Added items are stamped as changed
 * now.
 */
export const changePage = (
  bookKey: string,
  page: number,
  removeIds: string[],
  add: Stroke[]
) => {
  const ink = loadBookInk(bookKey);
  const deleted = loadBookDeleted(bookKey);
  const now = Date.now();
  const strokes = ink[page] || [];
  const at = strokes.findIndex((s) => removeIds.includes(s.id));
  const kept = strokes.filter((s) => !removeIds.includes(s.id));
  const index = at < 0 ? kept.length : Math.min(at, kept.length);
  const added = add.map((s) => ({ ...s, t: now }));
  ink[page] = [...kept.slice(0, index), ...added, ...kept.slice(index)];
  if (!ink[page].length) delete ink[page];
  const addedIds = new Set(added.map((s) => s.id));
  for (const id of removeIds) {
    if (!addedIds.has(id)) deleted[id] = now;
  }
  // An item brought back (undo) is no longer deleted
  addedIds.forEach((id) => delete deleted[id]);
  saveBookInk(bookKey, ink);
  saveBookDeleted(bookKey, deleted);
};

/**
 * Merges two copies of a book's ink: every item from either, the newer
 * version where both have it, minus items deleted after they last changed.
 */
export const mergeInk = (
  a: { ink: InkBook; deleted: InkDeleted },
  b: { ink: InkBook; deleted: InkDeleted }
): { ink: InkBook; deleted: InkDeleted } => {
  const deleted: InkDeleted = { ...a.deleted };
  for (const [id, time] of Object.entries(b.deleted)) {
    deleted[id] = Math.max(deleted[id] || 0, time);
  }
  const ink: InkBook = {};
  const pages = new Set([...Object.keys(a.ink), ...Object.keys(b.ink)]);
  pages.forEach((page) => {
    const byId = new Map<string, Stroke>();
    // a's order first, then b's new items
    for (const s of [...(a.ink[page] || []), ...(b.ink[page] || [])]) {
      const have = byId.get(s.id);
      if (!have || (s.t || 0) > (have.t || 0)) byId.set(s.id, s);
    }
    const kept = Array.from(byId.values()).filter(
      (s) => !deleted[s.id] || (s.t || 0) > deleted[s.id]
    );
    if (kept.length) ink[page] = kept;
  });
  // Old deletion records (90 days) aren't needed any more
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  for (const [id, time] of Object.entries(deleted)) {
    if (time < cutoff) delete deleted[id];
  }
  return { ink, deleted };
};

/** Every book with ink on this device */
export const inkBookKeys = (): string[] => {
  const all = new Set<string>();
  for (const name of [INK_CONFIG, INK_DELETED_CONFIG]) {
    try {
      const stored = JSON.parse(ConfigService.getItem(name) || "{}");
      Object.keys(stored || {}).forEach((key) => all.add(key));
    } catch {
      // Not readable: nothing to add
    }
  }
  return Array.from(all);
};
