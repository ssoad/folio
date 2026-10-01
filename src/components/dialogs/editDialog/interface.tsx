import BookModel from "../../../models/Book";
import { RouteComponentProps } from "react-router-dom";
export interface EditDialogProps extends RouteComponentProps<any> {
  t: (title: string) => string;
  handleFetchBooks: () => void;
  handleEditDialog: (isShow: boolean) => void;
  handleActionDialog: (isShow: boolean) => void;
  handleRefreshBookCover: (key: string) => void;
  isAuthed: boolean;
  handleSetting: (isSettingOpen: boolean) => void;
  handleSettingMode: (mode: string) => void;

  isOpenDeleteDialog: boolean;
  currentBook: BookModel;
}

export interface EditDialogState {
  isCheck: boolean;
  coverPreview: string;
  bookPath: string;
  isMetadataDialogOpen: boolean;
  pendingName: string;
  pendingAuthor: string;
  pendingPublisher: string;
  pendingDescription: string;
  pendingPublishedDate: string;
  pendingCover: string;
  isAnalyzing: boolean;
  // Where a newly chosen cover came from: an image or metadata the user
  // picked ("custom") or the PDF's first page ("firstPage")
  coverSource: "" | "custom" | "firstPage";
  isRenderingCover: boolean;
}
