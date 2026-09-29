import axios from "axios";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { AIChatMessage, streamChat } from "../ai";
import { reloadManager } from "../common";
import { resetReaderRequest } from "./reader";
import { resetUserRequest } from "./user";
import { resetThirdpartyRequest } from "./thirdparty";
import { isElectron } from "react-device-detect";
import TokenService from "../storage/tokenService";
// Folio releases are published on GitHub; pre-releases are the developer channel
const RELEASES_API = "https://api.github.com/repos/ssoad/folio/releases";
export interface UpdateLog {
  version: string;
  stable: "yes" | "no";
  stable_version: string;
  skippable: "yes";
  url: string;
  new: string[];
  fix: string[];
}
interface GithubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}
const releaseNotes = (body: string | null) =>
  (body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*] /.test(line))
    .map((line) => line.slice(2).trim())
    .slice(0, 20);
// Resolves to null when GitHub can't be reached or nothing has been released
const checkUpdate = async (
  includePrerelease: boolean
): Promise<UpdateLog | null> => {
  try {
    const res = await axios.get<GithubRelease[]>(RELEASES_API, {
      params: { per_page: 20 },
      headers: { Accept: "application/vnd.github+json" },
    });
    const releases = res.data.filter((release) => !release.draft);
    const latest = releases.find(
      (release) => includePrerelease || !release.prerelease
    );
    if (!latest) {
      return null;
    }
    const stable = releases.find((release) => !release.prerelease);
    const toVersion = (tag: string) => tag.replace(/^v/i, "");
    return {
      version: toVersion(latest.tag_name),
      stable: latest.prerelease ? "no" : "yes",
      stable_version: stable ? toVersion(stable.tag_name) : "1.0.0",
      skippable: "yes",
      url: latest.html_url,
      new: releaseNotes(latest.body),
      fix: [],
    };
  } catch (error) {
    console.warn("Update check failed:", error);
    return null;
  }
};
export const checkDeveloperUpdate = () => checkUpdate(true);
export const checkStableUpdate = () => checkUpdate(false);
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
