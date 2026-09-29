import axios from "axios";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { AIChatMessage, streamChat } from "../ai";
import { getServerRegion, reloadManager } from "../common";
import { resetReaderRequest } from "./reader";
import { resetUserRequest } from "./user";
import { resetThirdpartyRequest } from "./thirdparty";
import { isElectron } from "react-device-detect";
import TokenService from "../storage/tokenService";
const PUBLIC_URL = "https://api.koodoreader.com";
const CN_PUBLIC_URL = "https://api.koodoreader.cn";
export const getPublicUrl = () => {
  return getServerRegion() === "china" ? CN_PUBLIC_URL : PUBLIC_URL;
};
export const checkDeveloperUpdate = async () => {
  let res = await axios.get(
    getPublicUrl() + `/api/update_dev?name=${navigator.language}`
  );
  return res.data.log;
};
export const uploadFile = async (url: string, file: any) => {
  return new Promise<boolean>((resolve) => {
    axios
      .put(url, file, {})
      .then(() => {
        resolve(true);
      })
      .catch((err) => {
        console.error(err);
        resolve(false);
      });
  });
};
export const checkStableUpdate = async () => {
  let res = await axios.get(
    getPublicUrl() + `/api/update?name=${navigator.language}`
  );
  return res.data.log;
};
export const handleExitApp = async () => {
  toast.error(i18n.t("Authorization failed, please login again"));
  await handleClearToken();
  //路由到login页面
  reloadManager();
};
export const handleClearToken = async () => {
  await TokenService.deleteToken("is_authed");
  await TokenService.deleteToken("access_token");
  await TokenService.deleteToken("refresh_token");
  let dataSourceList = ConfigService.getAllListConfig("dataSourceList") || [];
  for (let i = 0; i < dataSourceList.length; i++) {
    let targetDrive = dataSourceList[i];
    await TokenService.setToken(targetDrive + "_token", "");
  }
  ConfigService.removeItem("defaultSyncOption");
  ConfigService.removeItem("dataSourceList");
  ConfigService.setReaderConfig("dictService", "");
  ConfigService.setReaderConfig("transService", "");
  ConfigService.setReaderConfig("aiService", "");
  resetReaderRequest();
  resetUserRequest();
  resetThirdpartyRequest();
};

// Kept for existing callers; new code should use streamChat from utils/ai directly
export const chatStream = async (
  url: string,
  providerId: string,
  apiKey: string,
  model: string,
  prompt: string,
  chat: AIChatMessage[],
  onMessage: (result) => void,
  signal?: AbortSignal
) => {
  const messages: AIChatMessage[] = [
    ...chat,
    { role: "user" as const, content: prompt },
  ].slice(-5);
  return streamChat(
    { endpoint: url, providerId, apiKey, modelId: model },
    { messages, signal },
    onMessage
  );
};
export const getNotification = async () => {
  let deviceUuid = await TokenService.getFingerprint();
  const res = await axios.post(
    "https://api.koodoreader.com/api/get_notification",
    {
      device_uuid: deviceUuid,
    }
  );
  // {
  // 	"result": "ok",
  // 	"unread": 0
  // }
  return res;
};
export const parseWithSystemOCR = async (imageBase64: string) => {
  if (!isElectron) {
    return;
  }
  const ipcRenderer = window.electronAPI;
  let result = await ipcRenderer.invoke("system-ocr", {
    base64: imageBase64,
    lang: "auto",
  });
  return result.text || "";
};
