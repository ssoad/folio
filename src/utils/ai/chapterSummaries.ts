import localforage from "localforage";
import { streamChat } from "./index";
import { estimateTokens } from "./bookContext";
import { BookChapter } from "./bookText";
import { AIProviderConfig } from "./types";

export interface ChapterSummary {
  chapterIndex: number;
  title: string;
  text: string;
}

interface StoredSummary {
  // Hash of the chapter text the summary was made from, so edited books get new summaries
  hash: string;
  text: string;
}
type SummaryRecord = Record<string, StoredSummary>;

// One record per book in the default localforage store, which "clear all data" already wipes
const STORAGE_PREFIX = "aiChapterSummaries:";
// Chapters this short are sent as-is instead of spending a request on them
const MIN_TOKENS_TO_SUMMARIZE = 400;
const MAX_CONCURRENT_REQUESTS = 3;
// Longest piece of a chapter sent in one summary request
const MAX_TOKENS_PER_REQUEST = 60000;

// FNV-1a, only used to notice when a chapter's text changed
const hashText = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16) + ":" + text.length;
};

const storageKey = (bookKey: string) => STORAGE_PREFIX + bookKey;

export const deleteChapterSummaries = (bookKey: string) =>
  localforage.removeItem(storageKey(bookKey));

const buildSummaryPrompt = (bookTitle: string) =>
  [
    `You summarize one chapter of the book "${bookTitle}" so a reading assistant can later answer questions about the whole book.`,
    "Write 150 to 250 words covering the events, the characters involved and what changes for them, and any facts, names, places or dates a reader might ask about.",
    "Only use what the chapter says; don't add interpretation or anything from outside the text.",
    "Write in the language the chapter is written in. Output only the summary.",
  ].join("\n");

// Very long chapters are summarized in parts that each fit in one request
const splitForRequests = (text: string) => {
  if (estimateTokens(text) <= MAX_TOKENS_PER_REQUEST) {
    return [text];
  }
  const parts: string[] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const paragraph of text.split("\n")) {
    const paragraphTokens = estimateTokens(paragraph);
    if (tokens > 0 && tokens + paragraphTokens > MAX_TOKENS_PER_REQUEST) {
      parts.push(current.join("\n"));
      current = [];
      tokens = 0;
    }
    current.push(paragraph);
    tokens += paragraphTokens;
  }
  if (current.length > 0) parts.push(current.join("\n"));
  return parts;
};

const summarizeChapter = async (
  config: AIProviderConfig,
  bookTitle: string,
  chapter: BookChapter,
  signal?: AbortSignal
) => {
  const parts = splitForRequests(chapter.text);
  const summaries: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let summary = "";
    const label =
      parts.length > 1
        ? `${chapter.title} (part ${i + 1} of ${parts.length})`
        : chapter.title;
    await streamChat(
      config,
      {
        system: buildSummaryPrompt(bookTitle),
        messages: [
          { role: "user", content: `Chapter: ${label}\n\n${parts[i]}` },
        ],
        signal,
      },
      (result) => {
        summary += result.text;
      }
    );
    // A stopped request resolves with partial text, which must not be cached
    if (signal?.aborted) {
      return null;
    }
    summaries.push(summary.trim());
  }
  return summaries.join("\n");
};

// Returns a summary for every non-empty chapter, generating and caching the
// missing ones. Returns null when stopped through the signal.
export const ensureChapterSummaries = async (options: {
  bookKey: string;
  bookTitle: string;
  chapters: BookChapter[];
  config: AIProviderConfig;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}): Promise<ChapterSummary[] | null> => {
  const { bookKey, bookTitle, chapters, config, signal, onProgress } =
    options;
  const record: SummaryRecord =
    (await localforage.getItem<SummaryRecord>(storageKey(bookKey))) || {};
  const results = new Map<number, string>();
  const missing: BookChapter[] = [];
  for (const chapter of chapters) {
    if (!chapter.text.trim()) continue;
    if (estimateTokens(chapter.text) < MIN_TOKENS_TO_SUMMARIZE) {
      results.set(chapter.index, chapter.text);
      continue;
    }
    const stored = record[chapter.index];
    if (stored && stored.hash === hashText(chapter.text)) {
      results.set(chapter.index, stored.text);
    } else {
      missing.push(chapter);
    }
  }

  let done = 0;
  let stopped = false;
  if (missing.length > 0) {
    onProgress?.(0, missing.length);
  }
  const queue = [...missing];
  const worker = async () => {
    while (queue.length > 0 && !stopped) {
      const chapter = queue.shift()!;
      const summary = await summarizeChapter(
        config,
        bookTitle,
        chapter,
        signal
      );
      if (summary === null) {
        stopped = true;
        return;
      }
      results.set(chapter.index, summary);
      record[chapter.index] = { hash: hashText(chapter.text), text: summary };
      // Save as we go so a stopped or failed run keeps what it finished
      await localforage.setItem(storageKey(bookKey), record);
      onProgress?.(++done, missing.length);
    }
  };
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_CONCURRENT_REQUESTS, missing.length) },
        worker
      )
    );
  } catch (error) {
    stopped = true;
    throw error;
  }
  if (stopped || signal?.aborted) {
    return null;
  }
  return chapters
    .filter((chapter) => results.has(chapter.index))
    .map((chapter) => ({
      chapterIndex: chapter.index,
      title: chapter.title,
      text: results.get(chapter.index)!,
    }));
};
