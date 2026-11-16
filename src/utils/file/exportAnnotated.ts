// Exports a PDF with its drawings, text boxes and sticky notes in it, as a
// copy (the book itself is unchanged), and saves or shares it.

import BookModel from "../../models/Book";
import BookUtil from "./bookUtil";
import { loadBookInk } from "../reader/inkStore";
import { annotatePdf } from "./annotatedPdf";
import { saveAs } from "./saveFile";
import { getBookName } from "./export";

export const exportAnnotatedPdf = async (book: BookModel) => {
  const data = await BookUtil.fetchBook(book.key, "pdf", true, book.path);
  if (!data || typeof data === "boolean") throw new Error("Book not found");
  const buffer =
    data instanceof ArrayBuffer ? data : await (data as File).arrayBuffer();
  const bytes = await annotatePdf(buffer, loadBookInk(book.key));
  const name = getBookName(book).replace(/\.pdf$/i, "") + " (annotated).pdf";
  const pdf = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  await saveAs(pdf, name);
};
