import { isElectron } from "react-device-detect";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import i18n from "../../i18n";

// Must match AI_SECRET_PREFIX in src/utils/main/ai-secret-util.js
const AI_SECRET_PREFIX = "enc:v1:";

export const isEncryptedSecret = (value: string) =>
  typeof value === "string" && value.startsWith(AI_SECRET_PREFIX);

// Returns the value unchanged when OS-level encryption is unavailable (web build, Linux without keyring)
export const encryptSecret = async (value: string): Promise<string> => {
  if (!value || !isElectron || isEncryptedSecret(value)) {
    return value;
  }
  try {
    const encrypted = await window.electronAPI.invoke("ai-secret-encrypt", {
      value,
    });
    return typeof encrypted === "string" && encrypted ? encrypted : value;
  } catch (error) {
    console.error("Failed to encrypt AI secret");
    return value;
  }
};

export const decryptSecret = async (value: string): Promise<string> => {
  if (!isEncryptedSecret(value)) {
    return value;
  }
  const result = isElectron
    ? await window.electronAPI
        .invoke("ai-secret-decrypt", { value })
        .catch(() => null)
    : null;
  if (!result || !result.ok) {
    throw new Error(
      i18n.t(
        "The API key can't be read on this device, please enter it again in the AI settings"
      )
    );
  }
  return result.value;
};

// Encrypts API keys saved before encryption was introduced
export const migrateAIModelSecrets = async () => {
  if (!isElectron) {
    return;
  }
  const aiModelConfig = ConfigService.getAllObjectConfig("aiModelConfig") || {};
  for (const entry of Object.values(aiModelConfig) as any[]) {
    const apiKey = entry?.config?.apiKey;
    if (!entry?.key || !apiKey || isEncryptedSecret(apiKey)) {
      continue;
    }
    const encrypted = await encryptSecret(apiKey);
    if (encrypted === apiKey) {
      // Encryption is unavailable on this system, nothing to migrate
      return;
    }
    ConfigService.setObjectConfig(
      entry.key,
      { ...entry, config: { ...entry.config, apiKey: encrypted } },
      "aiModelConfig"
    );
  }
};
