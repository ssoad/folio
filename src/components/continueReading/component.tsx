import React from "react";
import "./continueReading.css";
import { Trans } from "react-i18next";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import BookModel from "../../models/Book";
import BookUtil from "../../utils/file/bookUtil";
import CoverUtil from "../../utils/file/coverUtil";
import DatabaseService from "../../utils/storage/databaseService";
import EmptyCover from "../emptyCover";
import { ContinueReadingProps, ContinueReadingState } from "./interface";

// The book being read most recently, if it's started and not finished
export const findContinueBook = (books: BookModel[]) => {
  const byKey = new Map(books.map((book) => [book.key, book]));
  for (const key of ConfigService.getAllListConfig("recentBooks")) {
    const book = byKey.get(key);
    if (!book) continue;
    const progress = getProgress(book);
    if (progress > 0 && progress < 1) return book;
  }
  return null;
};
const getProgress = (book: BookModel) => {
  const record = ConfigService.getObjectConfig(book.key, "recordLocation", {});
  const value = parseFloat(record?.percentage || "0");
  return isNaN(value) ? 0 : value;
};

// Phone library: a card at the top to pick up the current book
class ContinueReading extends React.Component<
  ContinueReadingProps,
  ContinueReadingState
> {
  constructor(props: ContinueReadingProps) {
    super(props);
    this.state = { book: null, cover: "", isCoverExist: false };
  }
  componentDidMount() {
    this.loadCover();
  }
  componentDidUpdate(prevProps: ContinueReadingProps) {
    if (prevProps.books !== this.props.books) this.loadCover();
  }
  loadCover = async () => {
    const found = findContinueBook(this.props.books);
    const book: BookModel | null = found
      ? (await DatabaseService.getRecord(found.key, "books")) || found
      : null;
    if (!book) {
      this.setState({ book: null });
      return;
    }
    const [cover, isCoverExist] = await Promise.all([
      CoverUtil.getCover(book),
      CoverUtil.isCoverExist(book),
    ]);
    this.setState({ book, cover, isCoverExist });
  };
  render() {
    const { book } = this.state;
    if (!book) return null;
    const progress = getProgress(book);
    return (
      <button
        type="button"
        className="continue-reading"
        onClick={() => {
          this.props.handleReadingBook(book);
          BookUtil.redirectBook(book);
        }}
      >
        <span className="continue-reading-cover">
          {this.state.isCoverExist && this.state.cover ? (
            <img src={this.state.cover} alt="" draggable={false} />
          ) : (
            <EmptyCover
              {...{
                format: book.format,
                author: book.author,
                title: book.name,
                scale: 0.56,
              }}
            />
          )}
        </span>
        <span className="continue-reading-body">
          <span className="continue-reading-label">
            <Trans>Continue reading</Trans>
          </span>
          <span className="continue-reading-title">{book.name}</span>
          {book.author && (
            <span className="continue-reading-author">{book.author}</span>
          )}
          <span className="continue-reading-progress">
            <span className="continue-reading-bar">
              <span style={{ width: Math.round(progress * 100) + "%" }}></span>
            </span>
            <span className="continue-reading-percent">
              {Math.round(progress * 100)}%
            </span>
          </span>
        </span>
      </button>
    );
  }
}

export default ContinueReading;
