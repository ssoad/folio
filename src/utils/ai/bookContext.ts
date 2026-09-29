import { BookChapter } from "./bookText";
import type { ChapterSummary } from "./chapterSummaries";

export interface BookPassage {
  // "p{chapter number}-{passage number}", the id the model cites
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  tokens: number;
}

export interface BookContext {
  // "full" sends every passage up to the limit, "retrieval" only the relevant ones
  mode: "full" | "retrieval";
  passages: BookPassage[];
  totalPassages: number;
  // Only in retrieval mode, so answers still know the whole story so far
  summaries: ChapterSummary[];
}

const PASSAGE_TARGET_CHARS = 1500;
// In retrieval mode this share of the budget goes to the chapter being read,
// so questions like "what just happened" work without matching keywords
const CURRENT_CHAPTER_SHARE = 0.3;
// Most of a long book is only visible through its chapter summaries; they may
// take this share of the budget, the newest chapters win when they don't fit
const SUMMARY_SHARE = 0.4;

const CJK_CLASS = "[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uac00-\\ud7af]";
const CJK_GLOBAL = new RegExp(CJK_CLASS, "g");
const CJK_TEST = new RegExp(CJK_CLASS);

// Rough count that avoids shipping a tokenizer: ~4 chars per token for
// alphabetic scripts, ~1 token per CJK character
export const estimateTokens = (text: string) => {
  const cjk = (text.match(CJK_GLOBAL) || []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
};

export const passageId = (chapterIndex: number, n: number) =>
  `p${chapterIndex + 1}-${n + 1}`;

const passageCache = new WeakMap<BookChapter[], BookPassage[]>();

export const splitPassages = (chapters: BookChapter[]): BookPassage[] => {
  const cached = passageCache.get(chapters);
  if (cached) {
    return cached;
  }
  const passages: BookPassage[] = [];
  for (const chapter of chapters) {
    const paragraphs = chapter.text.split("\n").filter((p) => p.trim());
    let buffer: string[] = [];
    let length = 0;
    let count = 0;
    const flush = () => {
      if (buffer.length === 0) return;
      const text = buffer.join("\n");
      passages.push({
        id: passageId(chapter.index, count++),
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        text,
        tokens: estimateTokens(text),
      });
      buffer = [];
      length = 0;
    };
    for (const paragraph of paragraphs) {
      // Very long paragraphs become their own passage rather than being cut mid-sentence
      if (length > 0 && length + paragraph.length > PASSAGE_TARGET_CHARS) {
        flush();
      }
      buffer.push(paragraph);
      length += paragraph.length;
    }
    flush();
  }
  passageCache.set(chapters, passages);
  return passages;
};

const STOPWORDS = new Set(
  (
    "a an and are as at be but by did do does for from had has have he her his how i in " +
    "is it its me my of on or she so that the their them then there they this to was " +
    "we were what when where which who whom why will with you your about into than " +
    "tell explain describe summarize summary book chapter story happen happened"
  ).split(" ")
);

const tokenize = (text: string): string[] => {
  const lower = text.toLowerCase();
  const terms: string[] = [];
  for (const word of lower.match(/[\p{L}\p{N}]+/gu) || []) {
    if (CJK_TEST.test(word)) {
      // CJK has no spaces, character bigrams are a good enough unit for matching
      const chars = Array.from(word);
      for (let i = 0; i < chars.length - 1; i++) {
        terms.push(chars[i] + chars[i + 1]);
      }
      if (chars.length === 1) terms.push(chars[0]);
      continue;
    }
    if (word.length > 1 && !STOPWORDS.has(word)) {
      terms.push(word);
    }
  }
  return terms;
};

// Okapi BM25 over passages
const rankPassages = (passages: BookPassage[], query: string) => {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0) {
    return [];
  }
  const docs = passages.map((p) => tokenize(p.text));
  const avgLength =
    docs.reduce((sum, terms) => sum + terms.length, 0) / (docs.length || 1);
  const docFreq = new Map<string, number>();
  for (const terms of docs) {
    for (const term of new Set(terms)) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }
  const k1 = 1.2;
  const b = 0.75;
  return passages
    .map((passage, i) => {
      const terms = docs[i];
      const freq = new Map<string, number>();
      for (const term of terms) freq.set(term, (freq.get(term) || 0) + 1);
      let score = 0;
      for (const term of queryTerms) {
        const tf = freq.get(term) || 0;
        if (!tf) continue;
        const df = docFreq.get(term) || 0;
        const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
        score +=
          (idf * tf * (k1 + 1)) /
          (tf + k1 * (1 - b + (b * terms.length) / (avgLength || 1)));
      }
      return { passage, score };
    })
    .filter((item) => item.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((item) => item.passage);
};

const getAvailablePassages = (
  chapters: BookChapter[],
  maxChapterIndex?: number
) => {
  const allPassages = splitPassages(chapters);
  return maxChapterIndex === undefined
    ? allPassages
    : allPassages.filter((p) => p.chapterIndex <= maxChapterIndex);
};

export const fitsInBudget = (
  chapters: BookChapter[],
  tokenBudget: number,
  maxChapterIndex?: number
) =>
  getAvailablePassages(chapters, maxChapterIndex).reduce(
    (sum, p) => sum + p.tokens,
    0
  ) <= tokenBudget;

const pickSummaries = (summaries: ChapterSummary[], limit: number) => {
  const picked: ChapterSummary[] = [];
  let used = 0;
  for (let i = summaries.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(summaries[i].text);
    if (used + tokens > limit) break;
    picked.unshift(summaries[i]);
    used += tokens;
  }
  return { picked, used };
};

export const buildBookContext = (options: {
  chapters: BookChapter[];
  question: string;
  tokenBudget: number;
  currentChapterIndex: number;
  // Spoiler protection: nothing after this chapter is sent
  maxChapterIndex?: number;
  summaries?: ChapterSummary[];
}): BookContext => {
  const { question, tokenBudget, currentChapterIndex, maxChapterIndex } =
    options;
  const available = getAvailablePassages(options.chapters, maxChapterIndex);
  if (fitsInBudget(options.chapters, tokenBudget, maxChapterIndex)) {
    return {
      mode: "full",
      passages: available,
      totalPassages: available.length,
      summaries: [],
    };
  }

  const summaries = pickSummaries(
    (options.summaries || []).filter(
      (s) => maxChapterIndex === undefined || s.chapterIndex <= maxChapterIndex
    ),
    tokenBudget * SUMMARY_SHARE
  );
  const selected = new Set<BookPassage>();
  let used = summaries.used;
  const take = (passage: BookPassage, limit: number) => {
    if (selected.has(passage) || used + passage.tokens > limit) return;
    selected.add(passage);
    used += passage.tokens;
  };
  const currentChapter = available.filter(
    (p) => p.chapterIndex === currentChapterIndex
  );
  const currentLimit = used + tokenBudget * CURRENT_CHAPTER_SHARE;
  for (const passage of currentChapter) {
    take(passage, currentLimit);
  }
  for (const passage of rankPassages(available, question)) {
    take(passage, tokenBudget);
  }
  return {
    mode: "retrieval",
    // Book order reads more naturally than score order
    passages: available.filter((p) => selected.has(p)),
    totalPassages: available.length,
    summaries: summaries.picked,
  };
};

export const formatPassages = (passages: BookPassage[]) => {
  const parts: string[] = [];
  let lastChapter = -1;
  for (const passage of passages) {
    if (passage.chapterIndex !== lastChapter) {
      if (lastChapter !== -1) parts.push("</chapter>");
      parts.push(
        `<chapter number="${passage.chapterIndex + 1}" title="${passage.chapterTitle.replace(/"/g, "'")}">`
      );
      lastChapter = passage.chapterIndex;
    }
    parts.push(`<passage id="${passage.id}">\n${passage.text}\n</passage>`);
  }
  if (lastChapter !== -1) parts.push("</chapter>");
  return parts.join("\n");
};

export const formatSummaries = (summaries: ChapterSummary[]) =>
  summaries
    .map(
      (summary) =>
        `<summary chapter="${summary.chapterIndex + 1}" id="c${
          summary.chapterIndex + 1
        }" title="${summary.title.replace(/"/g, "'")}">\n${
          summary.text
        }\n</summary>`
    )
    .join("\n");

// Passages [p3-12], chapters [c3], and the list form models sometimes write, [p3-12, c4]
export const CITATION_REGEX =
  /\[((?:p\d+-\d+|c\d+)(?:\s*[,;]\s*(?:p\d+-\d+|c\d+))*)\]/g;

export const findPassage = (chapters: BookChapter[], id: string) =>
  splitPassages(chapters).find((p) => p.id === id);
