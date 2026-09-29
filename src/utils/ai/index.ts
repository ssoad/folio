import toast from "react-hot-toast";
import anthropicAdapter from "./anthropic";
import openaiCompatibleAdapter from "./openaiCompatible";
import { decryptSecret } from "./secret";
import {
  AIChatRequest,
  AIProviderAdapter,
  AIProviderConfig,
  AIStreamCallback,
} from "./types";

export * from "./types";
export { encryptSecret, decryptSecret, migrateAIModelSecrets } from "./secret";

// Providers with a native API; every other provider id speaks the OpenAI-compatible protocol
const nativeAdapters: Record<string, AIProviderAdapter> = {
  anthropic: anthropicAdapter,
};

export const getAIAdapter = (providerId: string): AIProviderAdapter =>
  nativeAdapters[providerId] || openaiCompatibleAdapter;

// Saved keys may be encrypted; decrypt only for the duration of a request
const withPlainKey = async (config: AIProviderConfig) => ({
  ...config,
  apiKey: await decryptSecret(config.apiKey),
});

export const streamChat = async (
  config: AIProviderConfig,
  request: AIChatRequest,
  onMessage: AIStreamCallback
) => {
  let resolved: AIProviderConfig;
  try {
    resolved = await withPlainKey(config);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error), {
      id: "chat-stream-error",
      duration: 5000,
    });
    throw error;
  }
  return getAIAdapter(config.providerId).streamChat(
    resolved,
    request,
    onMessage
  );
};

export const listModels = async (
  config: AIProviderConfig,
  modelsEndpoint?: string
) =>
  getAIAdapter(config.providerId).listModels(
    await withPlainKey(config),
    modelsEndpoint
  );

export const testConnection = async (config: AIProviderConfig) =>
  getAIAdapter(config.providerId).testConnection(await withPlainKey(config));
