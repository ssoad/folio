import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  selfHostedAnalyzeTitle,
  selfHostedBatchTrans,
  selfHostedBookMetadata,
  selfHostedSplitSentence,
  selfHostedTTS,
  SelfHostedResponse,
} from "./selfHosted";

// Reading services the Folio server provides; the callers check that the
// server offers the feature before using them
const fromServer = <T>(response: SelfHostedResponse<T>) => {
  if (response.code !== 200) {
    toast.error(i18n.t("Self-hosted server error") + ": " + response.msg);
  }
  return response;
};
export const getTTSAudio = async (
  text: string,
  language: string,
  voice: string,
  speed: number
) => fromServer(await selfHostedTTS(text, language, voice, speed));
export const getBatchTrans = async (
  texts: string[],
  from: string,
  to: string
) => fromServer(await selfHostedBatchTrans(texts, from, to));
export const getBookMetadata = async (name: string, author: string) =>
  fromServer(await selfHostedBookMetadata(name, author));
export const analyzeBookTitle = async (title: string) =>
  fromServer(await selfHostedAnalyzeTitle(title));
export const getSplitSentence = async (
  texts: { text: string; index: number }[]
) => fromServer(await selfHostedSplitSentence(texts));
