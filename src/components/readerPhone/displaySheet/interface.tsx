import BookModel from "../../../models/Book";

export interface DisplaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  onMoreSettings: () => void;
  currentBook: BookModel;
  readerMode: string;
  renderBookFunc: () => void;
  handleReaderMode: (readerMode: string) => void;
  handleBackgroundColor: (backgroundColor: string) => void;
  t: (title: string) => string;
}

export interface DisplaySheetState {
  fontSize: number;
  brightness: number;
  themeKey: string;
}

export interface ReaderTheme {
  key: string;
  label: string;
  backgroundColor: string;
  textColor: string;
}
