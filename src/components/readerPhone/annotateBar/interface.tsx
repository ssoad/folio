import BookModel from "../../../models/Book";
import HtmlBookModel from "../../../models/HtmlBook";
import { HighlightValue } from "../../../utils/common";
import { AnnotateTool } from "../../../utils/reader/markMode";

export interface AnnotateBarProps {
  highlight: HighlightValue;
  currentBook: BookModel;
  htmlBook: HtmlBookModel;
  handleHighlight: (highlight: HighlightValue) => void;
  handleFetchNotes: () => void;
  handleNoteKey: (key: string) => void;
  handleMenuMode: (mode: string) => void;
  handleOpenMenu: (isOpen: boolean) => void;
  onDone: () => void;
  t: (key: string) => string;
}

export interface AnnotateBarState {
  tool: AnnotateTool;
  isOptionsOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // Last colour used with each text style
  textColors: Record<string, string>;
  hint: string;
}
