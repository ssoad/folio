import { RouteComponentProps } from "react-router";

export interface EmptyPageProps extends RouteComponentProps<any> {
  mode: string;
  isCollapsed: boolean;
  isSelectBook: boolean;
  shelfTitle: string;
  handleShelf: (shelfTitle: string) => void;
  handleMode: (mode: string) => void;
  t: (title: string) => string;
}
export interface EmptyPageState {
  isOpenDelete: boolean;
}
