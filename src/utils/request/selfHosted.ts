import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import i18n from "../../i18n";
import { decryptSecret, encryptSecret } from "../ai";

// Talks to the Folio server (httpserver/pro.go), which provides every service
// beyond reading: AI, voices, OCR, metadata, credential encryption,
// cloud-drive sign-in and downloadable assets. Responses use a
// {code, msg, data} envelope.

// vault: encrypts data-source credentials; assets: fonts, dictionaries and
// backgrounds to download. Older servers lack some of them.
export type SelfHostedFeature =
  | "ai"
  | "tts"
  | "ocr"
  | "metadata"
  | "vault"
  | "assets";

export interface SelfHostedConfig {
  url: string;
  // Encrypted with safeStorage on desktop
  token: string;
  features: Record<SelfHostedFeature, boolean>;
  // Cloud drives the server can sign in to
  drives?: string[];
  // Google Drive picker settings, empty when not configured
  googlePicker?: { appId: string; apiKey: string };
}

interface SelfHostedStatus {
  features: Record<SelfHostedFeature, boolean>;
  drives?: string[];
  googlePicker?: { appId: string; apiKey: string };
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

// Pro features come from the connected server; without a feature name,
// any connected server counts
export const canUseProFeature = (feature?: SelfHostedFeature) =>
  feature ? hasSelfHostedFeature(feature) : isSelfHostedConnected();

// Storage the user runs themselves; the server only encrypts the login
const OWN_STORAGE_DRIVES = [
  "webdav",
  "s3compatible",
  "docker",
  "folder",
  "ftp",
  "sftp",
  "smb",
  "mega",
];

export const isOAuthDrive = (drive: string) =>
  !OWN_STORAGE_DRIVES.includes(drive);

// Book and cover files sync once a server is connected
export const canSyncCloudFiles = async () => isSelfHostedConnected();

// Own storage needs the credential encryption; cloud drives need the server
// to have an OAuth app for them
export const canUseDrive = (drive: string) =>
  isOAuthDrive(drive)
    ? !!getSelfHostedConfig()?.drives?.includes(drive)
    : hasSelfHostedFeature("vault");

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

const fetchStatus = async (
  url: string,
  token: string
): Promise<SelfHostedStatus> => {
  const response = await request<SelfHostedStatus>(
    { url, token },
    "/pro/v1/status"
  );
  if (response.code !== 200 || !response.data) {
    throw new Error(
      response.code === 401
        ? i18n.t("The server rejected the access token")
        : response.msg || i18n.t("Connection failed")
    );
  }
  return response.data;
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
  const status = await fetchStatus(normalized, token.trim());
  const config: SelfHostedConfig = {
    url: normalized,
    token: await encryptSecret(token.trim()),
    features: status.features,
    drives: status.drives || [],
    googlePicker: status.googlePicker,
  };
  ConfigService.setItem(CONFIG_KEY, JSON.stringify(config));
  syncAIModel(config);
  return status.features;
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
    const status = await fetchStatus(config.url, config.token);
    const updated: SelfHostedConfig = {
      ...config,
      features: status.features,
      drives: status.drives || [],
      googlePicker: status.googlePicker,
    };
    ConfigService.setItem(CONFIG_KEY, JSON.stringify(updated));
    syncAIModel(updated);
    return status.features;
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

// ── Cloud-drive sign-in ──────────────────────────────────────────────────────

// Opened in the browser; the server redirects to the provider and shows the
// code to paste back into the app on its callback page
export const getSelfHostedAuthorizeUrl = (drive: string) => {
  const config = getSelfHostedConfig();
  return config
    ? `${config.url}/pro/v1/oauth/${encodeURIComponent(drive)}/authorize`
    : "";
};

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export const selfHostedOAuthToken = (drive: string, code: string) =>
  call<OAuthTokens>("/pro/v1/oauth/token", {
    method: "POST",
    body: { provider: drive, code },
  });

export const selfHostedOAuthRefresh = (drive: string, refreshToken: string) =>
  call<OAuthTokens>("/pro/v1/oauth/refresh", {
    method: "POST",
    body: { provider: drive, refresh_token: refreshToken },
  });

// Google Drive picker page for the desktop app; the token goes in the
// fragment, which browsers don't send to the server
export const getSelfHostedPickerUrl = (accessToken: string) => {
  const config = getSelfHostedConfig();
  return config
    ? `${config.url}/pro/v1/oauth/google/picker#access_token=${encodeURIComponent(accessToken)}`
    : "";
};

// ── Downloadable assets ──────────────────────────────────────────────────────

export type AssetKind = "fonts" | "dicts" | "backgrounds";

// Paths of the files the server offers, e.g. "/EB_Garamond/EBGaramond-VF.ttf"
export const getSelfHostedAssetCatalog = async (): Promise<
  Record<AssetKind, string[]>
> => {
  const empty = { fonts: [], dicts: [], backgrounds: [] };
  if (!hasSelfHostedFeature("assets")) {
    return empty;
  }
  const response = await call<Record<AssetKind, string[]>>(
    "/pro/v1/assets/catalog"
  );
  return response.code === 200 && response.data
    ? { ...empty, ...response.data }
    : empty;
};

// Streams an asset file; the caller reads the body for progress
export const fetchSelfHostedAsset = async (kind: AssetKind, path: string) => {
  const config = getSelfHostedConfig();
  if (!config) {
    throw new Error(i18n.t("No self-hosted server connected"));
  }
  const token = await decryptSecret(config.token);
  const encodedPath = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return fetch(`${config.url}/pro/v1/assets/${kind}/${encodedPath}`, {
    headers: { Authorization: "Bearer " + token },
  });
};

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
