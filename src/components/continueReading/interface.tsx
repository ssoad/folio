import BookModel from "../../models/Book";

export interface ContinueReadingProps {
  books: BookModel[];
  handleReadingBook: (book: BookModel) => void;
  t: (title: string) => string;
}

export interface ContinueReadingState {
  // The full record: the list's books carry little more than their keys
  book: BookModel | null;
  cover: string;
  isCoverExist: boolean;
}
