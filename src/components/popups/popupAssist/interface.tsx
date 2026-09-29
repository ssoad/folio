import PluginModel from "../../../models/Plugin";
import BookModel from "../../../models/Book";
export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
};
export type AssistMode = "ask" | "chat" | "book";
export interface PopupAssistProps {
  currentBook: BookModel;
  originalText: string;
  htmlBook: any;
  quoteText: string;
  plugins: PluginModel[];
  isAuthed: boolean;
  isDockedRight: boolean;
  handleQuoteText: (quoteText: string) => void;
  handleOpenMenu: (isOpenMenu: boolean) => void;
  handleMenuMode: (menu: string) => void;
  handleFetchPlugins: () => void;
  handleSetting: (isShow: boolean) => void;
  handleSettingMode: (settingMode: string) => void;
  t: (title: string) => string;
}
export interface PopupAssistState {
  aiService: string;
  isAddNew: boolean;
  isWaiting: boolean;
  question: string;
  askHistory: AiChatMessage[];
  chatHistory: AiChatMessage[];
  bookHistory: AiChatMessage[];
  answer: string;
  mode: AssistMode;
  inputQuestion: string;
  isStreaming: boolean;
  isSpoilerFree: boolean;
  summaryProgress: string;
}
