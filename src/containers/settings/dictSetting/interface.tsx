import { RouteComponentProps } from "react-router-dom";
import { CloudDictItem, DictMeta } from "../../../utils/file/dictUtil";

export interface SettingInfoProps extends RouteComponentProps<any> {
  t: (title: string) => string;
  isAuthed: boolean;
  handleFetchPlugins: () => void;
}

export interface SettingInfoState {
  dicts: DictMeta[];
  isLoading: boolean;
  downloadingId: string;
  downloadProgress: number;
  // Dictionaries the server offers
  serverDicts: CloudDictItem[];
}
