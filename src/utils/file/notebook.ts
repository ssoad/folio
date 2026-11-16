// Notebooks: a PDF of empty pages (plain, ruled, squared or dotted) made
// on the device and added to the library like any book, so it opens in the
// reader with every drawing tool, as in notes apps.

import { PDFDocument, PDFEmbeddedPage, PDFPage, rgb } from "pdf-lib";

export type NotebookPaper = "blank" | "ruled" | "grid" | "dots";

// A4, in points
const WIDTH = 595.28;
const HEIGHT = 841.89;
const PAGES = 30;

const LINE = rgb(0.78, 0.82, 0.93);
const MARGIN = rgb(0.95, 0.65, 0.65);
const DOT = rgb(0.62, 0.66, 0.74);

const drawPaper = (page: PDFPage, paper: NotebookPaper) => {
  if (paper === "ruled") {
    for (let y = HEIGHT - 96; y > 48; y -= 26) {
      page.drawLine({
        start: { x: 0, y },
        end: { x: WIDTH, y },
        thickness: 0.6,
        color: LINE,
      });
    }
    page.drawLine({
      start: { x: 72, y: 0 },
      end: { x: 72, y: HEIGHT },
      thickness: 0.8,
      color: MARGIN,
    });
  } else if (paper === "grid") {
    const step = 18;
    for (let x = step; x < WIDTH; x += step) {
      page.drawLine({
        start: { x, y: 0 },
        end: { x, y: HEIGHT },
        thickness: 0.4,
        color: LINE,
      });
    }
    for (let y = step; y < HEIGHT; y += step) {
      page.drawLine({
        start: { x: 0, y },
        end: { x: WIDTH, y },
        thickness: 0.4,
        color: LINE,
      });
    }
  } else if (paper === "dots") {
    const step = 18;
    for (let x = step; x < WIDTH; x += step) {
      for (let y = step; y < HEIGHT; y += step) {
        page.drawCircle({ x, y, size: 0.7, color: DOT });
      }
    }
  }
};

export const createNotebook = async (paper: NotebookPaper, name: string) => {
  const doc = await PDFDocument.create();
  doc.setTitle(name);
  doc.setCreator("Folio");
  // The paper is drawn once and placed on every page (one shared form),
  // which keeps a dotted notebook small and quick to show
  let paperForm: PDFEmbeddedPage | null = null;
  if (paper !== "blank") {
    const template = await PDFDocument.create();
    drawPaper(template.addPage([WIDTH, HEIGHT]), paper);
    [paperForm] = await doc.embedPdf(await template.save(), [0]);
  }
  for (let i = 0; i < PAGES; i++) {
    const page = doc.addPage([WIDTH, HEIGHT]);
    if (paperForm) page.drawPage(paperForm, { x: 0, y: 0 });
  }
  const bytes = await doc.save();
  return new File([bytes.slice().buffer as ArrayBuffer], name + ".pdf", {
    type: "application/pdf",
  });
};
