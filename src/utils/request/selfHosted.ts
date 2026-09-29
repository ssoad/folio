import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import i18n from "../../i18n";
import { decryptSecret, encryptSecret } from "../ai";
import TokenService from "../storage/tokenService";

// Talks to the Pro services of a self-hosted Koodo Reader server
// (httpserver/pro.go). Responses use the official API's {code, msg, data}
// envelope, so callers treat both the same way.

// vault: the server encrypts data-source credentials (older servers lack it)
export type SelfHostedFeature = "ai" | "tts" | "ocr" | "metadata" | "vault";

export interface SelfHostedConfig {
  url: string;
  // Encrypted with safeStorage on desktop
  token: string;
  features: Record<SelfHostedFeature, boolean>;
}

export interface SelfHostedResponse<T = any> {
  code: number;
  msg: string;
  data?: T;
}

const CONFIG_KEY = "selfHostedServer";
// Entry in aiModelConfig so the assistant, translation, dictionary and book
// assistant can use the server's model like any model added in the AI settings
export const SELF_HOSTED_MODEL_KEY = "selfhosted-server";
const AI_MODEL_SETTINGS = [
  "aiTranslateModel",
  "aiDictModel",
  "aiAssistanceModel",
] as const;

export const getSelfHostedConfig = (): SelfHostedConfig | null => {
  try {
    const raw = ConfigService.getItem(CONFIG_KEY);
    const config = raw ? JSON.parse(raw) : null;
    return config && config.url ? config : null;
  } catch (error) {
    return null;
  }
};

export const isSelfHostedConnected = () => getSelfHostedConfig() !== null;

export const hasSelfHostedFeature = (feature: SelfHostedFeature) =>
  !!getSelfHostedConfig()?.features?.[feature];

// Pro features are available with a Koodo Pro account or a connected
// self-hosted server that provides them
export const canUseProFeature = (
  isAuthed: boolean,
  feature?: SelfHostedFeature
) =>
  isAuthed ||
  (feature ? hasSelfHostedFeature(feature) : isSelfHostedConnected());

// Sync to storage the user runs themselves. OAuth drives (Google Drive,
// OneDrive, ...) need the official token service, so they stay account-only.
const OWN_STORAGE_DRIVES = [
  "webdav",
  "s3compatible",
  "docker",
  "folder",
  "ftp",
  "sftp",
  "smb",
  "mega",
  "icloud",
];

// Book and cover files sync with a Koodo login or a connected self-hosted server
export const canSyncCloudFiles = async () =>
  (await TokenService.getToken("is_authed")) === "yes" ||
  isSelfHostedConnected();

export const canUseDrive = (isAuthed: boolean, drive: string) =>
  isAuthed || (isSelfHostedConnected() && OWN_STORAGE_DRIVES.includes(drive));

export const normalizeServerUrl = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    throw new Error(i18n.t("Invalid server URL"));
  }
  return trimmed;
};

const request = async <T>(
  config: { url: string; token: string },
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<SelfHostedResponse<T>> => {
  try {
    const token = await decryptSecret(config.token);
    const response = await fetch(config.url + path, {
      method: init.method || "GET",
      headers: {
        Authorization: "Bearer " + token,
        ...(init.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      return {
        code: response.status,
        msg: text.slice(0, 200) || response.statusText,
      };
    }
  } catch (error) {
    return {
      code: 0,
      msg: error instanceof Error ? error.message : i18n.t("Connection failed"),
    };
  }
};

const call = <T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<SelfHostedResponse<T>> => {
  const config = getSelfHostedConfig();
  if (!config) {
    return Promise.resolve({
      code: 0,
      msg: i18n.t("No self-hosted server connected"),
    });
  }
  return request<T>(config, path, init);
};

const fetchStatus = async (url: string, token: string) => {
  const response = await request<{
    features: Record<SelfHostedFeature, boolean>;
  }>({ url, token }, "/pro/v1/status");
  if (response.code !== 200 || !response.data) {
    throw new Error(
      response.code === 401
        ? i18n.t("The server rejected the access token")
        : response.msg || i18n.t("Connection failed")
    );
  }
  return response.data.features;
};

const syncAIModel = (config: SelfHostedConfig | null) => {
  if (!config || !config.features.ai) {
    ConfigService.deleteObjectConfig(SELF_HOSTED_MODEL_KEY, "aiModelConfig");
    for (const setting of AI_MODEL_SETTINGS) {
      if (ConfigService.getReaderConfig(setting) === SELF_HOSTED_MODEL_KEY) {
        ConfigService.setReaderConfig(setting, "");
      }
    }
    return;
  }
  const name = i18n.t("Self-hosted server");
  ConfigService.setObjectConfig(
    SELF_HOSTED_MODEL_KEY,
    {
      key: SELF_HOSTED_MODEL_KEY,
      displayName: name,
      config: {
        endpoint: config.url + "/pro/v1/openai",
        modelName: name,
        // The server decides the real model
        modelId: "default",
        apiKey: config.token,
        providerId: "selfhosted",
        providerName: name,
      },
    },
    "aiModelConfig"
  );
  // Use the server for AI features that have no model chosen yet
  for (const setting of AI_MODEL_SETTINGS) {
    if (!ConfigService.getReaderConfig(setting)) {
      ConfigService.setReaderConfig(setting, SELF_HOSTED_MODEL_KEY);
    }
  }
};

export const connectSelfHostedServer = async (url: string, token: string) => {
  const normalized = normalizeServerUrl(url);
  const features = await fetchStatus(normalized, token.trim());
  const config: SelfHostedConfig = {
    url: normalized,
    token: await encryptSecret(token.trim()),
    features,
  };
  ConfigService.setItem(CONFIG_KEY, JSON.stringify(config));
  syncAIModel(config);
  return features;
};

export const disconnectSelfHostedServer = () => {
  ConfigService.removeItem(CONFIG_KEY);
  syncAIModel(null);
};

// Re-reads the features on startup, the server's configuration may have changed.
// A server that can't be reached keeps its last known features.
export const refreshSelfHostedStatus = async () => {
  const config = getSelfHostedConfig();
  if (!config) {
    return null;
  }
  try {
    const features = await fetchStatus(config.url, config.token);
    const updated = { ...config, features };
    ConfigService.setItem(CONFIG_KEY, JSON.stringify(updated));
    syncAIModel(updated);
    return features;
  } catch (error) {
    console.warn("Self-hosted server status check failed:", error);
    return config.features;
  }
};

// ── Pro services ─────────────────────────────────────────────────────────────

export const selfHostedBatchTrans = (
  texts: string[],
  from: string,
  to: string
) =>
  call<{ texts: string[] }>("/pro/v1/translate/batch", {
    method: "POST",
    body: { texts, from, to },
  });

export const selfHostedAnalyzeTitle = (title: string) =>
  call<{ name: string; author: string }>("/pro/v1/title/analyze", {
    method: "POST",
    body: { title },
  });

export const selfHostedSplitSentence = (
  texts: { text: string; index: number }[]
) =>
  call<{ sentences: { text: string; role: string; index: number }[] }>(
    "/pro/v1/speech/split",
    { method: "POST", body: { texts } }
  );

export const selfHostedBookMetadata = (name: string, author: string) =>
  call<any[]>(
    "/pro/v1/metadata/search?" + new URLSearchParams({ name, author })
  );

export const selfHostedTTS = (
  text: string,
  language: string,
  voice: string,
  speed: number
) =>
  call<{ audio_base64: string }>("/pro/v1/tts", {
    method: "POST",
    body: { text, language, voice, speed },
  });

// Data-source credentials: same request and response fields as the official
// token service. Tokens the server encrypted carry this prefix.
const VAULT_PREFIX = "fv1:";
export const isSelfHostedToken = (encryptedToken: string) =>
  encryptedToken.startsWith(VAULT_PREFIX);

export const selfHostedEncryptToken = (token: string) =>
  call<{ encrypted_token: string }>("/pro/v1/token/encrypt", {
    method: "POST",
    body: { token },
  });

export const selfHostedDecryptToken = (encryptedToken: string) =>
  call<{ token: string }>("/pro/v1/token/decrypt", {
    method: "POST",
    body: { encrypted_token: encryptedToken },
  });

// Same contract as system OCR (parseWithSystemOCR): page image in, text out
export const selfHostedOcr = async (imageBase64: string) => {
  const response = await call<{ text: string }>("/pro/v1/ocr", {
    method: "POST",
    body: { image_base64: imageBase64 },
  });
  if (response.code !== 200) {
    console.error("Self-hosted OCR failed:", response.msg);
    return "";
  }
  return response.data?.text || "";
};
