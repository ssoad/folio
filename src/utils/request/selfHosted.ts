import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isNativeApp } from "../platform";
import i18n from "../../i18n";
import { decryptSecret, encryptSecret } from "../ai";
import { FOLIO_SERVER } from "../../constants/server";

// Talks to the Folio server (httpserver/pro.go), which provides every service
// beyond reading: AI, voices, OCR, metadata, credential encryption,
// cloud-drive sign-in and downloadable assets. Responses use a
// {code, msg, data} envelope.

// vault: encrypts data-source credentials; assets: fonts, dictionaries and
// backgrounds to download; sync: Folio Cloud. Older servers lack some of them.
export type SelfHostedFeature =
  | "ai"
  | "tts"
  | "ocr"
  | "metadata"
  | "vault"
  | "assets"
  | "sync";

export interface SelfHostedConfig {
  url: string;
  // Encrypted with safeStorage on desktop; an account's device token or the
  // server's owner token
  token: string;
  // Set when signed in with an account rather than the owner token
  account?: { email: string; name: string };
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
// The app's server (constants/server.ts): the only one when locked, else
// filled in until the user connects to one
export const DEFAULT_SERVER_URL = FOLIO_SERVER.url.replace(/\/+$/, "");
export const isServerLocked = () => FOLIO_SERVER.locked;
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
    if (!config || !config.url) return null;
    // A connection to another server doesn't count once the app is locked
    // to its own
    if (isServerLocked() && config.url !== DEFAULT_SERVER_URL) return null;
    return config;
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
  drive === FOLIO_CLOUD_DRIVE
    ? hasSelfHostedFeature("sync")
    : isOAuthDrive(drive)
      ? !!getSelfHostedConfig()?.drives?.includes(drive)
      : hasSelfHostedFeature("vault");

// Folio Cloud: the library synced to the connected server, in the account's
// own folder (httpserver/pro_sync.go). The server speaks the Docker data
// source's file API, so the sync engine uses its Docker client, signed in
// with the account's token.
export const FOLIO_CLOUD_DRIVE = "folio";

// The sync engine's name for a data source
export const syncEngineDrive = (drive: string) =>
  drive === FOLIO_CLOUD_DRIVE ? "docker" : drive;

// Built from the server connection each time, so it follows sign-ins
export const getFolioCloudConfig = async () => {
  const config = getSelfHostedConfig();
  if (!config || !config.features?.sync) {
    return null;
  }
  return {
    url: config.url + "/pro/v1/sync",
    username: "folio",
    password: await decryptSecret(config.token),
  };
};

export const normalizeServerUrl = (url: string) => {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+/i.test(trimmed)) {
    throw new Error(i18n.t("Invalid server URL"));
  }
  return trimmed;
};

// config.token "" sends no Authorization (sign-in, sign-up, plan list)
const request = async <T>(
  config: { url: string; token: string },
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {}
): Promise<SelfHostedResponse<T>> => {
  try {
    const token = config.token ? await decryptSecret(config.token) : "";
    const response = await fetch(config.url + path, {
      method: init.method || "GET",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
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

export const connectSelfHostedServer = async (
  url: string,
  token: string,
  account?: { email: string; name: string }
) => {
  const normalized = normalizeServerUrl(url);
  const status = await fetchStatus(normalized, token.trim());
  const config: SelfHostedConfig = {
    url: normalized,
    token: await encryptSecret(token.trim()),
    account,
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
  // Folio Cloud lives on the server
  ConfigService.deleteListConfig(FOLIO_CLOUD_DRIVE, "dataSourceList");
  if (ConfigService.getItem("defaultSyncOption") === FOLIO_CLOUD_DRIVE) {
    ConfigService.removeItem("defaultSyncOption");
  }
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

// ── Accounts ────────────────────────────────────────────────────────────────

export interface ServerInfo {
  registration_open: boolean;
  google_enabled: boolean;
  email_verification: boolean;
  password_reset: boolean;
  owner_token: boolean;
}

export interface AccountUser {
  id: number;
  email: string;
  name: string;
  role: string;
  has_password: boolean;
  has_google: boolean;
}

export interface AccountPackage {
  id: number;
  name: string;
  description: string;
  price_label: string;
  duration_days: number;
  features: string[];
  limits: Record<string, number>;
}

export interface AccountSubscription {
  id: number;
  package_name: string;
  source: string;
  starts_at: number;
  ends_at: number;
  active: boolean;
}

export interface AccountDevice {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number;
}

export interface AccountSummary {
  user: AccountUser;
  subscription: AccountSubscription | null;
  package: AccountPackage | null;
  features: Record<SelfHostedFeature | "drives", boolean>;
  usage: Record<string, number>;
  limits: Record<string, number>;
  period: string;
  devices: AccountDevice[];
  current_device: number;
}

export interface AccessRequest {
  id: number;
  kind: "subscription" | "special";
  package_name: string;
  message: string;
  payment_reference: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string;
  created_at: number;
}

// Shown in the admin panel's device list
const deviceName = () => {
  const platform = isNativeApp()
    ? "Android"
    : window.electronAPI
      ? "desktop"
      : "web";
  return "Folio " + platform;
};

// What the server supports; null for older servers without accounts
export const fetchServerInfo = async (url: string) => {
  const response = await request<ServerInfo>(
    { url: normalizeServerUrl(url), token: "" },
    "/pro/v1/info"
  );
  if (response.code === 0) {
    throw new Error(response.msg || i18n.t("Connection failed"));
  }
  return response.code === 200 && response.data ? response.data : null;
};

interface AuthResult {
  token?: string;
  user?: AccountUser;
  verification_required?: boolean;
}

const finishSignIn = async (url: string, response: SelfHostedResponse<AuthResult>) => {
  if (response.code !== 200 || !response.data) {
    throw new Error(response.msg || i18n.t("Connection failed"));
  }
  if (response.data.verification_required || !response.data.token) {
    return { verificationRequired: true };
  }
  const user = response.data.user!;
  await connectSelfHostedServer(url, response.data.token, {
    email: user.email,
    name: user.name,
  });
  return { verificationRequired: false };
};

export const signInWithPassword = async (
  url: string,
  email: string,
  password: string
) => {
  const normalized = normalizeServerUrl(url);
  return finishSignIn(
    normalized,
    await request<AuthResult>({ url: normalized, token: "" }, "/pro/v1/auth/login", {
      method: "POST",
      body: { email, password, device: deviceName() },
    })
  );
};

export const signUp = async (
  url: string,
  name: string,
  email: string,
  password: string
) => {
  const normalized = normalizeServerUrl(url);
  return finishSignIn(
    normalized,
    await request<AuthResult>(
      { url: normalized, token: "" },
      "/pro/v1/auth/register",
      { method: "POST", body: { name, email, password, device: deviceName() } }
    )
  );
};

// Opened in the browser; the server's page shows a code to paste back
export const googleSignInUrl = (url: string) =>
  normalizeServerUrl(url) + "/pro/v1/auth/google/authorize";

export const signInWithGoogleCode = async (url: string, code: string) => {
  const normalized = normalizeServerUrl(url);
  return finishSignIn(
    normalized,
    await request<AuthResult>(
      { url: normalized, token: "" },
      "/pro/v1/auth/google/exchange",
      { method: "POST", body: { code, device: deviceName() } }
    )
  );
};

export const requestPasswordReset = (url: string, email: string) =>
  request({ url: normalizeServerUrl(url), token: "" }, "/pro/v1/auth/forgot", {
    method: "POST",
    body: { email },
  });

export const resendVerification = (url: string, email: string) =>
  request({ url: normalizeServerUrl(url), token: "" }, "/pro/v1/auth/resend", {
    method: "POST",
    body: { email },
  });

export const fetchAccount = () => call<AccountSummary>("/pro/v1/account");

export const fetchPlans = async () => {
  const config = getSelfHostedConfig();
  if (!config) return null;
  const response = await request<{
    packages: AccountPackage[];
    payment_instructions: string;
  }>({ url: config.url, token: "" }, "/pro/v1/packages");
  return response.code === 200 ? response.data || null : null;
};

export const redeemPromoCode = (code: string) =>
  call<AccountSubscription>("/pro/v1/account/redeem", {
    method: "POST",
    body: { code },
  });

export const fetchAccessRequests = () =>
  call<AccessRequest[]>("/pro/v1/account/requests");

export const createAccessRequest = (body: {
  kind: "subscription" | "special";
  package_id?: number;
  message?: string;
  payment_reference?: string;
}) =>
  call<AccessRequest[]>("/pro/v1/account/requests", { method: "POST", body });

export const signOutDevice = (id: number) =>
  call<AccountDevice[]>("/pro/v1/account/devices/revoke", {
    method: "POST",
    body: { id },
  });

// Ends this device's session on the server, then forgets the server here
export const signOutAccount = async () => {
  await call("/pro/v1/account/logout", { method: "POST" });
  disconnectSelfHostedServer();
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
