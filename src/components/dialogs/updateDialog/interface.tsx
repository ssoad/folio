import BookModel from "../../../models/Book";
import { UpdateLog } from "../../../utils/request/common";
export interface UpdateInfoProps {
  currentBook: BookModel;

  isShowNew: boolean;
  isAuthed: boolean;
  t: (title: string) => string;
  handleNewDialog: (isShowNew: boolean) => void;
  handleNewWarning: (isNewWarning: boolean) => void;
  handleFetchAuthed: () => void;
  handleFetchDataSourceList: () => void;
  handleFetchDefaultSyncOption: () => void;
  handleLoginOptionList: (
    loginOptionList: { email: string; provider: string }[]
  ) => void;
}
export interface UpdateInfoState {
  updateLog: UpdateLog | null;
}
