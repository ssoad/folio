import {
  ConfigService,
  HighlightUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import BookModel from "../../models/Book";
import { isReadingRawPDF } from "../common";
import {
  BookContext,
  buildBookContext,
  findPassage,
  fitsInBudget,
  formatPassages,
  formatSummaries,
} from "./bookContext";
import { BookChapter, getBookChapters } from "./bookText";
import { ChapterSummary, ensureChapterSummaries } from "./chapterSummaries";
import { AIProviderConfig } from "./types";

// Book text sent per question. Claude models take 200K+ tokens, many
// OpenAI-compatible models are smaller, so they get a conservative default.
const DEFAULT_BUDGET = 24000;
const PROVIDER_BUDGETS: Record<string, number> = {
  anthropic: 150000,
};

export const getBookContextBudget = (providerId: string) => {
  const custom = parseInt(
    ConfigService.getReaderConfig("aiBookContextTokens") || "",
    10
  );
  if (custom > 0) {
    return custom;
  }
  return PROVIDER_BUDGETS[providerId] || DEFAULT_BUDGET;
};

export const isSpoilerProtectionOn = () =>
  ConfigService.getReaderConfig("isAiSpoilerFree") !== "no";

export const isChapterSummaryOn = () =>
  ConfigService.getReaderConfig("isAiChapterSummaries") !== "no";

const getReadingPosition = (rendition: any) => {
  let position: any = {};
  try {
    position = rendition.getPosition?.() || {};
  } catch (error) {
    position = {};
  }
  const index = parseInt(position.chapterDocIndex, 10);
  return {
    chapterIndex: Number.isFinite(index) ? index : 0,
    chapterTitle: position.chapterTitle || "",
  };
};

// Formats without readable sections (e.g. raw PDF) only get the chapter on screen
const loadChapters = async (
  book: BookModel,
  rendition: any,
  position: { chapterIndex: number; chapterTitle: string }
): Promise<{ chapters: BookChapter[]; isWholeBook: boolean }> => {
  const chapters = await getBookChapters(book.key, rendition).catch(
    () => null
  );
  if (chapters && chapters.some((chapter) => chapter.text)) {
    return { chapters, isWholeBook: true };
  }
  const text = String((await rendition.chapterText()) || "").trim();
  return {
    chapters: [
      { index: position.chapterIndex, title: position.chapterTitle, text },
    ],
    isWholeBook: false,
  };
};

const buildSystemPrompt = (options: {
  book: BookModel;
  context: BookContext;
  isWholeBook: boolean;
  spoilerFree: boolean;
  position: { chapterIndex: number; chapterTitle: string };
}) => {
  const { book, context, isWholeBook, spoilerFree, position } = options;
  const lines = [
    `You are a reading companion for the book "${book.name}"${
      book.author ? ` by ${book.author}` : ""
    }. Answer the reader's questions using the book passages below.`,
    "Each passage has an id like p3-12 (chapter 3, passage 12). After every statement based on the book, cite the passages that support it in square brackets, for example [p3-12] or [p3-12][p4-2]. Only cite ids that appear below, and never invent quotes.",
    "If the passages don't contain the answer, say so plainly instead of guessing.",
  ];
  if (!isWholeBook) {
    lines.push(
      "Only the chapter the reader has open is available, not the rest of the book."
    );
  } else if (context.mode === "retrieval") {
    lines.push(
      "The book is too long to include in full, so these are the passages most relevant to the question plus the chapter being read. Mention it when an answer may depend on parts of the book that are not included."
    );
    if (context.summaries.length > 0) {
      lines.push(
        "Chapter summaries give you the overall story. Prefer citing passages; when a statement is only supported by a summary, cite the chapter by its summary id, for example [c3]."
      );
    }
  }
  if (spoilerFree) {
    lines.push(
      `The reader is currently at chapter ${position.chapterIndex + 1}${
        position.chapterTitle ? ` ("${position.chapterTitle}")` : ""
      }. Passages stop there on purpose: never reveal, hint at or speculate about what happens later in the book.`
    );
  }
  lines.push(
    "Reply in the same language as the reader's question and use Markdown."
  );
  if (context.summaries.length > 0) {
    lines.push(
      "<chapter_summaries>",
      formatSummaries(context.summaries),
      "</chapter_summaries>"
    );
  }
  lines.push(
    "<book_passages>",
    formatPassages(context.passages),
    "</book_passages>"
  );
  return lines.join("\n");
};

// Returns null when stopped through the signal while summarizing chapters
export const prepareBookQuestion = async (options: {
  book: BookModel;
  rendition: any;
  question: string;
  config: AIProviderConfig;
  signal?: AbortSignal;
  onSummaryProgress?: (done: number, total: number) => void;
}) => {
  const { book, rendition, question, config, signal } = options;
  const position = getReadingPosition(rendition);
  const spoilerFree = isSpoilerProtectionOn();
  const maxChapterIndex = spoilerFree ? position.chapterIndex : undefined;
  const tokenBudget = getBookContextBudget(config.providerId);
  const { chapters, isWholeBook } = await loadChapters(
    book,
    rendition,
    position
  );
  let summaries: ChapterSummary[] = [];
  if (
    isWholeBook &&
    isChapterSummaryOn() &&
    !fitsInBudget(chapters, tokenBudget, maxChapterIndex)
  ) {
    const result = await ensureChapterSummaries({
      bookKey: book.key,
      bookTitle: book.name,
      chapters: chapters.filter(
        (chapter) =>
          maxChapterIndex === undefined || chapter.index <= maxChapterIndex
      ),
      config,
      signal,
      onProgress: options.onSummaryProgress,
    });
    if (result === null) {
      return null;
    }
    summaries = result;
  }
  const context = buildBookContext({
    chapters,
    question,
    tokenBudget,
    currentChapterIndex: position.chapterIndex,
    maxChapterIndex,
    summaries,
  });
  return {
    context,
    isWholeBook,
    system: buildSystemPrompt({
      book,
      context,
      isWholeBook,
      spoilerFree,
      position,
    }),
  };
};

// doSearch matches within the rendered text, so use a short run of words from
// the passage's longest paragraph (headings and short lines are less distinctive)
const pickSearchSnippet = (text: string) => {
  const paragraph = text
    .split("\n")
    .reduce((longest, p) => (p.length > longest.length ? p : longest), "");
  const words = paragraph.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "";
  }
  if (words.length === 1) {
    // Languages without spaces
    return Array.from(words[0]).slice(0, 16).join("");
  }
  return words.slice(0, 8).join(" ");
};

// Jumps to a cited passage, falling back to the start of its chapter
export const jumpToPassage = async (
  book: BookModel,
  rendition: any,
  id: string
) => {
  const match = /^(?:p(\d+)-\d+|c(\d+))$/.exec(id);
  if (!match || !rendition) {
    return;
  }
  const chapterIndex = parseInt(match[1] || match[2], 10) - 1;
  const chapters = await getBookChapters(book.key, rendition).catch(
    () => null
  );
  const passage = chapters ? findPassage(chapters, id) : undefined;
  const snippet = passage ? pickSearchSnippet(passage.text) : "";
  if (snippet) {
    try {
      const results: any[] = (await rendition.doSearch(snippet)) || [];
      for (const result of results) {
        const location = JSON.parse(result.cfi) || {};
        if (parseInt(location.chapterDocIndex, 10) !== chapterIndex) {
          continue;
        }
        await rendition.goToPosition(
          JSON.stringify({
            text: location.text,
            chapterTitle: location.chapterTitle,
            chapterDocIndex: location.chapterDocIndex,
            chapterHref: location.chapterHref,
            count: location.hasOwnProperty("cfi") ? "ignore" : location.count,
            percentage: location.percentage,
            cfi: location.cfi,
            page: location.page,
          })
        );
        const style = new HighlightUtil(
          ConfigService
        ).buildSearchHighlightStyle(
          isReadingRawPDF(book),
          ConfigService.getReaderConfig("textOrientation") === "vertical"
        );
        rendition.highlightSearchNode(location.keyword || snippet, style);
        return;
      }
    } catch (error) {
      console.warn("Passage search failed, jumping to chapter", error);
    }
  }
  await rendition.goToChapterDocIndex(chapterIndex);
};
