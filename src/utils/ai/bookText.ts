export interface BookChapter {
  // Same as chapterDocIndex used by rendition.getPosition() / goToPosition()
  index: number;
  title: string;
  text: string;
}

const BLOCK_SELECTOR =
  "p,div,section,article,blockquote,li,tr,h1,h2,h3,h4,h5,h6,pre,br,hr";

// Keeps paragraph breaks so passages can be split on them later
const documentToText = (doc: Document) => {
  const body = doc.body || doc.documentElement;
  if (!body) {
    return "";
  }
  const clone = body.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("script,style,noscript,svg")
    .forEach((node) => node.remove());
  clone.querySelectorAll(BLOCK_SELECTOR).forEach((node) => {
    node.appendChild(doc.createTextNode("\n"));
  });
  return (clone.textContent || "")
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
};

// Sections expose either createDocument() (EPUB-like) or load() returning a blob URL (TXT, MD, ...)
const loadSectionText = async (section: any): Promise<string> => {
  if (typeof section.createDocument === "function") {
    return documentToText(await section.createDocument());
  }
  if (typeof section.load === "function") {
    const loaded = await section.load();
    if (typeof loaded !== "string") {
      return "";
    }
    const html = /^(blob:|data:|https?:)/.test(loaded)
      ? await fetch(loaded).then((res) => res.text())
      : loaded;
    return documentToText(new DOMParser().parseFromString(html, "text/html"));
  }
  return "";
};

const MAX_CACHED_BOOKS = 2;
const chapterCache = new Map<string, Promise<BookChapter[] | null>>();

const extractChapters = async (
  rendition: any
): Promise<BookChapter[] | null> => {
  const sections: any[] | undefined = rendition?.book?.sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    return null;
  }
  const chapterDocs: any[] = rendition.getChapterDoc?.() || [];
  const chapters: BookChapter[] = [];
  for (let index = 0; index < sections.length; index++) {
    let text = "";
    try {
      text = await loadSectionText(sections[index]);
    } catch (error) {
      console.warn("Failed to read chapter", index, error);
    }
    chapters.push({
      index,
      title: chapterDocs[index]?.label || `#${index + 1}`,
      text,
    });
  }
  return chapters;
};

// Reads every chapter without moving the reader. Returns null when the format
// doesn't expose its sections (e.g. PDF), callers then fall back to the visible chapter.
export const getBookChapters = (
  bookKey: string,
  rendition: any
): Promise<BookChapter[] | null> => {
  let cached = chapterCache.get(bookKey);
  if (!cached) {
    cached = extractChapters(rendition).catch((error) => {
      chapterCache.delete(bookKey);
      throw error;
    });
    chapterCache.set(bookKey, cached);
    // Whole-book text can be large, keep only the most recent books
    while (chapterCache.size > MAX_CACHED_BOOKS) {
      chapterCache.delete(chapterCache.keys().next().value as string);
    }
  }
  return cached;
};
