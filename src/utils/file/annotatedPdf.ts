// A PDF with the reader's ink drawn into it: pen and marker strokes as
// vector paths, text boxes as text, and sticky notes as real PDF comments
// (any PDF reader shows and opens them). The original book is unchanged.

import {
  LineCapStyle,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";
import type { InkBook, Stroke } from "../reader/inkStore";
import { STICKY_SIZE } from "../reader/inkConstants";

const parseColor = (color: string) => {
  const hex = color.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
  if (!hex) return rgb(0.12, 0.16, 0.22);
  return rgb(
    parseInt(hex[1], 16) / 255,
    parseInt(hex[2], 16) / 255,
    parseInt(hex[3], 16) / 255
  );
};

// From the page as shown (0..1, top left origin, after the page's
// rotation) to the PDF's own coordinates
const pageMapper = (page: PDFPage) => {
  const box = page.getCropBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  const map = (nx: number, ny: number): [number, number] => {
    const u = nx * width;
    const v = ny * height;
    switch (rotation) {
      case 90:
        return [x0 + v, y0 + u];
      case 180:
        return [x1 - u, y0 + v];
      case 270:
        return [x1 - v, y1 - u];
      default:
        return [x0 + u, y1 - v];
    }
  };
  return { map, width, height, rotation };
};

const drawInk = (
  page: PDFPage,
  stroke: Stroke,
  mapper: ReturnType<typeof pageMapper>
) => {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const color = parseColor(stroke.color);
  const opacity = stroke.tool === "marker" ? 0.38 : 1;
  const base = stroke.width * mapper.width;
  const at = (i: number) => mapper.map(pts[i], pts[i + 1]);
  // drawSvgPath flips y: points are given as (x, -y) from the origin
  const svg = (p: [number, number]) => `${p[0].toFixed(2)} ${(-p[1]).toFixed(2)}`;
  const options = {
    x: 0,
    y: 0,
    borderColor: color,
    borderOpacity: opacity,
    borderLineCap:
      stroke.tool === "marker" ? LineCapStyle.Butt : LineCapStyle.Round,
  };
  if (pts.length === 2) {
    const [x, y] = at(0);
    page.drawCircle({ x, y, size: Math.max(0.5, base / 2), color, opacity });
    return;
  }
  const pressures = stroke.tool === "pen" ? stroke.pressures : undefined;
  if (pressures && pressures.length * 2 === pts.length) {
    // A fountain pen: each piece as wide as the pen was pressed
    for (let i = 2; i < pts.length; i += 2) {
      const p = (pressures[i / 2 - 1] + pressures[i / 2]) / 2;
      page.drawSvgPath(`M ${svg(at(i - 2))} L ${svg(at(i))}`, {
        ...options,
        borderWidth: Math.max(0.3, base * (0.35 + 0.9 * p)),
      });
    }
    return;
  }
  let d = `M ${svg(at(0))}`;
  for (let i = 2; i < pts.length; i += 2) d += ` L ${svg(at(i))}`;
  page.drawSvgPath(d, { ...options, borderWidth: Math.max(0.3, base) });
};

const drawTextBox = async (
  doc: PDFDocument,
  page: PDFPage,
  item: Stroke,
  mapper: ReturnType<typeof pageMapper>
) => {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = (item.fontSize || 0.032) * mapper.width;
  const maxWidth = (item.width || 0.4) * mapper.width;
  // The standard font has Latin letters only: others are left out
  const encodable = (text: string) =>
    Array.from(text)
      .filter((ch) => {
        try {
          font.encodeText(ch);
          return true;
        } catch {
          return false;
        }
      })
      .join("");
  const lines: string[] = [];
  for (const paragraph of (item.text || "").split("\n")) {
    let line = "";
    for (const word of encodable(paragraph).split(/(\s+)/)) {
      const next = line + word;
      if (font.widthOfTextAtSize(next, size) <= maxWidth || !line.trim()) {
        line = next;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  const [x, y] = mapper.map(item.points[0], item.points[1]);
  lines.forEach((line, i) => {
    page.drawText(line, {
      x,
      y: y - size * (1 + i * 1.3),
      size,
      font,
      color: parseColor(item.color),
      rotate: degrees(mapper.rotation ? -mapper.rotation : 0),
    });
  });
};

const addStickyNote = (
  doc: PDFDocument,
  page: PDFPage,
  item: Stroke,
  mapper: ReturnType<typeof pageMapper>
) => {
  const [x, y] = mapper.map(item.points[0], item.points[1]);
  const side = STICKY_SIZE * mapper.width;
  const color = parseColor(item.color || "#fde68a");
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [x, y - side, x + side, y],
    Contents: PDFString.of(item.text || ""),
    Name: "Comment",
    C: [color.red, color.green, color.blue],
    Open: false,
    F: 4,
  });
  const ref = doc.context.register(annotation);
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots && "push" in (annots as any)) {
    (annots as any).push(ref);
  } else {
    page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
  }
};

/** The PDF with the ink drawn into it (pure: used by the export) */
export const annotatePdf = async (buffer: ArrayBuffer, ink: InkBook) => {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = doc.getPages();
  for (const [index, items] of Object.entries(ink)) {
    const page = pages[parseInt(index)];
    if (!page) continue;
    const mapper = pageMapper(page);
    for (const item of items) {
      if (item.tool === "text") await drawTextBox(doc, page, item, mapper);
      else if (item.tool === "sticky") addStickyNote(doc, page, item, mapper);
      else drawInk(page, item, mapper);
    }
  }
  return doc.save();
};
