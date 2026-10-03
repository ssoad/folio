import Note from "../../models/Note";
import { isReadingRawPDF } from "../common";
import DatabaseService from "../storage/databaseService";
import {
  ConfigService,
  NoteSyncManager,
} from "../../assets/lib/kookit-extra-browser.min";
import { getIframeDoc } from "./docUtil";

export interface DigestParams {
  currentBook: any;
  htmlBook: any;
  chapterDocIndex: number;
  chapter: string;
  color: string;
  t: (key: string) => string;
  onNoteClick?: (event: Event) => void;
  onSuccess?: () => void;
}

export async function createHighlight(params: DigestParams): Promise<void> {
  const {
    currentBook,
    htmlBook,
    chapterDocIndex,
    chapter,
    color,
    onNoteClick,
    onSuccess,
  } = params;

  if (!htmlBook) return;

  let bookKey = currentBook.key;
  let bookLocation = ConfigService.getObjectConfig(
    bookKey,
    "recordLocation",
    {}
  );
  let cfi = JSON.stringify(bookLocation);

  if (isReadingRawPDF(currentBook)) {
    let pdfLocation = htmlBook.rendition.getPositionByChapter(chapterDocIndex);
    cfi = JSON.stringify(pdfLocation);
  }

  let percentage = bookLocation.percentage ? bookLocation.percentage : "0";
  let docs = getIframeDoc(currentBook.format, currentBook.key);
  let text = "";
  let actualChapterDocIndex = chapterDocIndex;
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    const sel = doc.getSelection();
    if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
      text = sel.toString();
      if (isReadingRawPDF(currentBook)) {
        let frame = doc.defaultView?.frameElement;
        let id = frame?.getAttribute("id") || "";
        if (id) {
          actualChapterDocIndex = parseInt(id.split("-").reverse()[0]);
        }
      }
      break;
    }
  }
  if (!text) return;

  text = text.replace(/\s\s/g, "");
  text = text.replace(/\r/g, "");
  text = text.replace(/\n/g, "");
  text = text.replace(/\t/g, "");
  text = text.replace(/\f/g, "");

  let coords = null;
  try {
    coords = await htmlBook.rendition.getHighlightCoords(actualChapterDocIndex);
  } catch (err) {
    console.warn("getHighlightCoords failed:", err);
  }
  let range = JSON.stringify(coords || {});

  let highlight = new Note(
    bookKey,
    chapter,
    actualChapterDocIndex,
    text,
    cfi,
    range,
    "",
    percentage,
    color,
    []
  );

  try {
    await DatabaseService.saveRecord(highlight, "notes");
    await htmlBook.rendition.createOneNote(highlight, onNoteClick ?? (() => {}));
    let noteSyncManager = new NoteSyncManager(
      DatabaseService,
      ConfigService,
      window.electronAPI?.fs,
      window.electronAPI?.path
    );
    noteSyncManager.syncNote(highlight, bookKey);
  } catch (err) {
    console.error("createOneNote failed:", err);
  }
  onSuccess?.();
}
