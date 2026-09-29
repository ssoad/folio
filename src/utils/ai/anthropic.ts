import Anthropic from "@anthropic-ai/sdk";
import toast from "react-hot-toast";
import i18n from "../../i18n";
import {
  AIChatRequest,
  AIModelInfo,
  AIProviderAdapter,
  AIProviderConfig,
  AIStreamCallback,
} from "./types";

const DEFAULT_MAX_TOKENS = 8192;
// Reader replies are short; cap the output budget even for models that allow more
const MAX_TOKENS_CAP = 32000;
const maxTokensCache: Record<string, number> = {};

// The settings page stores endpoints as ".../v1" (OpenAI style), the SDK appends "/v1" itself
const toBaseURL = (endpoint: string) =>
  (endpoint || "https://api.anthropic.com")
    .replace(/\/+$/, "")
    .replace(/\/v1$/, "");

const createClient = (config: AIProviderConfig) =>
  new Anthropic({
    apiKey: config.apiKey,
    baseURL: toBaseURL(config.endpoint),
    // The key is the user's own, entered in settings, so calling the API from the renderer is intended
    dangerouslyAllowBrowser: true,
  });

const getMaxTokens = async (client: Anthropic, modelId: string) => {
  if (maxTokensCache[modelId]) {
    return maxTokensCache[modelId];
  }
  let maxTokens = DEFAULT_MAX_TOKENS;
  try {
    const model = await client.models.retrieve(modelId);
    if (model.max_tokens) {
      maxTokens = Math.min(model.max_tokens, MAX_TOKENS_CAP);
    }
  } catch (error) {
    console.warn("Failed to read model limits, using default:", error);
  }
  maxTokensCache[modelId] = maxTokens;
  return maxTokens;
};

// The Messages API requires the conversation to start with a user turn
const toMessageParams = (
  request: AIChatRequest
): Anthropic.MessageParam[] => {
  const firstUser = request.messages.findIndex((m) => m.role === "user");
  if (firstUser === -1) {
    return [];
  }
  return request.messages
    .slice(firstUser)
    .map((m) => ({ role: m.role, content: m.content }));
};

const streamChat = async (
  config: AIProviderConfig,
  request: AIChatRequest,
  onMessage: AIStreamCallback
) => {
  const client = createClient(config);
  const messages = toMessageParams(request);
  if (messages.length === 0) {
    return { done: true };
  }
  try {
    const stream = client.messages.stream(
      {
        model: config.modelId,
        max_tokens: await getMaxTokens(client, config.modelId),
        // Follow-up questions resend the same chapter text, caching makes them cheaper and faster
        cache_control: { type: "ephemeral" },
        ...(request.system ? { system: request.system } : {}),
        messages,
      },
      { signal: request.signal }
    );
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        onMessage({ text: event.delta.text });
      }
    }
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      toast.error(i18n.t("The model declined to answer this request"), {
        id: "chat-stream-error",
        duration: 5000,
      });
    }
    return { done: true };
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError) {
      return { done: true };
    }
    console.error("ChatStream error:", error);
    toast.error(error instanceof Error ? error.message : "Unknown error", {
      id: "chat-stream-error",
      duration: 5000,
    });
    throw error;
  }
};

const listModels = async (
  config: AIProviderConfig
): Promise<AIModelInfo[]> => {
  if (!config.apiKey) {
    throw new Error("Missing API key");
  }
  const client = createClient(config);
  const models: AIModelInfo[] = [];
  for await (const model of client.models.list()) {
    models.push({ id: model.id, name: model.display_name || model.id });
  }
  return models;
};

const testConnection = async (config: AIProviderConfig) => {
  const client = createClient(config);
  const message = await client.messages.create({
    model: config.modelId,
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hi, just testing. Reply with OK." }],
  });
  const textBlock = message.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return textBlock ? textBlock.text : message.stop_reason || "";
};

const anthropicAdapter: AIProviderAdapter = {
  streamChat,
  listModels,
  testConnection,
};
export default anthropicAdapter;
