import { InkTextEdit } from "../../../utils/reader/markMode";

export interface InkTextSheetProps {
  t: (key: string) => string;
}

export interface InkTextSheetState {
  edit: InkTextEdit | null;
  text: string;
  color: string;
  fontSize: number;
}
